import json
import re
from typing import List, Dict, Any, Optional
from schwifly.models import RuleEvaluation, StepTrace
from browser_use import ChatGoogle
from browser_use.llm.messages import UserMessage


async def evaluate_rules(
    rules: str,
    step_trace: List[StepTrace],
    final_url: Optional[str],
    final_title: Optional[str],
) -> RuleEvaluation:
    llm = ChatGoogle(model="gemini-flash-latest")
    
    steps_summary = "\n".join([
        f"{i+1}. {step.action}" + (f" on {step.target}" if step.target else "") + 
        f" - {step.outcome}" + (f": {step.error}" if step.error else "")
        for i, step in enumerate(step_trace)
    ])
    
    context = f"""
Final URL: {final_url or 'Unknown'}
Final Page Title: {final_title or 'Unknown'}

Steps performed:
{steps_summary}

Rules to evaluate:
{rules}
"""
    
    prompt = f"""Evaluate whether the process was completed successfully according to the rules.

{context}

Respond with JSON only:
{{
    "passed": true/false,
    "reasons": ["reason1", "reason2"]
}}
"""
    
    try:
        message = UserMessage(content=prompt)
        response = await llm.ainvoke([message])
        
        if hasattr(response, "completion"):
            content = response.completion
        elif isinstance(response, str):
            content = response
        else:
            content = str(response)
        
        json_match = re.search(r'\{[^}]+\}', content, re.DOTALL)
        if json_match:
            result = json.loads(json_match.group())
            return RuleEvaluation(
                passed=result.get("passed", False),
                reasons=result.get("reasons", [])
            )
        
        return RuleEvaluation(
            passed=False,
            reasons=[f"Could not parse evaluation response: {content[:200]}"]
        )
    except Exception as e:
        return RuleEvaluation(
            passed=False,
            reasons=[f"Rule evaluation error: {str(e)}"]
        )

