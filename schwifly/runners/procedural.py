import logging
import importlib.util
import sys
from pathlib import Path
from typing import List, Optional, Dict, Any
from playwright.async_api import async_playwright, Page

from schwifly.runners.base import BaseTestRunner
from schwifly.models import Step, StepStatus
from schwifly.procedural_loader import load_executable_steps_for_replay

logger = logging.getLogger(__name__)

class ProceduralTestRunner(BaseTestRunner):
    """Runner for procedural tests (scripts or legacy replay)."""

    async def run(
        self,
        test_id: str,
        process: str,
        starting_url: str,
        creds_override: Optional[Dict[str, Any]] = None,
        headless: bool = True,
        auth: Optional[str] = None
    ) -> List[Step]:
        
        logger.info(f"Starting Procedural Runner for {test_id}")
        
        # 1. Try to find a python script
        script_path = Path(f"procedures/{test_id}.py")
        if script_path.exists():
            return await self._run_script(script_path, starting_url, headless, auth)
            
        # 2. Fallback to legacy replay (if available)
        # Note: In the future this might be removed or strictly separated
        logger.info(f"No script found at {script_path}, checking for legacy replay data...")
        executable_steps = load_executable_steps_for_replay(test_id)
        
        if executable_steps:
             # TODO: Implement actual replay logic here using Playwright
             # For now, we just log that we found them but return empty to trigger AI fallback
             # as the actual replay execution logic wasn't fully implemented in the old codebase either
             # (it was commented out in execution.py).
             # To fully implement this, we'd need to map ExecutableStep to Playwright calls.
             logger.warning("Legacy replay steps found but replay execution is not fully implemented yet.")
             return []

        logger.warning(f"No procedural method found for {test_id}")
        return []

    async def _run_script(
        self, 
        script_path: Path, 
        starting_url: str,
        headless: bool,
        auth: Optional[str]
    ) -> List[Step]:
        logger.info(f"Executing procedural script: {script_path}")
        
        try:
            # Load module dynamically
            spec = importlib.util.spec_from_file_location(f"procedures.{script_path.stem}", script_path)
            if not spec or not spec.loader:
                raise ImportError(f"Could not load spec for {script_path}")
                
            module = importlib.util.module_from_spec(spec)
            sys.modules[f"procedures.{script_path.stem}"] = module
            spec.loader.exec_module(module)
            
            if not hasattr(module, "run"):
                raise AttributeError(f"Script {script_path} does not have a 'run' function")

            # Execute with Playwright
            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=headless)
                # TODO: Handle auth storage state if provided
                context = await browser.new_context() 
                page = await context.new_page()
                
                # Run the script
                # We pass the page and maybe other context
                # The script is responsible for navigation (or we do it here?)
                # Let's assume script handles navigation or we pass starting_url
                
                # If the run function accepts starting_url, pass it
                # Otherwise just pass page
                
                # For simplicity/standardization, let's assume run(page) -> List[Step]
                # But we might want to navigate first?
                # Let's let the script handle it, but maybe provide the url?
                
                # Checking signature could be complex, let's try passing page
                steps = await module.run(page)
                
                await browser.close()
                
                return steps

        except Exception as e:
            logger.error(f"Failed to execute procedural script {script_path}: {e}")
            raise e # Re-raise to let caller know it failed
