"""Tests for the embeddings provider selector."""

from __future__ import annotations

import pytest

from indexer.exceptions import EmbeddingsError
from indexer.services.embeddings import create_embeddings
from indexer.services.embeddings.ollama import OllamaEmbeddings
from indexer.services.embeddings.openai import OpenAIEmbeddings
from indexer.settings import Settings


def test_factory_picks_ollama_by_default() -> None:
    s = Settings()
    provider = create_embeddings(s)
    assert isinstance(provider, OllamaEmbeddings)
    assert provider.dim == 768


def test_factory_picks_openai(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EMBEDDINGS_PROVIDER", "openai")
    monkeypatch.setenv("EMBEDDINGS_MODEL", "text-embedding-3-small")
    monkeypatch.setenv("EMBEDDINGS_DIM", "1536")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    s = Settings()
    provider = create_embeddings(s)
    assert isinstance(provider, OpenAIEmbeddings)
    assert provider.dim == 1536


def test_factory_rejects_unknown(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EMBEDDINGS_PROVIDER", "weird")
    s = Settings()
    with pytest.raises(EmbeddingsError):
        create_embeddings(s)
