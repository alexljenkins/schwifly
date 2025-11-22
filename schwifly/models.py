from typing import Dict, Any, List, Optional, Union, Literal
from datetime import datetime
from pydantic import BaseModel


class StepTrace(BaseModel):
    index: int
    action: str
    target: Optional[str] = None
    locator: Optional[str] = None
    data: Optional[Dict[str, Any]] = None
    timestamp: str
    duration_ms: float
    outcome: str
    error: Optional[str] = None


class ExecutableStep(BaseModel):
    """Standardized step structure for direct replay without AI."""
    action: Literal["navigate", "click", "type", "select", "wait", "scroll", "screenshot", "fill_form", "press_key"]
    selector: Optional[str] = None
    selector_type: Optional[Literal["css", "xpath", "text", "id", "name", "placeholder"]] = None
    value: Optional[str] = None
    wait_for: Optional[Literal["element", "url_change", "navigation", "timeout"]] = None
    wait_selector: Optional[str] = None
    wait_timeout_ms: int = 5000
    retry_count: int = 0
    index: int
    description: Optional[str] = None


class RuleEvaluation(BaseModel):
    passed: bool
    reasons: List[str]


class StepDiff(BaseModel):
    changed: int = 0
    added: int = 0
    removed: int = 0
    details: List[str] = []


class Verdict(BaseModel):
    passed: bool
    reasons: List[str]


class Artifacts(BaseModel):
    report_path: str
    logs_path: str
    screenshots_path: str


class HistoricalConfig(BaseModel):
    use: bool
    update: Literal["always", "never", "success", "changes"]
    validate_against: Optional[Literal["outcome", "exact_process"]] = None


class TestInputs(BaseModel):
    process: Union[str, Dict[str, Any]]
    validation: Union[str, Dict[str, Any]]
    starting_url: str
    historical: HistoricalConfig
    env: Optional[str] = None
    creds_override: Optional[Dict[str, Any]] = None


class Report(BaseModel):
    run_id: str
    test_id: Optional[str] = None
    inputs: TestInputs
    agent_config: Dict[str, Any]
    started_at: str
    finished_at: str
    duration_sec: float
    step_trace: List[StepTrace]
    executable_steps: Optional[List[ExecutableStep]] = None
    rule_evaluation: RuleEvaluation
    step_diff: StepDiff
    previous_run_used: bool = False
    replay_used: bool = False
    replay_successful: Optional[bool] = None
    execution_method: Literal["replay", "ai"] = "ai"
    verdict: Verdict
    artifacts: Artifacts
    errors: List[str] = []
    redactions: List[str] = []


class RunTestRequest(BaseModel):
    test_id: str
    process: Union[str, Dict[str, Any]]
    validation: Union[str, Dict[str, Any]]
    starting_url: str
    historical: HistoricalConfig
    env: Optional[str] = None
    creds_override: Optional[Dict[str, Any]] = None
    headless: Optional[bool] = None


class RunTestResponse(BaseModel):
    status: str
    passed: bool
    duration: float
    report_path: str
    report_json: Optional[Report] = None
    previous_run_used: bool
    diff_summary: StepDiff


class BulkTestItem(BaseModel):
    test_id: str
    process: Union[str, Dict[str, Any]]
    validation: Union[str, Dict[str, Any]]
    starting_url: str
    historical: HistoricalConfig
    env: Optional[str] = None
    creds_override: Optional[Dict[str, Any]] = None
    headless: Optional[bool] = None


class RunBulkRequest(BaseModel):
    tests: List[BulkTestItem]


class RunBulkResponse(BaseModel):
    results: List[RunTestResponse]

