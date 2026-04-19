"""FastAPI application factory for the agents service."""

from fastapi import FastAPI


def create_app() -> FastAPI:
    """Build the FastAPI app. Routers + Dishka integration added in later tasks."""
    app = FastAPI(title="AnyNote Agents", version="0.1.0")
    return app


app = create_app()
