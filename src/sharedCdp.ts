import { chromium, type Browser, type Page } from '@playwright/test';
import { Stagehand } from '@browserbasehq/stagehand';
import { DEFAULT_MODEL } from './llm';

// Shared-CDP substrate: Stagehand OWNS Chromium, Playwright ATTACHES over CDP, so
// Stagehand observe()/act() and step()'s Playwright locators drive the SAME DOM.
// Without this, the AI backup heals against a different browser than the workflow runs in
// (silent wrong-DOM heals). Every live-AI epic builds on this.
//
// Shape avoids Stagehand bug #1392 ("Failed to resolve V3 Page"): Stagehand launches the
// browser, we connectOverCDP to it, and use its existing page as the test page. ALWAYS pass
// { page } to observe/act so they target this exact page.

export interface SharedSession {
  stagehand: Stagehand;
  browser: Browser;
  page: Page;
  /** Best-effort teardown. Closes the CDP attachment then the Stagehand-owned Chromium. */
  close(): Promise<void>;
}

// Default model is Gemini (free-tier friendly); swap via SCHWIFLY_MODEL. LOCAL only — never
// BROWSERBASE (that is paid cloud and a locked constraint). Stagehand resolves the API key
// from the environment (GEMINI_API_KEY / GOOGLE_API_KEY / ...), so callers don't wire it.
export interface SharedSessionOptions {
  /**
   * Discovery sessions only. Stagehand's agent evidence callbacks are experimental and refuse to
   * run unless `experimental` + `disableAPI` are set on the constructor, so the attempt flow opts
   * in explicitly. Saved-workflow runs keep today's default construction untouched.
   */
  evidence?: boolean;
  /** Force a headed browser regardless of SCHWIFLY_HEADED (the `attempt --visible` demo switch). */
  headed?: boolean;
}

export async function openSharedSession(opts: SharedSessionOptions = {}): Promise<SharedSession> {
  const model = process.env.SCHWIFLY_MODEL ?? DEFAULT_MODEL;
  // Reuse the Chromium Playwright already installed (no extra Chrome download / system Chrome
  // dependency). Without executablePath, Stagehand's chrome-launcher errors "CHROME_PATH must
  // be set". --no-sandbox is required to launch Chromium inside sandboxed CI/Linux (otherwise
  // Chrome crashes before opening the CDP port -> ECONNREFUSED on connectOverCDP).
  const stagehand = new Stagehand({
    env: 'LOCAL',
    model,
    verbose: 0,
    ...(opts.evidence ? { experimental: true, disableAPI: true } : {}),
    localBrowserLaunchOptions: {
      executablePath: chromium.executablePath(),
      headless: !opts.headed && process.env.SCHWIFLY_HEADED !== '1',
      args: ['--no-sandbox'],
    },
  });
  await stagehand.init();

  let browser: Browser;
  let page: Page;
  try {
    browser = await chromium.connectOverCDP(stagehand.connectURL());
    const firstPage = browser.contexts()[0]?.pages()[0];
    if (!firstPage) throw new Error('Stagehand opened no browser page');
    page = firstPage;
  } catch (error) {
    await stagehand.close().catch(() => {});
    throw error;
  }

  return {
    stagehand,
    browser,
    page,
    async close() {
      // Detach Playwright first, then let Stagehand tear down the Chromium it owns, or
      // Chromium leaks across workers under fullyParallel.
      await browser.close().catch(() => {});
      await stagehand.close().catch(() => {});
    },
  };
}
