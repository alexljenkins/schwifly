import { createColors } from 'picocolors';
import type { HealRecord, StepResult } from './workflow';
import { redact } from './secrets';

// Decide color explicitly so NO_COLOR ALWAYS wins — picocolors' own auto-detect lets
// FORCE_COLOR (which the Playwright worker sets) override NO_COLOR, which we must not allow.
function colorEnabled(): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(process.stdout.isTTY);
}
const pc = createColors(colorEnabled());

// Pure verdict layer: join Playwright's JSON report with the heal log and the step log,
// classify each workflow into one of four states, render a table + summary bar.
// No Playwright/Stagehand/LLM imports — data in, data out — so it unit-tests with no browser.

export type VerdictState = 'pass' | 'healed' | 'fail' | 'impossible';

export interface Verdict {
  file: string;          // workflow spec path, normalized relative-from-cwd
  title: string;         // suite title (first spec title when available)
  state: VerdictState;
  heals: HealRecord[];   // the one-line locator diffs the AI wrote back for this file
}

// --- Minimal slices of the Playwright JSON report we actually read --------------
export interface PwSpec {
  title: string;
  ok: boolean;
  file?: string;
}
export interface PwSuite {
  title?: string;
  file?: string;
  specs?: PwSpec[];
  suites?: PwSuite[];
}
export interface PwReport {
  suites?: PwSuite[];
  errors?: unknown[];
}

const IMPOSSIBLE_SIGNAL = 'resolver returned null';

// Normalize any path (absolute heal/step-log file, or relative report file) to a single
// cwd-relative key with POSIX separators, so an absolute heal path joins a relative spec.
function key(p: string | undefined): string {
  if (!p) return '';
  let s = p.replace(/\\/g, '/');
  const cwd = process.cwd().replace(/\\/g, '/');
  if (s.startsWith(cwd + '/')) s = s.slice(cwd.length + 1);
  return s.replace(/^\.\//, '');
}

// Flatten the (possibly describe-nested) suite tree into one spec per file.
function* eachSpec(suite: PwSuite): Generator<PwSpec & { file: string }> {
  for (const spec of suite.specs ?? []) {
    yield { ...spec, file: key(spec.file ?? suite.file) };
  }
  for (const child of suite.suites ?? []) yield* eachSpec(child);
}

export function buildVerdicts(
  report: PwReport,
  heals: HealRecord[],
  steps: StepResult[] = [],
): Verdict[] {
  const healsByFile = new Map<string, HealRecord[]>();
  for (const h of heals) {
    const k = key(h.file);
    const list = healsByFile.get(k) ?? [];
    list.push(h);
    healsByFile.set(k, list);
  }

  // step() returns failures as a StepResult rather than throwing, so a workflow can finish
  // with a swallowed failure while Playwright still marks the spec ok:true. The step log is
  // the source of truth for both failure tiers: a null-resolver step => impossible (AI gave
  // up), any other failed step => fail. The report's ok still catches assertion/throw failures.
  const impossibleFiles = new Set<string>();
  const failedFiles = new Set<string>();
  for (const s of steps) {
    if (s.status !== 'failed') continue;
    if (s.error === IMPOSSIBLE_SIGNAL) impossibleFiles.add(key(s.file));
    else failedFiles.add(key(s.file));
  }

  // One verdict per spec file (a workflow). Merge specs that share a file (rare; OR the ok).
  const byFile = new Map<string, { file: string; title: string; ok: boolean }>();
  for (const suite of report.suites ?? []) {
    for (const spec of eachSpec(suite)) {
      const existing = byFile.get(spec.file);
      if (existing) existing.ok = existing.ok && spec.ok;
      else byFile.set(spec.file, { file: spec.file, title: spec.title, ok: spec.ok });
    }
  }

  const verdicts: Verdict[] = [];
  for (const { file, title, ok } of byFile.values()) {
    const fileHeals = healsByFile.get(file) ?? [];
    // Priority: impossible (AI gave up) > fail > healed (success) > pass.
    let state: VerdictState;
    if (impossibleFiles.has(file)) state = 'impossible';
    else if (!ok || failedFiles.has(file)) state = 'fail';
    else state = fileHeals.length > 0 ? 'healed' : 'pass';
    verdicts.push({ file, title, state, heals: fileHeals });
  }
  return verdicts;
}

// --- Rendering ------------------------------------------------------------------
const ICON: Record<VerdictState, string> = {
  pass: 'PASS',
  healed: 'HEALED',
  fail: 'FAIL',
  impossible: 'IMPOSSIBLE',
};

function paint(state: VerdictState, s: string): string {
  switch (state) {
    case 'pass': return pc.green(s);
    case 'healed': return pc.cyan(s);
    case 'fail': return pc.red(s);
    case 'impossible': return pc.magenta(s);
  }
}

export function renderVerdicts(verdicts: Verdict[]): string {
  verdicts = redact(verdicts);
  const lines: string[] = [];
  const stateW = Math.max(...Object.values(ICON).map((s) => s.length), 'STATE'.length);
  const fileW = Math.max(...verdicts.map((v) => v.file.length), 'WORKFLOW'.length);

  lines.push(`${'STATE'.padEnd(stateW)}  ${'WORKFLOW'.padEnd(fileW)}`);
  lines.push(`${'-'.repeat(stateW)}  ${'-'.repeat(fileW)}`);

  for (const v of verdicts) {
    const label = paint(v.state, ICON[v.state].padEnd(stateW));
    lines.push(`${label}  ${v.file.padEnd(fileW)}`);
    for (const h of v.heals) {
      // The one-line locator diff the AI wrote back, indented under its workflow.
      lines.push(`${' '.repeat(stateW)}  ${pc.dim(`- ${h.original}`)}`);
      lines.push(`${' '.repeat(stateW)}  ${pc.dim(`+ ${h.healed}`)}`);
    }
  }

  const counts: Record<VerdictState, number> = { pass: 0, healed: 0, fail: 0, impossible: 0 };
  for (const v of verdicts) counts[v.state]++;
  const bar = (['pass', 'healed', 'fail', 'impossible'] as VerdictState[])
    .map((s) => paint(s, `${counts[s]} ${s}`))
    .join('  ');

  lines.push('');
  lines.push(bar);
  return lines.join('\n');
}

// Healed counts as success; only fail/impossible are non-zero exit.
export function exitCode(verdicts: Verdict[]): number {
  return verdicts.some((v) => v.state === 'fail' || v.state === 'impossible') ? 1 : 0;
}
