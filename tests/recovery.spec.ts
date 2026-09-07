import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { rebuildStory, runStory, type CertificationResult } from '../src/storyAttempt';

function fixture() {
  mkdirSync('.schwifly', { recursive: true });
  const root = resolve(mkdtempSync('.schwifly/recovery-test-'));
  const file = resolve(root, 'story.story.yaml');
  const route = resolve(root, 'route.spec.ts');
  writeFileSync(file, `version: 1
id: test
ideal: keep-working
title: Save work
start: { url: 'http://localhost:4173' }
story: { as: user, want: save work, so: work is kept }
route: route.spec.ts
proofs:
  must:
    - id: saved
      use: page.url
      with: { exact: 'http://localhost:4173' }
`);
  const original = "locator: '#old'\n";
  writeFileSync(route, original);
  return { root, file, route, original };
}
const red: CertificationResult = { green: false, routeFailures: ['save failed'], proofFailures: [] };
const green: CertificationResult = { green: true, routeFailures: [], proofFailures: [] };

test('element repair saves only after independent certification', async () => {
  const fixtureData = fixture();
  const { root, file, route, original } = fixtureData;
  let certifications = 0;
  try {
    const result = await runStory({ root, file,
      repair: async () => ({ ...green, heals: [{ file: route, original: '#old', healed: '#new', intent: 'save' }] }),
      replay: async candidate => {
        if (candidate === route) return red;
        certifications++;
        expect(readFileSync(route, 'utf8')).toBe(original);
        expect(readFileSync(candidate, 'utf8')).toContain("locator: '#new'");
        return green;
      },
    });
    expect(result.ok).toBe(true);
    expect(result.recovery).toBe('element');
    expect(readdirSync(resolve(root, 'candidates'))).toEqual([]);
    expect(certifications).toBe(1);
    expect(readFileSync(route, 'utf8')).toContain("locator: '#new'");
    expect(result.report?.artifacts.some(path => path.endsWith('.diff'))).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('failed repair certification and failed rebuilding preserve the prior route', async () => {
  const { root, file, route, original } = fixture();
  try {
    const result = await runStory({ root, file, replay: async () => red,
      repair: async () => ({ ...green, heals: [{ file: route, original: '#old', healed: '#new', intent: 'save' }] }),
      discover: async () => ({ actions: [], proofs: [], notes: '' }),
    });
    expect(result.ok).toBe(false);
    expect(readFileSync(route, 'utf8')).toBe(original);
    expect(existsSync(result.resultPath!)).toBe(true);
    // The uncertified repair candidate is not evidence anyone can act on, so it is removed.
    const candidates = resolve(root, 'candidates');
    expect(existsSync(candidates) ? readdirSync(candidates) : []).toEqual([]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a proof regression with green route steps never starts recovery', async () => {
  const { root, file, route, original } = fixture();
  try {
    const result = await runStory({ root, file,
      replay: async () => ({ ...red, steps: [{ intent: 'save', status: 'ok', usedLocator: '#old' }], proofFailures: ['saved: fail'] }),
      repair: async () => { throw new Error('must not repair an outcome regression'); },
      discover: async () => { throw new Error('must not rediscover an outcome regression'); },
    });
    expect(result.report?.failure?.kind).toBe('unmet_outcome');
    expect(readFileSync(route, 'utf8')).toBe(original);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('cancellation stops before repair', async () => {
  const { root, file } = fixture();
  try {
    const result = await runStory({ root, file, replay: async () => ({ ...red, cancelled: true }),
      repair: async () => { throw new Error('must not recover after cancellation'); },
    });
    expect(result.report?.failure?.kind).toBe('cancelled');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('explicit rebuild stops discovery after cancellation', async () => {
  const { root, file, route, original } = fixture();
  try {
    const result = await rebuildStory({ root, file, replay: async () => ({ ...red, cancelled: true }),
      discover: async () => { throw new Error('must not discover after cancellation'); },
    });
    expect(result.report?.failure?.kind).toBe('cancelled');
    expect(readFileSync(route, 'utf8')).toBe(original);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// A child runner records authentication, setup, provider, and deadline failures. None of them is a
// locator defect, so neither repair nor rebuild may spend a model call on one.
const sessionFailure = {
  ...red,
  failure: { kind: 'authentication' as const, reason: 'saved login expired; capture a fresh login state' },
  routeFailures: ['authentication: saved login expired; capture a fresh login state', 'no route steps recorded'],
};

test('a recorded session failure reports its kind and starts no recovery', async () => {
  const { root, file, route, original } = fixture();
  try {
    const result = await runStory({ root, file, replay: async () => sessionFailure,
      repair: async () => { throw new Error('must not repair a session failure'); },
      discover: async () => { throw new Error('must not rediscover a session failure'); },
    });
    expect(result.report?.failure?.kind).toBe('authentication');
    expect(result.report?.failure?.reason).toContain('saved login expired');
    expect(result.report?.recovery).toBeUndefined();
    expect(readFileSync(route, 'utf8')).toBe(original);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('explicit rebuild stops discovery after a session failure', async () => {
  const { root, file, route, original } = fixture();
  try {
    const result = await rebuildStory({ root, file, replay: async () => sessionFailure,
      discover: async () => { throw new Error('must not discover after a session failure'); },
    });
    expect(result.report?.failure?.kind).toBe('authentication');
    expect(readFileSync(route, 'utf8')).toBe(original);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const stage of ['repair', 'certification'] as const)
for (const kind of ['browser_failure', 'authentication', 'provider_failure'] as const)
test(`${kind} during ${stage} stops recovery and reports that stage`, async () => {
  const { root, file, route, original } = fixture();
  const failure: CertificationResult = { ...red, failure: { kind, reason: 'infrastructure unavailable' }, routeFailures: ['infrastructure unavailable'] };
  try {
    const result = await runStory({ root, file,
      replay: async candidate => candidate === route ? red : failure,
      repair: async () => stage === 'repair' ? failure : { ...green, heals: [{ file: route, original: '#old', healed: '#new', intent: 'save' }] },
      discover: async () => { throw new Error('must not discover after infrastructure failure'); },
    });
    expect(result.report?.failure?.kind).toBe(kind);
    expect(result.report?.failure?.reason).toContain('infrastructure unavailable');
    expect(result.report?.phase).toBe(stage);
    expect(readFileSync(route, 'utf8')).toBe(original);
    if (stage === 'certification') expect(readdirSync(resolve(root, 'candidates'))).toEqual([]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
