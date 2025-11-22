import asyncio
from browser_use import Agent, Browser, ChatGoogle
from dotenv import load_dotenv
import os

load_dotenv()

SPEED_OPTIMIZATION_PROMPT = """
Speed optimization instructions:
- Be extremely concise and direct in your responses
- Get to the goal as quickly as possible
- Use multi-action sequences whenever possible to reduce steps
"""

async def main():
	browsers = [
		Browser(
            minimum_wait_page_load_time=0.1,
            wait_between_actions=0.1,
			user_data_dir=f'./temp-profile-{i}',
			headless=False,
		)
		for i in range(3)
	]

	agents = [
		Agent(
			task="Find and list the different packages and their prices on Relevance AI's pricing page.",
			browser=browsers[0],
			llm=ChatGoogle(model='gemini-flash-latest'),
            flash_mode=False,
            extend_system_message=None,
		),
		Agent(
			task="List the different pricing packages of Relevance AI.",
			browser=browsers[1],
			llm=ChatGoogle(model='gemini-flash-latest'),
            flash_mode=True,  # thinking
            extend_system_message=None,
		),
		Agent(
			task="Get the prices of Relevance AI.",
			browser=browsers[2],
			llm=ChatGoogle(model='gemini-flash-latest'),
            flash_mode=True,  # thinking
            extend_system_message=SPEED_OPTIMIZATION_PROMPT,
		),
	]

	# Run all agents in parallel
	tasks = [agent.run() for agent in agents]
	results = await asyncio.gather(*tasks, return_exceptions=True)

	print('🎉 All agents completed!')
if __name__ == "__main__":
    asyncio.run(main())