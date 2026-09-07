import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
const root = process.cwd();
const env = { ...process.env };
if (env.SCHWIFLY_LIVE !== '1') delete env.OPENROUTER_API_KEY;
delete env.SCHWIFLY_NO_HEAL;
delete env.SCHWIFLY_ROOT;
const fixture = mkdtempSync(join(tmpdir(), 'schwifly-consumer-'));
mkdirSync('artifacts', { recursive: true });
rmSync('artifacts/package-check.json', { force: true });
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 600_000 });
  if (result.status !== 0) throw new Error(result.stdout + result.stderr);
  return result.stdout;
}
run('pnpm', ['pack', '--pack-destination', resolve('artifacts')]);
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
writeFileSync(join(fixture, 'package.json'), JSON.stringify({ name: 'schwifly-consumer-check', private: true, type: 'module', packageManager: pkg.packageManager }));
run('pnpm', ['add', '--ignore-scripts', resolve(`artifacts/schwifly-${pkg.version}.tgz`)], fixture);
run('pnpm', ['exec', 'schwifly', 'init'], fixture);
cpSync('tests/fixtures/packageConsumer.mjs', join(fixture, 'check.mjs'));
console.log(`Packed consumer: ${fixture}`);
try {
  const output = run(process.execPath, ['check.mjs'], fixture);
  console.log(output);
  const scenarios = JSON.parse(output.trim().split('\n').at(-1));
  writeFileSync('artifacts/package-check.json', JSON.stringify({ fixture, version: pkg.version, ok: true, ...scenarios }) + '\n');
} finally {
  rmSync('artifacts/consumer', { recursive: true, force: true });
  for (const name of ['results', 'certifications', 'evidence', 'repair-diffs', 'model-calls.ndjson']) {
    const source = join(fixture, '.schwifly', name);
    if (existsSync(source)) {
      mkdirSync('artifacts/consumer', { recursive: true });
      cpSync(source, resolve('artifacts/consumer', name), { recursive: true });
    }
  }
}
