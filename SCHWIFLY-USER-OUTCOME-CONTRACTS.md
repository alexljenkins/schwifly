# Build user-outcome contracts in Schwifly

## Mission

Change Schwifly from a workflow-first test generator into a user-outcome runner.

The durable source must be a user story plus deterministic proofs. The generated Playwright route must be replaceable when the interface changes.

The rule is:

> Discovery may vary. The verdict cannot.

An AI agent may discover a route through the interface. AI must never define, change, or judge criteria during a story-file run.

Complete the implementation, tests, documentation, and repository delivery. Work only from the Schwifly repository and this brief.

## Start here

1. Read `AGENTS.md`, `README.md`, `TODO.md`, `package.json`, and `playwright.config.ts` completely.
2. Read `src/attempt.ts`, `src/capture.ts`, `src/emit.ts`, `src/cli.ts`, `src/workflow.ts`, and `src/runLogs.ts`.
3. Read every test that covers those files.
4. Run the current key-free baseline.

```bash
pnpm install --frozen-lockfile
pnpm run verify
pnpm run typecheck
```

Do not edit until the baseline is green or you have documented the existing failure.

The paths in this brief describe Schwifly main at the time of writing. Preserve intent if a path has moved.

## Current behavior to preserve

Schwifly currently has these useful properties:

- `attemptFlow()` resolves an outcome before it starts discovery.
- `liveDiscover()` runs a bounded, same-origin Stagehand agent.
- Schwifly records concrete browser actions instead of agent narration.
- Schwifly normalizes successful actions into a Playwright workflow.
- A fresh Playwright process certifies a candidate with healing disabled.
- `replayGreen()` reads the step log because the process exit code is insufficient.
- Failed candidates remain available as redacted evidence.
- Existing output files are never silently overwritten.
- `gen`, `record`, `run`, and the current ticket form of `attempt` already work.

Keep these properties. Keep all existing tests green.

## Problem in the current model

`OutcomeContract` currently contains visible text checks. A vague ticket can ask AI to propose those checks.

This creates 3 problems:

- The outcome changes when interface copy changes.
- Text cannot prove persistence, identity, recovery, timing, or behavior across an interaction.
- AI can guess the target that later certifies its own route.

The new story path must remove that guess. A story file with incomplete proofs must fail before any browser or model starts.

Keep the old ticket path for compatibility. Do not use its proposed text contract inside the new story path.

## Product model

Separate these 4 artifacts:

| Artifact | Owner | Lifetime | Meaning |
|---|---|---|---|
| Ideal | Product author | Product lifetime | A user truth that should survive redesigns |
| Story | Product author | Feature lifetime | One concrete example of the ideal |
| Proof | Product author | Product lifetime | Deterministic evidence that decides pass or fail |
| Route | Schwifly | Interface lifetime | One generated way to reach the outcome |

The ideal, story, and proof live together in one source-controlled story file. Schwifly writes the route to a separate generated `.spec.ts` file.

The story file is authoritative. The route is a generated cache.

## Story file

Add a strict YAML format with the extension `.story.yaml`. Use a maintained YAML parser. Do not hand-write YAML parsing.

Support this version 1 shape:

```yaml
version: 1
id: add-item-without-losing-work
ideal: user-work-is-never-lost
title: Add an item and continue working

start:
  url: http://127.0.0.1:4173/app

story:
  as: a signed-in user
  want: to add "Buy milk" to my list
  so: I can continue planning without losing my work

route: workflows/add-item-without-losing-work.spec.ts

proofs:
  must:
    - id: item-exists
      use: task.itemExists
      with:
        title: Buy milk
    - id: item-survives-reload
      use: task.itemPersists
      with:
        title: Buy milk
    - id: next-action-available
      use: ui.elementEnabled
      with:
        role: textbox
        name: Add another item

  mustNot:
    - id: no-console-error
      use: browser.consoleError
      with: {}
```

Apply these schema rules:

- `version` must equal `1`.
- `id`, `ideal`, `title`, each story field, `start.url`, and `route` are required.
- `id` and every proof `id` must use lowercase letters, numbers, and hyphens.
- Proof IDs must be unique inside the story.
- Each proof must contain `id`, `use`, and a JSON-safe `with` object.
- `proofs.must` and `proofs.mustNot` default to empty arrays.
- The story must contain at least 1 proof across both arrays.
- Unknown top-level and nested keys must fail with their full path.
- The parser must reject aliases, executable tags, functions, and non-JSON values.
- `start.url` must be an absolute HTTP or HTTPS URL.
- `route` resolves from the repository root. It must stay inside that root and end in `.spec.ts`.
- The parser must report all schema errors in one run when practical.

The prose fields never become assertions. They form the agent instruction and human documentation only.

## Proof semantics

Each proof adapter detects one named condition.

- A `must` clause passes when its adapter returns `matched: true`.
- A `mustNot` clause passes when its adapter returns `matched: false`.
- An adapter error fails the clause.
- A missing result fails the clause.
- AI output is never proof evidence.

Use stable clause IDs in logs. Do not identify clauses by array position.

## Proof adapter API

Add a public adapter registry. A consumer must be able to add domain proofs without changing Schwifly.

Use an API with these capabilities. The exact TypeScript names may change if the repository already has a better convention.

```ts
type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

type ProofResult = {
  matched: boolean;
  message: string;
  evidence?: JsonValue;
};

type ArmedProof = {
  check(): Promise<ProofResult>;
  dispose?(): Promise<void>;
};

type ProofAdapter<Input extends JsonValue = JsonValue> = {
  parse(input: unknown): Input;
  describe(input: Input): string;
  arm(context: { page: Page; browserContext: BrowserContext }, input: Input): Promise<ArmedProof>;
};
```

`arm()` runs before the generated route. `check()` runs after the route.

This lifecycle supports these proof types:

- A final-state proof can inspect the page during `check()`.
- A persistence proof can open a sibling page during `check()`.
- A timing proof can capture the clock during `arm()`.
- An event proof can attach listeners during `arm()` and inspect events during `check()`.
- A baseline proof can capture state during `arm()` and compare it during `check()`.

Adapters must use browser facts, accessibility state, network facts, or an application-owned read-only state view. Adapters must not call an LLM.

Proof checks must not mutate the primary page. Use a sibling page or a read-only application interface when a check needs navigation.

The `parse()` function owns input validation for that adapter. Schwifly must validate every adapter input before opening a browser.

## Registry configuration

Load custom proof adapters from a repository-root `schwifly.config.ts` file.

Provide typed helpers similar to this shape:

```ts
import { defineConfig, defineProof } from './src/proofs';

export default defineConfig({
  proofs: {
    'task.itemExists': defineProof({
      parse(input) {
        // Validate and return the typed input.
      },
      describe(input) {
        return `the task list contains ${input.title}`;
      },
      async arm({ page }, input) {
        return {
          async check() {
            const matched = await page
              .getByRole('listitem', { name: input.title })
              .isVisible();
            return { matched, message: `task ${input.title} is visible` };
          },
        };
      },
    }),
  },
});
```

Implement the smallest config loader that works in both the `tsx` CLI and generated Playwright tests.

The generated route and the CLI must resolve the same registry. Cover that fact with a real generated-source typecheck and browser replay.

Ship these built-in adapters:

- `page.url` detects an exact or contained URL.
- `ui.elementVisible` detects a visible element.
- `ui.elementEnabled` detects an enabled element.
- `browser.consoleError` detects an error emitted after `arm()`.
- `browser.pageError` detects an uncaught page error emitted after `arm()`.

Use one strict locator input union for the UI adapters. Support role and accessible name, test ID, and CSS.

Custom adapters are the primary path for product outcomes. Built-ins only cover common browser facts.

## Proof execution and evidence

Create one proof engine that both discovery and generated replay use.

It must:

1. Parse the story.
2. Load built-in and custom adapters.
3. Validate every proof and its input.
4. Arm every proof before any route action.
5. Run each check after the route actions finish.
6. Apply `must` or `mustNot` polarity.
7. Dispose every armed proof in a `finally` block.
8. Return every clause result instead of stopping at the first failure.

Write proof results to isolated NDJSON logs beside the existing step logs.

Each record must include:

```ts
type ProofRecord = {
  storyId: string;
  clauseId: string;
  adapter: string;
  polarity: 'must' | 'mustNot';
  matched?: boolean;
  status: 'pass' | 'fail' | 'error';
  message: string;
  evidence?: JsonValue;
  file?: string;
};
```

Redact messages and evidence before persistence or terminal output. Preserve parallel-worker isolation.

The CLI report must show proof failures separately from route-step failures. Keep the output short and actionable.

## Story attempt

Add this command without removing the existing ticket form:

```bash
pnpm run schwifly attempt stories/add-item.story.yaml
```

When the first argument resolves to a `.story.yaml` file, use the new story path.

The story attempt must run this sequence:

1. Parse the complete story file.
2. Resolve the route path.
3. Refuse the run if the route already exists.
4. Load and validate every proof adapter and input.
5. Open the bounded, same-origin discovery session.
6. Arm the proofs before the first agent action.
7. Give the agent the role, want, reason, and proof descriptions.
8. Capture successful browser actions exactly as Schwifly does now.
9. Run the armed proofs against the final browser state.
10. Stop if any proof fails or is missing.
11. Emit a candidate route that loads the story and runs the same proofs.
12. Replay the candidate in a fresh browser with AI and healing disabled.
13. Save the route only if the steps and proofs are green.

Validation must happen before discovery can spend money or mutate the target application.

The generated route must not inline the proof clauses. It must load the authoritative story file during each run.

The generated route should contain a short header with:

- The story ID and title.
- The relative story path.
- A statement that the route is generated and replaceable.

Do not copy the full story into the generated file.

## Certification gate

Extend the current replay gate. A candidate is green only when all conditions hold:

- The Playwright process exits with code `0`.
- At least 1 route step is recorded.
- Every route step has status `ok`.
- Every expected proof clause has exactly 1 proof record.
- Every proof record has status `pass`.
- Healing remains disabled.

A missing proof log is a failure. A duplicate clause result is a failure. A proof error is a failure.

Keep `replayGreen()` pure. Extend its arguments or add a pure companion function with exhaustive tests.

## Route rebuilding

Add this command:

```bash
pnpm run schwifly rebuild stories/add-item.story.yaml
```

`rebuild` exists for interface changes. It must preserve the user promise while replacing a broken route.

Run this sequence:

1. Parse and validate the story and every proof.
2. Require the current generated route to exist.
3. Run the current route in a fresh browser with healing disabled.
4. Exit `0` without changing files when the current route is green.
5. Start bounded discovery only when the current route is red.
6. Arm and check the same story proofs during discovery.
7. Emit a candidate route from the newly observed actions.
8. Certify the candidate in another fresh browser.
9. Replace the current route only when the candidate is green.
10. Keep the old route byte-identical when discovery or certification fails.

Use an atomic same-directory replacement. Never delete the old route before the candidate is certified.

Keep a failed candidate as redacted debug evidence. Print both the preserved route path and candidate path.

`rebuild` must never edit the story file or `schwifly.config.ts`.

Use these exit rules:

- Exit `0` when the current route is already green.
- Exit `0` when Schwifly replaces the route with a certified candidate.
- Exit `1` on invalid input, failed discovery, failed proof, or failed certification.

Do not run `rebuild` automatically from `run`. CI must never rewrite source without an explicit command.

## Compatibility

Keep these behaviors unchanged:

- `schwifly gen "<story>" --url <url>`.
- `schwifly attempt "<ticket>" --url <url>`.
- `schwifly record <url>`.
- `schwifly run`.
- Existing generated workflows.
- Locator healing and successful write-back during normal runs.
- Key-free `pnpm run verify`.

The new story path is additive. Existing workflows need no migration.

Reject `--url` and `--out` when `attempt` receives a story file. The story file owns both values.

## Suggested code boundaries

Prefer these focused modules if current repository structure still matches this brief:

- `src/story.ts` owns YAML loading and strict schema validation.
- `src/proofs.ts` owns adapter types, helpers, registry merging, and proof execution.
- `src/proofLogs.ts` owns proof-record persistence and collection.
- `src/attempt.ts` orchestrates story discovery and certification.
- `src/emit.ts` emits the story-aware generated route.
- `src/cli.ts` dispatches story `attempt` and `rebuild`.

Keep capture normalization in `src/capture.ts`. Do not mix YAML parsing or proof execution into it.

Do not create a framework or plugin package. A typed config file and one adapter registry are enough.

## Implementation order

### 1. Story parser

Add the versioned schema and error reporting. Add key-free parser tests for every schema rule.

This step is complete when malformed stories fail before any injected discovery seam runs.

### 2. Proof registry and engine

Add adapter types, built-ins, custom config loading, polarity, lifecycle, disposal, and redaction.

This step is complete when key-free tests prove final-state, event, baseline, failure, error, and missing-result behavior.

### 3. Story-aware generated route

Make `emit()` produce a route that loads the story, arms proofs, runs steps, and records every proof result.

This step is complete when a generated route typechecks and runs in a real Chromium process without an LLM key.

### 4. Story attempt

Add file detection to the CLI and integrate the proof engine with discovery and certification.

This step is complete when a lying agent and a passing route cannot bypass a failed proof.

### 5. Rebuild

Add the explicit route replacement command and atomic preservation rules.

This step is complete when every failure path preserves the old route byte-for-byte.

### 6. Reporting and documentation

Show route failures and proof failures separately. Update `README.md`, CLI usage, examples, and `TODO.md`.

This step is complete when a new user can create one custom proof, attempt a story, break the interface, and rebuild the route.

## Required tests

Add focused tests for every case below.

### Story validation

- A valid version 1 story parses.
- Missing required fields fail with exact field paths.
- Unknown keys fail.
- Duplicate clause IDs fail.
- Unknown adapter names fail before browser creation.
- Invalid adapter inputs fail before browser creation.
- Unsafe YAML values fail.
- A route outside the repository fails.
- A story with zero proofs fails.

### Proof engine

- `must` passes only when `matched` is true.
- `mustNot` passes only when `matched` is false.
- Every proof arms before the first route action.
- Every proof checks after the last route action.
- Every armed proof disposes after success or failure.
- An adapter error becomes an error record.
- All clauses run when one clause fails.
- Secret values are redacted from messages, evidence, logs, and reports.
- Parallel workers write isolated proof logs.

### Certification

- Green steps and green proofs pass.
- A zero process exit with a failed step fails.
- Green steps with a failed proof fail.
- Green steps with a missing proof result fail.
- Green steps with a duplicate proof result fail.
- Green proofs with zero recorded steps fail.
- A healed certification step fails.

### Story attempt

- A green discovery and green replay save the generated route.
- A failed discovery proof prevents replay and saves no route.
- Agent narration cannot create proof evidence.
- An existing route prevents discovery.
- The story file remains byte-identical after success and failure.
- Generated source escapes hostile titles, paths, messages, and proof data.
- Concurrent attempts use different candidate files.

### Rebuild

- A green current route causes a no-op.
- A red route plus green candidate replaces the route.
- A failed discovery preserves the current route.
- A failed proof preserves the current route.
- A failed candidate replay preserves the current route.
- A concurrent file change prevents replacement instead of overwriting it.
- The story and config remain byte-identical in every case.

### Vertical browser proof

Build one deterministic local fixture inside the Schwifly test suite.

The fixture represents a small task application with one stable URL and 2 interface versions:

- Version A uses a `New item` action, a title field, and a `Save` action.
- Version B uses a quick-add field and an `Add` action.

Both versions must expose the same read-only domain fact for a custom `task.itemExists` proof.

Run this key-free test:

1. Create one unchanged story contract.
2. Generate and certify a route against interface A.
3. Switch the fixture to interface B at the same URL.
4. Prove the old route is red.
5. Rebuild and certify a different route.
6. Prove the story file is byte-identical.
7. Prove the final route passes with AI and healing disabled.

Use an injected deterministic discovery seam for this test. The test must exercise real Chromium for route certification.

This vertical test is the main acceptance witness. It proves that the promise stays stable while execution changes.

## Failure artifacts

Keep action logs, proof logs, and failed candidates for diagnosis.

Reuse screenshots or traces only when the current runner already creates them. Do not add automatic visual capture in this change.

These artifacts explain a failure. They never decide success.

Use existing ignored directories. Do not add tracked screenshots or visual baselines.

## Documentation

Update the README with one short section named `User-outcome contracts`.

Document:

- The 4-artifact model.
- The `.story.yaml` format.
- One custom proof adapter.
- `attempt <story-file>`.
- `rebuild <story-file>`.
- The rule that AI discovers routes but never grades outcomes.
- The compatibility status of the older commands.

Update CLI help with copy-pasteable commands. Update `TODO.md` to mark completed work and record only real follow-up work.

Do not add a long architecture document. The types, tests, and README are the maintained sources.

## Out of scope

Keep these items out of this change:

- Semantic LLM grading.
- AI-generated proof clauses during a run.
- Full-page pixel comparison.
- Screenshot approval workflows.
- Automatic crawling or story generation.
- Automatic CI source rewriting.
- Application fixture seeding or environment management.
- A remote service or hosted dashboard.
- A general plugin framework.
- Route minimization through delta debugging.
- Authentication changes unrelated to the new proof path.

## Definition of done

The work is complete only when all conditions hold:

- The new story format and custom proof registry work.
- `attempt <story-file>` saves only a certified route.
- `rebuild <story-file>` replaces only a broken route with a certified route.
- The story remains unchanged across interface versions.
- AI never creates or grades proof results for a story-file run.
- The key-free vertical browser proof passes.
- Every existing test remains green.
- The generated route passes a real TypeScript check.
- README, CLI help, and `TODO.md` match the shipped behavior.
- New story and proof code does not expose secrets in source, logs, reports, or candidates.
- The final worktree contains no temporary generated files.

Run the final gates:

```bash
pnpm run verify
pnpm run typecheck
git diff --check
git status --short
```

Follow the repository's `AGENTS.md` for branch, commit, push, and review requirements.

In the final report, state:

- The commands that ran and their exact outcomes.
- The vertical test that proved route replacement across 2 interfaces.
- Any live LLM test that ran.
- Any key-gated test that skipped because no key existed.
- The branch and commit that contain the work.
