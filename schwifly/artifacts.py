import json
import shutil
from pathlib import Path
from typing import Dict, Any, Optional, Literal
from schwifly.models import Report, Verdict, StepDiff
from schwifly.secrets import redact_dict


def ensure_artifacts_dir(test_id: str) -> Path:
    artifacts_base = Path("artifacts")
    test_dir = artifacts_base / test_id
    test_dir.mkdir(parents=True, exist_ok=True)
    
    (test_dir / "logs").mkdir(exist_ok=True)
    (test_dir / "screenshots").mkdir(exist_ok=True)
    
    return test_dir


def save_report(
    report: Report, 
    test_id: str, 
    timestamp: str, 
    update_mode: Literal["always", "never", "success", "changes"],
    verdict: Verdict,
    step_diff: StepDiff,
    logs_path: Path,
) -> Dict[str, str]:
    """
    Save report to timestamped file and optionally update latest.json and latest.log.
    
    Args:
        report: The report to save
        test_id: Test identifier
        timestamp: Timestamp string for the report file
        update_mode: When to update latest.json and latest.log:
            - "always": Always update latest files
            - "never": Never update latest files
            - "success": Only update when validation was successful (verdict.passed is True)
            - "changes": Only update when steps have changed (step_diff has changes)
        verdict: The verdict from the test run
        step_diff: The step diff comparing to previous run
        logs_path: Path to the log file (located in artifacts/ directory)
    
    Returns:
        Dictionary with paths to saved artifacts
    """
    test_dir = ensure_artifacts_dir(test_id)
    
    timestamped_dir = test_dir / timestamp
    timestamped_dir.mkdir(exist_ok=True)
    
    report_path = timestamped_dir / "report.json"
    screenshots_path = timestamped_dir / "screenshots"
    screenshots_path.mkdir(parents=True, exist_ok=True)
    
    report_dict = report.model_dump()
    redacted_report, redactions = redact_dict(report_dict)
    
    with open(report_path, "w") as f:
        json.dump(redacted_report, f, indent=2)
    
    should_update = False
    if update_mode == "always":
        should_update = True
    elif update_mode == "never":
        should_update = False
    elif update_mode == "success":
        should_update = verdict.passed
    elif update_mode == "changes":
        has_changes = step_diff.changed > 0 or step_diff.added > 0 or step_diff.removed > 0
        should_update = has_changes
    
    if should_update:
        latest_json_path = Path("artifacts") / test_id / "latest.json"
        latest_json_path.parent.mkdir(parents=True, exist_ok=True)
        with open(latest_json_path, "w") as f:
            json.dump(redacted_report, f, indent=2)
        
        latest_log_path = Path("artifacts") / "latest.log"
        if logs_path.exists():
            shutil.copy2(logs_path, latest_log_path)
    
    return {
        "report_path": str(report_path),
        "logs_path": str(logs_path),
        "screenshots_path": str(screenshots_path),
    }


def load_latest_report(test_id: str) -> Optional[Dict[str, Any]]:
    latest_path = Path("artifacts") / test_id / "latest.json"
    if not latest_path.exists():
        return None
    
    with open(latest_path, "r") as f:
        return json.load(f)

