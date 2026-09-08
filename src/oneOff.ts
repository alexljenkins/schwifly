import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AttemptOptions } from './attempt.js';
import type { StepResult } from './workflow.js';
import { redact } from './secrets.js';
import { UsageError } from './cliOutput.js';

export interface RunRecord {
  version: 1;
  id: string;
  status: 'running' | 'certified' | 'failed';
  instruction: string;
  url: string;
  model: string;
  created: string;
  reason?: string;
  candidateHash?: string;
  artifacts: Array<{ label: string; path: string }>;
}

const hash = (source: string) => createHash('sha256').update(source).digest('hex');

/** Resolve managed files through real ancestors, rejecting symlink escapes before writing. */
export function workspacePath(path: string, root = process.cwd()): string {
  const base = realpathSync(root);
  const target = resolve(base, path);
  let parent = target;
  while (!existsSync(parent) && dirname(parent) !== parent) {
    try {
      if (lstatSync(parent).isSymbolicLink()) throw new UsageError('managed path contains a dangling symlink');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    parent = dirname(parent);
  }
  const resolved = resolve(realpathSync(parent), relative(parent, target));
  const rel = relative(base, resolved);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw new UsageError('path must stay inside the workspace');
  return target;
}

export function runDirectory(id: string): string {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new UsageError('invalid run ID; use schwifly runs');
  return workspacePath(`.schwifly/runs/${id}`);
}

export function readRun(id: string): RunRecord {
  const value = JSON.parse(readFileSync(workspacePath(`${runDirectory(id)}/result.json`), 'utf8')) as RunRecord;
  if (value.version !== 1 || value.id !== id || !['running', 'certified', 'failed'].includes(value.status) ||
      typeof value.instruction !== 'string' || !Array.isArray(value.artifacts)) throw new Error('invalid run record');
  return value;
}

export function listRuns(): RunRecord[] {
  const directory = workspacePath('.schwifly/runs');
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory())
    .map(entry => readRun(entry.name)).sort((a, b) => b.created.localeCompare(a.created));
}

export function workflowPath(name: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 80) {
    throw new UsageError('--name/--save must use lowercase words separated by hyphens, at most 80 characters');
  }
  return workspacePath(`workflows/${name}.spec.ts`);
}

/** Only the temporary replay copy binds to this installation. Saved workflows stay portable. */
export async function certifySource(source: string, directory: string): Promise<boolean> {
  const { runPlaywright } = await import('./playwrightProcess.js');
  const { clearRunLogs, readRunLogs, STEP_LOG } = await import('./runLogs.js');
  const { replayGreen } = await import('./attempt.js');
  const runtime = new URL('../dist/', import.meta.url);
  const candidateDir = workspacePath('candidates');
  mkdirSync(candidateDir, { recursive: true });
  const file = resolve(candidateDir, `${randomUUID()}.spec.mts`);
  const bound = source.replace(/from 'schwifly\/([A-Za-z]+)'/g,
    (_, name: string) => `from ${JSON.stringify(fileURLToPath(new URL(`${name}.js`, runtime)))}`);
  writeFileSync(file, bound, { flag: 'wx' });
  clearRunLogs(STEP_LOG);
  try {
    const runner = await runPlaywright(['test', file, '--config', fileURLToPath(new URL('runnerConfig.js', runtime)), '--project=candidate'], {
      stdio: 'pipe', env: { ...process.env, SCHWIFLY_NO_HEAL: '1' },
    });
    const steps = readRunLogs<StepResult>(STEP_LOG).filter(step => step.file === file);
    writeFileSync(resolve(directory, `replay-${randomUUID()}.json`), JSON.stringify(redact({ status: runner.status, steps }), null, 2) + '\n');
    if (runner.status !== 0) process.stderr.write(redact(runner.stderr).slice(-3000));
    return replayGreen(runner.status ?? 1, steps);
  } finally { rmSync(file, { force: true }); }
}

export async function oneOff(options: {
  instruction: string; url: string; model: string; screenshots?: boolean; visible?: boolean;
  maxSteps?: number; save?: string;
}, seams: Pick<AttemptOptions, 'discover' | 'resolveContract' | 'replay'> = {}): Promise<RunRecord & { saved?: string }> {
  const destination = options.save ? workflowPath(options.save) : undefined;
  if (destination && existsSync(destination)) throw new UsageError('workflow already exists; choose another --save name');
  const id = randomUUID();
  const directory = runDirectory(id);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const candidate = resolve(directory, 'candidate.spec.ts');
  const record: RunRecord = {
    version: 1, id, status: 'running', instruction: redact(options.instruction), url: redact(options.url),
    model: options.model, created: new Date().toISOString(), artifacts: [],
  };
  writeFileSync(resolve(directory, 'result.json'), JSON.stringify(record) + '\n', { flag: 'wx' });
  let saved: string | undefined;
  try {
    const { attemptFlow } = await import('./attempt.js');
    const result = await attemptFlow({
      ticket: options.instruction, url: options.url, title: options.save ?? options.instruction.slice(0, 80),
      candidateFile: candidate, visible: options.visible, maxSteps: options.maxSteps, ...seams,
      replay: seams.replay ?? (file => certifySource(readFileSync(file, 'utf8'), directory)),
      onCheckpoint: options.screenshots ? async (page, label) => {
        const { captureFailure } = await import('./evidence.js');
        const path = resolve(directory, `${record.artifacts.length}-${label}.png`);
        if (!await captureFailure(page, undefined, path)) throw new Error('screenshot capture failed');
        record.artifacts.push({ label, path: relative(process.cwd(), path) });
      } : undefined,
    });
    record.status = result.ok ? 'certified' : 'failed';
    record.reason = result.reason;
    if (result.ok && result.candidate) {
      record.candidateHash = hash(result.candidate);
      if (destination) {
        mkdirSync(dirname(destination), { recursive: true });
        writeFileSync(destination, result.candidate, { flag: 'wx' });
        saved = relative(process.cwd(), destination);
      }
    }
  } catch (error) {
    record.status = 'failed';
    record.reason = redact(error instanceof Error ? error.message : 'browser run failed');
  }
  const completed = resolve(directory, 'completed.json');
  writeFileSync(completed, JSON.stringify(redact(record), null, 2) + '\n', { flag: 'wx' });
  renameSync(completed, resolve(directory, 'result.json'));
  return { ...record, ...(saved ? { saved } : {}) };
}

export async function saveRun(id: string, name: string, replay = certifySource) {
  const record = readRun(id);
  if (record.status !== 'certified' || !record.candidateHash) throw new Error('run is not certified; repeat schwifly run with a clear expected outcome');
  const directory = runDirectory(id);
  const source = readFileSync(workspacePath(`${directory}/candidate.spec.ts`), 'utf8');
  if (hash(source) !== record.candidateHash) throw new Error('candidate changed after certification; repeat schwifly run');
  const destination = workflowPath(name);
  if (existsSync(destination)) {
    if (readFileSync(destination, 'utf8') === source) return { saved: relative(process.cwd(), destination), status: 'unchanged' };
    throw new UsageError('workflow already exists with different content; choose another --name');
  }
  if (!await replay(source, directory)) throw new Error('fresh replay failed; workflow was not saved');
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, source, { flag: 'wx' });
  return { saved: relative(process.cwd(), destination), status: 'saved' };
}
