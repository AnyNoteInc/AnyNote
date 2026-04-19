"""Health endpoint.

DB reachability is reported as 'unknown' in B1; a real ping against the
asyncpg pool will be wired via Dishka in a later iteration."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "database": "unknown", "version": "0.1.0"}
