"""Step replay engine for executing stored steps directly without AI."""
import asyncio
import logging
import time
from typing import List, Dict, Any, Optional
from playwright.async_api import async_playwright, Page, Browser, BrowserContext
from schwifly.models import ExecutableStep
from schwifly.config import config
from schwifly.logger import EventLogger

logger = logging.getLogger(__name__)


class StepReplayEngine:
    """Executes stored steps directly using browser automation."""
    
    def __init__(self, headless: bool = None, event_logger: Optional[EventLogger] = None, test_id: Optional[str] = None):
        self.headless = headless if headless is not None else config.HEADLESS
        self.browser: Optional[Browser] = None
        self.context: Optional[BrowserContext] = None
        self.page: Optional[Page] = None
        self.event_logger = event_logger
        self.test_id = test_id
    
    async def start(self):
        """Initialize browser and context."""
        playwright = await async_playwright().start()
        self.browser = await playwright.chromium.launch(headless=self.headless)
        self.context = await self.browser.new_context()
        self.page = await self.context.new_page()
    
    async def stop(self):
        """Close browser and cleanup."""
        if self.browser:
            await self.browser.close()
    
    async def _find_element(self, step: ExecutableStep) -> Optional[Any]:
        """Find element using the specified selector type."""
        if not step.selector:
            return None
        
        try:
            if step.selector_type == "css":
                return await self.page.query_selector(step.selector)
            elif step.selector_type == "xpath":
                return await self.page.query_selector(f"xpath={step.selector}")
            elif step.selector_type == "id":
                return await self.page.query_selector(f"#{step.selector}")
            elif step.selector_type == "name":
                return await self.page.query_selector(f"[name='{step.selector}']")
            elif step.selector_type == "text":
                return await self.page.get_by_text(step.selector).first
            elif step.selector_type == "placeholder":
                return await self.page.get_by_placeholder(step.selector).first
            else:
                return await self.page.query_selector(step.selector)
        except Exception as e:
            logger.debug(f"Element not found: {step.selector} ({step.selector_type}): {e}")
            return None
    
    async def _wait_for_condition(self, step: ExecutableStep) -> bool:
        """Wait for the specified condition."""
        if not step.wait_for:
            await asyncio.sleep(0.5)
            return True
        
        try:
            if step.wait_for == "element" and step.wait_selector:
                await self.page.wait_for_selector(step.wait_selector, timeout=step.wait_timeout_ms)
                return True
            elif step.wait_for == "url_change":
                await self.page.wait_for_url("**", timeout=step.wait_timeout_ms)
                return True
            elif step.wait_for == "navigation":
                await self.page.wait_for_load_state("networkidle", timeout=step.wait_timeout_ms)
                return True
            elif step.wait_for == "timeout":
                await asyncio.sleep(step.wait_timeout_ms / 1000.0)
                return True
            else:
                await asyncio.sleep(0.5)
                return True
        except Exception as e:
            logger.debug(f"Wait condition failed: {e}")
            return False
    
    async def _execute_step(self, step: ExecutableStep) -> tuple[bool, Optional[str]]:
        """Execute a single step and return (success, error_message)."""
        start_time = time.perf_counter()
        try:
            if step.action == "navigate":
                if step.value:
                    await self.page.goto(step.value, wait_until="networkidle", timeout=step.wait_timeout_ms)
                else:
                    return False, "Navigate action requires value (URL)"
            
            elif step.action == "click":
                element = await self._find_element(step)
                if not element:
                    return False, f"Element not found for click: {step.selector}"
                await element.click(timeout=step.wait_timeout_ms)
            
            elif step.action == "type":
                element = await self._find_element(step)
                if not element:
                    return False, f"Element not found for type: {step.selector}"
                if step.value:
                    await element.fill(step.value)
                else:
                    return False, "Type action requires value"
            
            elif step.action == "fill_form":
                if step.value:
                    import json
                    form_data = json.loads(step.value) if isinstance(step.value, str) else step.value
                    for field_selector, field_value in form_data.items():
                        element = await self.page.query_selector(field_selector)
                        if element:
                            await element.fill(str(field_value))
                else:
                    return False, "Fill form action requires value (JSON dict)"
            
            elif step.action == "select":
                element = await self._find_element(step)
                if not element:
                    return False, f"Element not found for select: {step.selector}"
                if step.value:
                    await element.select_option(step.value)
                else:
                    return False, "Select action requires value"
            
            elif step.action == "press_key":
                if step.value:
                    await self.page.keyboard.press(step.value)
                else:
                    return False, "Press key action requires value (key name)"
            
            elif step.action == "scroll":
                if step.selector:
                    element = await self._find_element(step)
                    if element:
                        await element.scroll_into_view_if_needed()
                    else:
                        await self.page.evaluate(f"document.querySelector('{step.selector}')?.scrollIntoView()")
                else:
                    await self.page.evaluate("window.scrollBy(0, 500)")
            
            elif step.action == "wait":
                success = await self._wait_for_condition(step)
                if not success:
                    return False, "Wait condition not met"
            
            elif step.action == "screenshot":
                if step.value:
                    await self.page.screenshot(path=step.value)
            
            await self._wait_for_condition(step)
            
            duration_ms = (time.perf_counter() - start_time) * 1000
            if self.event_logger:
                self.event_logger.step(
                    action=step.action,
                    params={"selector": step.selector, "value": step.value},
                    duration_ms=duration_ms,
                    outcome="success",
                    test_id=self.test_id
                )
            return True, None
            
        except Exception as e:
            duration_ms = (time.perf_counter() - start_time) * 1000
            error_msg = f"Step execution failed: {str(e)}"
            logger.debug(f"{step.action} failed: {error_msg}")
            
            if self.event_logger:
                self.event_logger.step(
                    action=step.action,
                    params={"selector": step.selector, "value": step.value},
                    duration_ms=duration_ms,
                    outcome="failure",
                    error=error_msg,
                    test_id=self.test_id
                )
            return False, error_msg
    
    async def execute_steps(
        self,
        steps: List[ExecutableStep],
        starting_url: str,
    ) -> Dict[str, Any]:
        """Execute a list of steps and return result."""
        if not self.page:
            await self.start()
        
        errors = []
        executed_count = 0
        
        try:
            await self.page.goto(starting_url, wait_until="networkidle")
            
            for step in steps:
                success, error = await self._execute_step(step)
                if not success:
                    errors.append(f"Step {step.index} ({step.action}): {error}")
                    if step.retry_count > 0:
                        for retry in range(step.retry_count):
                            await asyncio.sleep(0.5)
                            success, error = await self._execute_step(step)
                            if success:
                                break
                            if retry == step.retry_count - 1:
                                return {
                                    "success": False,
                                    "final_url": self.page.url,
                                    "final_title": await self.page.title(),
                                    "error": f"Step {step.index} failed after retries: {error}",
                                    "executed_steps": executed_count,
                                }
                    else:
                        return {
                            "success": False,
                            "final_url": self.page.url,
                            "final_title": await self.page.title(),
                            "error": f"Step {step.index} failed: {error}",
                            "executed_steps": executed_count,
                        }
                
                executed_count += 1
            
            final_url = self.page.url
            final_title = await self.page.title()
            
            return {
                "success": True,
                "final_url": final_url,
                "final_title": final_title,
                "error": None,
                "executed_steps": executed_count,
            }
            
        except Exception as e:
            final_url = self.page.url if self.page else None
            final_title = await self.page.title() if self.page else None
            
            return {
                "success": False,
                "final_url": final_url,
                "final_title": final_title,
                "error": f"Replay execution error: {str(e)}",
                "executed_steps": executed_count,
            }


async def replay_steps(
    steps: List[ExecutableStep],
    starting_url: str,
    headless: bool = None,
    event_logger: Optional[EventLogger] = None,
    test_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Convenience function to replay steps."""
    engine = StepReplayEngine(headless=headless, event_logger=event_logger, test_id=test_id)
    try:
        result = await engine.execute_steps(steps, starting_url)
        return result
    finally:
        await engine.stop()


