from typing import List, Dict, Any, Optional
from schwifly.models import StepDiff, StepTrace
from schwifly.step_trace import normalize_step_trace


def compare_step_traces(
    current_steps: List[StepTrace],
    previous_steps: List[Dict[str, Any]],
) -> StepDiff:
    if not previous_steps:
        return StepDiff(changed=0, added=0, removed=0, details=[])
    
    current_normalized = normalize_step_trace(current_steps)
    
    previous_normalized = []
    for step in previous_steps:
        if isinstance(step, dict):
            previous_normalized.append({
                "action": step.get("action", ""),
                "target": step.get("target", ""),
                "locator": step.get("locator", ""),
                "sequence": step.get("index", step.get("sequence", 0)),
            })
        else:
            previous_normalized.append({
                "action": "",
                "target": "",
                "locator": "",
                "sequence": 0,
            })
    
    current_signatures = [
        f"{s['action']}|{s['target']}|{s['locator']}|{s['sequence']}"
        for s in current_normalized
    ]
    previous_signatures = [
        f"{s['action']}|{s['target']}|{s['locator']}|{s['sequence']}"
        for s in previous_normalized
    ]
    
    current_set = set(current_signatures)
    previous_set = set(previous_signatures)
    
    added = current_set - previous_set
    removed = previous_set - current_set
    
    changed = 0
    details = []
    
    if added:
        details.append(f"Added {len(added)} step(s)")
        for sig in list(added)[:5]:
            details.append(f"  + {sig.split('|')[0]} on {sig.split('|')[1]}")
    
    if removed:
        details.append(f"Removed {len(removed)} step(s)")
        for sig in list(removed)[:5]:
            details.append(f"  - {sig.split('|')[0]} on {sig.split('|')[1]}")
    
    if len(current_normalized) != len(previous_normalized):
        changed = abs(len(current_normalized) - len(previous_normalized))
        details.append(f"Step count changed: {len(previous_normalized)} -> {len(current_normalized)}")
    
    return StepDiff(
        changed=changed,
        added=len(added),
        removed=len(removed),
        details=details,
    )

