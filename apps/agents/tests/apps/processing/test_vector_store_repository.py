from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from agents.apps.processing.repositories.vector_store_repository import VectorStoreRepository

COLLECTION = 'pages'
VECTOR_SIZE = 768


def _not_found() -> Exception:
    from qdrant_client.http.exceptions import UnexpectedResponse

    return UnexpectedResponse(404, 'not found', b'', httpx.Headers())


def _make_repo(client: Any = None) -> VectorStoreRepository:
    return VectorStoreRepository(client=client or AsyncMock())


@pytest.mark.asyncio
async def test_list_collections_returns_names() -> None:
    client = AsyncMock()
    client.get_collections = AsyncMock(
        return_value=MagicMock(
            collections=[
                SimpleNamespace(name='pages_ollama_nomic-embed-text'),
                SimpleNamespace(name='pages_openai_text-embedding-3-small'),
            ]
        ),
    )
    repo = _make_repo(client=client)

    assert await repo.list_collections() == [
        'pages_ollama_nomic-embed-text',
        'pages_openai_text-embedding-3-small',
    ]


@pytest.mark.asyncio
async def test_collection_exists_returns_false_on_404() -> None:
    client = AsyncMock()
    client.get_collection = AsyncMock(side_effect=_not_found())
    repo = _make_repo(client=client)

    assert await repo.collection_exists(COLLECTION) is False


@pytest.mark.asyncio
async def test_ensure_collection_creates_when_missing() -> None:
    client = AsyncMock()
    client.create_collection = AsyncMock()
    repo = _make_repo(client=client)

    await repo.ensure_collection(COLLECTION, VECTOR_SIZE)

    client.create_collection.assert_awaited_once()
    args, kwargs = client.create_collection.call_args
    assert args[0] == COLLECTION or kwargs.get('collection_name') == COLLECTION


@pytest.mark.asyncio
async def test_ensure_collection_swallows_already_exists() -> None:
    from qdrant_client.http.exceptions import UnexpectedResponse

    client = AsyncMock()
    client.create_collection = AsyncMock(
        side_effect=UnexpectedResponse(409, 'already exists', b'', httpx.Headers()),
    )
    repo = _make_repo(client=client)

    await repo.ensure_collection(COLLECTION, VECTOR_SIZE)  # should not raise

    client.create_collection.assert_awaited_once()


@pytest.mark.asyncio
async def test_delete_by_page_calls_client_delete_with_filter() -> None:
    client = AsyncMock()
    client.get_collection = AsyncMock()
    repo = _make_repo(client=client)

    await repo.delete_by_page(COLLECTION, 'abc-123')

    client.get_collection.assert_awaited_once_with(COLLECTION)
    client.delete.assert_awaited_once()
    args, kwargs = client.delete.call_args
    assert args[0] == COLLECTION
    filt = kwargs['points_selector']
    assert filt.must[0].key == 'pageId'
    assert filt.must[0].match.value == 'abc-123'


@pytest.mark.asyncio
async def test_delete_by_page_noops_when_collection_missing() -> None:
    client = AsyncMock()
    client.get_collection = AsyncMock(side_effect=_not_found())
    repo = _make_repo(client=client)

    await repo.delete_by_page(COLLECTION, 'abc-123')

    client.delete.assert_not_awaited()


@pytest.mark.asyncio
async def test_delete_by_workspace_calls_client_delete_with_filter() -> None:
    client = AsyncMock()
    client.get_collection = AsyncMock()
    repo = _make_repo(client=client)

    await repo.delete_by_workspace(COLLECTION, 'ws-1')

    client.delete.assert_awaited_once()
    filt = client.delete.call_args.kwargs['points_selector']
    assert filt.must[0].key == 'workspaceId'
    assert filt.must[0].match.value == 'ws-1'


@pytest.mark.asyncio
async def test_upsert_chunks_noop_when_empty() -> None:
    client = AsyncMock()
    repo = _make_repo(client=client)

    await repo.upsert_chunks(COLLECTION, [])

    client.upsert.assert_not_awaited()


@pytest.mark.asyncio
async def test_upsert_chunks_calls_client_upsert() -> None:
    client = AsyncMock()
    repo = _make_repo(client=client)

    points = [('point-1', [0.1, 0.2], {'pageId': 'p1'})]
    await repo.upsert_chunks(COLLECTION, points)

    client.upsert.assert_awaited_once()


@pytest.mark.asyncio
async def test_similarity_search_empty_query_returns_empty() -> None:
    repo = _make_repo()
    embeddings = MagicMock()
    assert (
        await repo.similarity_search(
            collection_name=COLLECTION,
            embeddings=embeddings,
            workspace_id='ws-1',
            query='',
        )
        == []
    )
    assert (
        await repo.similarity_search(
            collection_name=COLLECTION,
            embeddings=embeddings,
            workspace_id='ws-1',
            query='   ',
        )
        == []
    )


@pytest.mark.asyncio
async def test_similarity_search_calls_query_points() -> None:
    client = AsyncMock()
    client.get_collection = AsyncMock()
    embeddings = MagicMock()
    embeddings.aembed_query = AsyncMock(return_value=[0.1] * 768)

    point = MagicMock()
    point.payload = {'content': 'hello', 'pageId': 'p1', 'workspaceId': 'ws-1'}
    client.query_points = AsyncMock(return_value=MagicMock(points=[point]))

    repo = VectorStoreRepository(client=client)
    docs = await repo.similarity_search(
        collection_name=COLLECTION,
        embeddings=embeddings,
        workspace_id='ws-1',
        query='test query',
        k=3,
    )

    client.query_points.assert_awaited_once()
    call_kwargs = client.query_points.call_args.kwargs
    assert call_kwargs['collection_name'] == COLLECTION
    assert call_kwargs['limit'] == 3
    assert len(docs) == 1
    assert docs[0].page_content == 'hello'
    assert docs[0].metadata['pageId'] == 'p1'


@pytest.mark.asyncio
async def test_similarity_search_noops_when_collection_missing() -> None:
    client = AsyncMock()
    client.get_collection = AsyncMock(side_effect=_not_found())
    embeddings = MagicMock()
    embeddings.aembed_query = AsyncMock()
    repo = _make_repo(client=client)

    docs = await repo.similarity_search(
        collection_name=COLLECTION,
        embeddings=embeddings,
        workspace_id='ws-1',
        query='test query',
    )

    assert docs == []
    embeddings.aembed_query.assert_not_awaited()
    client.query_points.assert_not_awaited()
