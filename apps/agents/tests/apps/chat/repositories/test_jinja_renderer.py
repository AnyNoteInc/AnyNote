from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import cast
from uuid import uuid4

from agents.apps.chat.enums import ModelProviderEnum
from agents.apps.chat.repositories import JinjaRendererRepository
from agents.apps.chat.schemas import QueryRequestSchema
from agents.settings import SettingsSchema


def make_query_request() -> QueryRequestSchema:
    page_id = str(uuid4())
    workspace_id = str(uuid4())
    created_by_id = str(uuid4())
    return QueryRequestSchema.model_validate(
        {
            'threadId': str(uuid4()),
            'model': {
                'provider': ModelProviderEnum.OPENAI,
                'name': 'gpt-test',
            },
            'systemPrompt': 'base system prompt',
            'instruction': {
                'citationsRequired': True,
                'language': 'ru',
            },
            'rag': {
                'documents': [
                    {
                        'pageId': page_id,
                        'workspaceId': workspace_id,
                        'chunkIndex': 7,
                        'title': 'Документ 1',
                        'content': 'Факт из базы знаний',
                        'pageType': 'TEXT',
                        'createdById': created_by_id,
                        'createdAt': '2026-04-24T05:44:21.587Z',
                        'updatedAt': '2026-04-24T05:47:37.417Z',
                    },
                ],
            },
            'query': 'Что известно?',
        }
    )


def test_query_request_serializes_qdrant_rag_metadata_with_camel_case_aliases() -> None:
    request = make_query_request()

    assert request.rag is not None
    payload = request.model_dump(mode='json', by_alias=True)

    assert payload['rag']['documents'] == [
        {
            'pageId': request.rag.documents[0].page_id,
            'workspaceId': request.rag.documents[0].workspace_id,
            'chunkIndex': 7,
            'title': 'Документ 1',
            'content': 'Факт из базы знаний',
            'pageType': 'TEXT',
            'createdById': request.rag.documents[0].created_by_id,
            'createdAt': '2026-04-24T05:44:21.587000Z',
            'updatedAt': '2026-04-24T05:47:37.417000Z',
        },
    ]


def test_render_includes_structured_retrieved_context_and_kb_tool_hints() -> None:
    base_dir = Path(__file__).resolve().parents[4]
    repository = JinjaRendererRepository(cast(SettingsSchema, SimpleNamespace(base_dir=str(base_dir))))

    request = make_query_request()
    rendered = repository.render(request, [])

    assert '## Retrieved context' in rendered
    assert '### Документ 1' in rendered
    assert request.rag is not None
    assert f'- pageId: {request.rag.documents[0].page_id}' in rendered
    assert f'- workspaceId: {request.rag.documents[0].workspace_id}' in rendered
    assert '- chunkIndex: 7' in rendered
    assert '- title: Документ 1' in rendered
    assert '- pageType: TEXT' in rendered
    assert f'- createdById: {request.rag.documents[0].created_by_id}' in rendered
    assert '- createdAt: 2026-04-24T05:44:21.587000Z' in rendered
    assert '- updatedAt: 2026-04-24T05:47:37.417000Z' in rendered
    assert 'Факт из базы знаний' in rendered
    assert 'getPageMarkdown(pageId)' in rendered
    assert 'getPageStats(pageId)' in rendered
    assert 'getWorkspaceStats()' in rendered
    assert '[{title}](/workspaces/{workspaceId}/pages/{pageId})' in rendered
