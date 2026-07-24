import { expect, test } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyHeal, type HealRecord } from '../src/workflow';
import { readRunLogs, workerLogPath } from '../src/runLogs';

test('duplicate worker records produce one idempotent write-back', () => {
  const dir = mkdtempSync(join(tmpdir(), 'schwifly-logs-'));
  const base = join(dir, 'heals.ndjson');
  const workflow = join(dir, 'same.spec.ts');
  const record: HealRecord = {
    file: workflow,
    original: '#old',
    healed: '#new',
    intent: 'click new',
  };

  const worker0 = workerLogPath(base, '0');
  const worker1 = workerLogPath(base, '1');
  expect(worker0).not.toBe(worker1);
  writeFileSync(worker0, `${JSON.stringify(record)}\n`);
  writeFileSync(worker1, `${JSON.stringify(record)}\n`);

  const heals = readRunLogs<HealRecord>(base);
  expect(heals).toEqual([record, record]);

  writeFileSync(workflow, `await step(page, { locator: '#old' });`);
  for (const heal of heals) expect(applyHeal(heal)).toBe(true);
  expect(readFileSync(workflow, 'utf8')).toBe(`await step(page, { locator: '#new' });`);
});

test('identical heal records rewrite both matching steps', () => {
  const dir = mkdtempSync(join(tmpdir(), 'schwifly-logs-'));
  const base = join(dir, 'heals.ndjson');
  const workflow = join(dir, 'same.spec.ts');
  const record: HealRecord = {
    file: workflow,
    original: '#old',
    healed: '#new',
    intent: 'click new',
  };
  writeFileSync(
    workflow,
    `await step(page, { locator: '#old' });\nawait step(page, { locator: '#old' });`,
  );
  writeFileSync(workerLogPath(base, '0'), `${JSON.stringify(record)}\n${JSON.stringify(record)}\n`);

  const heals = readRunLogs<HealRecord>(base);
  expect(heals).toHaveLength(2);
  for (const heal of heals) expect(applyHeal(heal)).toBe(true);

  expect(readFileSync(workflow, 'utf8')).toBe(
    `await step(page, { locator: '#new' });\nawait step(page, { locator: '#new' });`,
  );
});

test('two worker logs produce one serial write-back per workflow', () => {
  const dir = mkdtempSync(join(tmpdir(), 'schwifly-logs-'));
  const base = join(dir, 'heals.ndjson');
  const first = join(dir, 'first.spec.ts');
  const second = join(dir, 'second.spec.ts');
  writeFileSync(first, `await step(page, { locator: '#old-first' });`);
  writeFileSync(second, `await step(page, { locator: '#old-second' });`);

  const records: HealRecord[] = [
    { file: first, original: '#old-first', healed: '#new-first', intent: 'first' },
    { file: second, original: '#old-second', healed: '#new-second', intent: 'second' },
  ];
  writeFileSync(workerLogPath(base, '10'), `${JSON.stringify(records[0])}\n`);
  writeFileSync(workerLogPath(base, '2'), `${JSON.stringify(records[1])}\n`);

  const heals = readRunLogs<HealRecord>(base);
  expect(heals).toEqual([records[1], records[0]]);
  for (const record of heals) {
    expect(applyHeal(record)).toBe(true);
  }
  expect(readFileSync(first, 'utf8')).toContain("locator: '#new-first'");
  expect(readFileSync(second, 'utf8')).toContain("locator: '#new-second'");
});
