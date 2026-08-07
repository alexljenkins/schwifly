import type { Page } from '@playwright/test';
import type { Resolver, StepSpec } from './workflow';
import { llmConfigFromEnv } from './llm';

const DEBUG = process.env.SCHWIFLY_DEBUG === '1';

// The AI backup, in two tiers behind one Resolver seam:
//   1. PlaywrightHeuristicResolver — no LLM, no key. First line of defence.
//   2. StagehandResolver           — LLM escalation for what the heuristic can't resolve.

// --- Tier 1 -----------------------------------------------------------------
// Re-find an element by its accessible name / role / text instead of a brittle id/class.
// This is exactly how Playwright's Healer recovers ~75% of selector failures: the id
// changed, the element's role + accessible name did not. Returns a serializable selector
// so the heal can be cached and written back into the workflow.
export class PlaywrightHeuristicResolver implements Resolver {
  async resolve(page: Page, spec: StepSpec): Promise<string | null> {
    const label = salientLabel(spec.intent);
    if (!label) return null;

    const q = JSON.stringify(label);
    const role = inferRole(spec.intent);
    const candidates: string[] = [];
    if (role) candidates.push(`role=${role}[name=${q}i]`);
    candidates.push(
      `role=button[name=${q}i]`,
      `role=link[name=${q}i]`,
      `[aria-label=${q} i]`,
      `[placeholder=${q} i]`,
      `text=${label}`,
    );

    for (const cand of candidates) {
      try {
        const loc = page.locator(cand).first();
        const found = (await loc.count()) > 0 && (await loc.isVisible());
        if (DEBUG) console.error(`[heal:heuristic] "${spec.intent}" try ${cand} -> ${found ? 'MATCH' : 'no match'}`);
        if (found) return cand;
      } catch {
        // malformed candidate for this DOM — try the next strategy
        if (DEBUG) console.error(`[heal:heuristic] "${spec.intent}" try ${cand} -> malformed selector`);
      }
    }
    if (DEBUG) console.error(`[heal:heuristic] "${spec.intent}" -> no candidate matched`);
    return null;
  }
}

// The verb map the heuristic strips out of an intent to find its salient label. Exported so
// the generator (parseStory) phrases step intents using the SAME action verbs the healer keys
// off -- generator and healer must agree on intent phrasing or a heal can't re-derive the label.
export const ACTION_VERBS = ['click', 'press', 'tap', 'open', 'select', 'choose', 'go to', 'navigate to', 'fill', 'enter', 'type', 'check', 'toggle', 'see', 'view'];

export function salientLabel(intent: string): string {
  return intent
    .replace(/\b(click|press|tap|open|select|choose|go to|navigate to|fill|enter|type|check|toggle|see|view|the|a|an)\b/gi, ' ')
    .replace(/\b(button|link|field|input|textbox|combobox|radio|switch|box|icon|menu|tab|checkbox|option|heading)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// noun -> ARIA role. Shared with the generator so a parsed step's role matches what the
// heuristic infers from the same intent string.
export const ROLE_NOUNS: Record<string, string> = {
  button: 'button',
  link: 'link',
  tab: 'tab',
  checkbox: 'checkbox',
  field: 'textbox',
  input: 'textbox',
  textbox: 'textbox',
  combobox: 'combobox',
  radio: 'radio',
  switch: 'switch',
  option: 'option',
  heading: 'heading',
  menu: 'menuitem',
};

export function inferRole(intent: string): string | null {
  const map = ROLE_NOUNS;
  for (const [word, role] of Object.entries(map)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(intent)) return role;
  }
  return null;
}

// --- Tier 2 -----------------------------------------------------------------
// LLM escalation. Agent-agnostic: Stagehand drives Gemini / OpenAI / Anthropic.
// Inject an initialized Stagehand that shares this page's browser session (shared CDP),
// plus an LLM key. Wired against Stagehand v3's observe(); NOT yet run live in this repo
// — verify with a real key + shared-session fixture before relying on it.
import type { Stagehand } from '@browserbasehq/stagehand';

export class StagehandResolver implements Resolver {
  constructor(private stagehand: Stagehand) {}

  async resolve(page: Page, spec: StepSpec): Promise<string | null> {
    const actions = await this.stagehand.observe(spec.intent, { page });
    if (DEBUG) {
      const seen = actions.map((a) => ({ selector: a.selector, description: a.description }));
      console.error(`[heal:llm] "${spec.intent}" observe() -> ${JSON.stringify(seen)}`);
    }
    return actions[0]?.selector ?? null;
  }
}

// Build the Stagehand tier ONLY when a key is configured (llmConfigFromEnv() != null).
// Without a key this returns undefined, so the AI backup makes no network call and
// `pnpm run verify` stays offline. The Stagehand instance comes from the shared-CDP
// fixture (openSharedSession) so observe() drives the SAME DOM as step()'s Playwright locators.
export function makeStagehandResolver(stagehand: Stagehand): StagehandResolver | undefined {
  if (!llmConfigFromEnv()) return undefined;
  return new StagehandResolver(stagehand);
}

// --- The two tiers, escalating -------------------------------------------------
// "The AI is the backup": run the no-LLM heuristic FIRST, and only fall through to the
// Stagehand LLM tier when (a) the heuristic returns null AND (b) a key exists. This keeps
// every live LLM call off the happy path -- the heuristic resolves the common cases for free.
export class EscalatingResolver implements Resolver {
  private heuristic = new PlaywrightHeuristicResolver();
  constructor(private stagehand: Stagehand) {}

  async resolve(page: Page, spec: StepSpec): Promise<string | null> {
    const cheap = await this.heuristic.resolve(page, spec);
    if (cheap) return cheap;
    if (DEBUG) console.error(`[heal] "${spec.intent}" heuristic failed, escalating to LLM tier`);
    const llm = makeStagehandResolver(this.stagehand);
    if (!llm) {
      if (DEBUG) console.error(`[heal] "${spec.intent}" no LLM key configured, giving up`);
      return null;
    }
    return llm.resolve(page, spec);
  }
}
