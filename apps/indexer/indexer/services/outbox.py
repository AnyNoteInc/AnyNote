"""Outbox repository — claim, ack, fail using FOR UPDATE SKIP LOCKED."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

import asyncpg  # type: ignore[import-untyped]

from indexer.exceptions import OutboxClaimError
from indexer.settings import Settings


@dataclass(slots=True)
class OutboxRow:
    id: int
    event_type: str
    aggregate_type: str
    aggregate_id: str
    workspace_id: str | None
    payload: dict[str, Any]
    attempts: int


def _backoff_seconds(attempts: int) -> int:
    backoff: int = min(60 * (2**attempts), 30 * 60)
    return backoff


class OutboxRepo:
    def __init__(self, *, pool: asyncpg.Pool, settings: Settings) -> None:
        self.pool = pool
        self.settings = settings

    async def claim_batch(self) -> list[OutboxRow]:
        worker_id = self.settings.indexer_worker_id
        batch = self.settings.indexer_batch
        lock_ttl = timedelta(milliseconds=self.settings.indexer_lock_ttl_ms)
        max_attempts = self.settings.indexer_max_attempts

        try:
            async with self.pool.acquire() as conn, conn.transaction():
                rows = await conn.fetch(
                    """
                    WITH candidate AS (
                        SELECT id
                        FROM outbox_events
                        WHERE status = 'PENDING'
                          AND attempts < $3
                          AND next_attempt_at <= now()
                          AND (locked_at IS NULL OR locked_at < now() - $4::interval)
                        ORDER BY created_at
                        LIMIT $1
                        FOR UPDATE SKIP LOCKED
                    )
                    UPDATE outbox_events o
                    SET locked_at = now(), locked_by = $2
                    FROM candidate c
                    WHERE o.id = c.id
                    RETURNING o.id, o.event_type, o.aggregate_type, o.aggregate_id,
                              o.workspace_id, o.payload, o.attempts
                    """,
                    batch,
                    worker_id,
                    max_attempts,
                    lock_ttl,
                )
        except Exception as exc:
            raise OutboxClaimError(f"claim_batch failed: {exc}") from exc

        return [
            OutboxRow(
                id=int(r["id"]),
                event_type=r["event_type"],
                aggregate_type=r["aggregate_type"],
                aggregate_id=str(r["aggregate_id"]),
                workspace_id=str(r["workspace_id"]) if r["workspace_id"] else None,
                payload=_decode_payload(r["payload"]),
                attempts=int(r["attempts"]),
            )
            for r in rows
        ]

    async def mark_done(self, row_id: int) -> None:
        async with self.pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE outbox_events
                SET status = 'DONE', processed_at = now(), locked_at = NULL,
                    locked_by = NULL, last_error = NULL
                WHERE id = $1
                """,
                row_id,
            )

    async def mark_failed_or_retry(self, row: OutboxRow, error: str) -> None:
        new_attempts = row.attempts + 1
        max_attempts = self.settings.indexer_max_attempts
        if new_attempts >= max_attempts:
            async with self.pool.acquire() as conn:
                await conn.execute(
                    """
                    UPDATE outbox_events
                    SET status = 'FAILED', attempts = $2, last_error = $3,
                        locked_at = NULL, locked_by = NULL, processed_at = now()
                    WHERE id = $1
                    """,
                    row.id,
                    new_attempts,
                    error[:1000],
                )
        else:
            backoff = _backoff_seconds(new_attempts)
            async with self.pool.acquire() as conn:
                await conn.execute(
                    """
                    UPDATE outbox_events
                    SET status = 'PENDING', attempts = $2, last_error = $3,
                        next_attempt_at = now() + ($4::int * interval '1 second'),
                        locked_at = NULL, locked_by = NULL
                    WHERE id = $1
                    """,
                    row.id,
                    new_attempts,
                    error[:1000],
                    backoff,
                )

    async def queue_lag(self) -> int:
        async with self.pool.acquire() as conn:
            value = await conn.fetchval(
                "SELECT count(*) FROM outbox_events WHERE status = 'PENDING'"
            )
            return int(value or 0)


def _decode_payload(raw: Any) -> dict[str, Any]:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return dict(raw)
    if isinstance(raw, str):
        try:
            decoded = json.loads(raw)
        except json.JSONDecodeError:
            return {}
        return decoded if isinstance(decoded, dict) else {}
    return {}
