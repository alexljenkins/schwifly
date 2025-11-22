# Schwifly

Schwifly is an AI-powered browser agent that tests the functionality of your web application or website against user stories and human-readable test cases.

## Value Proposition

- **Natural Language Testing**: Write test cases in plain English instead of code - describe what users should do and what success looks like
- **Intelligent Automation**: AI agents navigate your application like real users, adapting to UI changes without brittle selectors
- **Modular Architecture**: Built on a robust service-oriented architecture (Execution, Validation, Telemetry) for reliability and scalability
- **Unified Observability**: Real-time, rich console output and comprehensive JSON reports powered by a unified telemetry pipeline

## Use Cases

- **Regression Testing**: Validate critical user flows (login, checkout, navigation) haven't broken after deployments
- **CI/CD Integration**: Run automated UX tests in your pipeline to catch issues before production
- **Cross-Environment Testing**: Test the same flows across staging, production, or different environments with credential overrides
- **Usability Validation**: Verify that user stories and acceptance criteria are actually achievable in your application

---

## Installation

### Prerequisites

- Python 3.12+
- Poetry (for dependency management)

### Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd schwifly
   ```

2. **Install dependencies**
   ```bash
   poetry install
   ```

3. **Install Playwright browsers**
   ```bash
   poetry run playwright install
   ```

4. **Configure environment variables**
   
   Create a `.env` file in the project root:
   ```bash
   GOOGLE_API_KEY=your_google_api_key_here
   HEADLESS=true
   MAX_CONCURRENT_TESTS=5
   TIMEOUT_SEC=300
   ```

---

## Quick Start

### 1. Create a Test File

Create a `tests.json` file with your test definitions:

```json
[
  {
    "test_id": "homepage_load",
    "process": "Navigate to the homepage and verify it loads successfully",
    "validation": [
      "Page title contains 'Welcome'",
      "No error messages are displayed"
    ],
    "starting_url": "https://example.com"
  }
]
```

### 2. Run Your Tests

```bash
# Activate the Poetry shell
poetry shell

# Run tests
schwifly run tests.json
```

That's it! Schwifly will launch a browser, execute your test using AI agents, and report the results in real-time.

---

## Architecture

Schwifly is built on a modern, modular architecture designed for maintainability and extensibility:

- **Execution Service**: Orchestrates AI agents and procedural replay (coming soon) to perform test steps.
- **Validation Service**: Uses LLMs to evaluate test outcomes against natural language rules.
- **Telemetry Service**: A unified pipeline that streams events to the console (via Rich) and file logs.
- **Artifact Service**: Manages the storage of test reports, screenshots, and logs.
- **Unified Data Models**: Uses a standardized `Step` model throughout the lifecycle, ensuring consistency from execution to reporting.

---

## CLI Usage

### Basic Commands

```bash
# Run all tests in a file
schwifly run tests.json

# Run with visible browser (non-headless)
schwifly run tests.json --no-headless

# Run with procedural validation enabled
schwifly run tests.json --procedural

# Override environment
schwifly run tests.json --env staging
```

### CLI Options

| Option | Type | Description |
|--------|------|-------------|
| `--headless / --no-headless` | flag | Run browser in headless mode (overrides `.env`) |
| `--procedural / --no-procedural` | flag | Enable procedural test validation |
| `--env TEXT` | string | Specify environment (e.g., `staging`, `production`) |

---

## Output & Results

Schwifly provides a premium CLI experience powered by `rich`:

- **Real-time Streaming**: Watch steps execute live with color-coded status.
- **Detailed Verdicts**: See exactly which validation rules passed or failed.
- **Summary Table**: A clean final summary of all tests run.
- **Artifacts**: JSON reports and logs saved to `artifacts/<run_id>/`.

### Example Output

```
Running 1 tests...
[10:00:01] [login_flow] [magenta]Starting Test: Log in and verify dashboard[/magenta]
[10:00:05] [login_flow] [success][SUCCESS][/success] navigate
[10:00:08] [login_flow] [success][SUCCESS][/success] fill_form
[10:00:12] [login_flow] [success][SUCCESS][/success] click
[10:00:15] [login_flow] [success]Test Verdict: PASSED[/success]
[10:00:15] [login_flow] [success][PASS] Finished Test in 14.20s[/success]

Test Summary
┏━━━━━━━━━━━━┳━━━━━━━━┳━━━━━━━━━━━━━┓
┃ Test ID    ┃ Status ┃ Duration (s) ┃
┡━━━━━━━━━━━━╇━━━━━━━━╇━━━━━━━━━━━━━┩
│ login_flow │ PASS   │        14.20 │
└────────────┴────────┴──────────────┘
Success Rate: 1/1 (100.0%)
```

---

## License

Copyright Alex Jenkins 2025