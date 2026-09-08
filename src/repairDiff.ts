import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { redact } from './secrets.js';

export function writeRepairDiff(root: string, file: string, before: string, after: string): string {
  const lines = (value: string) => redact(value).replace(/\n$/, '').split('\n');
  const oldLines = lines(before);
  const newLines = lines(after);
  const dir = resolve(root, '.schwifly', 'repair-diffs');
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, `${randomUUID()}.diff`);
  writeFileSync(path, [
    `--- a/${file}`, `+++ b/${file}`,
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
    ...oldLines.map(line => `-${line}`), ...newLines.map(line => `+${line}`), '',
  ].join('\n'));
  return path;
}
