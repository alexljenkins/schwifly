# Schwifly

Schwifly turns a user story into a Playwright test that runs deterministically and fixes itself
when the page changes under it.

Most self-healing test tools put the AI on the happy path: an agent drives the browser every run,
so every run is non-deterministic and costs a token. Schwifly inverts that. A **workflow** is a
real `.spec.ts` file with plain-string locators (`#signin`, `role=button[name="Add"]`) that
Playwright runs directly, at Playwright speed, with no model in the loop. The AI only wakes up
when a locator stops matching. It re-finds the element, the run keeps going, and the fix gets
written back into the spec as a one-line diff. If it can't find a replacement, the test fails for
real instead of quietly passing on a guess.

It's black-box: point it at any URL you can reach in a browser. No backend access, no
instrumentation, no SDK to install in the app under test.

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

Every step in a workflow looks like this:

```ts
await step(page, { intent: 'click the Sign in button', locator: '#signin', action: 'click' },
           { resolver: heal, file: here });
```

`step()` tries `locator` first. On failure it calls `resolver.resolve(page, spec)`, which searches
the live DOM for something matching `intent` instead. If that succeeds, the healed selector
replaces the original string in this exact file. "Updating the workflow" becomes a git diff on one
line, not a rewrite.

### Two-tier heal, one seam

<details>
<summary><strong>How the resolver actually finds a replacement element</strong></summary>

Both tiers implement the same `Resolver` interface, so `step()` never knows which one answered.

**Tier 1, `PlaywrightHeuristicResolver`.** No LLM, no key, no network call. It strips the intent
down to a salient label (`"click the Sign in button"` → `"Sign in"`) and probes the DOM with a
fixed ladder of accessible-name selectors: inferred ARIA role first, then generic button/link,
`aria-label`, `placeholder`, visible text, returning the first one that matches and is visible.
This is the same trick Playwright's own Healer uses to recover the majority of selector breakage.
Ids and classes churn on every deploy; accessible names don't.

**Tier 2, `StagehandResolver`.** LLM escalation for what the heuristic can't find: a toggle with
no accessible name, a label that changed along with the id. Wraps Stagehand's `observe(intent,
{page})`, so it's agent-agnostic. Gemini, OpenAI, or Anthropic, swapped with `SCHWIFLY_MODEL`, no
code change. **Live-proven** on `gemini-2.5-flash`, which healed a `#dark-mode-toggle-OLD` locator
with zero accessible name to `xpath=…/button[1]` after the heuristic gave up.

**`EscalatingResolver`** is what workflows actually use: tier 1 first, tier 2 only when tier 1
returns `null` *and* an LLM key is configured. A workflow with no key still gets the heuristic
backup for free; the model never gets called on the happy path, so `pnpm run verify` stays green
with zero API cost.

```ts
// src/heal.ts
export class EscalatingResolver implements Resolver {
  async resolve(page, spec) {
    const cheap = await this.heuristic.resolve(page, spec);
    if (cheap) return cheap;
    const llm = makeStagehandResolver(this.stagehand); // undefined with no key configured
    return llm ? llm.resolve(page, spec) : null;
  }
}
```

</details>

### Verdicts, not just pass/fail

`schwifly run` joins Playwright's JSON report with the heal and step logs and prints one line per
workflow, then sets the process exit code so CI can trust it without reading the log:

| Verdict | Meaning | Exit |
|---|---|---|
| **pass** | ran deterministically, no heal needed | 0 |
| **healed** | a locator broke, the resolver fixed it, the fix was written back | 0 |
| **fail** | the step genuinely failed | 1 |
| **impossible** | the resolver looked and came back empty (`resolver returned null`) | 1 |

This is real output, from deliberately breaking a locator in the shipped example workflow and
re-running it:

```
STATE       WORKFLOW
----------  ------------------------------------
PASS        workflows/the-internet.auth.setup.ts
HEALED      workflows/example.spec.ts
            - #this-id-no-longer-exists
            + role=link[name="Docs"i]

1 pass  1 healed  0 fail  0 impossible
```

An empty run, a Playwright process crash, or stale report data can never turn the exit code green:
`schwifly run` clears its logs before every run specifically so a prior success can't leak through.

## Quick start

Requires Node 22+ and pnpm (the `packageManager` field pins the version; `pnpm-lock.yaml` is the
only lockfile). Stagehand and Playwright are pinned to exact versions the AI evidence callbacks
were verified against, so don't bump them casually.

```bash
pnpm install
pnpm exec playwright install chromium

pnpm run verify          # the hero loop in a real browser, no LLM key needed, live tests skip
pnpm run schwifly run    # run workflows/, print verdicts, write back any successful heals
pnpm run typecheck
```

`pnpm run verify` is the fastest way to see the engine work: it drives real Chromium against a
free public site, breaks a locator, and asserts the heuristic resolver heals it, all with no API
key. Nothing in this repo requires a paid service; the only optional cost is your own LLM key for
tier-2 heals (Gemini Flash is effectively free).

## Building a workflow

A workflow is always the same shape underneath: a `.spec.ts` full of `step()` calls. There are
three ways to produce one without hand-writing every locator.

<details>
<summary><strong>schwifly record: do the flow once, save what you did</strong></summary>

```bash
pnpm run schwifly record https://example.com -- --out workflows/example-recording.spec.ts
```

Opens Playwright codegen's own browser. Click through the flow like a user, close the browser, and
Schwifly converts the recorded clicks, fills, and visible/text assertions into the same
`step()`-based template used everywhere else, so a later heal is still a one-line write-back, not
a re-record.

No key required. Locators derived from role, label, text, placeholder, title, or alt text get a
human-readable intent for free (`"click the Add Element"`); an opaque CSS or test-id selector keeps
a generic intent unless a key is already configured, in which case one optional labeling call
improves just those. Popup and new-tab sequences that Playwright codegen produces, including
switching back to the original tab, are preserved on the same plain-string locator contract.
Unsupported codegen actions fail the conversion outright rather than silently vanishing from the
saved spec.

</details>

<details>
<summary><strong>schwifly gen: turn a written story into a workflow</strong></summary>

```bash
# the `--` is required so pnpm forwards --url to the CLI, not to itself
GEMINI_API_KEY=… pnpm run schwifly gen \
  "Open pricing and check the Pro plan costs 19" -- --url https://example.com
```

The story is a sentence per step, each starting with a verb Schwifly recognizes (`click`, `fill`,
`open`, `see`, …), plus an inline `<validate>19</validate>` for anything that should be asserted.
Parsing that story into steps is pure and key-free (`parseStory()` has no browser or LLM
dependency, so writing stories is free to iterate on). Turning each step into a real locator needs
one live pass over the page, and that part is key-gated: Schwifly opens the URL once, calls
Stagehand's `observe()` per intent to find the element, then rewrites whatever selector comes back
into a stable `role=`/`text=`/`[aria-label]` string rather than keeping a brittle raw xpath. No key,
no network call: `gen` refuses up front with a clear message instead of guessing.

A story that's purely descriptive (no leading verbs, no `<validate>`) legitimately produces zero
steps: that's a story that describes state rather than action, not a bug.

</details>

<details>
<summary><strong>schwifly attempt: hand it a ticket, get back a verified workflow</strong></summary>

```bash
GEMINI_API_KEY=… pnpm run schwifly attempt \
  "Add an element to the list. <expect>Delete</expect>" -- \
  --url https://the-internet.herokuapp.com/add_remove_elements/ \
  --out workflows/add-element.spec.ts
```

This is the loosest input Schwifly accepts: an arbitrary ticket, not a structured story. A
bounded, same-origin browser agent (cross-origin navigation is blocked at the browser context, not
by asking nicely) attempts the task and its **observed, successful** actions become the candidate
workflow. The agent's own narration and self-reported success are never trusted as evidence.

Success is judged by an outcome contract resolved from the ticket up front: the `<expect>`/
`<validate>` tag, or a proposed one inferred from the start page if you didn't write one. That
contract becomes a real page assertion baked into the generated spec as a comment, so a human
reviewing the diff can see exactly what "success" means. The candidate then replays in a **fresh
browser session with the agent and the heal tier both disabled** (`SCHWIFLY_NO_HEAL=1`), and the
workflow is saved to disk only if every step of that replay is `ok`. An agent that claims success
while the contract doesn't hold exits non-zero and leaves nothing behind. A failed candidate stays
at a unique gitignored `candidates/candidate.<pid>.<id>.spec.ts` path as debug evidence instead of
overwriting anything in `workflows/`.

`--visible` runs the discovery attempt headed, so you can watch the agent work, and produces
byte-identical output to the headless run.

</details>

## Login-gated apps

Most real apps hide everything behind a login. Schwifly captures a session once and reuses it, the
Playwright-native way (no backend, no special access):

- A `setup` project runs `workflows/<app>.auth.setup.ts`, which logs in **via `step()`** (so the
  login itself self-heals like any other step) and writes `storageState` to
  `.schwifly/auth/<app>.json`.
- The `workflows` project depends on `setup` and loads that state. The session is reused across
  runs and re-captured automatically once it's stale (over 24h by file mtime).
- `tests/` is its own Playwright project with no `storageState` and no `setup` dependency, so
  `pnpm run verify` stays key-free and green with no credentials at all.

<details>
<summary><strong>Credentials, storageState, and what gets redacted</strong></summary>

Credentials come from the environment: copy `.env.example` to `.env` (gitignored) and run with
`node --env-file=.env`, or let `schwifly` auto-load `.env` itself. A captured `storageState` JSON
**is a credential**. It lives under `.schwifly/` (gitignored), is never committed, and every
`storageState*` file is also ignored as defense in depth. `redact()` scrubs secret-keyed fields,
and configured secret values even without a matching key label, before any heal or step record
persists or any verdict prints, so a password never lands in an ndjson log or a terminal diff.

Schwifly uses one shared login account by design. Per-worker multi-account isolation is a
deliberate non-goal for v1: the single shared session is also what keeps the Stagehand AI backup
logged in without juggling multiple identities. Generated (`gen`) and attempted (`attempt`)
workflows currently open their own Stagehand-owned browser context and don't yet inherit this
`storageState`. Authenticated generation is a known, deliberate gap, not an oversight (see
Current boundaries below).

</details>

## Stack

TypeScript · [Playwright](https://playwright.dev) (Apache-2.0), the runner and the browser ·
[Stagehand](https://stagehand.dev) (MIT, runs locally), the LLM-driving layer behind the tier-2
resolver and the `attempt` agent. Both are pinned to exact versions; Stagehand's agent evidence
callbacks are experimental and their shapes are version-sensitive.

## Current boundaries

This is a v1 hero loop, not a mature platform. Worth knowing before you lean on it:

- **The LLM heal tier is proven live on exactly one model.** Gemini 2.5 Flash healed a real broken
  locator in this repo's own validation. The `SCHWIFLY_MODEL` provider-swap to OpenAI or Anthropic
  is implemented and typechecked but hasn't been exercised against a live model yet.
- **Generated and attempted workflows don't inherit auth.** They run in their own Stagehand-owned
  browser context rather than the `workflows` project's `storageState`, so `gen`/`attempt` against
  a page that requires login doesn't work today. No consumer has needed it yet, so the
  `storageState` bridge into that shared session hasn't been built.
- **No CI loop yet.** Nothing currently re-runs workflows on a schedule or on push to catch drift
  and auto-heal it; every run today is invoked by hand.
- **One shared login account, not per-worker isolation.** A deliberate v1 scope cut, not a bug (see
  Login-gated apps above).

The full roadmap, including what's shipped, what's typechecked-but-unproven, and what's explicitly
deferred, lives in [TODO.md](./TODO.md).

## License

Licensed under the [PolyForm Small Business License 1.0.0](./LICENSE.md): free to use for small
businesses (fewer than 100 people and under $1M/yr revenue); other use requires a separate license.

> Required Notice: Copyright Alex Jenkins 2026

---

Copyright Alex Jenkins 2026
