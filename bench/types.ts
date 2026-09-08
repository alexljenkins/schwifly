import type { StoryDiscovery, StoryDiscoveryRequest } from '../src/attempt.js';
import type { CertificationResult, StoryAttemptOptions } from '../src/storyAttempt.js';
import type { FailureKind, Phase } from '../src/result.js';
import type { LoadedStory } from '../src/story.js';
import type { ModelUsage } from '../src/modelMeter.js';

/**
 * The version seam. One benchmark run drives exactly one engine, and the report never mixes
 * engines in a single measurement.
 *
 * A Stagehand v4 branch adds a second file next to `engines/stagehand37.ts` that exports this
 * same shape and registers it. It changes no scenario, no metric, and no report code. If a
 * migration cannot be expressed as these 3 functions, the comparison is not like for like and
 * the report must say so instead of hiding it.
 */
export interface BenchEngine {
  /** Stable id used in file names, tables, and the --engine flag. */
  id: string;
  /** One line naming the browser driver and the AI library under test. */
  label: string;
  /** Dependency versions recorded in the report header, so old results stay auditable. */
  versions(): Record<string, string>;
  /** Model-driven route discovery. Wired straight into StoryAttemptOptions.discover. */
  discover(request: StoryDiscoveryRequest): Promise<StoryDiscovery>;
  /** Deterministic replay. Omit to use Schwifly's Playwright gate. */
  replay?: (file: string, loaded: LoadedStory) => Promise<CertificationResult>;
  /** Bounded repair. Omit to use Schwifly's healing Playwright gate. */
  repair?: (file: string, loaded: LoadedStory) => Promise<CertificationResult>;
}

/** The app behaviour a scenario runs against. `baseline` is the only correct one. */
export type AppVariant =
  | 'baseline'
  | 'moved-control'
  | 'broken-persistence'
  | 'duplicate-submit'
  | 'slow-update';

/** Which Schwifly entry point the scenario measures. */
export type BenchOperation = 'attempt' | 'run';

export interface BenchScenario {
  id: string;
  title: string;
  /** The row of the assessment's evidence table this scenario answers. */
  evidence: string;
  variant: AppVariant;
  operation: BenchOperation;
  /** `certified` means the route survived. `failed` means the harness requires a failure. */
  expect: 'certified' | 'failed';
  /** A required failure must be classified as one of these. Any other kind is a wrong verdict. */
  expectFailureKind?: FailureKind[];
  /** Reuse the route saved by an earlier scenario, or start with no route on disk. */
  route: 'none' | 'saved';
  /** Certification requires no more model calls than this. Use 0 for an unchanged replay. */
  maxModelCalls?: number;
  /** Replace the provider key with an invalid one, so every model request is refused. */
  breakModel?: boolean;
}

export interface BenchMeasurement {
  scenario: string;
  engine: string;
  repetition: number;
  /** Did the run match the scenario's expectation, including its failure classification? */
  met: boolean;
  status: 'certified' | 'failed';
  failureKind: FailureKind | null;
  phase: Phase;
  /** Wall clock for the whole operation, including the browser and every child process. */
  durationMs: number;
  model: ModelUsage & { costUsd: number | null };
  /** Browser actions the engine captured during discovery. */
  actions: number;
  /** Deterministic route steps replayed, and how many of them failed. */
  steps: { total: number; failed: number };
  /** How the route recovered, when it did. */
  repaired: 'element' | 'route' | null;
  reason: string | null;
}

export interface BenchRun {
  version: 1;
  engine: { id: string; label: string; versions: Record<string, string> };
  model: string;
  /** USD per million tokens actually used to price this run, or null when lookup failed. */
  price: { inputPerMTok: number; outputPerMTok: number; source: string } | null;
  startedAt: string;
  finishedAt: string;
  repeat: number;
  host: { platform: string; arch: string; cpus: number; node: string };
  measurements: BenchMeasurement[];
  notes: string[];
}

export type BenchAttemptOptions = Pick<StoryAttemptOptions, 'discover' | 'replay' | 'repair'>;
