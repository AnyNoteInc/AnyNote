"""Tests for the Settings class."""

from __future__ import annotations

from indexer.settings import Settings


def test_settings_load_defaults() -> None:
    s = Settings()
    assert s.indexer_qdrant_collection == "anynote-pages-test"
    assert s.indexer_batch == 16
    assert s.embeddings_dim == 768
    assert s.indexer_worker_id == "test-worker-123"


def test_settings_database_url_required() -> None:
    s = Settings()
    assert s.indexer_database_url.startswith("postgresql://")
