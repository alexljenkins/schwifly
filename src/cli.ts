import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { applyHeal, type HealRecord, type StepResult } from './workflow.js';
import {
  buildVerdicts,
  renderVerdicts,
  exitCode,
  successfulHeals,
  type PwReport,
} from './report.js';
import { clearRunLogs, HEAL_LOG, readRunLogs, STEP_LOG } from './runLogs.js';
import { runPlaywright } from './playwrightProcess.js';
import { redact } from './secrets.js';
import { PROOF_LOG } from './proofLogs.js';
import type { ProofRecord } from './proofs.js';

// schwifly run [path] [playwright options]
//   run deterministic workflows, report four-state verdicts, then write back only heals from a
//   workflow whose whole run succeeded.
// schwifly gen "<story>" --url <start> [--out workflows/<name>.spec.ts]
//   discover locators once and emit a deterministic workflow.
// schwifly attempt "<ticket>" --url <start> [--out workflows/<name>.spec.ts] [--visible]
//   run bounded discovery, certify the captured flow agent-free, then save it without overwrite.
// schwifly attempt <story.story.yaml> [--visible]
//   discover and certify a replaceable route against author-owned deterministic proofs.
// schwifly rebuild <story.story.yaml> [--visible]
//   keep a green route or replace a broken route after discovery and fresh certification.
// schwifly record <url> [--out workflows/<name>.spec.ts]
//   open Playwright codegen, record one human-driven flow, then emit the same healable template.
const REPORT = '.schwifly/last-run.json';
const USAGE =
  'usage (all commands accept --root <directory>):\n  schwifly init\n  schwifly run [path]\n' +
  '  schwifly gen "<story>" --url <start> [--out workflows/<name>.spec.ts]\n' +
  '  schwifly attempt "<ticket>" --url <start> [--out workflows/<name>.spec.ts] [--visible]\n' +
  '  schwifly attempt stories/<name>.story.yaml [--visible]\n' +
  '  schwifly rebuild stories/<name>.story.yaml [--visible]\n' +
  '  schwifly record <url> [--from <codegen.ts>] [--out workflows/<name>.spec.ts]';

interface CommandInput {
  positionals: string[];
  flags: Record<string, string | true>;
}

function parseCommand(
  argv: string[],
  valueFlags: string[],
  booleanFlags: string[] = [],
): CommandInput {
  const values = new Set(valueFlags);
  const booleans = new Set(booleanFlags);
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }

    const name = arg.slice(2);
    if (booleans.has(name)) {
      flags[name] = true;
      continue;
    }
    if (!values.has(name)) throw new Error(`unknown option: --${name}`);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new Error(`--${name} needs a value`);
    flags[name] = value;
    i++;
  }

  return { positionals, flags };
}

function stringFlag(input: CommandInput, name: string): string | undefined {
  const value = input.flags[name];
  return typeof value === 'string' ? value : undefined;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'generated';
}

function webUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`invalid URL: ${value}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`URL must use http or https: ${value}`);
  }
  if (url.username || url.password || redact(value) !== value) {
    throw new Error('URL must not contain credentials or configured secrets');
  }
  return value;
}

// Limit CLI-generated outputs to workflows to prevent path traversal and code overwrite.
function workflowOutput(requested: string): string {
  const absolute = resolve(requested);
  const rel = relative(process.cwd(), absolute).replaceAll(sep, '/');
  if (!/^workflows\/[^/]+\.spec\.ts$/.test(rel)) {
    throw new Error('output must be workflows/<name>.spec.ts');
  }
  const parent = dirname(absolute);
  if (existsSync(parent)) {
    const realRoot = realpathSync(process.cwd());
    const realParent = realpathSync(parent);
    const fromRoot = relative(realRoot, realParent);
    if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
      throw new Error('workflows directory must stay inside the current workspace');
    }
  }
  if (existsSync(absolute)) throw new Error(`output already exists: ${rel}`);
  return rel;
}

function insideWorkspace(file: string | undefined): file is string {
  if (!file) return false;
  try {
    const rel = relative(realpathSync(process.cwd()), realpathSync(file));
    return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  } catch {
    return false;
  }
}

async function runWorkflows(args: string[]): Promise<number> {
  const hasTarget = args[0] !== undefined && !args[0].startsWith('-');
  const target = hasTarget ? args[0] : 'workflows/';
  const playwrightArgs = hasTarget ? args.slice(1) : args;

  // No stale evidence may survive into this verdict.
  clearRunLogs(HEAL_LOG);
  clearRunLogs(STEP_LOG);
  clearRunLogs(PROOF_LOG);
  rmSync(REPORT, { force: true });

  const runner = await runPlaywright(['test', target, ...playwrightArgs], { stdio: 'inherit' });
  const report: PwReport = existsSync(REPORT)
    ? JSON.parse(readFileSync(REPORT, 'utf8')) as PwReport
    : { suites: [], errors: [] };
  const heals = readRunLogs<HealRecord>(HEAL_LOG);
  const steps = readRunLogs<StepResult>(STEP_LOG);
  const proofs = readRunLogs<ProofRecord>(PROOF_LOG);
  const verdicts = buildVerdicts(report, heals, steps);

  console.log('\n' + renderVerdicts(verdicts) + '\n');
  const failedProofs = proofs.filter((proof) => proof.status !== 'pass');
  if (failedProofs.length) {
    console.log('Proof failures:');
    for (const proof of failedProofs) {
      console.log(`  ${proof.storyId}/${proof.clauseId}: ${proof.status}: ${redact(proof.message)}`);
    }
    console.log('');
  }

  // A global runner error invalidates the whole evidence set. Otherwise, only heals attached to a
  // fully successful workflow are eligible, and only files inside this workspace can be changed.
  const hasReportedFailure = verdicts.some(
    (verdict) => verdict.state === 'fail' || verdict.state === 'impossible',
  );
  const evidenceComplete =
    (runner.status === 0 || (runner.status !== null && hasReportedFailure)) &&
    !(report.errors?.length);
  const eligible = evidenceComplete ? successfulHeals(verdicts) : [];
  const safe = eligible.filter((heal) => insideWorkspace(heal.file));
  let updated = 0;
  for (const heal of safe) if (applyHeal(heal)) updated++;
  if (heals.length) {
    const withheld = heals.length - safe.length;
    console.log(`schwifly: applied ${updated}/${safe.length} successful heal(s); withheld ${withheld}.`);
  }

  const verdictExit = exitCode(verdicts);
  const writeBackFailed = updated !== safe.length || (verdictExit === 0 && safe.length !== heals.length);
  if (runner.status !== 0 || writeBackFailed || failedProofs.length) return 1;
  return verdictExit;
}

async function gen(argv: string[]): Promise<number> {
  const input = parseCommand(argv, ['url', 'out', 'title']);
  const story = input.positionals[0];
  const rawUrl = stringFlag(input, 'url');
  if (input.positionals.length !== 1 || !story || !rawUrl) {
    console.log('usage: schwifly gen "<story>" --url <start> [--out workflows/<name>.spec.ts]');
    return 1;
  }
  const url = webUrl(rawUrl);
  const title = stringFlag(input, 'title') ?? 'generated workflow';
  const out = workflowOutput(stringFlag(input, 'out') ?? `workflows/${slugify(title)}.spec.ts`);

  const { llmConfigFromEnv } = await import('./llm.js');
  if (!llmConfigFromEnv()) {
    console.error('schwifly gen needs an LLM key (OPENROUTER_API_KEY) to discover locators live.');
    return 1;
  }
  const { generate } = await import('./generate.js');
  const spec = await generate({ title, story, url });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, spec, { flag: 'wx' });
  console.log(`schwifly gen: wrote ${out}`);
  return 0;
}

async function attempt(argv: string[]): Promise<number> {
  const input = parseCommand(argv, ['url', 'out', 'title'], ['visible']);
  const ticket = input.positionals[0];
  if (input.positionals.length === 1 && ticket?.endsWith('.story.yaml')) {
    if (input.flags.url || input.flags.out || input.flags.title) {
      console.error('schwifly attempt: a story file owns its URL, title, and route; remove --url, --title, and --out.');
      return 1;
    }
    const { attemptStory } = await import('./storyAttempt.js');
    const result = await attemptStory({ file: ticket, visible: input.flags.visible === true });
    return reportStoryCommand('attempt', result);
  }
  const rawUrl = stringFlag(input, 'url');
  if (input.positionals.length !== 1 || !ticket || !rawUrl) {
    console.log(
      'usage: schwifly attempt "<ticket>" --url <start> ' +
      '[--out workflows/<name>.spec.ts] [--visible]',
    );
    return 1;
  }
  const url = webUrl(rawUrl);
  const title = redact(stringFlag(input, 'title') ?? ticket.slice(0, 60));
  const out = workflowOutput(stringFlag(input, 'out') ?? `workflows/${slugify(title)}.spec.ts`);

  const { llmConfigFromEnv } = await import('./llm.js');
  if (!llmConfigFromEnv()) {
    console.error('schwifly attempt needs an LLM key (OPENROUTER_API_KEY) to run the agent attempt.');
    return 1;
  }
  const { attemptFlow } = await import('./attempt.js');
  const res = await attemptFlow({ ticket, url, title, out, visible: input.flags.visible === true });
  if (res.contract) {
    console.log(`schwifly attempt: outcome contract (${res.contract.source}): ${res.contract.summary}`);
    for (const check of res.contract.checks) console.log(`  must hold: ${check.intent}`);
  }
  if (!res.ok) {
    console.error(`schwifly attempt: FAILED: ${res.reason}. No workflow saved.`);
    return 1;
  }
  console.log(`schwifly attempt: GREEN on agent-free replay; wrote ${res.saved}`);
  return 0;
}

function reportStoryCommand(command: 'attempt' | 'rebuild', result: import('./storyAttempt.js').StoryCommandResult): number {
  if (!result.ok) {
    console.error(`schwifly ${command}: FAILED: ${result.reason}`);
    if (result.certification?.routeFailures.length) {
      console.error('Route failures:');
      for (const failure of result.certification.routeFailures) console.error(`  ${failure}`);
    }
    if (result.certification?.proofFailures.length) {
      console.error('Proof failures:');
      for (const failure of result.certification.proofFailures) console.error(`  ${failure}`);
    }
    return 1;
  }
  if (result.unchanged) console.log(`schwifly ${command}: route is already green; preserved ${result.saved}`);
  else console.log(`schwifly ${command}: certified route written to ${result.saved}`);
  return 0;
}

async function rebuild(argv: string[]): Promise<number> {
  const input = parseCommand(argv, [], ['visible']);
  const file = input.positionals[0];
  if (input.positionals.length !== 1 || !file?.endsWith('.story.yaml')) {
    console.log('usage: schwifly rebuild stories/<name>.story.yaml [--visible]');
    return 1;
  }
  const { rebuildStory } = await import('./storyAttempt.js');
  return reportStoryCommand('rebuild', await rebuildStory({ file, visible: input.flags.visible === true }));
}

async function record(argv: string[]): Promise<number> {
  const input = parseCommand(argv, ['out', 'from']);
  const rawUrl = input.positionals[0];
  if (input.positionals.length !== 1 || !rawUrl) {
    console.log('usage: schwifly record <url> [--out workflows/<name>.spec.ts]');
    return 1;
  }
  const url = webUrl(rawUrl);
  const host = new URL(url).hostname;
  const title = `recorded ${host} flow`;
  const out = workflowOutput(stringFlag(input, 'out') ?? `workflows/${slugify(title)}.spec.ts`);

  mkdirSync('.schwifly', { recursive: true });
  const tempDir = mkdtempSync(join('.schwifly', 'record-'));
  const capture = join(tempDir, 'codegen.spec.ts');
  try {
    const from = stringFlag(input, 'from');
    if (from) writeFileSync(capture, readFileSync(resolve(from), 'utf8'));
    else {
    console.log('schwifly record: complete the flow in the Playwright browser, then close it.');
    const runner = await runPlaywright(
      ['codegen', '--target', 'playwright-test', '-o', capture, url],
      { stdio: 'inherit' },
    );
    if (runner.error) throw runner.error;
    if (runner.status !== 0) {
      console.error(`schwifly record: Playwright codegen exited ${runner.status ?? runner.signal}.`);
      return 1;
    }
    }
    if (!existsSync(capture) || !readFileSync(capture, 'utf8').trim()) {
      console.error('schwifly record: no browser actions were recorded.');
      return 1;
    }

    const { needsIntentLabel, parseCodegen } = await import('./record.js');
    let steps = parseCodegen(readFileSync(capture, 'utf8'));
    const opaque = steps.filter(needsIntentLabel).length;
    if (opaque) {
      const { llmConfigFromEnv } = await import('./llm.js');
      if (llmConfigFromEnv()) {
        try {
          const { labelRecordedIntents } = await import('./recordLabel.js');
          steps = await labelRecordedIntents(steps);
        } catch (error) {
          console.warn(`schwifly record: optional intent labeling failed: ${redact(String(error))}`);
        }
      }
    }

    const { emit } = await import('./emit.js');
    const source = emit({ title, url, steps, assertions: [] });
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, source, { flag: 'wx' });
    console.log(`schwifly record: wrote ${out}`);
    return 0;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf('--root');
  if (rootIndex !== -1) {
    const root = args[rootIndex + 1];
    if (!root || root.startsWith('--')) throw new Error('--root needs a directory');
    process.chdir(resolve(root));
    args.splice(rootIndex, 2);
  }
  process.env.SCHWIFLY_ROOT = process.cwd();
  // Auto-load the ignored local env once. Callers never need to put keys on the command line.
  if (existsSync('.env')) process.loadEnvFile('.env');

  const cmd = args[0];
  if (cmd === 'init') {
    const { initialize } = await import('./init.js');
    initialize(parseCommand(args.slice(1), []).positionals);
    return 0;
  }
  if (args.includes('--help')) { console.log(USAGE); return 0; }
  if (cmd === 'gen') return gen(args.slice(1));
  if (cmd === 'attempt') return attempt(args.slice(1));
  if (cmd === 'rebuild') return rebuild(args.slice(1));
  if (cmd === 'record') return record(args.slice(1));
  if (cmd === 'run') return runWorkflows(args.slice(1));
  console.log(USAGE);
  return cmd ? 1 : 0;
}

const code = await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`schwifly: ${redact(message)}`);
  return 1;
});
process.exit(code);
