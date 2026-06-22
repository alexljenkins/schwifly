import { test as setup, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { step } from '../src/workflow';
import { PlaywrightHeuristicResolver } from '../src/heal';
import { credentials, redact } from '../src/secrets';
import { authStatePath, isAuthStale } from '../src/auth';

// AUTH SETUP — captures a login session ONCE and reuses it across runs.
//
// This is a real workflow: the login itself runs through step(), so a broken login locator
// self-heals via the no-LLM heuristic backup just like any other step. On success we persist
// storageState to .schwifly/auth/<app>.json (gitignored) for the `workflows` project to consume.
//
// Login target is the FREE, key-free https://the-internet.herokuapp.com/login (tomsmith /
// SuperSecretPassword!). Set APP_EMAIL / APP_PASSWORD in .env (see .env.example). No LLM key is
// needed — the heuristic resolver is the only backup here.
//
// SINGLE shared account by design (YAGNI): one storageState, reused by every worker. Per-worker
// multi-account (testInfo.parallelIndex) is a documented non-goal — the single-context model is
// also what lets a Stagehand backup keep the logged-in session.

const APP = 'the-internet';
const here = fileURLToPath(import.meta.url);
const heal = new PlaywrightHeuristicResolver();

setup('capture session for the-internet', async ({ page }) => {
  const creds = credentials();
  setup.skip(!creds.email || !creds.password, 'set APP_EMAIL / APP_PASSWORD to capture a session');

  // Re-run only when missing/stale; an already-fresh session is reused untouched.
  if (!isAuthStale(APP)) {
    setup.skip(true, 'session is fresh — reusing the existing storageState');
  }

  await page.goto('https://the-internet.herokuapp.com/login');

  await step(page, { intent: 'fill the Username field', locator: '#username', action: 'fill', value: creds.email },
    { resolver: heal, file: here });
  await step(page, { intent: 'fill the Password field', locator: '#password', action: 'fill', value: creds.password },
    { resolver: heal, file: here });
  await step(page, { intent: 'click the Login button', locator: 'button[type="submit"]', action: 'click' },
    { resolver: heal, file: here });

  // Logged-in proof on the capture side too: the secure area only renders when auth succeeded.
  await expect(page.getByText('You logged into a secure area!')).toBeVisible();

  // NEVER log the password. redact() scrubs it before anything reaches the terminal.
  console.log(redact(`captured the-internet session for ${creds.email} (password=${creds.password})`));

  const out = authStatePath(APP);
  mkdirSync(dirname(out), { recursive: true });
  await page.context().storageState({ path: out });
});
