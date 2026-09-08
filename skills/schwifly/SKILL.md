---
name: schwifly
description: Run browser tests from instructions, inspect screenshots, and save or replay certified Schwifly workflows.
---

# Schwifly

Run browser tests from instructions, inspect evidence, and save certified workflows.

`pnpm dlx schwifly` shows workspace state. In an installed project, use `pnpm exec schwifly`.
The package must be available from the configured registry. For an unpublished checkout, build it and use its absolute bin/schwifly.js path.

- One-off runs keep evidence without saving a workflow. Add `--save <name>` to save after certification.
- Certification checks the outcome in a fresh browser with model healing disabled. A model claim is not proof.
- Instructions may be brief or detailed. State the expected visible text with `<expect>text</expect>` when possible.
- Screenshots mask form values, known secret text, and data-private regions. Inspect image files with an image tool.
- Instruction runs start in the background. Use the returned status/show commands and log path. --foreground waits.
- Use session start, then session ask for a persistent tester. session reset wipes its context. session stop closes it.
- session baseline marks the last check. session compare repeats it. session save certifies it in a fresh browser.
- Standalone runs start a fresh session. Configure app reset and login in schwifly.config.ts when the test needs them.
- Discovery and certification both act on the app. Run only within the user-authorized target and action scope.
- After a failed run, inspect `schwifly show <id>`, correct the instruction or app, then run again. Stop when the requested outcome passes.
- Setup reads keys through `--key-stdin` and stores them in the OS credential store. Use a secret manager pipe, not literal keys.
- Setup model IDs form the allowed set. `--model` selects one for a run. The OS store does not isolate same-user processes.
- Install session integration only when the user requests it.
- Default output is TOON. `--json` selects JSON. Exit codes are 0 for success, 1 for failed work, and 2 for usage errors.

```sh
pnpm dlx schwifly run "<instruction> <expect>expected visible text</expect>" --url <url>
pnpm dlx schwifly run --instruction-file <instructions.md> --url <url> --screenshots
pnpm dlx schwifly show <id>
pnpm dlx schwifly save <id> --name <name>
pnpm dlx schwifly run workflows/<name>.spec.ts
pnpm dlx schwifly session start --url <url>
pnpm dlx schwifly session ask <session-id> "Click Go. <expect>Done</expect>" --element button
pnpm dlx schwifly session ask <session-id> "Try the button again"
pnpm dlx schwifly session baseline <session-id>
pnpm dlx schwifly session compare <session-id>
pnpm dlx schwifly session save <session-id> --name <name>
```

Run a command with `--help` for its complete flags and examples.
Use `pnpm dlx schwifly setup --agent all` for live session context.
The generated skill also works alone and needs no session integration.
