# schwifly — roadmap & TODO

> Orientation for a fresh-context agent. Read **The idea** + **Current state** + **How to pick
> up a task**, then jump to the one epic you've been pointed at. Every epic is self-contained:
> goal, where to start (exact `file:line`), first steps, how to know it's done, and the traps.

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

Built + verified this session (branch `complete-rebuild`). Stack: **TypeScript · Playwright**
(Apache-2.0, runner+browser) **· Stagehand v3** (MIT, local, bring-your-own LLM key). Node 22, ESM.

The engine (read these first):
- `src/workflow.ts` — `step(page, {intent, locator, action, value}, opts)`: tries the deterministic
  `locator` first; on failure calls `opts.resolver`; on heal records a `HealRecord` and `applyHeal()`
  writes the healed locator back into the `.spec.ts`. Types: `StepSpec`, `Resolver`, `StepResult`,
  `HealRecord`. Actions today: `click | fill | expectVisible`.
- `src/heal.ts` — `PlaywrightHeuristicResolver` (no LLM: role/name/text/aria from the a11y tree;
  **verified**) and `StagehandResolver` (LLM escalation via `observe(intent,{page})→selector`;
  **typechecked, not yet run live** — needs a key + a shared-CDP browser session).
- `src/cli.ts` — `schwifly run [path]`: runs `playwright test`, then applies heals to spec files.
  (Verdict surfacing is thin — see `cli-and-verdicts`.)
- `workflows/example.spec.ts` — a workflow IS a Playwright spec using `step()`.
- `tests/heal.spec.ts` — the 5 verified witnesses (ok / fail-without-backup / heal+record /
  heuristic-heal / write-back).
- `playwright.config.ts`, `tsconfig.json` (moduleResolution `Bundler`), `package.json` scripts.

Run it:
```bash
npm install && npx playwright install chromium
npm run verify       # 5/5 green, real chromium, NO key needed
npm run schwifly run # run workflows/, then apply any AI heals
npm run typecheck
```

Legacy Python prototype (`schwifly/*.py`, `procedures/`, `examples/`, `pyproject.toml`) is still in
the tree — dead, imported by nothing. Salvage patterns then delete (see `remove-python-legacy` +
**Deferred patterns** at the bottom).

---

## Locked decisions / constraints — do not violate

- **Free / OSS / local-first.** No mandatory paid cloud (no Browserbase). Bring-your-own LLM key only.
- **Gemini-first behind a vendor-agnostic wrapper** (swap OpenAI/Anthropic/local via one env var).
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

## How to pick up a task

1. Read **Current state** above + skim the engine files.
2. Find your epic below; read its `Start here` `file:line` pointers in full.
3. Honor the **locked constraints** + **real-verification** (RED first, then GREEN).
4. Each epic's `Done when` is its acceptance test — make it pass for real.

---

## ⚠ The prerequisite that gates every AI feature: `shared-cdp-fixture`

Five epics (live tier-2 heal, generator, explorer, …) all need Stagehand and the Playwright
test-runner to **drive the SAME browser** — or `observe()/act()` see a different DOM than `step()`
drives (silent wrong-DOM heals). **Build this once, as its own tiny piece, and have every AI epic
depend on it.** It does not exist yet (`grep connectOverCDP|cdpUrl|connectURL src/` → only a comment
in `heal.ts:68`). Don't let each AI epic re-invent it differently.

**Recommended shape** (avoids open Stagehand bug [#1392](https://github.com/browserbase/stagehand/issues/1392),
"Failed to resolve V3 Page", which bites the external-page direction): let **Stagehand own Chromium,
Playwright attaches** — `new Stagehand({env:'LOCAL', model:'google/gemini-2.5-flash'})` → `await sh.init()`
→ `chromium.connectOverCDP(sh.connectURL())` → use `browser.contexts()[0].pages()[0]` as the test page.
Then `observe(intent,{page})` sees the same DOM. **Always pass `{page}`** to observe/act. One Stagehand
per worker (`beforeAll`), `sh.close()` in teardown, or Chromium leaks under `fullyParallel`.

---

## Build order (corrected)

1. **NOW** (independent, key-free, ground the v1 loop): `cli-and-verdicts`, `remove-python-legacy`,
   `auth-login-at-scale`, `parallel-and-independent-runs`, `assertion-actions`.
   *(do `auth` before `parallel` — both edit `playwright.config.ts` projects + `src/secrets.ts`.)*
2. `shared-cdp-fixture` — the single substrate the AI tier needs.
3. `live-tier2-llm` — first live AI heal (merges old `stagehand-live-tier2` + `agent-agnostic-llm-layer`).
4. `generator-story-to-spec` + the `<validate>`/assertion path.
5. `recorder-flow-to-spec` (key-free transform; can run parallel to 4).
6. `secrets-redaction`, `ci-reexplore-on-change` (after `cli-and-verdicts` owns exit/verdict semantics).
7. `explorer-crawler` (absorbs feasibility) → `site-map-graph` → `scores` / `support-flow` / `ai-cursor`.

---

# NOW — ground the v1 loop (no LLM key)

### cli-and-verdicts — verdict surfacing (pass / healed / fail / impossible) · deps: none
**Goal:** after `schwifly run`, print a per-workflow verdict table over 4 states + set exit code,
by joining Playwright's JSON report with the heal log.
**Why:** the hero rule only lands if the human SEES "broke → AI healed it, here's the one-line diff"
vs "genuinely failed" vs "AI gave up". Today `cli.ts` prints one line and exits `res.status`.
**Start here:** `src/cli.ts` (rewrite target) · `.schwifly/last-run.json` (PW json shape: `suites[].specs[]`
`{title,file,ok, tests[].results[].status}`, top-level `stats`,`errors`) · `src/workflow.ts:24-46`
(`StepStatus`, `HealRecord`; note **"resolver returned null"** at `:81` is the *impossible* signal and
is currently thrown away) · prior art `schwifly/cli.py:146-175` + `services/telemetry.py:9-80` · dep:
**picocolors** (zero-dep ANSI), hand-roll the table with `padEnd`.
**First steps:** define minimal TS interfaces for the report slice → pure `src/report.ts`
`buildVerdicts(report, heals): Verdict[]` (`ok && no heal → pass`; `ok && heal for that file → healed`;
`!ok → fail`; persist `StepResult` to surface `impossible`) → `renderVerdicts()` colored table + summary
bar → rewire `cli.ts` → exit 1 on any fail/impossible, 0 if all pass/healed (**healed = success**).
**Done when:** `tests/report.spec.ts` asserts all 4 states (RED first) · `npm run verify` stays green +
new spec · `NO_COLOR=1`/non-TTY strips ANSI · breaking a locator shows a HEALED row with the diff ·
`echo $?` is 1 only on fail/impossible.
**Watch out:** *impossible* can't come from `last-run.json` alone — persist `StepResult` (one append) or
honestly collapse to 3 states. Normalize heal `file` (absolute) vs PW relative paths or HEALED rows
fall through to PASS. One tiny dep max.

### auth-login-at-scale — login-gated apps via storageState + secret store · deps: none
**Goal:** capture a session once per app, reuse it across runs (parallel-safe), refresh when stale,
creds from env/`.env`, never commit a secret or a storageState file.
**Why:** most real apps hide everything behind login; without reusable auth the loop never reaches the
interesting screens. Playwright-native (a `setup` project writes storageState, workflows consume via
`use.storageState`) keeps it free/local and the artifact a plain `.spec.ts`.
**Start here:** `playwright.config.ts` (no `projects` block yet — add `setup` + `dependencies`) ·
`schwifly/secrets.py` (port `build_sensitive_data` + `redact_*`) · `schwifly/config.py` (env contract:
`APP_EMAIL/APP_PASSWORD/BASE_URL_DEFAULT/HEADLESS/ALLOWED_DOMAINS`) · `schwifly/runners/ai.py:119-127`
(`storage_state`) + `runners/procedural.py:76-79` (the explicit auth TODO) · `procedures/relevance_ai_login.py`
(login template — it's a DUMMY, shape only) · `.gitignore:214` already ignores `.schwifly/` → store
state under `.schwifly/auth/<app>.json` · [Playwright auth docs](https://playwright.dev/docs/auth) ·
Node 22 `--env-file` (preferred, no dep) or `dotenv`.
**First steps:** `src/secrets.ts` (`credentials()` + `redact()`) → `workflows/<app>.auth.setup.ts` that
logs in **via `step()`** (so login self-heals) and writes `storageState` → config `setup` project +
`workflows` project with `dependencies:['setup']`, `use.storageState`; keep `tests/` its own project with
**no** storageState (verify stays key-free) → staleness check (mtime/expiry → re-run setup) → `.env.example`.
**Done when:** logged-in-only assertion FAILS without state, PASSES after setup writes it · login runs once,
reused on 2nd run · backdated/expired state regenerates · `git status` shows no `.env`/`auth/*.json` tracked;
grep run output for the password → redacted · `npm run verify` still 5/5 with no creds.
**Watch out:** storageState JSON = a credential (gitignored, never logged). Default ONE shared account;
per-worker multi-account (`testInfo.parallelIndex`) is a YAGNI trap — document, don't build. Keep the
single-context model so the Stagehand backup keeps the logged-in session.

### parallel-and-independent-runs — make local parallelism correct + documented · deps: none
**Goal:** every workflow isolated + parallel (Playwright already does this); make the heal write-back
**process-safe** and document the worker/isolation/storageState model. Cloud scale is LATER.
**Why:** the real bug: every worker appends to one `.schwifly/heals.ndjson` (`workflow.ts:64-67`) and
the CLI mutates spec files (`:94-104`) — under concurrency that can drop/dup heals, breaking the
"clean one-line diff" guarantee.
**Start here:** `playwright.config.ts` (`fullyParallel:true`, ~4 workers) · `src/workflow.ts:64-67,94-104`
(`recordHeal`/`applyHeal`) · `src/cli.ts:19-31` (serial post-run write-back — the safe single-writer spot)
· `tests/heal.spec.ts` (witness style).
**First steps:** per-worker heal logs via `process.env.TEST_PARALLEL_INDEX` → `.schwifly/heals.<i>.ndjson`
(YAGNI over file-locking) → CLI globs `heals.*.ndjson`, **dedup on `(file,original,healed)`**, `applyHeal`
serially in the main process only → make `applyHeal` idempotent (already-applied = success) → document the
model + `--shard` + "cloud = later" in README.
**Done when:** concurrency witness — N workers heal the SAME locator → exactly ONE diff, zero dropped
(`npm run verify` → 6/6) · two specs each forcing a heal across workers → `git diff workflows/` has each
heal once · typecheck clean.
**Watch out:** never mutate `.spec.ts` from worker processes (workers append only; main process is sole
file writer). Dedup on the full key (two *different* locators in one file must both land). No lock dep, no
custom worker pool. Keep resolvers stateless.

### remove-python-legacy — delete the Python prototype (one clean commit) · deps: none
**Goal:** extract reusable patterns, then delete the whole Python tree in one git-reversible commit.
**Why:** two parallel impls; the Python (`browser-use`) is dead weight (imported by no TS, run by no PW
config) violating "subtract relentlessly". `poetry.lock` alone is ~570KB.
**Start here:** verified zero-coupling (TS references only `.schwifly/*.ndjson`) · DELETE: `schwifly/`,
`procedures/`, `examples/`, `main.py`, `inspect_agent.py`, `tests.json`, `pyproject.toml`, `poetry.lock`,
and the orphan `tests/verify_logging.py` · trim the Python section of `.gitignore` + the prototype note
already in `README.md`.
**First steps:** **extract first** — the only pattern worth porting now is storageState (covered by
`auth-login-at-scale`); record the other three (see **Deferred patterns** below) → `git rm -r schwifly
procedures examples` + `git rm` the loose files → update README/.gitignore → `npm run verify` (5/5) +
`typecheck` prove nothing broke → ONE commit `chore: remove Python prototype after extracting patterns`
(don't push).
**Done when:** `find . -name '*.py' -not -path '*/node_modules/*' -not -path '*/.git/*'` → zero · verify
5/5 · single commit, `git revert HEAD` would restore it · no stale `browser-use`/`poetry` in README.
**Watch out:** extract-then-delete (don't lose the know-how though git keeps bytes). `tests/verify_logging.py`
is the sneaky orphan — delete it too. `examples/` + the `.gitignore` Python block aren't in the literal
list but are clearly the prototype — flag that you went slightly beyond.

### assertion-actions — make the `<validate>` headline example expressible · deps: none
**Goal:** add the MINIMUM assertion action so a story's `<validate>X</validate>` maps to a real check.
Today `Action = click|fill|expectVisible`, which **cannot** assert "the price text equals 19".
**Why:** the platform's only worked example (`tests.json`, the Relevance AI pricing story) literally
can't be expressed end-to-end with the 3 current actions. Real gap, needed by `generator`.
**Start here:** `src/workflow.ts` `Action` union + `act()` switch · `schwifly/services/validation_parser.py:26`
(`<validate type="exact|semantic">` regex) + `validation_comparison.py:88-117` (compare semantics) ·
`tests.json` (fixture).
**First steps:** add one `expectText` action (text-equals / contains on a locator) — exact match, no key.
Wire into `act()`. Add a witness. **Defer** the `semantic` compare path (needs the LLM) to `live-tier2-llm`.
**Done when:** a step `{action:'expectText', value:'19'}` passes/fails against a real DOM (RED→GREEN);
verify stays green. **Watch out:** add the minimum — do NOT build a general assertion DSL (YAGNI).

---

# NEXT — the AI backup goes live (needs `shared-cdp-fixture` + a key)

### shared-cdp-fixture — one browser for Playwright + Stagehand · deps: none
See **⚠ The prerequisite** above — that's the whole epic. Deliverable: a reusable Playwright fixture
+ one **shared-DOM witness** (Stagehand `observe()` resolves an element only present after a
Playwright-driven click → proves same session). Every AI epic depends on this.

### live-tier2-llm — run StagehandResolver live + the env LLM seam · deps: shared-cdp-fixture
**Goal:** the actual "AI is the backup" promise: a step the heuristic CANNOT heal gets healed by the
LLM tier, proven by a real RED→GREEN. Plus the ~20-line env→model seam (Gemini-first, swappable).
*(merges the old `stagehand-live-tier2` + `agent-agnostic-llm-layer` — they were the same work.)*
**Start here:** `src/heal.ts:66-80` (`StagehandResolver` — already correct; just construct + lifecycle) ·
`src/workflow.ts:19-22,69-91` (resolver seam) · Stagehand v3 `v3.d.ts:139,172,174,178`
(`init/observe/connectURL/close`), `methods.d.ts:69` (`observe({page})`), `observeHandler.js:132`
(returns `xpath=…`, PW-native) · `index` exports `providerEnvVarMap` + `loadApiKeyFromEnv` (google →
`GEMINI_API_KEY|GOOGLE_GENERATIVE_AI_API_KEY|GOOGLE_API_KEY`) · model id `google/gemini-2.5-flash`.
**First steps:** `src/llm.ts` `llmConfigFromEnv()` → `{model}|null` (default `google/gemini-2.5-flash`,
null if no key) — **don't** hand-roll provider→envvar mapping, let Stagehand resolve it → `makeStagehandResolver(page)`
returns `undefined` when no key → `EscalatingResolver`: heuristic first, Stagehand only if heuristic
returns null AND a key exists (keep cost off the happy path) → RED→GREEN witness gated by
`test.skip(!process.env.GOOGLE_API_KEY)`.
**Done when:** with a key, a heuristic-unsolvable case heals via Stagehand (`usedLocator` starts `xpath=`,
HealRecord written) — **first live Stagehand run** · swap proof: `SCHWIFLY_MODEL=openai/...` heals via
OpenAI, no code change · no key → verify stays 5/5, resolver `undefined`, no network call · typecheck with
real `ModelConfiguration` (no `as any`).
**Watch out:** the shared-CDP session is the real risk, not the model string. `env:'LOCAL'` only (never
`BROWSERBASE` = paid). Init once per worker. xpath heals are brittle but acceptable for last-resort tier.

### generator-story-to-spec — user story → runnable `.spec.ts` · deps: shared-cdp-fixture, live-tier2-llm
**Goal:** `schwifly gen "<story>" --url <start>` turns plain English (+ inline `<validate>`) into a
healable workflow that calls `step()`, discovering a real locator per intent by driving a live browser once.
**Why:** the missing FRONT of the loop (today specs are hand-authored). Emit the `step()` shape so each
step keeps its `intent` (what the resolvers key off). Reuse the same Stagehand `observe()` seam → one LLM dep.
**Start here:** `src/workflow.ts` (emit target) · `workflows/example.spec.ts` (byte-shape template:
imports, `const here=fileURLToPath(import.meta.url)`, `file: here` on every step) · `src/heal.ts`
(`observe()` for author-time discovery; **rewrite xpath→role=/text=/[aria-label]** or specs are brittle) ·
`schwifly/services/validation_parser.py` (PORT the `<validate>` regex) · `tests.json` (fixture).
**First steps:** pure `src/parseStory.ts` (story → `{steps, assertions}`; reuse `heal.ts` `salientLabel/inferRole`
verb maps so generator + healer agree) → `src/generate.ts` (per intent: `observe` → stable selector; `act`
to advance) → `src/emit.ts` (render the template; append `<validate>` as `expectText` steps) →
`schwifly gen` in `cli.ts` (the one intended file write).
**Done when:** `parseStory` on the `tests.json` story returns the exact `<validate>` values (RED→GREEN) ·
`schwifly gen ... && schwifly run <file>` exits green with NO heal firing (discovered locators correct) ·
break a generated locator → heuristic heals + write-back updates the generated file · parser/emit tests need
no key. **Watch out:** keep parseStory key-free (offline-verifiable); gate live discovery behind a key.
Don't adopt Playwright Test Agents as a runtime dep (IDE/MCP-coupled, emits raw locators w/o intent).

### recorder-flow-to-spec — record a real flow → workflow · deps: none (key-free)
**Goal:** `schwifly record <url>` → user does the flow once → saved as a `.spec.ts` using `step()`.
Intent labels heuristic (role+name) or AI-labeled when no human label.
**Why:** the alt authoring on-ramp from the seed; "do it once" beats hand-writing TS. Playwright codegen
is free/local and already installed.
**Start here:** `src/workflow.ts` (collapse codegen's verbs onto `click|fill|expectVisible`, do NOT expand
the union) · `workflows/example.spec.ts` (emit template) · `npx playwright codegen --target playwright-test
-o <file> <url>` ([docs](https://playwright.dev/docs/codegen)) — the stable capture engine; parse its output,
NOT the private `recorderMode:'api'` · `schwifly/step_replay.py` (legacy mapping prior art).
**First steps:** pure `src/record.ts` (codegen text → `StepSpec[]`: `getByRole('button',{name:'X'})` →
`role=button[name="X"i]`, etc. — **plain string selectors** so write-back works) → heuristic intent labeler
(role+name → "click the X button", phrased so `salientLabel/inferRole` can re-derive it) → optional key-gated
AI labeler for unlabeled elements → emitter + `schwifly record` subcommand → `tests/record.spec.ts` (string-in
→ StepSpec-out, no browser).
**Done when:** transform test maps a known codegen string to expected `StepSpec[]` (RED→GREEN) · recorded
file runs unmodified green · break a recorded locator → heuristic heals + write-back. **Watch out:** codegen
is interactive (not headless/CI) — test the pure transform. Don't expand the Action union. Intent phrasing
is load-bearing for no-LLM heal.

### secrets-redaction — one redact() seam at every persist/print boundary · deps: none
**Goal:** a shared `redact()` applied wherever secrets can leak: `HealRecord.value` / future step logs
(a typed password), CLI heal-diff output, and (later) support-flow screenshots.
**Why:** cross-cutting; `auth` ports `redact()` for login but a `fill` of a password flows into a HealRecord
and the terminal — a real leak path no single epic owns.
**Start here:** `schwifly/secrets.py` (`redact_dict/redact_string` over password/api_key/token/secret) ·
`src/workflow.ts` (`recordHeal`) · `src/cli.ts` (verdict/heal printing).
**First steps:** `redact()` in `src/secrets.ts` (shared with `auth`) → apply at every persist/print boundary →
witness: a step that fills a known password → grep the heal log + CLI output → `***REDACTED***`, never plaintext.
**Watch out:** keep it one seam, not scattered ad-hoc scrubs.

### ci-reexplore-on-change — keep workflows current in CI · deps: cli-and-verdicts
**Goal:** CI runs schwifly on push/PR; the AI backup heals stale locators; high-confidence heals that
re-verify green get auto-committed (git-diffable spec updates), genuine regressions open a PR / fail the build.
**Why:** the heal write-back already produces diffable updates — wrap the run→heal→re-run→verdict loop in CI
so workflows track the live app with zero manual locator maintenance.
**Start here:** `src/cli.ts` (fix the ordering so exit code is trustworthy — owned by `cli-and-verdicts`) ·
GitHub Actions.
**First steps:** sequence `run → applyHeal → RE-RUN affected specs → second run's pass/fail IS the verdict`
(healed-and-green = commit candidate; still-failing/null-resolver = genuine regression, exit non-zero) →
Actions YAML (cache `~/.cache/ms-playwright`) → auto-commit healed specs vs open-PR/fail on regression.
**Watch out:** **do NOT** add a 4-mode `--heal-policy` flag (resurrects the dead `ProceduralConfig.update`
enum = settings sprawl). One opinionated behavior: write back heals that re-verify green; flag the rest.

---

# LATER — demo & insight layers (reuse the engine; keep as scoped placeholders until a consumer exists)

### explorer-crawler — crawl an app → auto-generate stories + workflows (+ feasibility) · deps: shared-cdp-fixture, live-tier2-llm
**Goal:** bounded `schwifly explore <url>` autonomously walks an app (incl. behind auth), proposes a few
user stories, emits each as a `.spec.ts` via `step()` + heuristic backup. Same verb answers "can I X?"
→ POSSIBLE (flow + difficulty) / IMPOSSIBLE (evidence). *(absorbs the old `request-to-feasibility` — it's a
thin verdict layer on the same agent run, not a separate epic.)*
**Why:** the walk-into-a-meeting demo — but it sits ON the hero loop (it's the Stagehand seam pointed at
discovery instead of healing), so it waits on the live-LLM substrate.
**Start here:** `src/workflow.ts` (emit `step()` calls, don't invent a 2nd execution path) · `src/heal.ts`
(same shared-CDP Stagehand) · `workflows/example.spec.ts` (template) · Stagehand v3 `agent.execute(task,{maxSteps})`
([docs](https://docs.stagehand.dev/v3/basics/agent)) — bounded autonomous driver, prefer over PW Planner
(IDE-coupled) · legacy `schwifly/runners/ai.py` + `agent_orchestration.py` (`_convert_history_to_steps`,
`allowed_domains` — patterns to reimplement in TS).
**First steps:** verify shared-CDP works → `schwifly explore <url> [--depth --budget --auth]` (small defaults;
bounding is locked) → bounded `agent.execute` constrained same-origin → harvest action history → `StoryCandidate[]`
(each interaction paired with a concrete `observe()` locator AND intent) → render via the template → smoke:
`explore` then `run workflows/`.
**Done when:** fake-explorer witness (no LLM) → `generate.ts` emits a valid `step(...)` spec + `expectVisible`
(RED→GREEN) · generated spec typechecks + runs through the EXISTING engine · live round-trip on one real
free-tier app, git diff of new specs is the artifact · `--budget 5` actually caps + stays on-origin.
**Watch out:** ALWAYS pair locator + intent (never intent-only). Bounding is locked, not optional. Don't
over-build story dedup/scoring in v1.

### site-map-graph — navigate anywhere → anywhere · deps: explorer-crawler
**Goal:** a regenerable graph (states=nodes, the `StepSpec` that moves between them=edges) so any consumer
can ask "from here, how do I reach state X?" and get an executable step sequence (a route = a candidate
workflow; AI backup only if an edge breaks). **Start here:** reuse `StepSpec` for edges (don't fork the step
shape); commit `sitemap.json` at **repo root** (NOT under gitignored `.schwifly/`); BFS over a plain
adjacency object (**no graph library** — it's tens of nodes). Node identity = `nodeId(url,title)` pure
function (normalize URL). Capture seam in `step()` gated by `opts.navLog` (like `healLog`); ingest in `cli.ts`.
**Done when:** unit tests for nodeId/upsert-idempotency/stable-save/BFS (RED→GREEN); re-ingest → empty `git diff`.
**Watch out:** node granularity is the whole game (SPA routes that don't change URL = known hard case, accept
coarse v1, flag it). Single app, one graph — no multi-app/DB.

### scores — regression now; findability + dark-pattern after the Map · deps: site-map-graph
**Goal:** computed, honest scores as a run by-product — **regression** (passing steps / total, + delta vs
last run; computable TODAY from `.schwifly/last-run.json`), **findability** (steps-taken / shortest-known,
needs the Map), **dark-pattern** (a COUNT of named deterministic friction signals on the path — extra
confirmations, a modal with no `role=button[name=/close|cancel/i]`, forced interstitials — via the a11y tree,
no LLM). **No 1-10 vanity scales** (kill the legacy `AgentOutput.usability_score`). **Start here:** persist
`StepResult` to `.schwifly/steps.ndjson` (the one `workflow.ts` change) → pure `src/scores.ts` (data-in/out,
no Playwright/LLM imports) → surface in `cli.ts`. **Build only the regression number now**; inject
`shortestKnownSteps`, ship findability provisional (best-run fallback) until the Map lands. **Watch out:**
every score is a ratio of counted integers or a list of counted signals — if you can't define the denominator
from observed data, don't ship it. Dark-pattern stays deterministic/no-LLM (an LLM judge is AI-first =
hero-rule violation).

### support-flow-sharing — pull a flow, verify it live, hand it to support · deps: site-map-graph, explorer-crawler
*(placeholder — one paragraph until the Map exists; resist building the 6-step plan now.)*
**Goal:** support agent names a task → pull the matching flow from the Map → run it live in a throwaway
context to confirm it still works today → return a verified ordered step list (+ screenshots, shareable link):
proof-of-currency, not a stale wiki page. **Standalone stub** before the Map: pick the `workflows/` spec whose
step intents best keyword-match the task. **Watch out:** screenshots can leak secrets → route through
`secrets-redaction`. Client-env integration is a non-black-box, much-later concern.

### ai-cursor-guidance — live on-page guidance overlay · deps: site-map-graph
*(placeholder — defer the dep + subcommand until the Map provides routes.)*
**Goal:** guide a real human to a target — an injected on-page spotlight/cursor highlighting the next element,
step-by-step or one-click "go there", driven by a route of intents+locators (from a workflow, eventually the
Map). **Start here:** injected-DOM overlay via `page.addInitScript` (Playwright owns the page) over a browser
extension (packaging/permissions = premature). **Watch out:** it's a UI surface — defer flash; verify the
navigation/route logic first. Don't pull a highlight lib (e.g. driver.js) into `package.json` before there's
a live consumer.

---

## Deferred patterns salvaged from the Python prototype

Capture before `remove-python-legacy` deletes the tree (git keeps the bytes, but keep the know-how here):

- **`<validate>` tag parser (exact vs semantic):** `schwifly/services/validation_parser.py:26-27` regex
  `<validate(?:\s+type="(exact|semantic)")?\s*>(.*?)</validate>`; compare semantics
  `validation_comparison.py:88-117`. → feeds `assertion-actions` (exact) + `generator` + `live-tier2-llm` (semantic).
- **Secrets redaction:** `schwifly/secrets.py` `redact_dict/redact_string` over `{password,api_key,token,secret}`.
  → `secrets-redaction` epic.
- **Heal-write-back policy modes:** `schwifly/models.py:85` `ProceduralConfig.update: always|never|ai_success|changes`
  — declared, read at `cli.py:26`, **never wired** (no branching logic). The concept = "when to write a heal back".
  Current TS answer (one opinionated default): write back heals that re-verify green. Do NOT resurrect the enum.
- **storageState auth + sensitive_data:** `runners/ai.py:119-127`, `secrets.py build_sensitive_data`. → covered by
  `auth-login-at-scale`.
