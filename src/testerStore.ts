import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { workspacePath, workflowPath } from './oneOff.js';
import { alive, atomicJson, backgroundDirectory, createBackground, detach, managedId, receipt, shellQuote, writeBackground } from './background.js';
import { UsageError } from './cliOutput.js';

export interface TesterRecord {
  version: 1; id: string; url: string; headless: boolean; created: string;
  status: 'starting' | 'ready' | 'busy' | 'stopped' | 'failed';
  pid?: number; debug?: string; currentRun?: string; reason?: string;
}
export type TesterOperation = 'ask' | 'baseline' | 'compare' | 'save' | 'reset' | 'stop';
export interface TesterRequest {
  id: string; operation: TesterOperation; instruction?: string; element?: string; padding?: number; name?: string;
}
export const testerDirectory = (id: string) => workspacePath(`.schwifly/testers/${managedId(id)}`);
export const writeTester = (record: TesterRecord) => atomicJson(`${testerDirectory(record.id)}/session.json`, record);
export function readTester(id: string): TesterRecord {
  const record = JSON.parse(readFileSync(workspacePath(`${testerDirectory(id)}/session.json`), 'utf8')) as TesterRecord;
  if (record.version !== 1 || record.id !== id) throw new Error('invalid tester record');
  if (!['stopped', 'failed'].includes(record.status) && !alive(record.pid) && Date.now() - Date.parse(record.created) > 5000) {
    return { ...record, status: 'failed', reason: 'tester process stopped; start a new session' };
  }
  return record;
}
export function listTesters() {
  const dir = workspacePath('.schwifly/testers');
  return existsSync(dir) ? readdirSync(dir).map(readTester) : [];
}
export function startTester(url: string, headless: boolean) {
  const record: TesterRecord = { version: 1, id: randomUUID(), url, headless, created: new Date().toISOString(), status: 'starting' };
  writeTester(record);
  atomicJson(`${testerDirectory(record.id)}/inbox/.keep`, {});
  record.pid = detach('./testerWorker.js', record.id, `${testerDirectory(record.id)}/progress.log`);
  writeTester(record);
  const root = ` --root ${shellQuote(process.cwd())}`;
  return { session: record.id, status: record.status, log: `${testerDirectory(record.id)}/progress.log`,
    help: [`schwifly session status ${record.id}${root}`, `schwifly session ask ${record.id} "<check>"${root}`, `schwifly session stop ${record.id}${root}`] };
}
export function submitTester(id: string, input: Omit<TesterRequest, 'id'>) {
  const session = readTester(id);
  if (input.operation === 'stop' && ['stopped', 'failed'].includes(session.status)) return { session: id, status: session.status };
  if (['stopped', 'failed'].includes(session.status)) throw new Error('tester is stopped; use schwifly session start --url <url>');
  if (input.operation === 'ask' && (!input.instruction?.trim() || input.instruction.length > 100000)) throw new UsageError('provide a check of 1-100000 characters');
  if (input.padding !== undefined && (!Number.isInteger(input.padding) || input.padding < 0 || input.padding > 200)) throw new UsageError('--padding must be an integer from 0 to 200');
  if (input.operation === 'save') {
    if (!input.name) throw new UsageError('--name is required');
    if (existsSync(workflowPath(input.name))) throw new UsageError('workflow already exists; choose another --name');
  }
  const run = createBackground(input.instruction ?? input.operation, id);
  run.pid = session.pid;
  writeBackground(run);
  // Exclusive filenames and atomic replacement publish only complete requests to the owner.
  atomicJson(`${testerDirectory(id)}/inbox/${process.hrtime.bigint().toString().padStart(24, '0')}-${run.id}.json`, { ...input, id: run.id });
  return receipt(run);
}
