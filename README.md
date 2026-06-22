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

## Stack

TypeScript · [Playwright](https://playwright.dev) (Apache-2.0) · [Stagehand](https://stagehand.dev)
(MIT, local). The only cost is your own LLM key for tier-2 heals (Gemini Flash ≈ free); everything
else runs locally.

## Quick start

```bash
npm install
npx playwright install chromium

npm run verify          # prove the hero loop (5 tests, real browser, no key needed)
npm run schwifly run    # run the workflows in workflows/, then apply any AI heals
```

## Roadmap

v1 (here): stories → workflow → run → self-heal, local CLI. Later, reusing the same engine:
crawl/explore an app to auto-generate stories, the site Map (anywhere→anywhere), usability /
findability / dark-pattern Scores, support-flow sharing, and live AI-cursor guidance.

---

> The previous Python (`browser-use`) prototype is still in the tree (`schwifly/`, `procedures/`,
> `pyproject.toml`) and will be removed once this rebuild is confirmed.

Copyright Alex Jenkins 2026
