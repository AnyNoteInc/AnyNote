"""Health endpoint."""

from __future__ import annotations

from typing import Any

import asyncpg  # type: ignore[import-untyped]
from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
@inject
async def health(pool: FromDishka[asyncpg.Pool]) -> dict[str, Any]:
    """Returns service status + DB reachability + version.

    Pings the agents Postgres pool with `SELECT 1`; on any exception we
    report the database as unreachable but keep status=ok so liveness
    probes do not flap on transient DB hiccups (use a separate readiness
    endpoint when ops needs strict gating).
    """
    try:
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        database = "reachable"
    except Exception:
        database = "unreachable"
    return {"status": "ok", "database": database, "version": "0.1.0"}
