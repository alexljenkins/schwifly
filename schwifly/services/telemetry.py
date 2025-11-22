
from pathlib import Path
from typing import Any, Dict, List, Optional, Protocol
from datetime import datetime
from rich.console import Console
from rich.theme import Theme
from schwifly.models import LogEvent, EventType

# Custom theme for Schwifly
custom_theme = Theme({
    "info": "dim cyan",
    "warning": "yellow",
    "error": "bold red",
    "success": "bold green",
    "step": "cyan",
    "timestamp": "dim white"
})

console = Console(theme=custom_theme)

class LogSink(Protocol):
    def emit(self, event: LogEvent):
        ...

class FileSink:
    def __init__(self, file_path: Path):
        self.file_path = file_path
        self.file_path.parent.mkdir(parents=True, exist_ok=True)
        if not self.file_path.exists():
            self.file_path.touch()

    def emit(self, event: LogEvent):
        with open(self.file_path, "a", encoding="utf-8") as f:
            f.write(event.model_dump_json() + "\n")

class RichConsoleSink:
    def emit(self, event: LogEvent):
        timestamp = datetime.fromisoformat(event.timestamp.replace("Z", "+00:00")).strftime("%H:%M:%S")
        prefix = f"[{timestamp}]"
        
        if event.test_id:
            prefix += f" [{event.test_id}]"
            
        self._print_event(prefix, event)

    def _print_event(self, prefix: str, event: LogEvent):
        payload = event.payload
        etype = event.event_type
        
        if etype == EventType.STEP_END:
            outcome = payload.get("outcome", "unknown")
            action = payload.get("action", "unknown")
            style = "success" if outcome == "success" else "error"
            console.print(f"{prefix} [{style}][{outcome.upper()}][/{style}] {action}")
            if payload.get("error"):
                console.print(f"    [error]Error: {payload.get('error')}[/error]")
            
        elif etype == EventType.VERDICT:
            passed = payload.get("passed", False)
            style = "success" if passed else "error"
            status = "PASSED" if passed else "FAILED"
            console.print(f"{prefix} [{style}]Test Verdict: {status}[/{style}]")
            if payload.get("reasons"):
                for reason in payload.get("reasons"):
                    console.print(f"    - {reason}")
            
        elif etype == EventType.ERROR:
            console.print(f"{prefix} [error]ERROR: {payload.get('message')}[/error]")
            
        elif etype == EventType.INFO:
            console.print(f"{prefix} [info]{payload.get('message')}[/info]")
            
        elif etype == EventType.TEST_START:
            console.print(f"{prefix} [magenta]Starting Test: {payload.get('process_description')}[/magenta]")
            
        elif etype == EventType.TEST_END:
            status = payload.get("status", "UNKNOWN")
            style = "success" if status == "PASS" else "error"
            duration = payload.get("duration_ms", 0) / 1000
            console.print(f"{prefix} [{style}][{status}] Finished Test in {duration:.2f}s[/{style}]")

class TelemetryService:
    def __init__(self, run_id: str, log_dir: Path = Path("artifacts")):
        self.run_id = run_id
        self.log_file = log_dir / run_id / "events.jsonl"
        self.sinks: List[LogSink] = [
            FileSink(self.log_file),
            RichConsoleSink()
        ]
        
    def log(self, event_type: EventType, payload: Dict[str, Any], test_id: Optional[str] = None):
        event = LogEvent(
            run_id=self.run_id,
            test_id=test_id,
            event_type=event_type,
            payload=payload
        )
        for sink in self.sinks:
            sink.emit(event)

    def step_start(self, step_id: str, action: str, test_id: Optional[str] = None):
        self.log(EventType.STEP_START, {"step_id": step_id, "action": action}, test_id)

    def step_end(self, step_id: str, action: str, outcome: str, duration_ms: float, error: Optional[str] = None, test_id: Optional[str] = None):
        self.log(EventType.STEP_END, {
            "step_id": step_id, 
            "action": action, 
            "outcome": outcome, 
            "duration_ms": duration_ms,
            "error": error
        }, test_id)

    def info(self, message: str, test_id: Optional[str] = None):
        self.log(EventType.INFO, {"message": message}, test_id)

    def error(self, message: str, test_id: Optional[str] = None):
        self.log(EventType.ERROR, {"message": message}, test_id)
