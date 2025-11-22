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
from schwifly.models import HistoricalConfig
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
    
    # Construct HistoricalConfig object
    hist_data = test_data.get("historical", {})
    historical = HistoricalConfig(
        use=hist_data.get("use", False),
        update=hist_data.get("update", "success"),
        validate_against=hist_data.get("validate_against", "outcome")
    )
    
    try:
        report = await run_test(
            test_id=test_id,
            process=test_data.get("process"),
            validation=test_data.get("validation"),
            starting_url=test_data.get("starting_url"),
            historical=historical,
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
    headless: bool = typer.Option(True, help="Run browser in headless mode"),
    verbose: bool = typer.Option(False, help="Show detailed output"),
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
                if isinstance(content, list):
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
                    return {"id": test_id, "status": "PASS", "duration": report.duration_sec}
                else:
                    console.print(f"[bold cyan]{test_id}[/bold cyan] [red]✘ FAIL[/red]")
                    if report and report.verdict.reasons:
                        for reason in report.verdict.reasons:
                            console.print(f"  [red]{test_id} Reason: {reason}[/red]")
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
