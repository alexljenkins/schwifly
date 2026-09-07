# Schwifly

Schwifly turns authored stories into repeatable browser workflows. The author owns the story and its proof checks.
Schwifly discovers a route, then saves it only after a fresh replay passes those checks with healing disabled.
Established routes make no model calls. Recovery can replace a route, but keeps the story and proofs unchanged.
The caller owns app changes and decides when to retry after an outcome regression.

## Install

Use Node 22.6 or newer and the pnpm version selected by your repository.
Build an archive from this checkout:

```bash
pnpm pack --pack-destination artifacts
```

Install it in a consumer repository:

```bash
pnpm add -D /path/to/schwifly/artifacts/schwifly-0.1.0.tgz
pnpm exec schwifly install-browser
pnpm exec schwifly init
node server.mjs
```

`init` creates a task app, a story, a product proof, and a login example. It refuses to overwrite those files.
The app uses port 4173. Put `OPENROUTER_API_KEY` in the consumer's ignored `.env` file, then use another terminal:

```bash
pnpm exec schwifly attempt stories/add-item.story.yaml
pnpm exec schwifly run stories/add-item.story.yaml
```

All commands accept `--root <consumer-directory>`. Stories, config, routes, and evidence resolve against that root.
Generated workflows import `schwifly/*`. Consumers do not need this checkout's source.
The package supplies a serial Playwright configuration when the consumer has none.

## Author a story

```yaml
version: 1
id: add-item
ideal: work-is-saved
title: Add an item
start:
  url: http://127.0.0.1:4173/app
story:
  as: a user
  want: to add a task named Buy milk
  so: I can plan my work
route: workflows/add-item.spec.ts
proofs:
  must:
    - id: task-created
      use: tasks.created
      with: { title: Buy milk }
  mustNot:
    - id: no-browser-error
      use: browser.consoleError
      with: {}
```

The schema rejects unknown fields, malformed clauses, and routes outside the consumer root.
`must` requires a matching proof. `mustNot` requires a non-matching proof.
Every clause must produce exactly 1 passing result before certification succeeds.
Agent narration never counts as proof.

Define product proofs with `defineConfig()` and `defineProof()` from `schwifly` in `schwifly.config.ts`.
Each adapter validates its input, describes the required outcome, and provides an executable check.
`arm()` runs before the route and can capture a baseline or attach listeners.
`check()` returns `{ matched, message, evidence? }`. Optional `dispose()` removes listeners afterward.

The [task example](examples/task-app/schwifly.config.ts) checks that the app creates exactly 1 new task.
It cannot pass because an old task already exists.

| Built-in proof | Input |
| --- | --- |
| `page.url` | `{ exact: URL }` or `{ contains: text }` |
| `ui.elementVisible` | `{ role, name? }`, `{ testId }`, or `{ css }` |
| `ui.elementEnabled` | The same locator inputs |
| `browser.consoleError` | `{}` |
| `browser.pageError` | `{}` |

## Reset data and capture login

Story runs require an app-owned `setup()` function in `schwifly.config.ts`.
It runs before discovery, repair, and every fresh replay. Use an explicit no-op for apps that require no reset.
Schwifly opens a fresh browser session each time and reloads the start page after setup.

For authenticated apps, configure `session.storageState` and `session.check()`.
The state path is relative to the consumer root. `check()` returns whether that session is authenticated.
Missing state and expired login fail before discovery. Login credentials belong in the app's capture script, not generated routes.
Keep saved state under the ignored `.schwifly/auth/` directory.
Schwifly restores cookies, localStorage, and IndexedDB through the shared browser connection.
It redacts saved values stored under credential-named keys and opaque saved tokens. Stored preferences such as `theme=dark` stay readable.
The initial scope uses 1 identity and serial execution.

To exercise the task example's login, put these values in its `.env`:

```dotenv
SCHWIFLY_DEMO_AUTH=1
APP_PASSWORD=choose-a-test-password
```

Restart the example server, then capture login:

```bash
node login.mjs
```

## Run and recover

```bash
pnpm exec schwifly suite stories --json
pnpm exec schwifly suite stories --id add-item,delete-item --json
pnpm exec schwifly run stories/add-item.story.yaml --json
pnpm exec schwifly rebuild stories/add-item.story.yaml
```

Suites select stories by ID and run them serially. Missing routes use discovery.
`attempt` refuses an existing route. `rebuild` keeps a green route unchanged and certifies any replacement before saving it.

Story-backed runs first replay the established route without healing.
A broken route gets 1 element-repair attempt. The resolver tries accessible names before asking the model.
If repair cannot certify the story, Schwifly attempts 1 route rebuild using the same story and proofs.
Both repair paths require a fresh replay with healing disabled before write-back.
Login, setup, provider, and session-deadline failures stop recovery at every phase.
Failed certification and concurrent route edits preserve the prior route.
If route actions pass but a proof fails, Schwifly reports an outcome regression without changing the route.
A login, setup, provider, or session-deadline failure inside the runner reports that kind and starts no recovery.
The report keeps the runner diagnostic at `.schwifly/certifications/<run>/runner.txt`.

Generated story markers also send workflow-file and workflow-directory runs through story certification.
Malformed markers and missing story files produce invalid-contract results. Directory runs continue with the remaining workflows.
Legacy workflows without a story retain their existing locator-repair behavior.
To disable recovery for a run:

```bash
SCHWIFLY_NO_HEAL=1 pnpm exec schwifly suite stories
```

## Read builder results

Story commands write version 1 JSON under `.schwifly/results/` beside the human report.
`--json` writes the machine result to stdout. Diagnostics use stderr.
The result includes `storyId`, `phase`, `observedActions`, `failedProofIds`, `failure`, and `artifacts`.
Successful recovery also identifies `element` or `route` in the `recovery` field.
Suite results contain each story report and aggregate counts. Failures exit non-zero.

Failure kinds distinguish invalid contracts, incomplete exploration, unmet outcomes, route failures, proof errors, provider failures, login, setup, browser failures, and cancellation.
A failed exploration does not prove that the app cannot meet the story.
A caller can identify a failed proof, fix the app, and rerun the same story.

Artifact paths are relative to the consumer root.
Failure screenshots mask form fields, known secret text, and regions marked `data-schwifly-private` or `data-private`.
Successful repairs save redacted diffs under `.schwifly/repair-diffs/`.
The [consumer CI example](examples/ci/schwifly.yml) retains these results, screenshots, and diffs.

## Models and limits

`OPENROUTER_API_KEY` enables model calls. `SCHWIFLY_MODEL` selects an OpenRouter model ID.
The tested default is `google/gemini-3.8-flash`.
[Checkpoint evidence](docs/testing-suite-progress.md) records the live model checks and installed dependency versions.
Discovery, generation, optional recording labels, and model repair share the configuration in `src/llm.ts`.
Missing credentials leave deterministic replay and heuristic repair usable.
Authentication, budget, and rate-limit failures return explicit provider errors without automatic retries.

| Limit | Value |
| --- | --- |
| Default verification workers | 1 |
| Child runner workers | Always 1 |
| Discovery steps | At most 12 |
| Shared browser session | 120 seconds |
| Model request | 30 seconds |
| Model calls per session | At most 36 |
| Child runner | 180 seconds |
| Recovery per story run | 1 element repair, then at most 1 rebuild |

Run browser checks serially. Child runners enforce their own worker limit and terminate their process groups after cancellation.
Shared sessions close after errors, deadlines, SIGINT, and SIGTERM.
A session deadline reports a browser failure, so it never buys a repair or a rebuild.

## Other authoring commands

```bash
pnpm exec schwifly record http://localhost:4173/app
pnpm exec schwifly record http://localhost:4173/app --from recording.ts
pnpm exec schwifly gen 'Click Pricing. <validate>19</validate>' --url https://example.com
pnpm exec schwifly attempt 'Click Show receipt. <expect>Order confirmed</expect>' --url https://example.com
```

The recorder converts Playwright actions into the same deterministic workflow format.
`--from` imports an existing recording without opening the recorder.
Generation, attempts, and recordings refuse to overwrite existing outputs.
The older ticket form uses explicit visible-text outcome checks. Story files support product-specific proof functions.

## Develop

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm run typecheck
pnpm run verify --workers=1
pnpm run verify:package
```

Run those commands separately. Normal verification stays key-free.
The package check installs an archive in a separate consumer app and exercises authenticated discovery, replay, both recovery paths, an outcome regression, and CLI runs against an expired login and a missing setup hook.
It copies redacted evidence to `artifacts/consumer/` and removes the temporary consumer after a passing run.
It uses scripted browser discovery by default. To run the same consumer with live OpenRouter calls:

```bash
SCHWIFLY_LIVE=1 SCHWIFLY_MODEL=google/gemini-3.8-flash node --env-file=.env scripts/check-package.mjs
```

Stagehand 3.7.1 and Playwright 1.61.1 are pinned because capture depends on experimental evidence callbacks.
The architecture and earlier decisions are in [TODO.md](TODO.md) and [the contract design](SCHWIFLY-USER-OUTCOME-CONTRACTS.md).
Autonomous spec decomposition, app coding, crawling, persona simulation, and scoring remain outside this package.
