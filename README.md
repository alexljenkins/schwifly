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
   `npm run verify` skips it and stays free.

### Verdicts & exit codes

`schwifly run` joins Playwright's JSON report with the heal/step logs and prints a per-workflow
verdict table over four states, then sets the exit code so CI can trust it:

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
# (the `--` separator is required so npm forwards --url to the CLI; a key is needed for discovery)
GEMINI_API_KEY=… npm run schwifly gen "Open pricing and check the Pro plan costs 19" -- --url https://example.com
```

`gen` parses the story offline (key-free), then discovers a stable locator per intent by driving a
live browser once (LLM, key-gated) and emits a `step()`-based spec. The story parser is offline-
testable; only the locator discovery needs a key (no key → it refuses with a clear message, no
network call).

## Login-gated apps (auth)

Most real apps hide everything behind a login. schwifly captures a session **once** and reuses it,
the Playwright-native way — no backend, no special access:

- A `setup` project runs `workflows/<app>.auth.setup.ts`, which logs in **via `step()`** (so the
  login self-heals like any other step) and writes `storageState` to `.schwifly/auth/<app>.json`.
- The `workflows` project `dependencies: ['setup']` and loads that state, so every workflow starts
  logged in. The session is reused across runs and re-captured when stale (>24h, by mtime).
- The `tests/` project is its OWN project with **no** storageState and **no** setup dependency, so
  `npm run verify` stays key-free and green with no creds.

Credentials come from the environment (see `.env.example`): copy to `.env` (gitignored) and run with
`node --env-file=.env`. **A `storageState` JSON is a credential** — it lives under `.schwifly/`
(gitignored) and is never committed. Secrets are scrubbed through `redact()` on the login path;
extending that seam across the heal/step logs + CLI output is the open `secrets-redaction` task
(see [`TODO.md`](./TODO.md)).

> **One shared account by design (YAGNI).** Per-worker multi-account (`testInfo.parallelIndex`) is a
> deliberate non-goal: the single shared session is also what lets the Stagehand AI backup stay
> logged in. If you ever need isolated accounts per worker, that's a future extension, not v1.

## Stack

TypeScript · [Playwright](https://playwright.dev) (Apache-2.0) · [Stagehand](https://stagehand.dev)
(MIT, local). The only cost is your own LLM key for tier-2 heals (Gemini Flash ≈ free); everything
else runs locally.

## Quick start

```bash
pnpm install
npx playwright install chromium

pnpm run verify          # prove the hero loop (real browser, no key needed) → 19 passed, 2 key-gated skips
pnpm run schwifly run    # run the workflows in workflows/, print verdicts, apply any AI heals
pnpm run typecheck
```

For the AI tier, drop a key in `.env` (`GEMINI_API_KEY=…`) and run with `node --env-file=.env`. The
two live witnesses (`tests/shared-cdp.spec.ts`, `tests/live-tier2.spec.ts`) skip without a key.

## Roadmap

**v1 — built & verified (this branch):** story → workflow → run → self-heal, local CLI. Shipped:
deterministic-first engine + two-tier heal (heuristic + **live-proven** LLM escalation), 4-state
verdict table with trustworthy exit codes, `schwifly gen` (story → spec), `expectText` assertions,
shared-CDP substrate (Stagehand owns Chromium, Playwright attaches), and `storageState` auth.

**Next (ground the loop):** make heal write-back process-safe under `fullyParallel`; finish wiring
`redact()` into the heal/step logs + CLI output; `schwifly record` (codegen → spec); a CI loop that
heals stale locators on push and auto-commits the diff.

**Later (reuse the same engine):** crawl/explore an app to auto-generate stories, the site Map
(anywhere→anywhere), regression / findability / dark-pattern Scores, support-flow sharing, and live
AI-cursor guidance. Full status in [`TODO.md`](./TODO.md).

## License

Licensed under the [PolyForm Small Business License 1.0.0](./LICENSE.md) — free to use for small
businesses (fewer than 100 people and under $1M/yr revenue); other use requires a separate license.

> Required Notice: Copyright Alex Jenkins 2026

---

Copyright Alex Jenkins 2026
