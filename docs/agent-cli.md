# Agent CLI

The primary command is `run`. With an instruction and `--url`, it starts a bounded browser attempt.
With a workflow or story path, it replays the saved test. Runs return background IDs by default. Use `--foreground` for a final exit code. `--instruction-file` accepts detailed instructions.
One-off runs retain evidence under `.schwifly/runs/` without adding a workflow.
`--save <name>` or `save <id> --name <name>` promotes only a freshly certified candidate.
`status <id>` checks background completion. `show <id>` inspects evidence. `list` finds saved workflows. `runs` finds previous one-off runs.
`screenshot <url>` captures a page without model calls. `--screenshots` records discovery checkpoints.

Reuse the existing outcome contract and fresh replay gate. Keep story proofs and recovery unchanged.
Screenshots use the existing redaction and masking code. Model narration cannot certify a test.
One-off results own an ID, instruction, URL, status, candidate hash, and artifact paths.
The workspace owns results until it deletes `.schwifly/runs/`. Exclusive writes protect saved workflows.
Each run keeps its own candidate and evidence. Completion atomically replaces its initial running record.
Temporary replay files use `.mts` and bind imports to the active installation, so empty directories need no package manifest. The CLI serializes browser commands within a workspace.

Setup stores model IDs and their default in the user config directory. The OS credential store owns the provider key.
Keys enter setup through stdin, never command arguments. No CLI operation returns a stored key.
Runtime code reads the credential into memory without exporting it to child environments.
Existing environment credentials remain available for CI. Setup fails if the OS store is unavailable.
An OS credential store does not isolate processes running as the same user. Stronger isolation needs a separate identity or broker.

All default stdout uses TOON. JSON remains an explicit option. Usage errors exit 2, failed work exits 1, success exits 0.
The command catalog owns help and generated skill examples. CI checks the committed skill for drift.
Setup installs directory-scoped Claude Code, Codex, and OpenCode integrations only with explicit `--agent` selection.

References: [AXI](https://github.com/kunchenguid/axi), [TOON specification](https://toonformat.dev/reference/spec),
[OS credential binding](https://github.com/Brooooooklyn/keyring-node), [Claude hooks](https://code.claude.com/docs/en/hooks),
[Codex hooks](https://developers.openai.com/codex/hooks), [OpenCode plugins](https://opencode.ai/docs/plugins/).

Persistent testers retain the browser and recent requests. See [tester sessions](tester-sessions.md) for ownership and reset semantics.

## Verification

- The delivery checkpoint records the latest completed suite results.
- Focused checks cover setup, executable shadowing, path repair, symlink containment, screenshots, and session context.
- The installed archive passes all 11 consumer scenarios with 0 model calls.
- The native credential store passes a disposable write/read/delete check on this Linux host.
- Skill validation and the generated-content check pass. The captured screenshot visibly masks its input field.

Browser tests use scripted discovery and real Chromium replay. Live provider calls remain outside key-free verification.
