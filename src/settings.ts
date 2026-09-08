import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { registerSecrets } from './secrets.js';

export interface Settings { version: 1; models: string[]; model: string; credential: boolean }
export interface CredentialStore { getPassword(): string | null; setPassword(value: string): void; deletePassword(): void }
const require = createRequire(import.meta.url);

export function settingsPath(): string {
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'schwifly', 'config.json');
}

export function readSettings(): Settings | undefined {
  const file = settingsPath();
  if (!existsSync(file)) return undefined;
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')) as Settings;
    if (value.version !== 1 || !Array.isArray(value.models) || !value.models.length ||
        value.models.some(model => typeof model !== 'string' || !validModel(model)) ||
        !value.models.includes(value.model) || typeof value.credential !== 'boolean') throw new Error();
    return value;
  } catch { throw new Error('invalid Schwifly settings; repair with schwifly setup --models <provider/model>'); }
}

export function validModel(model: string): boolean {
  return /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_./:-]+$/.test(model);
}

function credentialStore(): CredentialStore {
  try {
    const { Entry } = require('@napi-rs/keyring') as typeof import('@napi-rs/keyring');
    return new Entry('schwifly', 'openrouter');
  } catch { throw new Error('OS credential store unavailable; unlock it and retry schwifly setup --key-stdin'); }
}

export function saveSettings(settings: Settings, key?: string, store?: CredentialStore): void {
  const file = settingsPath();
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  if (key !== undefined) {
    registerSecrets([{ key: 'api_key', value: key }]);
    try { (store ?? credentialStore()).setPassword(key); }
    catch { throw new Error('could not store the key; unlock the OS credential store and retry schwifly setup --key-stdin'); }
  }
  const next = file + '.' + randomUUID();
  writeFileSync(next, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  renameSync(next, file);
}

export function modelCredential(store?: CredentialStore): string | undefined {
  if (process.env.SCHWIFLY_NO_HEAL === '1') return undefined;
  let key = process.env.OPENROUTER_API_KEY;
  if (!key && readSettings()?.credential) {
    try { key = (store ?? credentialStore()).getPassword() ?? undefined; }
    catch { throw new Error('could not read the OS credential; unlock it or run schwifly setup --key-stdin'); }
    if (!key) throw new Error('stored credential missing; run schwifly setup --key-stdin');
  }
  if (key) registerSecrets([{ key: 'api_key', value: key }]);
  return key;
}

export function selectedModel(fallback: string): string {
  const settings = readSettings();
  const model = process.env.SCHWIFLY_MODEL ?? settings?.model ?? fallback;
  if (!validModel(model)) throw new Error('invalid model ID; use schwifly setup --models <provider/model>');
  if (settings && !settings.models.includes(model)) {
    throw new Error('model is not configured; use schwifly setup --models <provider/model,...>');
  }
  return model;
}
