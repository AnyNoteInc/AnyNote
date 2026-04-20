"""FastAPI bootstrap for the agents service."""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable, Iterable
from contextlib import asynccontextmanager

from dishka import make_async_container
from dishka.integrations.fastapi import setup_dishka
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from agents.apps.chat.depends import (
    ChatAppProvider,
    ChatAppSingletonsProvider,
    ChatRequestProvider,
)
from agents.apps.chat.errors import AgentException as ChatAgentException
from agents.exceptions import AgentException as LegacyAgentException
from agents.settings import Settings

RouteApplier = Callable[[FastAPI], None]


def _agent_exception_handler(
    _request: Request,
    exc: ChatAgentException | LegacyAgentException,
) -> JSONResponse:
    return JSONResponse(
        status_code=exc.http_status,
        content={"error": {"code": exc.code, "message": str(exc)}},
    )


def create_app(use_routes: Iterable[RouteApplier]) -> FastAPI:
    settings = Settings()
    container = make_async_container(
        ChatAppProvider(),
        ChatAppSingletonsProvider(),
        ChatRequestProvider(),
        context={Settings: settings},
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        try:
            yield
        finally:
            await container.close()

    app = FastAPI(
        title="AnyNote Agents",
        version="0.1.0",
        debug=settings.debug,
        lifespan=lifespan,
    )
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
    app.add_exception_handler(ChatAgentException, _agent_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(LegacyAgentException, _agent_exception_handler)  # type: ignore[arg-type]
    setup_dishka(container=container, app=app)

    for apply_route in use_routes:
        apply_route(app)

    return app
