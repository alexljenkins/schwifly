import { expect, test } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JsonValue, ProofAdapter, ProofRecord, ProofRegistry } from '../src/proofs';
import { builtInProofs, defineProof, runProofs, validateProofs } from '../src/proofs';
import { readRunLogs, workerLogPath } from '../src/runLogs';
import { writeProofRecord } from '../src/proofLogs';
import type { StoryContract } from '../src/story';

const context = {} as Parameters<typeof runProofs>[0]['context'];

function story(uses: Array<{ id: string; use: string; polarity?: 'must' | 'mustNot'; with?: Record<string, JsonValue> }>): StoryContract {
  return {
    version: 1,
    id: 'proof-story',
    ideal: 'truth',
    title: 'Proof story',
    start: { url: 'https://example.com' },
    story: { as: 'a user', want: 'a result', so: 'work continues' },
    route: 'workflows/proof.spec.ts',
    proofs: {
      must: uses.filter((item) => item.polarity !== 'mustNot').map(({ id, use, with: input = {} }) => ({ id, use, with: input })),
      mustNot: uses.filter((item) => item.polarity === 'mustNot').map(({ id, use, with: input = {} }) => ({ id, use, with: input })),
    },
  };
}

function adapter(matched: boolean, events: string[] = []): ProofAdapter<Record<string, never>> {
  return defineProof({
    parse(input) { return input as Record<string, never>; },
    describe() { return 'a test fact'; },
    async arm() {
      events.push('arm');
      return {
        async check() { events.push('check'); return { matched, message: `matched ${matched}` }; },
        async dispose() { events.push('dispose'); },
      };
    },
  });
}

function registry(entries: Record<string, ProofAdapter<Record<string, never>>>): ProofRegistry {
  return entries as ProofRegistry;
}

test('must and mustNot apply opposite polarity', async () => {
  const proofs = validateProofs(story([
    { id: 'must-true', use: 'yes' },
    { id: 'must-false', use: 'no' },
    { id: 'must-not-false', use: 'no', polarity: 'mustNot' },
    { id: 'must-not-true', use: 'yes', polarity: 'mustNot' },
  ]), registry({ yes: adapter(true), no: adapter(false) }));
  const run = await runProofs({ proofs, context, route: async () => {}, persist: false });
  expect(run.records.map((record) => record.status)).toEqual(['pass', 'fail', 'pass', 'fail']);
});

test('all proofs arm before the route, then check, then dispose', async () => {
  const events: string[] = [];
  const named = (name: string) => defineProof<Record<string, never>>({
    parse(input) { return input as Record<string, never>; },
    describe() { return name; },
    async arm() {
      events.push(`arm:${name}`);
      return {
        async check() { events.push(`check:${name}`); return { matched: true, message: name }; },
        async dispose() { events.push(`dispose:${name}`); },
      };
    },
  });
  const proofs = validateProofs(story([{ id: 'one', use: 'one' }, { id: 'two', use: 'two' }]), registry({ one: named('one'), two: named('two') }));
  await runProofs({ proofs, context, route: async () => { events.push('route'); }, persist: false });
  expect(events).toEqual(['arm:one', 'arm:two', 'route', 'check:one', 'check:two', 'dispose:one', 'dispose:two']);
});

test('a baseline proof captures state during arm and compares it after the route', async () => {
  let state = 'before';
  const baseline = defineProof<Record<string, never>>({
    parse(input) { return input as Record<string, never>; },
    describe() { return 'state changed'; },
    async arm() {
      const before = state;
      return { async check() { return { matched: state !== before, message: `${before} -> ${state}` }; } };
    },
  });
  const proofs = validateProofs(story([{ id: 'changed', use: 'baseline' }]), registry({ baseline }));
  const run = await runProofs({ proofs, context, route: async () => { state = 'after'; }, persist: false });
  expect(run.records[0].status).toBe('pass');
});

test('built-ins inspect final browser state and events without an LLM', async ({ page, context: browserContext }) => {
  const contract = story([
    { id: 'url', use: 'page.url', with: { exact: 'about:blank' } },
    { id: 'visible', use: 'ui.elementVisible', with: { role: 'button', name: 'Save' } },
    { id: 'enabled', use: 'ui.elementEnabled', with: { testId: 'save' } },
    { id: 'console', use: 'browser.consoleError' },
    { id: 'page-error', use: 'browser.pageError' },
  ]);
  const proofs = validateProofs(contract, builtInProofs);
  const run = await runProofs({
    proofs,
    context: { page, browserContext },
    persist: false,
    route: async () => {
      await page.setContent('<button data-testid="save">Save</button>');
      await page.evaluate(() => {
        console.error('browser event');
        setTimeout(() => { throw new Error('page event'); }, 0);
      });
      await page.waitForTimeout(20);
    },
  });
  expect(run.records.map((record) => record.status)).toEqual(['pass', 'pass', 'pass', 'pass', 'pass']);
});

test('all clauses run and dispose when another proof throws', async () => {
  const events: string[] = [];
  const broken = defineProof<Record<string, never>>({
    parse(input) { return input as Record<string, never>; },
    describe() { return 'broken'; },
    async arm() { return { async check() { events.push('broken-check'); throw new Error('bad token=abcdef123456'); }, async dispose() { events.push('broken-dispose'); } }; },
  });
  const proofs = validateProofs(story([{ id: 'broken', use: 'broken' }, { id: 'good', use: 'good' }]), registry({ broken, good: adapter(true, events) }));
  const run = await runProofs({ proofs, context, route: async () => { throw new Error('route failed'); }, persist: false });
  expect(run.records.map((record) => record.status)).toEqual(['error', 'pass']);
  expect(run.records[0].message).not.toContain('abcdef123456');
  expect(run.routeError).toBeInstanceOf(Error);
  expect(events).toContain('check');
  expect(events).toContain('broken-dispose');
  expect(events).toContain('dispose');
});

test('missing and invalid adapter results are errors', async () => {
  const missing = adapter(true) as ProofAdapter<Record<string, never>>;
  missing.arm = async () => ({ check: async () => undefined }) as never;
  const proofs = validateProofs(story([{ id: 'missing', use: 'missing' }]), registry({ missing }));
  expect((await runProofs({ proofs, context, route: async () => {}, persist: false })).records[0].status).toBe('error');
});

test('unknown adapters and invalid built-in inputs fail during validation', () => {
  const contract = story([
    { id: 'unknown', use: 'missing' },
    { id: 'bad-ui', use: 'ui.elementVisible' },
  ]);
  expect(() => validateProofs(contract, builtInProofs)).toThrow(/unknown proof adapter[\s\S]*exactly one locator/);
});

test('messages and evidence redact secrets before return and persistence', async () => {
  const previous = process.env.PROOF_API_KEY;
  process.env.PROOF_API_KEY = 'proof-secret-value';
  try {
    const secret = defineProof<Record<string, never>>({
      parse(input) { return input as Record<string, never>; },
      describe() { return 'secret'; },
      async arm() { return { async check() { return { matched: true, message: 'proof-secret-value', evidence: { token: 'proof-secret-value' } }; } }; },
    });
    const proofs = validateProofs(story([{ id: 'secret', use: 'secret' }]), registry({ secret }));
    const record = (await runProofs({ proofs, context, route: async () => {}, persist: false })).records[0];
    expect(JSON.stringify(record)).not.toContain('proof-secret-value');
    expect(JSON.stringify(record)).toContain('REDACTED');
  } finally {
    if (previous === undefined) delete process.env.PROOF_API_KEY;
    else process.env.PROOF_API_KEY = previous;
  }
});

test('parallel workers write isolated proof logs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'schwifly-proof-logs-'));
  const base = join(dir, 'proofs.ndjson');
  const previous = process.env.TEST_PARALLEL_INDEX;
  const record: ProofRecord = {
    storyId: 'proof-story', clauseId: 'one', adapter: 'yes', polarity: 'must', matched: true, status: 'pass', message: 'ok',
  };
  try {
    process.env.TEST_PARALLEL_INDEX = '0';
    writeProofRecord(record, base);
    process.env.TEST_PARALLEL_INDEX = '1';
    writeProofRecord({ ...record, clauseId: 'two' }, base);
    expect(workerLogPath(base, '0')).not.toBe(workerLogPath(base, '1'));
    expect(readRunLogs<ProofRecord>(base).map((value) => value.clauseId)).toEqual(['one', 'two']);
    expect(readFileSync(workerLogPath(base, '0'), 'utf8')).toContain('"one"');
  } finally {
    if (previous === undefined) delete process.env.TEST_PARALLEL_INDEX;
    else process.env.TEST_PARALLEL_INDEX = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
