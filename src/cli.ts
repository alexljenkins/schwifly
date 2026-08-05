import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { applyHeal, type HealRecord, type StepResult } from './workflow';
import { buildVerdicts, renderVerdicts, exitCode, type PwReport } from './report';
import { clearRunLogs, HEAL_LOG, readRunLogs, STEP_LOG } from './runLogs';

// schwifly run [path] [playwright options]
//   1. run workflows in the Playwright runner (deterministic-first, parallel)
//   2. join the JSON report with the heal + step logs -> a 4-state verdict table
//   3. apply the AI heals back into the workflow source (git-diffable one-line locator swaps)
//   4. exit 1 on any fail/impossible; 0 if all pass/healed (healed == SUCCESS)
//
// schwifly gen "<story>" --url <start> [--out <file>]
//   turn plain English (+ inline <validate>) into a healable .spec.ts by driving a live browser
//   ONCE to discover a stable locator per intent (key-gated: needs an LLM key for observe()).
//
// schwifly attempt "<ticket>" --url <start> [--out <file>] [--visible]
//   hand an arbitrary ticket to a bounded, same-origin browser agent, turn its OBSERVED actions
//   into a deterministic .spec.ts asserting the ticket's outcome contract, replay that spec
//   agent-free, and save it only on GREEN. Exits 1 (saving nothing) when the contract fails.
const REPORT = '.schwifly/last-run.json';

// Auto-pull .env (GEMINI_API_KEY etc.) so `npm run schwifly gen ...` works without a manual
// `node --env-file=.env` prefix. Silent no-op when .env doesn't exist.
if (existsSync('.env')) process.loadEnvFile('.env');

const args = process.argv.slice(2);
const cmd = args[0];

if (cmd === 'gen') {
  await gen(args.slice(1));
  process.exit(0);
}

if (cmd === 'attempt') {
  await attempt(args.slice(1));
  process.exit(0);
}

if (cmd !== 'run') {
  console.log(
    'usage:\n  schwifly run [path]\n  schwifly gen "<story>" --url <start> [--out <file>]\n' +
      '  schwifly attempt "<ticket>" --url <start> [--out <file>] [--visible]',
  );
  process.exit(cmd ? 1 : 0);
}

const hasTarget = args[1] !== undefined && !args[1].startsWith('-');
const target = hasTarget ? args[1] : 'workflows/';
const playwrightArgs = hasTarget ? args.slice(2) : args.slice(1);

// Clear last run's logs so the verdict reflects ONLY this run.
clearRunLogs(HEAL_LOG);
clearRunLogs(STEP_LOG);

spawnSync('npx', ['playwright', 'test', target, ...playwrightArgs], { stdio: 'inherit' });

const report: PwReport = existsSync(REPORT) ? JSON.parse(readFileSync(REPORT, 'utf8')) : { suites: [], errors: [] };
const heals = readRunLogs<HealRecord>(HEAL_LOG);
const steps = readRunLogs<StepResult>(STEP_LOG);

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

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'generated';
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
  const title = flag(argv, 'title') ?? 'generated workflow';
  const out = flag(argv, 'out') ?? `workflows/${slugify(title)}.spec.ts`;
  const { generate } = await import('./generate');
  const spec = await generate({ title, story, url });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, spec);
  console.log(`schwifly gen: wrote ${out}`);
}

// --- schwifly attempt --------------------------------------------------------------------
async function attempt(argv: string[]): Promise<void> {
  const ticket = argv.find((a) => !a.startsWith('--'));
  const url = flag(argv, 'url');
  if (!ticket || !url) {
    console.log('usage: schwifly attempt "<ticket>" --url <start> [--out <file>] [--visible]');
    process.exit(1);
  }
  // The bounded attempt drives a live agent -> needs a key. There is no offline attempt mode.
  const { llmConfigFromEnv } = await import('./llm');
  if (!llmConfigFromEnv()) {
    console.error('schwifly attempt needs an LLM key (e.g. GEMINI_API_KEY) to run the agent attempt.');
    process.exit(1);
  }
  const title = flag(argv, 'title') ?? ticket.slice(0, 60);
  const out = flag(argv, 'out') ?? `workflows/${slugify(title)}.spec.ts`;
  const { attemptFlow } = await import('./attempt');
  const res = await attemptFlow({ ticket, url, title, out, visible: argv.includes('--visible') });
  if (res.contract) {
    console.log(`schwifly attempt: outcome contract (${res.contract.source}) — ${res.contract.summary}`);
    for (const c of res.contract.checks) console.log(`  must hold: ${c.intent}`);
  }
  if (!res.ok) {
    console.error(`schwifly attempt: FAILED — ${res.reason}. No workflow saved.`);
    process.exit(1);
  }
  console.log(`schwifly attempt: GREEN on agent-free replay; wrote ${res.saved}`);
}
