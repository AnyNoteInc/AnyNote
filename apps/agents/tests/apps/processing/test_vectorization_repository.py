from unittest.mock import AsyncMock

import pytest
from agents.apps.processing.repositories.vectorization_repository import VectorizationRepository


@pytest.mark.asyncio
async def test_embed_returns_single_vector() -> None:
    mock_embeddings = AsyncMock()
    mock_embeddings.aembed_documents = AsyncMock(return_value=[[0.1, 0.2, 0.3]])
    repo = VectorizationRepository(embeddings=mock_embeddings)

    result = await repo.embed('test')

    assert result == [0.1, 0.2, 0.3]
    mock_embeddings.aembed_documents.assert_awaited_once_with(['test'])


@pytest.mark.asyncio
async def test_embed_batch_returns_multiple_vectors() -> None:
    mock_embeddings = AsyncMock()
    mock_embeddings.aembed_documents = AsyncMock(return_value=[[0.1], [0.2]])
    repo = VectorizationRepository(embeddings=mock_embeddings)

    result = await repo.embed_batch(['a', 'b'])

    assert result == [[0.1], [0.2]]
