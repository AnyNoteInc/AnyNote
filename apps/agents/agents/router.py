from fastapi import FastAPI

from fast_clean.contrib.healthcheck.router import router as healthcheck_router
from agents.apps.chat.router import router as chat_router
from agents.apps.processing.router import router as processing_router


def apply_routes(app: FastAPI) -> None:
    app.include_router(chat_router)
    app.include_router(healthcheck_router)
    app.include_router(processing_router)
