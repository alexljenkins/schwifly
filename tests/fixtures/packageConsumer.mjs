import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { attemptStory, rebuildStory, replayStoryRoute, loadStory, runProofs } from 'schwifly';
import { openSharedSession } from 'schwifly/sharedCdp';
import { openConfiguredSession } from 'schwifly/session';
process.env.SCHWIFLY_DEMO_AUTH = '1';
process.env.APP_PASSWORD = 'fixture-login-password';
const root = process.cwd();
const state = resolve('version');
writeFileSync(state, 'A');
const server = spawn(process.execPath, ['server.mjs'], {
  env: { ...process.env, PORT: '0', SCHWIFLY_DEMO_STATE: state }, stdio: ['ignore', 'pipe', 'inherit'],
});
const port = await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.stdout.once('data', chunk => resolve(Number(String(chunk).trim())));
});
const url = `http://127.0.0.1:${port}/app`;
const file = 'stories/add-item.story.yaml';
writeFileSync(file, readFileSync(file, 'utf8').replace('http://127.0.0.1:4173/app', url));
const originalStory = readFileSync(file, 'utf8');
const login = await openSharedSession();
try {
  const response = await login.page.request.post(new URL('/login', url).href, { data: { password: process.env.APP_PASSWORD } });
  assert.equal(response.ok(), true);
  await login.page.goto(url);
  await login.page.evaluate(() => localStorage.setItem('session-marker', 'private-local-state'));
  mkdirSync('.schwifly/auth', { recursive: true });
  await login.page.context().storageState({ path: '.schwifly/auth/demo.json' });
} finally { await login.close(); }

async function cli(args) {
  const child = spawn('pnpm', ['exec', 'schwifly', ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const code = await new Promise(resolve => child.once('close', resolve));
  assert.equal(code, 0, output);
}
const discover = version => async request => {
  const session = await openConfiguredSession({ root, url, story: request.loaded.story, phase: 'discovery' });
  assert.equal(await session.page.evaluate(() => localStorage.getItem('session-marker')), 'private-local-state');
  const actions = version === 'A' ? [
    { method: 'click', selector: '#new', description: 'New item', args: [], ok: true },
    { method: 'fill', selector: '#title', description: 'Title', args: ['Buy milk'], ok: true },
    { method: 'click', selector: '#save', description: 'Save', args: [], ok: true },
  ] : [
    { method: 'fill', selector: '#quick-add', description: 'Quick add', args: ['Buy milk'], ok: true },
    { method: 'click', selector: '#add', description: 'Add', args: [], ok: true },
  ];
  try {
    await session.page.goto(url);
    const proofRun = await runProofs({ proofs: request.proofs,
      context: { page: session.page, browserContext: session.page.context() },
      route: async () => {
        for (const action of actions) {
          const locator = session.page.locator(action.selector);
          if (action.method === 'fill') await locator.fill(action.args[0]);
          else await locator.click();
        }
        await session.page.getByText('Buy milk', { exact: true }).first().waitFor();
      },
    });
    return { actions, proofs: proofRun.records, notes: 'scripted browser discovery' };
  } finally { await session.close(); }
};
try {
  const attempt = await attemptStory({ root, file, discover: discover('A') });
  assert.equal(attempt.ok, true, attempt.reason);
  await cli(['run', 'workflows/add-item.spec.ts', '--root', root]);
  const replay = await replayStoryRoute(resolve('workflows/add-item.spec.ts'), loadStory(file, root));
  assert.equal(replay.green, true, JSON.stringify(replay));
  writeFileSync('recorded.ts', `import { test } from '@playwright/test';
    test('record', async ({ page }) => {
      await page.goto('${url}');
      await page.getByRole('button', { name: 'New item' }).click();
      await page.getByLabel('Title').fill('Buy milk');
      await page.getByRole('button', { name: 'Save' }).click();
    });`);
  await cli(['record', url, '--from', 'recorded.ts', '--out', 'workflows/recorded.spec.ts']);
  await cli(['run', 'workflows/recorded.spec.ts']);
  writeFileSync(state, 'B');
  const rebuilt = await rebuildStory({ root, file, discover: discover('B') });
  assert.equal(rebuilt.ok, true, rebuilt.reason);
  assert.equal(readFileSync(file, 'utf8'), originalStory);
  assert.equal((await replayStoryRoute(resolve('workflows/add-item.spec.ts'), loadStory(file, root))).green, true);
  const savedState = JSON.parse(readFileSync('.schwifly/auth/demo.json', 'utf8'));
  savedState.cookies[0].value = 'expired';
  writeFileSync('.schwifly/auth/demo.json', JSON.stringify(savedState));
  await assert.rejects(openConfiguredSession({ root, url, story: loadStory(file, root).story, phase: 'replay' }), /login expired/);
  writeFileSync('schwifly.config.ts', 'export default {};');
  await assert.rejects(openConfiguredSession({ root, url, story: loadStory(file, root).story, phase: 'replay' }), /missing setup/);
  console.log('Packed consumer passed attempt, run, recording import, and rebuild.');
} finally {
  const exited = new Promise(resolve => server.once('exit', resolve));
  server.kill('SIGTERM');
  await exited;
}
