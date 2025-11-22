** To‑Do List: schwifly, The UI/UX Test Runner (MVP) Using FastAPI**

---

**Goals**
- Accept tasks via API, run a browser-use Agent that explores, capture the executed step flow, and return/save a JSON report.
- Pass/Fail: (1) process is possible per rules, (2) step flow matches previous run for the same test_id.

**Non‑Goals**
- No story-to-test planning.
- No screenshots (create folder, leave empty).
- No CLI.

---

**High‑Level Flow**
- Receive request → build sensitive_data from .env + request → run Agent with task and rules → capture step trace/timings/errors → evaluate rules → compare trace to previous run if test_id provided → persist artifacts → return JSON summary and save report.json.

---

**API Design**
- POST /run-test
  - Body: test_id (optional), process (string), rules (string), base_url (optional), env (optional), creds_override (optional dict).
  - Returns: status, pass/fail, duration, report_path, report_json (full), previous_run_used (bool), diff_summary.
- POST /run-bulk
  - Body: tests: [items with same fields as /run-test].
  - Returns: per-item results array with the same summary fields; each item saved as its own artifacts.

Acceptance:
- Both endpoints call the exact same internal run_test() flow; bulk loops items sequentially (MVP).

---

**Configuration & Secrets**
- .env keys: GOOGLE_API_KEY, APP_USERNAME, APP_PASSWORD, BASE_URL_DEFAULT, TIMEOUT_SEC, LOG_LEVEL.
- sensitive_data: built from .env + creds_override; never logged; always passed to Agent.sensitive_data.

Acceptance:
- Loading .env once at startup; redaction ensures secrets do not appear in logs or reports.

---

**Agent Orchestration**
- LLM: Gemini only (ChatGoogle model).
- Agent constructed with:
  - task: process string (optionally prefixed with base_url context).
  - sensitive_data: dict for credentials and any tokens.
  - speed-optimized BrowserProfile.
- Timeouts and retries: global per-run timeout; minimal retries on navigation/actions.
- Headless default true; configurable via env.

Acceptance:
- Agent run completes or times out; all actions and timings are captured into a trace.

---

**Step Trace Capture**
- Capture ordered steps performed by Agent: index, action, target/locator (if available), data (redacted), timestamp, duration, outcome, error (if any).
- Map raw Agent events into normalized step records; ensure consistent naming and redaction.

Acceptance:
- A single canonical step_trace array recorded for every run; verified non-empty when Agent performed actions.

---

**Pass/Fail Logic**
- Rule evaluation: LLM-based evaluator that reads rules + step_trace + final page/url context and returns pass:boolean, reasons[].
- Step consistency: if test_id has a previous report, compare normalized step_trace (action+semantic target+sequence) to last run.
  - Produce diff: added/removed/changed steps.
  - Fail if non-empty diff; first-ever run creates baseline (passes with baseline_created=true).

Acceptance:
- Final verdict: process_possible AND steps_match_previous; include reasons and diff_summary in report.

---

**Artifacts & Persistence**
- Directory: artifacts/{test_id or generated_id}/{timestamp}/
  - Files: report.json (full), logs/run.log, screenshots/ (empty folder for now).
  - Symlink or copy: artifacts/{id}/latest.json to the newest report.
- Console summary: [PASS|FAIL] {title or test_id} in {duration}s — report path.

Acceptance:
- Report written and accessible; console prints single-line summary; paths returned in API response.

---

**Report Schema (stored and returned)**
- run_id, test_id, inputs {process, rules, base_url, env}, agent_config, started_at, finished_at, duration_sec.
- step_trace[] (full normalized list with timings and outcomes).
- rule_evaluation {passed, reasons[]}.
- step_diff {changed: int, added: int, removed: int, details[]}, previous_run_used: bool.
- verdict {passed: bool, reasons[]}.
- artifacts {report_path, logs_path, screenshots_path}.
- errors[] (top-level unhandled errors, if any).
- redactions[] (which fields were redacted and how).

Acceptance:
- Report validates against internal schema; secrets redacted; sizes reasonable.

---

**Previous Run Lookup**
- If test_id provided, find artifacts/{test_id}/latest.json; use as baseline.
- If none, mark baseline_created: true and save latest.json.

Acceptance:
- Deterministic baseline selection; diff runs only when baseline exists.

---

**Error Handling**
- Validation errors return 400 with reasons.
- Execution errors return 200 with verdict.passed=false and errors[] in the report (MVP keeps synchronous semantics).
- Timeouts produce a clear failure reason.

Acceptance:
- No crashes; every call yields a report with a definitive pass/fail.

---

**Observability**
- Structured console logs: start/end per run, duration, pass/fail.
- Optional LOG_LEVEL via env; no secrets in logs.

Acceptance:
- Logs show concise summaries; no PII/secrets.

---

**Security**
- Redact secrets in reports/logs.
- Limit payload sizes; basic CORS for local use.
- Ignore file uploads to disk besides artifacts.

Acceptance:
- Manual review confirms no secret leakage.

---

**Testing (MVP)**
- Single-run happy path: successful login flow using .env creds; passes rules and creates baseline.
- Regression path: change process or rules to produce a step diff; fails with diff summary.
- Bulk run with 2 tests: each writes its own artifacts and returns per-item results.

Acceptance:
- Three scenarios produce expected PASS/FAIL and correct artifacts.

---

**Definition of Done**
- Both endpoints live and share one flow.
- Agent runs with Gemini and sensitive_data; step_trace captured.
- Reports saved/returned; console summary printed.
- Pass/Fail enforced via rules + step consistency; baseline behavior on first run.
- Secrets redacted; artifacts created per run.