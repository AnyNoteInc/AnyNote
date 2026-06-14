from fast_clean.contrib.healthcheck.router import router as healthcheck_router
from fastapi import FastAPI

from agents.apps.agent.router import router as agent_router
from agents.apps.processing.router import router as processing_router
from agents.apps.search.router import router as search_router
from agents.apps.transcription.router import router as transcription_router
from agents.apps.validation.router import router as validation_router


def apply_routes(app: FastAPI) -> None:
    app.include_router(agent_router)
    app.include_router(healthcheck_router)
    app.include_router(processing_router)
    app.include_router(search_router)
    app.include_router(transcription_router)
    app.include_router(validation_router)
