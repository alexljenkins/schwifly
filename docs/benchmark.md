# Benchmarking a Stagehand version

This harness answers the evidence table in
[the v4 product assessment](stagehand-v4-product-assessment.md) with measured numbers instead of
vendor claims. It runs one engine at a time against a controlled app, records what each run cost,
and writes a Markdown report plus the JSON behind it.

It is a development tool. Nothing here ships in the package.

## Run it

```bash
pnpm run bench -- --help
pnpm run bench -- --repeat 3
pnpm run bench -- --engine stagehand-4 --repeat 3
pnpm run bench -- --repeat 1 --scenario discover --scenario replay-unchanged
```

A live run needs `OPENROUTER_API_KEY`. Set `SCHWIFLY_MODEL` to pin the model, because the model
choice changes every number in the report. Scenarios run one at a time and open a real browser,
so do not run anything else that drives a browser at the same time.

Each run writes `docs/bench/<engine>-results.md` and `docs/bench/<engine>-results.json`. The exit
code is 0 when every scenario met its required evidence.

Compare two saved runs:

```bash
pnpm run bench -- compare docs/bench/stagehand-3.7-results.json docs/bench/stagehand-4-results.json
```

The comparison gives each scenario its own table. It shows every run, then one median row per engine.
The last table places both engine medians side by side.

## What it measures

Per scenario, across repetitions:

- Median and slowest wall clock for the whole operation, child processes included.
- Model calls, input and output tokens, and USD cost priced from OpenRouter's live model list.
- Browser actions captured, and deterministic route steps replayed.
- Whether the required evidence was met, and whether repeated runs disagreed.
- How a certified route recovered: `element` for a healed locator, `route` for a rediscovery.

`src/modelMeter.ts` writes one record per model request to the file named by
`SCHWIFLY_MODEL_LOG`. Discovery runs in this process and repair runs in a Playwright child, so
the meter is a file rather than a counter.

## The controlled app

`bench/app/server.ts` serves one page with 5 variants, selected by a file the harness rewrites
between scenarios. The URL never changes, so a route saved against `baseline` replays against a
seeded defect without its baked-in URL moving.

| Variant | Behaviour |
| --- | --- |
| `baseline` | Click "New item", type a title, click Save. The task is stored and listed. |
| `moved-control` | The opener's id and label both change. Behaviour is identical. |
| `broken-persistence` | Save answers 200 and shows "Saved". Nothing is stored. |
| `duplicate-submit` | One Save stores the task twice. |
| `slow-update` | The list renders 1200 ms after the write. |

Two proofs guard every scenario, and the repairer cannot edit them. `tasks.stored` reads the
server, so a success message alone never satisfies it. `tasks.listed` polls the rendered list, so
a slow render passes and a missing render fails. Both demand an exact count, which is what
catches the duplicated write.

## Stagehand v4 engine

The v4 benchmark uses `stagehand-v4`, a development-only alias pinned to Stagehand 4.1.0.
The shipped package remains on Stagehand 3.7.3. Running the v4 benchmark needs Node 22.18 or newer.

`bench/engines/stagehand4.ts` implements the external-agent approach from the v4 migration guide.
Each bounded step sends the current v4 accessibility snapshot to the selected OpenRouter model.
The model chooses `click`, `fill`, or `done`, and Stagehand executes the grounded XPath.
The adapter records a role-and-name selector derived from the snapshot, never from model prose.

Playwright remains the certification and replay gate. Existing generated workflows also retain
the v3 healing tier, so the repair row measures v4 route discovery plus the current repair path.
It does not claim to measure a native v4 repair implementation.

Run both engines on the same host, the same model, and the same scenarios, then compare. The
comparison report prints a "Not like for like" section when the two runs disagree on model or
platform. Do not delete that section. It is the difference between evidence and a press release.

The measured 3-run comparison is in
[`docs/bench/stagehand-3.7-vs-stagehand-4.md`](bench/stagehand-3.7-vs-stagehand-4.md).

## What this harness does not cover

- Browser startup failure. Playwright resolves its browser registry when the module loads, so the
  harness cannot break the browser for the parent process after the fact. The infrastructure
  scenario removes model access instead, which is the other half of the same assessment row.
- Remote browsers. Every run is local, which is the environment Schwifly ships into.
- Repeated development requests against a persistent tester. That path is
  [tester sessions](tester-sessions.md) and needs its own scenarios.
