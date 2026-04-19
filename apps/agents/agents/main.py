"""FastAPI application factory for the agents service."""

from __future__ import annotations

from fastapi import FastAPI

from agents.entrypoints.rest.health import router as health_router


def create_app() -> FastAPI:
    """Build the FastAPI app. Real Dishka wiring + /api/v1 router land in later tasks."""
    app = FastAPI(title="AnyNote Agents", version="0.1.0")
    app.include_router(health_router)
    return app


app = create_app()
