import { expect, test } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PlaywrightHeuristicResolver } from '../src/heal';
import { emit } from '../src/emit';
import { runPlaywright } from '../src/playwrightProcess';
import { applyIntentLabels, needsIntentLabel, parseCodegen } from '../src/record';
import { readRunLogs, STEP_LOG } from '../src/runLogs';
import { applyHeal, step, type HealRecord, type StepResult } from '../src/workflow';

const CODEGEN = `import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://example.com');
  await page.getByRole('button', { name: 'Add Element' }).click();
  await page.getByLabel('Email address').fill('alex@example.com');
  await expect(page.getByText('Delete')).toBeVisible();
});
`;

test('codegen text maps to plain-string StepSpecs', () => {
  expect(parseCodegen(CODEGEN)).toEqual([
    {
      intent: 'click the Add Element button',
      locator: 'role=button[name="Add Element"i]',
      action: 'click',
    },
    {
      intent: 'fill the Email address field',
      locator: 'internal:label="Email address"i',
      action: 'fill',
      value: 'alex@example.com',
    },
    {
      intent: 'see the Delete text',
      locator: 'text=Delete',
      action: 'expectVisible',
    },
  ]);
});

test('raw locator actions and text assertions stay deterministic', () => {
  const steps = parseCodegen(`
    await page.locator('#display-name').fill('Alex\\'s account');
    await expect(page.locator('[data-testid="status"]')).toContainText('Saved');
  `);
  expect(steps).toEqual([
    {
      intent: 'fill the recorded element',
      locator: '#display-name',
      action: 'fill',
      value: "Alex's account",
    },
    {
      intent: 'see the recorded element',
      locator: '[data-testid="status"]',
      action: 'expectText',
      value: 'Saved',
    },
  ]);
  expect(needsIntentLabel(steps[0])).toBe(true);
  expect(needsIntentLabel(steps[1])).toBe(true);
});

test('optional labels replace only opaque fallback intents', () => {
  const steps = parseCodegen(`
    await page.locator('#save-v7').click();
    await page.getByRole('link', { name: 'Account' }).click();
  `);
  expect(applyIntentLabels(steps, ['click the Save button'])).toEqual([
    { intent: 'click the Save button', locator: '#save-v7', action: 'click' },
    { intent: 'click the Account link', locator: 'role=link[name="Account"i]', action: 'click' },
  ]);
  expect(applyIntentLabels(steps, ['Save button'])[0].intent).toBe('click the Save button');
});

test('recorded secret fields reuse the capture normalizer redaction boundary', () => {
  const [password] = parseCodegen("await page.getByLabel('Password').fill('hunter2');");
  expect(password.value).toBe('***REDACTED***');
  expect(JSON.stringify(password)).not.toContain('hunter2');
});

test('an explicit empty fill remains a field-clear action', () => {
  expect(parseCodegen("await page.getByLabel('Search').fill('');")).toEqual([
    {
      intent: 'fill the Search field',
      locator: 'internal:label="Search"i',
      action: 'fill',
      value: '',
    },
  ]);
});

test('unsupported codegen actions fail instead of disappearing from the workflow', () => {
  expect(() => parseCodegen("await page.getByLabel('Country').selectOption('AU');"))
    .toThrow(/unsupported codegen action: selectOption/);
  expect(() => parseCodegen("await page.getByRole('button', { name: /save/i }).click();"))
    .toThrow(/literal accessible name/);
});

test('recorded steps run green unmodified', async ({ page }) => {
  await page.setContent(`
    <label>Email address <input /></label>
    <button onclick="document.querySelector('#done').hidden = false">Add Element</button>
    <span id="done" hidden>Delete</span>
  `);
  const results = [];
  for (const spec of parseCodegen(CODEGEN)) {
    results.push(await step(page, spec, { timeout: 1500 }));
  }
  expect(results.map((result) => result.status)).toEqual(['ok', 'ok', 'ok']);
});

test('the emitted recorded file runs unmodified with every step green', async ({}, testInfo) => {
  testInfo.setTimeout(120_000);
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const candidate = join(root, 'candidates', `record-runtime.${process.pid}.spec.ts`);
  const url = 'data:text/html,' + encodeURIComponent(`
    <label>Email address <input /></label>
    <button onclick="document.querySelector('#done').hidden = false">Add Element</button>
    <span id="done" hidden>Delete</span>
  `);
  writeFileSync(candidate, emit({
    title: 'record runtime witness',
    url,
    steps: parseCodegen(CODEGEN),
    assertions: [],
  }));
  try {
    const run = runPlaywright(
      ['test', candidate, '--project=candidate', '--workers=1'],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, SCHWIFLY_NO_HEAL: '1' },
      },
    );
    expect(run.status, String(run.stdout) + String(run.stderr)).toBe(0);
    const results = readRunLogs<StepResult>(STEP_LOG)
      .filter((result) => result.file && basename(result.file) === basename(candidate));
    expect(results.map((result) => result.status)).toEqual(['ok', 'ok', 'ok']);
  } finally {
    rmSync(candidate, { force: true });
  }
});

test('a broken recorded locator heals heuristically and writes back to emitted source', async ({ page }) => {
  await page.setContent('<button>Add Element</button>');
  const [recorded] = parseCodegen(
    "await page.getByRole('button', { name: 'Add Element' }).click();",
  );
  const broken = { ...recorded, locator: '#stale-recorded-id' };
  const dir = mkdtempSync(join(tmpdir(), 'schwifly-record-'));
  const file = join(dir, 'recorded.spec.ts');
  writeFileSync(file, emit({
    title: 'recorded flow',
    url: 'https://example.com',
    steps: [broken],
    assertions: [],
  }));

  const result = await step(page, broken, {
    resolver: new PlaywrightHeuristicResolver(),
    timeout: 200,
    file,
    healLog: join(dir, 'heals.ndjson'),
    stepLog: join(dir, 'steps.ndjson'),
  });
  expect(result.status).toBe('healed');
  expect(result.usedLocator).toBe('role=button[name="Add Element"i]');

  const record: HealRecord = {
    file,
    original: broken.locator,
    healed: result.usedLocator,
    intent: broken.intent,
  };
  expect(applyHeal(record)).toBe(true);
  expect(readFileSync(file, 'utf8')).toContain(
    "locator: 'role=button[name=\\\"Add Element\\\"i]'",
  );
});

test('a recorded labeled field intent re-derives the textbox role for healing', async ({ page }) => {
  await page.setContent('<label>Email address <input /></label>');
  const [recorded] = parseCodegen(
    "await page.getByLabel('Email address').fill('alex@example.com');",
  );
  const dir = mkdtempSync(join(tmpdir(), 'schwifly-record-field-'));
  const result = await step(
    page,
    { ...recorded, locator: '#stale-email-id' },
    {
      resolver: new PlaywrightHeuristicResolver(),
      timeout: 200,
      healLog: join(dir, 'heals.ndjson'),
      stepLog: join(dir, 'steps.ndjson'),
    },
  );
  expect(result.status).toBe('healed');
  expect(result.usedLocator).toBe('role=textbox[name="Email address"i]');
});
