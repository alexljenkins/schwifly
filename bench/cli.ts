import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { selectEngine, ENGINES } from './engines/index.js';
import { renderComparison, renderRun } from './report.js';
import { runBenchmark } from './runner.js';
import { selectScenarios, SCENARIOS } from './scenarios.js';
import { repoRoot } from './workspace.js';
import type { BenchRun } from './types.js';

const USAGE = `Benchmark one Stagehand engine against the Schwifly evidence scenarios.

  pnpm run bench -- [--engine <id>] [--repeat <n>] [--scenario <id>]... [--out <file>]
  pnpm run bench -- compare <baseline.json> <candidate.json> [--out <file>]

Engines:   ${ENGINES.map((engine) => engine.id).join(', ')}
Scenarios: ${SCENARIOS.map((scenario) => scenario.id).join(', ')}

A live run needs OPENROUTER_API_KEY. Scenarios run one at a time and open a real browser.
Each run writes <out>.json next to the Markdown report so a later comparison stays exact.`;

function reportPaths(out: string | undefined, fallback: string): { markdown: string; json: string } {
  const markdown = resolve(repoRoot, out ?? fallback);
  return { markdown, json: markdown.replace(/\.mdx?$|$/, '') + '.json' };
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

async function main(): Promise<number> {
  // `pnpm run bench -- --repeat 1` hands this process a leading `--`, which parseArgs would
  // otherwise treat as the end of options and silently apply every default.
  const argv = process.argv.slice(2);
  if (argv[0] === '--') argv.shift();
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      engine: { type: 'string', default: ENGINES[0].id },
      repeat: { type: 'string', default: '3' },
      scenario: { type: 'string', multiple: true },
      out: { type: 'string' },
      help: { type: 'boolean' },
    },
    allowPositionals: true,
  });
  if (values.help) { console.log(USAGE); return 0; }

  if (positionals[0] === 'compare') {
    const [, baselineFile, candidateFile] = positionals;
    if (!baselineFile || !candidateFile) throw new Error('compare needs a baseline and a candidate JSON result file');
    const load = (file: string) => JSON.parse(readFileSync(resolve(repoRoot, file), 'utf8')) as BenchRun;
    const baseline = load(baselineFile);
    const candidate = load(candidateFile);
    const { markdown } = reportPaths(values.out, `docs/bench/${baseline.engine.id}-vs-${candidate.engine.id}.md`);
    write(markdown, renderComparison(baseline, candidate));
    console.log(`wrote ${markdown}`);
    return 0;
  }

  const repeat = Number(values.repeat);
  if (!Number.isInteger(repeat) || repeat < 1) throw new Error('--repeat needs a positive whole number');
  const engine = selectEngine(values.engine!);
  const run = await runBenchmark({
    engine,
    repeat,
    scenarios: selectScenarios(values.scenario),
    onProgress: (line) => console.error(line),
  });

  const { markdown, json } = reportPaths(values.out, `docs/bench/${engine.id}-results.md`);
  write(json, JSON.stringify(run, null, 2) + '\n');
  write(markdown, renderRun(run));
  console.log(`wrote ${markdown}`);
  console.log(`wrote ${json}`);
  return run.measurements.every((measurement) => measurement.met) ? 0 : 1;
}

main().then(
  (code) => { process.exitCode = code; },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  },
);
