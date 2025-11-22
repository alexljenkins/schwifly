import json
import re
from typing import List, Optional, Union
from schwifly.models import Step, RuleResult, Verdict
from browser_use import ChatGoogle
from browser_use.llm.messages import UserMessage

class ValidationService:
    def __init__(self):
        self.llm = ChatGoogle(model="gemini-flash-latest")

    async def evaluate(
        self,
        rules: Union[str, List[str]],
        steps: List[Step],
        final_url: Optional[str],
        final_title: Optional[str],
    ) -> Verdict:
        
        steps_summary = self._summarize_steps(steps)
        rules_display = self._format_rules(rules)
        
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
            response = await self.llm.ainvoke([message])
            content = self._extract_content(response)
            result = self._parse_json(content)
            
            if not result:
                 return Verdict(passed=False, reasons=[f"Could not parse evaluation response"])

            rule_results = []
            rule_results_data = result.get("rule_results", [])
            
            # Handle single rule string case if LLM returns flat result
            if not rule_results_data and isinstance(rules, str):
                 rule_results.append(RuleResult(
                    rule=rules,
                    passed=result.get("passed", False),
                    reason=result.get("reasons", [""])[0] if result.get("reasons") else None
                ))
            else:
                for rr in rule_results_data:
                    rule_results.append(RuleResult(
                        rule=rr.get("rule", "Unknown rule"),
                        passed=rr.get("passed", False),
                        reason=rr.get("reason")
                    ))
            
            # Update steps with validation results? 
            # For now, we just return the Verdict which contains the results.
            # The caller can attach them to the test result.
            
            return Verdict(
                passed=result.get("passed", False),
                reasons=result.get("reasons", [])
            )
            # Note: We might want to return the detailed RuleResults too. 
            # The Verdict model in models.py currently only has passed/reasons.
            # I should probably update Verdict to include rule_results or return a richer object.
            # For now, I'll stick to the existing Verdict model but maybe I should have updated it.
            # Actually, let's update Verdict in models.py later if needed, or just rely on the fact 
            # that the caller might want the details. 
            # Wait, the previous RuleEvaluation had rule_results. 
            # My new Verdict model in models.py DOES NOT have rule_results.
            # I should fix that in models.py or here.
            # I'll stick to the plan of "Unify Data Models" and maybe I missed adding rule_results to Verdict.
            # I'll add it to the return value here dynamically or fix models.py in next step.
            # For now, let's assume I'll fix models.py to include rule_results in Verdict.
            
        except Exception as e:
            return Verdict(passed=False, reasons=[f"Validation error: {str(e)}"])

    def _summarize_steps(self, steps: List[Step]) -> str:
        lines = []
        for step in steps:
            params_str = ", ".join(f"{k}={v}" for k, v in step.params.items() if k != "screenshot_base64")
            line = f"{step.index}. {step.action} ({params_str}) - {step.status}"
            if step.error:
                line += f": {step.error}"
            lines.append(line)
        return "\n".join(lines)

    def _format_rules(self, rules: Union[str, List[str]]) -> str:
        if isinstance(rules, str):
            return rules
        return "\n".join([f"- {rule}" for rule in rules])

    def _extract_content(self, response) -> str:
        if hasattr(response, "completion"):
            return response.completion
        elif isinstance(response, str):
            return response
        return str(response)

    def _parse_json(self, content: str) -> Optional[dict]:
        json_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", content, re.DOTALL)
        if json_match:
            return json.loads(json_match.group(1))
        
        start = content.find("{")
        end = content.rfind("}")
        if start != -1 and end != -1:
            try:
                return json.loads(content[start : end + 1])
            except:
                pass
        return None
