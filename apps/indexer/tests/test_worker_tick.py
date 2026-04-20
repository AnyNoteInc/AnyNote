"""Unit tests: tick claims rows, dispatches, acks; failures call retry."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from indexer.services.outbox import OutboxRow
from indexer.services.worker import IndexerWorker


def _row(event_type: str = "page.upserted") -> OutboxRow:
    return OutboxRow(
        id=1,
        event_type=event_type,
        aggregate_type="page",
        aggregate_id="00000000-0000-0000-0000-000000000001",
        workspace_id=None,
        payload={},
        attempts=0,
    )


@pytest.mark.asyncio
async def test_tick_marks_done_on_success() -> None:
    outbox = MagicMock()
    outbox.claim_batch = AsyncMock(return_value=[_row()])
    outbox.mark_done = AsyncMock()
    outbox.mark_failed_or_retry = AsyncMock()
    qdrant = MagicMock()
    qdrant.delete_page = AsyncMock()
    qdrant.upsert_page = AsyncMock()

    class _Conn:
        async def fetchrow(self, *_args: Any, **_kw: Any) -> dict[str, Any]:
            return {
                "id": "00000000-0000-0000-0000-000000000001",
                "workspace_id": "00000000-0000-0000-0000-000000000002",
                "ownership": "TEXT",
                "type": "TEXT",
                "title": "t",
                "content": {
                    "type": "doc",
                    "content": [
                        {
                            "type": "paragraph",
                            "content": [{"type": "text", "text": "hi"}],
                        }
                    ],
                },
                "deleted_at": None,
            }

    class _Acquire:
        async def __aenter__(self) -> _Conn:
            return _Conn()

        async def __aexit__(self, *_a: Any) -> None:
            return None

    pool = MagicMock()
    pool.acquire = MagicMock(return_value=_Acquire())
    embeddings = MagicMock()
    embeddings.embed = AsyncMock(return_value=[[0.1] * 768])
    chunker = MagicMock()
    chunker.chunk = MagicMock(return_value=["hi"])

    settings = MagicMock(indexer_max_attempts=5)
    worker = IndexerWorker(
        pool=pool,
        outbox=outbox,
        chunker=chunker,
        embeddings=embeddings,
        qdrant=qdrant,
        settings=settings,
    )
    n = await worker.tick()
    assert n == 1
    outbox.mark_done.assert_awaited_once_with(1)
    outbox.mark_failed_or_retry.assert_not_awaited()
    qdrant.upsert_page.assert_awaited_once()


@pytest.mark.asyncio
async def test_tick_marks_failed_on_handler_exception() -> None:
    outbox = MagicMock()
    row = _row("page.deleted")
    outbox.claim_batch = AsyncMock(return_value=[row])
    outbox.mark_done = AsyncMock()
    outbox.mark_failed_or_retry = AsyncMock()
    qdrant = MagicMock()
    qdrant.delete_page = AsyncMock(side_effect=RuntimeError("qdrant down"))
    pool = MagicMock()
    embeddings = MagicMock()
    chunker = MagicMock()
    settings = MagicMock(indexer_max_attempts=5)

    worker = IndexerWorker(
        pool=pool,
        outbox=outbox,
        chunker=chunker,
        embeddings=embeddings,
        qdrant=qdrant,
        settings=settings,
    )
    n = await worker.tick()
    assert n == 1
    outbox.mark_failed_or_retry.assert_awaited_once()
    outbox.mark_done.assert_not_awaited()
