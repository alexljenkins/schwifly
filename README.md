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
2. **`StagehandResolver`** — LLM escalation for the hard cases. Agent-agnostic (Gemini / OpenAI /
   Anthropic via Stagehand). Bring your own key. *Wired, not yet run live — verify before relying on it.*

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
(gitignored) and is never committed or logged; secrets are scrubbed through `redact()` at every
print/persist boundary.

> **One shared account by design (YAGNI).** Per-worker multi-account (`testInfo.parallelIndex`) is a
> deliberate non-goal: the single shared session is also what lets the Stagehand AI backup stay
> logged in. If you ever need isolated accounts per worker, that's a future extension, not v1.

## Stack

TypeScript · [Playwright](https://playwright.dev) (Apache-2.0) · [Stagehand](https://stagehand.dev)
(MIT, local). The only cost is your own LLM key for tier-2 heals (Gemini Flash ≈ free); everything
else runs locally.

## Quick start

```bash
npm install
npx playwright install chromium

npm run verify          # prove the hero loop (real browser, no key needed)
npm run schwifly run    # run the workflows in workflows/, then apply any AI heals
```

## Roadmap

v1 (here): stories → workflow → run → self-heal, local CLI. Later, reusing the same engine:
crawl/explore an app to auto-generate stories, the site Map (anywhere→anywhere), usability /
findability / dark-pattern Scores, support-flow sharing, and live AI-cursor guidance.

---

Copyright Alex Jenkins 2026
