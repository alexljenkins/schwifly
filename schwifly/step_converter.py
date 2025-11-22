"""Convert StepTrace to ExecutableStep for replay."""
from typing import List, Optional, Dict, Any
from schwifly.models import StepTrace, ExecutableStep


def extract_selector_from_locator(locator: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """Extract selector and selector_type from locator string."""
    if not locator:
        return None, None
    
    locator_lower = locator.lower().strip()
    
    if locator_lower.startswith("css="):
        return locator[4:].strip(), "css"
    elif locator_lower.startswith("xpath="):
        return locator[6:].strip(), "xpath"
    elif locator_lower.startswith("id="):
        return locator[3:].strip(), "id"
    elif locator_lower.startswith("name="):
        return locator[5:].strip(), "name"
    elif locator_lower.startswith("#"):
        return locator[1:], "id"
    elif locator_lower.startswith("."):
        return locator, "css"
    else:
        return locator, "css"


def determine_wait_condition(action: str, data: Optional[Dict[str, Any]]) -> tuple[Optional[str], Optional[str]]:
    """Determine wait condition based on action and data."""
    if action in ["navigate", "click"]:
        return "navigation", None
    elif action == "type":
        return "element", None
    else:
        return None, None


def step_trace_to_executable(step: StepTrace) -> Optional[ExecutableStep]:
    """Convert a StepTrace to an ExecutableStep."""
    action_mapping = {
        "navigate": "navigate",
        "click": "click",
        "type": "type",
        "input": "type",
        "fill": "fill_form",
        "select": "select",
        "wait": "wait",
        "scroll": "scroll",
        "screenshot": "screenshot",
        "press": "press_key",
        "keypress": "press_key",
    }
    
    action_lower = step.action.lower()
    executable_action = None
    
    for key, value in action_mapping.items():
        if key in action_lower:
            executable_action = value
            break
    
    if not executable_action:
        return None
    
    selector, selector_type = extract_selector_from_locator(step.locator)
    
    if not selector and step.target:
        selector = step.target
        selector_type = "css"
    
    value = None
    if step.data:
        if "text" in step.data:
            value = step.data["text"]
        elif "value" in step.data:
            value = step.data["value"]
        elif "url" in step.data:
            value = step.data["url"]
        elif executable_action == "fill_form":
            value = step.data
    
    wait_for, wait_selector = determine_wait_condition(step.action, step.data)
    
    return ExecutableStep(
        action=executable_action,
        selector=selector,
        selector_type=selector_type,
        value=str(value) if value is not None else None,
        wait_for=wait_for,
        wait_selector=wait_selector,
        wait_timeout_ms=5000,
        retry_count=0,
        index=step.index,
        description=f"{step.action} on {step.target or step.locator or 'page'}",
    )


def convert_step_traces_to_executable(steps: List[StepTrace]) -> List[ExecutableStep]:
    """Convert a list of StepTrace to ExecutableStep."""
    executable_steps = []
    
    for step in steps:
        executable_step = step_trace_to_executable(step)
        if executable_step:
            executable_steps.append(executable_step)
    
    return executable_steps

