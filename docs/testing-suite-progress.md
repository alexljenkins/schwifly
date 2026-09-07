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
- The default is `google/gemini-3.5-flash-lite`, a fixed catalog ID.
- Live discovery plus forced `observe()` repair passed with 7 model calls. Fresh replay made 0 calls.
- `openai/gpt-5.4-nano` connected but did not satisfy the discovery contract within 5 steps.
  This is incomplete exploration, not evidence that the app cannot satisfy the story.
- Key-free transport tests verify HTTP 401, 402, and 429 each make 1 request and return a safe error.
- Each model request has a 30-second deadline. Each session allows at most 36 calls with no automatic provider retries.
- Typecheck and 7 focused checks pass. Live checks require `SCHWIFLY_LIVE=1` and stay outside key-free verification.
- Installed versions: Stagehand 3.7.1, Playwright 1.61.1, TypeScript 5.9.3, tsx 4.23.1.
- Configuration follows [OpenRouter's chat endpoint](https://openrouter.ai/docs/quickstart)
  and [Stagehand model configuration](https://docs.stagehand.dev/v3/configuration/models).
