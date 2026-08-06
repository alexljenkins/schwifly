import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Invoke the lockfile-pinned Playwright CLI directly. `npx playwright` can resolve or download a
// different version when Schwifly is launched outside the repository that owns node_modules.
const PLAYWRIGHT_CLI = fileURLToPath(import.meta.resolve('@playwright/test/cli'));

export function runPlaywright(args: string[], options: SpawnSyncOptions = {}) {
  return spawnSync(process.execPath, [PLAYWRIGHT_CLI, ...args], options);
}
