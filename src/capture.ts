import type { EmitStep } from './emit';
import { redact } from './secrets';

// PURE, KEY-FREE capture normalizer: browser facts observed during an agent attempt ->
// deterministic StepSpec-shaped steps, plus the outcome contract parsed out of the ticket.
//
// Nothing the agent SAYS survives this file. Narration, `message`, `done.reasoning` and the
// agent's self-reported success are debug context only: an intent here is synthesized from the
// concrete Playwright arguments (method + element description), so two differently worded
// tickets that produce the same browser actions normalize to a byte-identical flow.

export interface CapturedAction {
  /** Playwright method Stagehand actually invoked: click / fill / type / press / ... */
  method: string;
  /** Playwright-native selector (usually `xpath=...`) for the element it acted on. */
  selector: string;
  /** Element description from playwrightArguments — the only naming source we trust. */
  description: string;
  /** Arguments passed to the method (fill/type text lives at [0]). */
  args: string[];
  /** Stagehand's own tool outcome. FALSE or missing => the step never happened. */
  ok: boolean;
  /** Independently observed URL AFTER the step (from the evidence stream, not the action). */
  postUrl?: string;
}

// The checkable end state the ticket is asking for. Each check becomes one deterministic page
// assertion in the emitted spec; at replay time there is no judgement call left to make.
export interface OutcomeCheck {
  /** Human-readable statement of what must be true, e.g. "the page shows Delete". */
  intent: string;
  /** Exact visible text that must be present on the page. */
  text: string;
}

export interface OutcomeContract {
  /** One-line restatement of the requested outcome, kept in the generated spec for humans. */
  summary: string;
  checks: OutcomeCheck[];
  /** `ticket` = stated explicitly in the request; `proposed` = discovery resolved a vague ask. */
  source: 'ticket' | 'proposed';
}

// Only these Playwright methods have a deterministic equivalent in the engine's Action union.
// Everything else (screenshot, scroll, wait, extract, navigate, keypress) is discovery noise:
// it either has no persisted equivalent or is implied by the steps that follow it.
const METHOD_ACTION: Record<string, EmitStep['action']> = {
  click: 'click',
  dblclick: 'click',
  press: 'click',
  fill: 'fill',
  type: 'fill',
};

const VERB: Record<EmitStep['action'], string> = {
  click: 'click',
  fill: 'fill',
  expectVisible: 'see',
  expectText: 'see',
};

// Intent is DERIVED, never quoted from the agent: `<verb> the <description>`. This is what makes
// terse and verbose phrasings of the same ticket converge on one normalized flow, and it keeps
// the intent phrasing in the vocabulary the heal tier's role inference already understands.
function intentFor(action: EmitStep['action'], description: string): string {
  const label = description.trim().replace(/\s+/g, ' ') || 'element';
  return `${VERB[action]} the ${label}`;
}

/**
 * Successful, concrete, non-superseded actions -> emittable steps.
 *
 * Dropped: anything Stagehand reported as not ok (failed probes), anything without a real
 * selector, unsupported methods, and fills that a later fill on the same element supersedes.
 */
export function normalizeActions(actions: CapturedAction[]): EmitStep[] {
  const steps: EmitStep[] = [];
  for (const a of actions) {
    if (!a.ok || !a.selector || !a.description) continue;
    const action = METHOD_ACTION[a.method?.toLowerCase()];
    if (!action) continue;
    const rawValue = String(a.args?.[0] ?? '');
    // Field labels are evidence too. A value typed into "Password" must be masked even when it
    // did not come from a configured environment variable and cannot be matched by value alone.
    const value = action === 'fill'
      ? redact({ [a.description]: rawValue })[a.description] as string
      : undefined;
    if (action === 'fill' && !value) continue;
    steps.push({ intent: intentFor(action, a.description), locator: a.selector, action, value });
  }
  return dropSuperseded(steps);
}

// A retyped field is the agent correcting itself: only the last fill on a given element is real.
// Consecutive identical clicks are a re-attempt of the same click, not two clicks.
function dropSuperseded(steps: EmitStep[]): EmitStep[] {
  const out: EmitStep[] = [];
  for (const s of steps) {
    const prev = out[out.length - 1];
    if (prev && prev.locator === s.locator && prev.action === s.action) {
      out[out.length - 1] = s; // later fill wins; duplicate click collapses
      continue;
    }
    if (s.action === 'fill') {
      // A fill can be superseded across intervening steps too (fill A, fill B, re-fill A).
      const i = out.findIndex((o) => o.action === 'fill' && o.locator === s.locator);
      if (i >= 0) {
        out.splice(i, 1);
      }
    }
    out.push(s);
  }
  return out;
}

// The ticket may state its own outcome inline. `<expect>` is the explicit form; `<validate>` is
// accepted too so the existing story vocabulary keeps working. Returns null for a vague ticket —
// the caller (discovery) then has to resolve it to concrete observable text before attempting.
const EXPECT_RE = /<(expect|validate)(?:\s+type="(?:exact|semantic)")?\s*>(.*?)<\/\1>/g;

export function contractFromTicket(ticket: string): OutcomeContract | null {
  const checks: OutcomeCheck[] = [];
  for (const m of ticket.matchAll(EXPECT_RE)) {
    const text = m[2].trim();
    if (text) checks.push({ intent: `the page shows ${text}`, text });
  }
  if (!checks.length) return null;
  return { summary: summarize(ticket), checks, source: 'ticket' };
}

export function proposedContract(ticket: string, texts: string[]): OutcomeContract | null {
  const checks = texts
    .map((t) => t.trim())
    .filter(Boolean)
    .map((text) => ({ intent: `the page shows ${text}`, text }));
  return checks.length ? { summary: summarize(ticket), checks, source: 'proposed' } : null;
}

// One line, tags stripped, redacted — this string is written into the generated spec.
export function summarize(ticket: string): string {
  return redact(ticket.replace(EXPECT_RE, '$2').replace(/\s+/g, ' ').trim()).slice(0, 160);
}
