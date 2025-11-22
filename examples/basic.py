from browser_use import Agent, ChatGoogle, BrowserProfile
from dotenv import load_dotenv
import asyncio
import time

load_dotenv()

SPEED_OPTIMIZATION_PROMPT = """
Speed optimization instructions:
- Be extremely concise and direct in your responses
- Get to the goal as quickly as possible
- Use multi-action sequences whenever possible to reduce steps
"""

async def main():
    llm = ChatGoogle(model='gemini-flash-latest')

    # Speed-optimized browser profile
    browser_profile = BrowserProfile(
		minimum_wait_page_load_time=0.1,
		wait_between_actions=0.1,
		headless=False,
	)

    task = "Get the prices of Relevance AI."
    agent = Agent(
		task=task,
		llm=llm,
		flash_mode=True,  # Disables thinking
		browser_profile=browser_profile,
		# extend_system_message=SPEED_OPTIMIZATION_PROMPT,
	)
    start_time = time.perf_counter()
    await agent.run()
    end_time = time.perf_counter()
    
    duration = end_time - start_time
    print(f"\nTask completed in {duration:.2f} seconds ({duration/60:.2f} minutes)")

if __name__ == "__main__":
    asyncio.run(main())
