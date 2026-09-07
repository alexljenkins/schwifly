import { expect, test } from '@playwright/test';
import { bounded, discoverySteps } from '../src/limits';
import { openSharedSession } from '../src/sharedCdp';

test('discovery rejects invalid budgets and cancellation stops waiting', async () => {
  for (const value of [0, -1, 13, 1.5, NaN]) expect(() => discoverySteps(value)).toThrow('maxSteps');
  expect(discoverySteps()).toBe(12);
  const controller = new AbortController();
  const pending = bounded(new Promise(() => {}), controller.signal);
  controller.abort(new Error('cancelled'));
  await expect(pending).rejects.toThrow('cancelled');
});

test('a session rejects invalid deadlines before browser startup', async () => {
  const listeners = process.listenerCount('SIGTERM');
  for (const timeoutMs of [0, -1, NaN, Infinity]) {
    await expect(openSharedSession({ timeoutMs })).rejects.toThrow('timeoutMs must be a positive finite number');
  }
  expect(process.listenerCount('SIGTERM')).toBe(listeners);
});

test('a session deadline closes its browser and removes signal handlers', async () => {
  test.setTimeout(30_000);
  const listeners = process.listenerCount('SIGTERM');
  const session = await openSharedSession({ timeoutMs: 5000 });
  const cdp = await session.browser.newBrowserCDPSession();
  const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
  const browserPid = processInfo.find((entry) => entry.type === 'browser')!.id;
  const disconnected = new Promise<void>((resolve) => session.browser.once('disconnected', () => resolve()));
  await disconnected;
  await session.close();
  await expect.poll(() => {
    try { process.kill(browserPid, 0); return true; } catch { return false; }
  }).toBe(false);
  expect(session.signal.aborted).toBe(true);
  expect(session.browser.isConnected()).toBe(false);
  expect(process.listenerCount('SIGTERM')).toBe(listeners);
});

test('SIGTERM closes an owned browser before the owner exits', async () => {
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/sessionLifecycle.ts'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
  try {
    const pid = await new Promise<number>((resolve, reject) => {
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += chunk;
        const match = /READY:(\d+)/.exec(output);
        if (match) resolve(Number(match[1]));
      });
      child.once('error', reject);
      child.once('exit', () => reject(new Error('session exited before it was ready')));
    });
    child.kill('SIGTERM');
    expect(await exited).toBe(1);
    await expect.poll(() => {
      try { process.kill(pid, 0); return true; } catch { return false; }
    }).toBe(false);
  } finally { child.kill('SIGKILL'); }
});

test('cancelling a wrapper closes the browser owned by its nested runner', async () => {
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/runnerLifecycle.ts'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = new Promise<number | null>(resolve => child.once('exit', resolve));
  try {
    const pid = await new Promise<number>((resolve, reject) => {
      let output = '';
      child.stdout.on('data', chunk => {
        output += chunk;
        const match = /READY:(\d+)/.exec(output);
        if (match) resolve(Number(match[1]));
      });
      child.once('error', reject);
      child.once('exit', () => reject(new Error('runner exited before its browser was ready')));
    });
    child.kill('SIGTERM');
    expect(await exited).toBe(1);
    await expect.poll(() => {
      try { process.kill(pid, 0); return true; } catch { return false; }
    }, { timeout: 10_000 }).toBe(false);
  } finally { child.kill('SIGTERM'); }
});
