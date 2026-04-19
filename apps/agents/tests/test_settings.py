"""Unit tests for settings loading from environment variables."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from agents.settings import Settings


def test_settings_reads_required_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENTS_DATABASE_URL", "postgresql://u:p@h:5432/agents")
    monkeypatch.setenv("AGENTS_SERVICE_TOKEN", "secret-token")
    s = Settings()
    assert s.agents_database_url == "postgresql://u:p@h:5432/agents"
    assert s.agents_service_token == "secret-token"
    assert s.agents_log_level == "INFO"
    assert s.ollama_base_url == "http://localhost:11434"
    assert s.ollama_default_model == "gemma4"


def test_settings_uses_ollama_overrides(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENTS_DATABASE_URL", "postgresql://u:p@h:5432/agents")
    monkeypatch.setenv("AGENTS_SERVICE_TOKEN", "t")
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://ollama:11434")
    monkeypatch.setenv("OLLAMA_DEFAULT_MODEL", "llama3.1")
    s = Settings()
    assert s.ollama_base_url == "http://ollama:11434"
    assert s.ollama_default_model == "llama3.1"


def test_settings_missing_required_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGENTS_DATABASE_URL", raising=False)
    monkeypatch.delenv("AGENTS_SERVICE_TOKEN", raising=False)
    with pytest.raises(ValidationError):
        Settings()
