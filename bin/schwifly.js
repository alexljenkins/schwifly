#!/usr/bin/env node
import { readFileSync } from 'node:fs';
if (process.argv.length === 3 && ['--version', '-v', '-V'].includes(process.argv[2])) {
  console.log(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
} else {
  await import('../dist/cli.js');
}
