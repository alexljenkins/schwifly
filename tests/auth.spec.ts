import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { authStatePath, isAuthStale, MAX_AGE_MS } from '../src/auth';

test('auth state is stale when missing or older than the fixed reuse window', () => {
  const app = `test-${randomUUID()}`;
  const file = authStatePath(app);
  const now = Date.now();
  expect(isAuthStale(app, now)).toBe(true);

  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, '{}');
  utimesSync(file, new Date(now), new Date(now));
  expect(isAuthStale(app, now)).toBe(false);

  const old = now - MAX_AGE_MS - 1;
  utimesSync(file, new Date(old), new Date(old));
  expect(isAuthStale(app, now)).toBe(true);
  rmSync(file, { force: true });
});

test('auth app names cannot escape the credential directory', () => {
  expect(() => authStatePath('../../outside')).toThrow(/invalid auth app name/);
  expect(() => authStatePath('..')).toThrow(/invalid auth app name/);
});

test('saved cookies and localStorage reach a fresh context without resetting refreshed values', async () => {
  const { createServer } = await import('node:http');
  const { openSharedSession } = await import('../src/sharedCdp');
  const { mkdirSync, mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const server = createServer((_, response) => response.end('<h1>Account</h1>'));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  mkdirSync('.schwifly', { recursive: true });
  const dir = mkdtempSync('.schwifly/auth-test-');
  const file = resolve(dir, 'state.json');
  writeFileSync(file, JSON.stringify({
    cookies: [{ name: 'login', value: 'session-cookie-value', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }],
    origins: [{ origin, localStorage: [{ name: 'login-state', value: 'saved-state-value' }] }],
  }));
  let session: Awaited<ReturnType<typeof openSharedSession>> | undefined;
  try {
    session = await openSharedSession({ storageState: file });
    await session.page.goto(origin);
    expect((await session.page.context().cookies())[0].value).toBe('session-cookie-value');
    expect(await session.page.evaluate(() => localStorage.getItem('login-state'))).toBe('saved-state-value');
    await session.page.evaluate(() => localStorage.setItem('login-state', 'refreshed'));
    await session.page.reload();
    expect(await session.page.evaluate(() => localStorage.getItem('login-state'))).toBe('refreshed');
  } finally {
    await session?.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
