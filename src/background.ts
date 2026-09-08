import { randomUUID } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { workspacePath } from './oneOff.js';
import { redact } from './secrets.js';
import { UsageError } from './cliOutput.js';

export interface BackgroundRun {
  version: 1;
  id: string;
  status: 'queued' | 'running' | 'passed' | 'failed';
  instruction: string;
  created: string;
  pid?: number;
  session?: string;
  reason?: string;
  result?: unknown;
}
export function managedId(id: string): string {
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id)) throw new UsageError('invalid ID; use schwifly runs or schwifly session list');
  return id;
}
export const backgroundDirectory = (id: string) => workspacePath(`.schwifly/background/${managedId(id)}`);
export function atomicJson(file: string, value: unknown) {
  file = workspacePath(file);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = workspacePath(`${file}.${randomUUID()}.tmp`);
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  renameSync(temporary, file);
}
export function alive(pid?: number) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}
export function writeBackground(run: BackgroundRun) {
  atomicJson(`${backgroundDirectory(run.id)}/result.json`, redact(run));
}
export function createBackground(instruction: string, session?: string): BackgroundRun {
  const run: BackgroundRun = { version: 1, id: randomUUID(), status: 'queued', instruction: redact(instruction), created: new Date().toISOString(), session };
  writeBackground(run);
  progress(run.id, 'Queued. You can continue coding. Progress is written to this file.');
  return run;
}
export function progress(id: string, message: string) {
  appendFileSync(workspacePath(`${backgroundDirectory(id)}/progress.log`), `${new Date().toISOString()} ${redact(message)}\n`, { mode: 0o600 });
}
export function readBackground(id: string): BackgroundRun {
  const run = JSON.parse(readFileSync(workspacePath(`${backgroundDirectory(id)}/result.json`), 'utf8')) as BackgroundRun;
  if (run.version !== 1 || run.id !== id) throw new Error('invalid background run record');
  if (['queued', 'running'].includes(run.status) && !alive(run.pid) && Date.now() - Date.parse(run.created) > 5000) {
    return { ...run, status: 'failed', reason: 'run process stopped before writing a result' };
  }
  return run;
}
export function listBackground(): BackgroundRun[] {
  const dir = workspacePath('.schwifly/background');
  return existsSync(dir) ? readdirSync(dir).map(readBackground).sort((a, b) => b.created.localeCompare(a.created)) : [];
}
export const hasBackground = (id: string) => existsSync(workspacePath(`${backgroundDirectory(id)}/result.json`));
export const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
export function receipt(run: BackgroundRun) {
  const root = ` --root ${shellQuote(process.cwd())}`;
  const log = workspacePath(`${backgroundDirectory(run.id)}/progress.log`);
  return { id: run.id, status: run.status, ...(run.session ? { session: run.session } : {}), log: relative(process.cwd(), log),
    help: [`schwifly status ${run.id}${root}`, `schwifly show ${run.id}${root}`, `tail -f ${shellQuote(log)}`] };
}
export function detach(module: string, id: string, log: string) {
  const fd = openSync(workspacePath(log), 'a', 0o600);
  try {
    const child = spawn(process.execPath, [fileURLToPath(new URL(`../dist/${module.replace(/^\.\//, '')}`, import.meta.url)), id], {
      cwd: process.cwd(), env: process.env, detached: true, stdio: ['ignore', fd, fd],
    });
    child.on('error', () => {});
    child.unref();
    if (!child.pid) throw new Error('could not start background process');
    return child.pid;
  } finally { closeSync(fd); }
}
export function startBackground(argv: string[]) {
  const run = createBackground(argv.filter(arg => arg !== '--json').join(' '));
  atomicJson(`${backgroundDirectory(run.id)}/request.json`, argv);
  run.pid = detach('./backgroundWorker.js', run.id, `${backgroundDirectory(run.id)}/progress.log`);
  writeBackground(run);
  process.stderr.write('Running in the background. You can continue coding. Progress goes to the returned log file.\n');
  return receipt(run);
}
