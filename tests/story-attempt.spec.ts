import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StoryDiscovery, StoryDiscoveryRequest } from '../src/attempt';
import { certificationGreen, attemptStory, rebuildStory } from '../src/storyAttempt';
import type { ProofRecord } from '../src/proofs';
import type { StepResult } from '../src/workflow';

const repo = join(fileURLToPath(new URL('..', import.meta.url)));

function fixture(overrides: { title?: string; use?: string; input?: string } = {}) {
  mkdirSync(join(repo, '.schwifly'), { recursive: true });
  const dir = mkdtempSync(join(repo, '.schwifly', 'story-attempt-'));
  const relativeDir = relative(repo, dir).replaceAll('\\', '/');
  const file = join(dir, 'contract.story.yaml');
  const route = join(dir, 'route.spec.ts');
  const title = overrides.title ?? 'Add an item';
  const use = overrides.use ?? 'page.url';
  const input = overrides.input ?? 'exact: http://127.0.0.1:4173/app';
  writeFileSync(file, `version: 1
id: add-item
ideal: work-is-saved
title: ${JSON.stringify(title)}
start:
  url: http://127.0.0.1:4173/app
story:
  as: a user
  want: to add an item
  so: I can plan
route: ${relativeDir}/route.spec.ts
proofs:
  must:
    - id: outcome
      use: ${use}
      with:
        ${input}
`);
  return { dir, file, route, storyBytes: readFileSync(file, 'utf8') };
}

function proof(status: ProofRecord['status'] = 'pass'): ProofRecord {
  return {
    storyId: 'add-item',
    clauseId: 'outcome',
    adapter: 'page.url',
    polarity: 'must',
    matched: status === 'pass',
    status,
    message: status,
  };
}

function discovery(overrides: Partial<StoryDiscovery> = {}) {
  return async (_request: StoryDiscoveryRequest): Promise<StoryDiscovery> => ({
    actions: [{ method: 'click', selector: '#add', description: 'Add', args: [], ok: true }],
    proofs: [proof()],
    notes: 'The agent says this passed.',
    ...overrides,
  });
}

test('the pure certification gate requires green steps and exactly one green proof per clause', () => {
  const ok: StepResult = { intent: 'add', status: 'ok', usedLocator: '#add' };
  const failed: StepResult = { ...ok, status: 'failed' };
  const healed: StepResult = { ...ok, status: 'healed' };
  expect(certificationGreen(0, [ok], [proof()], ['outcome']).green).toBe(true);
  expect(certificationGreen(0, [failed], [proof()], ['outcome']).green).toBe(false);
  expect(certificationGreen(0, [healed], [proof()], ['outcome']).green).toBe(false);
  expect(certificationGreen(1, [ok], [proof()], ['outcome']).green).toBe(false);
  expect(certificationGreen(0, [], [proof()], ['outcome']).green).toBe(false);
  expect(certificationGreen(0, [ok], [proof('fail')], ['outcome']).green).toBe(false);
  expect(certificationGreen(0, [ok], [], ['outcome']).proofFailures[0]).toContain('found 0');
  expect(certificationGreen(0, [ok], [proof(), proof()], ['outcome']).proofFailures[0]).toContain('found 2');
});

test('a green story discovery and replay save a generated route without changing the story', async () => {
  const item = fixture();
  try {
    const result = await attemptStory({ file: item.file, root: repo, discover: discovery(), replay: async () => true });
    expect(result.ok).toBe(true);
    expect(existsSync(item.route)).toBe(true);
    expect(readFileSync(item.file, 'utf8')).toBe(item.storyBytes);
    const source = readFileSync(item.route, 'utf8');
    expect(source).toContain('// Story add-item: Add an item');
    expect(source).toContain('// This route is generated and replaceable.');
    expect(source).toContain('loadStory(storyFile, process.env.SCHWIFLY_ROOT');
    expect(source).not.toContain('exact: http://127.0.0.1');
    expect(source).not.toContain('The agent says');
  } finally {
    rmSync(item.dir, { recursive: true, force: true });
  }
});

test('a failed discovery proof prevents replay and saves no route', async () => {
  const item = fixture();
  let replayed = false;
  try {
    const result = await attemptStory({
      file: item.file,
      root: repo,
      discover: discovery({ proofs: [proof('fail')], notes: 'Success according to the agent' }),
      replay: async () => { replayed = true; return true; },
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('proof failures');
    expect(replayed).toBe(false);
    expect(existsSync(item.route)).toBe(false);
    expect(readFileSync(item.file, 'utf8')).toBe(item.storyBytes);
  } finally {
    rmSync(item.dir, { recursive: true, force: true });
  }
});

test('an existing route prevents discovery', async () => {
  const item = fixture();
  writeFileSync(item.route, 'preserve');
  let discovered = false;
  try {
    const result = await attemptStory({ file: item.file, root: repo, discover: async (request) => { discovered = true; return discovery()(request); }, replay: async () => true });
    expect(result.ok).toBe(false);
    expect(discovered).toBe(false);
    expect(readFileSync(item.route, 'utf8')).toBe('preserve');
  } finally {
    rmSync(item.dir, { recursive: true, force: true });
  }
});

test('unknown adapters and invalid inputs fail before discovery', async () => {
  for (const item of [fixture({ use: 'missing.proof' }), fixture({ input: 'exact: one\n        contains: two' })]) {
    let discovered = false;
    try {
      await expect(attemptStory({ file: item.file, root: repo, discover: async (request) => { discovered = true; return discovery()(request); } })).rejects.toThrow(/invalid proofs/);
      expect(discovered).toBe(false);
    } finally {
      rmSync(item.dir, { recursive: true, force: true });
    }
  }
});

test('hostile source values stay escaped and proof input is not inlined', async () => {
  const item = fixture({ title: 'safe\nimport "injected"', input: 'contains: super-private-proof-data' });
  try {
    const result = await attemptStory({
      file: item.file,
      root: repo,
      discover: discovery({ actions: [{ method: 'click', selector: "#x'\nthrow new Error('bad')", description: "Add\n}); import 'bad'", args: [], ok: true }] }),
      replay: async () => true,
    });
    expect(result.ok).toBe(true);
    const source = readFileSync(item.route, 'utf8');
    expect(source).not.toMatch(/^import "injected"/m);
    expect(source).not.toMatch(/^throw new Error\('bad'\)/m);
    expect(source).not.toContain('super-private-proof-data');
  } finally {
    rmSync(item.dir, { recursive: true, force: true });
  }
});

test('concurrent attempts use different candidate files', async () => {
  const first = fixture();
  const second = fixture();
  const paths: string[] = [];
  let release!: () => void;
  const both = new Promise<void>((resolve) => { release = resolve; });
  const replay = async (file: string) => {
    paths.push(file);
    if (paths.length === 2) release();
    await both;
    return false;
  };
  try {
    const results = await Promise.all([
      attemptStory({ file: first.file, root: repo, discover: discovery(), replay }),
      attemptStory({ file: second.file, root: repo, discover: discovery(), replay }),
    ]);
    expect(new Set(paths).size).toBe(2);
    for (const result of results) if (result.candidate) rmSync(join(repo, result.candidate), { force: true });
  } finally {
    rmSync(first.dir, { recursive: true, force: true });
    rmSync(second.dir, { recursive: true, force: true });
  }
});

test('rebuild keeps a green route byte-identical without discovery', async () => {
  const item = fixture();
  writeFileSync(item.route, 'current green route');
  let discovered = false;
  try {
    const result = await rebuildStory({ file: item.file, root: repo, replay: async () => true, discover: async (request) => { discovered = true; return discovery()(request); } });
    expect(result.ok).toBe(true);
    expect(result.unchanged).toBe(true);
    expect(discovered).toBe(false);
    expect(readFileSync(item.route, 'utf8')).toBe('current green route');
  } finally {
    rmSync(item.dir, { recursive: true, force: true });
  }
});

test('rebuild replaces a red route only after a green candidate', async () => {
  const item = fixture();
  writeFileSync(item.route, 'old route');
  let calls = 0;
  try {
    const result = await rebuildStory({ file: item.file, root: repo, discover: discovery(), replay: async () => ++calls === 2 });
    expect(result.ok).toBe(true);
    expect(readFileSync(item.route, 'utf8')).not.toBe('old route');
    expect(readFileSync(item.file, 'utf8')).toBe(item.storyBytes);
  } finally {
    rmSync(item.dir, { recursive: true, force: true });
  }
});

test('rebuild preserves the old route after discovery or candidate failure', async () => {
  for (const failedAt of ['discovery', 'candidate'] as const) {
    const item = fixture();
    writeFileSync(item.route, 'old route');
    let calls = 0;
    try {
      const result = await rebuildStory({
        file: item.file,
        root: repo,
        discover: discovery(failedAt === 'discovery' ? { proofs: [proof('fail')] } : {}),
        replay: async () => { calls++; return false; },
      });
      expect(result.ok).toBe(false);
      expect(readFileSync(item.route, 'utf8')).toBe('old route');
      expect(readFileSync(item.file, 'utf8')).toBe(item.storyBytes);
      if (result.candidate) rmSync(join(repo, result.candidate), { force: true });
      expect(calls).toBe(failedAt === 'discovery' ? 1 : 2);
    } finally {
      rmSync(item.dir, { recursive: true, force: true });
    }
  }
});

test('a concurrent route change prevents rebuild replacement', async () => {
  const item = fixture();
  writeFileSync(item.route, 'old route');
  let calls = 0;
  try {
    const result = await rebuildStory({
      file: item.file,
      root: repo,
      discover: discovery(),
      replay: async () => {
        calls++;
        if (calls === 2) writeFileSync(item.route, 'concurrent route');
        return calls === 2;
      },
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('changed during rebuild');
    expect(readFileSync(item.route, 'utf8')).toBe('concurrent route');
    if (result.candidate) rmSync(join(repo, result.candidate), { force: true });
  } finally {
    rmSync(item.dir, { recursive: true, force: true });
  }
});
