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

test('write-back anchors on the full locator token — healing `text=$20` never splices into `text=$20/mo.`', async () => {
  // RED (old bare-substring applyHeal): `src.replace('text=$20', xpath)` matched the SUBSTRING
  // inside the HEALTHY `text=$20/mo.` step first, rewriting it to `xpath=.../span[1]/mo.` and
  // leaving the actually-broken `text=$20` step untouched. GREEN: token anchoring hits only the
  // whole `locator: 'text=$20'`.
  const dir = mkdtempSync(join(tmpdir(), 'schwifly-'));
  const f = join(dir, 'wf.spec.ts');
  writeFileSync(
    f,
    `await step(page, { intent: 'Pro price', locator: 'text=$20/mo.', action: 'expectVisible' }, {});\n` +
      `await step(page, { intent: 'the page shows 20', locator: 'text=$20', action: 'expectText', value: '20' }, {});\n`,
  );

  const rec: HealRecord = { file: f, original: 'text=$20', healed: 'xpath=/html/body/span[1]', intent: 'the page shows 20' };
  expect(applyHeal(rec)).toBe(true);

  const after = readFileSync(f, 'utf8');
  expect(after).toContain("locator: 'xpath=/html/body/span[1]'"); // the broken step healed
  expect(after).toContain("locator: 'text=$20/mo.'");             // the healthy step is untouched
  expect(after).not.toContain('span[1]/mo.');                     // the old splice artifact is gone
});

test('write-back consumes one occurrence per heal record (two identical locators heal independently)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'schwifly-'));
  const f = join(dir, 'wf.spec.ts');
  writeFileSync(
    f,
    `await step(page, { intent: 'Hobby price', locator: 'text=$0', action: 'expectVisible' }, {});\n` +
      `await step(page, { intent: 'the page shows 0', locator: 'text=$0', action: 'expectText', value: '0' }, {});\n`,
  );

  // Records are applied in execution/file order by the serial CLI writer -> Nth record, Nth token.
  expect(applyHeal({ file: f, original: 'text=$0', healed: 'xpath=/a/b/c[1]', intent: 'Hobby price' })).toBe(true);
  expect(applyHeal({ file: f, original: 'text=$0', healed: 'xpath=/a/b/c[2]', intent: 'the page shows 0' })).toBe(true);

  const after = readFileSync(f, 'utf8');
  expect(after).toContain("locator: 'xpath=/a/b/c[1]'"); // first step
  expect(after).toContain("locator: 'xpath=/a/b/c[2]'"); // second step
  expect(after).not.toContain("locator: 'text=$0'");     // both occurrences consumed, none dropped
});
