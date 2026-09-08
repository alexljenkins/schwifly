import { expect, test } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync, writeFileSync, symlinkSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { decode } from '@toon-format/toon';
import { oneOff, readRun, saveRun, workspacePath } from '../src/oneOff';
import { modelCredential, readSettings, saveSettings, selectedModel, settingsPath } from '../src/settings';
import { redact } from '../src/secrets';
import { executableCommand, installIntegration } from '../src/integration';

const bin = fileURLToPath(new URL('../bin/schwifly.js', import.meta.url));
let root: string;
let oldCwd: string;
let oldEnv: NodeJS.ProcessEnv;

test.beforeEach(() => {
  oldCwd = process.cwd();
  oldEnv = { ...process.env };
  root = mkdtempSync(join(tmpdir(), 'schwifly-agent-'));
  process.chdir(root);
  process.env.XDG_CONFIG_HOME = join(root, 'config');
  process.env.SCHWIFLY_ROOT = root;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.SCHWIFLY_MODEL;
  delete process.env.SCHWIFLY_NO_HEAL;
  delete process.env.FORCE_COLOR;
});

test.afterEach(() => {
  process.chdir(oldCwd);
  process.env = oldEnv;
  rmSync(root, { force: true, recursive: true });
});

function cli(args: string[], input?: string) {
  return spawnSync(process.execPath, [bin, ...args], { cwd: root, env: process.env, encoding: 'utf8', input, timeout: 15000 });
}

async function asyncCli(args: string[]) {
  const child = spawn(process.execPath, [bin, ...args], { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', data => stdout += data);
  child.stderr.on('data', data => stderr += data);
  const status = await new Promise<number | null>((resolve, reject) => { child.once('close', resolve); child.once('error', reject); });
  return { stdout, stderr, status };
}

test('home gives definitive workspace state without loading credentials or creating files', () => {
  const result = cli([]);
  expect(result.status, result.stderr).toBe(0);
  const data = decode(result.stdout) as Record<string, unknown>;
  expect(data.runs).toBe('0 one-off runs in this workspace');
  expect(data.tests).toBe('0 saved tests in this workspace');
  expect(data.bin).toBe(bin.startsWith(homedir() + '/') ? '~' + bin.slice(homedir().length) : bin);
  expect(existsSync('.schwifly')).toBe(false);
});

test('every command accepts concise help and rejects unknown flags before mutation', () => {
  for (const command of ['run', 'runs', 'show', 'save', 'list', 'screenshot', 'setup', 'init', 'install-browser', 'suite', 'attempt', 'rebuild', 'gen', 'record', 'context']) {
    const help = cli([command, '--help']);
    expect(help.status, help.stdout + help.stderr).toBe(0);
    expect((decode(help.stdout) as { flags: object }).flags).toHaveProperty('root');
    const invalid = cli([command, '--misspelled', '--help']);
    expect(invalid.status, invalid.stdout).toBe(2);
    expect(invalid.stderr).toBe('');
    expect((decode(invalid.stdout) as { error: string }).error).toContain('--misspelled');
  }
  expect(existsSync('.schwifly')).toBe(false);
});

test('arguments, duplicate flags, and invalid limits fail as usage errors', () => {
  for (const args of [
    ['run', '--url', 'https://example.com'], ['run', 'task', '--url', 'ftp://example.com'],
    ['run', 'task', '--url', 'https://example.com', '--max-steps', '0'],
    ['run', 'task', '--url', 'https://example.com', '--save', '../escape'],
    ['run', 'task', '--url', 'https://example.com', '--url', 'https://elsewhere.com'],
    ['run', 'workflow.spec.ts', '--workers=2'], ['save', 'id'], ['runs', '--limit', '0'],
    ['setup', '--models', 'bad'], ['setup', '--models', 'a/b', '--model', 'a/c'],
    ['setup', '--agent', 'unknown'], ['list', '--fields', 'password'], ['setup', '--models='], ['run', '--url='],
  ]) {
    const result = cli(args);
    expect(result.status, result.stdout + result.stderr).toBe(2);
    expect(decode(result.stdout)).toHaveProperty('error');
  }
  expect(existsSync('.schwifly')).toBe(false);
});

test('version flags use a fast entrypoint comparable to a bare node process', () => {
  const measure = (args: string[]) => {
    const start = performance.now();
    const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
    return { result, elapsed: performance.now() - start };
  };
  const floor = Array.from({ length: 3 }, () => measure(['-e', 'console.log(1)']).elapsed).sort((a, b) => a - b)[1];
  for (const flag of ['--version', '-v', '-V']) {
    const probe = measure([bin, flag]);
    expect(probe.result.status).toBe(0);
    expect(probe.result.stdout.trim()).toBe('0.1.0');
    expect(probe.elapsed).toBeLessThan(floor * 5);
  }
  expect(cli(['run', '--version']).stdout.trim()).toBe('0.1.0');
});

test('setup stores models only, keeps keys out of output and environment, and fails closed', () => {
  let stored: string | null = null;
  const store = { getPassword: () => stored, setPassword: (key: string) => { stored = key; }, deletePassword: () => { stored = null; } };
  const settings = { version: 1 as const, models: ['provider/fast', 'provider/strong'], model: 'provider/fast', credential: true };
  saveSettings(settings, 'private-fixture-provider-key', store);
  expect(readSettings()).toEqual(settings);
  expect(modelCredential(store)).toBe('private-fixture-provider-key');
  expect(process.env.OPENROUTER_API_KEY).toBeUndefined();
  expect(readFileSync(settingsPath(), 'utf8')).not.toContain('private-fixture-provider-key');
  expect(redact('private-fixture-provider-key')).not.toContain('private-fixture-provider-key');
  expect(statSync(settingsPath()).mode & 0o777).toBe(0o600);
  expect(cli([]).stdout).not.toContain('private-fixture-provider-key');
  process.env.SCHWIFLY_MODEL = 'provider/unknown';
  expect(() => selectedModel('provider/fast')).toThrow('not configured');
  process.env.SCHWIFLY_NO_HEAL = '1';
  expect(modelCredential({ ...store, getPassword: () => { throw new Error('must not access keychain'); } })).toBeUndefined();
  delete process.env.SCHWIFLY_NO_HEAL;
  expect(() => saveSettings(settings, 'another-private-key', { ...store, setPassword: () => { throw new Error('another-private-key'); } })).toThrow('could not store the key');
  expect(readFileSync(settingsPath(), 'utf8')).not.toContain('another-private-key');
});

test('model-only setup and explicit integrations are idempotent and preserve unrelated hooks', () => {
  const configured = cli(['setup', '--models', 'provider/fast,provider/strong']);
  expect(configured.status, configured.stdout).toBe(0);
  expect(cli(['setup', '--key-stdin'], '').status).toBe(2);
  expect(existsSync('.codex')).toBe(false);
  mkdirSync('.claude');
  writeFileSync('.claude/settings.json', JSON.stringify({ permissions: { allow: ['Read'] }, hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo existing' }] }] } }));
  const installed = cli(['setup', '--agent', 'all', '--skill', '--json']);
  expect(installed.status, installed.stdout + installed.stderr).toBe(0);
  expect(JSON.parse(installed.stdout).integration.status).toBe('installed');
  const hooks = JSON.parse(readFileSync('.claude/settings.json', 'utf8'));
  expect(hooks.permissions.allow).toEqual(['Read']);
  expect(hooks.hooks.SessionStart).toHaveLength(2);
  expect(hooks.hooks.SessionStart[1].hooks[0].command).toContain(root);
  expect(installIntegration('all', true).status).toBe('unchanged');
  expect(readFileSync('.agents/skills/schwifly/SKILL.md', 'utf8')).toContain('pnpm dlx schwifly');
  const context = cli(['context']);
  expect(context.status).toBe(0);
  expect(decode(context.stdout)).toHaveProperty('totalRuns', 0);
});


test('integration commands reject a shadowing executable and repair their own hooks', () => {
  mkdirSync('first'); mkdirSync('second');
  writeFileSync('first/schwifly', '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  symlinkSync(bin, 'second/schwifly');
  process.env.PATH = `${resolve('first')}:${resolve('second')}`;
  expect(executableCommand()).toEqual([process.execPath, bin]);
  installIntegration('claude');
  const path = '.claude/settings.json';
  const config = JSON.parse(readFileSync(path, 'utf8'));
  config.hooks.SessionStart[0].hooks[0].command = '/old/schwifly context';
  writeFileSync(path, JSON.stringify(config));
  expect(installIntegration('claude').status).toBe('installed');
  expect(readFileSync(path, 'utf8')).not.toContain('/old/schwifly');
  process.env.PATH = resolve('second');
  expect(executableCommand()).toEqual(['schwifly']);
});

test('managed paths reject symlink escapes before writing', () => {
  const external = mkdtempSync(join(tmpdir(), 'schwifly-outside-'));
  try {
    symlinkSync(external, 'workflows');
    expect(() => workspacePath('workflows/escape.spec.ts')).toThrow('inside the workspace');
    symlinkSync(external, '.agents');
    expect(() => installIntegration(undefined, true)).toThrow('inside the workspace');
    expect(existsSync(join(external, 'skills'))).toBe(false);
    symlinkSync(join(external, 'missing'), 'dangling');
    expect(() => workspacePath('dangling')).toThrow('dangling symlink');
  } finally { rmSync(external, { recursive: true, force: true }); }
});

test('a disposable run certifies in an unrelated directory, retains screenshots, and saves only with fresh proof', async () => {
  test.setTimeout(90000);
  let broken = false;
  const server = createServer((_req, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end(`<button onclick="document.querySelector('p').textContent='${broken ? 'Broken' : 'Done'}'">Go</button><p>Ready</p><input value="private input">`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server has no port');
  const url = `http://127.0.0.1:${address.port}`;
  try {
    const result = await oneOff({ instruction: 'Click Go. <expect>Done</expect>', url, model: 'fixture/model', screenshots: true }, {
      discover: async request => {
        const { openConfiguredSession } = await import('../src/session');
        const session = await openConfiguredSession({ url, phase: 'discovery' });
        try {
          await request.onCheckpoint?.(session.page, 'start');
          await session.page.getByRole('button', { name: 'Go' }).click();
          await request.onCheckpoint?.(session.page, 'step-1');
          return { actions: [{ method: 'click', selector: 'button', description: 'Go', args: [], ok: true }], assertions: [{ type: 'exact', value: 'Done', intent: 'page shows Done', locator: 'p' }], unmet: [], notes: '' };
        } finally { await session.close(); }
      },
    });
    expect(result.status, result.reason).toBe('certified');
    expect(existsSync('workflows')).toBe(false);
    expect(result.artifacts).toHaveLength(2);
    for (const artifact of result.artifacts) expect(readFileSync(artifact.path).subarray(1, 4).toString()).toBe('PNG');
    const listing = cli(['runs', '--json']);
    expect(JSON.parse(listing.stdout).total).toBe(1);
    expect(readRun(result.id).candidateHash).toBeTruthy();
    const shown = cli(['show', result.id]);
    expect(decode(shown.stdout)).toHaveProperty('status', 'certified');
    const saved = await saveRun(result.id, 'click-go');
    expect(saved.status).toBe('saved');
    expect((await saveRun(result.id, 'click-go')).status).toBe('unchanged');
    expect(readFileSync('workflows/click-go.spec.ts', 'utf8')).toContain("from 'schwifly/test'");
    broken = true;
    await expect(saveRun(result.id, 'now-broken')).rejects.toThrow('fresh replay failed');
    expect(existsSync('workflows/now-broken.spec.ts')).toBe(false);
    writeFileSync(`.schwifly/runs/${result.id}/candidate.spec.ts`, 'tampered');
    await expect(saveRun(result.id, 'tampered')).rejects.toThrow('candidate changed');
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('the screenshot CLI captures a real page from an unrelated directory without a model key', async () => {
  test.setTimeout(30000);
  const server = createServer((_req, response) => response.end('<h1>Schwifly screenshot</h1><input value="hidden">'));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server has no port');
  try {
    const result = await asyncCli(['screenshot', `http://127.0.0.1:${address.port}`, '--out', 'screenshots/page.png']);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(decode(result.stdout)).toHaveProperty('screenshot', 'screenshots/page.png');
    expect(readFileSync('screenshots/page.png').subarray(1, 4).toString()).toBe('PNG');
    await test.info().attach('masked-page', { path: resolve('screenshots/page.png'), contentType: 'image/png' });
    expect(existsSync('.schwifly/browser.lock')).toBe(false);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('failed one-off evidence cannot be promoted even when the model claims success', async () => {
  const result = await oneOff({ instruction: '<expect>Done</expect>', url: 'https://example.com', model: 'fixture/model' }, {
    discover: async () => ({ actions: [], assertions: [], unmet: ['Done'], notes: 'I succeeded!' }), replay: async () => { throw new Error('must not replay'); },
  });
  expect(result.status).toBe('failed');
  await expect(saveRun(result.id, 'failed')).rejects.toThrow('not certified');
  expect(existsSync('workflows')).toBe(false);
  expect(cli(['context', '--end']).status).toBe(0);
  expect(JSON.parse(readFileSync('.schwifly/session.json', 'utf8')).runs).toEqual([result.id]);
  expect(decode(cli([]).stdout)).toHaveProperty('runsSinceSession', 0);
});
