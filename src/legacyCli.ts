import { UsageError } from './cliOutput.js';
import { loadStory } from './story.js';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { applyHeal, type HealRecord, type StepResult } from './workflow.js';
import {
  buildVerdicts,
  exitCode,
  successfulHeals,
  type PwReport,
} from './report.js';
import { clearRunLogs, HEAL_LOG, readRunLogs, STEP_LOG } from './runLogs.js';
import { runPlaywright } from './playwrightProcess.js';
import { redact } from './secrets.js';
import { PROOF_LOG } from './proofLogs.js';
import type { ProofRecord } from './proofs.js';

let messages: string[] = [];
let facts: unknown[] = [];
function say(...parts: unknown[]) { messages.push(parts.map(String).join(' ')); }

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
  '  schwifly install-browser [--with-deps]\n' +
  '  schwifly suite [stories-directory] [--id <id,id>] [--json]\n' +
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
    if (!values.has(name)) throw new UsageError(`unknown option: --${name}`);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) throw new UsageError(`--${name} needs a value`);
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
    throw new UsageError(`invalid URL: ${value}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UsageError(`URL must use http or https: ${value}`);
  }
  if (url.username || url.password || redact(value) !== value) {
    throw new UsageError('URL must not contain credentials or configured secrets');
  }
  return value;
}

// Limit CLI-generated outputs to workflows to prevent path traversal and code overwrite.
function workflowOutput(requested: string): string {
  const absolute = resolve(requested);
  const rel = relative(process.cwd(), absolute).replaceAll(sep, '/');
  if (!/^workflows\/[^/]+\.spec\.ts$/.test(rel)) {
    throw new UsageError('output must be workflows/<name>.spec.ts');
  }
  const parent = dirname(absolute);
  if (existsSync(parent)) {
    const realRoot = realpathSync(process.cwd());
    const realParent = realpathSync(parent);
    const fromRoot = relative(realRoot, realParent);
    if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
      throw new UsageError('workflows directory must stay inside the current workspace');
    }
  }
  if (existsSync(absolute)) throw new UsageError(`output already exists: ${rel}`);
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

function workflowFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  if (statSync(path).isFile()) return path.endsWith('.spec.ts') ? [path] : [];
  return readdirSync(path, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? workflowFiles(join(path, entry.name))
      : entry.isFile() && entry.name.endsWith('.spec.ts') ? [join(path, entry.name)] : []).sort();
}

const STORY_MARKER = /^\/\/ Schwifly story:(.*)$/m;

function hasStoryMarker(file: string): boolean {
  try { return STORY_MARKER.test(readFileSync(file, 'utf8')); }
  catch { return true; } // An unreadable file is never eligible for legacy write-back.
}

function storyForWorkflow(file: string): string | undefined {
  const match = STORY_MARKER.exec(readFileSync(file, 'utf8'));
  if (!match) return undefined;
  const story: unknown = JSON.parse(match[1]);
  if (typeof story !== 'string' || !story.endsWith('.story.yaml')) throw new Error('invalid story marker in workflow');
  const loaded = loadStory(story);
  if (loaded.routeFile !== resolve(file)) throw new Error('workflow story marker does not match its authoritative route');
  return loaded.file;
}

async function runWorkflows(args: string[]): Promise<number> {
  if (args[0]?.endsWith('.story.yaml')) {
    const input = parseCommand(args, ['workers'], ['json']);
    if (input.positionals.length !== 1) throw new Error('run needs exactly one story file');
    const { runStory } = await import('./storyAttempt.js');
    const result = await runStory({ file: input.positionals[0] });
    if (input.flags.json) say(JSON.stringify(result.report));
    else reportStoryCommand('run', result);
    return result.ok ? 0 : 1;
  }
  const hasTarget = args[0] !== undefined && !args[0].startsWith('-');
  const target = hasTarget ? args[0] : 'workflows/';
  const playwrightArgs = hasTarget ? args.slice(1) : args;
  const files = workflowFiles(resolve(target));
  const backed = files.map(file => {
    try { return { file, story: storyForWorkflow(file) }; }
    catch (error) { return { file, error }; }
  });
  if (backed.some(item => item.story || item.error)) {
    if (playwrightArgs.some(arg => arg !== '--workers=1' && arg !== '--json')) {
      throw new Error('story-backed runs accept --json and --workers=1; use suite for story selection');
    }
    if (files.length > 1 && playwrightArgs.includes('--json')) throw new Error('use schwifly suite --json for aggregate results');
    let failed = false;
    for (const item of backed) {
      if (item.error) {
        const { reportOperation } = await import('./result.js');
        const result = await reportOperation({ file: item.file }, async () => { throw item.error; });
        if (playwrightArgs.includes('--json')) say(JSON.stringify(result.report));
        else reportStoryCommand('run', result);
        failed = true;
        continue;
      }
      const code = await runWorkflows([item.story ?? item.file, ...playwrightArgs.filter(arg => arg !== '--workers=1')]);
      failed ||= code !== 0;
      if (process.exitCode === 1) break;
    }
    return failed ? 1 : 0;
  }

  // No stale evidence may survive into this verdict.
  clearRunLogs(HEAL_LOG);
  clearRunLogs(STEP_LOG);
  clearRunLogs(PROOF_LOG);
  rmSync(REPORT, { force: true });

  const runner = await runPlaywright(['test', target, ...playwrightArgs.filter(arg => arg !== '--json')], { stdio: ['inherit', 2, 2] });
  const report: PwReport = existsSync(REPORT)
    ? JSON.parse(readFileSync(REPORT, 'utf8')) as PwReport
    : { suites: [], errors: [] };
  const heals = readRunLogs<HealRecord>(HEAL_LOG);
  const steps = readRunLogs<StepResult>(STEP_LOG);
  const proofs = readRunLogs<ProofRecord>(PROOF_LOG);
  const verdicts = buildVerdicts(report, heals, steps);


  const failedProofs = proofs.filter((proof) => proof.status !== 'pass');
  if (failedProofs.length) {
    say('Proof failures:');
    for (const proof of failedProofs) {
      say(`  ${proof.storyId}/${proof.clauseId}: ${proof.status}: ${redact(proof.message)}`);
    }
    say('');
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
  const safe = eligible.filter((heal) => insideWorkspace(heal.file) && !hasStoryMarker(heal.file));
  let updated = 0;
  for (const heal of safe) if (applyHeal(heal)) updated++;
  if (heals.length) {
    const withheld = heals.length - safe.length;
    say(`schwifly: applied ${updated}/${safe.length} successful heal(s); withheld ${withheld}.`);
  }

  const verdictExit = exitCode(verdicts);
  const writeBackFailed = updated !== safe.length || (verdictExit === 0 && safe.length !== heals.length);
  const code = runner.status !== 0 || writeBackFailed || failedProofs.length ? 1 : verdictExit;
  facts.push({ status: code === 0 ? 'passed' : 'failed', total: verdicts.length, workflows: verdicts.map(({ file, title, state }) => ({ file, title, state })), healsApplied: updated, failedProofs });
  return code;
}

async function gen(argv: string[]): Promise<number> {
  const input = parseCommand(argv, ['url', 'out', 'title']);
  const story = input.positionals[0];
  const rawUrl = stringFlag(input, 'url');
  if (input.positionals.length !== 1 || !story || !rawUrl) {
    say('usage: schwifly gen "<story>" --url <start> [--out workflows/<name>.spec.ts]');
    return 1;
  }
  const url = webUrl(rawUrl);
  const title = stringFlag(input, 'title') ?? 'generated workflow';
  const out = workflowOutput(stringFlag(input, 'out') ?? `workflows/${slugify(title)}.spec.ts`);

  const { hasModelKey } = await import('./llm.js');
  if (!hasModelKey()) {
    say('schwifly gen needs an LLM key (OPENROUTER_API_KEY) to discover locators live.');
    return 1;
  }
  const { generate } = await import('./generate.js');
  const spec = await generate({ title, story, url });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, spec, { flag: 'wx' });
  facts.push({ status: 'generated', saved: out });
  return 0;
}

async function attempt(argv: string[]): Promise<number> {
  const input = parseCommand(argv, ['url', 'out', 'title'], ['visible', 'json']);
  const ticket = input.positionals[0];
  if (input.positionals.length === 1 && ticket?.endsWith('.story.yaml')) {
    if (input.flags.url || input.flags.out || input.flags.title) {
      say('schwifly attempt: a story file owns its URL, title, and route; remove --url, --title, and --out.');
      return 1;
    }
    const { attemptStory } = await import('./storyAttempt.js');
    const result = await attemptStory({ file: ticket, visible: input.flags.visible === true });
    if (input.flags.json) { say(JSON.stringify(result.report)); return result.ok ? 0 : 1; }
    return reportStoryCommand('attempt', result);
  }
  const rawUrl = stringFlag(input, 'url');
  if (input.positionals.length !== 1 || !ticket || !rawUrl) {
    say(
      'usage: schwifly attempt "<ticket>" --url <start> ' +
      '[--out workflows/<name>.spec.ts] [--visible]',
    );
    return 1;
  }
  const url = webUrl(rawUrl);
  const title = redact(stringFlag(input, 'title') ?? ticket.slice(0, 60));
  const out = workflowOutput(stringFlag(input, 'out') ?? `workflows/${slugify(title)}.spec.ts`);

  const { hasModelKey } = await import('./llm.js');
  if (!hasModelKey()) {
    say('schwifly attempt needs an LLM key (OPENROUTER_API_KEY) to run the agent attempt.');
    return 1;
  }
  const { attemptFlow } = await import('./attempt.js');
  const res = await attemptFlow({ ticket, url, title, out, visible: input.flags.visible === true });
  if (res.contract) {
    say(`schwifly attempt: outcome contract (${res.contract.source}): ${res.contract.summary}`);
    for (const check of res.contract.checks) say(`  must hold: ${check.intent}`);
  }
  if (!res.ok) {
    say(`schwifly attempt: FAILED: ${res.reason}. No workflow saved.`);
    return 1;
  }
  facts.push({ status: 'certified', saved: res.saved, contract: res.contract });
  return 0;
}

function reportStoryCommand(command: 'attempt' | 'rebuild' | 'run', result: import('./storyAttempt.js').StoryCommandResult): number {
  facts.push({ ...result.report, result: result.resultPath, ...(result.unchanged ? { unchanged: true } : {}) });
  if (result.resultPath) say(`result: ${result.resultPath}`);
  if (!result.ok) {
    say(`schwifly ${command}: FAILED: ${result.reason}`);
    if (result.certification?.routeFailures.length) {
      say('Route failures:');
      for (const failure of result.certification.routeFailures) say(`  ${failure}`);
    }
    if (result.certification?.proofFailures.length) {
      say('Proof failures:');
      for (const failure of result.certification.proofFailures) say(`  ${failure}`);
    }
    return 1;
  }
  if (command === 'run') say(`schwifly run: certified ${result.saved}`);
  else if (result.unchanged) say(`schwifly ${command}: route is already green; preserved ${result.saved}`);
  else say(`schwifly ${command}: certified route written to ${result.saved}`);
  return 0;
}

async function rebuild(argv: string[]): Promise<number> {
  const input = parseCommand(argv, [], ['visible', 'json']);
  const file = input.positionals[0];
  if (input.positionals.length !== 1 || !file?.endsWith('.story.yaml')) {
    say('usage: schwifly rebuild stories/<name>.story.yaml [--visible]');
    return 1;
  }
  const { rebuildStory } = await import('./storyAttempt.js');
  const result = await rebuildStory({ file, visible: input.flags.visible === true });
  if (input.flags.json) { say(JSON.stringify(result.report)); return result.ok ? 0 : 1; }
  return reportStoryCommand('rebuild', result);
}

async function record(argv: string[]): Promise<number> {
  const input = parseCommand(argv, ['out', 'from']);
  const rawUrl = input.positionals[0];
  if (input.positionals.length !== 1 || !rawUrl) {
    say('usage: schwifly record <url> [--out workflows/<name>.spec.ts]');
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
      say('schwifly record: complete the flow in the Playwright browser, then close it.');
      const runner = await runPlaywright(
        ['codegen', '--target', 'playwright-test', '-o', capture, url],
        { stdio: ['inherit', 2, 2] },
      );
      if (runner.error) throw runner.error;
      if (runner.status !== 0) {
        say(`schwifly record: Playwright codegen exited ${runner.status ?? runner.signal}.`);
        return 1;
      }
    }
    if (!existsSync(capture) || !readFileSync(capture, 'utf8').trim()) {
      say('schwifly record: no browser actions were recorded.');
      return 1;
    }

    const { needsIntentLabel, parseCodegen } = await import('./record.js');
    let steps = parseCodegen(readFileSync(capture, 'utf8'));
    const opaque = steps.filter(needsIntentLabel).length;
    if (opaque) {
      const { hasModelKey } = await import('./llm.js');
      if (hasModelKey()) {
        try {
          const { labelRecordedIntents } = await import('./recordLabel.js');
          steps = await labelRecordedIntents(steps);
        } catch (error) {
          say(`schwifly record: optional intent labeling failed: ${redact(String(error))}`);
        }
      }
    }

    const { emit } = await import('./emit.js');
    const source = emit({ title, url, steps, assertions: [] });
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, source, { flag: 'wx' });
    facts.push({ status: 'recorded', saved: out });
    return 0;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main(args: string[]): Promise<number> {
  const cmd = args[0];
  if (cmd === 'install-browser') {
    const input = parseCommand(args.slice(1), [], ['with-deps']);
    if (input.positionals.length) throw new Error('install-browser accepts only --with-deps');
    const result = await runPlaywright(['install', 'chromium', ...(input.flags['with-deps'] ? ['--with-deps'] : [])], { stdio: ['inherit', 2, 2] });
    return result.status === 0 ? 0 : 1;
  }
  if (cmd === 'init') {
    const { initialize } = await import('./init.js');
    initialize(parseCommand(args.slice(1), []).positionals);
    return 0;
  }
  if (args.includes('--help')) { say(USAGE); return 0; }
  if (cmd === 'suite') {
    const input = parseCommand(args.slice(1), ['id'], ['json']);
    if (input.positionals.length > 1) throw new Error('suite accepts one story directory');
    const { runSuite } = await import('./suite.js');
    const result = await runSuite({ directory: input.positionals[0], ids: stringFlag(input, 'id')?.split(',') });
    if (input.flags.json) say(JSON.stringify(result));
    else {
      facts.push({ ...result.summary, stories: result.results.map(({ storyId, status, phase }) => ({ id: storyId, status, phase })), result: result.resultPath });
      say(`stories[${result.results.length}]{id,status,phase}:`);
      for (const story of result.results) say(`  ${JSON.stringify(story.storyId)},${story.status},${story.phase}`);
      say(`result: ${result.resultPath}`);
    }
    return result.ok ? 0 : 1;
  }
  if (cmd === 'gen') return gen(args.slice(1));
  if (cmd === 'attempt') return attempt(args.slice(1));
  if (cmd === 'rebuild') return rebuild(args.slice(1));
  if (cmd === 'record') return record(args.slice(1));
  if (cmd === 'run') return runWorkflows(args.slice(1));
  say(USAGE);
  return cmd ? 1 : 0;
}

export async function legacyCommand(args: string[]) {
  messages = [];
  facts = [];
  const code = await main(args);
  const detail = messages.join('\n');
  if (args.includes('--json') && messages.length === 1) {
    try { return { code, data: JSON.parse(detail) }; } catch { /* Non-story commands use the same structured envelope. */ }
  }
  const data = facts.length === 1 ? facts[0] : facts.length ? { status: code === 0 ? 'passed' : 'failed', results: facts }
    : code ? { error: detail, help: detail.includes('key') ? 'schwifly setup --models <provider/model> --key-stdin' : `schwifly ${args[0]} --help` }
    : { status: 'passed', ...(detail ? { detail } : {}) };
  return { code, data };
}
