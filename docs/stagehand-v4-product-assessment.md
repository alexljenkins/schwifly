# Stagehand v4 product assessment

Assessed 2026-09-08 against the current official v4 documentation and Schwifly's code and product documentation.
This is a strategic assessment, not a completed migration or runtime benchmark.

**Recommendation: pursue v4 through a measured prototype. The earlier categorical rejection is unsupported.**
V4 can support the requested product flows. Whether replacing the entire browser implementation pays off remains unproven.
The product should own expected outcomes, recorded execution, and repair decisions. Stagehand should provide browser operations and optional AI assistance.

## Measured prototype result

The Stagehand 4.1 external-agent prototype passed every required scenario in 3 runs.
Against the matched Stagehand 3.7 baseline, discovery was 61% faster and used 69% fewer model calls.
Discovery cost fell from $0.10617 to $0.00939 across 3 runs.
Repair was 21% faster and cost 74% less, but its slowest run still took 105.6 seconds.
Both engines caught every seeded defect and replayed unchanged routes without a model.

See [the comparison table](bench/stagehand-3.7-vs-stagehand-4.md) and
[the v4 result data](bench/stagehand-4-results.json).

## What the earlier assessment misses

The [migration guide](https://docs.stagehand.dev/v4/migrations/v3) explicitly replaces the built-in agent with 2 approaches:

- A model writes a script, which then runs as ordinary code.
- An external agent calls browser tools during execution.

A Locator identifies and operates on an element. It does not plan a complete task.
The announcement groups these changes confusingly. Its broad migration claim does not establish compatibility with Schwifly's experimental callbacks.

However, removing those callbacks does not remove action capture.
[Observe](https://docs.stagehand.dev/v4/basics/observe) returns action objects containing a selector, method, and arguments.
Passing an observed action to `act()` skips model inference.
Schwifly can record the operation it executes, its result, and the resulting page state itself.
This replaces dependence on another agent's internal evidence format.

The earlier report also defines the product too narrowly as converting AI browsing into Playwright files.
The [README](../README.md) already describes a persistent tester with concise feedback and saved regression checks.
[Stories](../examples/task-app/stories/add-item.story.yaml) already separate required outcomes from generated routes.
Those user benefits do not require the v3 agent API or a particular generated file format.

## Fit against the 3 goals

| Goal | Product behavior to build | V4 contribution | Remaining responsibility |
| --- | --- | --- | --- |
| Fast regression checks in CI | Discover once, replay fixed actions, repair only failed routes. | Concrete actions and direct browser operations support replay without inference. | Reliable assertions, reset data, failure classification, repair limits, and CI reports. |
| A development companion with lean context | A separate tester retains browser context and returns findings with evidence paths. | Browser snapshots and deterministic interaction support an external tester agent. | Keep browser history outside the coding conversation and bound each request. |
| Catch bugs that routine tests miss | Explore variants, then preserve useful discoveries as repeatable checks. | More browser interaction options can expand exploration. | Choose meaningful cases and prove outcomes independently of the exploring model. |

V4 is a plausible foundation for all 3 goals. None follows automatically from changing the dependency.

## The user experience I would build

The user describes the behavior and expected outcome once.
For example, adding a task must create exactly 1 task, and the task must survive a reload.
The tester discovers a working route and verifies those outcomes against controlled data.
It saves the route only after a fresh run passes without AI assistance.

During coding, the same tester accepts a focused follow-up such as trying the save button again.
It reports the failed expectation, observed value, shortest reproduction, and relevant screenshot or error.
It labels results from an existing session separately from results after a clean reset.
Browser history and full evidence stay in files unless the coding agent requests them.

In CI, saved routes run without a model on the normal passing path.
A failed route can trigger a bounded repair attempt against unchanged requirements.
The report distinguishes an unchanged pass, a repaired route, a product failure, and a test infrastructure failure.
The original failure and repair diff remain visible even when the repaired route passes.

## Replace the agent, not the user's workflow

Use a bounded tester agent that can inspect the page, execute concrete operations, and request focused AI help.
[Page snapshots](https://docs.stagehand.dev/v4/reference/page#snapshot) provide a formatted tree and XPath lookup for grounded element selection.
Record operations at the execution boundary, including target, arguments, order, result, and relevant state transitions.
Observe again after a transition makes previous page information stale.
Do not treat an attempted operation as successful merely because the model requested it.

Prefer direct browser operations when the tester knows the target.
Use `observe()` when resolving a target requires interpretation.
Calling another model through `act()` for every tool call can add unnecessary latency and cost.
Use generated scripts for known routes, with tool calling for discovery and uncertain failures.

Keep the saved route as ordinary executable code initially.
Do not create a general workflow language or plugin system just to migrate.
Require stable targeting and fresh replay before promotion. A snapshot reference alone is not a durable test selector.
Record uncertain execution outcomes explicitly, especially when an error follows a possible form submission.

## Repair must preserve the bug detector

Automatically repairing tests and automatically fixing application regressions are different operations.
Schwifly can repair target selection or permitted navigation while preserving the expected behavior.
An application defect should produce evidence for the coding agent, followed by a rerun after its fix.

If saving shows a success message but loses data after reload, the test must fail.
The repairer must not replace persistence checks with a success-message check.
If clicking Save creates 2 records, a check that merely finds the new title is insufficient.
If the test covers keyboard access, switching to a mouse click must not count as repair.

Protect required interactions as well as final outcomes.
Keep expected results and proof functions outside the repairer's editable route.
Use exact values, record counts, persistence checks, and negative conditions where the story requires them.
AI observations can suggest new requirements, but cannot silently redefine a passing result.

## What gets faster, and what does not

The [announcement](https://www.browserbase.com/blog/stagehand-v4) reports a 1.59x improvement for 1 remote crawl using experimental batching.
It explicitly says this is 1 run and that local browsers have less network latency to remove.
This does not establish faster Schwifly CI or better failure detection.
Batching browser commands also does not mean combining several AI calls into 1 model request.

The likely large gains come from fewer model calls, retained development sessions, and focused reruns.
These are architectural choices available on v3 too. Measure v4's additional benefit separately.
Skipping waits can reduce runtime while increasing missed or intermittent failures. Compare equivalent correctness guarantees.

[V4 caching](https://docs.stagehand.dev/v4/best-practices/caching) stores AI operation results on Browserbase.
The documented cache option has no effect with a local browser.
Its threshold counts repeated identical results. It is not a provider prompt-cache control.
Committed replay code should supply the predictable local path, independent of that cache.

## Coverage and visibility

V4 documents support for closed shadow roots, nested frames, clipboard operations, and page-provided tools.
These can enable cases Schwifly's current action capture does not preserve.
Each new operation still needs recording, replay, and outcome verification before it becomes regression coverage.

[WebMCP](https://docs.stagehand.dev/v4/basics/webmcp) exposes tools supplied by the page.
These tools may simplify setup or test service behavior.
Calling a page tool does not prove a user can complete the equivalent interaction through the UI.

Add exploration around refresh, back navigation, repeated submission, keyboard interaction, and recovery from a failed request.
Use controlled variants instead of an unrestricted crawl.
Visual review can find suspicious clipping or layout changes, but model opinions should remain separate from deterministic results.

[OpenTelemetry support](https://docs.stagehand.dev/v4/configuration/observability#tracing) provides operation traces through a configured collector.
That helps explain execution time and failures. It does not supply a complete test report or local visual replay viewer.
Schwifly still needs evidence tied to the failed product requirement.

## The real migration tradeoff

The [Playwright migration guide](https://docs.stagehand.dev/v4/migrations/playwright) lists gaps that matter more than losing `agent()`.
V4 lacks built-in web-first assertion retries, request mocking, and the `getByRole()` API.
It also documents different waiting and target-matching behavior.
Replacing deterministic assertions with AI extraction would weaken the CI goal.

There are 2 reasonable implementation choices:

| Choice | Benefit | Cost |
| --- | --- | --- |
| Use v4 for discovery and retain Playwright replay initially. | Keeps existing assertion and CI behavior while proving the new discovery loop. | Requires compatible targeting and limits replay of v4-specific interactions. |
| Use v4 for discovery and replay. | Keeps operations consistent and allows v4-specific interactions throughout. | Schwifly must supply missing testing behavior and port existing proof integrations. |

I would prove discovery first with the existing replay checks, then test native v4 replay for the wider coverage cases.
This is an experiment sequence, not a commitment to maintain 2 permanent browser implementations.
Do not force v4-specific shadow-root paths through Playwright and assume they mean the same thing.
The [browser configuration](https://docs.stagehand.dev/v4/configuration/browser) must also work in the actual local and CI environments.
Browser installation, launch, authentication, and cleanup belong in the acceptance check.

## Evidence required before a large rewrite

Use the same model, controlled app data, machine, and correctness requirements for v3 and v4 comparisons.
Measure local development separately from remote browsers.
Include first-run discovery, repeated development checks, unchanged CI replay, and repair.

| Experiment | Required evidence |
| --- | --- |
| Discover a product flow and save it. | A fresh replay passes with 0 model calls. |
| Rename or move a control without changing behavior. | A bounded repair passes unchanged proofs and records its diff. |
| Break persistence, duplicate a submission, or block a required interaction. | Each seeded defect fails and remains failed after attempted route repair. |
| Check an asynchronous update. | Correct waiting prevents both premature failure and premature success. |
| Repeat a development request. | The coding agent receives bounded findings without full browser history. |
| Exercise a required frame or clipboard flow. | Capture, replay, and proofs all work for that operation. |
| Fail browser startup or model access. | The report identifies infrastructure failure without claiming an application defect. |

Record median and tail latency, model calls, token cost, intermittent failures, repair success, and missed seeded defects.
The first measured prototype now establishes these numbers for one controlled local flow.
Wider flows and native v4 repair remain unmeasured.
