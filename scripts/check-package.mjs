import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
const root = process.cwd();
const fixture = mkdtempSync(join(tmpdir(), 'schwifly-consumer-'));
mkdirSync('artifacts', { recursive: true });
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 300_000 });
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
console.log(run(process.execPath, ['check.mjs'], fixture));
writeFileSync('artifacts/package-check.json', JSON.stringify({ fixture, version: pkg.version, ok: true }) + '\n');
