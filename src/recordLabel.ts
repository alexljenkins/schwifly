import { llmConfigFromEnv } from './llm';
import { applyIntentLabels, needsIntentLabel } from './record';
import { openSharedSession } from './sharedCdp';
import type { EmitStep } from './emit';

// Optional author-time fallback for opaque CSS/test-id locators. The pure recorder transform runs
// first and always wins when codegen carried a real role/name/label. Only missing human labels
// reach this one key-gated call; saved workflows remain deterministic and agent-free at runtime.
export async function labelRecordedIntents(steps: EmitStep[]): Promise<EmitStep[]> {
  const missing = steps.filter(needsIntentLabel);
  if (!missing.length || !llmConfigFromEnv()) return steps;

  const facts = missing.map((step) => ({
    action: step.action ?? 'click',
    selector: step.locator,
  }));
  const session = await openSharedSession();
  try {
    await session.page.setContent(`<pre>${escapeHtml(JSON.stringify(facts))}</pre>`);
    const result = await session.stagehand.extract(
      'The page contains a JSON array of recorded browser actions. Return only a JSON array of ' +
      'concise plain-English intent strings in the same order. Each intent must start with the ' +
      'matching verb click, fill, or see and name the likely human-facing element. Do not invent ' +
      'state or outcomes that are not implied by the selector.',
      { page: session.page },
    );
    const labels = jsonArray(result.extraction);
    return labels.length === missing.length ? applyIntentLabels(steps, labels) : steps;
  } finally {
    await session.close();
  }
}

function jsonArray(value: string): string[] {
  const match = /\[[\s\S]*\]/.exec(value);
  if (!match) return [];
  try {
    const parsed: unknown = JSON.parse(match[0]);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')
      ? parsed
      : [];
  } catch {
    return [];
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
