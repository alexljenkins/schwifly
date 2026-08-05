import { test, expect } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { attemptFlow, replayGreen, type Discovery, type DiscoveryRequest } from '../src/attempt';
import type { CapturedAction } from '../src/capture';

// KEY-FREE witnesses for task-to-verified-flow. Every live seam (the agent attempt and the
// replay gate) is injected as a fake, so the baseline suite never needs a key or a browser
// agent. What is proven here is the CONTRACT: the agent's testimony is not evidence.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL_ = 'https://the-internet.herokuapp.com/add_remove_elements/';

function tmpOut(): string {
  return join(mkdtempSync(join(tmpdir(), 'schwifly-attempt-')), 'flow.spec.ts');
}

// A fake agent's OBSERVED history: one failed probe, one real click, plus narration-free facts.
const HISTORY: CapturedAction[] = [
  { method: 'click', selector: 'xpath=/html/body/div[9]', description: 'Add Elemnt', args: [], ok: false },
  { method: 'click', selector: 'xpath=/html/body/div[2]/button[1]', description: 'Add Element', args: [], ok: true },
  { method: 'screenshot', selector: 'xpath=/html', description: 'page', args: [], ok: true },
];

function fakeDiscovery(over: Partial<Discovery> = {}): (req: DiscoveryRequest) => Promise<Discovery> {
  return async () => ({
    actions: HISTORY,
    assertions: [{ type: 'exact', value: 'Delete', intent: 'the page shows Delete', locator: 'role=button[name="Delete"i]' }],
    unmet: [],
    notes: 'I clicked Add Element and everything worked great.',
    ...over,
  });
}

test('a GREEN agent-free replay saves a spec that asserts the stated outcome contract', async () => {
  const out = tmpOut();
  const replayed: string[] = [];
  const res = await attemptFlow({
    ticket: 'Add an element to the list. <expect>Delete</expect>',
    url: URL_,
    title: 'add element',
    out,
    discover: fakeDiscovery(),
    replay: async (f) => {
      replayed.push(f);
      return true;
    },
  });

  expect(res.ok).toBe(true);
  expect(res.saved).toBe(out);
  expect(replayed).toHaveLength(1);

  const src = readFileSync(out, 'utf8');
  // The outcome contract is visible in the file: a human sees what success means without a rerun.
  expect(src).toContain('// Outcome contract (ticket): Add an element to the list. Delete');
  expect(src).toContain('//   must hold: the page shows Delete');
  // ...and it is an OBSERVABLE assertion, not agent testimony.
  expect(src).toContain("action: 'expectText'");
  expect(src).toContain("value: 'Delete'");
  expect(src).not.toContain('everything worked great');
  // Failed and unsupported exploration never appears in emitted source.
  expect(src).not.toContain('div[9]');
  expect(src).not.toContain('screenshot');
  expect((src.match(/await step\(/g) ?? []).length).toBe(2);
  rmSync(dirname(out), { recursive: true, force: true });
});

test('terse and verbose phrasings of the same ticket reach the SAME normalized flow', async () => {
  const run = async (ticket: string) => {
    const out = tmpOut();
    const res = await attemptFlow({
      ticket,
      url: URL_,
      title: 'add element',
      out,
      discover: fakeDiscovery({ notes: ticket }),
      replay: async () => true,
    });
    expect(res.ok).toBe(true);
    const src = readFileSync(out, 'utf8');
    rmSync(dirname(out), { recursive: true, force: true });
    return src;
  };

  const terse = await run('add element <expect>Delete</expect>');
  const verbose = await run(
    'As a user of the demo site I would like to be able to add a new element to the list on the ' +
      'page, by pressing the button provided, so that I can then remove it again. <expect>Delete</expect>',
  );
  // Only the header comment carries the ticket wording; every executable line is identical.
  const flow = (s: string) => s.split('\n').filter((l) => l.trim().startsWith('await ')).join('\n');
  expect(flow(terse)).toBe(flow(verbose));
});

test('a LYING agent — claims success, contract does not hold — fails and saves no workflow', async () => {
  const out = tmpOut();
  let replayCalled = false;
  const res = await attemptFlow({
    ticket: 'Add an element to the list. <expect>Delete</expect>',
    url: URL_,
    title: 'add element',
    out,
    // The agent reports a successful click and a triumphant message, but the contract check was
    // never observed on the page. The page assertion is the judge; the testimony is ignored.
    discover: fakeDiscovery({ assertions: [], unmet: ['the page shows Delete'], notes: 'Success! Task completed.' }),
    replay: async () => {
      replayCalled = true;
      return true;
    },
  });

  expect(res.ok).toBe(false);
  expect(res.reason).toContain('outcome contract not met');
  expect(replayCalled).toBe(false);
  expect(existsSync(out)).toBe(false);
  rmSync(dirname(out), { recursive: true, force: true });
});

test('a RED agent-free replay saves no workflow and keeps the candidate as debug evidence', async () => {
  const out = tmpOut();
  const res = await attemptFlow({
    ticket: 'Add an element to the list. <expect>Delete</expect>',
    url: URL_,
    title: 'add element',
    out,
    discover: fakeDiscovery(),
    replay: async () => false,
  });

  expect(res.ok).toBe(false);
  expect(res.reason).toContain('replay failed');
  expect(existsSync(out)).toBe(false);
  expect(existsSync(join(root, 'candidates', 'candidate.spec.ts'))).toBe(true);
  rmSync(dirname(out), { recursive: true, force: true });
});

test('a ticket with no resolvable outcome contract never attempts anything', async () => {
  const out = tmpOut();
  let discovered = false;
  const res = await attemptFlow({
    ticket: 'have a look at the site',
    url: URL_,
    title: 'vague',
    out,
    resolveContract: async () => null,
    discover: async () => {
      discovered = true;
      return { actions: [], assertions: [], unmet: [], notes: '' };
    },
    replay: async () => true,
  });

  expect(res.ok).toBe(false);
  expect(res.reason).toContain('no outcome contract');
  expect(discovered).toBe(false);
  expect(existsSync(out)).toBe(false);
  rmSync(dirname(out), { recursive: true, force: true });
});

test('a spec produced by the attempt flow compiles under tsc (real typecheck, no key)', async () => {
  // Relative imports ('../src/...') need a depth-1 directory. Use a private one rather than
  // workflows/ so this never races the other suite's project-wide `tsc --noEmit`.
  const dir = join(root, '.typecheck-attempt');
  const out = join(dir, 'flow.spec.ts');
  try {
    const res = await attemptFlow({
      ticket: "Sign up for the newsletter. <expect>Thanks</expect>",
      url: URL_,
      title: 'attempt typecheck',
      out,
      discover: fakeDiscovery({
        actions: [...HISTORY, { method: 'fill', selector: 'xpath=//input[1]', description: "Email's field", args: ["a'b@c.com"], ok: true }],
      }),
      replay: async () => true,
    });
    expect(res.ok).toBe(true);
    // Same compiler options as tsconfig.json, applied to just this file.
    const tsc = spawnSync(
      'npx',
      ['tsc', '--noEmit', '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'Bundler',
       '--strict', '--skipLibCheck', '--esModuleInterop', '--types', 'node', out],
      { cwd: root, encoding: 'utf8' },
    );
    expect(tsc.status, tsc.stdout + tsc.stderr).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the replay gate reads the step log, not the exit code', () => {
  // step() records a failure and keeps going, so a spec whose every step failed still exits 0.
  // Certifying on the exit code alone would save a workflow that never did anything.
  const ok = { intent: 'click the Add Element', status: 'ok' as const, usedLocator: 'role=button[name="Add Element"i]' };
  const failed = { ...ok, status: 'failed' as const };
  const healed = { ...ok, status: 'healed' as const };

  expect(replayGreen(0, [ok])).toBe(true);
  expect(replayGreen(0, [ok, failed])).toBe(false);
  expect(replayGreen(1, [ok])).toBe(false);
  // Healing is disabled for the certification replay: a healed step means the guard did not hold.
  expect(replayGreen(0, [healed])).toBe(false);
  // No steps recorded at all is not a pass, it is a spec that never ran.
  expect(replayGreen(0, [])).toBe(false);
});
