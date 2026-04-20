"""Indexer FastAPI app factory."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from dishka import make_async_container
from dishka.integrations.fastapi import setup_dishka
from fastapi import FastAPI

from indexer.di.providers import AppProvider, AppSingletonsProvider
from indexer.entrypoints.rest.router import api_router
from indexer.settings import Settings


def create_app() -> FastAPI:
    settings = Settings()
    container = make_async_container(
        AppProvider(),
        AppSingletonsProvider(),
        context={Settings: settings},
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        # Worker start/stop wiring lands in Task 10.
        yield

    app = FastAPI(title="AnyNote Indexer", version="0.1.0", lifespan=lifespan)
    app.include_router(api_router)
    setup_dishka(container=container, app=app)
    return app
