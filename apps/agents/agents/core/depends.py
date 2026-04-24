"""Shared providers used by multiple apps (processing, chat)."""

from __future__ import annotations

from collections.abc import AsyncIterator

from dishka import Provider, Scope, provide
from fast_clean.repositories import SettingsRepositoryProtocol
from langchain_ollama import OllamaEmbeddings
from qdrant_client import AsyncQdrantClient

from agents.settings import SettingsSchema


class VectorsProvider(Provider):
    scope = Scope.APP

    @provide
    async def qdrant_client(
        self, settings_repository: SettingsRepositoryProtocol,
    ) -> AsyncIterator[AsyncQdrantClient]:
        settings = await settings_repository.get(SettingsSchema)
        auth = settings.qdrant.auth
        client = AsyncQdrantClient(
            url=settings.qdrant.url,
            api_key=auth.bearer_token if auth else None,
        )
        try:
            yield client
        finally:
            await client.close()

    @provide
    async def ollama_embeddings(
        self, settings_repository: SettingsRepositoryProtocol,
    ) -> OllamaEmbeddings:
        settings = await settings_repository.get(SettingsSchema)
        return OllamaEmbeddings(
            base_url=settings.ollama.url,
            model=settings.ollama.embedding_model,
        )


provider = VectorsProvider()
