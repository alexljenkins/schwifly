import json
from pathlib import Path
from typing import Dict, Any, Optional

def ensure_artifacts_dir(test_id: str) -> Path:
    artifacts_base = Path("artifacts")
    test_dir = artifacts_base / test_id
    test_dir.mkdir(parents=True, exist_ok=True)
    
    (test_dir / "logs").mkdir(exist_ok=True)
    (test_dir / "screenshots").mkdir(exist_ok=True)
    
    return test_dir

def load_latest_report(test_id: str) -> Optional[Dict[str, Any]]:
    latest_path = Path("artifacts") / test_id / "latest.json"
    if not latest_path.exists():
        return None
    
    with open(latest_path, "r") as f:
        return json.load(f)
