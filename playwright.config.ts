import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import { authStatePath } from './src/auth';

// FOUR projects, deliberately separated so `pnpm run verify` stays key-free and green:
//
//   setup     — runs the *.auth.setup.ts login(s), writes storageState to .schwifly/auth/.
//   workflows — the real workflows; depends on `setup` and loads its storageState (logged in).
//   tests     — the verification witnesses; OWN project, NO storageState, NO setup dependency.
//
// `pnpm run verify` is `playwright test tests/`: the path filter selects only specs under tests/,
// so the setup + workflows projects contribute zero tests and `dependencies:['setup']` never
// fires. Verify therefore needs no creds and no LLM key. `schwifly run` targets workflows/, which
// DOES pull in `setup` first.
//
// storageState is wired as the PATH whenever this run can produce one — i.e. creds are present
// (the `setup` project will write the file before the `workflows` project reads it lazily) OR a
// captured file already exists. With neither, storageState stays undefined: that is also the RED
// witness — the secure-area spec then gets no auth, redirects to /login, and the logged-in
// assertion fails, exactly the failure auth is meant to remove.
const theInternetState = authStatePath('the-internet');
const haveCreds = Boolean(process.env.APP_EMAIL && process.env.APP_PASSWORD);
const storageState = haveCreds || existsSync(theInternetState) ? theInternetState : undefined;

export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  reporter: [['list'], ['json', { outputFile: '.schwifly/last-run.json' }]],
  use: { trace: 'on-first-retry' },
  projects: [
    {
      name: 'setup',
      testMatch: /.*\.auth\.setup\.ts$/,
    },
    {
      name: 'workflows',
      testMatch: 'workflows/**/*.spec.ts',
      dependencies: ['setup'],
      use: { storageState },
    },
    {
      // The attempt flow's certification replay: a candidate spec, no setup dependency and no
      // storageState, run with SCHWIFLY_NO_HEAL=1 so it cannot heal its way to GREEN.
      name: 'candidate',
      testMatch: 'candidates/**/*.spec.ts',
    },
    {
      // Verification witnesses run key-free with NO storageState and NO setup dependency, so the
      // baseline count is preserved with no creds. Do not add storageState/dependencies here.
      name: 'tests',
      testMatch: 'tests/**/*.spec.ts',
    },
  ],
});
