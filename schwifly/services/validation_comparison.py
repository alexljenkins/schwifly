import json
import re
from typing import Dict, List
from schwifly.models import RuleResult
from schwifly.services.validation_parser import ValidationPoint
from browser_use import ChatGoogle
from browser_use.llm.messages import UserMessage


class ValidationComparison:
    """Service for comparing agent validation responses against ground truth"""
    
    def __init__(self):
        self.llm = ChatGoogle(model="gemini-flash-latest")
    
    async def compare(
        self,
        expected: Dict[str, ValidationPoint],
        actual: Dict[str, str]
    ) -> List[RuleResult]:
        """
        Compare expected vs actual validation values using LLM.
        
        For each validation point:
        1. Check if blank ID exists in actual responses
        2. If missing -> FAIL (validation failure - value not found/extracted)
        3. If present -> Use LLM to compare based on comparison_type:
           - "exact": Strict comparison (case-insensitive, whitespace normalized)
           - "semantic": Semantic equivalence (e.g., "$19" == "19", "custom" == "contact sales")
        4. Return RuleResult with pass/fail and reason
        
        Args:
            expected: Dict of validation points with expected values
            actual: Dict of actual values returned by agent
            
        Returns:
            List of RuleResult for each validation point
        """
        results: List[RuleResult] = []
        
        for validation_id, validation_point in expected.items():
            # Check if agent provided a response for this blank
            if validation_id not in actual:
                results.append(RuleResult(
                    rule=f"{validation_id}: {validation_point.expected_value}",
                    passed=False,
                    reason=f"Agent did not provide a value for BLANK_{validation_id}"
                ))
                continue
            
            actual_value = actual[validation_id]
            
            # Use LLM to compare based on comparison type
            passed, reason = await self._llm_compare(
                expected_value=validation_point.expected_value,
                actual_value=actual_value,
                comparison_type=validation_point.comparison_type,
                context=validation_point.context
            )
            
            results.append(RuleResult(
                rule=f"{validation_id}: {validation_point.expected_value}",
                passed=passed,
                reason=reason
            ))
        
        return results
    
    async def _llm_compare(
        self,
        expected_value: str,
        actual_value: str,
        comparison_type: str,
        context: str
    ) -> tuple[bool, str]:
        """
        Use LLM to compare expected vs actual values.
        
        Args:
            expected_value: Ground truth value
            actual_value: Agent's response
            comparison_type: "exact" or "semantic"
            context: Surrounding context for better understanding
            
        Returns:
            Tuple of (passed: bool, reason: str)
        """
        if comparison_type == "exact":
            prompt = f"""Compare these two values for EXACT match (case-insensitive, whitespace normalized):

Expected: "{expected_value}"
Actual: "{actual_value}"

Context: {context}

Rules for exact match:
- Whitespace differences are OK (e.g., "19" == " 19 ")
- Case differences are OK (e.g., "Pro" == "pro")
- Format differences are NOT OK (e.g., "19" != "$19")
- Word order must match exactly
- All words must be present

Respond with JSON only:
{{
    "passed": true/false,
    "reason": "brief explanation of why it passed or failed"
}}
"""
        else:  # semantic
            prompt = f"""Compare these two values for SEMANTIC equivalence:

Expected: "{expected_value}"
Actual: "{actual_value}"

Context: {context}

Rules for semantic match:
- Same meaning is OK even with different wording
- Format differences are OK (e.g., "19" == "$19")
- Minor wording differences are OK (e.g., "Free, Pro, Team and Enterprise" == "Free, Pro, Team, Enterprise")
- Synonyms are OK (e.g., "custom pricing" == "contact sales")
- The core information must be the same

Respond with JSON only:
{{
    "passed": true/false,
    "reason": "brief explanation of why it passed or failed"
}}
"""
        
        try:
            message = UserMessage(content=prompt)
            response = await self.llm.ainvoke([message])
            
            # Extract content
            if hasattr(response, "completion"):
                content = response.completion
            elif isinstance(response, str):
                content = response
            else:
                content = str(response)
            
            # Parse JSON
            result = self._parse_json(content)
            
            if result:
                return result.get("passed", False), result.get("reason", "No reason provided")
            
            # Fallback: simple string comparison
            return expected_value.strip().lower() == actual_value.strip().lower(), "LLM comparison failed, used fallback"
            
        except Exception as e:
            # Fallback on error
            return False, f"Comparison error: {str(e)}"
    
    def _parse_json(self, content: str) -> dict | None:
        """Parse JSON from LLM response"""
        # Try to find JSON block wrapped in markdown code blocks
        json_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", content, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group(1))
            except Exception:
                pass
        
        # Fallback: find first { and last }
        start = content.find("{")
        end = content.rfind("}")
        if start != -1 and end != -1:
            try:
                return json.loads(content[start : end + 1])
            except Exception:
                pass
        
        return None
