from typing import Optional, Dict, Any
from schwifly.models import ProceduralConfig, ExecutionResult
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
        auth: Optional[str] = None,
        has_validations: bool = False  # Indicates if process has inline validations
    ) -> ExecutionResult:
        
        # 1. Try Procedural if enabled
        if procedural_config.use:
            try:
                result = await self.procedural_runner.run(
                    test_id=test_id,
                    process=process,
                    starting_url=starting_url,
                    creds_override=creds_override,
                    headless=headless,
                    auth=auth
                )
                
                if result.steps:
                    self.telemetry.info(f"Procedural execution successful for {test_id}", test_id=test_id)
                    self._log_steps(result.steps, test_id)
                    return result
                    
            except Exception as e:
                self.telemetry.warning(f"Procedural execution failed: {e}", test_id=test_id)
        
        # 2. Fallback to AI
        self.telemetry.info(f"Running AI Agent for {test_id}", test_id=test_id)
        result = await self.ai_runner.run(
            test_id=test_id,
            process=process,
            starting_url=starting_url,
            creds_override=creds_override,
            headless=headless,
            auth=auth,
            has_validations=has_validations
        )
        
        self._log_steps(result.steps, test_id)
        return result

    def _log_steps(self, steps, test_id: str):
        for step in steps:
            self.telemetry.step_end(
                step_id=step.id,
                action=step.action,
                outcome=step.status,
                duration_ms=step.duration_ms,
                error=step.error,
                test_id=test_id
            )
