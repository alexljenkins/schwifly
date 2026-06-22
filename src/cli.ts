import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { applyHeal, type HealRecord, type StepResult } from './workflow';
import { buildVerdicts, renderVerdicts, exitCode, type PwReport } from './report';

// schwifly run [path]
//   1. run workflows in the Playwright runner (deterministic-first, parallel)
//   2. join the JSON report with the heal + step logs -> a 4-state verdict table
//   3. apply the AI heals back into the workflow source (git-diffable one-line locator swaps)
//   4. exit 1 on any fail/impossible; 0 if all pass/healed (healed == SUCCESS)
//
// schwifly gen "<story>" --url <start> [--out <file>]
//   turn plain English (+ inline <validate>) into a healable .spec.ts by driving a live browser
//   ONCE to discover a stable locator per intent (key-gated: needs an LLM key for observe()).
const REPORT = '.schwifly/last-run.json';
const HEAL_LOG = '.schwifly/heals.ndjson';
const STEP_LOG = '.schwifly/steps.ndjson';

const args = process.argv.slice(2);
const cmd = args[0];

if (cmd === 'gen') {
  await gen(args.slice(1));
  process.exit(0);
}

if (cmd !== 'run') {
  console.log('usage:\n  schwifly run [path]\n  schwifly gen "<story>" --url <start> [--out <file>]');
  process.exit(cmd ? 1 : 0);
}

const target = args[1] ?? 'workflows/';

// Clear last run's logs so the verdict reflects ONLY this run.
for (const f of [HEAL_LOG, STEP_LOG]) if (existsSync(f)) rmSync(f);

spawnSync('npx', ['playwright', 'test', target], { stdio: 'inherit' });

const readNdjson = <T>(path: string): T[] =>
  existsSync(path)
    ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as T)
    : [];

const report: PwReport = existsSync(REPORT) ? JSON.parse(readFileSync(REPORT, 'utf8')) : { suites: [], errors: [] };
const heals = readNdjson<HealRecord>(HEAL_LOG);
const steps = readNdjson<StepResult>(STEP_LOG);

const verdicts = buildVerdicts(report, heals, steps);

console.log('\n' + renderVerdicts(verdicts) + '\n');

// Write the healed locators back into the workflow source — the "update the workflow" step.
let updated = 0;
for (const rec of heals) if (applyHeal(rec)) updated++;
if (heals.length) console.log(`schwifly: applied ${updated}/${heals.length} heal(s) to workflow source.`);

process.exit(exitCode(verdicts));

// --- schwifly gen ------------------------------------------------------------------------
function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function gen(argv: string[]): Promise<void> {
  const story = argv.find((a) => !a.startsWith('--'));
  const url = flag(argv, 'url');
  if (!story || !url) {
    console.log('usage: schwifly gen "<story>" --url <start> [--out <file>]');
    process.exit(1);
  }
  // Live discovery drives observe() -> needs a key. Without one we cannot find real locators.
  const { llmConfigFromEnv } = await import('./llm');
  if (!llmConfigFromEnv()) {
    console.error('schwifly gen needs an LLM key (e.g. GEMINI_API_KEY) to discover locators live.');
    process.exit(1);
  }
  const out = flag(argv, 'out') ?? 'workflows/generated.spec.ts';
  const title = flag(argv, 'title') ?? 'generated workflow';
  const { generate } = await import('./generate');
  const spec = await generate({ title, story, url });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, spec);
  console.log(`schwifly gen: wrote ${out}`);
}
