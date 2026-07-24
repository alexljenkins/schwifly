import type { Page } from '@playwright/test';
import type { Stagehand } from '@browserbasehq/stagehand';
import { parseStory } from './parseStory';
import { emit, type EmitStep, type EmitAssertion } from './emit';
import { openSharedSession } from './sharedCdp';

// LIVE discovery path (KEY-GATED): drive a real browser ONCE to turn each parsed intent into a
// concrete, stable locator. Without a key this is never reached -- parseStory/emit cover the
// offline contract. observe() returns a Playwright-native xpath= selector; we rewrite it into a
// stable role= / text= / [aria-label] plain string, because generated specs keyed on a raw
// xpath are brittle (any DOM reshuffle breaks them and there is nothing for a heal to diff).

export interface GenerateOptions {
  title: string;
  story: string;
  url: string;
}

// Ask the browser, via the discovered element, for the most stable plain-string selector:
//   1. role + accessible name  -> role=button[name="..."i]   (survives id/class churn)
//   2. [aria-label="..."]                                     (stable label)
//   3. text="..."              (visible text)
//   4. the original xpath      (last resort; brittle but real)
// Plain strings only -- never a chained getByRole(...) object, or write-back + diff break.
async function stableSelector(page: Page, xpath: string): Promise<string> {
  const loc = page.locator(xpath).first();
  const info = await loc.evaluate((el) => {
    const role = el.getAttribute('role') ?? roleFromTag(el.tagName, el as HTMLInputElement);
    const ariaLabel = el.getAttribute('aria-label');
    const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ');
    return { role, ariaLabel, name };

    function roleFromTag(tag: string, node: HTMLInputElement): string | null {
      const t = tag.toLowerCase();
      if (t === 'a') return 'link';
      if (t === 'button') return 'button';
      if (t === 'h1' || t === 'h2' || t === 'h3' || t === 'h4' || t === 'h5' || t === 'h6') return 'heading';
      if (t === 'input' && node.type === 'submit') return 'button';
      return null;
    }
  });

  const esc = (s: string) => s.replace(/"/g, '\\"');
  if (info.role && info.name && info.name.length <= 80) return `role=${info.role}[name="${esc(info.name)}"i]`;
  if (info.ariaLabel) return `[aria-label="${esc(info.ariaLabel)}"]`;
  if (info.name && info.name.length <= 80) return `text=${info.name}`;
  return xpath; // brittle, but a real selector the heal tier can still improve later
}

const DEBUG = process.env.SCHWIFLY_DEBUG === '1';

// Discover one stable locator per intent by observing the live DOM, advancing the app between
// steps so later intents resolve against the right screen. ONE observe() + one act per step.
async function discover(
  page: Page,
  stagehand: Stagehand,
  intent: string,
  action: EmitStep['action'],
): Promise<string> {
  const actions = await stagehand.observe(intent, { page });
  const xpath = actions[0]?.selector;
  if (!xpath) throw new Error(`generate: observe() found no element for intent "${intent}"`);
  if (DEBUG) console.error(`[gen] "${intent}" -> ${xpath} (${actions[0]?.description ?? ''})`);
  const selector = await stableSelector(page, xpath);
  // Advance the app so the next intent observes the resulting screen (assertions don't navigate).
  if (action === 'click') {
    await page.locator(xpath).first().click().catch(() => {});
    // Without this, back-to-back observe() calls can fire before navigation settles, so the
    // next intent gets matched against the pre-click DOM (silently reusing this step's element).
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  }
  return selector;
}

// The author-time round trip: open ONE shared session, discover a stable locator per intent,
// rewrite to a plain-string selector, and render the spec. Returns the spec source text.
export async function generate(opts: GenerateOptions): Promise<string> {
  const { steps, assertions } = parseStory(opts.story);
  const session = await openSharedSession();
  try {
    const { page, stagehand } = session;
    await page.goto(opts.url);

    const emitSteps: EmitStep[] = [];
    for (const s of steps) {
      const locator = await discover(page, stagehand, s.intent, s.action);
      emitSteps.push({ intent: s.intent, locator, action: s.action, value: s.value });
    }

    const emitAssertions: EmitAssertion[] = [];
    for (const a of assertions) {
      const intent = `the page shows ${a.value}`;
      const locator = await discover(page, stagehand, intent, 'expectText');
      emitAssertions.push({ type: a.type, value: a.value, intent, locator });
    }

    return emit({ title: opts.title, url: opts.url, steps: emitSteps, assertions: emitAssertions });
  } finally {
    await session.close();
  }
}
