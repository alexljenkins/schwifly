import os
from typing import Optional
from dotenv import load_dotenv

load_dotenv()


class Config:
    GOOGLE_API_KEY: str = os.getenv("GOOGLE_API_KEY", "")
    APP_USERNAME: str = os.getenv("APP_USERNAME", "")
    APP_PASSWORD: str = os.getenv("APP_PASSWORD", "")
    BASE_URL_DEFAULT: str = os.getenv("BASE_URL_DEFAULT", "")
    TIMEOUT_SEC: int = int(os.getenv("TIMEOUT_SEC", "300"))
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")
    HEADLESS: bool = os.getenv("HEADLESS", "true").lower() == "true"

    @classmethod
    def validate(cls) -> None:
        if not cls.GOOGLE_API_KEY:
            raise ValueError("GOOGLE_API_KEY must be set in .env")


config = Config()

