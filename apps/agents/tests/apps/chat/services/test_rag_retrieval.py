from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest
from langchain_core.documents import Document

from agents.apps.chat.services.rag_retrieval import RagRetrievalService


WS_ID = UUID('00000000-0000-0000-0000-000000000001')


def _doc(page_id: str, block_number: int, content: str = 'x') -> Document:
    return Document(page_content=content, metadata={
        'pageId': page_id,
        'workspaceId': str(WS_ID),
        'title': 'Title',
        'pageType': 'TEXT',
        'blockNumber': block_number,
        'content': content,
    })


def _make_service(retriever_docs: list[Document]) -> tuple[RagRetrievalService, AsyncMock]:
    store = MagicMock()
    mock = AsyncMock(return_value=retriever_docs)
    store.similarity_search = mock
    return RagRetrievalService(vector_store_repository=store), mock


@pytest.mark.asyncio
async def test_empty_query_returns_empty() -> None:
    svc, _ = _make_service([])
    assert await svc.retrieve(WS_ID, '') == []
    assert await svc.retrieve(WS_ID, '   ') == []


@pytest.mark.asyncio
async def test_dedupes_by_page_and_block() -> None:
    docs = [
        _doc('00000000-0000-0000-0000-000000000aaa', 0),
        _doc('00000000-0000-0000-0000-000000000aaa', 0),  # dupe
        _doc('00000000-0000-0000-0000-000000000aaa', 1),
        _doc('00000000-0000-0000-0000-000000000bbb', 0),
    ]
    svc, _ = _make_service(docs)
    result = await svc.retrieve(WS_ID, 'q', k=5)
    assert len(result) == 3
    keys = {(str(d.page_id), d.block_number) for d in result}
    assert keys == {
        ('00000000-0000-0000-0000-000000000aaa', 0),
        ('00000000-0000-0000-0000-000000000aaa', 1),
        ('00000000-0000-0000-0000-000000000bbb', 0),
    }


@pytest.mark.asyncio
async def test_respects_k_limit() -> None:
    docs = [_doc(f'00000000-0000-0000-0000-00000000000{i}', 0) for i in range(1, 10)]
    svc, _ = _make_service(docs)
    result = await svc.retrieve(WS_ID, 'q', k=3)
    assert len(result) == 3


@pytest.mark.asyncio
async def test_overfetches_k_times_3() -> None:
    svc, mock = _make_service([])
    await svc.retrieve(WS_ID, 'q', k=5)
    mock.assert_awaited_once_with(
        workspace_id=str(WS_ID), query='q', k=15,
    )


def test_rag_document_accepts_snake_case_kwargs() -> None:
    from agents.apps.chat.schemas import RagDocumentSchema
    doc = RagDocumentSchema(
        page_id=UUID('00000000-0000-0000-0000-000000000001'),
        workspace_id=UUID('00000000-0000-0000-0000-000000000002'),
        title='T',
        page_type='TEXT',
        block_number=0,
        content='c',
    )
    assert doc.page_id == UUID('00000000-0000-0000-0000-000000000001')


def test_rag_document_accepts_camel_case_via_model_validate() -> None:
    from agents.apps.chat.schemas import RagDocumentSchema
    doc = RagDocumentSchema.model_validate({
        'pageId': '00000000-0000-0000-0000-000000000001',
        'workspaceId': '00000000-0000-0000-0000-000000000002',
        'title': 'T',
        'pageType': 'TEXT',
        'blockNumber': 0,
        'content': 'c',
    })
    assert doc.page_id == UUID('00000000-0000-0000-0000-000000000001')
