import logging
import asyncio
import json
from typing import Dict, Any, Optional
from browser_use import Agent, ChatGoogle, BrowserProfile
from schwifly.config import config
from schwifly.models import AgentOutput
from schwifly.secrets import build_sensitive_data
from schwifly.logger import EventLogger

logger = logging.getLogger(__name__)


def create_browser_profile(headless: Optional[bool] = None, auth: Optional[str] = None) -> BrowserProfile:
    headless_value = headless if headless is not None else config.HEADLESS
    
    return BrowserProfile(
        minimum_wait_page_load_time=1.0,
        wait_between_actions=1.0,
        headless=headless_value,
        storage_state=auth,
        allowed_domains=config.ALLOWED_DOMAINS,
    )


def create_llm() -> ChatGoogle:
    return ChatGoogle(model="gemini-flash-latest")


def build_task(process: str, base_url: Optional[str] = None) -> str:
    if base_url:
        return f"Navigate to {base_url} and {process}"
    return process


async def run_agent(
    task: str,
    sensitive_data: Dict[str, Any],
    timeout_sec: int,
    headless: Optional[bool] = None,
    auth: Optional[str] = None,
    event_logger: Optional[EventLogger] = None,
    test_id: Optional[str] = None,
) -> Dict[str, Any]:
    # Append instruction for structured output
    task += " Please provide a usability score (1-10) and list any redundant steps in the final output."
    
    llm = create_llm()
    browser_profile = create_browser_profile(headless=headless, auth=auth)
    
    agent = Agent(
        task=task,
        llm=llm,
        flash_mode=True,
        browser_profile=browser_profile,
        sensitive_data=sensitive_data,
        output_model_schema=AgentOutput,
    )
    
    try:
        history_obj = await asyncio.wait_for(agent.run(), timeout=timeout_sec)
        # Check if history_obj has a 'history' attribute (AgentHistoryList)
        if hasattr(history_obj, "history"):
            history = history_obj.history
        else:
            history = history_obj
            
        # Log history as events if logger is provided
        if event_logger and history:
            for item in history:
                try:
                    model_output = getattr(item, "model_output", None)
                    if model_output:
                        # Extract actions
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
                                    
                                event_logger.step(
                                    action=action_name,
                                    params=params if isinstance(params, dict) else {"value": params},
                                    duration_ms=0, # We don't have per-step duration from history easily
                                    outcome="success",
                                    test_id=test_id
                                )
                except Exception as e:
                    event_logger.info(f"Failed to parse history item: {e}", test_id=test_id)

        final_url = None
        final_title = None
        
        browser_session = getattr(agent, "browser_session", None) or getattr(agent, "browser", None)
        if browser_session:
            try:
                if hasattr(browser_session, "get_current_page"):
                    page = await browser_session.get_current_page()
                    if page:
                        final_url = page.url
                        final_title = await page.title()
                elif hasattr(browser_session, "current_page"):
                    page = browser_session.current_page
                    if page:
                        final_url = page.url
                        final_title = await page.title()
            except:
                pass
        
        # Extract structured output if available
        usability_score = None
        redundant_steps = []
        
        if history:
            last_item = history[-1]
            
            model_output = getattr(last_item, "model_output", None)
            result = getattr(last_item, "result", None)
            
            # Check model_output
            if model_output:
                if hasattr(model_output, "usability_score"):
                    usability_score = model_output.usability_score
                    redundant_steps = model_output.redundant_steps
                    final_url = getattr(model_output, "final_url", final_url)
                    final_title = getattr(model_output, "final_title", final_title)
                elif isinstance(model_output, dict):
                    usability_score = model_output.get("usability_score")
                    redundant_steps = model_output.get("redundant_steps", [])
                    final_url = model_output.get("final_url", final_url)
                    final_title = model_output.get("final_title", final_title)
            
            # Check result for extracted_content
            if usability_score is None and result:
                # result might be a list of ActionResult
                if isinstance(result, list):
                    for res in result:
                        if hasattr(res, "extracted_content") and res.extracted_content:
                            try:
                                content = json.loads(res.extracted_content)
                                usability_score = content.get("usability_score")
                                redundant_steps = content.get("redundant_steps", [])
                                final_url = content.get("final_url", final_url)
                                final_title = content.get("final_title", final_title)
                                if usability_score is not None:
                                    break
                            except:
                                pass
                elif hasattr(result, "extracted_content") and result.extracted_content:
                     try:
                        content = json.loads(result.extracted_content)
                        usability_score = content.get("usability_score")
                        redundant_steps = content.get("redundant_steps", [])
                        final_url = content.get("final_url", final_url)
                        final_title = content.get("final_title", final_title)
                     except:
                        pass

        return {
            "success": True,
            "final_url": final_url,
            "final_title": final_title,
            "error": None,
            "history": history,
            "usability_score": usability_score,
            "redundant_steps": redundant_steps,
        }
    except asyncio.TimeoutError:
        return {
            "success": False,
            "final_url": None,
            "final_title": None,
            "error": f"Agent execution timed out after {timeout_sec} seconds",
        }
    except Exception as e:
        return {
            "success": False,
            "final_url": None,
            "final_title": None,
            "error": str(e),
        }

