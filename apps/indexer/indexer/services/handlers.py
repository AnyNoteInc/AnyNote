"""Per-event handlers used by the worker."""

from __future__ import annotations

import json
from typing import Any

import asyncpg  # type: ignore[import-untyped]

from indexer.exceptions import HandlerError
from indexer.services.chunker import Chunker, tiptap_to_text
from indexer.services.embeddings import EmbeddingsProvider
from indexer.services.outbox import OutboxRow
from indexer.services.qdrant_writer import QdrantWriter


async def handle_page_upserted(
    row: OutboxRow,
    *,
    pool: asyncpg.Pool,
    chunker: Chunker,
    embeddings: EmbeddingsProvider,
    qdrant: QdrantWriter,
) -> None:
    async with pool.acquire() as conn:
        page = await conn.fetchrow(
            """
            SELECT id, workspace_id, ownership, type, title, content, deleted_at
            FROM pages WHERE id = $1::uuid
            """,
            row.aggregate_id,
        )
    if page is None or page["deleted_at"] is not None:
        await qdrant.delete_page(page_id=row.aggregate_id)
        return

    raw_content = page["content"]
    content_obj: dict[str, Any] | None
    if isinstance(raw_content, str):
        try:
            decoded = json.loads(raw_content)
            content_obj = decoded if isinstance(decoded, dict) else None
        except json.JSONDecodeError:
            content_obj = None
    elif isinstance(raw_content, dict):
        content_obj = raw_content
    else:
        content_obj = None
    text = tiptap_to_text(content_obj)
    chunks = chunker.chunk(text)
    if not chunks:
        await qdrant.delete_page(page_id=row.aggregate_id)
        return
    try:
        vectors = await embeddings.embed(chunks)
    except Exception as exc:
        raise HandlerError(f"embedding failed: {exc}") from exc
    await qdrant.upsert_page(
        page_id=str(page["id"]),
        workspace_id=str(page["workspace_id"]),
        ownership=str(page["ownership"]),
        type_=str(page["type"]),
        title=page["title"],
        chunks=chunks,
        vectors=vectors,
    )


async def handle_page_deleted(row: OutboxRow, *, qdrant: QdrantWriter) -> None:
    await qdrant.delete_page(page_id=row.aggregate_id)


async def handle_file_event(_row: OutboxRow) -> None:
    """Pillar D ships file events as no-ops; file extraction lands later."""
    return None
