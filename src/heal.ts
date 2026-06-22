import type { Page } from '@playwright/test';
import type { Resolver, StepSpec } from './workflow';

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
        if ((await loc.count()) > 0 && (await loc.isVisible())) return cand;
      } catch {
        // malformed candidate for this DOM — try the next strategy
      }
    }
    return null;
  }
}

function salientLabel(intent: string): string {
  return intent
    .replace(/\b(click|press|tap|open|select|choose|go to|navigate to|fill|enter|type|check|toggle|see|view|the|a|an)\b/gi, ' ')
    .replace(/\b(button|link|field|input|box|icon|menu|tab|checkbox|option|heading)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferRole(intent: string): string | null {
  const map: Record<string, string> = {
    button: 'button',
    link: 'link',
    tab: 'tab',
    checkbox: 'checkbox',
    option: 'option',
    heading: 'heading',
    menu: 'menuitem',
  };
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
    return actions[0]?.selector ?? null;
  }
}
