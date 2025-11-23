import uuid
import json
import logging
from datetime import datetime
from typing import Dict, Any, Optional, Union, List

from schwifly.models import (
    TestResult,
    Verdict,
    ProceduralConfig,
    EventType
)
from schwifly.config import config
from schwifly.services.telemetry import TelemetryService
from schwifly.services.validation import ValidationService
from schwifly.services.validation_parser import ValidationParser
from schwifly.services.validation_comparison import ValidationComparison
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
    validation_service = ValidationService()  # Legacy validation
    validation_parser = ValidationParser()  # New inline validation
    validation_comparison = ValidationComparison()  # New inline validation
    artifact_service = ArtifactService()
    execution_service = ExecutionService(telemetry)
    
    process_str = json.dumps(process) if isinstance(process, dict) else process
    
    telemetry.log(EventType.TEST_START, {
        "test_id": test_id,
        "start_url": starting_url,
        "process_description": process_str
    }, test_id=test_id)
    
    start_time = datetime.utcnow()
    
    # 2. Parse process for inline validation tags
    parsed_process = validation_parser.parse_process(process_str)
    
    # 3. Execute
    headless_value = headless if headless is not None else config.HEADLESS
    execution_result = None
    
    try:
        # Execute Test (Procedural or AI)
        execution_result = await execution_service.execute_test(
            test_id=test_id,
            process=parsed_process.modified_process,
            starting_url=starting_url,
            procedural_config=procedural,
            creds_override=creds_override,
            headless=headless_value,
            auth=auth,
            has_validations=parsed_process.has_validations
        )
    except Exception as e:
        telemetry.error(f"Execution failed: {str(e)}", test_id=test_id)

    # 4. Validate
    verdict: Verdict
    
    if parsed_process.has_validations:
        # New inline validation approach
        agent_validations = {}
        if execution_result and execution_result.agent_output:
            agent_validations = execution_result.agent_output.get("validations", {})
        
        # Compare agent responses against ground truth
        rule_results = await validation_comparison.compare(
            expected=parsed_process.validations,
            actual=agent_validations
        )
        
        # Build verdict from rule results
        all_passed = all(r.passed for r in rule_results)
        reasons = [r.reason for r in rule_results if r.reason] if not all_passed else []
        
        verdict = Verdict(
            passed=all_passed,
            reasons=reasons,
            rule_results=rule_results
        )
    else:
        # Legacy validation approach (for backward compatibility)
        steps = execution_result.steps if execution_result else []
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
    
    # 5. Finalize
    end_time = datetime.utcnow()
    duration = (end_time - start_time).total_seconds()
    status = "PASS" if verdict.passed else "FAIL"
    
    telemetry.log(EventType.TEST_END, {
        "status": status,
        "duration_ms": duration * 1000
    }, test_id=test_id)
    
    steps = execution_result.steps if execution_result else []
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
