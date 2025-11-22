import uuid
import logging
import json
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional, Union, List
from schwifly.models import (
    Report,
    TestInputs,
    StepTrace,
    ExecutableStep,
    StepDiff,
    Verdict,
    Artifacts,
    ProceduralConfig,
    StepExecutedPayload
)
from schwifly.config import config
from schwifly.secrets import build_sensitive_data
from schwifly.agent_orchestration import run_agent, build_task
from schwifly.step_replay import replay_steps
from schwifly.step_converter import convert_step_traces_to_executable
from schwifly.rule_evaluation import evaluate_rules
from schwifly.logger import EventLogger

# We still configure basic logging for non-test related output if needed, 
# but mostly we rely on EventLogger now.
logging.basicConfig(level=getattr(logging, config.LOG_LEVEL))
logger = logging.getLogger(__name__)


def load_gold_standard(test_id: str) -> Optional[List[ExecutableStep]]:
    """Load gold standard steps for a test."""
    path = Path(f"gold_standards/{test_id}.json")
    if path.exists():
        try:
            with open(path, "r") as f:
                data = json.load(f)
                return [ExecutableStep(**step) for step in data]
        except Exception as e:
            logger.error(f"Failed to load gold standard for {test_id}: {e}")
    return None


def save_gold_standard(test_id: str, steps: List[ExecutableStep]):
    """Save gold standard steps for a test."""
    path = Path(f"gold_standards/{test_id}.json")
    path.parent.mkdir(exist_ok=True)
    with open(path, "w") as f:
        json.dump([step.model_dump() for step in steps], f, indent=2)


async def run_test(
    test_id: str,
    process: Union[str, Dict[str, Any]],
    validation: Union[str, Dict[str, Any]],
    starting_url: str,
    procedural: ProceduralConfig,
    env: Optional[str] = None,
    creds_override: Optional[Dict[str, Any]] = None,
    run_timestamp: Optional[str] = None,
    headless: Optional[bool] = None,
    auth: Optional[str] = None,
) -> Report:
    run_id = str(uuid.uuid4())
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    started_at = datetime.utcnow().isoformat() + "Z"
    
    if run_timestamp is None:
        run_timestamp = timestamp
        
    # Initialize EventLogger
    # Note: We use run_id for the folder, but we might want to group by timestamp if running multiple tests in a suite.
    # For now, following the plan: artifacts/<run_id>/events.jsonl
    event_logger = EventLogger(run_id=f"{run_timestamp}_{run_id}")
    
    process_str = json.dumps(process) if isinstance(process, dict) else process
    validation_str = json.dumps(validation) if isinstance(validation, dict) else validation
    
    event_logger.test_start(test_id, starting_url, process_str)
    
    headless_value = headless if headless is not None else config.HEADLESS
    
    # --- 1. Load Gold Standard ---
    gold_steps = load_gold_standard(test_id)
    
    replay_used = False
    replay_successful = False
    execution_method = "ai"
    executed_steps: List[StepExecutedPayload] = []
    final_url = None
    final_title = None
    errors = []
    
    # --- 2. Replay (if available) ---
    if procedural.use and gold_steps:
        event_logger.info("Attempting replay with gold standard steps", test_id=test_id)
        replay_used = True
        execution_method = "replay"
        
        # We need to capture steps as they happen. 
        # The replay engine now emits events to the logger.
        # We also want to keep track of them for validation/updates.
        # Since the logger writes to file/console, we need a way to get the steps back or accumulate them.
        # For simplicity, we'll rely on the fact that we have the gold_steps, 
        # BUT strictly speaking we should verify what actually happened.
        # The ReplayEngine emits events, but doesn't return the list of payloads.
        # We can reconstruct them or trust the result.
        
        replay_result = await replay_steps(
            steps=gold_steps,
            starting_url=starting_url,
            headless=headless_value,
            event_logger=event_logger,
            test_id=test_id
        )
        
        final_url = replay_result.get("final_url")
        final_title = replay_result.get("final_title")
        
        if replay_result["success"]:
            replay_successful = True
            event_logger.info("Replay successful", test_id=test_id)
            # For validation, we assume the steps executed were the gold steps (mostly)
            # We'll convert gold_steps to StepExecutedPayload for validation context if needed
            # executed_steps = ... (omitted for brevity, we'll rely on final state mostly)
        else:
            replay_successful = False
            error_msg = replay_result.get("error", "Unknown replay error")
            event_logger.error(f"Replay failed: {error_msg}", test_id=test_id)
            errors.append(error_msg)
            execution_method = "ai" # Fallback
    
    # --- 3. AI Fallback ---
    if not replay_used or not replay_successful:
        if replay_used:
            event_logger.info("Falling back to AI Agent", test_id=test_id)
        
        sensitive_data = build_sensitive_data(creds_override)
        task = build_task(process_str, starting_url)
        
        agent_result = await run_agent(
            task=task,
            sensitive_data=sensitive_data,
            timeout_sec=config.TIMEOUT_SEC,
            headless=headless_value,
            auth=auth,
            event_logger=event_logger,
            test_id=test_id
        )
        
        final_url = agent_result.get("final_url")
        final_title = agent_result.get("final_title")
        
        if agent_result["error"]:
            error_msg = agent_result["error"]
            event_logger.error(f"AI Agent failed: {error_msg}", test_id=test_id)
            errors.append(error_msg)
        
        # Extract steps from history for potential gold standard update
        if agent_result.get("history"):
            # We need to reconstruct StepExecutedPayload list from history for conversion
            # This duplicates logic in run_agent logging, but we need the objects here.
            for item in agent_result["history"]:
                try:
                    model_output = getattr(item, "model_output", None)
                    if model_output:
                        actions = []
                        if hasattr(model_output, "action") and model_output.action:
                            actions = model_output.action
                        elif isinstance(model_output, dict) and "action" in model_output:
                            actions = model_output["action"]
                        
                        for action_item in actions:
                            action_dict = {}
                            if hasattr(action_item, "model_dump"):
                                action_dict = action_item.model_dump()
                            elif isinstance(action_item, dict):
                                action_dict = action_item
                            
                            for action_name, params in action_dict.items():
                                if action_name == "done":
                                    continue
                                executed_steps.append(StepExecutedPayload(
                                    action=action_name,
                                    params=params if isinstance(params, dict) else {"value": params},
                                    duration_ms=0,
                                    outcome="success"
                                ))
                except Exception:
                    pass

    # --- 4. Validation ---
    # We need to pass steps to validation. 
    # If replay was used, we should pass gold_steps (converted).
    # If AI was used, we pass executed_steps.
    
    validation_steps = []
    if execution_method == "replay" and replay_successful:
        # Convert ExecutableStep to StepExecutedPayload-like for validation
        for step in gold_steps:
            validation_steps.append(StepExecutedPayload(
                action=step.action,
                params={"selector": step.selector, "value": step.value},
                duration_ms=0,
                outcome="success"
            ))
    else:
        validation_steps = executed_steps
        
    rule_evaluation = await evaluate_rules(
        rules=validation_str,
        step_trace=validation_steps,
        final_url=final_url,
        final_title=final_title,
    )
    
    # Log validation results
    for result in rule_evaluation.rule_results:
        event_logger.validation(
            check_type="content", # Generic for now
            description=result.rule,
            expected="pass",
            actual="pass" if result.passed else "fail",
            passed=result.passed,
            test_id=test_id
        )
    
    passed = rule_evaluation.passed
    reasons = rule_evaluation.reasons
    
    event_logger.verdict(passed, reasons, test_id=test_id)
    
    # --- 5. Update Gold Standard ---
    if passed and execution_method == "ai" and executed_steps:
        should_update = False
        if procedural.update == "always":
            should_update = True
        elif procedural.update == "ai_success":
            should_update = True
        # "changes" logic omitted for simplicity, treating as success for now
        
        if should_update:
            new_gold_steps = convert_step_traces_to_executable(executed_steps)
            if new_gold_steps:
                save_gold_standard(test_id, new_gold_steps)
                event_logger.info("Updated Gold Standard", test_id=test_id)

    finished_at = datetime.utcnow().isoformat() + "Z"
    duration_sec = (datetime.fromisoformat(finished_at.replace("Z", "+00:00")) - 
                   datetime.fromisoformat(started_at.replace("Z", "+00:00"))).total_seconds()
                   
    status = "PASS" if passed else "FAIL"
    event_logger.test_end(test_id, status, duration_sec * 1000)
    
    # Construct legacy Report object for compatibility
    # We map what we can.
    
    # Convert executed_steps to StepTrace for report
    step_trace_list = []
    for i, s in enumerate(validation_steps):
        step_trace_list.append(StepTrace(
            index=i,
            action=s.action,
            data=s.params,
            timestamp=started_at, # Approx
            duration_ms=s.duration_ms,
            outcome=s.outcome,
            error=s.error
        ))

    report = Report(
        run_id=run_id,
        test_id=test_id,
        inputs=TestInputs(
            process=process,
            validation=validation,
            starting_url=starting_url,
            procedural=procedural,
            env=env,
            creds_override=creds_override,
            auth=auth,
        ),
        agent_config={"headless": headless_value},
        started_at=started_at,
        finished_at=finished_at,
        duration_sec=duration_sec,
        step_trace=step_trace_list,
        executable_steps=gold_steps, # Or new ones
        rule_evaluation=rule_evaluation,
        step_diff=StepDiff(), # Not calculating diffs right now
        previous_run_used=replay_used,
        replay_used=replay_used,
        replay_successful=replay_successful,
        execution_method=execution_method,
        verdict=Verdict(passed=passed, reasons=reasons),
        artifacts=Artifacts(
            report_path=str(Path("artifacts") / f"{run_timestamp}_{run_id}" / "report.json"),
            logs_path=str(event_logger.log_file),
            screenshots_path="",
        ),
        errors=errors,
        redactions=[],
    )
    
    # Save report.json as summary
    report_path = Path("artifacts") / f"{run_timestamp}_{run_id}" / "report.json"
    with open(report_path, "w") as f:
        f.write(report.model_dump_json(indent=2))
        
    return report
