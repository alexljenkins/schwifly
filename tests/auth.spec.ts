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
