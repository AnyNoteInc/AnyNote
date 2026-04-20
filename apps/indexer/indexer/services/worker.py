"""Worker loop: claim → dispatch → ack/nack."""

from __future__ import annotations

import asyncio
import logging

import asyncpg  # type: ignore[import-untyped]

from indexer.services.chunker import Chunker
from indexer.services.embeddings import EmbeddingsProvider
from indexer.services.handlers import (
    handle_file_event,
    handle_page_deleted,
    handle_page_upserted,
)
from indexer.services.outbox import OutboxRepo, OutboxRow
from indexer.services.qdrant_writer import QdrantWriter
from indexer.settings import Settings

log = logging.getLogger(__name__)


class IndexerWorker:
    def __init__(
        self,
        *,
        pool: asyncpg.Pool,
        outbox: OutboxRepo,
        chunker: Chunker,
        embeddings: EmbeddingsProvider,
        qdrant: QdrantWriter,
        settings: Settings,
    ) -> None:
        self.pool = pool
        self.outbox = outbox
        self.chunker = chunker
        self.embeddings = embeddings
        self.qdrant = qdrant
        self.settings = settings

    async def tick(self) -> int:
        rows = await self.outbox.claim_batch()
        for row in rows:
            try:
                await self._dispatch(row)
            except Exception as exc:
                log.exception("indexer handler error for row %s", row.id)
                await self.outbox.mark_failed_or_retry(row, str(exc))
            else:
                await self.outbox.mark_done(row.id)
        return len(rows)

    async def _dispatch(self, row: OutboxRow) -> None:
        if row.event_type == "page.upserted":
            await handle_page_upserted(
                row,
                pool=self.pool,
                chunker=self.chunker,
                embeddings=self.embeddings,
                qdrant=self.qdrant,
            )
        elif row.event_type == "page.deleted":
            await handle_page_deleted(row, qdrant=self.qdrant)
        elif row.event_type in {"file.upserted", "file.deleted"}:
            await handle_file_event(row)
        else:
            log.warning("unknown event_type %s for row %s", row.event_type, row.id)

    async def run_forever(self, stop_event: asyncio.Event) -> None:
        log.info("indexer worker %s starting", self.settings.indexer_worker_id)
        await self.qdrant.ensure_collection()
        interval = max(0.05, self.settings.indexer_poll_interval_ms / 1000.0)
        while not stop_event.is_set():
            try:
                await self.tick()
            except Exception:
                log.exception("indexer tick crashed; sleeping before retry")
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=interval)
            except TimeoutError:
                pass
        log.info("indexer worker %s stopped", self.settings.indexer_worker_id)
