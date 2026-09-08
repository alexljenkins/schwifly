# AI-native browser evaluation for Schwifly

Research date: 2026-08-12

## Scope

This review treats the two relevant new agent-native engines as:

1. [Cloudflare Kitesurf](https://blog.cloudflare.com/kitesurf/), announced on 2026-08-06.
2. [Lightpanda](https://github.com/lightpanda-io/browser), whose native agent mode and deterministic
   PandaScript workflow shipped in 2026.

These are browser engines built for automation and agents, unlike consumer AI browsers such as
Comet or Dia. They are the only category that could replace Chromium beneath Schwifly's Playwright
and Stagehand stack.

## Decision

**Do not adopt either engine as Schwifly's default browser now.** Browser fidelity is part of the
test result. A faster engine that differs from the user's Chromium browser can create false passes
and false failures. Both products are beta and incomplete, while Schwifly already has a working,
verified Chromium path.

If browser resource use becomes a measured bottleneck, run a small **opt-in Lightpanda spike** for
discovery and crawling only. Keep Chromium as the deterministic certification and replay engine.
Do not implement Kitesurf until it is open source, supports persistent authenticated sessions, and
has stable pricing outside beta.

## Current Schwifly constraints

The integration is more than changing a browser executable:

- `src/sharedCdp.ts` lets Stagehand own Chromium, then attaches Playwright over CDP so both operate
  on the exact same DOM.
- `src/attempt.ts` depends on Stagehand 3.7.3's experimental evidence callbacks and their observed
  Playwright selectors. These callbacks are required to produce replayable workflows.
- The candidate is certified in a fresh Playwright process with the agent and healing disabled.
- Generated locators remain plain strings so a heal is a one-line source diff.
- Auth uses Playwright `storageState`, although generated and attempted flows still need the known
  bridge into the Stagehand-owned context.
- `TODO.md` locks the product to free, open-source, local-first execution with no mandatory cloud.

Any alternative browser must preserve all of those contracts, not merely load a URL.

## Comparison

| | Cloudflare Kitesurf | Lightpanda |
|---|---|---|
| Runtime | Cloudflare Workers via Browser Run | Local binary/Docker or Lightpanda Cloud |
| Engine | Rust/Wasm components using Blitz, Stylo, Boa and V8 isolates | New Zig engine using V8, not Chromium/WebKit |
| Automation | CDP subset, Playwright, Puppeteer, MCP | CDP, Playwright, Puppeteer, MCP, native agent |
| Stagehand | Browser Run supports Stagehand, but Kitesurf-specific evidence compatibility is unproven | [Official Stagehand integration](https://lightpanda.io/docs/guides/use-stagehand) via `cdpUrl` |
| Maturity | Beta, twelve weeks old at announcement | Beta, active releases, incomplete Web API coverage |
| Open source | **No.** Cloudflare says it plans to open source it | **Yes, AGPL-3.0-only** |
| Local use | No current self-hosted release | Yes |
| Best fit | Stateless extraction, screenshots, PDFs and bursty agent tasks | High-volume DOM automation, extraction and discovery |
| Poor fit | Persistent auth, full browser fidelity, anti-bot TLS, video/WebGL | Pixel-fidelity testing and sites using unsupported Web APIs |
| Experimental integration | 120 to 180 net LOC | 90 to 140 net LOC |
| Supported opt-in backend | 320 to 480 net LOC | 260 to 420 net LOC |

The production estimates include implementation, key-free fakes, lifecycle/error tests, live-test
gates, documentation and configuration validation. They exclude generated lockfile changes. The
wide range reflects engine compatibility failures found during the required live matrix, not
uncertainty about the small CDP connection code.

## Cloudflare Kitesurf

### What it is

Kitesurf is a stateless browser built specifically for agents on Cloudflare Workers. It exposes
CDP and REST endpoints through Browser Run. Cloudflare reports that its 14-URL benchmark uses 3.1
to 3.8 times less CPU and 4.7 to 7 times less memory than a warm Chromium pool, but is 1.7 to 1.8
times slower in wall time. It currently implements a subset of CDP and passes more than 215,000 Web
Platform Tests. These are vendor benchmarks, not Schwifly measurements.

Cloudflare explicitly says Kitesurf is not yet suitable for video, WebGL, real TLS fingerprint bot
challenges, or ten-minute authenticated sessions requiring persistent state. That last limitation
directly conflicts with Schwifly's login-gated workflow model.

Sources: [announcement and limitations](https://blog.cloudflare.com/kitesurf/),
[Browser Run Playwright CDP](https://developers.cloudflare.com/browser-run/cdp/playwright/),
[Browser Run Stagehand](https://developers.cloudflare.com/browser-run/stagehand/).

### Cost and license

- Kitesurf is free during beta, subject to per-account limits.
- It is not open source as of the research date. Cloudflare says it intends to open source it and
  allow deployment into a customer's own account, but gives no release date or license.
- Post-beta Kitesurf pricing is not published. The surrounding Browser Run service currently gives
  Workers Free users 10 minutes per day and three concurrent browsers. Workers Paid includes 10
  browser hours per month and 10 average concurrent browsers, then charges $0.09 per browser hour
  and $2 per additional average concurrent browser. The Workers plan cost itself is additional.
- BYO model charges still apply to Stagehand.

Source: [Browser Run pricing](https://developers.cloudflare.com/browser-run/pricing/).

### Pros for Schwifly

- CDP keeps Playwright integration conceptually small.
- Strong isolation for untrusted pages and short-lived agent discovery.
- Low memory and CPU could make a future crawler/explorer much cheaper at high concurrency.
- Cloudflare owns browser provisioning, concurrency and teardown.
- Browser Run offers live view, human takeover and optional session recording that could improve
  remote debugging.

### Cons for Schwifly

- Violates the current open-source, local-first constraint.
- Cannot currently support Schwifly's persistent authenticated workflow use case.
- A non-Chromium engine weakens test fidelity for Chromium users.
- CDP is incomplete and Kitesurf is too new for Stagehand's experimental evidence path to be
  trusted without a live compatibility suite.
- Remote execution cannot reach localhost or private test environments without new tunnel/network
  machinery.
- Cloud credentials and browser traffic become new secret and data-boundary concerns.
- Beta pricing is temporary and production pricing is unknown.

### Implementation shape and estimate

An experiment would add a Kitesurf CDP provider to `openSharedSession()`, validated Cloudflare
credentials, explicit opt-in configuration, lifecycle cleanup and one live witness. That is about
120 to 180 net LOC.

A supported backend would also need:

- A provider-neutral shared-session factory and errors: 70 to 110 LOC.
- Auth header/CDP connection handling and secret redaction: 35 to 55 LOC.
- `storageState` import or an explicit rejection for auth flows: 35 to 60 LOC.
- Unit, lifecycle and engine-contract tests: 140 to 210 LOC.
- User documentation and environment contract: 40 to 45 LOC.

Estimated total: **320 to 480 net LOC**. This should remain an optional discovery engine. Making it
the runner, recorder and certification browser would require a larger cross-engine Playwright
configuration and would damage result fidelity.

## Lightpanda

### What it is

Lightpanda is a from-scratch headless engine written in Zig for agents and automation. It runs
locally as a binary or Docker image and exposes CDP. Its project benchmark reports about 9 times
faster execution and 16 times lower peak memory than headless Chrome across its test corpus. These
are vendor benchmarks, not Schwifly measurements.

Lightpanda now includes a native agent that can save a successful run as deterministic JavaScript
called PandaScript, then replay it without an LLM. That resembles Schwifly's discovery-to-replay
idea, but replacing Schwifly's `.spec.ts`, verdict, heal and write-back contracts with PandaScript
would duplicate or discard the product's core value. The useful part for Schwifly is the engine,
not its agent format.

Sources: [repository and status](https://github.com/lightpanda-io/browser),
[agent stack](https://lightpanda.io/blog/posts/the-browser-agent-stack-explained),
[Stagehand guide](https://lightpanda.io/docs/guides/use-stagehand).

### Cost and license

- Self-hosting the binary is free apart from compute and the chosen LLM. The project is
  [AGPL-3.0-only](https://github.com/lightpanda-io/browser/blob/main/LICENSING.md).
- Using an unmodified Lightpanda process over CDP is a cleaner separation than linking its code
  into Schwifly, but the AGPL and Schwifly's PolyForm license should receive legal review before
  distributing a bundled binary or a modified hosted build.
- Lightpanda Cloud Explorer is $0 with 10 browser hours per month and five concurrent sessions.
- Builder is $19 per month with 300 browser hours and 30 concurrent sessions, then $0.08 per hour.
- Enterprise, private cloud and SLA pricing is custom.
- BYO model charges still apply to Stagehand or Lightpanda's native agent.

Source: [Lightpanda pricing](https://lightpanda.io/pricing/).

### Pros for Schwifly

- Satisfies local execution and is open source.
- Official Stagehand integration already uses the exact seam Schwifly needs: start Lightpanda,
  then pass its CDP URL to Stagehand.
- The same CDP session can remain available to Playwright, preserving the shared-DOM design.
- Lower resource use could unlock high-concurrency discovery, crawling and CI.
- A local binary keeps localhost, VPN and private app testing possible.
- Cloud service remains optional.

### Cons for Schwifly

- Beta stability and incomplete Web API/CDP coverage can misrepresent real Chromium behavior.
- A new engine adds a browser compatibility matrix to every feature and pinned-version upgrade.
- It requires a second binary lifecycle, platform downloads and CI caching.
- There is no native Windows binary; Windows requires WSL2.
- Default telemetry must be understood and likely disabled for a privacy-preserving test tool.
- AGPL distribution and hosted-modification obligations need review.
- Its native agent and PandaScript overlap with Schwifly rather than extending its `.spec.ts`
  workflow model.

### Implementation shape and estimate

An experiment would install or locate Lightpanda, start its CDP server, point Stagehand at `cdpUrl`,
create the required fresh page, attach Playwright, and guarantee process teardown. That is about 90
to 140 net LOC because Lightpanda documents the Stagehand path.

A supported backend would also need:

- A provider-neutral shared-session factory and engine configuration: 55 to 85 LOC.
- Binary discovery, startup, port allocation and teardown: 45 to 75 LOC.
- Auth-state loading and capability rejection where unsupported: 30 to 50 LOC.
- Unit, lifecycle and cross-engine contract tests: 110 to 170 LOC.
- Documentation, install command and telemetry setting: 20 to 40 LOC.

Estimated total: **260 to 420 net LOC**. The first supported use should be `gen`, `attempt` or a
future `explore` command, followed by Chromium certification. Do not let a Lightpanda pass certify
a workflow until the same workflow passes in Chromium.

## Suggested trigger for revisiting

Run the Lightpanda spike only when at least one trigger is true:

- Browser memory or startup time is measured as a top-three bottleneck.
- `explore` needs at least 10 concurrent sessions.
- CI browser compute has a material monthly cost.
- Three target applications pass a fixed Schwifly engine-contract suite with no behavior delta.

Reconsider Kitesurf only after it is open source, its license is compatible, persistent auth works,
localhost/private networking has a supported answer, and non-beta pricing is published.

## Other high-leverage improvements found in the repo

Ordered by value and dependency, with net implementation estimates including focused tests:

1. **Bridge auth state into generated and attempted sessions, 120 to 180 LOC.** `README.md` and
   `TODO.md` both identify this gap. It unlocks the majority of real internal applications and is
   higher value than another browser engine.
2. **Verified CI self-heal PR loop, 180 to 280 LOC.** Re-run only healed workflows, accept the
   locator diff only after a clean second pass, then publish a reviewable bot branch/PR. This closes
   the product's promised self-maintaining loop.
3. **Failure evidence bundle, 160 to 260 LOC.** Join the existing verdict, step log, trace, final
   screenshot, console errors and network failures into one redacted artifact per failed workflow.
   The current verdict says what failed but not enough about why.
4. **Expand deterministic actions and assertions, 250 to 400 LOC.** Add `selectOption`, checked
   state, URL, title, value and element-count assertions. `record.ts` currently rejects common
   codegen actions because `Action` only has four members. This broadens real workflow coverage
   without adding AI uncertainty.
5. **Replay-based path minimization, 100 to 180 LOC.** Implement the bounded delta-debugging design
   already recorded in `TODO.md`. It removes redundant successful discovery steps only when the
   final contract still passes from a fresh start.
6. **Workflow doctor, 120 to 200 LOC.** A key-free `schwifly doctor` should validate imports,
   direct-child output shape, duplicate/opaque locators, missing assertions, leaked literal secrets
   and unsupported actions before a browser run.
7. **Deterministic visual regression action, 250 to 400 LOC.** Add opt-in screenshot assertions
   using Playwright snapshots, with masks for known dynamic regions. Keep Chromium authoritative.
   This catches layout regressions that text and visibility assertions cannot.
8. **Bounded explorer feeding the existing attempt gate, 350 to 550 LOC.** Crawl a small app,
   propose outcome contracts, then pass every candidate through the current capture, emit and clean
   replay path. This turns one ticket at a time into automatic coverage without creating a second
   workflow engine.
