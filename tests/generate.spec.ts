import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseStory } from '../src/parseStory';
import { emit } from '../src/emit';

// KEY-FREE witnesses for generator-story-to-spec (epic 6).
// parseStory and emit are PURE (no browser, no LLM) so they verify offline. The live
// discovery path (generate.ts) is gated behind a key and intentionally NOT run here.

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const story: { process: string; starting_url: string } = JSON.parse(
  readFileSync(join(fixtureDir, 'relevance-pricing.json'), 'utf8'),
)[0];

test('parseStory extracts the EXACT <validate> values from the relevance-pricing story', () => {
  const { assertions } = parseStory(story.process);
  expect(assertions.map((a) => a.value)).toEqual([
    'Free, Pro, Team and Enterprise',
    'Credits and Actions',
    '19',
    '29',
    '234',
    '349',
    'Custom',
    '$40 per 1,000',
    '$20 per 10,000',
  ]);
});

test('parseStory keeps each assertion type (defaults to exact when unspecified)', () => {
  const { assertions } = parseStory('Plan is <validate type="semantic">around twenty dollars</validate> and id is <validate>19</validate>');
  expect(assertions.map((a) => a.type)).toEqual(['semantic', 'exact']);
});

test('parseStory turns imperative sentences into intent-bearing steps', () => {
  const { steps } = parseStory('Click the Sign in button. Then fill the email field.');
  expect(steps.length).toBeGreaterThanOrEqual(2);
  expect(steps[0].intent).toContain('Sign in');
});

test('emit renders a spec whose byte-shape matches the example template and typechecks', () => {
  const spec = emit({
    title: 'relevance: pricing',
    url: story.starting_url,
    steps: [{ intent: 'open the Pricing link', locator: 'role=link[name="Pricing"i]', action: 'click' }],
    assertions: [{ type: 'exact', value: '19', intent: 'the Pro price is 19', locator: '[data-testid="price"]' }],
  });

  // Byte-shape contract carried from workflows/example.spec.ts.
  expect(spec).toContain("import { test } from '@playwright/test';");
  expect(spec).toContain("import { fileURLToPath } from 'node:url';");
  expect(spec).toContain("import { step } from '../src/workflow';");
  // Wired to the LLM heal tier over the shared-CDP session (not the tier-1-only heuristic).
  expect(spec).toContain("import { EscalatingResolver } from '../src/heal';");
  expect(spec).toContain("import { openSharedSession, type SharedSession } from '../src/sharedCdp';");
  // The heal tier is wired in, but disableable for one run so the attempt flow's certification
  // replay cannot let a capture heal its way to GREEN.
  expect(spec).toContain("new EscalatingResolver(stagehand)");
  expect(spec).toContain("process.env.SCHWIFLY_NO_HEAL === '1'");
  expect(spec).toContain('session = await openSharedSession();');
  expect(spec).toContain('const here = fileURLToPath(import.meta.url);');
  expect(spec).toContain(`await page.goto('${story.starting_url}');`);
  // Every step carries file: here so write-back can locate the source.
  expect((spec.match(/file: here/g) ?? []).length).toBe(2);
  // The <validate> appended as an expectText step.
  expect(spec).toContain("action: 'expectText'");
  expect(spec).toContain("value: '19'");
});

test('emit output for the full story compiles under tsc (real typecheck, no key)', () => {
  // The relative imports ('../src/...') only resolve from workflows/, and the relevance story
  // exercises every assertion path -- so emit the WHOLE story there and let tsc judge it.
  const { steps, assertions } = parseStory(story.process);
  const spec = emit({
    title: 'relevance: pricing',
    url: story.starting_url,
    steps: steps.map((s) => ({ intent: s.intent, locator: 'role=link[name="Pricing"i]', action: s.action, value: s.value })),
    assertions: assertions.map((a) => ({ type: a.type, value: a.value, intent: `page shows ${a.value}`, locator: '[data-testid="x"]' })),
  });

  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const out = join(root, 'workflows', '__emit_typecheck__.spec.ts');
  writeFileSync(out, spec);
  try {
    const tsc = spawnSync('npx', ['tsc', '--noEmit'], { cwd: root, encoding: 'utf8' });
    expect(tsc.status, tsc.stdout + tsc.stderr).toBe(0);
  } finally {
    rmSync(out, { force: true });
  }
});
