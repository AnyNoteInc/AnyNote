import os
from unittest.mock import MagicMock

from agents.apps.chat.enums import ModelProviderEnum
from agents.apps.chat.repositories.jinja_renderer import JinjaRendererRepository
from agents.apps.chat.schemas import QueryRequestSchema, RagDocumentSchema


def _settings() -> MagicMock:
    s = MagicMock()
    # apps/agents/ directory — the renderer will join base_dir + 'agents/apps/chat/templates'
    s.base_dir = os.path.abspath(
        os.path.join(os.path.dirname(__file__), '..', '..', '..', '..')
    )
    return s


def _payload() -> QueryRequestSchema:
    return QueryRequestSchema.model_validate({
        'threadId': '00000000-0000-0000-0000-000000000001',
        'model': {
            'provider': ModelProviderEnum.OLLAMA,
            'name': 'test',
        },
        'systemPrompt': '',
        'instruction': {
            'format': 'markdown',
            'language': 'ru',
            'citationsRequired': True,
        },
        'messages': [],
        'rag': None,
        'mcp': None,
        'query': 'test query',
    })


def _rag_doc() -> RagDocumentSchema:
    # RequestResponseSchema uses camelCase aliases; pass camelCase kwargs
    return RagDocumentSchema.model_validate({
        'pageId': '00000000-0000-0000-0000-000000000002',
        'workspaceId': '00000000-0000-0000-0000-000000000003',
        'title': 'Cafe',
        'pageType': 'TEXT',
        'blockNumber': 7,
        'content': 'coffee details',
    })


def test_user_render_with_rag_documents_has_anchor_link() -> None:
    renderer = JinjaRendererRepository(_settings())
    result = renderer.user_render(_payload(), [], [_rag_doc()])
    # citation format literal appears as placeholder string
    assert '/workspaces/' in result
    assert '/pages/' in result
    # {blockNumber} literal in the citation example (Jinja `{{ '{blockNumber}' }}`)
    assert '#{blockNumber}' in result
    # rendered doc body has blockNumber: 7 and the content chunk
    assert 'blockNumber: 7' in result
    assert 'coffee details' in result


def test_user_render_without_rag_omits_retrieved_context() -> None:
    renderer = JinjaRendererRepository(_settings())
    result = renderer.user_render(_payload(), [], [])
    assert 'Retrieved context' not in result


def test_user_render_includes_query() -> None:
    renderer = JinjaRendererRepository(_settings())
    result = renderer.user_render(_payload(), [], [])
    assert 'test query' in result


def test_system_render_renders_tools_section() -> None:
    renderer = JinjaRendererRepository(_settings())
    result = renderer.system_render(_payload(), [], [])
    # getPageMarkdown is referenced in the # TOOLS section regardless
    assert 'getPageMarkdown' in result


def test_system_render_omits_rag_and_query() -> None:
    renderer = JinjaRendererRepository(_settings())
    result = renderer.system_render(_payload(), [], [_rag_doc()])
    # RAG content lives in the user prompt — only the priority-list mention of
    # "Retrieved context" should remain, never the actual document body.
    assert 'coffee details' not in result
    assert 'blockNumber: 7' not in result
    # The query also belongs to the user prompt
    assert 'test query' not in result
