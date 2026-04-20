"""Test fixtures for the engines service."""

from __future__ import annotations

from collections.abc import Iterator

import pytest


@pytest.fixture(autouse=True)
def _deterministic_env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:password@localhost:5432/anynote")
    monkeypatch.setenv("QDRANT_URL", "http://localhost:6333")
    monkeypatch.setenv("QDRANT_API_KEY", "dev-qdrant-key")
    monkeypatch.setenv("QDRANT_COLLECTION", "anynote-pages")
    monkeypatch.setenv("ENGINES_MCP_TOKEN", "test-engines-token")
    monkeypatch.setenv("EMBEDDINGS_PROVIDER", "ollama")
    monkeypatch.setenv("EMBEDDINGS_MODEL", "nomic-embed-text")
    monkeypatch.setenv("EMBEDDINGS_DIM", "768")
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://localhost:11434")
    yield
