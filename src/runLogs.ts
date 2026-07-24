import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import type { HealRecord } from './workflow';

export const HEAL_LOG = '.schwifly/heals.ndjson';
export const STEP_LOG = '.schwifly/steps.ndjson';

// Playwright gives every parallel worker a stable index. Separate sinks avoid cross-process
// appends; the CLI later collects them and remains the only process that mutates workflow source.
export function workerLogPath(path: string, parallelIndex = process.env.TEST_PARALLEL_INDEX): string {
  if (parallelIndex === undefined) return path;
  const ext = extname(path);
  return `${path.slice(0, -ext.length)}.${parallelIndex}${ext}`;
}

export function runLogPaths(path: string): string[] {
  const dir = dirname(path);
  if (!existsSync(dir)) return [];
  const ext = extname(path);
  const stem = basename(path, ext);
  const indexed = new RegExp(`^${stem}(?:\\.\\d+)?\\${ext}$`);
  return readdirSync(dir)
    .filter((file) => indexed.test(file))
    .sort()
    .map((file) => join(dir, file));
}

export function clearRunLogs(path: string): void {
  for (const file of runLogPaths(path)) rmSync(file);
}

export function readRunLogs<T>(path: string): T[] {
  return runLogPaths(path).flatMap((file) =>
    readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T),
  );
}

export function dedupeHeals(records: HealRecord[]): HealRecord[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    const key = [record.file ?? '', record.original, record.healed].join('\0');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
