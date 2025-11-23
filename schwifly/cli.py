import typer
import asyncio
import json
import logging
from pathlib import Path
from typing import Optional
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from schwifly.runner import run_test
from schwifly.models import ProceduralConfig, TestResult
from schwifly.config import config

app = typer.Typer()
console = Console()

# Suppress other loggers
logging.basicConfig(level=logging.ERROR)

async def run_single_test(test_data: dict, headless: bool = True) -> Optional[TestResult]:
    test_id = test_data.get("test_id", "unknown")
    
    proc_data = test_data.get("procedural", {})
    procedural = ProceduralConfig(
        use=proc_data.get("use", False),
        update=proc_data.get("update", "ai_success"),
        validate_against=proc_data.get("validate_against", "outcome")
    )
    
    try:
        result = await run_test(
            test_id=test_id,
            process=test_data.get("process"),
            validation=test_data.get("validation"),
            starting_url=test_data.get("starting_url"),
            procedural=procedural,
            env=test_data.get("env"),
            creds_override=test_data.get("creds_override"),
            headless=test_data.get("headless", headless)
        )
        return result
    except Exception as e:
        console.print(f"[red]Error running test {test_id}: {str(e)}[/red]")
        return None

@app.command()
def run(
    path: Path = typer.Argument(..., help="Path to a JSON test file"),
    headless: bool = typer.Option(None, help="Run browser in headless mode"),
    procedural: bool = typer.Option(None, help="Use procedural test data"),
    env: str = typer.Option(None, help="Environment to use"),
):
    """
    Run Schwifly tests.
    """
    if not path.exists():
        console.print(f"[red]Error: Path {path} does not exist[/red]")
        raise typer.Exit(code=1)

    tests_to_run = []
    
    if path.is_file():
        try:
            with open(path, "r") as f:
                content = json.load(f)
                if isinstance(content, dict) and "tests" in content:
                    tests_to_run.extend(content["tests"])
                elif isinstance(content, list):
                    tests_to_run.extend(content)
                else:
                    tests_to_run.append(content)
        except json.JSONDecodeError:
            console.print(f"[red]Error: Invalid JSON in {path}[/red]")
            raise typer.Exit(code=1)
    
    # Config resolution
    effective_headless = headless if headless is not None else config.HEADLESS
    effective_procedural_use = procedural if procedural is not None else config.PROCEDURAL_USE
    effective_env = env if env is not None else config.TEST_ENV
    
    for test in tests_to_run:
        if "headless" not in test:
            test["headless"] = effective_headless
        if "procedural" not in test:
            test["procedural"] = {
                "use": effective_procedural_use,
                "update": config.PROCEDURAL_UPDATE,
                "validate_against": config.PROCEDURAL_VALIDATE_AGAINST
            }
        if "env" not in test:
            test["env"] = effective_env
        if "creds_override" not in test:
            test["creds_override"] = config.TEST_CREDS_OVERRIDE

    if not tests_to_run:
        console.print("[yellow]No tests found to run.[/yellow]")
        return

    console.print(Panel(f"Running {len(tests_to_run)} tests...", title="Schwifly", border_style="blue"))

    semaphore = asyncio.Semaphore(config.MAX_CONCURRENT_TESTS)
    
    async def run_test_with_semaphore(test):
        async with semaphore:
            return await run_single_test(test, effective_headless)

    async def run_all_tests():
        tasks = [run_test_with_semaphore(test) for test in tests_to_run]
        return await asyncio.gather(*tasks)

    results = asyncio.run(run_all_tests())

    # Display detailed results for each test
    for res in results:
        if res is None:
            continue
            
        console.print(f"\n[bold]Test: {res.test_id}[/bold]")
        
        # Display per-validation results if available
        if res.verdict.rule_results:
            console.print("  Validations:")
            passed_validations = 0
            total_validations = len(res.verdict.rule_results)
            
            for rule_result in res.verdict.rule_results:
                status_color = "green" if rule_result.passed else "red"
                status_text = "PASS" if rule_result.passed else "FAIL"
                
                console.print(f"    [{status_color}]{rule_result.rule.split(':')[0]} {status_text}[/{status_color}]: {rule_result.rule.split(':', 1)[1].strip() if ':' in rule_result.rule else rule_result.rule}")
                
                if rule_result.reason:
                    console.print(f"         {rule_result.reason}", style="dim")
                
                if rule_result.passed:
                    passed_validations += 1
            
            # Validation summary
            summary_color = "green" if passed_validations == total_validations else "red"
            console.print(f"  [{summary_color}]Result: {passed_validations}/{total_validations} validations passed[/{summary_color}]")
        
        # Overall verdict
        verdict_color = "green" if res.status == "PASS" else "red"
        console.print(f"  [{verdict_color}]Verdict: {res.status}[/{verdict_color}] (Duration: {res.duration_sec:.2f}s)")

    # Summary Table
    console.print("\n[bold]Test Summary[/bold]")
    table = Table(show_header=True, header_style="bold magenta")
    table.add_column("Test ID")
    table.add_column("Status")
    table.add_column("Duration (s)", justify="right")

    passed_count = 0
    valid_results = [r for r in results if r is not None]
    
    for res in valid_results:
        status_style = "green" if res.status == "PASS" else "red"
        table.add_row(
            res.test_id, 
            f"[{status_style}]{res.status}[/{status_style}]", 
            f"{res.duration_sec:.2f}"
        )
        if res.status == "PASS":
            passed_count += 1

    console.print(table)
    
    total = len(valid_results)
    if total > 0:
        success_rate = (passed_count / total) * 100
        color = "green" if success_rate == 100 else "red"
        console.print(f"[{color}]Success Rate: {passed_count}/{total} ({success_rate:.1f}%)[/{color}]")

    if passed_count < total:
        raise typer.Exit(code=1)

if __name__ == "__main__":
    app()
