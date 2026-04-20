"""Health endpoint reports queue lag + qdrant reachability."""

from __future__ import annotations

from typing import Any

from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter

from indexer.services.outbox import OutboxRepo
from indexer.services.qdrant_writer import QdrantWriter

router = APIRouter()


@router.get("/health")
@inject
async def health(
    outbox: FromDishka[OutboxRepo],
    qdrant: FromDishka[QdrantWriter],
) -> dict[str, Any]:
    try:
        lag = await outbox.queue_lag()
        db_status = "reachable"
    except Exception as exc:
        lag = -1
        db_status = f"unreachable: {exc.__class__.__name__}"
    try:
        await qdrant.client.get_collections()
        qdrant_status = "reachable"
    except Exception:
        qdrant_status = "unreachable"
    return {
        "status": "ok",
        "queue_lag": lag,
        "qdrant": qdrant_status,
        "database": db_status,
        "version": "0.1.0",
    }
