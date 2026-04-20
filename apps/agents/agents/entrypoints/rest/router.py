"""Aggregates REST routers into a single include target."""

from __future__ import annotations

from fastapi import APIRouter

from agents.apps.processing.router import processing_router
from agents.entrypoints.rest.generate import router as generate_router
from agents.entrypoints.rest.health import router as health_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(generate_router)
api_router.include_router(processing_router)
