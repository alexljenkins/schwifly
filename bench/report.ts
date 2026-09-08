import { SCENARIOS } from './scenarios.js';
import type { BenchMeasurement, BenchRun } from './types.js';

export interface ScenarioSummary {
  scenario: string;
  title: string;
  evidence: string;
  runs: number;
  /** How many runs matched the scenario's required outcome and classification. */
  met: number;
  /** True when repeated runs of the same scenario disagreed. An intermittent failure. */
  flaky: boolean;
  medianMs: number;
  slowestMs: number;
  medianModelCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number | null;
  medianActions: number;
  repairs: number;
  outcomes: string[];
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function outcome(measurement: BenchMeasurement): string {
  if (measurement.status === 'certified') return measurement.repaired ? `repaired:${measurement.repaired}` : 'certified';
  return `failed:${measurement.failureKind ?? 'unknown'}`;
}

export function summarize(run: BenchRun): ScenarioSummary[] {
  const byScenario = new Map<string, BenchMeasurement[]>();
  for (const measurement of run.measurements) {
    byScenario.set(measurement.scenario, [...(byScenario.get(measurement.scenario) ?? []), measurement]);
  }
  return [...byScenario].map(([id, group]) => {
    const definition = SCENARIOS.find((scenario) => scenario.id === id);
    const costs = group.map((measurement) => measurement.model.costUsd);
    const outcomes = [...new Set(group.map(outcome))];
    return {
      scenario: id,
      title: definition?.title ?? id,
      evidence: definition?.evidence ?? '',
      runs: group.length,
      met: group.filter((measurement) => measurement.met).length,
      flaky: outcomes.length > 1,
      medianMs: median(group.map((measurement) => measurement.durationMs)),
      slowestMs: Math.max(...group.map((measurement) => measurement.durationMs)),
      medianModelCalls: median(group.map((measurement) => measurement.model.calls)),
      totalInputTokens: group.reduce((sum, measurement) => sum + measurement.model.inputTokens, 0),
      totalOutputTokens: group.reduce((sum, measurement) => sum + measurement.model.outputTokens, 0),
      totalCostUsd: costs.some((cost) => cost === null) ? null : costs.reduce<number>((sum, cost) => sum + (cost ?? 0), 0),
      medianActions: median(group.map((measurement) => measurement.actions)),
      repairs: group.filter((measurement) => measurement.repaired).length,
      outcomes,
    };
  });
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;
const usd = (value: number | null): string => (value === null ? 'n/a' : `$${value.toFixed(5)}`);
const row = (cells: (string | number)[]): string => `| ${cells.join(' | ')} |`;

export function renderRun(run: BenchRun): string {
  const summaries = summarize(run);
  const missed = summaries.filter((summary) => summary.met < summary.runs);
  const totalCost = summaries.some((summary) => summary.totalCostUsd === null)
    ? null
    : summaries.reduce((sum, summary) => sum + (summary.totalCostUsd ?? 0), 0);

  const lines = [
    `# Benchmark: ${run.engine.label}`,
    '',
    `Generated ${run.finishedAt}. Every scenario ran ${run.repeat} time${run.repeat === 1 ? '' : 's'}, one at a time.`,
    '',
    '## Setup',
    '',
    row(['Field', 'Value']),
    row(['---', '---']),
    row(['Engine', run.engine.id]),
    ...Object.entries(run.engine.versions).map(([name, value]) => row([name, value])),
    row(['Model', run.model]),
    row(['Price', run.price ? `$${run.price.inputPerMTok.toFixed(3)} in / $${run.price.outputPerMTok.toFixed(3)} out per million tokens` : 'not found']),
    row(['Host', `${run.host.platform} ${run.host.arch}, ${run.host.cpus} CPUs, Node ${run.host.node}`]),
    row(['Started', run.startedAt]),
    '',
    '## Results',
    '',
    row(['Scenario', 'Met', 'Median', 'Slowest', 'Model calls', 'In tokens', 'Out tokens', 'Cost', 'Actions', 'Outcome']),
    row(['---', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---']),
    ...summaries.map((summary) => row([
      summary.scenario,
      `${summary.met}/${summary.runs}`,
      seconds(summary.medianMs),
      seconds(summary.slowestMs),
      summary.medianModelCalls,
      summary.totalInputTokens,
      summary.totalOutputTokens,
      usd(summary.totalCostUsd),
      summary.medianActions,
      summary.outcomes.join(', '),
    ])),
    '',
    `Total model cost for this run: ${usd(totalCost)}.`,
    '',
    '## Required evidence',
    '',
    row(['Scenario', 'Required evidence', 'Verdict']),
    row(['---', '---', '---']),
    ...summaries.map((summary) => row([
      summary.scenario,
      summary.evidence,
      summary.met === summary.runs ? 'met' : `MISSED in ${summary.runs - summary.met} of ${summary.runs} runs`,
    ])),
    '',
  ];

  const flaky = summaries.filter((summary) => summary.flaky);
  if (flaky.length) {
    lines.push('## Intermittent results', '',
      ...flaky.map((summary) => `- ${summary.scenario} disagreed across runs: ${summary.outcomes.join(', ')}`), '');
  }
  if (missed.length) {
    lines.push('## Missed evidence', '',
      ...missed.flatMap((summary) => run.measurements
        .filter((measurement) => measurement.scenario === summary.scenario && !measurement.met)
        .map((measurement) => `- ${measurement.scenario} run ${measurement.repetition}: ${outcome(measurement)}. ${measurement.reason ?? 'no reason recorded'}`)),
      '');
  }
  if (run.notes.length) lines.push('## Notes', '', ...run.notes.map((note) => `- ${note}`), '');
  return lines.join('\n');
}

const delta = (before: number, after: number, format: (value: number) => string): string => {
  if (!before && !after) return '0';
  const change = before ? `${(((after - before) / before) * 100).toFixed(0)}%` : 'new';
  return `${format(before)} to ${format(after)} (${change})`;
};

/**
 * The comparison a Stagehand v4 branch produces. `baseline` is the older engine.
 * Both runs must use the same model, scenarios, and host, or the table is not evidence.
 */
export function renderComparison(baseline: BenchRun, candidate: BenchRun): string {
  const left = new Map(summarize(baseline).map((summary) => [summary.scenario, summary]));
  const right = new Map(summarize(candidate).map((summary) => [summary.scenario, summary]));
  const shared = [...left.keys()].filter((id) => right.has(id));
  const warnings = [
    ...(baseline.model === candidate.model ? [] : [`different models: ${baseline.model} versus ${candidate.model}`]),
    ...(baseline.host.platform === candidate.host.platform ? [] : ['different host platforms']),
    ...([...right.keys()].filter((id) => !left.has(id)).map((id) => `${id} ran only on ${candidate.engine.id}`)),
    ...([...left.keys()].filter((id) => !right.has(id)).map((id) => `${id} ran only on ${baseline.engine.id}`)),
  ];

  return [
    `# ${baseline.engine.label} versus ${candidate.engine.label}`,
    '',
    `Baseline ${baseline.engine.id} finished ${baseline.finishedAt}. Candidate ${candidate.engine.id} finished ${candidate.finishedAt}.`,
    '',
    row(['Scenario', 'Median time', 'Model calls', 'Cost', 'Actions', 'Evidence met']),
    row(['---', '---', '---', '---', '---', '---']),
    ...shared.map((id) => {
      const before = left.get(id)!;
      const after = right.get(id)!;
      return row([
        id,
        delta(before.medianMs, after.medianMs, seconds),
        delta(before.medianModelCalls, after.medianModelCalls, String),
        `${usd(before.totalCostUsd)} to ${usd(after.totalCostUsd)}`,
        delta(before.medianActions, after.medianActions, String),
        `${before.met}/${before.runs} to ${after.met}/${after.runs}`,
      ]);
    }),
    '',
    ...(warnings.length ? ['## Not like for like', '', ...warnings.map((warning) => `- ${warning}`), ''] : []),
  ].join('\n');
}
