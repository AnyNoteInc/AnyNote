from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest
from agents.apps.chat.enums import ModelProviderEnum
from agents.apps.chat.schemas import (
    GraphStateSchema,
    ModelConnectionSchema,
    QueryRequestSchema,
    RuntimeContext,
    UserContextSchema,
)
from agents.apps.chat.services.graph import GraphService
from agents.apps.processing.schemas import EmbeddingProviderConfigSchema


@pytest.mark.asyncio
async def test_prepare_prompt_invokes_retrieval_and_render() -> None:
    jinja = MagicMock()
    jinja.system_render = MagicMock(return_value='SYSTEM')
    jinja.user_render = MagicMock(return_value='USER')
    mcp = MagicMock()
    mcp.fetch_mcp_tools = AsyncMock(return_value=([], []))
    retrieval = MagicMock()
    retrieval.retrieve = AsyncMock(return_value=[])
    embedding = EmbeddingProviderConfigSchema(
        provider=ModelProviderEnum.OLLAMA,
        modelSlug='nomic-embed-text',
        vectorSize=768,
        connection=ModelConnectionSchema(baseUrl='http://localhost:11434'),
    )

    svc = GraphService(
        jinja_repository=jinja,
        mcp_tools_repository=mcp,
        model_factory_repository=MagicMock(),
        rag_retrieval_service=retrieval,
        checkpointer=MagicMock(),
    )

    ws_id = UUID('00000000-0000-0000-0000-000000000001')
    user_id = UUID('00000000-0000-0000-0000-000000000002')
    payload = QueryRequestSchema.model_validate({
        'threadId': '00000000-0000-0000-0000-000000000003',
        'model': {
            'provider': ModelProviderEnum.OLLAMA,
            'name': 'x',
            'connection': {},
            'settings': {},
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
        'embedding': embedding,
        'query': 'ping',
    })
    state = GraphStateSchema(
        system_prompt='',
        payload=payload,
        user_context=UserContextSchema(x_user_id=user_id, x_workspace_id=ws_id),
        messages=[],
        tools=[],
        response_text='',
    )

    new_state = await svc.prepare_prompt(RuntimeContext(), state)

    retrieval.retrieve.assert_awaited_once_with(
        embedding=embedding, workspace_id=ws_id, query='ping', k=5,
    )
    jinja.system_render.assert_called_once()
    jinja.user_render.assert_called_once()
    assert new_state.system_prompt == 'SYSTEM'
    assert str(new_state.messages[-1].content) == 'USER'


@pytest.mark.asyncio
async def test_prepare_prompt_skips_retrieval_when_embedding_is_missing() -> None:
    jinja = MagicMock()
    jinja.system_render = MagicMock(return_value='SYSTEM')
    jinja.user_render = MagicMock(return_value='USER')
    mcp = MagicMock()
    mcp.fetch_mcp_tools = AsyncMock(return_value=([], []))
    retrieval = MagicMock()
    retrieval.retrieve = AsyncMock(return_value=[])

    svc = GraphService(
        jinja_repository=jinja,
        mcp_tools_repository=mcp,
        model_factory_repository=MagicMock(),
        rag_retrieval_service=retrieval,
        checkpointer=MagicMock(),
    )

    ws_id = UUID('00000000-0000-0000-0000-000000000001')
    user_id = UUID('00000000-0000-0000-0000-000000000002')
    payload = QueryRequestSchema.model_validate({
        'threadId': '00000000-0000-0000-0000-000000000003',
        'model': {
            'provider': ModelProviderEnum.OLLAMA,
            'name': 'x',
            'connection': {},
            'settings': {},
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
        'query': 'ping',
    })
    state = GraphStateSchema(
        system_prompt='',
        payload=payload,
        user_context=UserContextSchema(x_user_id=user_id, x_workspace_id=ws_id),
        messages=[],
        tools=[],
        response_text='',
    )

    await svc.prepare_prompt(RuntimeContext(), state)

    retrieval.retrieve.assert_not_awaited()
    jinja.system_render.assert_called_once_with(payload, [], [])
    jinja.user_render.assert_called_once_with(payload, [], [])
