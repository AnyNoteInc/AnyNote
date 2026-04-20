"""Dishka Providers: APP-scoped resources (settings, pool, checkpointer)
and APP-scoped singletons (renderer, graph).

Settings is supplied via `from_context` so the app factory can pass a
preconfigured instance into the container at startup time.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import asyncpg  # type: ignore[import-untyped]
from dishka import Provider, Scope, from_context, provide
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from agents.services.graph import CompiledGraph, build_graph
from agents.services.prompt_renderer import JinjaRenderer
from agents.services.providers import create_chat_model
from agents.settings import Settings


class AppProvider(Provider):
    """Holds long-lived resources scoped to the application lifespan."""

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


class AppSingletonsProvider(Provider):
    """Holds APP-scoped singletons that depend on AppProvider's resources."""

    scope = Scope.APP

    @provide
    def renderer(self) -> JinjaRenderer:
        return JinjaRenderer()

    @provide
    def graph(self, renderer: JinjaRenderer, checkpointer: AsyncPostgresSaver) -> CompiledGraph:
        return build_graph(
            renderer=renderer,
            llm_factory=create_chat_model,
            checkpointer=checkpointer,
        )
