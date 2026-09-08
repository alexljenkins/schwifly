import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs, format } from 'node:util';
import { commands, description, globals, guidance, help } from './cliGuide.js';
import { output, preview, UsageError } from './cliOutput.js';
import { readSettings, saveSettings, selectedModel, validModel } from './settings.js';
import { redact } from './secrets.js';

const version = () => JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string;
type Flags = Record<string, string | boolean | undefined>;

function parse(argv: string[]) {
  const args = [...argv];
  const prefix: string[] = [];
  while (args[0]?.startsWith('-')) {
    const token = args.shift()!;
    prefix.push(token);
    if (token === '--root') {
      if (!args[0] || args[0].startsWith('-')) throw new UsageError('--root needs a directory');
      prefix.push(args.shift()!);
    } else if (!(token.startsWith('--root=') || ['--json', '--full', '--help', '--version', '-v', '-V'].includes(token))) {
      throw new UsageError(`unknown flag ${token}; valid global flags: ${Object.keys(globals).map(flag => '--' + flag).join(', ')}`);
    }
  }
  const command = args.shift();
  if (command && !commands[command]) throw new UsageError(`unknown command ${command}; commands: ${Object.keys(commands).join(', ')}`);
  const spec = command ? commands[command] : undefined;
  const options: Record<string, { type: 'string' | 'boolean' }> = {};
  for (const key of ['root', ...Object.keys(spec?.values ?? {})]) options[key] = { type: 'string' };
  for (const key of ['json', 'full', 'help', 'version', ...Object.keys(spec?.booleans ?? {})]) options[key] = { type: 'boolean' };
  let parsed;
  try {
    let terminated = false;
    const normalized = [...prefix, ...args].map(arg => {
      if (arg === '--') terminated = true;
      return !terminated && ['-v', '-V'].includes(arg) ? '--version' : arg;
    });
    parsed = parseArgs({ args: normalized, options, strict: true, allowPositionals: true, tokens: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid arguments';
    throw new UsageError(`${message}; valid flags for ${command ?? 'schwifly'}: ${Object.keys(options).map(flag => '--' + flag).join(', ')}`);
  }
  const seen = new Set<string>();
  for (const token of parsed.tokens) {
    if (token.kind !== 'option') continue;
    if (seen.has(token.name)) throw new UsageError(`duplicate flag --${token.name}; supply it once`);
    seen.add(token.name);
  }
  const flags = parsed.values as Flags;
  for (const [name, value] of Object.entries(flags)) {
    if (typeof value === 'string' && !value.length) throw new UsageError(`--${name} needs a nonempty value`);
  }
  const positionals = parsed.positionals;
  if (!flags.help && !flags.version && spec && (positionals.length < (spec.min ?? 0) || positionals.length > (spec.max ?? 0))) {
    throw new UsageError(`usage: schwifly ${command} ${spec.args}`);
  }
  return { command, flags, positionals };
}

export function webUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new UsageError('invalid URL; use an http or https URL'); }
  if (!['https:', 'http:'].includes(url.protocol)) throw new UsageError('URL must use http or https');
  if (url.username || url.password || redact(value) !== value) throw new UsageError('URL must not contain credentials');
  return value;
}

async function stdin(limit: number): Promise<string> {
  if (process.stdin.isTTY) throw new UsageError('stdin is required; pipe input instead of using an interactive prompt');
  const chunks: Buffer[] = [];
  let size = 0;
  const timer = setTimeout(() => process.stdin.destroy(new Error('stdin timed out')), 5000);
  try {
    for await (const chunk of process.stdin) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > limit) throw new UsageError(`stdin exceeds ${limit} bytes`);
      chunks.push(bytes);
    }
    return Buffer.concat(chunks).toString('utf8').trim();
  } finally { clearTimeout(timer); }
}

function fields(rows: object[], requested: string | undefined, defaults: string[], allowed: string[]) {
  const names = requested?.split(',') ?? defaults;
  if (!names.length || names.some(name => !allowed.includes(name))) throw new UsageError(`valid --fields: ${allowed.join(',')}`);
  return rows.map(row => Object.fromEntries(names.map(name => [name, (row as Record<string, unknown>)[name] ?? null])));
}

async function savedTests() {
  const { workspacePath } = await import('./oneOff.js');
  const rows: Array<{ path: string; kind: string; name: string }> = [];
  const walk = (directory: string) => {
    const path = workspacePath(directory);
    if (!existsSync(path)) return;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile() && /(?:\.spec\.ts|\.story\.yaml)$/.test(entry.name)) {
        rows.push({ path: child, kind: entry.name.endsWith('.yaml') ? 'story' : 'workflow', name: entry.name.replace(/\.(spec\.ts|story\.yaml)$/, '') });
      }
    }
  };
  walk('workflows'); walk('stories');
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

async function home() {
  const { listRuns, workspacePath } = await import('./oneOff.js');
  const runs = listRuns();
  let previousSession: string | undefined;
  try {
    const value = JSON.parse(readFileSync(workspacePath('.schwifly/session.json'), 'utf8'));
    if (typeof value.at === 'string' && Number.isFinite(Date.parse(value.at))) previousSession = value.at;
  } catch { /* Optional session context does not replace authoritative run records. */ }
  const tests = await savedTests();
  const settings = readSettings();
  const executable = realpathSync(process.argv[1]);
  return {
    bin: executable.startsWith(homedir() + '/') ? '~' + executable.slice(homedir().length) : executable,
    description, root: process.cwd(), credential: settings?.credential ? 'stored in OS credential store' : process.env.OPENROUTER_API_KEY ? 'environment' : 'not configured',
    model: process.env.SCHWIFLY_MODEL ?? settings?.model ?? 'package default',
    tests: tests.length ? tests.slice(0, 5) : '0 saved tests in this workspace', totalTests: tests.length,
    runs: runs.length ? fields(runs.slice(0, 3), undefined, ['id', 'status', 'created'], ['id', 'status', 'created']) : '0 one-off runs in this workspace', totalRuns: runs.length,
    ...(previousSession ? { lastSession: previousSession, runsSinceSession: runs.filter(run => run.created > previousSession!).length } : {}),
    help: [...guidance.slice(0, 1), ...(runs.length ? ['schwifly show <id>'] : []), ...(tests.length > 5 ? ['schwifly list'] : []), ...(runs.length > 3 ? ['schwifly runs'] : []), ...(!settings?.credential && !process.env.OPENROUTER_API_KEY ? ['schwifly setup --models <provider/model> --key-stdin'] : [])],
  };
}

async function setup(flags: Flags) {
  const current = readSettings();
  const models = flags.models ? String(flags.models).split(',') : current?.models;
  const model = String(flags.model ?? (flags.models ? models?.[0] : current?.model) ?? '');
  if (flags.models || flags.model || flags['key-stdin']) {
    if (!models?.length || models.some(value => !validModel(value)) || new Set(models).size !== models.length || !models.includes(model)) {
      throw new UsageError('provide unique --models <provider/model,...> and choose --model from that set');
    }
  }
  if (flags.agent && !['claude', 'codex', 'opencode', 'all'].includes(String(flags.agent))) throw new UsageError('--agent must be claude, codex, opencode, or all');
  const key = flags['key-stdin'] ? await stdin(16384) : undefined;
  if (key !== undefined && (!key || /\s/.test(key))) throw new UsageError('stdin must contain one nonempty provider key');
  if (flags.models || flags.model || flags['key-stdin']) saveSettings({ version: 1, models: models!, model, credential: key !== undefined || current?.credential === true }, key);
  let integration: unknown;
  if (flags.agent || flags.skill) {
    const { installIntegration } = await import('./integration.js');
    integration = installIntegration(flags.agent ? String(flags.agent) : undefined, flags.skill === true);
  }
  const settings = readSettings();
  return { status: 'configured', models: settings?.models ?? [], model: settings?.model ?? 'package default', credential: settings?.credential ? 'stored in OS credential store' : 'not stored', ...(integration ? { integration } : {}) };
}

async function locked<T>(action: () => Promise<T>): Promise<T> {
  const { workspacePath } = await import('./oneOff.js');
  const lock = workspacePath('.schwifly/browser.lock');
  mkdirSync(dirname(lock), { recursive: true });
  try { writeFileSync(lock, String(process.pid), { flag: 'wx' }); }
  catch { throw new Error('workspace browser is locked; wait for its run, or remove .schwifly/browser.lock after confirming its recorded process has stopped'); }
  const log = console.log;
  console.log = (...args: unknown[]) => process.stderr.write(redact(format(...args)) + '\n');
  try { return await action(); }
  finally { console.log = log; rmSync(lock, { force: true }); }
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let json = argv.includes('--json');
  let command: string | undefined;
  let flags: Flags = {};
  try {
    const input = parse(argv);
    ({ command, flags } = input);
    json = flags.json === true;
    const [target] = input.positionals;
    if (flags.version) { process.stdout.write(version() + '\n'); return 0; }
    if (flags.help) { output(help(command), json); return 0; }
    if (flags.root) process.chdir(resolve(String(flags.root)));
    process.env.SCHWIFLY_ROOT = process.cwd();
    process.env.SCHWIFLY_CLI = '1';
    let data: unknown;
    let code = 0;
    const scoped = (text: string) => flags.root ? `${text} --root ${JSON.stringify(process.cwd())}` : text;
    if (!command || (command === 'context' && !flags.end)) data = await home();
    else if (command === 'context') {
      const { listRuns, workspacePath } = await import('./oneOff.js');
      const file = workspacePath('.schwifly/session.json');
      const runs = listRuns();
      if (runs.length) {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), runs: runs.slice(0, 3).map(run => run.id) }) + '\n');
      }
      return 0;
    } else if (command === 'setup') data = await setup(flags);
    else if (command === 'runs' || command === 'list') {
      const limit = Number(flags.limit ?? 100);
      if (!Number.isSafeInteger(limit) || limit < 1) throw new UsageError('--limit must be a positive integer');
      const { listRuns } = await import('./oneOff.js');
      const runs = command === 'runs';
      const rows = runs ? listRuns() : await savedTests();
      const selected = fields(rows, flags.fields as string | undefined, runs ? ['id', 'status', 'created'] : ['path', 'kind', 'name'], runs ? ['id', 'status', 'instruction', 'created', 'url', 'model'] : ['path', 'kind', 'name']);
      data = { total: rows.length, [runs ? 'runs' : 'tests']: rows.length ? selected.slice(0, limit) : `0 ${runs ? 'one-off runs' : 'saved tests'} in this workspace`,
        help: [scoped(runs ? 'schwifly show <id>' : 'schwifly run <path>'), ...(rows.length > limit ? [scoped(`schwifly ${command} --limit ${rows.length}`)] : [])] };
    } else if (command === 'show') {
      const { readRun } = await import('./oneOff.js');
      const record = readRun(target);
      data = { ...record, evidence: `.schwifly/runs/${target}/`, instruction: preview(record.instruction, flags.full === true),
        ...(record.instruction.length > 1000 && !flags.full ? { help: [scoped(`schwifly show ${target} --full`)] } : {}) };
    } else if (command === 'save') {
      if (!flags.name) throw new UsageError('--name is required; use schwifly save <id> --name <name>');
      const { saveRun } = await import('./oneOff.js');
      if (existsSync('.env')) process.loadEnvFile('.env');
      data = await locked(() => saveRun(target, String(flags.name)));
    } else if (command === 'screenshot') {
      const url = webUrl(target);
      const { workspacePath } = await import('./oneOff.js');
      const file = workspacePath(String(flags.out ?? `.schwifly/evidence/${randomUUID()}.png`));
      if (!file.endsWith('.png')) throw new UsageError('--out must end in .png');
      if (existsSync(file)) throw new UsageError('screenshot output already exists; choose another --out');
      if (existsSync('.env')) process.loadEnvFile('.env');
      data = await locked(async () => {
        const previous = process.env.SCHWIFLY_NO_HEAL;
        process.env.SCHWIFLY_NO_HEAL = '1';
        const { openConfiguredSession } = await import('./session.js');
        const { captureFailure } = await import('./evidence.js');
        let session: Awaited<ReturnType<typeof openConfiguredSession>> | undefined;
        try {
          session = await openConfiguredSession({ url, phase: 'replay' });
          if (!await captureFailure(session.page, undefined, file)) throw new Error('screenshot capture failed');
          return { screenshot: relative(process.cwd(), file), url };
        } finally {
          await session?.close();
          if (previous === undefined) delete process.env.SCHWIFLY_NO_HEAL;
          else process.env.SCHWIFLY_NO_HEAL = previous;
        }
      });
    } else if (command === 'run' && (flags.url || flags['instruction-file'])) {
      if (!flags.url) throw new UsageError('--url is required for an instruction run');
      if (target && flags['instruction-file']) throw new UsageError('use an instruction argument or --instruction-file, not both');
      const url = webUrl(String(flags.url));
      const instruction = flags['instruction-file'] ? (flags['instruction-file'] === '-' ? await stdin(100000) : readFileSync(String(flags['instruction-file']), 'utf8').trim()) : target;
      if (!instruction?.trim() || instruction.length > 100000) throw new UsageError('provide an instruction of 1-100000 characters');
      const maxSteps = Number(flags['max-steps'] ?? 12);
      if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 12) throw new UsageError('--max-steps must be an integer from 1 to 12');
      if (flags.workers && flags.workers !== '1') throw new UsageError('--workers must be 1');
      const { oneOff, workflowPath } = await import('./oneOff.js');
      if (flags.save && existsSync(workflowPath(String(flags.save)))) throw new UsageError('workflow already exists; choose another --save name');
      if (existsSync('.env')) process.loadEnvFile('.env');
      if (flags.model) process.env.SCHWIFLY_MODEL = String(flags.model);
      const { hasModelKey, DEFAULT_MODEL } = await import('./llm.js');
      const model = selectedModel(DEFAULT_MODEL);
      if (!hasModelKey()) throw new Error('model credential missing; run schwifly setup --models <provider/model> --key-stdin');
      const record = await locked(() => oneOff({ instruction, url, model, maxSteps, save: flags.save as string | undefined, screenshots: flags.screenshots === true, visible: flags.visible === true }));
      code = record.status === 'certified' ? 0 : 1;
      data = { id: record.id, status: record.status, ...(record.reason ? { reason: record.reason } : {}), ...(record.saved ? { saved: record.saved } : {}), artifacts: record.artifacts,
        help: [scoped(`schwifly show ${record.id}`), ...(record.status === 'certified' && !record.saved ? [scoped(`schwifly save ${record.id} --name <name>`)] : [])] };
    } else {
      if (command === 'run' && ['save', 'screenshots', 'max-steps', 'visible'].some(flag => flags[flag])) throw new UsageError('instruction flags require --url; use schwifly run "<instruction>" --url <url>');
      if (command === 'run' && flags.workers && flags.workers !== '1') throw new UsageError('--workers must be 1');
      if (command === 'gen' && !flags.url) throw new UsageError('usage: schwifly gen "<instruction>" --url <url>');
      if (command === 'attempt' && !target.endsWith('.story.yaml') && !flags.url) throw new UsageError('instruction attempts require --url');
      if (command === 'rebuild' && !target.endsWith('.story.yaml')) throw new UsageError('rebuild requires a .story.yaml file');
      if (flags.model) process.env.SCHWIFLY_MODEL = String(flags.model);
      if (existsSync('.env')) process.loadEnvFile('.env');
      const legacyArgs = [command!, ...input.positionals];
      for (const [name, value] of Object.entries(flags)) {
        if (['root', 'full', 'help', 'version', 'model'].includes(name)) continue;
        if (name === 'json' && !['run', 'suite', 'attempt', 'rebuild'].includes(command!)) continue;
        if (value === true) legacyArgs.push(`--${name}`);
        else if (typeof value === 'string') legacyArgs.push(`--${name}`, value);
      }
      const result = await locked(async () => (await import('./legacyCli.js')).legacyCommand(legacyArgs));
      code = result.code;
      data = result.data;
      if (data && typeof data === 'object' && 'detail' in data && typeof data.detail === 'string') {
        const detail = data.detail;
        data = { ...data, detail: preview(detail, flags.full === true), ...(detail.length > 1000 && !flags.full ? { help: [scoped(`schwifly ${command} ${input.positionals.map(value => JSON.stringify(value)).join(' ')} --full`)] } : {}) };
      }
    }
    if ((!command || command === 'context') && data && typeof data === 'object' && 'help' in data && Array.isArray(data.help)) data.help = data.help.map(scoped);
    output(data, json);
    return code;
  } catch (error) {
    output({ error: error instanceof Error ? error.message : 'operation failed', help: error instanceof UsageError ? help(command) : `schwifly ${command ?? 'setup'} --help` }, json);
    return error instanceof UsageError ? 2 : 1;
  }
}

process.exitCode = await main();
