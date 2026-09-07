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
