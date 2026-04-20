"""Embeddings provider abstraction."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from indexer.exceptions import EmbeddingsError
from indexer.settings import Settings


@runtime_checkable
class EmbeddingsProvider(Protocol):
    dim: int

    async def embed(self, texts: list[str]) -> list[list[float]]: ...


def create_embeddings(settings: Settings) -> EmbeddingsProvider:
    provider = settings.embeddings_provider.lower()
    if provider == "ollama":
        from indexer.services.embeddings.ollama import OllamaEmbeddings

        return OllamaEmbeddings(
            base_url=settings.ollama_base_url,
            model=settings.embeddings_model,
            dim=settings.embeddings_dim,
        )
    if provider == "openai":
        from indexer.services.embeddings.openai import OpenAIEmbeddings

        return OpenAIEmbeddings(
            api_key=settings.openai_api_key,
            model=settings.embeddings_model,
            dim=settings.embeddings_dim,
        )
    raise EmbeddingsError(f"Unknown EMBEDDINGS_PROVIDER: {settings.embeddings_provider!r}")
