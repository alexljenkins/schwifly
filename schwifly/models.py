from typing import Dict, Any, List, Optional, Union, Literal
from datetime import datetime
from enum import Enum
import uuid
from pydantic import BaseModel, Field

# --- Enums ---

class StepStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    SKIPPED = "skipped"

class EventType(str, Enum):
    SUITE_START = "suite_start"
    SUITE_END = "suite_end"
    TEST_START = "test_start"
    TEST_END = "test_end"
    STEP_START = "step_start"
    STEP_END = "step_end"
    VALIDATION = "validation"
    VERDICT = "verdict"
    ERROR = "error"
    INFO = "info"

# --- Core Domain Models ---

class RuleResult(BaseModel):
    rule: str
    passed: bool
    reason: Optional[str] = None

class Step(BaseModel):
    """
    Unified Step model representing a unit of work in a test.
    Holds both the plan (action/params) and the execution result.
    """
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    index: int
    action: str
    params: Dict[str, Any] = Field(default_factory=dict)
    description: Optional[str] = None
    
    # Execution State
    status: StepStatus = StepStatus.PENDING
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    duration_ms: float = 0.0
    error: Optional[str] = None
    output: Dict[str, Any] = Field(default_factory=dict) # e.g. screenshot_path, extracted_data
    
    # Validation
    validation_results: List[RuleResult] = []

class Verdict(BaseModel):
    passed: bool
    reasons: List[str]
    rule_results: List[RuleResult] = []  # Granular per-validation results

class TestResult(BaseModel):
    """
    Final result of a test execution.
    """
    test_id: str
    run_id: str
    status: Literal["PASS", "FAIL", "ERROR"]
    duration_sec: float
    steps: List[Step] = []
    verdict: Verdict
    artifacts: Dict[str, str] = {} # path_name -> file_path
    metadata: Dict[str, Any] = {}

class ExecutionResult(BaseModel):
    """Rich result from test execution including agent output"""
    steps: List[Step] = []
    agent_output: Optional[Dict[str, Any]] = None  # Includes validations, final_url, etc.


# --- Configuration Models ---

class ProceduralConfig(BaseModel):
    use: bool
    update: Literal["always", "never", "ai_success", "changes"]
    validate_against: Optional[Literal["outcome", "exact_process"]] = None

class TestConfig(BaseModel):
    test_id: str
    process: Union[str, Dict[str, Any]]
    validation: Union[str, List[str], Dict[str, Any]]
    starting_url: str
    procedural: ProceduralConfig
    env: Optional[str] = None
    creds_override: Optional[Dict[str, Any]] = None
    auth: Optional[str] = None
    headless: Optional[bool] = None

# --- Telemetry / Event Models ---

class LogEvent(BaseModel):
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")
    run_id: str
    test_id: Optional[str] = None
    event_type: EventType
    payload: Dict[str, Any]

# --- Legacy Compatibility (Temporary) ---
# Keeping these briefly to allow incremental refactor of runner.py, 
# but they should be removed ASAP.

class StepTrace(BaseModel):
    index: int
    action: str
    data: Optional[Dict[str, Any]] = None
    timestamp: str
    duration_ms: float
    outcome: str
    error: Optional[str] = None

class ExecutableStep(BaseModel):
    action: str
    selector: Optional[str] = None
    value: Optional[str] = None
    index: int
    description: Optional[str] = None
    # Helper to convert to new Step
    def to_step(self) -> Step:
        return Step(
            index=self.index,
            action=self.action,
            params={"selector": self.selector, "value": self.value},
            description=self.description
        )

class AgentOutput(BaseModel):
    """Structured output from the agent."""
    success: bool
    validations: Dict[str, str] = {}  # {"1": "answer", "2": "answer"} for inline validation
    final_url: Optional[str] = None
    final_title: Optional[str] = None
    usability_score: int = 10
    redundant_steps: List[str] = []
    summary: str
