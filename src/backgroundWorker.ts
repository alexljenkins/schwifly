import { readFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { backgroundDirectory, progress, readBackground, writeBackground } from './background.js';
import { redact } from './secrets.js';

const id = process.argv[2];
const run = readBackground(id);
try {
  const request = `${backgroundDirectory(id)}/request.json`;
  const args = JSON.parse(readFileSync(request, 'utf8')) as string[];
  rmSync(request);
  run.pid = process.pid;
  run.status = 'running';
  writeBackground(run);
  progress(id, 'Running in the background. Read this log for progress, or use schwifly show for the result.');
  const child = spawn(process.execPath, [fileURLToPath(new URL('../bin/schwifly.js', import.meta.url)), ...args, '--foreground', '--json'], {
    cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let pending = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => {
    pending += data;
    const lines = pending.split('\n');
    pending = lines.pop()!;
    for (const line of lines) progress(id, line);
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { child.kill(signal); });
  const code = await new Promise<number | null>((resolve, reject) => { child.once('close', resolve); child.once('error', reject); });
  if (pending) progress(id, pending);
  try { run.result = JSON.parse(stdout); }
  catch { throw new Error('run returned no readable result; inspect the progress log'); }
  run.status = code === 0 ? 'passed' : 'failed';
  progress(id, `Finished: ${run.status}.`);
} catch (error) {
  run.status = 'failed';
  run.reason = redact(error instanceof Error ? error.message : String(error));
  progress(id, run.reason);
} finally { writeBackground(run); }
