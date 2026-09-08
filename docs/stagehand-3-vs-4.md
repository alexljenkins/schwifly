# Stagehand 3.7 vs 4.0 for Schwifly

Written 2026-09-08 against `@browserbasehq/stagehand@3.7.3` (pinned) and `4.0.2` (tried and
rejected). Claims come from the type surface of both packages and from
[the v4 announcement](https://www.browserbase.com/blog/stagehand-v4).

**Verdict: stay on 3.7.3.** Version 4 is faster and much lighter. It also deletes the one feature
`schwifly attempt` is built on. We cannot take it yet.

## The short version

Think of Stagehand 3 as a **passenger** and Stagehand 4 as a **driver**.

In version 3, Playwright drives the browser. Stagehand sits next to it and helps: it reads the page
with AI, and it can take the wheel for a while. When it takes the wheel, it writes down every turn it
made, in Playwright's own words. Schwifly reads those notes and turns them into a test.

In version 4, Stagehand drives its own car. It installs a Chrome extension and talks to the browser
itself. It no longer uses Playwright at all. That makes it faster and much smaller. But it no longer
takes the wheel on its own, and it no longer writes notes in Playwright's words.

Schwifly's whole job is turning an AI's browsing into a Playwright test. Version 4 removed both
halves of that.

## What we could do that we would lose

| We do this today | On v4 |
| --- | --- |
| Hand a ticket to an AI and let it try the task in a browser | **Gone.** v4 has no `agent()`. Their own blog lists it as removed. There is no replacement package. |
| Watch each agent step and grab the real Playwright selector it used | **Gone.** The `onEvidence` stream goes with the agent. |
| Generate a `.spec.ts` from that run and replay it with no AI | **Gone.** Nothing feeds the generator. |
| Run Playwright and Stagehand on one browser, our way | **Awkward.** `connectURL()` is gone. Sharing still works, but Stagehand must launch the browser and the browser must carry Stagehand's extension. Headless shell does not load extensions. |
| Choose Playwright, Puppeteer, or Patchright as the driver | **Gone.** v4 only drives its own extension. |

The first row is the blocker. `schwifly attempt` is the product. Everything else is a porting cost.

## What we would gain

| We cannot do this today | On v4 |
| --- | --- |
| See token cost and cache hits per call | Every `act`, `observe`, and `extract` returns usage and cache metadata. Today we only get run totals. |
| Install a small package | 229 transitive packages drop to **49**. The unpacked size drops from 13 MB to 3.3 MB. |
| Plug in our own model without wrapping the AI SDK | Pass a `generate(params)` function. That would delete most of `src/llm.ts`. |
| Tune prompt caching | `cache: { threshold }`, with a hit or miss reported per call. Our repair loop repeats similar prompts. |
| Click inside a closed shadow root or a nested iframe | v4 handles both. Playwright struggles with closed roots. |
| Copy and paste for real | `BrowserClipboard`. |
| Group several AI calls into one round trip | `experimentalBatch()`. |
| Get run traces for free | OpenTelemetry is built in. |

**And it is genuinely faster than Playwright.** Browserbase's own numbers, so treat them as a best
case, not a promise:

- A batch Wikipedia crawl: 14.2s versus Playwright's 22.7s, so 1.59x faster.
- `click`: 628ms drops to 323ms.
- `goBack`: 140ms drops to 18ms.
- `waitForSelector`: 493ms drops to 238ms.

The smaller install is the gain I care about most. We ship Schwifly into other people's repos, and
180 fewer packages is a real supply chain win.

## Why they did it

Version 4 is aimed at AI agents browsing the live web. Playwright was built to test your own site,
where the page is not trying to trick you. Browserbase wanted a driver built for hostile pages, so
they wrote one and put domain rules inside the browser instead of in your code.

That is a good goal. It is not our goal. We test your own site, and we want Playwright output.

## Full feature comparison

### Agent and capture

| Feature | 3.7.3 | 4.0.2 |
| --- | --- | --- |
| `stagehand.agent()` | Yes | Removed |
| Agent modes (`dom`, `cua`, hybrid) | Yes | No agent |
| `onEvidence` step callbacks | Yes (`step_finished`, `step_observed`) | No |
| Real Playwright selectors per agent step | Yes, via `mode: 'dom'` | No |
| Streaming agent (`onChunk`, `onFinish`, `onAbort`) | Yes | No |
| Trajectory recording and rubric verifier | Yes | No |
| Agent step caching and replay | Yes | No |

### Browser control

| Feature | 3.7.3 | 4.0.2 |
| --- | --- | --- |
| Driver | Playwright, Puppeteer, or Patchright (peer dependency) | Own Chrome extension over JSON-RPC |
| Returns a Playwright `Page` | Yes | No, its own `Page` class |
| Get a CDP endpoint | `connectURL()` | `localBrowser.launch({ port })` |
| Join an existing browser | Playwright launches, Stagehand joins | `localBrowser.connect({ cdpUrl })`, extension required |
| Closed shadow roots, nested and out-of-process iframes | Partial | Yes |
| Clipboard | No | Yes |
| Drag and drop along a path | No | Yes |
| Direct CDP events | Via Playwright | `CDPSubscription`, `page.on()` |

### AI operations

| Feature | 3.7.3 | 4.0.2 |
| --- | --- | --- |
| `act`, `observe`, `extract` | Yes | Yes |
| `observe()` returns | `Action[]` | `{ data, metadata }` |
| `extract()` returns | The parsed object | `{ data, metadata }` |
| Usage and cache metadata per call | No, totals only | Yes |
| Prompt cache threshold | Server-side, not exposed | `cache: { threshold }` |
| Bring your own LLM | Subclass `LLMClient`, or an AI SDK model | A `generate(params)` callback |
| Named routed models | Yes | Yes, 148 across OpenAI, Anthropic, Google, Groq, Cerebras |
| Batch AI calls | No | `experimentalBatch()` |
| WebMCP page tools | Via MCP server connection | `page.tools()` |
| OpenTelemetry | No | Built in |

### Packaging

| Feature | 3.7.3 | 4.0.2 |
| --- | --- | --- |
| Transitive packages | 229 | 49 |
| Unpacked `dist` | 13 MB | 3.3 MB |
| Tarball | 1.7 MB | 997 KB |
| Bundled vendor SDKs | `openai`, `@anthropic-ai/sdk`, `@google/genai`, `ai`, `pino`, `ws` | None |
| Zod | 3 or 4, as a peer | 4.4.3, direct and pinned |
| Module formats | ESM and CJS | ESM only |
| Minimum Node | 20.19 or 22.12 | 22.18 |
| Construction | `new Stagehand(opts)` | `await Stagehand.create({ browser })` |

## Cost of migrating

A trial bump to 4.0.2 gave 24 TypeScript errors across 8 files.

Mechanical, about a day in total:

- `new Stagehand()` becomes `await Stagehand.create()` in `src/sharedCdp.ts`.
- `observe()` callers unwrap `.data` in `src/generate.ts`, `src/heal.ts`, `src/tester.ts`, and 2 specs.
- `extract()` callers unwrap `.data` in `src/attempt.ts`, `src/recordLabel.ts`, `src/tester.ts`.
- `ModelConfiguration` in `src/llm.ts` becomes the `generate` callback.
- Page and context getters become async.

Not mechanical:

- Playwright's `Page` and Stagehand's `Page` are now 2 unrelated types. A cast does not fix this. The
  2 objects drive different browsers unless we rebuild the shared session around Stagehand's launch.
- `src/attempt.ts` loses `agent()`. That is not a port. It is a rewrite against an API that does not
  exist.

## When to look again

Reopen this when either is true.

- Version 4 ships an agent API that emits real Playwright selectors per step.
- We decide `schwifly attempt` should discover flows another way. Then the smaller install and the
  speed win on their own.

Until then 3.7.3 is the newest version that keeps the product working. `TODO.md` holds the short form
under `### task-to-verified-flow`.
