"""Shared pytest fixtures for apps/agents tests."""

from __future__ import annotations

from collections.abc import Iterator

import pytest


@pytest.fixture(autouse=True)
def _fake_env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("AGENTS_DATABASE_URL", "postgresql://user:password@localhost:5432/agents")
    monkeypatch.setenv("AGENTS_SERVICE_TOKEN", "test-token-123")
    monkeypatch.setenv("AGENTS_LOG_LEVEL", "INFO")
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://localhost:11434")
    monkeypatch.setenv("OLLAMA_DEFAULT_MODEL", "gemma4")
    yield
