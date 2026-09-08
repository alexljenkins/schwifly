import { encode } from '@toon-format/toon';
import { redact } from './secrets.js';

export class UsageError extends Error {}

export function output(data: unknown, json = false): void {
  const safe = redact(data);
  process.stdout.write((json ? JSON.stringify(safe) : encode(safe)) + '\n');
}

export function preview(value: string, full = false): string {
  return full || value.length <= 1000 ? value : `${value.slice(0, 1000)}... (truncated, ${value.length} chars total)`;
}

/** Keep full stored evidence available while the default terminal view stays short. */
export function conciseResult(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const value = data as Record<string, unknown>;
  if (Array.isArray(value.browserErrors)) return { ...value, opinions: preview(String(value.opinions ?? '')),
    browserErrors: value.browserErrors.slice(-5), ...(value.browserErrors.length > 5 ? { moreErrors: value.browserErrors.length - 5 } : {}) };
  if ('observedActions' in value) return {
    test: value.storyId ?? value.inputFile, status: value.status === 'certified' ? 'passed' : value.status,
    ...(value.failure ? { failure: value.failure } : {}),
    ...(Array.isArray(value.failedProofIds) && value.failedProofIds.length ? { failedChecks: value.failedProofIds } : {}),
    ...(value.recovery ? { repaired: value.recovery } : {}),
    ...(value.result ? { result: value.result } : {}),
  };
  if (Array.isArray(value.workflows)) return {
    status: value.status, total: value.total,
    tests: value.workflows.map((row: { file: string; state: string }) => ({ file: row.file,
      status: row.state === 'pass' ? 'passed' : row.state === 'healed' ? 'repaired' : 'failed' })),
    ...(Array.isArray(value.failedProofs) && value.failedProofs.length ? { failedChecks: value.failedProofs } : {}),
  };
  if (Array.isArray(value.results)) return { status: value.status ?? (value.ok ? 'passed' : 'failed'),
    ...(value.summary ? { summary: value.summary } : {}), results: value.results.map(conciseResult),
    ...(value.resultPath ? { result: value.resultPath } : {}) };
  return value;
}
