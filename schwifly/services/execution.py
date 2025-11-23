from typing import List, Optional, Dict, Any
from schwifly.models import Step, ProceduralConfig
from schwifly.services.telemetry import TelemetryService
from schwifly.runners.ai import AiTestRunner
from schwifly.runners.procedural import ProceduralTestRunner

class ExecutionService:
    def __init__(self, telemetry: TelemetryService):
        self.telemetry = telemetry
        self.ai_runner = AiTestRunner()
        self.procedural_runner = ProceduralTestRunner()

    async def execute_test(
        self,
        test_id: str,
        process: str,
        starting_url: str,
        procedural_config: ProceduralConfig,
        creds_override: Optional[Dict[str, Any]] = None,
        headless: bool = True,
        auth: Optional[str] = None
    ) -> List[Step]:
        
        steps: List[Step] = []
        
        # 1. Try Procedural if enabled
        if procedural_config.use:
            try:
                steps = await self.procedural_runner.run(
                    test_id=test_id,
                    process=process,
                    starting_url=starting_url,
                    creds_override=creds_override,
                    headless=headless,
                    auth=auth
                )
                
                if steps:
                    self.telemetry.info(f"Procedural execution successful for {test_id}", test_id=test_id)
                    return self._log_steps(steps, test_id)
                    
            except Exception as e:
                self.telemetry.warning(f"Procedural execution failed: {e}", test_id=test_id)
                # Fallback will happen if steps is empty
        
        # 2. Fallback to AI
        # If procedural was not used, or failed (and returned empty steps), run AI
        # Note: If procedural failed but we want to stop, we should handle that. 
        # For now, assuming fallback to AI is desired if procedural fails/doesn't exist.
        
        self.telemetry.info(f"Running AI Agent for {test_id}", test_id=test_id)
        steps = await self.ai_runner.run(
            test_id=test_id,
            process=process,
            starting_url=starting_url,
            creds_override=creds_override,
            headless=headless,
            auth=auth
        )
        
        return self._log_steps(steps, test_id)

    def _log_steps(self, steps: List[Step], test_id: str) -> List[Step]:
        for step in steps:
            self.telemetry.step_end(
                step_id=step.id,
                action=step.action,
                outcome=step.status,
                duration_ms=step.duration_ms,
                error=step.error,
                test_id=test_id
            )
        return steps
