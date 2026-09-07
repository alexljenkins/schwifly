import { test, expect } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { credentials, redact, registerSecrets, REDACTED } from '../src/secrets';
import { emit } from '../src/emit';
import { step, type Resolver } from '../src/workflow';

// Key-free witnesses for the secret store. redact() is the boundary every persist/print must
// pass through; if a value under a password/token/secret/api_key key ever survives it, a
// storageState or a typed credential leaks into a HealRecord or the terminal.

test('redact masks secret-keyed values and scrubs inline pairs, recursively', () => {
  const masked = redact({
    user: 'tomsmith',
    password: 'SuperSecretPassword!',
    nested: { api_key: 'AQ.abc123', note: 'keep me' },
    list: [{ token: 'tok_999' }, { plain: 'ok' }],
    line: 'logged in with password=hunter2 token: tok_abc',
  });

  expect(masked.password).toBe(REDACTED);
  expect(masked.nested.api_key).toBe(REDACTED);
  expect(masked.list[0].token).toBe(REDACTED);
  // non-secret keys untouched
  expect(masked.user).toBe('tomsmith');
  expect(masked.nested.note).toBe('keep me');
  expect(masked.list[1].plain).toBe('ok');
  // inline key:value / key=value pairs in free-form strings are scrubbed
  expect(masked.line).not.toContain('hunter2');
  expect(masked.line).not.toContain('tok_abc');

  // the plaintext password must not survive anywhere in the serialized output
  expect(JSON.stringify(masked)).not.toContain('SuperSecretPassword!');
});

test('redact scrubs configured secret values even without a key label', () => {
  const saved = process.env.APP_PASSWORD;
  process.env.APP_PASSWORD = 'known-password-123';
  try {
    const masked = redact('fill value was known-password-123');
    expect(masked).toBe(`fill value was ${REDACTED}`);

    process.env.APP_PASSWORD = 'short';
    expect(redact('short stands alone; password=short')).toBe(
      `${REDACTED} stands alone; password: ${REDACTED}`,
    );
  } finally {
    if (saved === undefined) delete process.env.APP_PASSWORD;
    else process.env.APP_PASSWORD = saved;
  }
});

test('step and heal logs never persist a filled password', async ({ page }) => {
  const saved = process.env.APP_PASSWORD;
  process.env.APP_PASSWORD = 'known-password-123';
  const dir = mkdtempSync(join(tmpdir(), 'schwifly-secrets-'));
  const healLog = join(dir, 'heals.ndjson');
  const stepLog = join(dir, 'steps.ndjson');
  const resolver: Resolver = { async resolve() { return '#password'; } };

  try {
    await page.setContent('<input id="password">');
    await step(page, {
      intent: 'fill known-password-123',
      locator: '#known-password-123',
      action: 'fill',
      value: 'known-password-123',
    }, { resolver, healLog, stepLog, timeout: 500 });

    const persisted = readFileSync(healLog, 'utf8') + readFileSync(stepLog, 'utf8');
    expect(persisted).toContain(REDACTED);
    expect(persisted).not.toContain('known-password-123');
  } finally {
    if (saved === undefined) delete process.env.APP_PASSWORD;
    else process.env.APP_PASSWORD = saved;
  }
});

test('credentials reads the env contract with safe defaults', () => {
  const saved = { ...process.env };
  try {
    delete process.env.APP_EMAIL;
    delete process.env.APP_PASSWORD;

    const c = credentials();
    expect(c.email).toBe('');
    expect(c.password).toBe('');
  } finally {
    Object.assign(process.env, saved);
  }
});

// A saved login state carries preferences next to credentials. Registering every stored value
// replaced common words everywhere redact() runs, which blocked generation and corrupted evidence.
test('saved login state registers credentials without swallowing preferences', () => {
  registerSecrets([
    { key: 'theme', value: 'dark' },
    { key: 'view-mode', value: 'list' },
    { key: 'analytics-opt-in', value: 'true' },
    { key: 'last-url', value: 'http://127.0.0.1:4173/app/settings' },
    { key: 'demo_session', value: 'sess-42' },
    { key: 'ab-bucket', value: 'gh8Kq2Lm4Rt7Vz1Wb9Ns3Xc6' },
  ]);

  // Benign preferences survive redaction, so a step can still speak about them.
  expect(redact('toggle dark mode in the list view')).toBe('toggle dark mode in the list view');
  expect(redact('analytics is true at http://127.0.0.1:4173/app/settings'))
    .toBe('analytics is true at http://127.0.0.1:4173/app/settings');
  // A short value under a session-named key and an opaque token are still credentials.
  expect(redact('cookie sess-42 sent')).toBe(`cookie ${REDACTED} sent`);
  expect(redact('bearer gh8Kq2Lm4Rt7Vz1Wb9Ns3Xc6')).toBe(`bearer ${REDACTED}`);

  // The emit field guard rejects any input a registered secret would rewrite. A preference must
  // not make a generated workflow unbuildable.
  const source = emit({
    title: 'dark mode',
    url: 'http://127.0.0.1:4173/app',
    steps: [{ intent: 'switch to the dark list view', locator: '#theme-dark', action: 'click' }],
    assertions: [],
  });
  expect(source).toContain('#theme-dark');
  expect(() => emit({
    title: 'session leak',
    url: 'http://127.0.0.1:4173/app',
    steps: [{ intent: 'send sess-42', locator: '#go', action: 'click' }],
    assertions: [],
  })).toThrow('secret');
});
