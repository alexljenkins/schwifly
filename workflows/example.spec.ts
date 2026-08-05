import { test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { step } from '../src/workflow';
import { PlaywrightHeuristicResolver } from '../src/heal';

// A Workflow is a real Playwright spec generated from a user story.
// Story: "A visitor can open the Playwright docs and reach the Installation guide."
// Deterministic-first: each step tries its locator; the resolver (AI backup) only kicks in
// when a locator fails, then `schwifly run` writes the healed locator back into this file.
const heal = new PlaywrightHeuristicResolver();
const here = fileURLToPath(import.meta.url);

test('docs: reach the Installation guide', async ({ page }) => {
  await page.goto('https://playwright.dev');
  await step(page, { intent: 'open the Docs link', locator: 'a:has-text("Docs")', action: 'click' }, { resolver: heal, file: here });
  await step(page, { intent: 'see the Installation heading', locator: 'h1:has-text("Installation")', action: 'expectVisible' }, { resolver: heal, file: here });
});
