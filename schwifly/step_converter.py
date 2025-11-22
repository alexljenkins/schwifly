"""Convert StepTrace to ExecutableStep for replay."""
from typing import List, Optional, Dict, Any, Union
from schwifly.models import StepTrace, ExecutableStep, StepExecutedPayload


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


def step_trace_to_executable(step: Union[StepTrace, StepExecutedPayload], index: int = 0) -> Optional[ExecutableStep]:
    """Convert a StepTrace or StepExecutedPayload to an ExecutableStep."""
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
    
    action = step.action
    action_lower = action.lower()
    executable_action = None
    
    for key, value in action_mapping.items():
        if key in action_lower:
            executable_action = value
            break
    
    if not executable_action:
        return None
    
    # Extract data based on type
    locator = None
    target = None
    data = {}
    
    if isinstance(step, StepTrace):
        locator = step.locator
        target = step.target
        data = step.data or {}
        step_index = step.index
    else: # StepExecutedPayload
        params = step.params
        locator = params.get("locator") or params.get("selector")
        target = params.get("target") or params.get("url")
        data = params
        step_index = index
    
    selector, selector_type = extract_selector_from_locator(locator)
    
    if not selector and target:
        selector = target
        selector_type = "css"
    
    value = None
    if data:
        if "text" in data:
            value = data["text"]
        elif "value" in data:
            value = data["value"]
        elif "url" in data:
            value = data["url"]
        elif executable_action == "fill_form":
            value = data
    
    wait_for, wait_selector = determine_wait_condition(action, data)
    
    return ExecutableStep(
        action=executable_action,
        selector=selector,
        selector_type=selector_type,
        value=str(value) if value is not None else None,
        wait_for=wait_for,
        wait_selector=wait_selector,
        wait_timeout_ms=5000,
        retry_count=0,
        index=step_index,
        description=f"{action} on {target or locator or 'page'}",
    )


def convert_step_traces_to_executable(steps: Union[List[StepTrace], List[StepExecutedPayload]]) -> List[ExecutableStep]:
    """Convert a list of StepTrace or StepExecutedPayload to ExecutableStep."""
    executable_steps = []
    
    for i, step in enumerate(steps):
        executable_step = step_trace_to_executable(step, index=i)
        if executable_step:
            executable_steps.append(executable_step)
    
    return executable_steps

