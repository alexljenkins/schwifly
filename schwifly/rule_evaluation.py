import json
import re
from typing import List, Optional, Union
from schwifly.models import RuleEvaluation, StepTrace, RuleResult, StepExecutedPayload
from browser_use import ChatGoogle
from browser_use.llm.messages import UserMessage


async def evaluate_rules(
    rules: Union[str, List[str]],
    step_trace: Union[List[StepTrace], List[StepExecutedPayload]],
    final_url: Optional[str],
    final_title: Optional[str],
) -> RuleEvaluation:
    llm = ChatGoogle(model="gemini-flash-latest")
    
    steps_summary_lines = []
    for i, step in enumerate(step_trace):
        if isinstance(step, StepTrace):
            line = f"{i+1}. {step.action}" + (f" on {step.target}" if step.target else "") + \
                   f" - {step.outcome}" + (f": {step.error}" if step.error else "")
        elif isinstance(step, StepExecutedPayload):
            # Map params to string for summary
            params_str = ", ".join(f"{k}={v}" for k, v in step.params.items() if k != "screenshot_base64")
            line = f"{i+1}. {step.action} ({params_str}) - {step.outcome}" + \
                   (f": {step.error}" if step.error else "")
        else:
            line = f"{i+1}. Unknown step type"
        steps_summary_lines.append(line)

    steps_summary = "\n".join(steps_summary_lines)
    
    # Handle both string and list of rules
    if isinstance(rules, str):
        rules_display = rules
    else:
        rules_display = "\n".join([f"- {rule}" for rule in rules])
    
    context = f"""
Final URL: {final_url or 'Unknown'}
Final Page Title: {final_title or 'Unknown'}

Steps performed:
{steps_summary}

Rules to evaluate:
{rules_display}
"""
    
    prompt = f"""Evaluate whether the process was completed successfully according to the rules.
For each rule, determine if it passed or failed based on the steps performed and final state.

{context}

Respond with JSON only:
{{
    "passed": true/false,  // Overall pass/fail (all rules must pass)
    "reasons": ["reason1", "reason2"], // General reasons or summary
    "rule_results": [
        {{
            "rule": "rule text",
            "passed": true/false,
            "reason": "specific reason for this rule"
        }}
    ]
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
        
        # Try to find JSON block wrapped in markdown code blocks first
        json_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", content, re.DOTALL)
        if json_match:
            json_str = json_match.group(1)
        else:
            # Fallback: find first { and last }
            start = content.find("{")
            end = content.rfind("}")
            if start != -1 and end != -1:
                json_str = content[start : end + 1]
            else:
                json_str = ""
        
        if json_str:
            result = json.loads(json_str)
            
            # Parse rule results
            rule_results_data = result.get("rule_results", [])
            rule_results = []
            
            # If LLM didn't return rule_results but we have a single rule (string input),
            # construct it from the main result
            if not rule_results_data and isinstance(rules, str):
                rule_results.append(RuleResult(
                    rule=rules,
                    passed=result.get("passed", False),
                    reason=result.get("reasons", [""])[0] if result.get("reasons") else None
                ))
            elif rule_results_data:
                for rr in rule_results_data:
                    rule_results.append(RuleResult(
                        rule=rr.get("rule", "Unknown rule"),
                        passed=rr.get("passed", False),
                        reason=rr.get("reason")
                    ))
            
            return RuleEvaluation(
                passed=result.get("passed", False),
                reasons=result.get("reasons", []),
                rule_results=rule_results
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

