import asyncio
from typing import Dict, Any, Optional
from browser_use import Agent, ChatGoogle, BrowserProfile
from schwifly.config import config
from schwifly.secrets import build_sensitive_data


def create_browser_profile(headless: Optional[bool] = None) -> BrowserProfile:
    headless_value = headless if headless is not None else config.HEADLESS
    return BrowserProfile(
        minimum_wait_page_load_time=1.0,
        wait_between_actions=1.0,
        headless=headless_value,
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
) -> Dict[str, Any]:
    llm = create_llm()
    browser_profile = create_browser_profile(headless=headless)
    
    agent = Agent(
        task=task,
        llm=llm,
        flash_mode=True,
        browser_profile=browser_profile,
        sensitive_data=sensitive_data,
    )
    
    try:
        await asyncio.wait_for(agent.run(), timeout=timeout_sec)
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
        
        return {
            "success": True,
            "final_url": final_url,
            "final_title": final_title,
            "error": None,
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

