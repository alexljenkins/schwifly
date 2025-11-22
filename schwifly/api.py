from fastapi import FastAPI, HTTPException
from schwifly.models import RunTestRequest, RunTestResponse
from schwifly.runner import run_test
from schwifly.config import config


config.validate()

app = FastAPI(title="Schwifly UX Tester")


@app.post("/run-test", response_model=RunTestResponse)
async def run_test_endpoint(request: RunTestRequest) -> RunTestResponse:
    try:
        report = await run_test(
            test_id=request.test_id,
            process=request.process,
            validation=request.validation,
            starting_url=request.starting_url,
            procedural=request.procedural,
            env=request.env,
            creds_override=request.creds_override,
            headless=request.headless,
        )
        
        return RunTestResponse(
            status="completed",
            passed=report.verdict.passed,
            duration=report.duration_sec,
            report_path=report.artifacts.report_path,
            report_json=report,
            previous_run_used=report.previous_run_used,
            diff_summary=report.step_diff,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal error: {str(e)}")

@app.get("/health")
async def health():
    return {"status": "ok"}

