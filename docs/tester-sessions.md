# Persistent tester design

The workspace owns background runs and tester sessions. IDs are UUIDs. Version 1 JSON records live under `.schwifly/`.
A detached process owns each tester browser. File requests serialize checks without exposing a second network service.
The browser exposes its existing local CDP endpoint. Reset closes the browser, clears tester memory and baselines, and starts a clean configured session.
Stop closes the browser. Evidence remains available after reset, stop, or failure.

Each request returns a run ID, status command, result command, and log path immediately.
A dead owner makes unfinished work failed. Atomic record replacement prevents partial reads.
Requests run in submission order. Browser operations retain bounded deadlines. Idle tester lifetime has no deadline.

Tester memory consists of recent requests and findings plus captured actions since the configured start.
Model comments remain opinions. Visible-text assertions and concrete actions supply verified behavior.
A baseline freezes the last interaction, its assertions, and masked element screenshots.
Comparison runs the same actions after the app setup hook and reports assertion changes and image changes separately.
Saving emits captured actions and assertions, then requires fresh replay with repair disabled before writing a workflow.

Checks cover detached process completion and failure, session reuse and reset, cropped images, comparison after an app change,
and successful and rejected regression promotion. Verification uses fake discovery and real local browser interactions without keys.

## Commands and limits

`session start --url <url>` opens a visible browser. `--headless` hides its window.
`session status <id>` exposes the local browser endpoint. `session ask <id> <instruction>` queues a check.
`session baseline`, `session compare`, `session save --name`, `session reset`, and `session stop` operate on that tester ID.
`status <run-id>` and `show <run-id>` inspect queued work. Every receipt carries the exact workspace and progress-log command.

The owner retains the last 8 requests and concise findings, all captured actions since reset, and 1 baseline.
Each check has a 120-second deadline. Saving has a 180-second deadline for fresh replay.
Checks reset the model-call budget, while an idle tester has no deadline.
The workspace permits 1 browser owner. Saving may open a fresh replay browser while the tester stays idle.

Explicit `<expect>` text supplies the outcome contract. For natural requests, the tester can propose visible text before acting.
Visual-only checks report observations without claiming a verified outcome.
The tester can measure horizontal centering and contrast against a solid element background.
Press inspection records active state, running animations, and a masked screenshot before release outside the element.
These measurements remain observations. Saved regression assertions cover visible text, not visual opinions or animation measurements.

Comparison reruns setup, replays prerequisite actions, and captures the same interaction boundary and selector.
If an element disappears after the action, the final screenshot falls back to the page and records that framing.
Supported click/fill actions preserve their exact order, including repeated clicks. Unsupported actions or secret input reject promotion.
A cancelled save cannot write a workflow after its deadline. Existing workflows always remain protected by exclusive creation.

## Delivery evidence

- The final serial suite passed 156 tests, with 3 live checks skipped.
- The final focused suite passed 26 checks, including the added dead-owner case, unchanged comparisons, secret rejection, and removed-element screenshots.
- Type checking and generated-skill checks passed.
- The installed archive passed all 11 consumer scenarios with 0 model calls.
- A live local-app demo passed discovery, visual review, press capture, comparison, repeat, and fresh workflow saving.
  The browser measured 0 pixels of horizontal offset and detected a running press animation.
  The demo changed the button color, detected changed screenshots, preserved the visible-text outcome, and stopped its tester afterward.

Live evidence remains in ignored `artifacts/tester-live/workspace/`. The cropped key-free test image was inspected directly.
The verification reporter prints final counts and failures. Complete runner output lives in `.schwifly/verification.log` and CI retains it.
