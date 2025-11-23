from typing import List
from playwright.async_api import Page
from schwifly.models import Step, StepStatus

async def run(page: Page) -> List[Step]:
    print("Running dummy procedural script for relevance_ai_login")
    await page.goto("https://relevanceai.com")
    
    # Dummy steps
    step = Step(
        index=1,
        action="navigate",
        params={"url": "https://relevanceai.com"},
        status=StepStatus.SUCCESS,
        description="Navigated to Relevance AI"
    )
    return [step]
