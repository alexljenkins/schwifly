import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { applyHeal, type HealRecord } from './workflow';

// schwifly run [path]
//   1. run workflows in the Playwright runner (deterministic, parallel)
//   2. apply any heals the AI backup produced -> the workflows are now updated
const HEAL_LOG = '.schwifly/heals.ndjson';

const args = process.argv.slice(2);
const cmd = args[0];

if (cmd !== 'run') {
  console.log('usage: schwifly run [path]');
  process.exit(cmd ? 1 : 0);
}

const target = args[1] ?? 'workflows/';
if (existsSync(HEAL_LOG)) rmSync(HEAL_LOG);

const res = spawnSync('npx', ['playwright', 'test', target], { stdio: 'inherit' });

if (existsSync(HEAL_LOG)) {
  const recs: HealRecord[] = readFileSync(HEAL_LOG, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  let updated = 0;
  for (const rec of recs) if (applyHeal(rec)) updated++;
  console.log(`\nschwifly: AI healed ${recs.length} step(s); updated ${updated} workflow file(s).`);
} else {
  console.log('\nschwifly: no heals needed — workflows ran deterministically.');
}

process.exit(res.status ?? 0);
