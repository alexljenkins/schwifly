import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
const root = process.env.SCHWIFLY_ROOT ?? process.cwd();
export default defineConfig({
  testDir: root,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  outputDir: resolve(root, '.schwifly', 'browser-results'),
  reporter: [['list'], ['json', { outputFile: resolve(root, '.schwifly', 'last-run.json') }]],
  projects: [
    { name: 'workflows', testMatch: '**/*.spec.ts', testIgnore: ['**/candidates/**', '**/node_modules/**'] },
    { name: 'candidate', testMatch: '**/candidates/*.spec.ts' },
  ],
});
