import logging
import asyncio
import json
from typing import List, Optional, Dict, Any

from browser_use import Agent, ChatGoogle, BrowserProfile
from schwifly.runners.base import BaseTestRunner
from schwifly.models import Step, StepStatus, AgentOutput
from schwifly.config import config
from schwifly.secrets import build_sensitive_data

logger = logging.getLogger(__name__)

class AiTestRunner(BaseTestRunner):
    """Runner for AI-based tests using browser-use Agent."""

    async def run(
        self,
        test_id: str,
        process: str,
        starting_url: str,
        creds_override: Optional[Dict[str, Any]] = None,
        headless: bool = True,
        auth: Optional[str] = None
    ) -> List[Step]:
        
        logger.info(f"Starting AI Runner for {test_id}")
        
        sensitive_data = build_sensitive_data(creds_override)
        task = self._build_task(process, starting_url)
        
        # Append instruction for structured output
        task += " Please provide a usability score (1-10) and list any redundant steps in the final output."

        llm = self._create_llm()
        browser_profile = self._create_browser_profile(headless=headless, auth=auth)
        
        agent = Agent(
            task=task,
            llm=llm,
            flash_mode=True,
            browser_profile=browser_profile,
            sensitive_data=sensitive_data,
            output_model_schema=AgentOutput,
        )
        
        steps: List[Step] = []
        
        try:
            history_obj = await asyncio.wait_for(agent.run(), timeout=config.TIMEOUT_SEC)
            
            # Handle history object structure
            if hasattr(history_obj, "history"):
                history = history_obj.history
            else:
                history = history_obj
                
            if history:
                steps = self._convert_history_to_steps(history)
                
        except asyncio.TimeoutError:
            logger.error(f"AI Agent timed out for {test_id}")
            # We could add a failed step here if needed
        except Exception as e:
            logger.error(f"AI Agent failed for {test_id}: {e}")
            
        return steps

    def _build_task(self, process: str, base_url: Optional[str] = None) -> str:
        if base_url:
            return f"Navigate to {base_url} and {process}"
        return process

    def _create_llm(self) -> ChatGoogle:
        return ChatGoogle(model="gemini-flash-latest")

    def _create_browser_profile(self, headless: Optional[bool] = None, auth: Optional[str] = None) -> BrowserProfile:
        headless_value = headless if headless is not None else config.HEADLESS
        
        return BrowserProfile(
            minimum_wait_page_load_time=1.0,
            wait_between_actions=1.0,
            headless=headless_value,
            storage_state=auth,
            allowed_domains=config.ALLOWED_DOMAINS,
        )

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
