"""Dishka providers for the engines service."""

from __future__ import annotations

from collections.abc import AsyncIterator

import asyncpg  # type: ignore[import-untyped]
from dishka import Provider, Scope, from_context, provide
from qdrant_client import AsyncQdrantClient

from engines.services.embeddings import OllamaEmbeddings
from engines.services.page_repo import PageRepo
from engines.services.search import SearchService
from engines.settings import Settings


class AppProvider(Provider):
    scope = Scope.APP
    settings = from_context(provides=Settings, scope=Scope.APP)

    @provide(scope=Scope.APP)
    async def db_pool(self, settings: Settings) -> AsyncIterator[asyncpg.Pool]:
        pool = await asyncpg.create_pool(settings.engines_database_url, min_size=1, max_size=4)
        try:
            yield pool
        finally:
            await pool.close()

    @provide(scope=Scope.APP)
    async def qdrant_client(self, settings: Settings) -> AsyncIterator[AsyncQdrantClient]:
        client = AsyncQdrantClient(
            url=settings.engines_qdrant_url,
            api_key=settings.engines_qdrant_api_key,
        )
        try:
            yield client
        finally:
            await client.close()


class AppSingletonsProvider(Provider):
    scope = Scope.APP

    @provide(scope=Scope.APP)
    def page_repo(self, pool: asyncpg.Pool) -> PageRepo:
        return PageRepo(pool=pool)

    @provide(scope=Scope.APP)
    def search(self, client: AsyncQdrantClient, settings: Settings) -> SearchService:
        return SearchService(client=client, collection=settings.engines_qdrant_collection)

    @provide(scope=Scope.APP)
    def embeddings(self, settings: Settings) -> OllamaEmbeddings:
        return OllamaEmbeddings(
            base_url=settings.ollama_base_url,
            model=settings.embeddings_model,
            dim=settings.embeddings_dim,
        )
