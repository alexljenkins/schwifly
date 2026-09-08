import { copyFileSync, existsSync, rmSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { attemptStory, runStory, type StoryCommandResult } from '../src/storyAttempt.js';
import { clearModelCalls, readModelCalls, summarizeModelCalls } from '../src/modelMeter.js';
import { DEFAULT_MODEL } from '../src/llm.js';
import { selectedModel } from '../src/settings.js';
import { costUsd, lookupPrice } from './pricing.js';
import { openWorkspace, type BenchWorkspace } from './workspace.js';
import type { BenchEngine, BenchMeasurement, BenchRun, BenchScenario } from './types.js';

export interface RunnerOptions {
  engine: BenchEngine;
  scenarios: BenchScenario[];
  repeat: number;
  onProgress?: (line: string) => void;
}

function withEnv<T>(overrides: Record<string, string | undefined>, work: () => Promise<T>): Promise<T> {
  const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  const apply = (values: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  apply(overrides);
  return work().finally(() => apply(previous));
}

/**
 * One scenario, once. Wall clock covers the whole operation including every child process, so
 * an engine cannot look fast by moving work into a subprocess.
 */
async function measure(
  scenario: BenchScenario,
  repetition: number,
  options: RunnerOptions,
  workspace: BenchWorkspace,
  baselineRoute: string,
): Promise<BenchMeasurement> {
  const { engine } = options;
  workspace.setVariant(scenario.variant);
  if (scenario.route === 'none') workspace.clearRoute();
  else if (existsSync(baselineRoute)) copyFileSync(baselineRoute, workspace.routeFile);

  const modelLog = resolve(workspace.root, 'model-calls.ndjson');
  clearModelCalls(modelLog);

  const attempt = {
    file: workspace.storyFile,
    root: workspace.root,
    discover: engine.discover,
    ...(engine.replay ? { replay: engine.replay } : {}),
    ...(engine.repair ? { repair: engine.repair } : {}),
  };
  const started = performance.now();
  const result = await withEnv({
    SCHWIFLY_ROOT: workspace.root,
    SCHWIFLY_MODEL_LOG: modelLog,
    SCHWIFLY_NO_HEAL: undefined,
    ...(scenario.breakModel ? { OPENROUTER_API_KEY: 'sk-or-benchmark-invalid-key' } : {}),
  }, () => (scenario.operation === 'attempt' ? attemptStory(attempt) : runStory(attempt)));
  const durationMs = Math.round(performance.now() - started);

  const usage = summarizeModelCalls(readModelCalls(modelLog));
  const report = result.report;
  const captured = report?.observedActions ?? [];
  const replayed = result.certification?.steps ?? [];
  const measurement: BenchMeasurement = {
    scenario: scenario.id,
    engine: engine.id,
    repetition,
    met: meetsExpectation(scenario, result, usage.calls),
    status: report?.status ?? (result.ok ? 'certified' : 'failed'),
    failureKind: report?.failure?.kind ?? null,
    phase: report?.phase ?? 'replay',
    durationMs,
    model: { ...usage, costUsd: null },
    actions: captured.length,
    steps: { total: replayed.length, failed: replayed.filter((step) => step.status !== 'ok').length },
    repaired: result.recovery ?? null,
    reason: result.reason ?? null,
  };
  if (scenario.operation === 'attempt' && result.ok) copyFileSync(workspace.routeFile, baselineRoute);
  return measurement;
}

function meetsExpectation(scenario: BenchScenario, result: StoryCommandResult, calls: number): boolean {
  if (scenario.maxModelCalls !== undefined && calls > scenario.maxModelCalls) return false;
  if (scenario.expect === 'certified') return result.ok;
  if (result.ok) return false;
  const kind = result.report?.failure?.kind;
  return !scenario.expectFailureKind || (!!kind && scenario.expectFailureKind.includes(kind));
}

export async function runBenchmark(options: RunnerOptions): Promise<BenchRun> {
  const model = selectedModel(DEFAULT_MODEL);
  const price = await lookupPrice(model);
  const startedAt = new Date().toISOString();
  const workspace = await openWorkspace(`${options.engine.id}.${process.pid}`);
  const baselineRoute = resolve(workspace.root, 'baseline-route.spec.ts.saved');
  const measurements: BenchMeasurement[] = [];
  const notes: string[] = [];
  if (!price) notes.push(`no price found for ${model}; token counts are recorded and cost is empty`);

  try {
    for (let repetition = 1; repetition <= options.repeat; repetition++) {
      rmSync(baselineRoute, { force: true });
      for (const scenario of options.scenarios) {
        // A scenario that replays a saved route cannot run before one exists.
        if (scenario.route === 'saved' && !existsSync(baselineRoute)) {
          notes.push(`${scenario.id} skipped in repetition ${repetition}: no certified route to replay`);
          continue;
        }
        options.onProgress?.(`run ${repetition}/${options.repeat} ${scenario.id}`);
        const measurement = await measure(scenario, repetition, options, workspace, baselineRoute);
        measurement.model.costUsd = costUsd(price, measurement.model);
        measurements.push(measurement);
        options.onProgress?.(
          `  ${measurement.met ? 'met' : 'MISSED'} ${measurement.status}` +
          `${measurement.failureKind ? ` (${measurement.failureKind})` : ''}` +
          ` ${measurement.durationMs}ms ${measurement.model.calls} model calls`,
        );
      }
    }
  } finally {
    await workspace.close();
  }

  if (measurements.some((measurement) => measurement.model.partialTokens)) {
    notes.push('at least one model call reported no token count, so token and cost totals are a lower bound');
  }
  return {
    version: 1,
    engine: { id: options.engine.id, label: options.engine.label, versions: options.engine.versions() },
    model,
    price,
    startedAt,
    finishedAt: new Date().toISOString(),
    repeat: options.repeat,
    host: { platform: process.platform, arch: process.arch, cpus: cpus().length, node: process.version },
    measurements,
    notes,
  };
}
