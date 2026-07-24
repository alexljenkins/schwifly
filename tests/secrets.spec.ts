import { test, expect } from '@playwright/test';
import { credentials, redact, REDACTED } from '../src/secrets';

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

test('credentials reads the env contract with safe defaults', () => {
  const saved = { ...process.env };
  try {
    delete process.env.APP_EMAIL;
    delete process.env.APP_PASSWORD;
    delete process.env.BASE_URL_DEFAULT;
    delete process.env.HEADLESS;
    process.env.ALLOWED_DOMAINS = 'the-internet.herokuapp.com, example.com';

    const c = credentials();
    expect(c.email).toBe('');
    expect(c.password).toBe('');
    expect(c.baseUrl).toBe('');
    expect(c.headless).toBe(true); // default headless
    expect(c.allowedDomains).toEqual(['the-internet.herokuapp.com', 'example.com']);

    process.env.HEADLESS = 'false';
    expect(credentials().headless).toBe(false);
  } finally {
    Object.assign(process.env, saved);
  }
});
