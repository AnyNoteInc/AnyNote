"""Dishka providers for the chat application."""

from __future__ import annotations

from collections.abc import AsyncIterator

import asyncpg
from fast_clean.repositories import SettingsRepositoryProtocol
from dishka import Provider, Scope, from_context, provide
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from agents.settings import SettingsSchema

from .repositories import JinjaRendererRepository, ModelFactoryRepository, McpToolsRepository
from .services import GraphService 
from .use_cases import GenerateStreamUseCase


class ChatProvider(Provider):

    scope = Scope.REQUEST

    @provide(scope=Scope.APP)
    async def jinja_renderer_repository(self, settings_repository: SettingsRepositoryProtocol) -> JinjaRendererRepository:
        settings = await settings_repository.get(SettingsSchema)
        return JinjaRendererRepository(settings)


    @provide(scope=Scope.APP)
    async def checkpointer(self, settings_repository: SettingsRepositoryProtocol) -> AsyncIterator[AsyncPostgresSaver]:
        settings = await settings_repository.get(SettingsSchema)
        async with AsyncPostgresSaver.from_conn_string(settings.db.dsn) as saver:
            await saver.setup()
            yield saver
    
    model_factory_repository = provide(ModelFactoryRepository, scope=Scope.APP)
    mcp_tools_repository = provide(McpToolsRepository, scope=Scope.APP)

    graph_service = provide(GraphService)

    generate_stream_use_case = provide(GenerateStreamUseCase)


prodiver = ChatProvider()
