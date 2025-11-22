import asyncio
import json
import shutil
from pathlib import Path
from schwifly.runner import run_test
from schwifly.models import ProceduralConfig

async def verify_logging():
    test_id = "logging_verification_test"
    
    # Clean up previous runs
    if Path(f"gold_standards/{test_id}.json").exists():
        Path(f"gold_standards/{test_id}.json").unlink()
    
    print(f"Running test: {test_id}")
    
    # Run 1: AI Fallback (Should create Gold Standard)
    report = await run_test(
        test_id=test_id,
        process="Navigate to https://example.com",
        validation="The title should contain 'Example'",
        starting_url="https://example.com",
        procedural=ProceduralConfig(use=True, update="always"),
        headless=True
    )
    
    print(f"Run 1 Verdict: {report.verdict.passed}")
    
    # Verify Artifacts
    run_dir = Path(report.artifacts.logs_path).parent
    events_file = run_dir / "events.jsonl"
    
    if not events_file.exists():
        print("FAIL: events.jsonl not found")
        return
        
    print(f"events.jsonl found at {events_file}")
    
    events = []
    with open(events_file, "r") as f:
        for line in f:
            events.append(json.loads(line))
            
    print(f"Logged {len(events)} events")
    
    # Check for specific events
    has_step = any(e["event_type"] == "step_executed" for e in events)
    has_validation = any(e["event_type"] == "validation" for e in events)
    has_verdict = any(e["event_type"] == "verdict" for e in events)
    
    if has_step and has_validation and has_verdict:
        print("PASS: Found expected event types")
    else:
        print(f"FAIL: Missing event types. Step: {has_step}, Validation: {has_validation}, Verdict: {has_verdict}")

    # Verify Gold Standard Creation
    gold_file = Path(f"gold_standards/{test_id}.json")
    if gold_file.exists():
        print("PASS: Gold standard file created")
        with open(gold_file, "r") as f:
            gold_steps = json.load(f)
            print(f"Gold standard has {len(gold_steps)} steps")
    else:
        print("FAIL: Gold standard file NOT created")

    # Run 2: Replay (Should use Gold Standard)
    print("\nRunning Replay Test...")
    report_replay = await run_test(
        test_id=test_id,
        process="Navigate to https://example.com",
        validation="The title should contain 'Example'",
        starting_url="https://example.com",
        procedural=ProceduralConfig(use=True, update="always"),
        headless=True
    )
    
    print(f"Run 2 Verdict: {report_replay.verdict.passed}")
    print(f"Run 2 Method: {report_replay.execution_method}")
    
    if report_replay.execution_method == "replay":
        print("PASS: Used Replay method")
    else:
        print(f"FAIL: Did not use Replay method (Used {report_replay.execution_method})")

if __name__ == "__main__":
    asyncio.run(verify_logging())
