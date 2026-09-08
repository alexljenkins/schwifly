import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { skillSource } from '../dist/cliGuide.js';

const file = new URL('../skills/schwifly/SKILL.md', import.meta.url);
const source = skillSource();
if (process.argv.includes('--check')) {
  if (readFileSync(file, 'utf8') !== source) {
    console.error('Schwifly skill is stale. Run pnpm run skill:generate.');
    process.exitCode = 1;
  }
} else {
  mkdirSync(new URL('../skills/schwifly/', import.meta.url), { recursive: true });
  writeFileSync(file, source);
}
