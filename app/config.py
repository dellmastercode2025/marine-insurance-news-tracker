"""Application configuration.

All secrets and deployment-specific values come from environment variables
(see .env.example). Nothing here is hard-coded.
"""
from __future__ import annotations

from functools import lru_cache
from zoneinfo import ZoneInfo

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Telegram
    telegram_bot_token: str = ""
    admin_telegram_user_ids: str = ""  # comma-separated numeric IDs

    # Database
    database_url: str = "sqlite+aiosqlite:///./data/app.db"

    # AI provider (OpenAI is the MVP default; layer is provider-agnostic)
    llm_provider: str = "openai"
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    openai_report_model: str = ""  # falls back to openai_model

    # App
    app_env: str = "development"
    log_level: str = "INFO"
    app_timezone: str = "Asia/Aqtau"
    admin_api_token: str = ""
    port: int = 8000

    # Scheduling (operational timezone applies)
    monitor_interval_minutes: int = 60
    daily_report_hour: int = 9
    daily_report_minute: int = 30
    weekly_report_day: str = "mon"
    weekly_report_hour: int = 9
    weekly_report_minute: int = 30

    # Pipeline tuning
    max_items_per_source_per_run: int = 30
    llm_max_items_per_run: int = 60
    snippet_max_chars: int = 1200

    @field_validator("llm_provider")
    @classmethod
    def _provider_lower(cls, v: str) -> str:
        return v.strip().lower()

    @property
    def admin_ids(self) -> list[int]:
        ids = []
        for part in self.admin_telegram_user_ids.replace(";", ",").split(","):
            part = part.strip()
            if part.isdigit():
                ids.append(int(part))
        return ids

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.app_timezone)

    @property
    def report_model(self) -> str:
        return self.openai_report_model or self.openai_model

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


@lru_cache
def get_settings() -> Settings:
    return Settings()
