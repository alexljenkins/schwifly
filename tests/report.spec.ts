import { test, expect } from '@playwright/test';
import {
  buildVerdicts,
  renderVerdicts,
  type PwReport,
  type Verdict,
} from '../src/report';
import type { HealRecord, StepResult } from '../src/workflow';

// Pure unit test: synthetic Playwright-JSON + heal log + step log, no browser, no LLM.
// Proves all 4 verdict states fall out of the join rules.

// Real heal records carry an ABSOLUTE path (fileURLToPath(import.meta.url)); the report
// carries the same spec RELATIVE to cwd. Normalization must bridge the two. Anchor the
// absolute path at the real cwd so this mirrors production exactly.
const here = `${process.cwd()}/workflows`;

// A report with four specs, one per intended state.
const report: PwReport = {
  suites: [
    {
      title: 'workflows/pass.spec.ts',
      file: 'workflows/pass.spec.ts',
      specs: [{ title: 'happy path', ok: true, file: 'workflows/pass.spec.ts' }],
      suites: [],
    },
    {
      title: 'workflows/healed.spec.ts',
      file: 'workflows/healed.spec.ts',
      specs: [{ title: 'recovered', ok: true, file: 'workflows/healed.spec.ts' }],
      suites: [],
    },
    {
      title: 'workflows/fail.spec.ts',
      file: 'workflows/fail.spec.ts',
      specs: [{ title: 'broke', ok: false, file: 'workflows/fail.spec.ts' }],
      suites: [],
    },
    {
      title: 'workflows/impossible.spec.ts',
      file: 'workflows/impossible.spec.ts',
      specs: [{ title: 'unreachable', ok: false, file: 'workflows/impossible.spec.ts' }],
      suites: [],
    },
  ],
  errors: [],
};

// Heal log: an ABSOLUTE path (as written by step() via fileURLToPath) for the healed spec.
const heals: HealRecord[] = [
  {
    file: `${here}/healed.spec.ts`,
    original: 'a:has-text("Old")',
    healed: 'role=button[name="New"i]',
    intent: 'click the New button',
  },
];

// Step log: the impossible signal is StepResult.error === 'resolver returned null'.
const steps: StepResult[] = [
  {
    intent: 'click the ghost button',
    status: 'failed',
    usedLocator: '#ghost',
    error: 'resolver returned null',
    file: `${here}/impossible.spec.ts`,
  },
];

const ANSI = '\\x1b\\[[0-9;]*m';

test('buildVerdicts derives all four states from a synthetic join', () => {
  const verdicts = buildVerdicts(report, heals, steps);
  const byFile = new Map(verdicts.map((v) => [v.file, v]));

  expect(byFile.get('workflows/pass.spec.ts')!.state).toBe('pass');
  expect(byFile.get('workflows/healed.spec.ts')!.state).toBe('healed');
  expect(byFile.get('workflows/fail.spec.ts')!.state).toBe('fail');
  expect(byFile.get('workflows/impossible.spec.ts')!.state).toBe('impossible');
});

test('healed verdict carries the one-line locator diff', () => {
  const verdicts = buildVerdicts(report, heals, steps);
  const healed = verdicts.find((v) => v.file === 'workflows/healed.spec.ts')!;
  expect(healed.heals).toHaveLength(1);
  expect(healed.heals[0].original).toBe('a:has-text("Old")');
  expect(healed.heals[0].healed).toBe('role=button[name="New"i]');
});

test('absolute heal path matches a relative report path (HEALED does not fall through to PASS)', () => {
  // The heal file is absolute; the report file is relative. Normalization must bridge them.
  const verdicts = buildVerdicts(report, heals, steps);
  expect(verdicts.find((v) => v.file === 'workflows/healed.spec.ts')!.state).toBe('healed');
});

test('renderVerdicts strips ANSI under NO_COLOR and always reports the count bar', () => {
  const verdicts: Verdict[] = buildVerdicts(report, heals, steps);
  const out = renderVerdicts(verdicts);

  // Hard contract: NO_COLOR set => the rendered table contains zero ANSI escape codes.
  // (Playwright workers set FORCE_COLOR, which must NOT override NO_COLOR.)
  if (process.env.NO_COLOR) {
    expect(new RegExp(ANSI).test(out)).toBe(false);
  }

  // The summary bar reports the counts regardless of color; strip ANSI to compare.
  const plain = out.replace(new RegExp(ANSI, 'g'), '');
  expect(plain).toContain('1 pass');
  expect(plain).toContain('1 healed');
  expect(plain).toContain('1 fail');
  expect(plain).toContain('1 impossible');
});
