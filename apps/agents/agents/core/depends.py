"""Shared providers used by multiple apps (processing, chat)."""

from __future__ import annotations

from collections.abc import AsyncIterator

from dishka import Provider, Scope, provide
from fast_clean.repositories import SettingsRepositoryProtocol
from fast_clean.schemas import BearerTokenAuthSchema
from qdrant_client import AsyncQdrantClient

from agents.settings import SettingsSchema


class VectorsProvider(Provider):
    scope = Scope.APP

    @provide
    async def qdrant_client(
        self,
        settings_repository: SettingsRepositoryProtocol,
    ) -> AsyncIterator[AsyncQdrantClient]:
        settings = await settings_repository.get(SettingsSchema)
        auth = settings.qdrant.auth
        api_key = auth.bearer_token if isinstance(auth, BearerTokenAuthSchema) else None
        client = AsyncQdrantClient(
            url=str(settings.qdrant.host).rstrip('/'),
            api_key=api_key,
        )
        try:
            yield client
        finally:
            await client.close()


provider = VectorsProvider()
