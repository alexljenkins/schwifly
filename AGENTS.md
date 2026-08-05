# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- **pnpm only.** `packageManager` in `package.json` selects it and `pnpm-lock.yaml` is the only
  lockfile (a stale `package-lock.json` pinning different versions was deleted). Install browsers
  with `pnpm exec playwright install chromium` or 8 tests fail for environment reasons.
- **Stagehand and Playwright are pinned exactly.** The `schwifly attempt` flow reads Stagehand's
  *experimental* agent evidence callbacks; their shapes are version-sensitive. Read the locked
  decisions under `### task-to-verified-flow` in [TODO.md](./TODO.md) before touching
  `src/attempt.ts` — they record the non-obvious Stagehand seams (`experimental` + `disableAPI`,
  the AI SDK result envelope, `mode: 'dom'`).
- **A green Playwright run does not mean the steps passed.** `step()` records a failed step and
  keeps going by design — the verdict table is the report, not an exception. Anything gating on
  "did this spec pass" must read the step log (`src/runLogs.ts`), as `replayGreen()` does.
- `pnpm run verify` must stay key-free: live paths belong behind injectable seams with fake
  fixtures, not behind an API key.
- Commands, architecture and roadmap live in [README.md](./README.md) and [TODO.md](./TODO.md).

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
