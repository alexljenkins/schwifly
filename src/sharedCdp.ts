import { readFileSync } from 'node:fs';
import { registerSecrets } from './secrets.js';
import { chromium, type Browser, type Page } from '@playwright/test';
import { Stagehand } from '@browserbasehq/stagehand';
import { sessionModel, type ProviderError } from './llm.js';
import { bounded, CancelledError, SessionTimeoutError, SESSION_TIMEOUT_MS } from './limits.js';
import { recordRunnerFailure } from './failureLog.js';

// Stagehand owns Chromium. Playwright attaches over CDP so model calls and locators share a page.
// Pass that page explicitly to Stagehand observe, act, and agent execution.

export interface SharedSession {
  signal: AbortSignal;
  readonly providerFailure?: ProviderError;
  stagehand: Stagehand;
  browser: Browser;
  page: Page;
  /** Best-effort teardown. Closes the CDP attachment then the Stagehand-owned Chromium. */
  close(): Promise<void>;
}

// Browser execution stays local. src/llm.ts owns the OpenRouter configuration.
export interface SharedSessionOptions {
  /**
   * Discovery sessions only. Stagehand's agent evidence callbacks are experimental and refuse to
   * run unless `experimental` + `disableAPI` are set on the constructor, so the attempt flow opts
   * in explicitly. Saved-workflow runs keep today's default construction untouched.
   */
  evidence?: boolean;
  /** Force a headed browser regardless of SCHWIFLY_HEADED (the `attempt --visible` demo switch). */
  headed?: boolean;
  timeoutMs?: number;
  storageState?: string;
}

export async function openSharedSession(opts: SharedSessionOptions = {}): Promise<SharedSession> {
  const controller = new AbortController();
  let providerFailure: ProviderError | undefined;
  const model = sessionModel(controller.signal, error => { providerFailure = error; });
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
  let browser: Browser | undefined;
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => closing ??= (async () => {
    clearTimeout(timer);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    controller.abort(new Error('browser session closed'));
    await browser?.close().catch(() => {});
    await stagehand.close().catch(() => {});
  })();
  const interrupt = () => {
    const cancelled = new CancelledError();
    recordRunnerFailure(cancelled);
    controller.abort(cancelled);
    void close().finally(() => { process.exitCode = 1; });
  };
  // The deadline is infrastructure exhaustion, not a locator defect, so it is reported as a
  // browser failure and stops route recovery instead of paying for a repair and a rebuild.
  const timer = setTimeout(() => {
    const expired = new SessionTimeoutError();
    recordRunnerFailure(expired);
    controller.abort(expired);
    void close();
  }, opts.timeoutMs ?? SESSION_TIMEOUT_MS);
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  let page: Page;
  try {
    await bounded(stagehand.init(), controller.signal);
    browser = await chromium.connectOverCDP(stagehand.connectURL());
    const firstPage = browser.contexts()[0]?.pages()[0];
    if (!firstPage) throw new Error('Stagehand opened no browser page');
    page = firstPage;
    if (opts.storageState) {
      const state = JSON.parse(readFileSync(opts.storageState, 'utf8'));
      if (!Array.isArray(state.cookies) || !Array.isArray(state.origins)) throw new Error('invalid saved login state');
      registerSecrets([
        ...state.cookies.map((cookie: { name: string; value: string }) => ({ key: cookie.name, value: cookie.value })),
        ...state.origins.flatMap((origin: { localStorage: Array<{ name: string; value: string }> }) =>
          origin.localStorage.map(item => ({ key: item.name, value: item.value }))),
      ]);
      // Let Playwright restore the complete state once, including IndexedDB. Stagehand sees
      // this context through the same CDP connection and receives its page explicitly.
      const context = await browser.newContext({ storageState: state });
      page = await context.newPage();
      await firstPage.close();
    }
  } catch (error) {
    await close();
    throw error;
  }

  page.setDefaultTimeout(5000);
  page.setDefaultNavigationTimeout(30_000);
  return { signal: controller.signal, get providerFailure() { return providerFailure; }, stagehand, browser, page, close };
}
