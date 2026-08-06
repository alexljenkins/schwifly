import type { Action } from './workflow';
import { ACTION_VERBS, inferRole } from './heal';

// PURE, KEY-FREE story parser: plain English (+ inline <validate>) -> {steps, assertions}.
// No browser, no LLM -> offline-verifiable. generate.ts later discovers a real locator per
// step intent by driving a live browser (the key-gated path); parseStory only structures the
// intent + the validated values so that work is well-defined.

export type AssertionType = 'exact' | 'semantic';

export interface ParsedStep {
  intent: string;          // intent-bearing phrase the resolvers key off (verb + label)
  action: Action;          // inferred from the leading verb; defaults to click
  value?: string;          // for a 'fill' step
}

export interface ParsedAssertion {
  type: AssertionType;     // exact (default) | semantic
  value: string;           // the validated text, e.g. "19"
}

export interface ParsedStory {
  steps: ParsedStep[];
  assertions: ParsedAssertion[];
}

// PORTED verbatim from schwifly/services/validation_parser.py:26 (Deferred patterns in TODO.md).
// Captures the optional type attr and the inner text. Global so we walk every occurrence.
const VALIDATE_RE = /<validate(?:\s+type="(exact|semantic)")?\s*>(.*?)<\/validate>/g;

// Map a leading verb to one of the engine's actions. fill/type/enter -> fill; see/view ->
// expectVisible (a look, not an interaction -- must not click or advance the app); everything
// else that moves the app -> click. (expectText steps come from <validate>, not the narrative.)
function actionFor(verb: string): Action {
  if (/^(fill|type|enter)$/i.test(verb)) return 'fill';
  if (/^(see|view)$/i.test(verb)) return 'expectVisible';
  return 'click';
}

// Strip the <validate> tags from a sentence so the step intent reads naturally ("ensure the
// only plans are Free, Pro, ...") without the angle-bracket noise.
function stripValidate(s: string): string {
  return s.replace(/<\/?validate(?:\s+type="(?:exact|semantic)")?\s*>/g, '').replace(/\s+/g, ' ').trim();
}

export function parseStory(story: string): ParsedStory {
  const assertions: ParsedAssertion[] = [];
  for (const m of story.matchAll(VALIDATE_RE)) {
    const value = m[2].trim();
    if (value) assertions.push({ type: (m[1] as AssertionType) ?? 'exact', value });
  }

  // Split the narrative into candidate sentences (period / newline / bullet boundaries), then
  // keep only those that START with a known action verb -- those are the imperative steps.
  const verbAlt = ACTION_VERBS.map((v) => v.replace(/\s+/g, '\\s+')).join('|');
  const leadVerb = new RegExp(`^(${verbAlt})\\b`, 'i');
  const steps: ParsedStep[] = [];
  for (const raw of story.split(/[.\n]+/)) {
    const sentence = stripValidate(raw)
      .replace(/^\s*[-*]\s*/, '')
      .replace(/^(then|and|next|now)\s+/i, '')
      .trim();
    const lead = leadVerb.exec(sentence);
    if (!lead) continue;
    steps.push({ intent: sentence, action: actionFor(lead[1]) });
  }

  return { steps, assertions };
}

// Re-export so callers structuring intents share the healer's role inference.
export { inferRole };
