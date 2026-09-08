import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { setTimeout as pause } from 'node:timers/promises';
import { format } from 'node:util';
import { existsSync } from 'node:fs';
import { acquireBrowser } from './browserLock.js';
import { readTester, testerDirectory, writeTester, type TesterRequest } from './testerStore.js';
import { readBackground, writeBackground, progress } from './background.js';
import { Tester } from './tester.js';
import { bounded } from './limits.js';
import { redact } from './secrets.js';
import { workspacePath } from './oneOff.js';

if (existsSync('.env')) process.loadEnvFile('.env');
process.env.SCHWIFLY_ROOT = process.cwd();
console.log = (...args: unknown[]) => process.stderr.write(redact(format(...args)) + '\n');
const record = readTester(process.argv[2]);
const tester = new Tester(record);
const controller = new AbortController();
let release: (() => void) | undefined;
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => controller.abort(new Error('tester stopped')));
try {
  release = acquireBrowser();
  record.pid = process.pid;
  await bounded(tester.open(), controller.signal);
  record.status = 'ready';
  writeTester(record);
  console.log(`Tester ready. Browser debug endpoint: ${record.debug}`);
  while (!controller.signal.aborted) {
    if (tester.session?.page.isClosed()) throw new Error('tester browser closed; start a new session');
    const inbox = workspacePath(`${testerDirectory(record.id)}/inbox`);
    const next = readdirSync(inbox).filter(file => file.endsWith('.json')).sort()[0];
    if (!next) { await pause(150, undefined, { signal: controller.signal }); continue; }
    const file = workspacePath(`${inbox}/${next}`);
    const request = JSON.parse(readFileSync(file, 'utf8')) as TesterRequest;
    rmSync(file);
    const run = readBackground(request.id);
    run.status = 'running'; run.pid = process.pid;
    writeBackground(run);
    record.status = 'busy'; record.currentRun = request.id;
    writeTester(record);
    const deadline = AbortSignal.timeout(request.operation === 'save' ? 180000 : 120000);
    try {
      const signal = AbortSignal.any([controller.signal, deadline]);
      run.result = await bounded(tester.execute(request, signal), signal);
      run.status = (run.result as { status?: string })?.status === 'failed' ? 'failed' : 'passed';
    } catch (error) {
      run.status = 'failed';
      run.reason = redact(error instanceof Error ? error.message : String(error));
      if (deadline.aborted) controller.abort(new Error('check exceeded its time limit; start a new tester'));
    }
    writeBackground(run);
    progress(run.id, `Finished: ${run.status}.${run.reason ? ` ${run.reason}` : ''}`);
    record.currentRun = undefined;
    if (request.operation === 'stop') break;
    record.status = 'ready';
    writeTester(record);
  }
  record.status = 'stopped';
} catch (error) {
  record.status = controller.signal.aborted ? 'stopped' : 'failed';
  record.reason = redact(error instanceof Error ? error.message : String(error));
} finally {
  await tester.close();
  release?.();
  record.debug = undefined;
  writeTester(record);
  for (const file of readdirSync(workspacePath(`${testerDirectory(record.id)}/inbox`)).filter(file => file.endsWith('.json'))) {
    const path = workspacePath(`${testerDirectory(record.id)}/inbox/${file}`);
    const request = JSON.parse(readFileSync(path, 'utf8')) as TesterRequest;
    const run = readBackground(request.id);
    run.status = 'failed'; run.reason = record.reason ?? 'tester stopped before this check';
    writeBackground(run);
    rmSync(path);
  }
}
