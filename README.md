# Schwifly

Turn user stories into self-maintaining web tests. **The deterministic workflow runs every
time; the AI is the backup that only kicks in when a step fails** — it heals the step, writes
the fix back into the workflow, and re-runs. If it genuinely can't, the test fails for real.

Black-box: works on any web app you can reach, no backend or special access required.

## How it works

```
Story (plain English)  ──►  Workflow (.spec.ts, deterministic)
                                   │
                            Runner (PRIMARY) ── Playwright, parallel, login via storageState
                                   │ step's locator fails?
                            Resolver (BACKUP) ── re-find the element by intent
                                   │
                  ┌────────────────┼─────────────────┐
              heals + re-runs   can't heal but     genuinely
              → writes the fix  task possible      impossible
                back to the     → flag             → REAL FAIL
                .spec.ts
```

A **Workflow** is a real Playwright spec. Each step is deterministic-first:

```ts
await step(page, { intent: 'click the Sign in button', locator: '#signin', action: 'click' },
           { resolver: heal, file: here });
```

It tries `#signin`. If that fails, the resolver finds the element by `intent`; on success the
healed locator is written back into this file — so "updating the workflow" is just a git diff
on one string.

### Two-tier AI backup (one `Resolver` seam)

1. **`PlaywrightHeuristicResolver`** — no LLM, no key. Re-finds by accessible name / role / text
   (the id changed, the element didn't). Recovers the common case the way Playwright's Healer does.
2. **`StagehandResolver`** (escalation tier) — LLM heal for the hard cases the heuristic can't
   touch. Agent-agnostic (Gemini / OpenAI / Anthropic via Stagehand, swap with `SCHWIFLY_MODEL`).
   Bring your own key. **Proven live** on `gemini-2.5-flash` (healed a no-accessible-name toggle the
   heuristic couldn't); it's wrapped in an `EscalatingResolver` so the LLM only fires when the
   heuristic returns `null` **and** a key exists — cost stays off the happy path. Key-gated, so
   `pnpm run verify` skips it and stays free.

### Verdicts & exit codes

`schwifly run` joins Playwright's JSON report with the heal/step logs and prints a per-workflow
verdict table over four states, then sets the exit code so CI can trust it. An empty run or any
Playwright process failure exits non-zero; stale report data can never turn it green.

| Verdict | Meaning | Exit |
|---|---|---|
| **pass** | ran deterministically, no heal needed | 0 |
| **healed** | a step broke, the AI fixed it + wrote the one-line diff back | 0 (healed = success) |
| **fail** | the step genuinely failed | 1 |
| **impossible** | the resolver gave up (`resolver returned null`) | 1 |

`NO_COLOR=1` / non-TTY strips ANSI. Assertions use `expectVisible` / `expectText` (exact, with a
contains fallback) so a story's `<validate>` maps to a real check.

### Generate a workflow from a story

```bash
# plain English (+ inline <validate>X</validate>) → a runnable, healable .spec.ts
# (the `--` separator is required so pnpm forwards --url to the CLI; a key is needed for discovery)
GEMINI_API_KEY=… pnpm run schwifly gen "Open pricing and check the Pro plan costs 19" -- --url https://example.com
```

`gen` parses the story offline (key-free), then discovers a stable locator per intent by driving a
live browser once (LLM, key-gated) and emits a `step()`-based spec. The story parser is offline-
testable; only the locator discovery needs a key (no key → it refuses with a clear message, no
network call). Output is a direct `workflows/<name>.spec.ts` child and is never overwritten.
Unsupported semantic assertions and fill steps without a deterministic value fail clearly instead
of producing a workflow that can pass for the wrong reason.

### Turn a ticket into a verified workflow

```bash
# an arbitrary ticket → bounded agent attempt → deterministic .spec.ts → agent-free replay → save
GEMINI_API_KEY=… pnpm run schwifly attempt "Add an element to the list. <expect>Delete</expect>" -- \
  --url https://the-internet.herokuapp.com/add_remove_elements/ --out workflows/add-element.spec.ts
```

`attempt` hands the raw request to a bounded, same-origin browser agent (same-origin is enforced by
aborting cross-origin navigations at the browser context, not by asking the agent nicely), then
keeps only its **observed** actions: successful steps carrying a real Playwright selector. Agent
narration, its final message and its self-reported success are debug context and never become an
assertion.

Success is decided against an **outcome contract** resolved from the ticket up front — the concrete
observable end state, stated as `<expect>…</expect>` (or `<validate>…</validate>`). Prefer stating
it: for a vague ticket, discovery proposes the observable form from the start page, which is a
guess, whereas an explicit `<expect>` is exactly what you meant. The contract becomes deterministic
page assertions, is written into the generated spec as a comment so a human can see what success
means, and is the only judge. The candidate is then replayed in a fresh session with the agent AND
the heal tier disabled (`SCHWIFLY_NO_HEAL=1`), and the workflow is saved **only** when every step of
that replay is `ok`. An agent that claims success while the contract does not hold exits non-zero
and saves nothing.

`--visible` runs the discovery attempt headed so you can watch it, and produces byte-identical
output. Failed candidates stay at a unique `candidates/candidate.<pid>.<id>.spec.ts` path
(gitignored) as debug evidence, so concurrent attempts cannot overwrite each other. Successful
generation and attempts refuse to overwrite an existing workflow.

### Record a workflow by doing it once

```bash
pnpm run schwifly record https://example.com -- --out workflows/example-recording.spec.ts
```

`record` opens Playwright codegen's browser. Perform the flow, then close the browser; Schwifly
turns the recorded `click`, `fill`, and visible/text assertions into the same `step()`-based,
healable `.spec.ts` template used by generation and attempts. Locators remain plain selector
strings, so a later heal is still a one-line write-back diff. Unsupported codegen actions fail
clearly instead of being dropped from the saved workflow.

Role/name, label, text, placeholder, title, and alt text produce intent labels offline. Opaque CSS
and test-id selectors keep a generic deterministic intent; when an LLM key is already configured,
one optional author-time labeling call improves only those generic intents. No key is required to
record. Playwright codegen already supplies the interactive start/stop UI, so v1 deliberately adds
no browser extension, hotkey service, or recorder settings.

## Login-gated apps (auth)

Most real apps hide everything behind a login. schwifly captures a session **once** and reuses it,
the Playwright-native way — no backend, no special access:

- A `setup` project runs `workflows/<app>.auth.setup.ts`, which logs in **via `step()`** (so the
  login self-heals like any other step) and writes `storageState` to `.schwifly/auth/<app>.json`.
- The `workflows` project `dependencies: ['setup']` and loads that state for Playwright-fixture
  workflows. The session is reused across runs and re-captured when stale (>24h, by mtime).
- The `tests/` project is its OWN project with **no** storageState and **no** setup dependency, so
  `pnpm run verify` stays key-free and green with no creds.

Generated and attempted workflows currently open their own Stagehand-owned browser context, so
they do not yet inherit the Playwright project's `storageState`. Authenticated generation remains a
deliberate follow-up rather than a silently supported path.

Credentials come from the environment (see `.env.example`): copy to `.env` (gitignored) and run with
`node --env-file=.env`. **A `storageState` JSON is a credential** — it lives under `.schwifly/`
(gitignored) and is never committed; stray `storageState*` files are ignored too. `redact()` scrubs
secret-keyed fields and configured secret values before heal/step records persist or verdicts print.

> **One shared account by design (YAGNI).** Per-worker multi-account (`testInfo.parallelIndex`) is a
> deliberate non-goal: the single shared session is also what lets the Stagehand AI backup stay
> logged in. If you ever need isolated accounts per worker, that's a future extension, not v1.

## Stack

TypeScript · [Playwright](https://playwright.dev) (Apache-2.0) · [Stagehand](https://stagehand.dev)
(MIT, local). The only cost is your own LLM key for tier-2 heals (Gemini Flash ≈ free); everything
else runs locally.

## Quick start

**pnpm is the package manager** (`packageManager` in `package.json`); `pnpm-lock.yaml` is the only
lockfile. Stagehand and Playwright are pinned exactly — the attempt flow depends on Stagehand's
agent evidence-callback shapes, which are experimental and version-sensitive.

```bash
pnpm install
pnpm exec playwright install chromium

pnpm run verify          # prove the hero loop (real browser, no key needed; live tests skip)
pnpm run schwifly run    # run the workflows in workflows/, print verdicts, apply any AI heals
pnpm run schwifly record https://example.com # do a flow once, save a healable workflow
pnpm run typecheck
```

Parallel workers append only to `.schwifly/heals.<parallelIndex>.ndjson` and
`.schwifly/steps.<parallelIndex>.ndjson`. After Playwright exits, the CLI gathers the logs,
then applies heal records serially only for workflows whose complete verdict is **healed**.
Heals from failed, impossible, orphaned, or globally interrupted runs are withheld.
Run a shard with `pnpm run schwifly run -- workflows/ --shard=1/2`; concurrent shards must use
separate checkouts/workspaces because each CLI run owns its report and log lifecycle.

For the AI tier, drop a key in `.env` (`GEMINI_API_KEY=…`) and run with `node --env-file=.env`. The
two live witnesses (`tests/shared-cdp.spec.ts`, `tests/live-tier2.spec.ts`) skip without a key.

## Roadmap

**v1 — built & verified:** story → workflow → run → self-heal, local CLI. Shipped:
deterministic-first engine + two-tier heal (heuristic + **live-proven** LLM escalation), 4-state
verdict table with trustworthy exit codes, `schwifly gen` (story → spec), `expectText` assertions,
shared-CDP substrate (Stagehand owns Chromium, Playwright attaches), `storageState` auth, and
`schwifly attempt` (arbitrary ticket → bounded agent discovery → contract-asserting spec →
agent-free replay gate → save on GREEN).

**Next (ground the loop):** a CI loop that heals stale locators on push and auto-commits the diff.

**Later (reuse the same engine):** crawl/explore an app to auto-generate stories, the site Map
(anywhere→anywhere), regression / findability / dark-pattern Scores, support-flow sharing, and live
AI-cursor guidance. Full status in [`TODO.md`](./TODO.md).

## License

Licensed under the [PolyForm Small Business License 1.0.0](./LICENSE.md) — free to use for small
businesses (fewer than 100 people and under $1M/yr revenue); other use requires a separate license.

> Required Notice: Copyright Alex Jenkins 2026

---

Copyright Alex Jenkins 2026
