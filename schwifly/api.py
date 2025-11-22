import asyncio
from fastapi import FastAPI, HTTPException
from typing import List
from datetime import datetime
from schwifly.models import (
    RunTestRequest,
    RunTestResponse,
    RunBulkRequest,
    RunBulkResponse,
    Report,
    StepDiff,
)
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
            historical=request.historical,
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


@app.post("/run-bulk", response_model=RunBulkResponse)
async def run_bulk_endpoint(request: RunBulkRequest) -> RunBulkResponse:
    results = []
    run_timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    semaphore = asyncio.Semaphore(config.MAX_CONCURRENT_TESTS)
    
    async def run_single_test(test_item):
        async with semaphore:
            try:
                report = await run_test(
                    test_id=test_item.test_id,
                    process=test_item.process,
                    validation=test_item.validation,
                    starting_url=test_item.starting_url,
                    historical=test_item.historical,
                    env=test_item.env,
                    creds_override=test_item.creds_override,
                    run_timestamp=run_timestamp,
                    headless=test_item.headless,
                    auth=test_item.auth,
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
            except Exception as e:
                return RunTestResponse(
                    status="error",
                    passed=False,
                    duration=0.0,
                    report_path="",
                    report_json=None,
                    previous_run_used=False,
                    diff_summary=StepDiff(),
                )

    tasks = [run_single_test(test_item) for test_item in request.tests]
    results = await asyncio.gather(*tasks)
    
    return RunBulkResponse(results=results)


@app.get("/health")
async def health():
    return {"status": "ok"}

