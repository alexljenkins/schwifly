import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { workspacePath } from './oneOff.js';
import { alive } from './background.js';

export function acquireBrowser() {
  const path = workspacePath('.schwifly/browser.lock');
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    const pid = Number(readFileSync(path, 'utf8'));
    if (Number.isSafeInteger(pid) && pid > 0 && !alive(pid)) rmSync(path);
  }
  try { writeFileSync(path, String(process.pid), { flag: 'wx', mode: 0o600 }); }
  catch { throw new Error('workspace browser is busy; use schwifly session list to find its tester, or schwifly runs to find its run'); }
  return () => {
    if (existsSync(path) && readFileSync(path, 'utf8') === String(process.pid)) rmSync(path);
  };
}
