"""Service configuration loaded from environment variables."""

from __future__ import annotations

from pydantic import Field
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
    ollama_base_url: str = Field(default="http://localhost:11434", alias="OLLAMA_BASE_URL")
    ollama_default_model: str = Field(default="gemma4", alias="OLLAMA_DEFAULT_MODEL")
