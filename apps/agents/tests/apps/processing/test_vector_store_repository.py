from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from qdrant_client.http.models import Distance, VectorParams

from agents.apps.processing.repositories.vector_store_repository import VectorStoreRepository

COLLECTION = 'pages'
VECTOR_SIZE = 768


def _make_repo(client: Any = None, embeddings: Any = None) -> VectorStoreRepository:
    return VectorStoreRepository(
        client=client or AsyncMock(),
        embeddings=embeddings or MagicMock(),
        collection_name=COLLECTION,
        vector_size=VECTOR_SIZE,
    )


@pytest.mark.asyncio
async def test_ensure_collection_creates_when_missing() -> None:
    client = AsyncMock()
    client.get_collections = AsyncMock(return_value=MagicMock(collections=[]))
    client.create_collection = AsyncMock()
    repo = _make_repo(client=client)

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
    repo = _make_repo(client=client)

    await repo.ensure_collection()

    client.create_collection.assert_not_awaited()


@pytest.mark.asyncio
async def test_delete_by_page_calls_client_delete_with_filter() -> None:
    client = AsyncMock()
    repo = _make_repo(client=client)

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
    repo = _make_repo(client=client)

    await repo.upsert_chunks([])

    client.upsert.assert_not_awaited()


@pytest.mark.asyncio
async def test_upsert_chunks_calls_client_upsert() -> None:
    client = AsyncMock()
    repo = _make_repo(client=client)

    points = [('point-1', [0.1, 0.2], {'pageId': 'p1'})]
    await repo.upsert_chunks(points)

    client.upsert.assert_awaited_once()


def test_instance_fields() -> None:
    repo = _make_repo()
    assert repo.collection_name == 'pages'
    assert repo.vector_size == 768


@pytest.mark.asyncio
async def test_similarity_search_empty_query_returns_empty() -> None:
    repo = _make_repo()
    assert await repo.similarity_search('ws-1', '') == []
    assert await repo.similarity_search('ws-1', '   ') == []


@pytest.mark.asyncio
async def test_similarity_search_calls_query_points() -> None:
    client = AsyncMock()
    embeddings = MagicMock()
    embeddings.aembed_query = AsyncMock(return_value=[0.1] * 768)

    point = MagicMock()
    point.payload = {'content': 'hello', 'pageId': 'p1', 'workspaceId': 'ws-1'}
    client.query_points = AsyncMock(return_value=MagicMock(points=[point]))

    repo = VectorStoreRepository(
        client=client,
        embeddings=embeddings,
        collection_name=COLLECTION,
        vector_size=VECTOR_SIZE,
    )
    docs = await repo.similarity_search('ws-1', 'test query', k=3)

    client.query_points.assert_awaited_once()
    call_kwargs = client.query_points.call_args.kwargs
    assert call_kwargs['collection_name'] == COLLECTION
    assert call_kwargs['limit'] == 3
    assert len(docs) == 1
    assert docs[0].page_content == 'hello'
    assert docs[0].metadata['pageId'] == 'p1'
