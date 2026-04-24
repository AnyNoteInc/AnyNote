from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest

from agents.apps.processing.schemas import (
    ContentBlockSchema, VectorizationRequestSchema,
)
from agents.apps.processing.use_cases.vectorize_page import VectorizePageUseCase


PAGE_ID = UUID('00000000-0000-0000-0000-000000000001')
WS_ID = UUID('00000000-0000-0000-0000-000000000002')


def _make_use_case(
    split_return=None, normalize_return='normalized', embed_return=None,
):
    chunker = MagicMock()
    chunker.split = MagicMock(side_effect=split_return or (lambda t: [t]))

    normalizer = MagicMock()
    normalizer.normalize = MagicMock(return_value=normalize_return)

    vec_repo = MagicMock()
    vec_repo.embed = AsyncMock(return_value=embed_return or [0.1, 0.2])

    store = MagicMock()
    store.delete_by_page = AsyncMock()
    store.upsert_chunks = AsyncMock()

    return VectorizePageUseCase(
        chunker_service=chunker,
        normalizer_service=normalizer,
        vectorization_repository=vec_repo,
        vector_store_repository=store,
    ), chunker, normalizer, vec_repo, store


def _payload(contents: list[ContentBlockSchema]) -> VectorizationRequestSchema:
    return VectorizationRequestSchema(
        pageId=PAGE_ID, workspaceId=WS_ID, title='T', pageType='TEXT',
        contents=contents,
    )


@pytest.mark.asyncio
async def test_deletes_before_indexing() -> None:
    uc, *_, store = _make_use_case()
    await uc(_payload([ContentBlockSchema(blockNumber=0, content='hello')]))
    store.delete_by_page.assert_awaited_once_with(str(PAGE_ID))


@pytest.mark.asyncio
async def test_empty_contents_still_deletes() -> None:
    uc, *_, store = _make_use_case()
    result = await uc(_payload([]))
    store.delete_by_page.assert_awaited_once()
    store.upsert_chunks.assert_awaited_once_with([])
    assert result.indexedChunks == 0
    assert result.skippedBlocks == 0


@pytest.mark.asyncio
async def test_skips_block_with_no_chunks() -> None:
    uc, chunker, *_, store = _make_use_case(split_return=lambda t: [])
    result = await uc(_payload([ContentBlockSchema(blockNumber=2, content='x')]))
    assert result.indexedChunks == 0
    assert result.skippedBlocks == 1
    store.upsert_chunks.assert_awaited_once_with([])


@pytest.mark.asyncio
async def test_skips_chunks_that_normalize_to_empty() -> None:
    uc, *_, store = _make_use_case(
        split_return=lambda t: ['chunk'], normalize_return='',
    )
    result = await uc(_payload([ContentBlockSchema(blockNumber=0, content='x')]))
    assert result.indexedChunks == 0
    assert result.skippedBlocks == 0  # не пустой блок, просто чанки ушли на ноль


@pytest.mark.asyncio
async def test_upserts_with_expected_metadata() -> None:
    uc, chunker, normalizer, vec_repo, store = _make_use_case()
    chunker.split = MagicMock(side_effect=lambda t: ['raw chunk'])
    normalizer.normalize = MagicMock(return_value='norm text')

    await uc(_payload([ContentBlockSchema(blockNumber=5, content='ignored')]))

    # vec_repo.embed called with NORMALIZED text, not raw
    vec_repo.embed.assert_awaited_once_with('norm text')

    # store.upsert_chunks got a single point with the RAW chunk in metadata
    args, _ = store.upsert_chunks.call_args
    points = args[0]
    assert len(points) == 1
    pid, vector, payload_meta = points[0]
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
