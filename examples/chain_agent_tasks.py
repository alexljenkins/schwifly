"""
How It Works:
- Persistent Browser: BrowserProfile(keep_alive=True) prevents browser from closing between tasks
- Task Chaining: Use agent.add_new_task() to add follow-up tasks
- Context Preservation: Agent maintains memory and browser state across tasks
- Interactive Flow: Perfect for conversational interfaces
- Break down long flows: If you have very long flows, you can keep the browser alive and send new agents to it.
"""
import asyncio
from dotenv import load_dotenv
from browser_use import Agent, Browser, ChatGoogle

load_dotenv()

async def main():
	browser = Browser(keep_alive=True)
	llm = ChatGoogle(model='gemini-flash-latest')
	await browser.start()

	agent = Agent(task='search for browser-use.', browser_session=browser, llm=llm)
	await agent.run(max_steps=2)
	agent.add_new_task('return the title of first result')
	await agent.run()

	await browser.kill()

asyncio.run(main())