import { test, expect } from '@playwright/test';
import { step, applyHeal, type Resolver, type HealRecord } from '../src/workflow';
import { PlaywrightHeuristicResolver } from '../src/heal';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Proves the hero loop end-to-end against a real browser DOM, no LLM needed:
// deterministic-ok → broken-fails (red) → AI heals + records (green) → write-back updates workflow.

const PAGE = `<!doctype html><html><body>
  <h1>Login</h1>
  <button id="signin-v2" aria-label="Sign in">Sign in</button>
</body></html>`;

test('deterministic locator succeeds', async ({ page }) => {
  await page.setContent(PAGE);
  const r = await step(page, { intent: 'click Sign in', locator: '#signin-v2', action: 'click' }, { timeout: 2000 });
  expect(r.status).toBe('ok');
});

test('broken locator with no resolver fails (red witness)', async ({ page }) => {
  await page.setContent(PAGE);
  const r = await step(page, { intent: 'click Sign in', locator: '#signin-OLD', action: 'click' }, { timeout: 1500 });
  expect(r.status).toBe('failed');
});

test('broken locator heals via resolver and records the heal (green witness)', async ({ page }) => {
  await page.setContent(PAGE);
  const dir = mkdtempSync(join(tmpdir(), 'schwifly-'));
  const healLog = join(dir, 'heals.ndjson');
  const fake: Resolver = { async resolve() { return '#signin-v2'; } };

  const r = await step(
    page,
    { intent: 'click Sign in', locator: '#signin-OLD', action: 'click' },
    { resolver: fake, timeout: 1500, healLog },
  );

  expect(r.status).toBe('healed');
  expect(r.healedFrom).toBe('#signin-OLD');
  expect(r.usedLocator).toBe('#signin-v2');

  const recs = readFileSync(healLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  expect(recs).toHaveLength(1);
  expect(recs[0].original).toBe('#signin-OLD');
  expect(recs[0].healed).toBe('#signin-v2');
});

test('heuristic resolver heals a stale locator by accessible name (real backup, no LLM)', async ({ page }) => {
  await page.setContent(PAGE);
  const dir = mkdtempSync(join(tmpdir(), 'schwifly-'));
  const r = await step(
    page,
    { intent: 'click the Sign in button', locator: '#signin-OLD', action: 'click' },
    { resolver: new PlaywrightHeuristicResolver(), timeout: 1500, healLog: join(dir, 'heals.ndjson') },
  );
  expect(r.status).toBe('healed');
  expect(r.healedFrom).toBe('#signin-OLD');
  expect(r.usedLocator).toBe('role=button[name="Sign in"i]');
});

test('write-back updates the workflow source (the "update the workflow" step)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'schwifly-'));
  const f = join(dir, 'wf.spec.ts');
  writeFileSync(f, `await step(page, { intent: 'click Sign in', locator: '#signin-OLD', action: 'click' });`);

  const rec: HealRecord = { file: f, original: '#signin-OLD', healed: '#signin-v2', intent: 'click Sign in' };
  expect(applyHeal(rec)).toBe(true);

  const after = readFileSync(f, 'utf8');
  expect(after).toContain('#signin-v2');
  expect(after).not.toContain('#signin-OLD');
});
