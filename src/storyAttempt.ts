import { writeRepairDiff } from './repairDiff.js';
import { applyHeal, type HealRecord } from './workflow.js';
import { hasModelKey, ProviderError } from './llm.js';
import { reportOperation, type FailureKind, type OperationState, type StoryReport } from './result.js';
import { discoverySteps } from './limits.js';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { liveDiscoverStory, type StoryDiscovery, type StoryDiscoveryRequest } from './attempt.js';
import { normalizeActions } from './capture.js';
import { emitStory } from './emit.js';
import { loadAndValidateProofs, type ProofRecord, type ValidatedProof } from './proofs.js';
import { runPlaywright } from './playwrightProcess.js';
import { readRunLogs } from './runLogs.js';
import type { RunnerFailure } from './failureLog.js';
import { redact } from './secrets.js';
import { loadStory, type LoadedStory } from './story.js';
import type { StepResult } from './workflow.js';

export interface CertificationResult {
  green: boolean;
  cancelled?: boolean;
  /** Structured session/provider failure reported by the child runner. Never an app defect. */
  failure?: RunnerFailure;
  heals?: HealRecord[];
  routeFailures: string[];
  proofFailures: string[];
  steps?: StepResult[];
  proofs?: ProofRecord[];
  artifacts?: string[];
}

export interface StoryCommandResult {
  report?: StoryReport;
  resultPath?: string;
  failureKind?: FailureKind;
  recovery?: 'element' | 'route';
  ok: boolean;
  unchanged?: boolean;
  saved?: string;
  candidate?: string;
  reason?: string;
  certification?: CertificationResult;
}

export interface StoryAttemptOptions {
  file: string;
  root?: string;
  visible?: boolean;
  maxSteps?: number;
  discover?: (request: StoryDiscoveryRequest) => Promise<StoryDiscovery>;
  replay?: (file: string, loaded: LoadedStory) => Promise<CertificationResult | boolean>;
  repair?: (file: string, loaded: LoadedStory) => Promise<CertificationResult>;
}

function candidatePath(root: string): string {
  return resolve(root, 'candidates', `candidate.${process.pid}.${randomUUID()}.spec.ts`);
}

function display(root: string, file: string): string {
  return relative(root, file).replaceAll(sep, '/');
}

function expectedClauses(loaded: LoadedStory): string[] {
  return [...loaded.story.proofs.must, ...loaded.story.proofs.mustNot].map((clause) => clause.id);
}

function recordFileMatches(record: { file?: string }, file: string): boolean {
  return Boolean(record.file) && resolve(record.file as string) === resolve(file);
}

export function certificationGreen(
  exitCode: number,
  steps: StepResult[],
  proofs: ProofRecord[],
  expected: string[],
): CertificationResult {
  const routeFailures: string[] = [];
  if (exitCode !== 0) routeFailures.push(`Playwright exited ${exitCode}`);
  if (!steps.length) routeFailures.push('no route steps recorded');
  for (const step of steps) {
    if (step.status !== 'ok') routeFailures.push(`${step.intent}: ${step.status}`);
  }

  const proofFailures: string[] = [];
  for (const clauseId of expected) {
    const matches = proofs.filter((record) => record.clauseId === clauseId);
    if (matches.length !== 1) {
      proofFailures.push(`${clauseId}: expected 1 result, found ${matches.length}`);
      continue;
    }
    if (matches[0].status !== 'pass') proofFailures.push(`${clauseId}: ${matches[0].status}: ${matches[0].message}`);
  }
  for (const record of proofs) {
    if (!expected.includes(record.clauseId)) proofFailures.push(`${record.clauseId}: unexpected proof result`);
  }
  if (proofs.length !== expected.length && !proofFailures.length) {
    proofFailures.push(`expected ${expected.length} proof results, found ${proofs.length}`);
  }
  return { green: routeFailures.length === 0 && proofFailures.length === 0, routeFailures, proofFailures };
}

function discoveryProofsGreen(records: ProofRecord[], expected: string[]): CertificationResult {
  return { ...certificationGreen(0, [{ intent: 'discovery route', status: 'ok', usedLocator: 'discovery' }], records, expected), proofs: records };
}

export async function replayStoryRoute(file: string, loaded: LoadedStory, options: { healing?: boolean } = {}): Promise<CertificationResult> {
  const evidenceDir = resolve(loaded.root, '.schwifly', 'certifications', `${process.pid}.${randomUUID()}`);
  const stepLog = resolve(evidenceDir, 'steps.ndjson');
  const proofLog = resolve(evidenceDir, 'proofs.ndjson');
  mkdirSync(evidenceDir, { recursive: true });
  const artifactLog = resolve(evidenceDir, 'artifacts.ndjson');
  const healLog = resolve(evidenceDir, 'heals.ndjson');
  const failureLog = resolve(evidenceDir, 'failure.ndjson');
  const run = await runPlaywright(['test', file, '--reporter=line'], {
    encoding: 'utf8',
    cwd: loaded.root,
    env: {
      ...process.env,
      SCHWIFLY_NO_HEAL: options.healing ? '0' : '1',
      SCHWIFLY_STORY_FILE: loaded.file,
      SCHWIFLY_HEAL_LOG: healLog,
      SCHWIFLY_STEP_LOG: stepLog,
      SCHWIFLY_PROOF_LOG: proofLog,
      SCHWIFLY_ARTIFACT_LOG: artifactLog,
      SCHWIFLY_FAILURE_LOG: failureLog,
    },
  });
  const steps = readRunLogs<StepResult>(stepLog).filter((record) => recordFileMatches(record, file));
  const proofs = readRunLogs<ProofRecord>(proofLog).filter(
    (record) => record.storyId === loaded.story.id && recordFileMatches(record, file),
  );
  const gateSteps = options.healing ? steps.map(step => ({ ...step, status: step.status === 'healed' ? 'ok' as const : step.status })) : steps;
  const result = certificationGreen(run.status ?? 1, gateSteps, proofs, expectedClauses(loaded));
  const heals = readRunLogs<HealRecord>(healLog).filter(record => recordFileMatches(record, file));
  // The child boundary reduces a session failure to a bare exit code. Its recorded reason names
  // the real cause and keeps the caller from paying for a repair the app cannot fix.
  const failure = readRunLogs<RunnerFailure>(failureLog)[0];
  if (failure) {
    result.green = false;
    result.routeFailures.unshift(`${failure.kind}: ${failure.reason}`);
  }
  if (result.green) rmSync(evidenceDir, { recursive: true, force: true });
  const artifacts = readRunLogs<{ path: string }>(artifactLog).map(record => record.path);
  if (!result.green) {
    const runnerLog = resolve(evidenceDir, 'runner.txt');
    writeFileSync(runnerLog, redact(run.stdout + run.stderr));
    artifacts.push(runnerLog);
  }
  return { ...result, steps, proofs, heals, artifacts, cancelled: run.cancelled, ...(failure ? { failure } : {}) };
}

async function replay(
  option: StoryAttemptOptions['replay'],
  file: string,
  loaded: LoadedStory,
): Promise<CertificationResult> {
  const result = await (option ?? replayStoryRoute)(file, loaded);
  return typeof result === 'boolean'
    ? { green: result, routeFailures: result ? [] : ['route replay failed'], proofFailures: [] }
    : result;
}

function proofFailureReason(prefix: string, result: CertificationResult): string {
  const route = result.routeFailures.length ? `route failures: ${result.routeFailures.join('; ')}` : '';
  const proofs = result.proofFailures.length ? `proof failures: ${result.proofFailures.join('; ')}` : '';
  return redact(`${prefix}${[route, proofs].filter(Boolean).join(' | ')}`);
}

async function discover(
  options: StoryAttemptOptions,
  loaded: LoadedStory,
  proofs: ValidatedProof[],
): Promise<StoryDiscovery> {
  if (!options.discover && !hasModelKey()) {
    throw new ProviderError('story discovery needs an LLM key (OPENROUTER_API_KEY)');
  }
  return (options.discover ?? liveDiscoverStory)({
    loaded,
    proofs,
    maxSteps: discoverySteps(options.maxSteps),
    visible: options.visible ?? false,
  });
}

function writeCandidate(file: string, source: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source, { flag: 'wx' });
}

export async function attemptStory(options: StoryAttemptOptions): Promise<StoryCommandResult> {
  return reportOperation(options, state => attemptStoryWork(options, state));
}

async function attemptStoryWork(options: StoryAttemptOptions, state: OperationState): Promise<StoryCommandResult> {
  const loaded = loadStory(options.file, options.root);
  state.loaded = loaded;
  if (existsSync(loaded.routeFile)) {
    return { ok: false, reason: redact(`route already exists: ${display(loaded.root, loaded.routeFile)}`) };
  }
  const proofs = await loadAndValidateProofs(loaded);
  state.phase = 'discovery';
  const found = await discover(options, loaded, proofs);
  state.actions = found.actions;
  state.artifacts.push(...found.artifacts ?? []);
  const discoveryGate = discoveryProofsGreen(found.proofs, expectedClauses(loaded));
  if (!discoveryGate.green) {
    return { ok: false, reason: proofFailureReason('discovery failed: ', discoveryGate), certification: discoveryGate };
  }
  const steps = normalizeActions(found.actions);
  if (!steps.length) return { ok: false, reason: 'discovery recorded no successful route actions' };

  const candidate = candidatePath(loaded.root);
  writeCandidate(candidate, emitStory({ loaded, steps, outputFile: candidate }));
  state.phase = 'certification';
  const candidateGate = await replay(options.replay, candidate, loaded);
  if (!candidateGate.green) {
    return {
      ok: false,
      candidate: display(loaded.root, candidate),
      reason: proofFailureReason(`certification failed; candidate kept at ${display(loaded.root, candidate)}: `, candidateGate),
      certification: candidateGate,
    };
  }

  const source = emitStory({ loaded, steps });
  try {
    mkdirSync(dirname(loaded.routeFile), { recursive: true });
    writeFileSync(loaded.routeFile, source, { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return {
        ok: false,
        candidate: display(loaded.root, candidate),
        reason: redact(`route already exists: ${display(loaded.root, loaded.routeFile)}; candidate kept at ${display(loaded.root, candidate)}`),
      };
    }
    throw error;
  }
  rmSync(candidate, { force: true });
  return { ok: true, saved: display(loaded.root, loaded.routeFile), certification: candidateGate };
}

export async function rebuildStory(options: StoryAttemptOptions): Promise<StoryCommandResult> {
  return reportOperation(options, state => rebuildStoryWork(options, state));
}

async function rebuildStoryWork(options: StoryAttemptOptions, state: OperationState): Promise<StoryCommandResult> {
  const loaded = loadStory(options.file, options.root);
  state.loaded = loaded;
  if (!existsSync(loaded.routeFile)) {
    return { ok: false, reason: `route does not exist: ${display(loaded.root, loaded.routeFile)}` };
  }
  const proofs = await loadAndValidateProofs(loaded);
  state.phase = 'replay';
  const currentGate = await replay(options.replay, loaded.routeFile, loaded);
  if (currentGate.green) {
    return { ok: true, unchanged: true, saved: display(loaded.root, loaded.routeFile), certification: currentGate };
  }

  if (currentGate.cancelled) return { ok: false, reason: 'rebuild cancelled; prior route preserved', certification: currentGate };
  // A session, provider, or deadline failure breaks discovery too. Rediscovering would only
  // repeat it, so the prior route is preserved and the real reason is reported.
  if (currentGate.failure) {
    return {
      ok: false,
      failureKind: currentGate.failure.kind,
      saved: display(loaded.root, loaded.routeFile),
      reason: proofFailureReason(`replay failed; preserved ${display(loaded.root, loaded.routeFile)}: `, currentGate),
      certification: currentGate,
    };
  }
  state.artifacts.push(...currentGate.artifacts ?? []);
  const original = readFileSync(loaded.routeFile, 'utf8');
  state.phase = 'discovery';
  const found = await discover(options, loaded, proofs);
  state.actions = found.actions;
  state.artifacts.push(...found.artifacts ?? []);
  const discoveryGate = discoveryProofsGreen(found.proofs, expectedClauses(loaded));
  if (!discoveryGate.green) {
    return {
      ok: false,
      saved: display(loaded.root, loaded.routeFile),
      reason: proofFailureReason(`discovery failed; preserved ${display(loaded.root, loaded.routeFile)}: `, discoveryGate),
      certification: discoveryGate,
    };
  }
  const steps = normalizeActions(found.actions);
  if (!steps.length) {
    return { ok: false, saved: display(loaded.root, loaded.routeFile), reason: `discovery recorded no route actions; preserved ${display(loaded.root, loaded.routeFile)}` };
  }

  const candidate = candidatePath(loaded.root);
  writeCandidate(candidate, emitStory({ loaded, steps, outputFile: candidate }));
  state.phase = 'certification';
  const candidateGate = await replay(options.replay, candidate, loaded);
  if (!candidateGate.green) {
    return {
      ok: false,
      saved: display(loaded.root, loaded.routeFile),
      candidate: display(loaded.root, candidate),
      reason: proofFailureReason(
        `certification failed; preserved ${display(loaded.root, loaded.routeFile)}; candidate kept at ${display(loaded.root, candidate)}: `,
        candidateGate,
      ),
      certification: candidateGate,
    };
  }

  if (readFileSync(loaded.routeFile, 'utf8') !== original) {
    return {
      ok: false,
      saved: display(loaded.root, loaded.routeFile),
      candidate: display(loaded.root, candidate),
      reason: `route changed during rebuild; preserved the concurrent change and kept candidate at ${display(loaded.root, candidate)}`,
    };
  }

  const replacement = `${loaded.routeFile}.replacement.${process.pid}.${randomUUID()}`;
  try {
    writeFileSync(replacement, emitStory({ loaded, steps }), { flag: 'wx' });
    if (readFileSync(loaded.routeFile, 'utf8') !== original) {
      return {
        ok: false,
        saved: display(loaded.root, loaded.routeFile),
        candidate: display(loaded.root, candidate),
        reason: `route changed during rebuild; preserved the concurrent change and kept candidate at ${display(loaded.root, candidate)}`,
      };
    }
    renameSync(replacement, loaded.routeFile);
  } finally {
    rmSync(replacement, { force: true });
  }
  rmSync(candidate, { force: true });
  return { ok: true, saved: display(loaded.root, loaded.routeFile), certification: candidateGate };
}

export async function runStory(options: StoryAttemptOptions): Promise<StoryCommandResult> {
  return reportOperation(options, async state => {
    const loaded = loadStory(options.file, options.root);
    state.loaded = loaded;
    await loadAndValidateProofs(loaded);
    state.phase = 'replay';
    if (!existsSync(loaded.routeFile)) return { ok: false, reason: 'route does not exist; run schwifly attempt first' };
    const original = readFileSync(loaded.routeFile, 'utf8');
    const initial = await replay(options.replay, loaded.routeFile, loaded);
    const failed = (certification = initial): StoryCommandResult => ({ ok: false, saved: display(loaded.root, loaded.routeFile),
      failureKind: certification.failure?.kind, certification,
      reason: proofFailureReason(`${state.phase} failed; prior route preserved: `, certification) });
    if (initial.green) return { ok: true, unchanged: true, saved: display(loaded.root, loaded.routeFile), certification: initial };
    // Successful route actions plus failed proofs identify an outcome regression, not a locator
    // defect. A recorded session failure is infrastructure, which no repair or rebuild can fix.
    if (initial.cancelled || initial.failure || process.env.SCHWIFLY_NO_HEAL === '1' ||
        (initial.steps?.length && initial.steps.every(step => step.status === 'ok'))) return failed();
    state.phase = 'repair';
    const repaired = await (options.repair ?? ((file, loaded) => replayStoryRoute(file, loaded, { healing: true })))(loaded.routeFile, loaded);
    state.artifacts.push(...repaired.artifacts ?? []);
    if (repaired.cancelled || repaired.failure) return failed(repaired);
    if (repaired.green && repaired.heals?.length) {
      const candidate = candidatePath(loaded.root);
      try {
        writeCandidate(candidate, original);
        const applied = repaired.heals.every(heal => applyHeal({ ...heal, file: candidate }));
        if (applied) {
          state.phase = 'certification';
          const certified = await replay(options.replay, candidate, loaded);
          if (certified.cancelled || certified.failure) return failed(certified);
          state.artifacts.push(...certified.artifacts ?? []);
          if (certified.green) {
            if (readFileSync(loaded.routeFile, 'utf8') !== original) return { ...failed(), reason: 'route changed during repair; preserved the concurrent change' };
            const replacement = readFileSync(candidate, 'utf8');
            const pending = `${loaded.routeFile}.replacement.${randomUUID()}`;
            try {
              writeFileSync(pending, replacement, { flag: 'wx' });
              if (readFileSync(loaded.routeFile, 'utf8') !== original) return { ...failed(), reason: 'route changed during repair; preserved the concurrent change' };
              renameSync(pending, loaded.routeFile);
            } finally { rmSync(pending, { force: true }); }
            state.artifacts.push(writeRepairDiff(loaded.root, display(loaded.root, loaded.routeFile), original, replacement));
            return { ok: true, recovery: 'element', saved: display(loaded.root, loaded.routeFile), certification: certified };
          }
        }
      } finally {
        // The established route or a rebuild candidate owns the result after this trial.
        rmSync(candidate, { force: true });
      }
    }
    if (readFileSync(loaded.routeFile, 'utf8') !== original) return { ...failed(), reason: 'route changed during repair; preserved the concurrent change' };
    if (!options.discover && !hasModelKey()) return failed();
    state.phase = 'rebuild';
    // Reuse the initial failed replay. rebuildStory still requires independent candidate certification.
    const rebuilt = await rebuildStory({ ...options, replay: (file, current) =>
      resolve(file) === loaded.routeFile ? Promise.resolve(initial) : replay(options.replay, file, current) });
    state.actions = rebuilt.report?.observedActions ?? [];
    state.phase = rebuilt.report?.phase ?? 'rebuild';
    state.artifacts.push(...(rebuilt.report?.artifacts ?? []).map(file => resolve(loaded.root, file)));
    if (rebuilt.ok) {
      state.artifacts.push(writeRepairDiff(loaded.root, display(loaded.root, loaded.routeFile), original, readFileSync(loaded.routeFile, 'utf8')));
    }
    return { ...rebuilt, recovery: rebuilt.ok ? 'route' : undefined,
      failureKind: rebuilt.report?.failure?.kind };
  });
}
