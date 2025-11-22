import asyncio
import json
import shutil
from pathlib import Path
from schwifly.runner import run_test
from schwifly.models import ProceduralConfig

async def verify_logging():
    test_id = "logging_verification_test"
    
    # Clean up previous runs
    if Path(f"procedures/{test_id}.json").exists():
        Path(f"procedures/{test_id}.json").unlink()
    
    print(f"Running test: {test_id}")
    
    # Run 1: AI Fallback (Should create Procedurals)
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

    # Verify Procedural Steps Creation
    procedural_file = Path(f"procedures/{test_id}.json")
    if procedural_file.exists():
        print("PASS: Procedural steps file created")
        with open(procedural_file, "r") as f:
            procedural_steps = json.load(f)
            print(f"Procedural steps has {len(procedural_steps)} steps")
    else:
        print("FAIL: Procedural steps file NOT created")

    # Run 2: Replay (Should use Procedurals)
    print("\nRunning Procedural Test...")   
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
    
    if report_replay.execution_method == "procedural":
        print("PASS: Used Procedural method")
    else:
        print(f"FAIL: Did not use Procedural method (Used {report_replay.execution_method})")

if __name__ == "__main__":
    asyncio.run(verify_logging())
