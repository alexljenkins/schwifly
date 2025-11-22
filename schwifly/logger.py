
from typing import List, Optional, Any, Protocol, Dict
from pathlib import Path
from datetime import datetime
from termcolor import colored

from schwifly.models import (
    LogEvent, 
    EventType, 
    StepExecutedPayload, 
    ValidationPayload, 
    VerdictPayload, 
    ErrorPayload, 
    InfoPayload,
    TestStartPayload,
    TestEndPayload
)


class LogSink(Protocol):
    def emit(self, event: LogEvent):
        ...


class FileSink:
    def __init__(self, file_path: Path):
        self.file_path = file_path
        self.file_path.parent.mkdir(parents=True, exist_ok=True)
        # Ensure file exists
        if not self.file_path.exists():
            self.file_path.touch()

    def emit(self, event: LogEvent):
        with open(self.file_path, "a", encoding="utf-8") as f:
            f.write(event.model_dump_json() + "\n")


class ConsoleSink:
    def emit(self, event: LogEvent):
        timestamp = datetime.fromisoformat(event.timestamp.replace("Z", "+00:00")).strftime("%H:%M:%S")
        prefix = colored(f"[{timestamp}]", "grey")
        
        if event.test_id:
            prefix += colored(f" [{event.test_id}]", "blue")
            
        message = ""
        
        if event.event_type == EventType.STEP_EXECUTED:
            payload: StepExecutedPayload = event.payload
            outcome_color = "green" if payload.outcome == "success" else "red"
            action_str = colored(payload.action, "cyan")
            message = f"{action_str} - {payload.outcome}"
            if payload.params:
                # Simplify params for display
                params_str = ", ".join(f"{k}={v}" for k, v in payload.params.items() if k != "screenshot_base64")
                if len(params_str) > 50:
                    params_str = params_str[:47] + "..."
                message += f" ({params_str})"
            message = colored(message, outcome_color)
            
        elif event.event_type == EventType.VALIDATION:
            payload: ValidationPayload = event.payload
            status = colored("PASS", "green") if payload.passed else colored("FAIL", "red")
            message = f"Validation [{payload.check_type}]: {payload.description} -> {status}"
            if not payload.passed:
                message += f" (Expected: {payload.expected}, Actual: {payload.actual})"
                
        elif event.event_type == EventType.VERDICT:
            payload: VerdictPayload = event.payload
            status = colored("PASSED", "green", attrs=["bold"]) if payload.passed else colored("FAILED", "red", attrs=["bold"])
            message = f"Test Verdict: {status}"
            if payload.reasons:
                message += f"\n  Reasons: {', '.join(payload.reasons)}"
                
        elif event.event_type == EventType.ERROR:
            payload: ErrorPayload = event.payload
            message = colored(f"ERROR: {payload.message}", "red", attrs=["bold"])
            
        elif event.event_type == EventType.INFO:
            payload: InfoPayload = event.payload
            message = f"{payload.message}"
            if payload.data:
                message += f" {payload.data}"
                
        elif event.event_type == EventType.TEST_START:
            payload: TestStartPayload = event.payload
            message = colored(f"Starting Test: {payload.process_description} ({payload.start_url})", "magenta", attrs=["bold"])
            
        elif event.event_type == EventType.TEST_END:
            payload: TestEndPayload = event.payload
            color = "green" if payload.status == "PASS" else "red"
            message = colored(f"Finished Test: {payload.status} in {payload.duration_ms/1000:.2f}s", color, attrs=["bold"])
            
        elif event.event_type == EventType.SUITE_START:
            message = colored("=== Schwifly Test Suite Started ===", "white", attrs=["bold", "underline"])
            
        elif event.event_type == EventType.SUITE_END:
            message = colored("=== Schwifly Test Suite Ended ===", "white", attrs=["bold", "underline"])

        if message:
            print(f"{prefix} {message}")


class EventLogger:
    def __init__(self, run_id: str, log_dir: Path = Path("artifacts")):
        self.run_id = run_id
        self.log_file = log_dir / run_id / "events.jsonl"
        self.sinks: List[LogSink] = [
            FileSink(self.log_file),
            ConsoleSink()
        ]
        
    def log(self, event_type: EventType, payload: Any, test_id: Optional[str] = None):
        event = LogEvent(
            run_id=self.run_id,
            test_id=test_id,
            event_type=event_type,
            payload=payload
        )
        for sink in self.sinks:
            sink.emit(event)

    # Convenience methods
    def step(self, action: str, params: Dict[str, Any], duration_ms: float, outcome: str, error: Optional[str] = None, test_id: Optional[str] = None):
        payload = StepExecutedPayload(
            action=action,
            params=params,
            duration_ms=duration_ms,
            outcome=outcome,
            error=error
        )
        self.log(EventType.STEP_EXECUTED, payload, test_id)

    def validation(self, check_type: str, description: str, expected: Any, actual: Any, passed: bool, test_id: Optional[str] = None):
        payload = ValidationPayload(
            check_type=check_type,
            description=description,
            expected=expected,
            actual=actual,
            passed=passed
        )
        self.log(EventType.VALIDATION, payload, test_id)

    def verdict(self, passed: bool, reasons: List[str], test_id: Optional[str] = None):
        payload = VerdictPayload(passed=passed, reasons=reasons)
        self.log(EventType.VERDICT, payload, test_id)

    def error(self, message: str, stack_trace: Optional[str] = None, test_id: Optional[str] = None):
        payload = ErrorPayload(message=message, stack_trace=stack_trace)
        self.log(EventType.ERROR, payload, test_id)

    def info(self, message: str, data: Optional[Dict[str, Any]] = None, test_id: Optional[str] = None):
        payload = InfoPayload(message=message, data=data)
        self.log(EventType.INFO, payload, test_id)

    def test_start(self, test_id: str, start_url: str, process_description: str):
        payload = TestStartPayload(test_id=test_id, start_url=start_url, process_description=process_description)
        self.log(EventType.TEST_START, payload, test_id)

    def test_end(self, test_id: str, status: str, duration_ms: float):
        payload = TestEndPayload(test_id=test_id, status=status, duration_ms=duration_ms)
        self.log(EventType.TEST_END, payload, test_id)
