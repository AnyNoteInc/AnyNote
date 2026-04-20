"""Route registration for the agents REST API."""

from __future__ import annotations

from fastapi import FastAPI

from agents.apps.chat.router import router as chat_router
from agents.entrypoints.rest.health import router as health_router


def apply_routes(app: FastAPI) -> None:
    app.include_router(health_router)
    app.include_router(chat_router)
