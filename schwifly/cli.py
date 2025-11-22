import typer
import asyncio
import json
import logging
from pathlib import Path
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from schwifly.runner import run_test
from schwifly.models import ProceduralConfig
from schwifly.config import config

app = typer.Typer()
console = Console()

# Configure logging to file only, disable console logging from libraries
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[
        logging.FileHandler("schwifly_cli.log"),
    ]
)

# Suppress other loggers from printing to stdout
for logger_name in logging.root.manager.loggerDict:
    if logger_name.startswith("schwifly"):
        continue
    logging.getLogger(logger_name).setLevel(logging.WARNING)


async def run_single_test(test_data: dict, headless: bool = True):
    test_id = test_data.get("test_id", "unknown")
    
    # Construct ProceduralConfig object
    proc_data = test_data.get("procedural", {})
    procedural = ProceduralConfig(
        use=proc_data.get("use", False),
        update=proc_data.get("update", "ai_success"),
        validate_against=proc_data.get("validate_against", "outcome")
    )
    
    try:
        report = await run_test(
            test_id=test_id,
            process=test_data.get("process"),
            validation=test_data.get("validation"),
            starting_url=test_data.get("starting_url"),
            procedural=procedural,
            env=test_data.get("env"),
            creds_override=test_data.get("creds_override"),
            headless=test_data.get("headless", headless)
        )
        return report
    except Exception as e:
        console.print(f"[red]Error running test {test_id}: {str(e)}[/red]")
        return None


@app.command()
def run(
    path: Path = typer.Argument(..., help="Path to a JSON test file or directory of tests"),
    headless: bool = typer.Option(None, help="Run browser in headless mode (overrides config)"),
    verbose: bool = typer.Option(False, help="Show detailed output"),
    use_procedural: bool = typer.Option(None, help="Use procedural test data (overrides config)"),
    env: str = typer.Option(None, help="Environment to use for tests (overrides config)"),
):
    """
    Run Schwifly tests from a JSON file.
    """
    if not path.exists():
        console.print(f"[red]Error: Path {path} does not exist[/red]")
        raise typer.Exit(code=1)

    tests_to_run = []
    
    if path.is_file():
        try:
            with open(path, "r") as f:
                content = json.load(f)
                
                # Support both array format and object with "tests" key
                if isinstance(content, dict) and "tests" in content:
                    tests_to_run.extend(content["tests"])
                elif isinstance(content, list):
                    tests_to_run.extend(content)
                else:
                    tests_to_run.append(content)
        except json.JSONDecodeError:
            console.print(f"[red]Error: Invalid JSON in {path}[/red]")
            raise typer.Exit(code=1)
    elif path.is_dir():
        # TODO: Implement directory scanning
        console.print("[yellow]Directory scanning not yet implemented. Please specify a file.[/yellow]")
        return
    
    # Determine effective values from CLI or config
    effective_headless = headless if headless is not None else config.HEADLESS
    effective_procedural_use = use_procedural if use_procedural is not None else config.PROCEDURAL_USE
    effective_env = env if env is not None else config.TEST_ENV
    
    # Apply config defaults to tests that don't have explicit values
    for test in tests_to_run:
        # Apply headless default from CLI or config if not specified
        if "headless" not in test:
            test["headless"] = effective_headless
        
        # Apply procedural defaults if not specified
        if "procedural" not in test:
            test["procedural"] = {
                "use": effective_procedural_use,
                "update": config.PROCEDURAL_UPDATE,
                "validate_against": config.PROCEDURAL_VALIDATE_AGAINST
            }
        
        # Apply env and creds_override defaults if not specified
        if "env" not in test:
            test["env"] = effective_env
        if "creds_override" not in test:
            test["creds_override"] = config.TEST_CREDS_OVERRIDE

    if not tests_to_run:
        console.print("[yellow]No tests found to run.[/yellow]")
        return

    console.print(Panel(f"Running {len(tests_to_run)} tests...", title="Schwifly", border_style="blue"))

    results = []
    
    # Run tests in parallel with semaphore
    semaphore = asyncio.Semaphore(config.MAX_CONCURRENT_TESTS)
    
    async def run_test_with_semaphore(test):
        test_id = test.get("test_id", "unknown")
        async with semaphore:
            console.print(f"Starting [bold cyan]{test_id}[/bold cyan]...")
            try:
                report = await run_single_test(test, headless)
                
                if report and report.verdict.passed:
                    console.print(f"[bold cyan]{test_id}[/bold cyan] [green]✔ PASS[/green]")
                    # Show rule details if available even on pass
                    if report.rule_evaluation and report.rule_evaluation.rule_results:
                        for rr in report.rule_evaluation.rule_results:
                            status_icon = "✔" if rr.passed else "✘"
                            status_color = "green" if rr.passed else "red"
                            console.print(f"  [{status_color}]{status_icon} {rr.rule}[/{status_color}]")
                    return {"id": test_id, "status": "PASS", "duration": report.duration_sec}
                else:
                    console.print(f"[bold cyan]{test_id}[/bold cyan] [red]✘ FAIL[/red]")
                    
                    # Show rule details
                    if report and report.rule_evaluation and report.rule_evaluation.rule_results:
                        for rr in report.rule_evaluation.rule_results:
                            status_icon = "✔" if rr.passed else "✘"
                            status_color = "green" if rr.passed else "red"
                            console.print(f"  [{status_color}]{status_icon} {rr.rule}[/{status_color}]")
                            if not rr.passed and rr.reason:
                                console.print(f"    [red]Reason: {rr.reason}[/red]")
                    
                    # Show general reasons if no specific rule results or as supplement
                    if report and report.verdict.reasons:
                        console.print("  [bold]Verdict Reasons:[/bold]")
                        for reason in report.verdict.reasons:
                            console.print(f"  [red]- {reason}[/red]")
                            
                    return {"id": test_id, "status": "FAIL", "duration": report.duration_sec if report else 0}
            except Exception as e:
                console.print(f"[bold cyan]{test_id}[/bold cyan] [red]✘ ERROR[/red]")
                console.print(f"  [red]{str(e)}[/red]")
                return {"id": test_id, "status": "ERROR", "duration": 0}

    async def run_all_tests():
        tasks = [run_test_with_semaphore(test) for test in tests_to_run]
        return await asyncio.gather(*tasks)

    results = asyncio.run(run_all_tests())

    # Summary
    console.print("\n[bold]Test Summary[/bold]")
    table = Table(show_header=True, header_style="bold magenta")
    table.add_column("Test ID")
    table.add_column("Status")
    table.add_column("Duration (s)", justify="right")

    passed_count = 0
    for res in results:
        status_style = "green" if res["status"] == "PASS" else "red"
        table.add_row(res["id"], f"[{status_style}]{res['status']}[/{status_style}]", f"{res['duration']:.2f}")
        if res["status"] == "PASS":
            passed_count += 1

    console.print(table)
    
    success_rate = (passed_count / len(results)) * 100 if results else 0
    color = "green" if success_rate == 100 else "red"
    console.print(f"[{color}]Success Rate: {passed_count}/{len(results)} ({success_rate:.1f}%)[/{color}]")

    if passed_count < len(results):
        raise typer.Exit(code=1)


if __name__ == "__main__":
    app()
