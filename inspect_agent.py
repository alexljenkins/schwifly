import inspect
from browser_use import Agent
from browser_use.agent.views import AgentHistoryList

print("Agent.run signature:")
print(inspect.signature(Agent.run))

print("\nAgentHistoryList attributes:")
print(dir(AgentHistoryList))

print("\nAgentHistoryList.final_result type:")
if hasattr(AgentHistoryList, 'final_result'):
    print(type(AgentHistoryList.final_result))
    print(AgentHistoryList.final_result)
else:
    print("AgentHistoryList has no final_result attribute")

print("\nAgentHistoryList.result type:")
if hasattr(AgentHistoryList, 'result'):
    print(type(AgentHistoryList.result))
    print(AgentHistoryList.result)
else:
    print("AgentHistoryList has no result attribute")
