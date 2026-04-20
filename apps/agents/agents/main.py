"""FastAPI application factory for the agents service."""

from __future__ import annotations

from dishka import make_async_container
from dishka.integrations.fastapi import setup_dishka
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from agents.apps.processing.depends import ProcessingProvider
from agents.di.providers import AppProvider, AppSingletonsProvider
from agents.entrypoints.rest.router import api_router
from agents.exceptions import AgentException
from agents.settings import Settings


def _agent_exception_handler(_request: Request, exc: AgentException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.http_status,
        content={"error": {"code": exc.code, "message": str(exc)}},
    )


def create_app() -> FastAPI:
    settings = Settings()
    container = make_async_container(
        AppProvider(),
        AppSingletonsProvider(),
        ProcessingProvider(),
        context={Settings: settings},
    )

    app = FastAPI(title="AnyNote Agents", version="0.1.0")
    app.include_router(api_router)
    app.add_exception_handler(AgentException, _agent_exception_handler)  # type: ignore[arg-type]

    setup_dishka(container=container, app=app)
    return app
