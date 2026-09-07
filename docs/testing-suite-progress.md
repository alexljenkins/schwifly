# Package implementation checks

The checkpoints follow [the handoff](testing-suite-handoff.md).
Browser commands run serially. Child runners force 1 worker.

## 1. Predictable browser use

- Local configuration defaults to 1 worker and disables fully parallel execution.
- Child runners force 1 worker, enforce a deadline, and terminate their process groups.
- Shared sessions close on errors, elapsed limits, SIGINT, and SIGTERM.
- Discovery rejects budgets outside 1 through 12 and passes cancellation to the DOM agent.
- Model transport bounds are checked with the OpenRouter configuration in checkpoint 2.
- Checks: typecheck passed. All 106 existing key-free tests passed in the serial baseline.
  The corrected focused run passed 13 tests, including deadline and SIGTERM process cleanup.

## 2. OpenRouter

- Stagehand's built-in OpenAI chat transport works with OpenRouter. No adapter dependency was needed.
- The initial check used `google/gemini-3.5-flash-lite`. Checkpoint 6 selects the final default.
- Live discovery plus forced `observe()` repair passed with 7 model calls. Fresh replay made 0 calls.
- `openai/gpt-5.4-nano` connected but did not satisfy the discovery contract within 5 steps.
  This is incomplete exploration, not evidence that the app cannot satisfy the story.
- Key-free transport tests verify HTTP 401, 402, and 429 each make 1 request and return a safe error.
- Each model request has a 30-second deadline. Each session allows at most 36 calls with no automatic provider retries.
- Typecheck and 7 focused checks pass. Live checks require `SCHWIFLY_LIVE=1` and stay outside key-free verification.
- Installed versions: Stagehand 3.7.1, Playwright 1.61.1, TypeScript 5.9.3, tsx 4.23.1.
- Configuration follows [OpenRouter's chat endpoint](https://openrouter.ai/docs/quickstart)
  and [Stagehand model configuration](https://docs.stagehand.dev/v3/configuration/models).

## 3. Installable package

- The archive contains compiled runtime code, declarations, a CLI executable, and an initialization example.
- Generated imports resolve through `schwifly/*`. Consumer roots control config, stories, routes, and evidence.
- A separate app installed the archive in `/tmp`, then passed discovery, replay, recording import, and route rebuild.
  Discovery uses scripted browser actions in this key-free package check. Certification runs real Chromium.
- Typecheck passed. The 28 focused generator, CLI, and story tests pass after updating the emitted import contract.
- The public API loads TypeScript config through tsx outside tests. Playwright owns config loading inside its tests.

## 4. Repeatable sessions

The app owns setup/reset and login verification in `schwifly.config.ts`.
Stories require setup before browser work. Configured sessions require saved state and a login check.
Each discovery, repair, and certification starts a fresh session and runs setup again.
Session values join the redaction set and never enter generated workflow source.
- The authenticated packed consumer passes fresh discovery, replay, recording import, and rebuilding.
  Expired login and missing setup return explicit failures.
- A live OpenRouter repair passes in a context restored from saved state. Replay makes 0 model calls.
- The 17 focused auth, redaction, and generator checks pass. Refreshed localStorage survives navigation.

## 5. Builder results

Version 1 reports identify the story, phase, actions, failed proof IDs, failure kind, and redacted screenshot paths.
Reports are immutable files under the consumer's `.schwifly/results/` directory.
Suite reports aggregate those records. Story IDs select work without a custom script.
Invalid contracts also produce reports. Existing API result fields remain available.
- The external caller receives `task-created` as the failed proof for a real app regression.
  After the app correction, the same story is certified. Suite selection returns matching aggregate counts.
- Typecheck, 13 focused result/recovery/cleanup checks, and the packed consumer check pass.
- Screenshot checks inspect the redacted DOM and masks when the real screenshot call runs.
  Pixel-byte equality proved sensitive to rendering timing, so it is not the redaction gate.

## 6. Automatic recovery and package proof

Story runs try the established route, 1 element repair, then 1 route rebuild.
Each candidate must pass fresh replay with healing disabled before replacing the route.
Failed certification preserves the prior route. Green route actions with failed proofs report the app regression without model calls.
Raw story-backed workflow commands use the same recovery path. Repair diffs remain beside the evidence.

- The independent authenticated consumer passes 9 scenarios with scripted discovery and 0 model calls.
- The live consumer passes the same scenarios with `google/gemini-3.8-flash` and 29 model calls.
  Discovery, forced model repair, and changed-route rebuilding pass. Saved-route replays use 0 calls.
- The final default is `google/gemini-3.8-flash`, a fixed model ID available through OpenRouter.
  Flash Lite connected but stopped before acting in the authenticated app. Its failure remains incomplete exploration.
- CI and the consumer CI example run browser work serially and retain reports, screenshots, and repair diffs.
- Installation, story authoring, login, reset, limits, machine results, and recovery are documented in README.md.
- Typecheck and 12 focused recovery/provider/cleanup checks passed, including nested-runner cancellation.
  The expanded full run passed 122 tests and skipped 3 live checks. Its 3 failures expected unmasked email values.
  The corrected capture and recording checks pass all 27 tests, including explicit email masking.
  Final gate and CI results belong in the PR.
