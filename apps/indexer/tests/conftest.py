"""Test fixtures for the indexer service."""

from __future__ import annotations

from collections.abc import Iterator

import pytest


@pytest.fixture(autouse=True)
def _deterministic_env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("INDEXER_DATABASE_URL", "postgresql://user:password@localhost:5432/anynote")
    monkeypatch.setenv("INDEXER_QDRANT_URL", "http://localhost:6333")
    monkeypatch.setenv("INDEXER_QDRANT_API_KEY", "dev-qdrant-key")
    monkeypatch.setenv("INDEXER_QDRANT_COLLECTION", "anynote-pages-test")
    monkeypatch.setenv("INDEXER_WORKER_ID", "test-worker-123")
    monkeypatch.setenv("EMBEDDINGS_PROVIDER", "ollama")
    monkeypatch.setenv("EMBEDDINGS_MODEL", "nomic-embed-text")
    monkeypatch.setenv("EMBEDDINGS_DIM", "768")
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://localhost:11434")
    yield
