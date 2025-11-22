from pathlib import Path
from schwifly.models import TestResult

class ArtifactService:
    def __init__(self, base_dir: str = "artifacts"):
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def get_run_dir(self, run_id: str) -> Path:
        run_dir = self.base_dir / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        return run_dir

    def save_report(self, result: TestResult) -> Path:
        run_dir = self.get_run_dir(result.run_id)
        report_path = run_dir / "report.json"
        
        with open(report_path, "w") as f:
            f.write(result.model_dump_json(indent=2))
            
        return report_path

    def save_screenshot(self, run_id: str, name: str, data_base64: str) -> Path:
        # Implementation depends on how we handle base64, 
        # assuming we decode and save as png
        import base64
        run_dir = self.get_run_dir(run_id)
        file_path = run_dir / f"{name}.png"
        
        with open(file_path, "wb") as f:
            f.write(base64.b64decode(data_base64))
            
        return file_path

    def get_log_path(self, run_id: str) -> Path:
        return self.get_run_dir(run_id) / "events.jsonl"
