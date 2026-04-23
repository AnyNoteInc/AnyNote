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
                        'id': str(uuid4()),
                        'title': 'Документ 1',
                        'content': 'Факт из базы знаний',
                    },
                ],
            },
            'query': 'Что известно?',
        }
    )


def test_render_includes_structured_retrieved_context_and_kb_tool_hints() -> None:
    base_dir = Path(__file__).resolve().parents[4]
    repository = JinjaRendererRepository(cast(SettingsSchema, SimpleNamespace(base_dir=str(base_dir))))

    rendered = repository.render(make_query_request(), [])

    assert '## Retrieved context' in rendered
    assert '### Документ 1' in rendered
    assert '- pageId:' in rendered
    assert '- title: Документ 1' in rendered
    assert 'Факт из базы знаний' in rendered
    assert 'getPageMarkdown(pageId)' in rendered
    assert 'getPageStats(pageId)' in rendered
    assert 'getWorkspaceStats()' in rendered
    assert '[{title}](page:{pageId})' in rendered
