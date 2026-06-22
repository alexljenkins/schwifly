# schwifly — roadmap & TODO

> Orientation for a fresh-context agent. Read **The idea** + **Current state** + **Locked
> decisions**, then go to **Remaining work** (what's still open) or the **Live-validation
> checklist** (the LLM paths that are typechecked but not yet exercised live). The v1 hero loop is
> built and verified — **Shipped** records what already landed so you don't redo it.

---

## The idea

A **black-box web test platform**. The **hero rule**: a deterministic workflow runs every time;
the **AI is only the backup** — when a step fails, it heals the step, writes the fix back into the
workflow, and re-runs. If it genuinely can't, the test fails for real. Workflow primary, AI backup.
Works on any web app you can reach — no backend, no special access.

A **workflow is a real Playwright `.spec.ts`** built from a user story. "Updating the workflow" =
a git diff on one locator string.

---

## Current state — your starting point

The **v1 hero loop is built and verified** (branch `complete-rebuild`, commit `f16b80d`). Stack:
**TypeScript · Playwright** (Apache-2.0, runner+browser) **· Stagehand v3** (MIT, local,
bring-your-own LLM key). Node 22, ESM, `moduleResolution: Bundler`.

```bash
npm install && npx playwright install chromium
npm run verify       # 19 passed / 2 key-gated skips / 0 failed — real chromium, NO key needed
npm run schwifly run # run workflows/, print the verdict table, then apply any AI heals
npm run schwifly gen "<story>" -- --url <start> # story → .spec.ts (note the `--`; locator discovery key-gated)
npm run typecheck
```

The engine (read these first):
- `src/workflow.ts` — `step(page, {intent, locator, action, value}, opts)`: deterministic `locator`
  first; on failure calls `opts.resolver`; records a `HealRecord`, and `applyHeal()` writes the
  healed locator back into the `.spec.ts`. Persists every `StepResult` to `opts.stepLog`
  (`.schwifly/steps.ndjson`) so the **impossible** signal survives to the CLI. Actions:
  `click | fill | expectVisible | expectText`.
- `src/heal.ts` — `PlaywrightHeuristicResolver` (no LLM; role/name/text/aria), `StagehandResolver`
  (LLM via `observe(intent,{page})→selector`), `EscalatingResolver` (heuristic first, LLM only when
  the heuristic returns `null` AND a key exists), `makeStagehandResolver`. Exports `inferRole` /
  verb maps so the generator and the healer agree on intent phrasing.
- `src/llm.ts` — `llmConfigFromEnv()` → `{model} | null` (default `google/gemini-2.5-flash`;
  `SCHWIFLY_MODEL` swaps provider; uses Stagehand's own env→key resolution).
- `src/sharedCdp.ts` — `openSharedSession()`: Stagehand owns Chromium (`env:'LOCAL'`), Playwright
  attaches over CDP (`connectOverCDP`), so `observe()/act()` and `step()` drive the SAME DOM.
- `src/report.ts` — pure `buildVerdicts()` / `renderVerdicts()` / `exitCode()`: 4-state verdict
  table (pass / healed / fail / impossible) + trustworthy exit codes.
- `src/parseStory.ts` · `src/emit.ts` · `src/generate.ts` — generator: story → `{steps,
  assertions}` (key-free), render the spec byte-shape, discover locators live (key-gated).
- `src/secrets.ts` — `credentials()` (env contract) + `redact()` (scrub secret-keyed values).
- `src/auth.ts` — `storageState` path under `.schwifly/auth/<app>.json` + 24h staleness check.
- `src/cli.ts` — `schwifly run [path]` and `schwifly gen "<story>" --url <start> [--out]`.

Workflows & witnesses:
- `workflows/example.spec.ts` — a workflow IS a Playwright spec using `step()`.
- `workflows/the-internet.auth.setup.ts` + `the-internet.secure.spec.ts` — login-via-`step()` +
  logged-in-only assertion (runs in the `workflows`/`setup` projects, NOT in key-free `verify`).
- `tests/` — `heal` (5 hero witnesses), `report` (4 verdict states), `assertion` (expectText
  RED/GREEN + contains-fallback), `generate` (parseStory/emit, key-free), `secrets` (redact +
  credentials), `shared-cdp` + `live-tier2` (key-gated live witnesses — **skip** with no key).
- `fixtures/relevance-pricing.json` — the Relevance-AI pricing worked example (preserved when the
  Python prototype was deleted). `.env.example` documents the env contract.

`playwright.config.ts` defines three projects: `setup` (writes storageState), `workflows`
(`dependencies:['setup']`, `use.storageState`), and `tests` (its OWN project, NO storageState — so
`npm run verify` stays key-free). The legacy Python prototype has been deleted.

---

## Locked decisions / constraints — do not violate

- **Free / OSS / local-first.** No mandatory paid cloud (no Browserbase). Bring-your-own LLM key only.
- **Gemini-first behind a vendor-agnostic wrapper** (swap OpenAI/Anthropic/local via `SCHWIFLY_MODEL`).
- **v1 = local CLI, ONE platform, black-box.** Defer complexity — premature flexibility is the sin.
  No settings sprawl; opinionated defaults.
- **Workflow = a real `.spec.ts`**; a heal = a diff on one locator string (keep locators as plain
  string selectors, never chained `getByRole(...)` objects, or write-back + diff break).
- **Real verification over theater.** Write the failing case, watch it go RED, then GREEN. Never
  claim a green that never ran. Keep `npm run verify` green with NO key.
- **Don't commit/push unless Alex asks.** Branch from `complete-rebuild`.

Full prior + rationale: `~/repos/alex_intelligence/forge/sources/2026-06-22-rebuild-ai-web-test-platform.md`
· taste model: `~/repos/alex_intelligence/forge/wiki/concepts/taste-model.md`.

---

## ✅ Shipped (branch `complete-rebuild`, commit `f16b80d`)

Each landed RED→GREEN with witnesses; the whole suite is green key-free (19 passed / 2 key-gated
skips / 0 failed) and typechecks clean. One live `gemini-2.5-flash` proof was run for the two AI
substrates; everything else is key-free.

- **remove-python-legacy** — deleted the dead `browser-use` prototype (~9.5k lines); preserved
  `tests.json` → `fixtures/relevance-pricing.json`; `.gitignore` trimmed to Node/TS (with `.env`
  still ignored).
- **cli-and-verdicts** — `src/report.ts` 4-state verdict table joining `.schwifly/last-run.json` +
  heal/step logs; exit 1 only on fail/impossible; `NO_COLOR`-aware; `step()` gained a `stepLog`
  sink so **impossible** (`resolver returned null`) survives to the CLI. One dep: `picocolors`.
- **assertion-actions** — `expectText` action (exact `toHaveText`, then `toContainText` fallback),
  so `<validate>19</validate>` matches both `19` and `$19/month`. No DSL (YAGNI).
- **shared-cdp-fixture** — `src/sharedCdp.ts` `openSharedSession()` (Stagehand owns Chromium
  `env:'LOCAL'`, Playwright attaches over CDP). **Live-proven:** `observe()` resolved a button that
  existed only AFTER a Playwright-driven click → same session. One Stagehand per worker, closed in
  teardown. (Local launch needs `executablePath`=Playwright's chromium + `--no-sandbox`.)
- **live-tier2-llm** — `src/llm.ts` env→model seam + `EscalatingResolver`/`makeStagehandResolver` in
  `src/heal.ts`. **Live-proven** — the headline: heuristic returned `null` → Stagehand healed
  `#dark-mode-toggle-OLD` → `xpath=…/button[1]`, `HealRecord` written. Typed against the real
  `ModelConfiguration` (no `as any`).
- **generator-story-to-spec** — `parseStory` (ports the `<validate>` regex, key-free) + `emit`
  (renders the `example.spec.ts` byte-shape, plain-string locators) + `schwifly gen`. Offline path
  fully tested (emit output is real-`tsc`'d). *Note: a purely descriptive story yields 0 steps + N
  assertions — correct.* Live discovery (`src/generate.ts`) is implemented + key-gated, **not run**.
- **auth-login-at-scale** — `src/secrets.ts` (`credentials()` + `redact()`), `src/auth.ts`
  (storageState path + 24h staleness), `the-internet.auth.setup.ts` logs in **via `step()`**
  (self-healing login) against the free `the-internet.herokuapp.com`. 3-project config keeps
  `npm run verify` key-free. RED without state → GREEN after setup; reuse + regeneration proven;
  password → `***REDACTED***`; no `.env`/auth JSON tracked. One shared account by design (YAGNI).

---

## ▶ Live-validation checklist — typechecked but NOT yet run live

These three LLM paths compile and are gated correctly, but only the two one-shot substrate proofs
above have hit a real model. Before depending on them in a demo, run ONE key-gated pass:

```bash
GEMINI_API_KEY="$(grep '^GEMINI_API_KEY=' .env | cut -d= -f2-)" \
  npx playwright test tests/live-tier2.spec.ts tests/shared-cdp.spec.ts
```

1. **Generator live discovery** — `schwifly gen "<story>" --url <real-url>` then `schwifly run` the
   output: do the discovered locators run green with NO heal firing? (parser/emit are already green.)
2. **Provider-swap** — `SCHWIFLY_MODEL=openai/gpt-4.1-mini` + `OPENAI_API_KEY`: tier-2 heals via
   OpenAI with zero code change. Seam is wired; the non-Gemini path has never been exercised live.
3. **Routine tier-2 / shared-CDP** — both are proven once, but re-confirm after any Stagehand bump
   (the local launch is sensitive to `--no-sandbox` / `executablePath`).

---

# Remaining work — ground the loop further (no new LLM key needed for 1–4)

### parallel-and-independent-runs — make the heal write-back process-safe · deps: none
**Status:** ⏳ open, and it's a real latent bug. `fullyParallel:true` is on, but every worker still
appends to one `.schwifly/heals.ndjson` (`workflow.ts` `DEFAULT_HEAL_LOG`) and the CLI mutates spec
files — under concurrency that can drop/dup heals, breaking the "clean one-line diff" guarantee.
**Start here:** `src/workflow.ts` (`appendNdjson`/`DEFAULT_HEAL_LOG`) · `src/cli.ts` (serial
post-run write-back — the safe single-writer spot) · `tests/heal.spec.ts` (witness style).
**First steps:** per-worker heal logs via `process.env.TEST_PARALLEL_INDEX` →
`.schwifly/heals.<i>.ndjson` (YAGNI over file-locking) → CLI globs `heals.*.ndjson`, **dedup on
`(file,original,healed)`**, `applyHeal` serially in the main process only → make `applyHeal`
idempotent (already-applied = success) → document the worker/isolation model + `--shard` in README.
**Done when:** N workers heal the SAME locator → exactly ONE diff, zero dropped (`verify` stays
green) · two specs each forcing a heal across workers → `git diff workflows/` has each heal once.
**Watch out:** never mutate `.spec.ts` from worker processes (workers append only; main process is
sole file writer). Dedup on the full key. No lock dep, no custom worker pool. Keep resolvers stateless.

### secrets-redaction — finish wiring `redact()` at every persist/print boundary · deps: none
**Status:** ⏳ partial. `redact()` exists in `src/secrets.ts` and is used on the auth/login path, but
it is **not** yet applied where a heal/step record is persisted (`workflow.ts` appends raw records)
or where the CLI prints heal diffs/verdicts (`cli.ts`). A `fill` of a password could flow into a log
or the terminal unredacted.
**Start here:** `src/secrets.ts` (`redact`) · `src/workflow.ts` (the two `appendNdjson` calls) ·
`src/cli.ts` (verdict/heal-diff printing) · `src/report.ts` (`renderVerdicts`).
**First steps:** route every persist/print of a record or value through `redact()` → witness: a step
that fills a known password → grep the heal/step log + CLI output → `***REDACTED***`, never plaintext.
**Watch out:** keep it ONE seam, not scattered ad-hoc scrubs.

### storageState gitignore hardening — defense-in-depth · deps: none
**Status:** ⏳ trivial. The code only ever writes auth state under the already-ignored
`.schwifly/auth/`, but a stray top-level `storageState*` isn't explicitly ignored. Add a
`storageState*` line to `.gitignore` so an accidental write can't be committed.

### recorder-flow-to-spec — record a real flow → workflow · deps: none (key-free)
**Status:** ⏳ not started. `schwifly record <url>` → user does the flow once → saved as a `.spec.ts`
using `step()`. Intent labels heuristic (role+name) or AI-labeled when no human label.
**Start here:** `src/workflow.ts` (collapse codegen's verbs onto `click|fill|expectVisible`, do NOT
expand the union) · `workflows/example.spec.ts` (emit template) · `npx playwright codegen
--target playwright-test -o <file> <url>` — parse its output, NOT the private `recorderMode:'api'`.
**First steps:** pure `src/record.ts` (codegen text → `StepSpec[]`: `getByRole('button',{name:'X'})`
→ `role=button[name="X"i]`, etc. — **plain string selectors**) → heuristic intent labeler (role+name,
phrased so the healer's verb maps can re-derive it) → optional key-gated AI labeler → emitter +
`schwifly record` → `tests/record.spec.ts` (string-in → StepSpec-out, no browser).
**Done when:** transform test maps a known codegen string to expected `StepSpec[]` (RED→GREEN) ·
recorded file runs unmodified green · break a recorded locator → heuristic heals + write-back.
**Watch out:** codegen is interactive (not headless/CI) — test the pure transform. Don't expand the
Action union. Intent phrasing is load-bearing for no-LLM heal.

### ci-reexplore-on-change — keep workflows current in CI · deps: cli-and-verdicts ✅ (unblocked)
**Status:** ⏳ not started; exit/verdict semantics it needs are now owned by `cli-and-verdicts`.
**Goal:** CI runs schwifly on push/PR; the AI backup heals stale locators; high-confidence heals that
re-verify green get auto-committed (git-diffable spec updates); genuine regressions open a PR / fail
the build.
**First steps:** sequence `run → applyHeal → RE-RUN affected specs → second run's pass/fail IS the
verdict` (healed-and-green = commit candidate; still-failing/null-resolver = regression, exit
non-zero) → Actions YAML (cache `~/.cache/ms-playwright`) → auto-commit healed specs vs open-PR/fail.
**Watch out:** **do NOT** add a 4-mode `--heal-policy` flag (settings sprawl). One opinionated
behavior: write back heals that re-verify green; flag the rest.

---

# LATER — demo & insight layers (reuse the engine; scoped placeholders until a consumer exists)

### explorer-crawler — crawl an app → auto-generate stories + workflows (+ feasibility) · deps: shared-cdp ✅, live-tier2 ✅
**Goal:** bounded `schwifly explore <url>` autonomously walks an app (incl. behind auth), proposes a
few user stories, emits each as a `.spec.ts` via `step()` + heuristic backup. Same verb answers
"can I X?" → POSSIBLE (flow + difficulty) / IMPOSSIBLE (evidence).
**Start here:** `src/workflow.ts` (emit `step()` calls, don't invent a 2nd execution path) ·
`src/sharedCdp.ts` + `src/heal.ts` (same shared-CDP Stagehand) · `workflows/example.spec.ts`
(template) · Stagehand v3 `agent.execute(task,{maxSteps})` — bounded autonomous driver.
**First steps:** `schwifly explore <url> [--depth --budget --auth]` (small defaults; bounding is
locked) → bounded `agent.execute` constrained same-origin → harvest action history →
`StoryCandidate[]` (each interaction paired with a concrete `observe()` locator AND intent) → render
via the template → smoke: `explore` then `run workflows/`.
**Done when:** fake-explorer witness (no LLM) emits a valid `step(...)` spec + `expectVisible`
(RED→GREEN) · generated spec typechecks + runs through the EXISTING engine · live round-trip on one
real free-tier app · `--budget` actually caps + stays on-origin.
**Watch out:** ALWAYS pair locator + intent (never intent-only). Bounding is locked. Don't
over-build story dedup/scoring in v1.

### site-map-graph — navigate anywhere → anywhere · deps: explorer-crawler
**Goal:** a regenerable graph (states=nodes, the `StepSpec` that moves between them=edges) so any
consumer can ask "from here, how do I reach state X?" and get an executable step sequence (a route =
a candidate workflow; AI backup only if an edge breaks). **Start here:** reuse `StepSpec` for edges;
commit `sitemap.json` at **repo root** (NOT under gitignored `.schwifly/`); BFS over a plain
adjacency object (**no graph library**). Node identity = `nodeId(url,title)` pure function. Capture
seam in `step()` gated by `opts.navLog` (like `healLog`/`stepLog`); ingest in `cli.ts`.
**Done when:** unit tests for nodeId/upsert-idempotency/stable-save/BFS (RED→GREEN); re-ingest →
empty `git diff`. **Watch out:** node granularity is the whole game (SPA routes that don't change URL
= known hard case, accept coarse v1, flag it). Single app, one graph — no multi-app/DB.

### scores — regression now; findability + dark-pattern after the Map · deps: site-map-graph
**Goal:** computed, honest scores as a run by-product — **regression** (passing steps / total, +
delta vs last run; computable TODAY from `.schwifly/last-run.json` + `steps.ndjson`), **findability**
(steps-taken / shortest-known, needs the Map), **dark-pattern** (a COUNT of named deterministic
friction signals on the path — extra confirmations, a modal with no
`role=button[name=/close|cancel/i]`, forced interstitials — via the a11y tree, no LLM). **No 1-10
vanity scales.** **Start here:** the `StepResult` stream already persists to `.schwifly/steps.ndjson`
→ pure `src/scores.ts` (data-in/out, no Playwright/LLM imports) → surface in `cli.ts`. **Build only
the regression number now**; ship findability provisional (best-run fallback) until the Map lands.
**Watch out:** every score is a ratio of counted integers or a list of counted signals — if you can't
define the denominator from observed data, don't ship it. Dark-pattern stays deterministic/no-LLM.

### support-flow-sharing — pull a flow, verify it live, hand it to support · deps: site-map-graph, explorer-crawler
*(placeholder — one paragraph until the Map exists.)* **Goal:** support agent names a task → pull the
matching flow from the Map → run it live in a throwaway context to confirm it still works today →
return a verified ordered step list (+ screenshots, shareable link). **Standalone stub** before the
Map: pick the `workflows/` spec whose step intents best keyword-match the task. **Watch out:**
screenshots can leak secrets → route through `redact()` / `secrets-redaction`.

### ai-cursor-guidance — live on-page guidance overlay · deps: site-map-graph
*(placeholder — defer the dep + subcommand until the Map provides routes.)* **Goal:** guide a real
human to a target — an injected on-page spotlight/cursor highlighting the next element, driven by a
route of intents+locators. **Start here:** injected-DOM overlay via `page.addInitScript` over a
browser extension. **Watch out:** verify the navigation/route logic before any UI flash. Don't pull a
highlight lib into `package.json` before there's a live consumer.

---

## Deferred patterns — salvaged from the deleted Python prototype

The Python tree is gone (git history keeps the bytes); these are the patterns that were carried over
or are still worth porting:

- **`<validate>` parser (exact vs semantic):** PORTED into `src/parseStory.ts` (regex
  `<validate(?:\s+type="(exact|semantic)")?\s*>(.*?)</validate>`). `exact` feeds `expectText`; the
  `semantic` compare path still needs the LLM (route through the tier-2 seam if/when built).
- **Secrets redaction:** PORTED into `src/secrets.ts` (`redact` over `password/api_key/token/secret`).
  Remaining: finish wiring it at the heal/step-log + CLI boundaries (see **secrets-redaction** above).
- **Heal-write-back policy modes:** the old `always|never|ai_success|changes` enum was deliberately
  NOT resurrected. The opinionated default stands: write back heals that re-verify green. Don't add a
  `--heal-policy` flag.
- **storageState auth + sensitive_data:** PORTED via `auth-login-at-scale` (`src/auth.ts`,
  `src/secrets.ts`, the `setup`/`workflows` projects).
