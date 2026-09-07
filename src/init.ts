import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function initialize(args: string[], root = process.cwd()): void {
  if (args.length) throw new Error('usage: schwifly init [--root <directory>]');
  const example = new URL('../examples/task-app/', import.meta.url);
  const files = ['schwifly.config.ts', 'stories/add-item.story.yaml', 'server.mjs'];
  for (const file of files) {
    if (existsSync(resolve(root, file))) throw new Error(`init refuses to overwrite ${file}`);
  }
  for (const file of files) {
    const out = resolve(root, file);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, readFileSync(new URL(file, example)), { flag: 'wx' });
  }
  appendFileSync(resolve(root, '.gitignore'), '\n.schwifly/\ncandidates/\n.env\nnode_modules/\n');
  console.log('schwifly init: created a task app, story, and product proof. Start it with node server.mjs.');
}
