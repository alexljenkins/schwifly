# Schwifly

Schwifly is an AI-powered browser agent that tests the functionality of your web application or website against user stories and human-readable test cases.

## Value Proposition

- **Natural Language Testing**: Write test cases in plain English instead of code - describe what users should do and what success looks like
- **Intelligent Automation**: AI agents navigate your application like real users, adapting to UI changes without brittle selectors
- **Parallel Execution**: Run multiple tests concurrently with configurable limits for faster feedback
- **Procedural Validation**: Optionally replay and validate against previous successful test runs to catch regressions

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

That's it! Schwifly will launch a browser, execute your test, and report the results.

---

## Test Configuration

### Test File Format

Tests are defined as JSON arrays. Each test requires four essential fields:

```json
[
  {
    "test_id": "unique_identifier",
    "process": "What the test should do (user flow description)",
    "validation": "Success criteria (string or array of strings)",
    "starting_url": "https://example.com"
  }
]
```

### Field Descriptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `test_id` | string | ✓ | Unique identifier for the test (used in logs and artifacts) |
| `process` | string | ✓ | Human-readable description of the user flow or task |
| `validation` | string or array | ✓ | Criteria that must be met for the test to pass |
| `starting_url` | string | ✓ | URL where the test begins |
| `headless` | boolean | ✗ | Override headless mode for this test |
| `env` | string | ✗ | Override environment for this test |
| `procedural` | object | ✗ | Procedural test configuration (see [TEST_CONFIG.md](TEST_CONFIG.md)) |

### Example: Multiple Validation Rules

```json
[
  {
    "test_id": "login_flow",
    "process": "Log in with test credentials and verify dashboard access",
    "validation": [
      "Successfully logged in",
      "Redirected to dashboard page",
      "User profile name is visible"
    ],
    "starting_url": "https://example.com/login"
  }
]
```

---

## CLI Usage

### Basic Commands

```bash
# Run all tests in a file
schwifly run tests.json

# Run with visible browser (non-headless)
schwifly run tests.json --no-headless

# Run with procedural validation enabled
schwifly run tests.json --use-procedural

# Override environment
schwifly run tests.json --env staging

# Combine options
schwifly run tests.json --no-headless --env production
```

### CLI Options

| Option | Type | Description |
|--------|------|-------------|
| `--headless / --no-headless` | flag | Run browser in headless mode (overrides `.env`) |
| `--use-procedural / --no-use-procedural` | flag | Enable procedural test validation |
| `--env TEXT` | string | Specify environment (e.g., `staging`, `production`) |
| `--verbose / --no-verbose` | flag | Show detailed output |

---

## Configuration

### Environment Variables

Configure defaults in your `.env` file:

```bash
# Required
GOOGLE_API_KEY=your_key_here

# Browser Settings
HEADLESS=true

# Test Execution
MAX_CONCURRENT_TESTS=5
TIMEOUT_SEC=300
TEST_ENV=production

# Procedural Testing (optional)
PROCEDURAL_USE=false
PROCEDURAL_UPDATE=ai_success
PROCEDURAL_VALIDATE_AGAINST=outcome
```

### Configuration Hierarchy

Settings are applied in this order (later overrides earlier):

1. **Environment variables** (`.env` file)
2. **CLI arguments** (`--headless`, `--env`, etc.)
3. **Individual test overrides** (fields in test JSON)

For detailed configuration options, see [TEST_CONFIG.md](TEST_CONFIG.md).

---

## Output & Results

Schwifly provides:

- **Real-time progress**: See tests start and complete with pass/fail status
- **Detailed validation**: View which validation rules passed or failed
- **Summary table**: Final results with test IDs, status, and duration
- **Artifacts**: Browser recordings and test reports saved to `artifacts/` directory
- **Logs**: Detailed logs written to `schwifly_cli.log`

### Example Output

```
Running 2 tests...
Starting login_flow...
login_flow ✔ PASS
  ✔ Successfully logged in
  ✔ Redirected to dashboard page

Test Summary
┏━━━━━━━━━━━━┳━━━━━━━━┳━━━━━━━━━━━━━┓
┃ Test ID    ┃ Status ┃ Duration (s) ┃
┡━━━━━━━━━━━━╇━━━━━━━━╇━━━━━━━━━━━━━┩
│ login_flow │ PASS   │        12.34 │
└────────────┴────────┴──────────────┘
Success Rate: 1/1 (100.0%)
```

---

## Advanced Features

- **Procedural Testing**: Record successful test runs and validate future runs match the same flow
- **Parallel Execution**: Run multiple tests simultaneously with configurable concurrency limits
- **Environment Management**: Test across different environments with credential overrides
- **Rule-based Validation**: Define multiple specific validation criteria per test

For advanced usage, see [TEST_CONFIG.md](TEST_CONFIG.md).

---

## License

Copyright Alex Jenkins 2025