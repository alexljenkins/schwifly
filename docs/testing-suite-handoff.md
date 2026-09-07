# Testing suite package handoff

## Target and boundaries

Other repositories turn product specs into stories and explicit proof checks during spec building.
Schwifly attempts those stories, reports evidence, and saves repeatable browser workflows only after independent proof checks pass.
Established workflows run without model calls. Recovery can change the route, but must preserve the story and proofs.
The builder AI owns app changes and decides when to retry after reading Schwifly's report.
A failed exploration means the agent did not complete the task. It does not prove the task is impossible.

## Starting point

Main includes user-outcome contracts at merge commit `3d1bbd4`.
Read [AGENTS.md](../AGENTS.md), then the relevant source below.
[TODO.md](../TODO.md) preserves older implementation decisions. This handoff takes priority for the next package work.
The larger [contract design](../SCHWIFLY-USER-OUTCOME-CONTRACTS.md) explains the separation between outcomes and routes.

- `src/story.ts` and `src/proofs.ts` load strict stories and author-owned executable checks.
- `src/storyAttempt.ts` certifies captured routes and explicitly rebuilds broken routes.
- `src/workflow.ts` and `src/cli.ts` run workflows and write successful element repairs back to their files.
- `src/emit.ts` still imports runtime source from the consuming root's `src` directory. External package use remains unfinished.
- `tests/story-vertical.spec.ts` proves unchanged stories survive 2 interfaces using Chromium and simulated discovery.

## Implementation checklist

Complete these in order, with focused checks and a commit at each checkpoint.

- [ ] **Make browser use predictable.** Default local verification and suite execution to 1 worker.
  Bound discovery steps, elapsed time, recovery attempts, and model retries. Close browsers after errors and cancellation.
  Check child Playwright processes too. A parent worker limit alone does not constrain separately launched runners.
  Done when failure and interruption leave no owned browser processes, and serial execution is the documented default.

- [ ] **Route model calls through OpenRouter.** Follow the decision below and centralize configuration in `src/llm.ts`.
  Cover discovery, generation, optional recording labels, and recovery. Missing credentials must leave deterministic runs usable.
  Done when 1 live discovery and 1 forced model repair pass, followed by replay with zero model calls.
  Keep transport and error tests key-free. Record the tested model ID and installed dependency versions.

- [ ] **Deliver an installable package.** Add compiled runtime exports, a CLI executable, and deliberate published file contents.
  Generate imports from the package and resolve stories, config, routes, and evidence against an explicit consumer root.
  Provide a small initialization example with outcome checks and product-specific proof functions.
  Done when a separate fixture app installs a packed archive and attempts, runs, records, and rebuilds without this checkout's source.

- [ ] **Support authenticated, repeatable sessions.** Bridge saved login state into discovery, replay, and recovery through `src/sharedCdp.ts`.
  Add an app-owned setup/reset mechanism so discovery cannot leave data that makes replay pass accidentally.
  Start with serial use of 1 test identity. Keep credentials and session files out of generated source and reports.
  Done when a login-required story passes in fresh sessions, while expired login and missing setup fail clearly.

- [ ] **Return evidence that builders can use.** Add a versioned machine-readable result beside the human report.
  Include story ID, phase, observed actions, failed proof IDs, failure reason, and paths to redacted traces or screenshots.
  Distinguish unmet outcomes, incomplete exploration, invalid contracts, and browser/provider failures. Preserve existing CLI compatibility where practical.
  Add suite selection and aggregate results so another repo can run its stories without a custom script per story.
  Done when an external caller can identify a failed proof, fix the app, rerun, and receive a certified workflow.

- [ ] **Complete automatic recovery and prove the package.** For story-backed runs, reuse the established route first.
  Try element repair, then bounded route rebuilding when repair cannot complete the story. Reuse `rebuildStory()`.
  Require fresh replay with healing disabled before saving either kind of repair. Preserve the prior route when certification fails.
  Publish useful evidence on failure and exit non-zero. Keep app implementation and repeated development cycles in the caller.
  Done when 1 consumer app demonstrates initial discovery, model-free replay, element repair, changed-route rebuilding, and a real outcome regression.
  Add a serial CI example that retains evidence and repair diffs. Document installation, authoring, login, limits, and recovery.

## OpenRouter decision

Use Stagehand's existing model configuration first. A new general-purpose adapter is unnecessary unless the compatibility check fails.
Stagehand 3.7.1 already depends on Vercel AI SDK 5 and supports a custom endpoint with explicit chat-completions routing.
OpenRouter documents an [OpenAI-compatible endpoint](https://openrouter.ai/docs/quickstart).

Expose `OPENROUTER_API_KEY` and retain `SCHWIFLY_MODEL` for the OpenRouter model ID.
Internally, test this Stagehand model object against the pinned release:

```ts
{
  modelName: `openai/${openRouterModelId}`,
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  openaiEndpointFormat: 'chat',
}
```

The first `openai/` selects Stagehand's transport. The remaining ID selects the model at OpenRouter.
Verify that both `observe()` and the DOM agent use this configuration, including structured responses and tool calls.
`openSharedSession()` currently reads the model independently, so changing key detection alone is insufficient.
Use a fixed, tested model ID rather than a moving alias. Report authentication, rate-limit, and budget failures without endless retries.

If this path fails, use Stagehand's [AISdkClient integration](https://docs.stagehand.dev/v3/configuration/models)
with the [OpenRouter AI SDK provider](https://openrouter.ai/docs/guides/community/vercel-ai-sdk).
Match its version to Stagehand's `LanguageModelV2` contract. Verify agent discovery separately from observation.
Add a direct AI SDK Core dependency only when Schwifly needs calls outside Stagehand.
Preserve the pinned evidence callbacks until a replacement passes capture and fresh-replay tests.

## Verification and scope

The merge passed type checking. The brain records 106 passing tests and 2 skipped tests at `3ead4da` on September 5, 2026.
The September 7 parallel verification was interrupted by a PC crash. It is not a passing baseline.
Run focused tests first. Run these commands separately, with no other browser work active:

```bash
pnpm run typecheck
pnpm run verify --workers=1
```

Keep live model checks separate and bounded. Confirm nested runners remain serial before running the complete suite.
Defer autonomous spec decomposition, app coding, persona simulation, crawling, site maps, and scoring.
Use existing app checks for visual acceptance until a consumer needs dedicated Schwifly support.
