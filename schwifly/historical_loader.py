"""Load and manage historical test data for replay."""
import json
from pathlib import Path
from typing import List, Optional, Dict, Any
from schwifly.models import ExecutableStep
from schwifly.artifacts import load_latest_report


def load_executable_steps_from_report(report_data: Dict[str, Any]) -> List[ExecutableStep]:
    """Extract executable steps from a report dictionary."""
    executable_steps = []
    
    if "executable_steps" in report_data and report_data["executable_steps"]:
        for step_data in report_data["executable_steps"]:
            try:
                step = ExecutableStep(**step_data)
                executable_steps.append(step)
            except Exception as e:
                continue
    
    return executable_steps


def load_executable_steps_for_replay(test_id: str, excluded_run_ids: Optional[List[str]] = None) -> Optional[List[ExecutableStep]]:
    """
    Load executable steps from latest.json for replay.
    
    Args:
        test_id: Test identifier
        excluded_run_ids: List of run IDs to exclude (failed replays)
    
    Returns:
        List of ExecutableStep if available, None otherwise
    """
    report_data = load_latest_report(test_id)
    if not report_data:
        return None
    
    if excluded_run_ids and report_data.get("run_id") in excluded_run_ids:
        return None
    
    executable_steps = load_executable_steps_from_report(report_data)
    
    if not executable_steps:
        return None
    
    return executable_steps


def get_excluded_run_ids(test_id: str) -> List[str]:
    """Load list of run IDs that should be excluded from replay."""
    excluded_path = Path("artifacts") / test_id / "excluded_replays.json"
    if not excluded_path.exists():
        return []
    
    try:
        with open(excluded_path, "r") as f:
            data = json.load(f)
            return data.get("excluded_run_ids", [])
    except Exception:
        return []


def add_excluded_run_id(test_id: str, run_id: str):
    """Mark a run ID as excluded from future replays."""
    excluded_path = Path("artifacts") / test_id / "excluded_replays.json"
    excluded_path.parent.mkdir(parents=True, exist_ok=True)
    
    excluded_run_ids = get_excluded_run_ids(test_id)
    if run_id not in excluded_run_ids:
        excluded_run_ids.append(run_id)
    
    with open(excluded_path, "w") as f:
        json.dump({"excluded_run_ids": excluded_run_ids}, f, indent=2)

