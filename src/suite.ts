import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadStory } from './story.js';
import { attemptStory, runStory, type StoryAttemptOptions } from './storyAttempt.js';
import type { StoryReport } from './result.js';

export interface SuiteOptions {
  root?: string;
  directory?: string;
  ids?: string[];
  /** Key-free discovery seam. The CLI always uses live discovery. */
  discover?: StoryAttemptOptions['discover'];
}
export interface SuiteResult {
  version: 1;
  ok: boolean;
  results: StoryReport[];
  summary: { total: number; certified: number; failed: number };
  resultPath: string;
}

function storyFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? storyFiles(path) : entry.isFile() && entry.name.endsWith('.story.yaml') ? [path] : [];
  }).sort();
}

export async function runSuite(options: SuiteOptions = {}): Promise<SuiteResult> {
  const root = resolve(options.root ?? process.env.SCHWIFLY_ROOT ?? process.cwd());
  let files = storyFiles(resolve(root, options.directory ?? 'stories'));
  if (options.ids?.length) {
    const found = new Set<string>();
    files = files.filter(file => {
      const id = loadStory(file, root).story.id;
      if (!options.ids!.includes(id)) return false;
      found.add(id);
      return true;
    });
    const missing = options.ids.filter(id => !found.has(id));
    if (missing.length) throw new Error(`unknown story IDs: ${missing.join(', ')}`);
  }
  if (!files.length) throw new Error('no stories selected');
  const results: StoryReport[] = [];
  for (const file of files) {
    let routeExists = false;
    try { routeExists = existsSync(loadStory(file, root).routeFile); } catch { /* attemptStory reports invalid contracts. */ }
    const result = await (routeExists ? runStory : attemptStory)({ root, file, discover: options.discover });
    results.push(result.report!);
    if (result.report?.failure?.kind === 'cancelled') break;
  }
  const certified = results.filter(result => result.status === 'certified').length;
  const dir = resolve(root, '.schwifly', 'results');
  mkdirSync(dir, { recursive: true });
  const result: SuiteResult = {
    version: 1, ok: certified === results.length, results,
    summary: { total: results.length, certified, failed: results.length - certified },
    resultPath: resolve(dir, `suite.${randomUUID()}.json`),
  };
  writeFileSync(result.resultPath, JSON.stringify(result, null, 2) + '\n');
  return result;
}
