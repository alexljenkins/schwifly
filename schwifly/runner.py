import uuid
import json
import logging
from datetime import datetime
from typing import Dict, Any, Optional, Union, List

from schwifly.models import (
    TestResult,
    Step,
    Verdict,
    ProceduralConfig,
    EventType
)
from schwifly.config import config
from schwifly.services.telemetry import TelemetryService
from schwifly.services.validation import ValidationService
from schwifly.services.artifacts import ArtifactService
from schwifly.services.execution import ExecutionService

# Configure basic logging
logging.basicConfig(level=getattr(logging, config.LOG_LEVEL))
logger = logging.getLogger(__name__)

async def run_test(
    test_id: str,
    process: Union[str, Dict[str, Any]],
    validation: Union[str, Dict[str, Any], List[str]],
    starting_url: str,
    procedural: ProceduralConfig,
    env: Optional[str] = None,
    creds_override: Optional[Dict[str, Any]] = None,
    run_timestamp: Optional[str] = None,
    headless: Optional[bool] = None,
    auth: Optional[str] = None,
) -> TestResult:
    
    run_id = str(uuid.uuid4())
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    if run_timestamp:
        timestamp = run_timestamp
        
    full_run_id = f"{timestamp}_{run_id}"
    
    # 1. Initialize Services
    telemetry = TelemetryService(run_id=full_run_id)
    validation_service = ValidationService()
    artifact_service = ArtifactService()
    execution_service = ExecutionService(telemetry)
    
    process_str = json.dumps(process) if isinstance(process, dict) else process
    
    telemetry.log(EventType.TEST_START, {
        "test_id": test_id,
        "start_url": starting_url,
        "process_description": process_str
    }, test_id=test_id)
    
    start_time = datetime.utcnow()
    
    # 2. Execute
    headless_value = headless if headless is not None else config.HEADLESS
    steps: List[Step] = []
    
    try:
        # Try Replay (skipped for now in ExecutionService, but structure is there)
        # if procedural.use: ...
        
        # Fallback to AI
        steps = await execution_service.run_ai(
            test_id=test_id,
            process=process_str,
            starting_url=starting_url,
            creds_override=creds_override,
            headless=headless_value,
            auth=auth
        )
        
    except Exception as e:
        telemetry.error(f"Execution failed: {str(e)}", test_id=test_id)
        
    # 3. Validate
    # Extract final state (URL/Title) - TODO: ExecutionService should return this metadata
    # For now, passing None as we need to update ExecutionService to return rich result
    verdict = await validation_service.evaluate(
        rules=validation,
        steps=steps,
        final_url=None, 
        final_title=None
    )
    
    telemetry.log(EventType.VERDICT, {
        "passed": verdict.passed,
        "reasons": verdict.reasons
    }, test_id=test_id)
    
    # 4. Finalize
    end_time = datetime.utcnow()
    duration = (end_time - start_time).total_seconds()
    status = "PASS" if verdict.passed else "FAIL"
    
    telemetry.log(EventType.TEST_END, {
        "status": status,
        "duration_ms": duration * 1000
    }, test_id=test_id)
    
    result = TestResult(
        test_id=test_id,
        run_id=full_run_id,
        status=status,
        duration_sec=duration,
        steps=steps,
        verdict=verdict
    )
    
    # 5. Save Artifacts
    artifact_service.save_report(result)
    
    return result
