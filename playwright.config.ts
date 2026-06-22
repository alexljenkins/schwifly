import { defineConfig } from '@playwright/test';

// Workflows and verification specs both run in the Playwright runner — free parallelism,
// trace, and HTML report. `schwifly run` targets workflows/; `npm run verify` targets tests/.
export default defineConfig({
  testDir: '.',
  testMatch: ['workflows/**/*.spec.ts', 'tests/**/*.spec.ts'],
  fullyParallel: true,
  reporter: [['list'], ['json', { outputFile: '.schwifly/last-run.json' }]],
  use: { trace: 'on-first-retry' },
});
