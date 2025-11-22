import uuid
import time
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
    RuleEvaluation,
    StepDiff,
    Verdict,
    Artifacts,
    HistoricalConfig,
)
from schwifly.config import config
from schwifly.secrets import build_sensitive_data, redact_dict
from schwifly.agent_orchestration import run_agent, build_task
from schwifly.step_trace import StepTraceCapture
from schwifly.step_replay import replay_steps
from schwifly.step_converter import convert_step_traces_to_executable
from schwifly.historical_loader import (
    load_executable_steps_for_replay,
    get_excluded_run_ids,
    add_excluded_run_id,
)
from schwifly.rule_evaluation import evaluate_rules
from schwifly.step_comparison import compare_step_traces
from schwifly.artifacts import save_report, load_latest_report, ensure_artifacts_dir


logging.basicConfig(level=getattr(logging, config.LOG_LEVEL))
logger = logging.getLogger(__name__)


async def run_test(
    test_id: str,
    process: Union[str, Dict[str, Any]],
    validation: Union[str, Dict[str, Any]],
    starting_url: str,
    historical: HistoricalConfig,
    env: Optional[str] = None,
    creds_override: Optional[Dict[str, Any]] = None,
    run_timestamp: Optional[str] = None,
    headless: Optional[bool] = None,
    auth: Optional[str] = None,
) -> Report:
    run_id = str(uuid.uuid4())
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    started_at = datetime.utcnow().isoformat() + "Z"
    
    headless_value = headless if headless is not None else config.HEADLESS
    
    test_dir = ensure_artifacts_dir(test_id)
    
    if run_timestamp is None:
        run_timestamp = timestamp
    
    artifacts_base = Path("artifacts")
    artifacts_base.mkdir(exist_ok=True)
    # Setup logging with test-specific logger
    log_file = test_dir / "schwifly.log"
    file_handler = logging.FileHandler(log_file)
    file_handler.setLevel(logging.INFO)
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    file_handler.setFormatter(formatter)
    
    # Create test-specific logger
    test_logger = logging.getLogger(f"schwifly.{test_id}")
    test_logger.setLevel(logging.INFO)
    test_logger.addHandler(file_handler)
    
    # Also configure base schwifly logger for setup messages
    schwifly_logger = logging.getLogger("schwifly")
    schwifly_logger.setLevel(logging.INFO)
    schwifly_logger.addHandler(file_handler)
    
    root_logger = logging.getLogger()
    root_logger.addHandler(file_handler)
    
    errors = []
    step_trace_capture = StepTraceCapture()
    executable_steps: Optional[List[ExecutableStep]] = None
    replay_used = False
    replay_successful: Optional[bool] = None
    execution_method = "ai"
    
    process_str = json.dumps(process) if isinstance(process, dict) else process
    validation_str = json.dumps(validation) if isinstance(validation, dict) else validation
    
    try:
        agent_result = None
        agent_result = None
        step_trace: List[StepTrace] = []
        usability_score = None
        redundant_steps = []
        
        if historical.use:
            excluded_run_ids = get_excluded_run_ids(test_id)
            executable_steps = load_executable_steps_for_replay(test_id, excluded_run_ids)
            
            if executable_steps:
                test_logger.info(f"Replay: {len(executable_steps)} steps from previous run")
                step_trace_capture.add_step(
                    action="replay_started",
                    outcome="success",
                )
                
                replay_result = await replay_steps(
                    steps=executable_steps,
                    starting_url=starting_url,
                    headless=headless_value,
                )
                
                replay_used = True
                execution_method = "replay"
                
                if replay_result["success"]:
                    replay_successful = True
                    agent_result = {
                        "success": True,
                        "final_url": replay_result["final_url"],
                        "final_title": replay_result["final_title"],
                        "error": None,
                    }
                    
                    step_trace_capture.add_step(
                        action="replay_completed",
                        outcome="success",
                        data={
                            "final_url": replay_result["final_url"],
                            "executed_steps": replay_result.get("executed_steps", 0),
                        },
                    )
                    
                    step_trace = step_trace_capture.get_trace()
                    
                    rule_evaluation = await evaluate_rules(
                        rules=validation_str,
                        step_trace=step_trace,
                        final_url=replay_result["final_url"],
                        final_title=replay_result["final_title"],
                    )
                    
                    if not rule_evaluation.passed:
                        test_logger.info("Replay: validation failed, falling back to AI")
                        previous_report = load_latest_report(test_id)
                        if previous_report:
                            add_excluded_run_id(test_id, previous_report.get("run_id", ""))
                        replay_used = False
                        replay_successful = False
                        execution_method = "ai"
                        executable_steps = None
                    else:
                        test_logger.info("Replay: completed successfully")
                else:
                    replay_successful = False
                    test_logger.info(f"Replay: failed ({replay_result.get('error')}), falling back to AI")
                    previous_report = load_latest_report(test_id)
                    if previous_report:
                        add_excluded_run_id(test_id, previous_report.get("run_id", ""))
                    replay_used = False
                    execution_method = "ai"
                    executable_steps = None
        
        if not replay_used or not replay_successful:
            sensitive_data = build_sensitive_data(creds_override)
            task = build_task(process_str, starting_url)
            
            step_trace_capture.add_step(
                action="test_started" if not replay_used else "ai_fallback_started",
                outcome="success",
            )
            
            step_trace_capture.start_step()
            agent_result = await run_agent(
                task=task,
                sensitive_data=sensitive_data,
                timeout_sec=config.TIMEOUT_SEC,
                headless=headless_value,
                auth=auth,
            )
            
            if agent_result["error"]:
                step_trace_capture.add_step(
                    action="agent_execution",
                    outcome="error",
                    error=agent_result["error"],
                )
                errors.append(agent_result["error"])
            else:
                # Process agent history to extract steps
                if "history" in agent_result and agent_result["history"]:
                    for i, history_item in enumerate(agent_result["history"]):
                        # Check if history_item is a tuple (model_output, result)
                        if isinstance(history_item, tuple):
                            model_output = history_item[0]
                            # result = history_item[1]
                        else:
                            # Assume it's an object
                            model_output = getattr(history_item, "model_output", None)

                        if model_output:
                            # Depending on browser-use version, model_output might be a dict or object
                            # Assuming it's an object with action attributes based on 0.9.6
                            # We need to convert this to our StepTrace format
                            
                            # Parse the model output to extract specific actions
                            try:
                                if hasattr(model_output, "action") and model_output.action:
                                    actions = model_output.action
                                elif isinstance(model_output, dict) and "action" in model_output:
                                    actions = model_output["action"]
                                else:
                                    actions = []

                                for action_item in actions:
                                    # action_item is likely a dict {action_name: params}
                                    if hasattr(action_item, "model_dump"):
                                        action_dict = action_item.model_dump()
                                    elif isinstance(action_item, dict):
                                        action_dict = action_item
                                    else:
                                        continue
                                    
                                    for action_name, params in action_dict.items():
                                        if action_name == "done":
                                            continue
                                            
                                        step_data = {}
                                        target = None
                                        locator = None
                                        
                                        if isinstance(params, dict):
                                            step_data = params
                                            if "url" in params:
                                                step_data["url"] = params["url"]
                                                target = params["url"]
                                            if "index" in params:
                                                # Browser-use uses index for clicks sometimes
                                                step_data["index"] = params["index"]
                                                locator = f"index={params['index']}"
                                            if "text" in params:
                                                step_data["text"] = params["text"]
                                            if "coordinate_x" in params and "coordinate_y" in params:
                                                step_data["x"] = params["coordinate_x"]
                                                step_data["y"] = params["coordinate_y"]
                                        
                                        step_trace_capture.add_step(
                                            action=action_name,
                                            outcome="success",
                                            data=step_data,
                                            target=target,
                                            locator=locator
                                        )
                            except Exception as e:
                                # Fallback if parsing fails
                                try:
                                    action_data = model_output.model_dump()
                                except:
                                    action_data = str(model_output)
                                    
                                step_trace_capture.add_step(
                                    action="agent_action_error",
                                    outcome="error", 
                                    error=str(e),
                                    data={"raw_action": action_data}
                                )

                step_trace_capture.add_step(
                    action="agent_completed",
                    outcome="success",
                    data={"final_url": agent_result["final_url"]} if agent_result["final_url"] else None,
                )
                
                usability_score = agent_result.get("usability_score")
                redundant_steps = agent_result.get("redundant_steps", [])
            
            step_trace = step_trace_capture.get_trace()
            
            if not executable_steps:
                executable_steps = convert_step_traces_to_executable(step_trace)
            
            rule_evaluation = await evaluate_rules(
                rules=validation_str,
                step_trace=step_trace,
                final_url=agent_result["final_url"],
                final_title=agent_result["final_title"],
            )
        
        previous_report = load_latest_report(test_id)
        previous_run_used = previous_report is not None
        
        step_diff = StepDiff()
        if previous_report and "step_trace" in previous_report:
            previous_steps = previous_report["step_trace"]
            step_diff = compare_step_traces(step_trace, previous_steps)
        
        baseline_created = not previous_run_used
        
        process_possible = rule_evaluation.passed
        
        verdict_passed = process_possible
        
        verdict_reasons = []
        if not process_possible:
            verdict_reasons.extend(rule_evaluation.reasons)
        if replay_used and replay_successful:
            verdict_reasons.append("Executed via replay (cost optimized)")
        elif replay_used and not replay_successful:
            verdict_reasons.append("Replay failed, executed via AI")
        if baseline_created:
            verdict_reasons.append("Baseline created for first run")
        
        verdict = Verdict(passed=verdict_passed, reasons=verdict_reasons)
        
    except Exception as e:
        test_logger.exception("Test execution error")
        errors.append(str(e))
        step_trace = step_trace_capture.get_trace()
        if not executable_steps:
            executable_steps = convert_step_traces_to_executable(step_trace)
        rule_evaluation = RuleEvaluation(passed=False, reasons=[f"Execution error: {str(e)}"])
        step_diff = StepDiff()
        previous_report = load_latest_report(test_id)
        previous_run_used = previous_report is not None
        verdict = Verdict(passed=False, reasons=[f"Test execution failed: {str(e)}"])
    
    finished_at = datetime.utcnow().isoformat() + "Z"
    duration_sec = (datetime.fromisoformat(finished_at.replace("Z", "+00:00")) - 
                   datetime.fromisoformat(started_at.replace("Z", "+00:00"))).total_seconds()
    
    agent_config = {
        "model": "gemini-flash-latest",
        "headless": headless_value,
        "timeout_sec": config.TIMEOUT_SEC,
    }
    
    inputs = TestInputs(
        process=process,
        validation=validation,
        starting_url=starting_url,
        historical=historical,
        env=env,
        creds_override=creds_override,
        auth=auth,
    )
    
    report = Report(
        run_id=run_id,
        test_id=test_id,
        inputs=inputs,
        agent_config=agent_config,
        started_at=started_at,
        finished_at=finished_at,
        duration_sec=duration_sec,
        step_trace=step_trace,
        executable_steps=executable_steps,
        rule_evaluation=rule_evaluation,
        step_diff=step_diff,
        previous_run_used=previous_run_used,
        replay_used=replay_used,
        replay_successful=replay_successful,
        execution_method=execution_method,
        verdict=verdict,
        artifacts=Artifacts(
            report_path=str(test_dir / "report.json"),
            logs_path=str(log_file),
            screenshots_path=str(test_dir / "screenshots"),
        ),
        usability_score=usability_score,
        redundant_steps=redundant_steps,
        errors=errors,
        redactions=[],
    )
    
    artifact_paths = save_report(
        report, 
        test_id, 
        timestamp, 
        update_mode=historical.update,
        verdict=verdict,
        step_diff=step_diff,
        logs_path=log_file,
    )
    report.artifacts = Artifacts(**artifact_paths)
    report_path = artifact_paths['report_path']
    
    report_dict = report.model_dump()
    _, redactions = redact_dict(report_dict)
    report.redactions = redactions
    
    status = "PASS" if verdict.passed else "FAIL"
    test_logger.info(f"[{status}] Completed in {duration_sec:.2f}s — {Path(report_path).name}")
    
    root_logger.removeHandler(file_handler)
    file_handler.close()
    
    return report

