"""Dishka providers for the chat application."""

from __future__ import annotations

from collections.abc import AsyncIterator

import asyncpg  # type: ignore[import-untyped]
from dishka import Provider, Scope, from_context, provide
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from agents.apps.chat.repositories.model_factory import create_chat_model
from agents.apps.chat.repositories.prompt_renderer import JinjaRenderer
from agents.apps.chat.services.graph_service import CompiledGraph, build_graph
from agents.apps.chat.use_cases import GenerateStreamUseCase
from agents.settings import Settings


class ChatAppProvider(Provider):
    """APP-scoped runtime resources shared across routes."""

    scope = Scope.APP

    settings = from_context(provides=Settings, scope=Scope.APP)

    @provide
    async def pool(self, settings: Settings) -> AsyncIterator[asyncpg.Pool]:
        pool = await asyncpg.create_pool(settings.agents_database_url)
        try:
            yield pool
        finally:
            await pool.close()

    @provide
    async def checkpointer(self, settings: Settings) -> AsyncIterator[AsyncPostgresSaver]:
        async with AsyncPostgresSaver.from_conn_string(settings.agents_database_url) as saver:
            await saver.setup()
            yield saver


class ChatAppSingletonsProvider(Provider):
    """APP-scoped singletons built from chat repositories and services."""

    scope = Scope.APP

    @provide
    def renderer(self) -> JinjaRenderer:
        return JinjaRenderer()

    @provide
    def graph(self, renderer: JinjaRenderer, checkpointer: AsyncPostgresSaver) -> CompiledGraph:
        return build_graph(
            renderer=renderer,
            checkpointer=checkpointer,
            llm_factory=create_chat_model,
        )


class ChatRequestProvider(Provider):
    """REQUEST-scoped use cases."""

    scope = Scope.REQUEST

    @provide
    def generate_stream_use_case(self, graph: CompiledGraph) -> GenerateStreamUseCase:
        return GenerateStreamUseCase(graph)
