"""Dishka providers for the indexer."""

from __future__ import annotations

from collections.abc import AsyncIterator

import asyncpg  # type: ignore[import-untyped]
from dishka import Provider, Scope, from_context, provide
from qdrant_client import AsyncQdrantClient

from indexer.services.chunker import Chunker
from indexer.services.embeddings import EmbeddingsProvider, create_embeddings
from indexer.services.outbox import OutboxRepo
from indexer.services.qdrant_writer import QdrantWriter
from indexer.services.worker import IndexerWorker
from indexer.settings import Settings


class AppProvider(Provider):
    scope = Scope.APP
    settings = from_context(provides=Settings, scope=Scope.APP)

    @provide(scope=Scope.APP)
    async def db_pool(self, settings: Settings) -> AsyncIterator[asyncpg.Pool]:
        pool = await asyncpg.create_pool(settings.indexer_database_url, min_size=1, max_size=4)
        try:
            yield pool
        finally:
            await pool.close()

    @provide(scope=Scope.APP)
    async def qdrant_client(self, settings: Settings) -> AsyncIterator[AsyncQdrantClient]:
        client = AsyncQdrantClient(
            url=settings.indexer_qdrant_url,
            api_key=settings.indexer_qdrant_api_key,
        )
        try:
            yield client
        finally:
            await client.close()


class AppSingletonsProvider(Provider):
    scope = Scope.APP

    @provide(scope=Scope.APP)
    def chunker(self) -> Chunker:
        return Chunker()

    @provide(scope=Scope.APP)
    def embeddings(self, settings: Settings) -> EmbeddingsProvider:
        return create_embeddings(settings)

    @provide(scope=Scope.APP)
    def qdrant_writer(self, client: AsyncQdrantClient, settings: Settings) -> QdrantWriter:
        return QdrantWriter(client=client, settings=settings)

    @provide(scope=Scope.APP)
    def outbox_repo(self, pool: asyncpg.Pool, settings: Settings) -> OutboxRepo:
        return OutboxRepo(pool=pool, settings=settings)

    @provide(scope=Scope.APP)
    def worker(
        self,
        pool: asyncpg.Pool,
        outbox: OutboxRepo,
        chunker: Chunker,
        embeddings: EmbeddingsProvider,
        qdrant: QdrantWriter,
        settings: Settings,
    ) -> IndexerWorker:
        return IndexerWorker(
            pool=pool,
            outbox=outbox,
            chunker=chunker,
            embeddings=embeddings,
            qdrant=qdrant,
            settings=settings,
        )
