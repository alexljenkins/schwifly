import { type Page, type Locator, expect } from '@playwright/test';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// A Workflow is a real Playwright .spec.ts. Each step is deterministic-first: it tries a
// concrete locator, and ONLY if that fails does the AI resolver kick in to find the element
// by intent. A successful heal is recorded so the locator can be written back into the
// source — "updating the workflow" is then just a git diff on one string.

export type Action = 'click' | 'fill' | 'expectVisible';

export interface StepSpec {
  intent: string;   // plain-English goal, e.g. "click the Sign in button"
  locator: string;  // Playwright selector tried first (CSS / text= / role= / xpath=)
  action?: Action;  // defaults to 'click'
  value?: string;   // for 'fill'
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
}

export interface StepOptions {
  resolver?: Resolver;
  timeout?: number;
  file?: string;     // source spec path, for write-back
  healLog?: string;  // ndjson sink for heal records
}

export interface HealRecord {
  file?: string;
  original: string;
  healed: string;
  intent: string;
}

const DEFAULT_HEAL_LOG = '.schwifly/heals.ndjson';

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
  }
}

function recordHeal(rec: HealRecord, healLog: string): void {
  mkdirSync(dirname(healLog), { recursive: true });
  appendFileSync(healLog, JSON.stringify(rec) + '\n');
}

export async function step(page: Page, spec: StepSpec, opts: StepOptions = {}): Promise<StepResult> {
  const timeout = opts.timeout ?? 5000;

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
      recordHeal({ file: opts.file, original: spec.locator, healed, intent: spec.intent }, opts.healLog ?? DEFAULT_HEAL_LOG);
      return { intent: spec.intent, status: 'healed', usedLocator: healed, healedFrom: spec.locator };
    } catch (err2) {
      return { intent: spec.intent, status: 'failed', usedLocator: healed, error: String(err2) };
    }
  }
}

// Write the healed locator back into the workflow source (replace the first exact occurrence).
export function applyHeal(rec: HealRecord, fallbackFiles: string[] = []): boolean {
  const files = rec.file ? [rec.file] : fallbackFiles;
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    if (src.includes(rec.original)) {
      writeFileSync(f, src.replace(rec.original, rec.healed));
      return true;
    }
  }
  return false;
}
