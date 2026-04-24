from unittest.mock import AsyncMock, MagicMock

import pytest
from qdrant_client.http.models import Distance, VectorParams

from agents.apps.processing.repositories.vector_store_repository import (
    COLLECTION, VECTOR_SIZE, VectorStoreRepository,
)


@pytest.mark.asyncio
async def test_ensure_collection_creates_when_missing() -> None:
    client = AsyncMock()
    client.get_collections = AsyncMock(return_value=MagicMock(collections=[]))
    client.create_collection = AsyncMock()
    repo = VectorStoreRepository(client=client, embeddings=MagicMock())

    await repo.ensure_collection()

    client.create_collection.assert_awaited_once()
    args, kwargs = client.create_collection.call_args
    assert args[0] == COLLECTION or kwargs.get('collection_name') == COLLECTION


@pytest.mark.asyncio
async def test_ensure_collection_noop_when_exists() -> None:
    existing = MagicMock(); existing.name = COLLECTION
    client = AsyncMock()
    client.get_collections = AsyncMock(return_value=MagicMock(collections=[existing]))
    client.create_collection = AsyncMock()
    repo = VectorStoreRepository(client=client, embeddings=MagicMock())

    await repo.ensure_collection()

    client.create_collection.assert_not_awaited()


@pytest.mark.asyncio
async def test_delete_by_page_calls_client_delete_with_filter() -> None:
    client = AsyncMock()
    repo = VectorStoreRepository(client=client, embeddings=MagicMock())

    await repo.delete_by_page('abc-123')

    client.delete.assert_awaited_once()
    args, kwargs = client.delete.call_args
    assert args[0] == COLLECTION
    # filter must reference pageId='abc-123'
    filt = kwargs['points_selector']
    assert filt.must[0].key == 'pageId'
    assert filt.must[0].match.value == 'abc-123'


@pytest.mark.asyncio
async def test_upsert_chunks_noop_when_empty() -> None:
    client = AsyncMock()
    repo = VectorStoreRepository(client=client, embeddings=MagicMock())

    await repo.upsert_chunks([])

    client.upsert.assert_not_awaited()


@pytest.mark.asyncio
async def test_upsert_chunks_calls_client_upsert() -> None:
    client = AsyncMock()
    repo = VectorStoreRepository(client=client, embeddings=MagicMock())

    points = [('point-1', [0.1, 0.2], {'pageId': 'p1'})]
    await repo.upsert_chunks(points)

    client.upsert.assert_awaited_once()


def test_constants() -> None:
    assert COLLECTION == 'pages'
    assert VECTOR_SIZE == 768
