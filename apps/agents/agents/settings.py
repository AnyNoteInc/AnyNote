"""Service configuration loaded from environment variables."""

from __future__ import annotations

import json

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Reads service configuration from the process environment.

    Values come from the repo-root .env via docker compose / shell —
    pydantic-settings does not read files here.
    """

    model_config = SettingsConfigDict(env_file=None, extra="ignore", populate_by_name=True)

    agents_database_url: str = Field(alias="AGENTS_DATABASE_URL")
    agents_service_token: str = Field(alias="AGENTS_SERVICE_TOKEN")
    agents_log_level: str = Field(default="INFO", alias="AGENTS_LOG_LEVEL")
    debug: bool = Field(default=False, alias="DEBUG")
    cors_origins: list[str] = Field(default_factory=list, alias="CORS_ORIGINS")
    sentry_dsn: str | None = Field(default=None, alias="SENTRY_DSN")
    ollama_base_url: str = Field(default="http://localhost:11434", alias="OLLAMA_BASE_URL")
    ollama_default_model: str = Field(default="gemma4", alias="OLLAMA_DEFAULT_MODEL")

    @field_validator("debug", mode="before")
    @classmethod
    def _parse_debug(cls, value: object) -> object:
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"1", "true", "yes", "on", "debug"}:
                return True
            if normalized in {"0", "false", "no", "off", "", "release"}:
                return False
        return value

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _parse_cors_origins(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        stripped = value.strip()
        if not stripped:
            return []
        if stripped.startswith("["):
            return json.loads(stripped)
        return [origin.strip() for origin in stripped.split(",") if origin.strip()]
