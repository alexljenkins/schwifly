import type { Action } from './workflow';
import { redact } from './secrets';

// Render a healable workflow .spec.ts in the EXACT byte-shape of workflows/example.spec.ts:
// the same imports, `const here = fileURLToPath(import.meta.url)`, and `file: here` on every
// step (so a heal can write the new locator back into THIS generated file). The template is
// load-bearing -- the resolver seam, the write-back, and the diff all assume this shape.

export interface EmitStep {
  intent: string;
  locator: string;          // plain-string selector (CSS / text= / role= / [aria-label] / xpath=)
  action: Action;
  value?: string;           // for 'fill' and 'expectText'
  page?: string;            // recorded popup/new-tab handle; omitted for the original page
  opensPage?: { handle: string; event: 'popup' | 'page' };
}

export interface EmitAssertion {
  type: 'exact' | 'semantic';
  value: string;            // the <validate> text
  intent: string;           // what is being validated, e.g. "the Pro price is 19"
  locator: string;          // discovered selector for the element under assertion
}

export interface EmitSpec {
  title: string;
  url: string;
  steps: EmitStep[];
  assertions: EmitAssertion[];
  /** Stated outcome the assertions below encode, rendered as a header comment (attempt flow). */
  contract?: { summary: string; checks: string[]; source: string };
}

// Valid JS single-quoted string literal, including control and Unicode line-separator escaping.
// Locators and intents stay plain strings; chained locator objects would break write-back + diff.
// Exported so write-back (applyHeal) anchors on the SAME `locator: '...'` byte-shape emit wrote.
export function q(s: string): string {
  const jsonBody = JSON.stringify(s).slice(1, -1).replace(/'/g, "\\'")
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `'${jsonBody}'`;
}

function comment(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function stepLines(s: EmitStep): string {
  const fields = [`intent: ${q(s.intent)}`, `locator: ${q(s.locator)}`, `action: ${q(s.action)}`];
  if (s.value !== undefined) fields.push(`value: ${q(s.value)}`);
  const page = s.page ?? 'page';
  const line = `    await step(${page}, { ${fields.join(', ')} }, { resolver: heal, file: here });`;
  if (!s.opensPage) return line;
  const wait = s.opensPage.event === 'popup'
    ? `${page}.waitForEvent('popup')`
    : `${page}.context().waitForEvent('page')`;
  return `    const ${s.opensPage.handle}Promise = ${wait};\n${line}\n`
    + `    const ${s.opensPage.handle} = await ${s.opensPage.handle}Promise;`;
}

export function emit(spec: EmitSpec): string {
  const fields = [
    spec.title,
    spec.url,
    ...spec.steps.flatMap((step) => [step.intent, step.locator, step.value ?? '']),
    ...spec.assertions.flatMap((assertion) => [assertion.intent, assertion.locator, assertion.value]),
    ...(spec.contract ? [spec.contract.summary, ...spec.contract.checks] : []),
  ];
  if (fields.some((field) => redact(field) !== field)) {
    throw new Error('generated workflow input contains a configured or labeled secret');
  }
  if (!spec.steps.length && !spec.assertions.length) {
    throw new Error('generated workflow needs at least one step or assertion');
  }
  const pageHandles = new Set(['page']);
  const emittedNames = new Set(['page']);
  for (const step of spec.steps) {
    if (!step.intent.trim() || !step.locator.trim()) throw new Error('every generated step needs intent and locator');
    if (step.action === 'fill' && step.value === undefined) {
      throw new Error(`fill step needs a value: ${step.intent}`);
    }
    for (const handle of [step.page, step.opensPage?.handle]) {
      if (handle && !/^[A-Za-z_$][\w$]*$/.test(handle)) {
        throw new Error(`invalid recorded page handle: ${handle}`);
      }
    }
    const page = step.page ?? 'page';
    if (!pageHandles.has(page)) throw new Error(`recorded page handle is not open yet: ${page}`);
    if (step.opensPage) {
      const { handle } = step.opensPage;
      if (pageHandles.has(handle) || emittedNames.has(handle) || emittedNames.has(`${handle}Promise`)) {
        throw new Error(`duplicate recorded page handle: ${handle}`);
      }
      pageHandles.add(handle);
      emittedNames.add(handle);
      emittedNames.add(`${handle}Promise`);
    }
  }
  for (const assertion of spec.assertions) {
    if (assertion.type === 'semantic') {
      throw new Error('semantic assertions are not supported yet; use an exact visible value');
    }
    if (!assertion.value.trim() || !assertion.intent.trim() || !assertion.locator.trim()) {
      throw new Error('every generated assertion needs value, intent, and locator');
    }
  }

  // Each <validate> becomes an expectText step (epic 5), appended after the navigation steps.
  const assertSteps: EmitStep[] = spec.assertions.map((a) => ({
    intent: a.intent,
    locator: a.locator,
    action: 'expectText',
    value: a.value,
  }));
  const body = [...spec.steps, ...assertSteps].map(stepLines).join('\n');

  // The outcome contract, verbatim in the file: a human reading this spec can see what "success"
  // means without rerunning anything, and can check that the assertions below actually encode it.
  const contract = spec.contract
    ? `\n// Outcome contract (${comment(spec.contract.source)}): ${comment(spec.contract.summary)}\n` +
      spec.contract.checks.map((c) => `//   must hold: ${comment(c)}`).join('\n') +
      '\n'
    : '';

  // Runs over the shared-CDP session (Stagehand owns Chromium, Playwright attaches over CDP) so a
  // heal's observe() and step()'s locators drive the SAME DOM, and the LLM heal tier
  // (EscalatingResolver) is reachable -- the heuristic alone cannot resolve descriptive intents.
  // Always-launch: every `schwifly run` opens the shared session in beforeAll, so it pays a second
  // Chromium launch whether or not a heal fires (the "AI only on failure" cost model is traded for
  // a reachable heal tier). Mirrors tests/live-tier2.spec.ts.
  return `import { test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { step } from '../src/workflow';
import { EscalatingResolver } from '../src/heal';
import { openSharedSession, type SharedSession } from '../src/sharedCdp';

// Generated by Schwifly. A Workflow is a real Playwright spec:
// deterministic-first, each step tries its locator and the AI backup only heals on failure,
// then \`schwifly run\` writes the healed locator back into this file.
const here = fileURLToPath(import.meta.url);
${contract}
test.describe(${q(spec.title)}, () => {
  test.setTimeout(120_000);

  let session: SharedSession;
  test.beforeAll(async () => {
    session = await openSharedSession();
  });
  test.afterAll(async () => {
    await session?.close();
  });

  test(${q(spec.title)}, async () => {
    const { page, stagehand } = session;
    // SCHWIFLY_NO_HEAL=1 disables the AI backup for one run. The attempt flow's certification
    // replay sets it so a capture cannot certify itself by healing an inaccurate locator.
    const heal = process.env.SCHWIFLY_NO_HEAL === '1' ? undefined : new EscalatingResolver(stagehand);
    await page.goto(${q(spec.url)});
${body}
  });
});
`;
}
