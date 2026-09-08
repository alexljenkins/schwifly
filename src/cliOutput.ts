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
