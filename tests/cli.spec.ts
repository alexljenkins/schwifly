import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsx = join(root, 'node_modules', '.bin', 'tsx');

function runCli(args: string[]): ReturnType<typeof spawnSync> {
  if (args[0] === 'run') args = [...args, '--foreground'];
  const base = join(root, '.schwifly');
  mkdirSync(base, { recursive: true });
  const cwd = mkdtempSync(join(base, 'cli-test-'));
  const env = { ...process.env };
  for (const key of [
    'OPENROUTER_API_KEY',
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
  expect(result.status).toBe(2);
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
  expect(result.status).toBe(2);
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
  expect(result.status).toBe(2);
  expect(result.stdout + result.stderr).toContain('already exists');
  rmSync(cwd, { recursive: true, force: true });
});

test('record validates its URL and output before opening interactive codegen', () => {
  const missing = runCli(['record']);
  expect(missing.status).toBe(2);
  expect(output(missing)).toContain('usage: schwifly record');

  const badUrl = runCli(['record', 'file:///tmp/page.html']);
  expect(badUrl.status).toBe(2);
  expect(output(badUrl)).toContain('URL must use http or https');

  const escape = runCli([
    'record',
    'https://example.com',
    '--out',
    '../escape.spec.ts',
  ]);
  expect(escape.status).toBe(2);
  expect(output(escape)).toContain('workflows/<name>.spec.ts');
  expect(output(escape)).not.toContain('complete the flow');
});

test('story attempts reject ticket-owned URL and output flags', () => {
  for (const args of [
    ['attempt', 'stories/add.story.yaml', '--url', 'https://example.com'],
    ['attempt', 'stories/add.story.yaml', '--out', 'workflows/other.spec.ts'],
  ]) {
    const result = runCli(args);
    expect(result.status).toBe(1);
    expect(output(result)).toContain('a story file owns its URL');
    expect(output(result)).not.toContain('needs an LLM key');
  }
});

test('rebuild requires one story file and rejects unrelated flags', () => {
  const missing = runCli(['rebuild']);
  expect(missing.status).toBe(2);
  expect(output(missing)).toContain('usage: schwifly rebuild');

  const option = runCli(['rebuild', 'stories/add.story.yaml', '--out', 'workflows/x.spec.ts']);
  expect(option.status).toBe(2);
  expect(output(option)).toContain('--out');
});

test('an invalid story marker reports a contract failure and permits other workflows to run', () => {
  const base = join(root, '.schwifly');
  mkdirSync(base, { recursive: true });
  const cwd = mkdtempSync(join(base, 'cli-markers-'));
  const workflows = join(cwd, 'workflows');
  mkdirSync(workflows);
  const broken = join(workflows, 'broken.spec.ts');
  const source = '// Schwifly story: "missing.story.yaml"\nthrow new Error("must not execute a broken story as legacy");\n';
  writeFileSync(broken, source);
  writeFileSync(join(workflows, 'legacy.spec.ts'), `import { test } from 'schwifly/test';
import { writeFileSync } from 'node:fs';
test('selected legacy workflow', () => { writeFileSync('executed.txt', 'yes'); });
`);
  const cli = (args: string[]) => spawnSync(tsx, [join(root, 'src', 'cli.ts'), '--root', cwd, ...args, '--foreground'], { cwd: root, encoding: 'utf8' });
  try {
    for (const marker of ['"missing.story.yaml"', '{}', '']) {
      writeFileSync(broken, source.replace('"missing.story.yaml"', marker));
      const result = cli(['run', broken, '--json']);
      expect(result.status, output(result)).toBe(1);
      expect(JSON.parse(String(result.stdout)).failure.kind).toBe('invalid_contract');
    }
    writeFileSync(broken, source);
    const directory = cli(['run', 'workflows/', '--workers=1']);
    expect(directory.status, output(directory)).toBe(1);
    expect(existsSync(join(cwd, 'executed.txt')), output(directory)).toBe(true);
    expect(readFileSync(broken, 'utf8')).toBe(source);
    const legacyJson = cli(['run', 'workflows/legacy.spec.ts', '--json']);
    expect(legacyJson.status, output(legacyJson)).toBe(0);
    expect(JSON.parse(String(legacyJson.stdout))).toMatchObject({ status: 'passed', total: 1 });
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
