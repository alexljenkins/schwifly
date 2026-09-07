import { expect, test } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attemptStory, rebuildStory, replayStoryRoute } from '../src/storyAttempt';
import type { StoryDiscovery } from '../src/attempt';
import { loadStory } from '../src/story';

const root = fileURLToPath(new URL('..', import.meta.url));

function discovery(version: 'A' | 'B'): StoryDiscovery {
  return {
    actions: version === 'A'
      ? [
          { method: 'click', selector: '#new', description: 'New item', args: [], ok: true },
          { method: 'fill', selector: '#title', description: 'Title', args: ['Buy milk'], ok: true },
          { method: 'click', selector: '#save', description: 'Save', args: [], ok: true },
        ]
      : [
          { method: 'fill', selector: '#quick-add', description: 'Quick add', args: ['Buy milk'], ok: true },
          { method: 'click', selector: '#add', description: 'Add', args: [], ok: true },
        ],
    proofs: [
      { storyId: 'add-item', clauseId: 'item-exists', adapter: 'task.itemExists', polarity: 'must', matched: true, status: 'pass', message: 'item exists' },
      { storyId: 'add-item', clauseId: 'no-console-error', adapter: 'browser.consoleError', polarity: 'mustNot', matched: false, status: 'pass', message: 'no console error' },
    ],
    notes: 'deterministic discovery seam',
  };
}

test('one unchanged story survives a real Chromium route rebuild across 2 interfaces', async () => {
  test.setTimeout(180_000);
  mkdirSync(join(root, '.schwifly'), { recursive: true });
  const dir = mkdtempSync(join(root, '.schwifly', 'story-vertical-'));
  const stateFile = join(dir, 'version');
  writeFileSync(stateFile, 'A');
  const server = spawn(
    join(root, 'node_modules', '.bin', 'tsx'),
    [join(root, 'tests', 'fixtures', 'taskAppServer.ts'), stateFile],
    { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.stdout.once('data', (data) => resolve(Number(String(data).trim())));
  });
  const id = dir.split('-').at(-1);
  const storyFile = join(dir, 'add-item.story.yaml');
  const routeFile = join(root, 'workflows', `__story_vertical_${id}.spec.ts`);
  const configFile = join(root, 'schwifly.config.ts');
  const relativeStory = relative(root, storyFile).replaceAll('\\', '/');
  const relativeRoute = relative(root, routeFile).replaceAll('\\', '/');

  if (existsSync(configFile)) throw new Error('vertical fixture refuses to overwrite schwifly.config.ts');
  writeFileSync(configFile, `import { defineConfig, defineProof } from './src/proofs';

export default defineConfig({
  async setup() {},
  proofs: {
    'task.itemExists': defineProof<{ title: string }>({
      parse(input) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('input must be an object');
        const value = input as Record<string, unknown>;
        if (Object.keys(value).some((key) => key !== 'title') || typeof value.title !== 'string') {
          throw new Error('title must be the only string field');
        }
        return { title: value.title };
      },
      describe(input) { return \`the task list contains \${input.title}\`; },
      async arm({ page }, input) {
        return { async check() {
          const matched = await page.evaluate((title) => {
            const state = (window as unknown as { __taskState: { items: string[] } }).__taskState;
            return state.items.includes(title);
          }, input.title);
          return { matched, message: \`task \${input.title} is \${matched ? '' : 'not '}present\` };
        } };
      },
    }),
  },
});
`);
  const configBytes = readFileSync(configFile, 'utf8');
  writeFileSync(storyFile, `version: 1
id: add-item
ideal: user-work-is-never-lost
title: Add an item and continue working
start:
  url: http://127.0.0.1:${port}/app
story:
  as: a signed-in user
  want: to add "Buy milk" to my list
  so: I can continue planning
route: ${relativeRoute}
proofs:
  must:
    - id: item-exists
      use: task.itemExists
      with:
        title: Buy milk
  mustNot:
    - id: no-console-error
      use: browser.consoleError
      with: {}
`);
  const storyBytes = readFileSync(storyFile, 'utf8');

  try {
    const attempted = await attemptStory({ file: relativeStory, root, discover: async () => discovery('A') });
    expect(attempted.ok, attempted.reason).toBe(true);
    expect(readFileSync(storyFile, 'utf8')).toBe(storyBytes);
    expect(readFileSync(configFile, 'utf8')).toBe(configBytes);

    const typecheck = spawnSync('pnpm', ['exec', 'tsc', '--noEmit'], { cwd: root, encoding: 'utf8' });
    expect(typecheck.status, typecheck.stdout + typecheck.stderr).toBe(0);
    const routeA = readFileSync(routeFile, 'utf8');
    expect(routeA).toContain("locator: '#new'");
    expect((await replayStoryRoute(routeFile, loadStory(storyFile, root))).green).toBe(true);

    writeFileSync(stateFile, 'B');
    const oldResult = await replayStoryRoute(routeFile, loadStory(storyFile, root));
    expect(oldResult.green).toBe(false);
    expect(oldResult.routeFailures.length).toBeGreaterThan(0);

    const rebuilt = await rebuildStory({ file: relativeStory, root, discover: async () => discovery('B') });
    expect(rebuilt.ok, rebuilt.reason).toBe(true);
    const routeB = readFileSync(routeFile, 'utf8');
    expect(routeB).toContain("locator: '#quick-add'");
    expect(routeB).not.toBe(routeA);
    expect(readFileSync(storyFile, 'utf8')).toBe(storyBytes);
    expect(readFileSync(configFile, 'utf8')).toBe(configBytes);
    expect((await replayStoryRoute(routeFile, loadStory(storyFile, root))).green).toBe(true);
  } finally {
    server.kill('SIGTERM');
    await new Promise<void>((resolve) => server.once('exit', () => resolve()));
    rmSync(routeFile, { force: true });
    rmSync(configFile, { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});
