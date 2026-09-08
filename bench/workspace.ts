import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppVariant } from './types.js';

export const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * A disposable Schwifly workspace under the repository, so generated routes still resolve the
 * `schwifly/*` self-reference and every benchmark run starts from identical files on disk.
 */
export interface BenchWorkspace {
  root: string;
  storyFile: string;
  routeFile: string;
  url: string;
  setVariant(variant: AppVariant): void;
  /** Delete the generated route so the next scenario starts with no route on disk. */
  clearRoute(): void;
  close(): Promise<void>;
}

const CONFIG = `import { expect } from 'schwifly/test';
import { defineConfig, defineProof } from 'schwifly';

// Proofs the repairer may not touch. \`tasks.stored\` reads the server, so a success message
// alone never satisfies it. \`tasks.listed\` polls the rendered list, so a slow render passes
// and a missing render fails. Both demand an exact count, so a duplicated write fails too.
const exactCount = (describe: (input: { title: string; count: number }) => string, read: (context: { page: import('@playwright/test').Page }, title: string) => Promise<number>) =>
  defineProof<{ title: string; count: number }>({
    parse(input) {
      const value = input as { title?: unknown; count?: unknown } | null;
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2 ||
          typeof value.title !== 'string' || typeof value.count !== 'number') {
        throw new Error('with needs a string title and a number count');
      }
      return { title: value.title, count: value.count };
    },
    describe,
    async arm(context, { title, count }) {
      return { async check() {
        await expect.poll(() => read(context, title), { timeout: 4000 }).toBe(count).catch(() => {});
        const found = await read(context, title);
        return { matched: found === count, message: \`found \${found} of \${count} for "\${title}"\`, evidence: { found, expected: count } };
      } };
    },
  });

export default defineConfig({
  async setup({ page, url }) {
    const response = await page.request.post(new URL('/reset', url).href);
    if (!response.ok()) throw new Error('benchmark app reset failed');
  },
  proofs: {
    'tasks.stored': exactCount(
      ({ title, count }) => \`the server stores exactly \${count} task named \${title}\`,
      async ({ page }, title) => {
        const stored = await (await page.request.get(new URL('/api/items', page.url()).href)).json() as string[];
        return stored.filter(item => item === title).length;
      },
    ),
    'tasks.listed': exactCount(
      ({ title, count }) => \`the page lists exactly \${count} task named \${title}\`,
      async ({ page }, title) => page.locator('#items li', { hasText: title }).count(),
    ),
  },
});
`;

function story(url: string): string {
  return `version: 1
id: add-task
ideal: work-is-saved
title: Add a task
start:
  url: ${url}
story:
  as: a user
  want: to add a task named Buy milk
  so: my work is saved
route: workflows/add-task.spec.ts
proofs:
  must:
    - id: task-stored
      use: tasks.stored
      with:
        title: Buy milk
        count: 1
    - id: task-listed
      use: tasks.listed
      with:
        title: Buy milk
        count: 1
  mustNot:
    - id: no-console-error
      use: browser.consoleError
      with: {}
`;
}

export async function openWorkspace(id: string): Promise<BenchWorkspace> {
  const root = resolve(repoRoot, '.schwifly', 'bench', id);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(resolve(root, 'workflows'), { recursive: true });
  const variantFile = resolve(root, 'variant');
  writeFileSync(variantFile, 'baseline');

  const app: ChildProcess = spawn(
    resolve(repoRoot, 'node_modules', '.bin', 'tsx'),
    [resolve(repoRoot, 'bench', 'app', 'server.ts'), variantFile],
    { cwd: repoRoot, stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const port = await new Promise<number>((ready, fail) => {
    app.once('error', fail);
    app.once('exit', (code) => fail(new Error(`benchmark app exited with ${code}`)));
    app.stdout!.once('data', (data) => ready(Number(String(data).trim())));
  });
  const url = `http://127.0.0.1:${port}/`;

  writeFileSync(resolve(root, 'schwifly.config.ts'), CONFIG);
  const storyFile = resolve(root, 'add-task.story.yaml');
  writeFileSync(storyFile, story(url));
  const routeFile = resolve(root, 'workflows', 'add-task.spec.ts');

  return {
    root, storyFile, routeFile, url,
    setVariant: (variant) => writeFileSync(variantFile, variant),
    clearRoute: () => rmSync(routeFile, { force: true }),
    async close() {
      app.kill('SIGTERM');
      await new Promise<void>((done) => app.once('exit', () => done()));
    },
  };
}
