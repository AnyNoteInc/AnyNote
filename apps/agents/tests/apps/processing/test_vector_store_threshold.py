from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from agents.apps.processing.repositories.vector_store_repository import VectorStoreRepository


@pytest.mark.asyncio
async def test_similarity_search_forwards_score_threshold() -> None:
    client = AsyncMock()
    client.get_collection.return_value = SimpleNamespace()  # collection_exists -> True
    client.query_points.return_value = SimpleNamespace(points=[])
    embeddings = AsyncMock()
    embeddings.aembed_query.return_value = [0.1, 0.2, 0.3]

    repo = VectorStoreRepository(client=client)
    await repo.similarity_search(
        collection_name='c',
        embeddings=embeddings,
        workspace_id='w',
        query='hello',
        k=5,
        score_threshold=0.7,
    )

    call = client.query_points.call_args
    assert call.kwargs['score_threshold'] == 0.7


@pytest.mark.asyncio
async def test_similarity_search_threshold_defaults_to_none() -> None:
    client = AsyncMock()
    client.get_collection.return_value = SimpleNamespace()
    client.query_points.return_value = SimpleNamespace(points=[])
    embeddings = AsyncMock()
    embeddings.aembed_query.return_value = [0.1]

    repo = VectorStoreRepository(client=client)
    await repo.similarity_search(
        collection_name='c', embeddings=embeddings, workspace_id='w', query='q', k=1,
    )

    call = client.query_points.call_args
    assert call.kwargs['score_threshold'] is None
