import { test, expect } from '@playwright/test';
import { openSharedSession, type SharedSession } from '../src/sharedCdp';

// SHARED-DOM WITNESS for the shared-CDP fixture.
//
// Proof obligation: Stagehand observe() must resolve an element that exists ONLY AFTER a
// Playwright-driven click. If observe() and step()'s Playwright locator drove different
// browsers, the post-click element would be invisible to observe() and this would fail.
// Passing proves both drive ONE session over shared CDP.
//
// Needs one live LLM call (observe). Key-free `npm run verify` skips it so the baseline
// count is preserved; run live exactly once to confirm:
//   GEMINI_API_KEY="$(grep '^GEMINI_API_KEY=' .env | cut -d= -f2-)" \
//     npx playwright test tests/shared-cdp.spec.ts
test.describe('shared-cdp: one browser for Playwright + Stagehand', () => {
  test.skip(!process.env.GEMINI_API_KEY, 'needs GEMINI_API_KEY for one live observe() call');

  // Stagehand init + a live observe() can take a while; give the witness room.
  test.setTimeout(120_000);

  let session: SharedSession;

  // ONE Stagehand per worker; tear it down or Chromium leaks under fullyParallel.
  test.beforeAll(async () => {
    session = await openSharedSession();
  });

  test.afterAll(async () => {
    await session?.close();
  });

  test('Stagehand observe() resolves a post-click element (same DOM as Playwright)', async () => {
    const { page, stagehand } = session;

    // A page where the target ("Submit Order" button) does NOT exist in the DOM until a
    // Playwright-driven click CREATES it. data: URL keeps the witness offline/hermetic.
    await page.goto(
      'data:text/html,' +
        encodeURIComponent(`
          <!doctype html><html><body>
            <h1>Demo</h1>
            <button id="reveal" onclick="document.body.insertAdjacentHTML('beforeend', '<button id=\\'submit\\'>Submit Order</button>')">Reveal checkout</button>
          </body></html>
        `),
    );

    // Before the click, the target genuinely does not exist in the DOM.
    await expect(page.locator('#submit')).toHaveCount(0);

    // Playwright drives the click that reveals the post-click element.
    await page.locator('#reveal').click();
    await expect(page.locator('#submit')).toBeVisible();

    // The ONE live LLM call: observe(), always scoped to THIS page.
    const actions = await stagehand.observe('the Submit Order button', { page });

    // Stagehand could only resolve this if it sees the same post-click DOM Playwright drives.
    expect(actions.length).toBeGreaterThan(0);
    const selector = actions[0].selector;
    expect(selector).toBeTruthy();

    // And the resolved selector must point at the real, post-click element in this session.
    await expect(page.locator(selector).first()).toBeVisible();

    console.log(`shared-DOM witness: observe() resolved "${selector}" for the post-click button`);
  });
});
