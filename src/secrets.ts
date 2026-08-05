// Credentials + redaction. Ported from the deleted Python prototype (schwifly/secrets.py +
// config.py). No new dependency: Node 22 reads .env via `node --env-file=.env` (or the shell);
// here we only read process.env, so the caller chooses how the env is populated.
//
// TWO jobs:
//   credentials() — the login + run contract (email/password/base URL/headless/allowed domains).
//   redact()      — scrub secrets at every persist/print boundary (a storageState JSON is itself a
//                   credential; a typed password flows into a HealRecord and the terminal).

export interface Credentials {
  email: string;
  password: string;
  baseUrl: string;
  headless: boolean;
  allowedDomains: string[]; // empty = no restriction
}

// Read the login + run contract from the environment. Missing email/password is allowed here
// (returns ''); the auth setup is the place that fails loudly when it actually needs them, so
// key-free `npm run verify` (which never runs setup) imports this module without exploding.
export function credentials(): Credentials {
  const env = process.env;
  return {
    email: env.APP_EMAIL ?? '',
    password: env.APP_PASSWORD ?? '',
    baseUrl: env.BASE_URL_DEFAULT ?? '',
    headless: (env.HEADLESS ?? 'true').toLowerCase() !== 'false',
    allowedDomains: (env.ALLOWED_DOMAINS ?? '')
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean),
  };
}

// Keys whose VALUE is a secret. Substring match, case-insensitive (so `apiKey`, `API_KEY`,
// `userPassword`, `auth_token` all hit). Ported from secrets.py's redacted_keys set.
const SECRET_KEYS = ['password', 'api_key', 'apikey', 'token', 'secret'];
export const REDACTED = '***REDACTED***';

function isSecretKey(key: string): boolean {
  const k = key.toLowerCase();
  return SECRET_KEYS.some((s) => k.includes(s));
}

// Redact recursively: object values under a secret key are masked; strings are scrubbed for
// inline `password: hunter2` / `token=abc` patterns; everything else is walked. The same seam
// guards both structured logs (HealRecord, step logs) and free-form CLI/diff output.
export function redact<T>(value: T): T {
  if (typeof value === 'string') return redactString(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redact(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSecretKey(k) ? REDACTED : redact(v);
    }
    return out as unknown as T;
  }
  return value;
}

// Scrub `key: value` / `key=value` pairs in free-form text (logs, error strings, CLI output).
function redactString(text: string): string {
  let out = text;
  const secretValues = Object.entries(process.env)
    .filter(([key, value]) => value && value.length >= 6 && isSecretKey(key))
    .map(([, value]) => value as string)
    .sort((a, b) => b.length - a.length);
  for (const value of secretValues) out = out.split(value).join(REDACTED);
  for (const key of SECRET_KEYS) {
    const re = new RegExp(`\\b${key}\\b\\s*[:=]\\s*['"]?([^'"\\s]+)['"]?`, 'gi');
    out = out.replace(re, `${key}: ${REDACTED}`);
  }
  return out;
}
