import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import type { CapturedAction } from './capture.js';
import type { LoadedStory } from './story.js';
import type { StoryAttemptOptions, StoryCommandResult } from './storyAttempt.js';
import { redact } from './secrets.js';

export type Phase = 'contract' | 'discovery' | 'certification' | 'replay' | 'repair' | 'rebuild';
export type FailureKind = 'cancelled' | 'invalid_contract' | 'incomplete_exploration' | 'unmet_outcome' | 'route_failure' |
  'browser_failure' | 'provider_failure' | 'authentication' | 'setup' | 'proof_error';
export interface StoryReport {
  version: 1;
  storyId: string | null;
  inputFile: string;
  phase: Phase;
  status: 'certified' | 'failed';
  observedActions: CapturedAction[];
  failedProofIds: string[];
  failure: { kind: FailureKind; reason: string } | null;
  artifacts: string[];
  route?: string;
  recovery?: 'element' | 'route';
}
export interface OperationState {
  phase: Phase;
  loaded?: LoadedStory;
  actions: CapturedAction[];
  artifacts: string[];
}

export async function reportOperation(
  options: StoryAttemptOptions,
  action: (state: OperationState) => Promise<StoryCommandResult>,
): Promise<StoryCommandResult> {
  const root = resolve(options.root ?? process.env.SCHWIFLY_ROOT ?? process.cwd());
  const state: OperationState = { phase: 'contract', actions: [], artifacts: [] };
  let result: StoryCommandResult;
  let failureKind: FailureKind | undefined;
  try { result = await action(state); }
  catch (error) {
    const value = error as { name?: string; kind?: string; cause?: { name?: string }; actions?: CapturedAction[] };
    failureKind = value.name === 'CancelledError' || value.cause?.name === 'CancelledError' ? 'cancelled'
      : value.name === 'ProviderError' || value.cause?.name === 'ProviderError' ? 'provider_failure'
      : value.name === 'ExplorationError' ? 'browser_failure'
      : value.name === 'SessionError' ? value.kind as FailureKind
      : state.phase === 'contract' ? 'invalid_contract'
      : state.phase === 'discovery' ? 'incomplete_exploration' : 'browser_failure';
    state.actions = value.actions ?? state.actions;
    result = { ok: false, reason: redact(error instanceof Error ? error.message : String(error)) };
  }
  const certification = result.certification;
  const failedProofIds = certification?.proofs
    ? certification.proofs.filter(proof => proof.status !== 'pass').map(proof => proof.clauseId)
    : (certification?.proofFailures ?? []).map(failure => failure.split(':')[0]);
  failureKind ??= result.failureKind ?? (certification?.cancelled ? 'cancelled' : state.phase === 'discovery' ? 'incomplete_exploration'
    : certification?.proofs?.some(proof => proof.status === 'error') ? 'proof_error'
    : certification?.steps?.length === 0 ? 'browser_failure'
    : failedProofIds.length ? 'unmet_outcome' : 'route_failure');
  const actions = state.actions.length ? state.actions : (certification?.steps ?? []).map(step => ({
    method: step.action ?? 'step', selector: step.usedLocator, description: step.intent, args: step.value === undefined ? [] : [step.value], ok: step.status !== 'failed',
  }));
  const report: StoryReport = redact({
    version: 1, storyId: state.loaded?.story.id ?? null, inputFile: relative(root, resolve(root, options.file)),
    phase: state.phase, status: result.ok ? 'certified' : 'failed', observedActions: actions,
    failedProofIds, failure: result.ok ? null : { kind: failureKind, reason: result.reason ?? 'story failed' },
    artifacts: [...new Set([...state.artifacts, ...(certification?.artifacts ?? [])].map(file => relative(root, resolve(root, file))))],
    ...(result.recovery ? { recovery: result.recovery } : {}),
    ...(result.saved ? { route: result.saved } : {}),
  });
  const dir = resolve(root, '.schwifly', 'results');
  mkdirSync(dir, { recursive: true });
  const resultPath = resolve(dir, `${Date.now()}.${randomUUID()}.json`);
  writeFileSync(resultPath, JSON.stringify(report, null, 2) + '\n');
  return { ...result, report, resultPath };
}
