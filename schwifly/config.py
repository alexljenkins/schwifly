import os
from typing import Optional, List
from dotenv import load_dotenv

load_dotenv()


class Config:
    GOOGLE_API_KEY: str = os.getenv("GOOGLE_API_KEY", "")
    APP_EMAIL: str = os.getenv("APP_EMAIL", "")
    APP_PASSWORD: str = os.getenv("APP_PASSWORD", "")
    BASE_URL_DEFAULT: str = os.getenv("BASE_URL_DEFAULT", "")
    TIMEOUT_SEC: int = int(os.getenv("TIMEOUT_SEC", "300"))
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "WARN")
    HEADLESS: bool = os.getenv("HEADLESS", "true").lower() == "true"
    MAX_CONCURRENT_TESTS: int = int(os.getenv("MAX_CONCURRENT_TESTS", "5"))
    ALLOWED_DOMAINS: Optional[List[str]] = None
    
    # Test defaults
    PROCEDURAL_USE: bool = os.getenv("PROCEDURAL_USE", "false").lower() == "true"
    PROCEDURAL_UPDATE: str = os.getenv("PROCEDURAL_UPDATE", "ai_success")
    PROCEDURAL_VALIDATE_AGAINST: str = os.getenv("PROCEDURAL_VALIDATE_AGAINST", "outcome")
    TEST_ENV: Optional[str] = os.getenv("TEST_ENV", None)
    TEST_CREDS_OVERRIDE: Optional[str] = os.getenv("TEST_CREDS_OVERRIDE", None)
    
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

