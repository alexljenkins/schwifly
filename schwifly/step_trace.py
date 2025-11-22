import time
from typing import List, Dict, Any, Optional
from datetime import datetime
from schwifly.models import StepTrace


class StepTraceCapture:
    def __init__(self):
        self.steps: List[StepTrace] = []
        self.start_time = time.perf_counter()
        self.step_start_time: Optional[float] = None
    
    def start_step(self):
        self.step_start_time = time.perf_counter()
    
    def add_step(
        self,
        action: str,
        target: Optional[str] = None,
        locator: Optional[str] = None,
        data: Optional[Dict[str, Any]] = None,
        outcome: str = "success",
        error: Optional[str] = None,
    ):
        if self.step_start_time is None:
            self.step_start_time = self.start_time
        
        duration_ms = (time.perf_counter() - self.step_start_time) * 1000
        timestamp = datetime.utcnow().isoformat() + "Z"
        
        step = StepTrace(
            index=len(self.steps),
            action=action,
            target=target,
            locator=locator,
            data=data,
            timestamp=timestamp,
            duration_ms=duration_ms,
            outcome=outcome,
            error=error,
        )
        
        self.steps.append(step)
        self.step_start_time = None
    
    def get_trace(self) -> List[StepTrace]:
        return self.steps


def normalize_step_trace(steps: List[StepTrace]) -> List[Dict[str, Any]]:
    normalized = []
    for step in steps:
        normalized.append({
            "action": step.action,
            "target": step.target or "",
            "locator": step.locator or "",
            "sequence": step.index,
        })
    return normalized

