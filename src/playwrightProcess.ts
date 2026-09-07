import { spawn, type SpawnSyncOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLAYWRIGHT_CLI = fileURLToPath(import.meta.resolve('@playwright/test/cli'));

/** Child runners are serial even when a caller passes another worker count. */
export async function runPlaywright(args: string[], options: SpawnSyncOptions = {}) {
  const serial = [...args];
  const root = String(options.cwd ?? process.env.SCHWIFLY_ROOT ?? process.cwd());
  if (serial[0] === 'test') {
    serial.push('--workers=1');
    if (!args.some(arg => arg === '--config' || arg.startsWith('--config=')) &&
        !['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs'].some(file => existsSync(resolve(root, file)))) {
      const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
      serial.push('--config', fileURLToPath(new URL(`./runnerConfig.${extension}`, import.meta.url)));
    }
  }
  const { timeout = 180_000, encoding: _encoding, ...spawnOptions } = options;
  const child = spawn(process.execPath, [PLAYWRIGHT_CLI, ...serial], {
    ...spawnOptions,
    cwd: root,
    env: { ...process.env, ...options.env, SCHWIFLY_ROOT: root },
    detached: process.platform !== 'win32',
  });
  let stdout = '';
  let stderr = '';
  let error: Error | undefined;
  let interrupted = false;
  let cancelled = false;
  let escalation: NodeJS.Timeout | undefined;
  const kill = (signal: NodeJS.Signals) => {
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch { /* The child has already exited. */ }
  };
  const stop = (userCancelled: boolean) => {
    cancelled ||= userCancelled;
    interrupted = true;
    kill('SIGTERM');
    escalation ??= setTimeout(() => kill('SIGKILL'), 3000);
  };
  const cancel = () => stop(true);
  const timer = setTimeout(() => stop(false), timeout);
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  child.stdout?.on('data', (data) => { stdout += data; });
  child.stderr?.on('data', (data) => { stderr += data; });
  child.once('error', (cause) => { error = cause; });
  try {
    const result = await new Promise<{ status: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.once('close', (status, signal) => resolve({ status, signal }));
    });
    return { ...result, status: interrupted ? 1 : result.status, stdout, stderr, error, cancelled };
  } finally {
    clearTimeout(timer);
    clearTimeout(escalation);
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
    kill('SIGKILL');
  }
}
