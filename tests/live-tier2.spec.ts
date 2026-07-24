import { test, expect } from '@playwright/test';
import { openSharedSession, type SharedSession } from '../src/sharedCdp';
import { EscalatingResolver, PlaywrightHeuristicResolver } from '../src/heal';
import { step, type HealRecord } from '../src/workflow';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// LIVE TIER-2 WITNESS -- "the AI is the backup", proven RED -> GREEN.
//
// The deterministic locator is broken. The no-LLM heuristic tier CANNOT heal it: the target
// is a bare <div> with NO accessible name, NO role the heuristic infers, and NO text that
// matches the intent's salient label -- so PlaywrightHeuristicResolver returns null (asserted
// below: that is the RED the AI must rescue). Only the Stagehand LLM tier, reasoning over the
// real DOM via observe(), resolves it -- and returns a Playwright-native xpath= selector.
//
// Uses the epic-3 shared-CDP fixture (openSharedSession) so observe() and step()'s Playwright
// locators drive ONE browser. Exactly ONE live observe() call; no loops, no agent.execute.
//
// Key-free `npm run verify` SKIPS this (resolver stays undefined, no network). Run live once:
//   GEMINI_API_KEY="$(grep '^GEMINI_API_KEY=' .env | cut -d= -f2-)" \
//     npx playwright test tests/live-tier2.spec.ts
//
// Swap proof (DO NOT run -- cost): SCHWIFLY_MODEL=openai/gpt-4.1-mini would route the SAME
// code path through OpenAI with zero code change (llm.ts reads the env var; Stagehand resolves
// OPENAI_API_KEY itself).
test.describe('live tier-2: heuristic-unsolvable step heals via the Stagehand LLM tier', () => {
  test.skip(!process.env.GEMINI_API_KEY, 'needs GEMINI_API_KEY for one live observe() call');

  test.setTimeout(120_000);

  let session: SharedSession;

  test.beforeAll(async () => {
    session = await openSharedSession();
  });

  test.afterAll(async () => {
    await session?.close();
  });

  test('a step the heuristic cannot heal is healed by Stagehand (usedLocator is xpath=, HealRecord written)', async () => {
    const { page, stagehand } = session;

    // The target is a moon-emoji button. It IS in the accessibility tree (so observe() can see
    // it), but its accessible name is "🌙" -- which the heuristic's salient-label matching
    // ("switch page dark mode") cannot key off. Only the LLM tier, reasoning that a moon button
    // toggles dark mode, resolves it. data: URL keeps the witness hermetic apart from the one
    // observe() call.
    await page.goto(
      'data:text/html,' +
        encodeURIComponent(`
          <!doctype html><html><body>
            <h1>Settings</h1>
            <button id="t-9f3c" onclick="document.body.style.background='#222';this.dataset.on='1'">&#127769;</button>
          </body></html>
        `),
    );

    // Intent describes the element by FUNCTION, never by its label/role/text -- so the heuristic
    // has nothing to match, but the LLM can reason about it.
    const intent = 'switch the page to dark mode';
    const brokenLocator = '#dark-mode-toggle-OLD'; // stale -- the real id is #t-9f3c

    // RED proof, asserted in-test: the no-LLM heuristic genuinely returns null for this case.
    const heuristicOnly = await new PlaywrightHeuristicResolver().resolve(page, {
      intent,
      locator: brokenLocator,
    });
    expect(heuristicOnly).toBeNull();

    const dir = mkdtempSync(join(tmpdir(), 'schwifly-tier2-'));
    const healLog = join(dir, 'heals.ndjson');

    // EscalatingResolver: heuristic first (returns null, asserted above) -> Stagehand tier.
    const result = await step(
      page,
      { intent, locator: brokenLocator, action: 'click' },
      { resolver: new EscalatingResolver(stagehand), timeout: 2000, healLog },
    );

    // GREEN: the AI backup healed the broken step.
    expect(result.status).toBe('healed');
    expect(result.healedFrom).toBe(brokenLocator);

    // The Stagehand tier returns a Playwright-native xpath= selector.
    expect(result.usedLocator.startsWith('xpath=')).toBe(true);

    // And it points at the real swatch in this shared session.
    await expect(page.locator(result.usedLocator).first()).toBeVisible();

    // A HealRecord was written -- this is the "update the workflow" diff input.
    const recs = readFileSync(healLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) as HealRecord[];
    expect(recs).toHaveLength(1);
    expect(recs[0].original).toBe(brokenLocator);
    expect(recs[0].healed).toBe(result.usedLocator);
    expect(recs[0].intent).toBe(intent);

    console.log(`live tier-2: heuristic returned null; Stagehand healed "${brokenLocator}" -> "${result.usedLocator}"`);
  });
});
