import { expect, test } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsx = join(root, 'node_modules', '.bin', 'tsx');

function runCli(args: string[]): ReturnType<typeof spawnSync> {
  const base = join(root, '.schwifly');
  mkdirSync(base, { recursive: true });
  const cwd = mkdtempSync(join(base, 'cli-test-'));
  const env = { ...process.env };
  for (const key of [
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'GOOGLE_GENERATIVE_AI_API_KEY',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
  ]) delete env[key];
  const result = spawnSync(tsx, [join(root, 'src', 'cli.ts'), ...args], {
    cwd,
    env,
    encoding: 'utf8',
  });
  rmSync(cwd, { recursive: true, force: true });
  return result;
}

function output(result: ReturnType<typeof spawnSync>): string {
  return String(result.stdout ?? '') + String(result.stderr ?? '');
}

test('run exits non-zero when Playwright finds no matching tests', () => {
  const result = runCli(['run', 'does-not-exist']);
  expect(result.status, output(result)).toBe(1);
  expect(output(result)).toContain('No tests found');
});

test('gen does not mistake a flag value for the missing story', () => {
  const result = runCli(['gen', '--url', 'https://example.com']);
  expect(result.status).toBe(1);
  expect(output(result)).toContain('usage: schwifly gen');
  expect(output(result)).not.toContain('needs an LLM key');
});

test('gen rejects output outside workflows before discovery can run', () => {
  const result = runCli([
    'gen',
    'Open pricing',
    '--url',
    'https://example.com',
    '--out',
    '../escape.spec.ts',
  ]);
  expect(result.status).toBe(1);
  expect(output(result)).toContain('workflows/<name>.spec.ts');
  expect(output(result)).not.toContain('needs an LLM key');
});

test('gen refuses to overwrite an existing workflow before discovery can run', () => {
  const base = join(root, '.schwifly');
  mkdirSync(base, { recursive: true });
  const cwd = mkdtempSync(join(base, 'cli-test-'));
  const workflowDir = join(cwd, 'workflows');
  const existing = join(workflowDir, 'existing.spec.ts');
  mkdirSync(workflowDir, { recursive: true });
  writeFileSync(existing, 'preserve me');
  const env = { ...process.env };
  for (const key of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY']) delete env[key];
  const result = spawnSync(
    tsx,
    [
      join(root, 'src', 'cli.ts'),
      'gen',
      'Open pricing',
      '--url',
      'https://example.com',
      '--out',
      'workflows/existing.spec.ts',
    ],
    { cwd, env, encoding: 'utf8' },
  );
  expect(result.status).toBe(1);
  expect(result.stdout + result.stderr).toContain('already exists');
  rmSync(cwd, { recursive: true, force: true });
});
