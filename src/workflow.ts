import { type Page, type Locator, expect } from '@playwright/test';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { q } from './emit';

// A Workflow is a real Playwright .spec.ts. Each step is deterministic-first: it tries a
// concrete locator, and ONLY if that fails does the AI resolver kick in to find the element
// by intent. A successful heal is recorded so the locator can be written back into the
// source — "updating the workflow" is then just a git diff on one string.

export type Action = 'click' | 'fill' | 'expectVisible' | 'expectText';

export interface StepSpec {
  intent: string;   // plain-English goal, e.g. "click the Sign in button"
  locator: string;  // Playwright selector tried first (CSS / text= / role= / xpath=)
  action?: Action;  // defaults to 'click'
  value?: string;   // for 'fill' and 'expectText' (the asserted text)
}

export interface Resolver {
  // Given a failed step, return a new selector to retry with, or null if it can't.
  resolve(page: Page, spec: StepSpec): Promise<string | null>;
}

export type StepStatus = 'ok' | 'healed' | 'failed';

export interface StepResult {
  intent: string;
  status: StepStatus;
  usedLocator: string;
  healedFrom?: string;
  error?: string;
  file?: string;     // source spec path, so a logged result maps back to its workflow
}

export interface StepOptions {
  resolver?: Resolver;
  timeout?: number;
  file?: string;     // source spec path, for write-back
  healLog?: string;  // ndjson sink for heal records
  stepLog?: string;  // ndjson sink for StepResults (surfaces 'impossible' to the CLI)
}

export interface HealRecord {
  file?: string;
  original: string;
  healed: string;
  intent: string;
}

const DEFAULT_HEAL_LOG = '.schwifly/heals.ndjson';
const DEFAULT_STEP_LOG = '.schwifly/steps.ndjson';

async function act(loc: Locator, spec: StepSpec, timeout: number): Promise<void> {
  switch (spec.action ?? 'click') {
    case 'click':
      await loc.click({ timeout });
      break;
    case 'fill':
      await loc.fill(spec.value ?? '', { timeout });
      break;
    case 'expectVisible':
      await expect(loc).toBeVisible({ timeout });
      break;
    case 'expectText': {
      // The <validate>X</validate> check. Exact text-equals first; fall back to contains
      // so trimming / surrounding markup ("$19/month") still satisfies a value of "19".
      const want = spec.value ?? '';
      try {
        await expect(loc).toHaveText(want, { timeout });
      } catch {
        await expect(loc).toContainText(want, { timeout });
      }
      break;
    }
  }
}

function appendNdjson(path: string, rec: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(rec) + '\n');
}

export async function step(page: Page, spec: StepSpec, opts: StepOptions = {}): Promise<StepResult> {
  const timeout = opts.timeout ?? 5000;
  const result = await runStep(page, spec, opts, timeout);
  appendNdjson(opts.stepLog ?? DEFAULT_STEP_LOG, { ...result, file: opts.file });
  return { ...result, file: opts.file };
}

async function runStep(page: Page, spec: StepSpec, opts: StepOptions, timeout: number): Promise<StepResult> {
  try {
    await act(page.locator(spec.locator), spec, timeout);
    return { intent: spec.intent, status: 'ok', usedLocator: spec.locator };
  } catch (err) {
    if (!opts.resolver) {
      return { intent: spec.intent, status: 'failed', usedLocator: spec.locator, error: String(err) };
    }
    const healed = await opts.resolver.resolve(page, spec);
    if (!healed) {
      return { intent: spec.intent, status: 'failed', usedLocator: spec.locator, error: 'resolver returned null' };
    }
    try {
      await act(page.locator(healed), spec, timeout);
      appendNdjson(opts.healLog ?? DEFAULT_HEAL_LOG, { file: opts.file, original: spec.locator, healed, intent: spec.intent } satisfies HealRecord);
      return { intent: spec.intent, status: 'healed', usedLocator: healed, healedFrom: spec.locator };
    } catch (err2) {
      return { intent: spec.intent, status: 'failed', usedLocator: healed, error: String(err2) };
    }
  }
}

// Write the healed locator back into the workflow source. Anchor on the full `locator: '...'`
// token emit wrote (via the shared q()), NOT a bare substring: a bare `src.replace('text=$20', …)`
// splices into a DIFFERENT healthy step whose locator merely CONTAINS it (`text=$20/mo.` ->
// `xpath=.../span[1]/mo.`). The trailing quote in `locator: '<original>'` makes the match
// whole-token. Replacing the FIRST such token consumes exactly one occurrence, so N records for N
// identical locators — applied in execution order by the serial CLI writer — land one-per-step.
export function applyHeal(rec: HealRecord, fallbackFiles: string[] = []): boolean {
  const files = rec.file ? [rec.file] : fallbackFiles;
  const from = `locator: ${q(rec.original)}`;
  const to = `locator: ${q(rec.healed)}`;
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    if (src.includes(from)) {
      writeFileSync(f, src.replace(from, to));
      return true;
    }
  }
  return false;
}
