from abc import ABC, abstractmethod
from typing import List, Optional, Dict, Any
from schwifly.models import Step

class BaseTestRunner(ABC):
    """Abstract base class for test runners."""

    @abstractmethod
    async def run(
        self,
        test_id: str,
        process: str,
        starting_url: str,
        creds_override: Optional[Dict[str, Any]] = None,
        headless: bool = True,
        auth: Optional[str] = None
    ) -> List[Step]:
        """
        Execute the test and return a list of steps.
        
        Args:
            test_id: Unique identifier for the test
            process: Description of the process to execute
            starting_url: URL to start the test from
            creds_override: Optional credentials to override defaults
            headless: Whether to run in headless mode
            auth: Optional authentication state/token
            
        Returns:
            List of executed steps
        """
        pass
