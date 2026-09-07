import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { redact } from './secrets.js';
import type { FailureKind } from './result.js';

// A story route replays inside a child Playwright process. An authentication, setup, provider, or
// deadline failure there is infrastructure, not a broken locator, but the child boundary reduces
// it to "exit 1, no steps". This log carries the structured reason back to the parent so the
// report names it and recovery is skipped.

export interface RunnerFailure {
  kind: FailureKind;
  reason: string;
}

export function runnerFailureKind(error: unknown): FailureKind {
  const value = error as { name?: string; kind?: string; cause?: { name?: string } };
  if (value?.name === 'CancelledError' || value?.cause?.name === 'CancelledError') return 'cancelled';
  if (value?.name === 'SessionTimeoutError') return 'browser_failure';
  if (value?.name === 'ProviderError' || value?.cause?.name === 'ProviderError') return 'provider_failure';
  if (value?.name === 'SessionError' && (value.kind === 'authentication' || value.kind === 'setup')) return value.kind;
  return 'browser_failure';
}

export function recordRunnerFailure(error: unknown, kind = runnerFailureKind(error)): void {
  const log = process.env.SCHWIFLY_FAILURE_LOG;
  if (!log) return;
  const failure: RunnerFailure = { kind, reason: redact(error instanceof Error ? error.message : String(error)) };
  try {
    mkdirSync(dirname(log), { recursive: true });
    appendFileSync(log, JSON.stringify(failure) + '\n');
  } catch { /* Evidence is best effort; the run still reports its own failure. */ }
}
