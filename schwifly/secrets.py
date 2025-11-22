import re
from typing import Dict, Any, List, Set, Optional
from schwifly.config import config


def build_sensitive_data(creds_override: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    sensitive_data = {
        "username": config.APP_EMAIL,
        "password": config.APP_PASSWORD,
    }
    
    if creds_override:
        sensitive_data.update(creds_override)
    
    return sensitive_data


def redact_dict(data: Dict[str, Any], redacted_keys: Set[str] = None) -> tuple[Dict[str, Any], List[str]]:
    if redacted_keys is None:
        redacted_keys = {"password", "api_key", "token", "secret", "username"}
    
    redacted = {}
    redactions = []
    
    for key, value in data.items():
        key_lower = key.lower()
        should_redact = any(sensitive in key_lower for sensitive in redacted_keys)
        
        if should_redact:
            redacted[key] = "***REDACTED***"
            redactions.append(f"{key} (redacted)")
        elif isinstance(value, dict):
            nested_redacted, nested_redactions = redact_dict(value, redacted_keys)
            redacted[key] = nested_redacted
            redactions.extend([f"{key}.{r}" for r in nested_redactions])
        elif isinstance(value, list):
            redacted[key] = [
                redact_dict(item, redacted_keys)[0] if isinstance(item, dict) else item
                for item in value
            ]
        else:
            redacted[key] = value
    
    return redacted, redactions


def redact_string(text: str, redacted_keys: Set[str] = None) -> str:
    if redacted_keys is None:
        redacted_keys = {"password", "api_key", "token", "secret"}
    
    redacted = text
    for key in redacted_keys:
        pattern = rf"\b{key}\s*[:=]\s*['\"]?([^'\"]+)['\"]?"
        redacted = re.sub(pattern, rf"{key}: ***REDACTED***", redacted, flags=re.IGNORECASE)
    
    return redacted

