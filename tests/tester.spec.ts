import { test, expect, chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Tester, testerSteps } from '../src/tester';
import { createBackground, readBackground, backgroundDirectory, writeBackground } from '../src/background';
import { readTester } from '../src/testerStore';
import { conciseResult } from '../src/cliOutput';

const bin = fileURLToPath(new URL('../bin/schwifly.js', import.meta.url));
let root: string;
let oldCwd: string;
let oldEnv: NodeJS.ProcessEnv;
test.beforeEach(() => {
  oldCwd = process.cwd(); oldEnv = { ...process.env };
  root = mkdtempSync(join(tmpdir(), 'schwifly-tester-'));
  process.chdir(root);
  process.env.XDG_CONFIG_HOME = join(root, 'config');
  process.env.SCHWIFLY_ROOT = root;
  process.env.SCHWIFLY_NO_HEAL = '1';
  delete process.env.OPENROUTER_API_KEY;
});
test.afterEach(() => { process.chdir(oldCwd); process.env = oldEnv; rmSync(root, { force: true, recursive: true }); });
const cli = (args: string[]) => spawnSync(process.execPath, [bin, ...args, '--json'], { cwd: root, env: process.env, encoding: 'utf8', timeout: 10000 });
async function finished(id: string) {
  await expect.poll(() => readBackground(id).status, { timeout: 30000 }).not.toMatch(/queued|running/);
  return readBackground(id);
}
async function app() {
  let broken = false;
  let color = 'white';
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end(`<style>button { width:100px;height:40px;background:${color};transition:transform 0.2s } button:active {transform:scale(.95)}</style><button onclick="document.querySelector('p').textContent='${broken ? 'Broken' : 'Done'}'; console.error('button diagnostic')">Go</button><p>Ready</p><input value="private value">`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no app port');
  return { url: `http://127.0.0.1:${address.port}`, break() { broken = true; color = 'red'; }, fix() { broken = false; },
    close: () => new Promise<void>(resolve => server.close(() => resolve())) };
}

test('background commands return an ID before work ends and retain failures and logs', async () => {
  const started = cli(['run', 'missing.spec.ts']);
  expect(started.status, started.stdout + started.stderr).toBe(0);
  const receipt = JSON.parse(started.stdout);
  expect(receipt.status).toBe('queued');
  expect(receipt.help[0]).toContain(root);
  expect(started.stderr).toContain('background');
  const run = await finished(receipt.id);
  expect(run.status).toBe('failed');
  expect(cli(['status', run.id]).status).toBe(1);
  expect(cli(['show', run.id]).status).toBe(1);
  expect(readFileSync(`${backgroundDirectory(run.id)}/progress.log`, 'utf8')).toContain('Finished: failed');
  expect(existsSync(`${backgroundDirectory(run.id)}/request.json`)).toBe(false);
});

test('session CLI keeps a browser open, queues checks, exposes debug, wipes context, and stops', async () => {
  test.setTimeout(60000);
  const site = await app();
  const started = cli(['session', 'start', '--url', site.url, '--headless']);
  expect(started.status, started.stdout + started.stderr).toBe(0);
  const id = JSON.parse(started.stdout).session;
  try {
    await expect.poll(() => readTester(id).status, { timeout: 20000 }).toBe('ready');
    const first = readTester(id);
    expect(first.debug).toMatch(/(?:localhost|127\.0\.0\.1)/);
    const attached = await chromium.connectOverCDP(first.debug!);
    await attached.contexts()[0].pages()[0].locator('input').fill('retained');
    await attached.close();
    const checks = [1, 2].map(() => JSON.parse(cli(['session', 'ask', id, '<expect>Ready</expect>', '--element', 'button', '--padding', '6']).stdout));
    for (const check of checks) expect((await finished(check.id)).status).toBe('passed');
    expect(readTester(id).debug).toBe(first.debug);
    const again = await chromium.connectOverCDP(first.debug!);
    expect(await again.contexts()[0].pages()[0].locator('input').inputValue()).toBe('retained');
    await again.close();
    const baseline = JSON.parse(cli(['session', 'baseline', id]).stdout);
    expect((await finished(baseline.id)).status).toBe('passed');
    const compare = JSON.parse(cli(['session', 'compare', id]).stdout);
    const compared = await finished(compare.id);
    expect((compared.result as any).comparison.every((image: any) => image.image === 'unchanged')).toBe(true);

    const reset = JSON.parse(cli(['session', 'reset', id]).stdout);
    expect((await finished(reset.id)).status).toBe('passed');
    expect(readTester(id).debug).not.toBe(first.debug);
    expect(JSON.parse(readFileSync(`.schwifly/testers/${id}/memory.json`, 'utf8')).history).toEqual([]);
    const noPrevious = JSON.parse(cli(['session', 'ask', id, 'Try the button again']).stdout);
    expect((await finished(noPrevious.id)).status).toBe('failed');
    const stop = JSON.parse(cli(['session', 'stop', id]).stdout);
    expect((await finished(stop.id)).status).toBe('passed');
    await expect.poll(() => readTester(id).status).toBe('stopped');
    expect(existsSync('.schwifly/browser.lock')).toBe(false);
    expect(JSON.parse(cli(['session', 'stop', id]).stdout).status).toBe('stopped');
  } finally {
    const record = readTester(id);
    if (!['stopped', 'failed'].includes(record.status)) {
      const stop = JSON.parse(cli(['session', 'stop', id]).stdout);
      if (stop.id) await finished(stop.id);
    }
    await site.close();
  }
});

test('tester captures concise facts and crops, compares changed behavior, and certifies saved actions', async () => {
  test.setTimeout(90000);
  const site = await app();
  let calls = 0;
  const tester = new Tester({ version: 1, id: randomUUID(), url: site.url, headless: true, created: new Date().toISOString(), status: 'starting' },
    async session => {
      calls++;
      await session.page.locator('button').click();
      return { actions: [{ method: 'click', selector: 'button', description: 'Go', args: [], ok: true }], notes: 'The button looks good. This is a model opinion.' };
    }, async () => 'The text looks readable.');
  const request = (operation: 'ask' | 'baseline' | 'compare' | 'save', extra = {}) => ({ id: createBackground(operation).id, operation, ...extra });
  try {
    await tester.open();
    const first = await tester.execute(request('ask', { instruction: 'Check the press animation. Click Go. <expect>Done</expect>', element: 'button', padding: 6 })) as any;
    expect(first.status).toBe('passed');
    expect(first.verified).toEqual(['the page shows Done']);
    expect(first.opinions).toContain('model opinion');
    expect(first.press.changedWhilePressed).toBe(true);
    expect(first.press.runningAnimations).toBeGreaterThan(0);
    expect(first.screenshots.map((shot: any) => shot.label)).toEqual(['before', 'pressed', 'after']);
    expect(first.browserErrors).toContain('console: button diagnostic');
    const png = readFileSync(first.screenshots[0].path);
    expect(png.readUInt32BE(16)).toBe(112);
    expect(png.readUInt32BE(20)).toBe(52);
    await test.info().attach('button-crop', { path: join(root, first.screenshots[0].path), contentType: 'image/png' });
    await tester.execute(request('baseline'));
    const saved = await tester.execute(request('save', { name: 'go' })) as any;
    expect(saved.verification).toBe('fresh replay passed');
    expect(readFileSync('workflows/go.spec.ts', 'utf8')).toContain("locator: 'button'");
    site.break();
    await expect(tester.execute(request('save', { name: 'broken' }))).rejects.toThrow('fresh replay failed');
    expect(existsSync('workflows/broken.spec.ts')).toBe(false);
    const comparison = await tester.execute(request('compare')) as any;
    expect(comparison.status).toBe('failed');
    expect(comparison.failed).toContain('the page shows Done');
    expect(comparison.comparison[0].image).toBe('changed');
    expect(calls).toBe(1);
    await expect(tester.execute(request('save', { name: 'still-broken' }))).rejects.toThrow('no passing outcome');
    site.fix();
    const retry = await tester.execute(request('ask', { instruction: 'Try the button again' })) as any;
    expect(retry.status).toBe('passed');
    expect(retry.verified).toContain('the page shows Done');
    expect(calls).toBe(1);
    await tester.execute(request('ask', { instruction: 'Try another button again', element: 'button' }));
    expect(calls).toBe(2);
    await tester.reset();
    await expect(tester.execute(request('compare'))).rejects.toThrow('no previous check');
    await tester.session!.page.locator('button').evaluate(button => { (button as HTMLButtonElement).onclick = () => { document.querySelector('p')!.textContent = 'Done'; button.remove(); }; });
    const removed = await tester.execute(request('ask', { instruction: 'Click Go. <expect>Done</expect>', element: 'button' })) as any;
    expect(removed.status).toBe('passed');
    expect(removed.screenshots[1].framing).toBe('page');
  } finally { await tester.close(); await site.close(); }
});

test('unsupported captured actions cannot silently become a different saved test', () => {
  expect(() => testerSteps([{ method: 'press', selector: 'button', description: 'Go', args: ['Enter'], ok: true }])).toThrow('cannot replay press');
  expect(() => testerSteps([{ method: 'fill', selector: 'input', description: 'Password', args: ['private-fixture-value'], ok: true }])).toThrow('contains a secret');
  expect(testerSteps([1, 2].map(() => ({ method: 'click', selector: 'button', description: 'Go', args: [], ok: true })))).toHaveLength(2);
});

test('session subcommands reject irrelevant flags without starting a browser', () => {
  expect(cli(['session', 'start', '--url', 'https://example.com', '--name', 'bad']).status).toBe(2);
  expect(cli(['session', 'reset', randomUUID(), '--element', 'button']).status).toBe(2);
  expect(cli(['session', 'unknown']).status).toBe(2);
  expect(existsSync('.schwifly')).toBe(false);
});

test('default reports use plain results and omit successful step detail', () => {
  expect(conciseResult({ workflows: [{ file: 'go', state: 'healed' }, { file: 'other', state: 'impossible' }], total: 2, status: 'failed' })).toEqual({
    status: 'failed', total: 2, tests: [{ file: 'go', status: 'repaired' }, { file: 'other', status: 'failed' }],
  });
});


test('an unfinished run with a dead owner reports failure instead of running forever', () => {
  const run = createBackground('interrupted');
  run.pid = 1073741824;
  run.created = '2000-01-01T00:00:00.000Z';
  writeBackground(run);
  expect(readBackground(run.id)).toMatchObject({ status: 'failed', reason: 'run process stopped before writing a result' });
});
