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

The **v1 hero loop is built and verified** on `main`. Stack:
**TypeScript · Playwright** (Apache-2.0, runner+browser) **· Stagehand v3** (MIT, local,
bring-your-own LLM key). Node 22, ESM, `moduleResolution: Bundler`.

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm run verify       # real Chromium, no key needed; live tests skip without one
pnpm run schwifly run # run workflows/, print verdicts, apply only successful heals
pnpm run schwifly gen "<story>" -- --url <start> # story → .spec.ts; discovery is key-gated
pnpm run typecheck
```

The engine (read these first):
- `src/workflow.ts` — `step(page, {intent, locator, action, value}, opts)`: deterministic `locator`
  first; on failure calls `opts.resolver`; records a `HealRecord`, and `applyHeal()` writes the
  healed locator back into the `.spec.ts`. Persists every `StepResult` to `opts.stepLog`
  (`.schwifly/steps.<parallelIndex>.ndjson`) so the **impossible** signal survives to the CLI. Actions:
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
- `src/cli.ts` — `run`, `gen`, and `attempt`; trustworthy process exits, safe direct-child output,
  and no overwrite.

Workflows & witnesses:
- `workflows/example.spec.ts` — a workflow IS a Playwright spec using `step()`.
- `workflows/the-internet.auth.setup.ts` + `the-internet.secure.spec.ts` — login-via-`step()` +
  logged-in-only assertion (runs in the `workflows`/`setup` projects, NOT in key-free `verify`).
- `tests/` — `heal` (5 hero witnesses), `report` (4 verdict states), `assertion` (expectText
  RED/GREEN + contains-fallback), `generate` (parseStory/emit, key-free), `secrets` (redact +
  credentials), `shared-cdp` + `live-tier2` (key-gated live witnesses — **skip** with no key).
- `fixtures/relevance-pricing.json` — the Relevance-AI pricing worked example (preserved when the
  Python prototype was deleted). `.env.example` documents the env contract.

`playwright.config.ts` defines four projects: `setup` (writes storageState), `workflows`
(`dependencies:['setup']`, `use.storageState`), and `tests` (its OWN project, NO storageState — so
`pnpm run verify` stays key-free), plus `candidate` for agent-free attempt certification. The
legacy Python prototype has been deleted.

---

## Locked decisions / constraints — do not violate

- **Free / OSS / local-first.** No mandatory paid cloud (no Browserbase). Bring-your-own LLM key only.
- **Gemini-first behind a vendor-agnostic wrapper** (swap OpenAI/Anthropic/local via `SCHWIFLY_MODEL`).
- **v1 = local CLI, ONE platform, black-box.** Defer complexity — premature flexibility is the sin.
  No settings sprawl; opinionated defaults.
- **Workflow = a real `.spec.ts`**; a heal = a diff on one locator string (keep locators as plain
  string selectors, never chained `getByRole(...)` objects, or write-back + diff break).
- **Real verification over theater.** Write the failing case, watch it go RED, then GREEN. Never
  claim a green that never ran. Keep `pnpm run verify` green with NO key.

Full prior + rationale: `~/repos/alex_intelligence/forge/sources/2026-06-22-rebuild-ai-web-test-platform.md`
· taste model: `~/repos/alex_intelligence/forge/wiki/concepts/taste-model.md`.

---

## ✅ Shipped

Core v1 is on `main` with key-free witnesses and two key-gated live tests. One live
`gemini-2.5-flash` proof was run for the two AI substrates; everything else is key-free.

- **remove-python-legacy** — deleted the dead `browser-use` prototype (~9.5k lines); preserved
  `tests.json` → `fixtures/relevance-pricing.json`; `.gitignore` trimmed to Node/TS (with `.env`
  still ignored).
- **cli-and-verdicts** — `src/report.ts` 4-state verdict table joining `.schwifly/last-run.json` +
  heal/step logs; empty runs, runner failures, fail, and impossible exit 1; `NO_COLOR`-aware;
  `step()` persists failures so **impossible** (`resolver returned null`) survives to the CLI.
  Write-back is limited to successful healed workflows. One dep: `picocolors`.
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
  `pnpm run verify` key-free. RED without state → GREEN after setup; reuse + regeneration proven;
  password → `***REDACTED***`; no `.env`/auth JSON tracked. One shared account by design (YAGNI).
- **parallel-and-independent-runs** — workers append redacted records to isolated
  `.schwifly/{heals,steps}.<parallelIndex>.ndjson` logs. The CLI gathers them and applies eligible
  heals serially as the sole workflow-source writer. Duplicate records remain intentional because
  two steps may share a locator; `applyHeal()` is idempotent.
- **foundation-hardening** — process-level CLI failures cannot reuse stale evidence or exit 0;
  attempts use isolated candidate files; outputs never overwrite; generated source escapes input
  and rejects unsupported contracts; resolver failures and secret fields are redacted; dead env
  options and the unselected `workflows/vercel-prices.ts` artifact were removed.
- **secrets-redaction** — the NDJSON persistence seam and verdict-rendering boundary both call
  `redact()`. Configured password/token/API-key values are scrubbed even without a key label;
  witnesses cover heal logs, step logs, and terminal locator diffs.
- **storageState gitignore hardening** — `.gitignore` explicitly ignores `storageState*` as
  defense-in-depth beyond the existing `.schwifly/` ignore.

---

## ▶ Live-validation checklist — typechecked but NOT yet run live

These three LLM paths compile and are gated correctly, but only the two one-shot substrate proofs
above have hit a real model. Before depending on them in a demo, run ONE key-gated pass:

```bash
node --env-file=.env node_modules/.bin/playwright test \
  tests/live-tier2.spec.ts tests/shared-cdp.spec.ts
```

1. **Generator live discovery** — `schwifly gen "<story>" --url <real-url>` then `schwifly run` the
   output: do the discovered locators run green with NO heal firing? (parser/emit are already green.)
2. **Provider-swap** — `SCHWIFLY_MODEL=openai/gpt-4.1-mini` + `OPENAI_API_KEY`: tier-2 heals via
   OpenAI with zero code change. Seam is wired; the non-Gemini path has never been exercised live.
3. **Routine tier-2 / shared-CDP** — both are proven once, but re-confirm after any Stagehand bump
   (the local launch is sensitive to `--no-sandbox` / `executablePath`).

---

# Remaining work — ground the loop further (no new LLM key needed for 1–4)

### emit-tier2-wiring — generated specs can never reach the LLM heal tier · deps: none
**Status:** ✅ done. `src/emit.ts` now renders the always-launch shape (mirrors
`tests/live-tier2.spec.ts`): a `test.describe` opens `openSharedSession()` in `beforeAll`, closes
in `afterAll`, and each generated test builds `new EscalatingResolver(session.stagehand)` and drives
`session.page` — so every generated `schwifly run` reaches the LLM heal tier when a key is set.
Tradeoff accepted per decision: every run launches a second Stagehand-owned Chromium via CDP, heal
needed or not (no lazy-launch machinery built). Byte-shape tests in `tests/generate.spec.ts` cover
the imports/wiring. Key-free `pnpm run verify` remains the baseline gate.
**Known limitation (codex review, deferred):** the shared session runs in a Stagehand-owned browser
context, so the `workflows` project's `use.storageState` is NOT loaded — a *generated* workflow
behind auth would run logged-out. No such consumer exists yet, and injecting storageState into
`openSharedSession()` is new machinery the always-launch decision deliberately avoided. Fix when the
first generated-behind-auth workflow lands (relates to [[auth-login-at-scale]]): thread the
`storageState` path into `openSharedSession()` and apply cookies/localStorage before `goto`.
_Original context below._
**Status (original):** ⏳ open, discovered live: `schwifly gen` on a real story (vercel.com pricing) produced a
runnable spec that then failed every step with `IMPOSSIBLE` / `resolver returned null` on
`schwifly run`, even with `GEMINI_API_KEY` set. Root cause: `src/emit.ts` hardcodes
`new PlaywrightHeuristicResolver()` into every generated `.spec.ts` — it never emits
`EscalatingResolver`, so the LLM tier (`src/heal.ts`, proven live in `live-tier2-llm`) is
unreachable from any generated workflow no matter what key exists. The no-LLM heuristic alone
can't resolve descriptive, non-exact-label intents (`salientLabel()` only strips verbs + a small
noun list — words like "page"/"plan"/"price" survive into the candidate string and never match a
real accessible name), so any story-derived intent that isn't already an exact label is stuck.
Two smaller bugs found + fixed alongside this: (1) `src/generate.ts` `discover()` didn't wait for
navigation after a click, so back-to-back `observe()` calls could match the pre-navigation DOM —
fixed with a `waitForLoadState('networkidle')` after click. (2) no visibility into resolver
decisions during a heal — fixed with `SCHWIFLY_DEBUG=1` tracing in `src/heal.ts` (logs every
heuristic candidate tried + Stagehand's raw `observe()` result).
**Start here:** `src/emit.ts` (template hardcodes tier-1 only) · `src/heal.ts`
(`EscalatingResolver`) · `src/sharedCdp.ts` (`openSharedSession`) · `tests/live-tier2.spec.ts` (the
pattern a wired-in generated spec would need: `beforeAll` opens the shared session, uses
`session.page` instead of Playwright's own `page` fixture).
**Open question, needs a decision before implementing:** `openSharedSession()` launches a second,
Stagehand-owned Chromium via CDP *unconditionally* — the key check only happens inside
`resolve()`. Wiring `EscalatingResolver` into every generated spec the same way the live witnesses
do it means every `schwifly run` over a generated workflow pays that second-browser-launch cost,
even on a clean deterministic pass with no heal needed — a real deviation from the "AI only kicks
in on failure" cost model. Alternative is a lazy-launch-on-first-failure resolver, which needs new
machinery not present anywhere else in the codebase yet.
**Done when:** a generated spec with a descriptive (non-exact-label) intent, run with a key, heals
via the LLM tier instead of going `IMPOSSIBLE` · key-free `pnpm run verify` stays unaffected.

### task-to-verified-flow — arbitrary request → agent attempt → minimal deterministic workflow · deps: shared-cdp ✅, live-tier2 ✅
**Status:** ✅ done (v1). `schwifly attempt "<ticket>" --url <start> [--out] [--visible]` ships the
loop: outcome contract → bounded same-origin agent attempt → observed actions → deterministic
`.spec.ts` → agent-free replay → save on GREEN. What landed:
- `src/capture.ts` (pure, key-free): `CapturedAction[] → EmitStep[]`. Drops failed probes,
  selector-less/unsupported methods, and superseded fills; collapses repeated identical actions;
  intent is DERIVED from the observed element (`click the Add Element`), never from narration, so
  terse and verbose phrasings of the same ticket emit byte-identical flows. Values go through
  `redact()`. Also parses the outcome contract out of the ticket (`<expect>` / `<validate>`).
- `src/attempt.ts`: `attemptFlow()` (contract → discover → normalize → emit → replay → save, with
  injectable seams so the whole contract is testable key-free) plus `liveDiscover()`, which runs
  `stagehand.agent({ mode: 'dom' }).execute({ instruction, maxSteps, page, callbacks })` and
  captures Stagehand's experimental `onEvidence` stream — pairing each successful `step_finished`
  (the only place a real Playwright selector exists) with the following `step_observed` URL.
  Selectors are rewritten through the generator's `stableSelector()`.
- `src/emit.ts`: renders the outcome contract as a header comment (a human reads the file and sees
  what success means), and makes the heal tier disableable for one run via `SCHWIFLY_NO_HEAL=1`.
- `playwright.config.ts`: a `candidate` project matching `candidates/**` (gitignored) so the
  certification replay has somewhere to run that `schwifly run workflows/` never picks up.

**Locked decisions from this build:**
- **The outcome contract is resolved UP FRONT from the ticket, and the page assertion is the only
  judge.** No second AI reviewer grades the attempt. `<expect>X</expect>` is the explicit form; a
  vague ticket gets a proposal from the start page, which is a guess — state the expectation.
- **The agent's testimony is never evidence.** `message`, `done.reasoning` and self-reported
  `success` are debug context only. A lying agent (claims success, contract does not hold) exits
  non-zero and saves nothing (`tests/attempt.spec.ts`).
- **The replay gate reads the STEP LOG, not the process exit code.** Found live: `step()` records a
  failure and continues by design, so a spec whose every step failed still exits 0 — gating on the
  exit code alone certified an empty workflow. `replayGreen()` requires ≥1 step and every step `ok`
  (a `healed` step also fails the gate, since healing is disabled for certification).
- **Stagehand specifics (3.7.1, pinned).** Evidence callbacks need `experimental: true` +
  `disableAPI: true` on the constructor (`openSharedSession({ evidence: true })`). Tool results are
  wrapped in an AI SDK envelope: the native `playwrightArguments` live at `result.output`, not
  `result`. `mode: 'dom'` must be passed explicitly — under `experimental` the agent otherwise
  picks coordinate-based tools, which return click points and nothing replayable.
- **Same-origin is enforced at the browser context**: cross-origin *navigations* are aborted via a
  context route; cross-origin subresources (fonts/CDN) are allowed, since blocking those breaks
  rendering without bounding anything.
- **Package manager resolved:** `package-lock.json` deleted, `packageManager: pnpm@11.5.3` declared,
  `@browserbasehq/stagehand` pinned to `3.7.1` and `@playwright/test` to `1.61.1` — the versions the
  evidence-stream shapes above were observed against.

**Verified:** `pnpm run verify` green key-free · typecheck clean ·
generated spec typechecks (`tests/attempt.spec.ts`) · live round trip GREEN against
`the-internet.herokuapp.com/add_remove_elements/` (captured `role=button[name="Add Element"i]` +
asserted `Delete`) · `--visible` produces byte-identical output.

**Still open:** the "minimal required path" delta-debugging uplift below (out of scope here), and
authenticated attempts still need the deferred `storageState` bridge into `openSharedSession()`.

_Original design below._

**Status (original):** ⏳ not started. This is the primary workflow-discovery path. Company tickets vary in
vocabulary, structure, and detail, so do NOT require Jira/user input to resemble procedural test
steps. `schwifly attempt "<ticket text>" --url <start>` gives the raw request to a bounded browser
agent; the agent interprets and attempts the task directly; Schwifly turns the useful observed
actions and outcome evidence into a deterministic `.spec.ts`; then a fresh session replays it
without the agent. Save the workflow only when that replay passes.

**Core loop:**
`arbitrary ticket/user request → bounded agent attempt → successful concrete actions + outcome
evidence → normalize to StepSpec[] → emit .spec.ts → fresh deterministic replay → save on GREEN`.
The agent execution is workflow **discovery**, never the persisted workflow. Future executions use
plain Playwright first; the existing resolver remains backup only when a saved locator breaks.

**Capture contract:** retain concrete browser facts, not agent reasoning: for each useful action,
record `{intent, locator, action, value}`, pre/post URL or observable page state, and any assertion
evidence proving the requested outcome. Exclude failed probes, retries superseded by a successful
action, narration, and unsupported conclusions. Every retained interaction MUST pair intent with a
real locator. Values flow through `redact()` before logs or generated source; credentials must use
the existing env contract rather than being embedded.

**Initial scope (~300–450 LOC):**
- `src/attempt.ts` (~140–200): bounded, same-origin `agent.execute(task,{maxSteps})`; adapt its
  action history into a provider-neutral captured-action shape; return explicit evidence/failure.
- `src/capture.ts` (~80–120): pure captured-action → existing `StepSpec[]` normalization. Collapse
  verbs onto `click|fill|expectVisible|expectText`; do NOT expand `Action`. Drop failed/superseded
  probes; keep plain-string selectors; redact values.
- `src/emit.ts` (~20–40): accept normalized steps plus final evidence assertions; reuse the current
  template and shared-CDP/heal wiring—do not invent another execution path.
- `src/cli.ts` (~30–50): `schwifly attempt "<request>" --url <start> [--out] [--visible]`; small
  fixed defaults for same-origin and max steps. `--visible` opens the agent-discovery browser headed
  so a person can watch it click through and find the solution—an explicit demo/debug switch, not a
  different execution mode. Reuse the existing `SCHWIFLY_HEADED=1` launch seam internally.
- `tests/attempt.spec.ts` + `tests/capture.spec.ts` (~100–160): fake-agent history only, so baseline
  stays key-free; prove failed exploration is omitted, successful actions normalize, evidence emits,
  secrets redact, and only a GREEN clean replay is eligible to save.

**Replay gate:** run emitted candidate from a new browser context/session with the autonomous agent
disabled. The normal heuristic/LLM broken-locator backup may be disabled for this proof so discovery
cannot certify itself by healing an inaccurate capture. Replay result is authoritative: GREEN saves;
failure keeps the capture as redacted debug evidence but does not create/overwrite a workflow.
Optionally allow ONE recapture/repair attempt later; no unbounded self-correction loop.

**Done when:** differently worded terse and detailed task fixtures both reach the same normalized
flow through a fake agent · exploratory failed/superseded actions do not appear in emitted source ·
final outcome has an observable assertion, not agent testimony · generated spec typechecks · clean
replay passes with agent disabled before file save · impossible/unsupported task exits non-zero and
leaves no workflow · one live round-trip succeeds against a free public app.

**Demo visibility:** default remains headless for automation. With `--visible`, show the exact same
bounded discovery attempt in the Stagehand-owned Chromium; stream concise current intent/action
labels to the terminal so viewers can follow progress. Do not add an artificial demo-only solution,
DOM overlay, or separate capture path. The clean replay gate still runs and must pass; it may remain
headless because the useful demo is watching the agent discover the flow. **Done when:** the live
round-trip can be watched end-to-end and produces byte-identical captured output with/without the
flag.

**Watch out:** Stagehand action-history fidelity/API stability is the first spike—verify it exposes
selectors and outcomes before building the adapter. If it does not, instrument the shared page
around agent actions; never save intent-only history. Authenticated attempts also need the deferred
`storageState` bridge into `openSharedSession()`. Same-origin and step bounds are locked.

**Later uplift — minimal required path (~100–180 LOC):** successful-only is not necessarily minimal.
An agent may visit page A before page B even when direct navigation/action makes A unnecessary.
After the initial replay is trustworthy, add replay-based delta debugging: try removing contiguous
step chunks (then individual steps), always from the original start state, and retain a deletion only
when the final outcome assertion still passes. This empirically proves necessity without asking the
LLM to judge causality. Preserve order; never synthesize shortcuts or direct URLs not performed by
the agent; cap replay attempts. **Revisit trigger:** captured live flows routinely contain redundant
successful steps, measured in at least 3 examples. **Done when:** fixture `[required, redundant,
required]` shrinks to two steps while outcome remains GREEN; state-setting/navigation prerequisites
survive; identical input produces stable minimized output.

### recorder-flow-to-spec — record a real flow → workflow · deps: capture normalizer from task-to-verified-flow
**Status:** ⏳ not started. `schwifly record <url>` → user does the flow once → saved as a `.spec.ts`
using `step()`. Intent labels heuristic (role+name) or AI-labeled when no human label.
**Start here:** `src/workflow.ts` (collapse codegen's verbs onto `click|fill|expectVisible`, do NOT
expand the union) · `workflows/example.spec.ts` (emit template) · `pnpm exec playwright codegen
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

### explorer-crawler — crawl an app → auto-generate stories + workflows (+ feasibility) · deps: task-to-verified-flow
**Goal:** bounded `schwifly explore <url>` autonomously walks an app (incl. behind auth), proposes a
few user stories, then feeds each candidate through `task-to-verified-flow` rather than maintaining
a second agent-capture/emission path. Same verb answers "can I X?" → POSSIBLE (verified flow +
difficulty) / IMPOSSIBLE (evidence).
**Start here:** `src/workflow.ts` (emit `step()` calls, don't invent a 2nd execution path) ·
`src/sharedCdp.ts` + `src/heal.ts` (same shared-CDP Stagehand) · `workflows/example.spec.ts`
(template) · Stagehand v3 `agent.execute(task,{maxSteps})` — bounded autonomous driver.
**First steps:** `schwifly explore <url> [--depth --budget --auth]` (small defaults; bounding is
locked) → propose bounded `StoryCandidate[]` → send each candidate into the existing attempt,
capture, emit, and clean-replay gate → smoke: `explore` then `run workflows/`.
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
delta vs last run; computable TODAY from `.schwifly/last-run.json` + worker step logs), **findability**
(steps-taken / shortest-known, needs the Map), **dark-pattern** (a COUNT of named deterministic
friction signals on the path — extra confirmations, a modal with no
`role=button[name=/close|cancel/i]`, forced interstitials — via the a11y tree, no LLM). **No 1-10
vanity scales.** **Start here:** the `StepResult` stream already persists to per-worker step logs
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
  Wired at heal/step persistence and verdict-rendering boundaries; configured secret values are
  scrubbed even without an adjacent key label.
- **Heal-write-back policy modes:** the old `always|never|ai_success|changes` enum was deliberately
  NOT resurrected. The opinionated default stands: write back heals that re-verify green. Don't add a
  `--heal-policy` flag.
- **storageState auth + sensitive_data:** PORTED via `auth-login-at-scale` (`src/auth.ts`,
  `src/secrets.ts`, the `setup`/`workflows` projects).
