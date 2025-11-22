import uuid
import time
import logging
import json
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional, Union
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
    logs_path = artifacts_base / f"{run_timestamp}.log"
    
    file_handler = logging.FileHandler(logs_path, mode='a')
    file_handler.setLevel(getattr(logging, config.LOG_LEVEL))
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    file_handler.setFormatter(formatter)
    
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
        step_trace: List[StepTrace] = []
        
        if historical.use:
            excluded_run_ids = get_excluded_run_ids(test_id)
            executable_steps = load_executable_steps_for_replay(test_id, excluded_run_ids)
            
            if executable_steps:
                logger.info(f"Attempting replay for test {test_id} with {len(executable_steps)} steps")
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
                        logger.info(f"Replay succeeded but validation failed, falling back to AI")
                        previous_report = load_latest_report(test_id)
                        if previous_report:
                            add_excluded_run_id(test_id, previous_report.get("run_id", ""))
                        replay_used = False
                        replay_successful = False
                        executable_steps = None
                    else:
                        logger.info(f"Replay succeeded and validation passed")
                else:
                    replay_successful = False
                    logger.info(f"Replay failed: {replay_result.get('error')}, falling back to AI")
                    previous_report = load_latest_report(test_id)
                    if previous_report:
                        add_excluded_run_id(test_id, previous_report.get("run_id", ""))
                    replay_used = False
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
            )
            
            if agent_result["error"]:
                step_trace_capture.add_step(
                    action="agent_execution",
                    outcome="error",
                    error=agent_result["error"],
                )
                errors.append(agent_result["error"])
            else:
                step_trace_capture.add_step(
                    action="agent_completed",
                    outcome="success",
                    data={"final_url": agent_result["final_url"]} if agent_result["final_url"] else None,
                )
            
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
        logger.exception("Error during test execution")
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
            report_path="",
            logs_path="",
            screenshots_path="",
        ),
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
        logs_path=logs_path,
    )
    report.artifacts = Artifacts(**artifact_paths)
    report_path = artifact_paths['report_path']
    
    report_dict = report.model_dump()
    _, redactions = redact_dict(report_dict)
    report.redactions = redactions
    
    status = "PASS" if verdict.passed else "FAIL"
    logger.info(f"[{status}] {test_id} in {duration_sec:.2f}s — {report_path}")
    
    root_logger.removeHandler(file_handler)
    file_handler.close()
    
    return report

