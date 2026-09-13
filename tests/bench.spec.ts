import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearModelCalls, readModelCalls, recordModelCall, summarizeModelCalls } from '../src/modelMeter';
import { costUsd } from '../bench/pricing';
import { median, renderComparison, renderRun, summarize } from '../bench/report';
import { selectScenarios, SCENARIOS } from '../bench/scenarios';
import { runBenchmark } from '../bench/runner';
import type { BenchEngine, BenchMeasurement, BenchRun } from '../bench/types';
import { parseBrowserDecision, snapshotDescription, snapshotReplaySelector } from '../bench/engines/stagehand4';

function measurement(overrides: Partial<BenchMeasurement> = {}): BenchMeasurement {
  return {
    scenario: 'discover', engine: 'fake', repetition: 1, met: true, status: 'certified',
    failureKind: null, phase: 'certification', durationMs: 1000,
    model: { calls: 2, failedCalls: 0, inputTokens: 100, outputTokens: 20, cachedInputTokens: 0, latencyMs: 300, partialTokens: false, costUsd: 0.001 },
    actions: 3, steps: { total: 3, failed: 0 }, repaired: null, reason: null, ...overrides,
  };
}

function run(overrides: Partial<BenchRun> = {}): BenchRun {
  return {
    version: 1, engine: { id: 'fake', label: 'Fake engine', versions: { fake: '1.0.0' } },
    model: 'google/gemini-3.8-flash', price: { inputPerMTok: 0.75, outputPerMTok: 3.75, source: 'test' },
    startedAt: '2026-09-08T00:00:00.000Z', finishedAt: '2026-09-08T00:01:00.000Z', repeat: 1,
    host: { platform: 'linux', arch: 'x64', cpus: 8, node: 'v22.6.0' },
    measurements: [measurement()], notes: [], ...overrides,
  };
}

test('the model meter totals tokens across processes and flags missing counts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'schwifly-meter-'));
  const log = join(dir, 'calls.ndjson');
  try {
    recordModelCall({ model: 'm', call: 1, ms: 100, inputTokens: 10, outputTokens: 5, cachedInputTokens: 2, ok: true }, log);
    recordModelCall({ model: 'm', call: 2, ms: 50, inputTokens: null, outputTokens: null, cachedInputTokens: null, ok: false }, log);
    // A refused call reports no tokens by definition, so it must not mark the totals partial.
    expect(summarizeModelCalls(readModelCalls(log))).toMatchObject({ calls: 2, failedCalls: 1, inputTokens: 10, outputTokens: 5, latencyMs: 150, partialTokens: false });
    recordModelCall({ model: 'm', call: 3, ms: 20, inputTokens: null, outputTokens: null, cachedInputTokens: null, ok: true }, log);
    const usage = summarizeModelCalls(readModelCalls(log));
    expect(usage).toMatchObject({ calls: 3, failedCalls: 1, partialTokens: true });
    clearModelCalls(log);
    expect(readModelCalls(log)).toEqual([]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the meter writes nothing when no log is configured', () => {
  expect(() => recordModelCall({ model: 'm', call: 1, ms: 1, inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, ok: true }, undefined)).not.toThrow();
});

test('cost uses the looked-up price and stays empty without one', () => {
  expect(costUsd({ inputPerMTok: 0.75, outputPerMTok: 3.75, source: 'test' }, { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(4.5, 6);
  expect(costUsd(null, { inputTokens: 10, outputTokens: 10 })).toBeNull();
});

test('median returns the middle value and averages an even count', () => {
  expect(median([5, 1, 3])).toBe(3);
  expect(median([1, 2, 3, 4])).toBe(3);
  expect(median([])).toBe(0);
});

test('a scenario whose repeated runs disagree is reported as intermittent', () => {
  const report = run({
    repeat: 2,
    measurements: [
      measurement({ repetition: 1, durationMs: 1000 }),
      measurement({ repetition: 2, durationMs: 3000, met: false, status: 'failed', failureKind: 'route_failure', reason: 'locator missing' }),
    ],
  });
  const [summary] = summarize(report);
  expect(summary).toMatchObject({ runs: 2, met: 1, flaky: true, medianMs: 2000, slowestMs: 3000 });
  const markdown = renderRun(report);
  expect(markdown).toContain('## Intermittent results');
  expect(markdown).toContain('## Missed evidence');
  expect(markdown).toContain('locator missing');
});

test('a run with no price records tokens and leaves cost empty', () => {
  const markdown = renderRun(run({
    price: null,
    notes: ['no price found for google/gemini-3.8-flash; token counts are recorded and cost is empty'],
    measurements: [measurement({ model: { ...measurement().model, costUsd: null } })],
  }));
  expect(markdown).toContain('| not found |');
  expect(markdown).toContain('n/a');
  expect(markdown).toContain('## Notes');
});

test('the comparison reports every run, engine medians, and a side-by-side summary', () => {
  const baseline = run();
  const candidate = run({
    engine: { id: 'fake-4', label: 'Fake engine 4', versions: { fake: '4.0.0' } },
    model: 'other/model',
    measurements: [measurement({ engine: 'fake-4', durationMs: 500, model: { ...measurement().model, calls: 1 } })],
  });
  const markdown = renderComparison(baseline, candidate);
  expect(markdown).toContain('## discover');
  expect(markdown).toContain('| v1.0 | 1 | 1.0s | 2 | $0.00100 | 3 | yes | certified |');
  expect(markdown).toContain('| v4.0 | median | 0.5s | 1 | $0.00100 | 3 | 1/1 | certified |');
  expect(markdown).toContain('## Median summary');
  expect(markdown).toContain('| Scenario | v1.0 time | v4.0 time | v1.0 model calls | v4.0 model calls | v1.0 cost | v4.0 cost | v1.0 pass | v4.0 pass |');
  expect(markdown).toContain('## Not like for like');
  expect(markdown).toContain('different models: google/gemini-3.8-flash versus other/model');
});

test('scenario selection keeps declaration order so a saved route exists before it replays', () => {
  expect(selectScenarios(['replay-unchanged', 'discover']).map((scenario) => scenario.id)).toEqual(['discover', 'replay-unchanged']);
  expect(selectScenarios()).toEqual(SCENARIOS);
  expect(() => selectScenarios(['nope'])).toThrow(/unknown scenario/);
});

test('the Stagehand v4 adapter accepts bounded actions and rejects malformed model output', () => {
  expect(parseBrowserDecision({ decision: 'action', nodeId: '0-5', action: 'click', value: '' }))
    .toEqual({ decision: 'action', nodeId: '0-5', action: 'click', value: '' });
  expect(() => parseBrowserDecision({ decision: 'action', nodeId: '0-5', action: 'evaluate', value: '' }))
    .toThrow(/invalid browser decision/);
});

test('the Stagehand v4 adapter names actions from browser facts', () => {
  const tree = '[0-1] RootWebArea\n  [0-5] button: New item\n  [0-6] textbox: Title';
  expect(snapshotDescription(tree, '0-5')).toBe('New item button');
  expect(snapshotDescription(tree, '0-6')).toBe('Title textbox');
  expect(snapshotReplaySelector(tree, '0-5', '/html/body/button')).toBe('role=button[name="New item"i]');
  expect(snapshotReplaySelector(tree, '0-6', '/html/body/input')).toBe('role=textbox[name="Title"i]');
  expect(snapshotReplaySelector(tree, 'missing', '/html/body')).toBe('xpath=/html/body');
});

// The harness end to end in a real browser, with a fake engine instead of a model, so the
// scenarios, the seeded defects, and the metrics are all proven without a key and offline.
// The scenarios that need a live provider are excluded on purpose; the live run covers those.
test('the harness certifies a route, replays it without model calls, and classifies seeded defects', async () => {
  test.setTimeout(600_000);
  const engine: BenchEngine = {
    id: 'fake-engine',
    label: 'Fake engine for verification',
    versions: () => ({ fake: '0.0.0' }),
    discover: async ({ loaded, proofs }) => {
      const { runProofs } = await import('../src/proofs');
      const { openConfiguredSession } = await import('../src/session');
      const session = await openConfiguredSession({ root: loaded.root, url: loaded.story.start.url, story: loaded.story, phase: 'discovery' });
      try {
        const { page } = session;
        const result = await runProofs({
          proofs, context: { page, browserContext: page.context() }, persist: false,
          route: async () => {
            await page.click('#new');
            await page.fill('#title', 'Buy milk');
            await page.click('#save');
          },
        });
        if (result.routeError) throw result.routeError;
        return {
          actions: [
            { method: 'click', selector: '#new', description: 'New item', args: [], ok: true },
            { method: 'fill', selector: '#title', description: 'Title', args: ['Buy milk'], ok: true },
            { method: 'click', selector: '#save', description: 'Save', args: [], ok: true },
          ],
          proofs: result.records,
          notes: 'fixed route, no model',
        };
      } finally { await session.close(); }
    },
  };

  const report = await runBenchmark({
    engine,
    repeat: 1,
    scenarios: selectScenarios(['discover', 'replay-unchanged', 'defect-persistence', 'defect-duplicate']),
  });
  const byScenario = Object.fromEntries(report.measurements.map((entry) => [entry.scenario, entry]));

  expect(byScenario.discover, JSON.stringify(report.measurements, null, 2)).toMatchObject({ met: true, status: 'certified', actions: 3 });
  expect(byScenario['replay-unchanged']).toMatchObject({ met: true, status: 'certified' });
  expect(byScenario['replay-unchanged'].model.calls).toBe(0);
  expect(byScenario['replay-unchanged'].steps).toEqual({ total: 3, failed: 0 });
  expect(byScenario['defect-persistence']).toMatchObject({ met: true, status: 'failed', failureKind: 'unmet_outcome' });
  expect(byScenario['defect-duplicate']).toMatchObject({ met: true, status: 'failed', failureKind: 'unmet_outcome' });
  expect(report.measurements.every((entry) => entry.durationMs > 0)).toBe(true);
  expect(renderRun(report)).toContain('| discover |');
});
