"""End-to-end pipeline test against real Postgres + Qdrant + Ollama."""

from __future__ import annotations

import json
import uuid

import asyncpg  # type: ignore[import-untyped]
import pytest
from qdrant_client import AsyncQdrantClient
from qdrant_client.http import models as qmodels

from indexer.services.chunker import Chunker
from indexer.services.embeddings.ollama import OllamaEmbeddings
from indexer.services.outbox import OutboxRepo
from indexer.services.qdrant_writer import QdrantWriter
from indexer.services.worker import IndexerWorker
from indexer.settings import Settings


@pytest.mark.integration
async def test_end_to_end_index_then_delete() -> None:
    settings = Settings()
    pool: asyncpg.Pool = await asyncpg.create_pool(
        settings.indexer_database_url, min_size=1, max_size=2
    )
    qdrant_client = AsyncQdrantClient(
        url=settings.indexer_qdrant_url, api_key=settings.indexer_qdrant_api_key
    )
    qdrant = QdrantWriter(client=qdrant_client, settings=settings)
    try:
        await qdrant_client.delete_collection(settings.indexer_qdrant_collection)
    except Exception:
        pass
    await qdrant.ensure_collection()

    outbox = OutboxRepo(pool=pool, settings=settings)
    embeddings = OllamaEmbeddings(
        base_url=settings.ollama_base_url,
        model=settings.embeddings_model,
        dim=settings.embeddings_dim,
    )
    worker = IndexerWorker(
        pool=pool,
        outbox=outbox,
        chunker=Chunker(),
        embeddings=embeddings,
        qdrant=qdrant,
        settings=settings,
    )

    user_id = str(uuid.uuid4())
    workspace_id = str(uuid.uuid4())
    page_id = str(uuid.uuid4())
    content = {
        "type": "doc",
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "hello qdrant"}]},
        ],
    }

    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO users (id, name, first_name, last_name, email, email_verified) "
            "VALUES ($1::uuid, 'E2E', 'E', 'E', $2, false)",
            user_id,
            f"e2e-{user_id}@test.local",
        )
        await conn.execute(
            "INSERT INTO workspaces (name, created_by_id) VALUES ('e2e', $1::uuid) RETURNING id",
            user_id,
        )
        ws_row = await conn.fetchrow(
            "SELECT id FROM workspaces WHERE created_by_id = $1::uuid ORDER BY created_at DESC LIMIT 1",
            user_id,
        )
        assert ws_row is not None
        workspace_id = str(ws_row["id"])
        await conn.execute(
            "INSERT INTO pages (id, workspace_id, title, type, ownership, content) "
            "VALUES ($1::uuid, $2::uuid, 'E2E', 'TEXT', 'TEXT', $3::jsonb)",
            page_id,
            workspace_id,
            json.dumps(content),
        )
        await conn.execute(
            "INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, workspace_id) "
            "VALUES ('page.upserted', 'page', $1::uuid, $2::uuid)",
            page_id,
            workspace_id,
        )

    n = await worker.tick()
    assert n >= 1

    result, _ = await qdrant_client.scroll(
        collection_name=settings.indexer_qdrant_collection,
        scroll_filter=qmodels.Filter(
            must=[qmodels.FieldCondition(key="page_id", match=qmodels.MatchValue(value=page_id))]
        ),
        limit=10,
    )
    assert len(result) >= 1
    assert any(p.payload and p.payload["chunk_text"].startswith("hello") for p in result)

    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, workspace_id) "
            "VALUES ('page.deleted', 'page', $1::uuid, $2::uuid)",
            page_id,
            workspace_id,
        )
    await worker.tick()

    result2, _ = await qdrant_client.scroll(
        collection_name=settings.indexer_qdrant_collection,
        scroll_filter=qmodels.Filter(
            must=[qmodels.FieldCondition(key="page_id", match=qmodels.MatchValue(value=page_id))]
        ),
        limit=10,
    )
    assert result2 == []

    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM outbox_events WHERE aggregate_id = $1::uuid", page_id)
        await conn.execute("DELETE FROM pages WHERE id = $1::uuid", page_id)
        await conn.execute("DELETE FROM workspaces WHERE id = $1::uuid", workspace_id)
        await conn.execute("DELETE FROM users WHERE id = $1::uuid", user_id)
    await qdrant_client.close()
    await pool.close()
