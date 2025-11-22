from typing import List, Optional, Dict, Any
from schwifly.models import Step, StepStatus
from schwifly.agent_orchestration import run_agent, build_task
from schwifly.secrets import build_sensitive_data
from schwifly.services.telemetry import TelemetryService
from schwifly.config import config

class ExecutionService:
    def __init__(self, telemetry: TelemetryService):
        self.telemetry = telemetry

    async def run_ai(
        self,
        test_id: str,
        process: str,
        starting_url: str,
        creds_override: Optional[Dict[str, Any]] = None,
        headless: bool = True,
        auth: Optional[str] = None
    ) -> List[Step]:
        
        self.telemetry.info(f"Starting AI Agent for {test_id}", test_id=test_id)
        
        sensitive_data = build_sensitive_data(creds_override)
        task = build_task(process, starting_url)
        
        result = await run_agent(
            task=task,
            sensitive_data=sensitive_data,
            timeout_sec=config.TIMEOUT_SEC,
            headless=headless,
            auth=auth,
            test_id=test_id
            # event_logger passed? run_agent expects EventLogger, 
            # but we want to use TelemetryService. 
            # We might need to adapt run_agent or pass None and handle logging here.
            # For now, let's pass None and extract steps from history.
        )
        
        steps = []
        if result.get("history"):
            steps = self._convert_history_to_steps(result["history"])
            
        # Log steps to telemetry
        for step in steps:
            self.telemetry.step_end(
                step_id=step.id,
                action=step.action,
                outcome=step.status,
                duration_ms=step.duration_ms,
                error=step.error,
                test_id=test_id
            )
            
        if result.get("error"):
            self.telemetry.error(f"AI Agent failed: {result['error']}", test_id=test_id)
            
        return steps

    async def run_replay(self, test_id: str, steps: List[Step], starting_url: str, headless: bool = True) -> bool:
        # TODO: Implement replay logic using browser-use or playwright directly
        # For now, returning False to force AI fallback as per refactor plan 
        # (focusing on architecture first)
        self.telemetry.info("Replay not yet implemented in new architecture, falling back to AI", test_id=test_id)
        return False

    def _convert_history_to_steps(self, history: List[Any]) -> List[Step]:
        steps = []
        for i, item in enumerate(history):
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
                            
                            step = Step(
                                index=len(steps) + 1,
                                action=action_name,
                                params=params if isinstance(params, dict) else {"value": params},
                                status=StepStatus.SUCCESS # Assumed success if in history
                            )
                            steps.append(step)
            except Exception:
                pass
        return steps
