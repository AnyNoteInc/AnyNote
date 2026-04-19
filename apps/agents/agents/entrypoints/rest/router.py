"""Aggregates REST routers into a single include target.

Health stays unauthenticated. /api/v1/generate (added in Task 12) will
register itself as a sub-router with its own auth dependencies."""

from __future__ import annotations

from fastapi import APIRouter

from agents.entrypoints.rest.health import router as health_router

api_router = APIRouter()
api_router.include_router(health_router)
# generate_router included in Task 12
