import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Where a captured session lives and when it goes stale. storageState is a credential, so it
// lives under .schwifly/ (gitignored) — never the repo root, never committed.
//
// Staleness model (YAGNI): a single mtime check. If the file is older than MAX_AGE_MS the setup
// re-runs the login. Real session cookies usually outlive a CI run; we re-capture daily so a
// silently-expired cookie can't make every workflow fail with a confusing logged-out screen.

export const AUTH_DIR = '.schwifly/auth';
export const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

export function authStatePath(app: string): string {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(app) || app === '.' || app === '..') {
    throw new Error(`invalid auth app name: ${app}`);
  }
  return join(AUTH_DIR, `${app}.json`);
}

// True when the captured session is missing or older than MAX_AGE_MS — i.e. the setup should
// re-run the login. A backdated/expired file (mtime in the past) reports fresh:false here.
export function isAuthStale(app: string, now = Date.now()): boolean {
  const p = authStatePath(app);
  if (!existsSync(p)) return true;
  return now - statSync(p).mtimeMs > MAX_AGE_MS;
}
