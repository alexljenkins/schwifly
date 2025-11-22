import os
from typing import Optional, List
from dotenv import load_dotenv

load_dotenv()


class Config:
    GOOGLE_API_KEY: str = os.getenv("GOOGLE_API_KEY", "")
    APP_USERNAME: str = os.getenv("APP_USERNAME", "")
    APP_PASSWORD: str = os.getenv("APP_PASSWORD", "")
    BASE_URL_DEFAULT: str = os.getenv("BASE_URL_DEFAULT", "")
    TIMEOUT_SEC: int = int(os.getenv("TIMEOUT_SEC", "300"))
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "WARN")
    HEADLESS: bool = os.getenv("HEADLESS", "true").lower() == "true"
    MAX_CONCURRENT_TESTS: int = int(os.getenv("MAX_CONCURRENT_TESTS", "5"))
    ALLOWED_DOMAINS: Optional[List[str]] = None
    
    @classmethod
    def load_allowed_domains(cls) -> None:
        """Load ALLOWED_DOMAINS from environment (comma-separated)."""
        domains_str = os.getenv("ALLOWED_DOMAINS", "")
        if domains_str:
            cls.ALLOWED_DOMAINS = [d.strip() for d in domains_str.split(",")]

    @classmethod
    def validate(cls) -> None:
        if not cls.GOOGLE_API_KEY:
            raise ValueError("GOOGLE_API_KEY must be set in .env")


config = Config()
config.load_allowed_domains()

