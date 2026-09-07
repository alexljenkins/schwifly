import { discoverySteps } from './limits';
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
import { liveDiscoverStory, MAX_STEPS, type StoryDiscovery, type StoryDiscoveryRequest } from './attempt';
import { normalizeActions } from './capture';
import { emitStory } from './emit';
import { loadAndValidateProofs, type ProofRecord, type ValidatedProof } from './proofs';
import { runPlaywright } from './playwrightProcess';
import { readRunLogs } from './runLogs';
import { redact } from './secrets';
import { loadStory, type LoadedStory } from './story';
import type { StepResult } from './workflow';

export interface CertificationResult {
  green: boolean;
  routeFailures: string[];
  proofFailures: string[];
}

export interface StoryCommandResult {
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
  return certificationGreen(0, [{ intent: 'discovery route', status: 'ok', usedLocator: 'discovery' }], records, expected);
}

export async function replayStoryRoute(file: string, loaded: LoadedStory): Promise<CertificationResult> {
  const evidenceDir = resolve(loaded.root, '.schwifly', 'certifications', `${process.pid}.${randomUUID()}`);
  const stepLog = resolve(evidenceDir, 'steps.ndjson');
  const proofLog = resolve(evidenceDir, 'proofs.ndjson');
  const run = await runPlaywright(['test', file, '--reporter=line'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      SCHWIFLY_NO_HEAL: '1',
      SCHWIFLY_STEP_LOG: stepLog,
      SCHWIFLY_PROOF_LOG: proofLog,
    },
  });
  const steps = readRunLogs<StepResult>(stepLog).filter((record) => recordFileMatches(record, file));
  const proofs = readRunLogs<ProofRecord>(proofLog).filter(
    (record) => record.storyId === loaded.story.id && recordFileMatches(record, file),
  );
  const result = certificationGreen(run.status ?? 1, steps, proofs, expectedClauses(loaded));
  if (result.green) rmSync(evidenceDir, { recursive: true, force: true });
  return result;
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
  if (!options.discover) {
    const { llmConfigFromEnv } = await import('./llm');
    if (!llmConfigFromEnv()) {
      throw new Error('story discovery needs an LLM key (e.g. GEMINI_API_KEY)');
    }
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
  const loaded = loadStory(options.file, options.root);
  if (existsSync(loaded.routeFile)) {
    return { ok: false, reason: redact(`route already exists: ${display(loaded.root, loaded.routeFile)}`) };
  }
  const proofs = await loadAndValidateProofs(loaded);
  const found = await discover(options, loaded, proofs);
  const discoveryGate = discoveryProofsGreen(found.proofs, expectedClauses(loaded));
  if (!discoveryGate.green) {
    return { ok: false, reason: proofFailureReason('discovery failed: ', discoveryGate), certification: discoveryGate };
  }
  const steps = normalizeActions(found.actions);
  if (!steps.length) return { ok: false, reason: 'discovery recorded no successful route actions' };

  const candidate = candidatePath(loaded.root);
  writeCandidate(candidate, emitStory({ loaded, steps, outputFile: candidate }));
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
  const loaded = loadStory(options.file, options.root);
  if (!existsSync(loaded.routeFile)) {
    return { ok: false, reason: `route does not exist: ${display(loaded.root, loaded.routeFile)}` };
  }
  const proofs = await loadAndValidateProofs(loaded);
  const currentGate = await replay(options.replay, loaded.routeFile, loaded);
  if (currentGate.green) {
    return { ok: true, unchanged: true, saved: display(loaded.root, loaded.routeFile), certification: currentGate };
  }

  const original = readFileSync(loaded.routeFile, 'utf8');
  const found = await discover(options, loaded, proofs);
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
