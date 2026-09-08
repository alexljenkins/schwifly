import type { BenchScenario } from './types.js';

/**
 * The evidence table from docs/stagehand-v4-product-assessment.md, made runnable.
 *
 * Order matters. `discover` writes the route every later scenario replays, so the list runs in
 * sequence and a repetition repeats the whole sequence rather than one row.
 */
export const SCENARIOS: BenchScenario[] = [
  {
    id: 'discover',
    title: 'Discover the add-task flow and save a route',
    evidence: 'Discover a product flow and save it.',
    variant: 'baseline',
    operation: 'attempt',
    expect: 'certified',
    route: 'none',
  },
  {
    id: 'replay-unchanged',
    title: 'Replay the saved route against the unchanged app',
    evidence: 'A fresh replay passes with 0 model calls.',
    variant: 'baseline',
    operation: 'run',
    expect: 'certified',
    route: 'saved',
    maxModelCalls: 0,
  },
  {
    id: 'repair-moved-control',
    title: 'Repair a renamed control without changing behaviour',
    evidence: 'A bounded repair passes unchanged proofs and records its diff.',
    variant: 'moved-control',
    operation: 'run',
    expect: 'certified',
    route: 'saved',
  },
  {
    id: 'defect-persistence',
    title: 'Detect a save that reports success but stores nothing',
    evidence: 'Each seeded defect fails and remains failed after attempted route repair.',
    variant: 'broken-persistence',
    operation: 'run',
    expect: 'failed',
    expectFailureKind: ['unmet_outcome'],
    route: 'saved',
  },
  {
    id: 'defect-duplicate',
    title: 'Detect a save that stores the task twice',
    evidence: 'Each seeded defect fails and remains failed after attempted route repair.',
    variant: 'duplicate-submit',
    operation: 'run',
    expect: 'failed',
    expectFailureKind: ['unmet_outcome'],
    route: 'saved',
  },
  {
    id: 'async-update',
    title: 'Wait correctly for a list that renders late',
    evidence: 'Correct waiting prevents both premature failure and premature success.',
    variant: 'slow-update',
    operation: 'run',
    expect: 'certified',
    route: 'saved',
  },
  {
    id: 'infra-model-offline',
    title: 'Report lost model access as infrastructure, not an app defect',
    evidence: 'The report identifies infrastructure failure without claiming an application defect.',
    // The renamed control needs a repair, so the run must reach the model to finish. With the
    // provider refusing every request, the verdict has to name the provider and not the app.
    variant: 'moved-control',
    operation: 'run',
    expect: 'failed',
    expectFailureKind: ['provider_failure', 'authentication'],
    route: 'saved',
    breakModel: true,
  },
];

export function selectScenarios(only?: string[]): BenchScenario[] {
  if (!only?.length) return SCENARIOS;
  const known = new Set(SCENARIOS.map((scenario) => scenario.id));
  const unknown = only.filter((id) => !known.has(id));
  if (unknown.length) throw new Error(`unknown scenario: ${unknown.join(', ')}`);
  // Keep declaration order: a later scenario depends on the route an earlier one saved.
  return SCENARIOS.filter((scenario) => only.includes(scenario.id));
}
