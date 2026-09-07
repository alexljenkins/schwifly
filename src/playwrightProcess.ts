import { spawn, type SpawnSyncOptions } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PLAYWRIGHT_CLI = fileURLToPath(import.meta.resolve('@playwright/test/cli'));

/** Child runners are serial even when a caller passes another worker count. */
export async function runPlaywright(args: string[], options: SpawnSyncOptions = {}) {
  const serial = [...args];
  if (serial[0] === 'test') serial.push('--workers=1');
  const { timeout = 180_000, encoding: _encoding, ...spawnOptions } = options;
  const child = spawn(process.execPath, [PLAYWRIGHT_CLI, ...serial], {
    ...spawnOptions,
    detached: process.platform !== 'win32',
  });
  let stdout = '';
  let stderr = '';
  let error: Error | undefined;
  let interrupted = false;
  let escalation: NodeJS.Timeout | undefined;
  const kill = (signal: NodeJS.Signals) => {
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch { /* The child has already exited. */ }
  };
  const stop = () => {
    interrupted = true;
    kill('SIGTERM');
    escalation ??= setTimeout(() => kill('SIGKILL'), 3000);
  };
  const timer = setTimeout(stop, timeout);
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  child.stdout?.on('data', (data) => { stdout += data; });
  child.stderr?.on('data', (data) => { stderr += data; });
  child.once('error', (cause) => { error = cause; });
  try {
    const result = await new Promise<{ status: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.once('close', (status, signal) => resolve({ status, signal }));
    });
    return { ...result, status: interrupted ? 1 : result.status, stdout, stderr, error };
  } finally {
    clearTimeout(timer);
    clearTimeout(escalation);
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    kill('SIGKILL');
  }
}
