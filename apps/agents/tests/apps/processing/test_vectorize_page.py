from collections.abc import Callable
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest
from agents.apps.agent.enums_shared import ModelProviderEnum
from agents.apps.processing.schemas import (
    ContentBlockSchema,
    EmbeddingProviderConfigSchema,
    ModelConnectionSchema,
    VectorizationRequestSchema,
)
from agents.apps.processing.use_cases.vectorize_page import VectorizePageUseCase

PAGE_ID = UUID('00000000-0000-0000-0000-000000000001')
WS_ID = UUID('00000000-0000-0000-0000-000000000002')
COLLECTION = 'pages_ollama_nomic-embed-text'


def _make_use_case(
    split_return: Callable[[str], list[str]] | None = None,
    normalize_return: str = 'normalized',
    embed_return: list[float] | None = None,
) -> tuple[VectorizePageUseCase, MagicMock, MagicMock, MagicMock, MagicMock]:
    chunker = MagicMock()
    chunker.split = MagicMock(side_effect=split_return or (lambda t: [t]))

    normalizer = MagicMock()
    normalizer.normalize = MagicMock(return_value=normalize_return)

    embedder = MagicMock()
    embedder.aembed_documents = AsyncMock(return_value=[embed_return or [0.1, 0.2]])

    embedding_factory = MagicMock()
    embedding_factory.make = MagicMock(return_value=embedder)

    store = MagicMock()
    store.ensure_collection = AsyncMock()
    store.delete_by_page = AsyncMock()
    store.upsert_chunks = AsyncMock()

    return (
        VectorizePageUseCase(
            chunker=chunker,
            normalizer=normalizer,
            vector_store=store,
            embedding_factory=embedding_factory,
        ),
        chunker,
        normalizer,
        embedding_factory,
        store,
    )


def _payload(contents: list[ContentBlockSchema]) -> VectorizationRequestSchema:
    return VectorizationRequestSchema(
        pageId=str(PAGE_ID),
        workspaceId=str(WS_ID),
        title='T',
        pageType='TEXT',
        contents=contents,
        embedding=EmbeddingProviderConfigSchema(
            provider=ModelProviderEnum.OLLAMA,
            modelSlug='nomic-embed-text',
            vectorSize=768,
            connection=ModelConnectionSchema(baseUrl='http://localhost:11434'),
        ),
    )


@pytest.mark.asyncio
async def test_deletes_before_indexing() -> None:
    uc, *_, store = _make_use_case()
    await uc(_payload([ContentBlockSchema(blockNumber=0, content='hello')]))
    store.ensure_collection.assert_awaited_once_with(COLLECTION, 768)
    store.delete_by_page.assert_awaited_once_with(COLLECTION, str(PAGE_ID))


@pytest.mark.asyncio
async def test_empty_contents_still_deletes() -> None:
    uc, *_, store = _make_use_case()
    result = await uc(_payload([]))
    store.delete_by_page.assert_awaited_once_with(COLLECTION, str(PAGE_ID))
    store.upsert_chunks.assert_not_awaited()
    assert result.indexedChunks == 0
    assert result.skippedBlocks == 0


@pytest.mark.asyncio
async def test_skips_block_with_no_chunks() -> None:
    uc, _chunker, *_, store = _make_use_case(split_return=lambda t: [])
    result = await uc(_payload([ContentBlockSchema(blockNumber=2, content='x')]))
    assert result.indexedChunks == 0
    assert result.skippedBlocks == 1
    store.upsert_chunks.assert_not_awaited()


@pytest.mark.asyncio
async def test_skips_chunks_that_normalize_to_empty() -> None:
    uc, *_other, _store = _make_use_case(
        split_return=lambda t: ['chunk'],
        normalize_return='',
    )
    result = await uc(_payload([ContentBlockSchema(blockNumber=0, content='x')]))
    assert result.indexedChunks == 0
    assert result.skippedBlocks == 0  # не пустой блок, просто чанки ушли на ноль


@pytest.mark.asyncio
async def test_upserts_with_expected_metadata() -> None:
    uc, chunker, normalizer, embedding_factory, store = _make_use_case()
    chunker.split = MagicMock(side_effect=lambda t: ['raw chunk'])
    normalizer.normalize = MagicMock(return_value='norm text')

    await uc(_payload([ContentBlockSchema(blockNumber=5, content='ignored')]))

    embedder = embedding_factory.make.return_value
    embedder.aembed_documents.assert_awaited_once_with(['norm text'])

    # store.upsert_chunks got a single point with the RAW chunk in metadata
    args, _ = store.upsert_chunks.call_args
    assert args[0] == COLLECTION
    points = args[1]
    assert len(points) == 1
    _pid, _vector, payload_meta = points[0]
    assert payload_meta == {
        'pageId': str(PAGE_ID),
        'workspaceId': str(WS_ID),
        'title': 'T',
        'pageType': 'TEXT',
        'blockNumber': 5,
        'content': 'raw chunk',  # raw, pre-normalization
    }


@pytest.mark.asyncio
async def test_point_id_is_deterministic() -> None:
    a = VectorizePageUseCase._point_id(PAGE_ID, 3, 1)
    b = VectorizePageUseCase._point_id(PAGE_ID, 3, 1)
    c = VectorizePageUseCase._point_id(PAGE_ID, 3, 2)
    assert a == b
    assert a != c
