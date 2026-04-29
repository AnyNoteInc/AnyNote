from __future__ import annotations

from typing import cast
from uuid import uuid4

import pytest
from agents.apps.chat.enums import ModelProviderEnum, RoleEnum
from agents.apps.chat.repositories import JinjaRendererRepository, McpToolsRepository, ModelFactoryRepository
from agents.apps.chat.schemas import (
    GraphStateSchema,
    McpConfigSchema,
    ModelConnectionSchema,
    QueryRequestSchema,
    RuntimeContext,
    UserContextSchema,
)
from agents.apps.chat.services import GraphService, RagRetrievalService
from agents.apps.processing.schemas import EmbeddingProviderConfigSchema
from langchain_core.messages import AIMessage
from langchain_core.tools import StructuredTool
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver


class StubJinjaRendererRepository:
    def __init__(self) -> None:
        self.system_calls: list[tuple[QueryRequestSchema, list[object], list[object]]] = []
        self.user_calls: list[tuple[QueryRequestSchema, list[object], list[object]]] = []

    def system_render(
        self,
        context: QueryRequestSchema,
        mcp_servers: list[object],
        rag_documents: list[object],
    ) -> str:
        self.system_calls.append((context, mcp_servers, rag_documents))
        return 'rendered system prompt'

    def user_render(
        self,
        context: QueryRequestSchema,
        mcp_servers: list[object],
        rag_documents: list[object],
    ) -> str:
        self.user_calls.append((context, mcp_servers, rag_documents))
        return 'rendered user prompt'


class StubMcpToolsRepository:
    def __init__(self) -> None:
        self.calls: list[list[object]] = []

    async def fetch_mcp_tools(self, servers: list[object]) -> tuple[list[object], list[object]]:
        self.calls.append(servers)
        return [], []


class StubStreamingModel:
    def __init__(self) -> None:
        self.ainvoke_calls: list[list[object]] = []

    async def ainvoke(self, messages: list[object]) -> AIMessage:
        self.ainvoke_calls.append(messages)
        return AIMessage(content='streamed answer')

    def invoke(self, _messages: list[object]) -> AIMessage:
        raise AssertionError('llm() must use ainvoke() to preserve token streaming')


class StubModelFactoryRepository:
    def __init__(self, model: StubStreamingModel) -> None:
        self.model = model

    def make(self, _config: object) -> StubStreamingModel:
        return self.model


class StubRagRetrievalService:
    def __init__(self) -> None:
        self.calls: list[tuple[EmbeddingProviderConfigSchema, object, str, int]] = []

    async def retrieve(
        self,
        *,
        embedding: EmbeddingProviderConfigSchema,
        workspace_id: object,
        query: str,
        k: int = 5,
    ) -> list[object]:
        self.calls.append((embedding, workspace_id, query, k))
        return []


def make_embedding() -> EmbeddingProviderConfigSchema:
    return EmbeddingProviderConfigSchema(
        provider=ModelProviderEnum.OLLAMA,
        modelSlug='nomic-embed-text',
        vectorSize=768,
        connection=ModelConnectionSchema(baseUrl='http://localhost:11434'),
    )


def make_query_request(
    *,
    mcp: McpConfigSchema | None,
    embedding: EmbeddingProviderConfigSchema | None = None,
) -> QueryRequestSchema:
    return QueryRequestSchema.model_validate({
        'threadId': str(uuid4()),
        'model': {
            'provider': ModelProviderEnum.OPENAI,
            'name': 'gpt-test',
        },
        'systemPrompt': 'base system prompt',
        'instruction': {
            'citationsRequired': False,
        },
        'messages': [
            {
                'role': RoleEnum.USER,
                'content': 'Earlier message',
            },
            {
                'role': RoleEnum.ASSISTANT,
                'content': 'Earlier answer',
            },
        ],
        'mcp': mcp,
        'embedding': embedding,
        'query': 'Latest question',
    })


def make_state(
    *,
    mcp: McpConfigSchema | None,
    embedding: EmbeddingProviderConfigSchema | None = None,
) -> GraphStateSchema:
    return GraphStateSchema(
        payload=make_query_request(mcp=mcp, embedding=embedding),
        system_prompt='base system prompt',
        user_context=UserContextSchema(x_user_id=uuid4(), x_workspace_id=uuid4()),
        messages=[],
        tools=[],
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ('mcp_config',),
    [
        (None,),
        (McpConfigSchema(servers=[]),),
    ],
)
async def test_prepare_prompt_handles_missing_or_empty_mcp_servers(
    mcp_config: McpConfigSchema | None,
) -> None:
    renderer = StubJinjaRendererRepository()
    mcp_tools = StubMcpToolsRepository()
    rag_retrieval = StubRagRetrievalService()
    service = GraphService(
        jinja_repository=cast(JinjaRendererRepository, renderer),
        mcp_tools_repository=cast(McpToolsRepository, mcp_tools),
        model_factory_repository=cast(ModelFactoryRepository, object()),
        rag_retrieval_service=cast(RagRetrievalService, rag_retrieval),
        checkpointer=cast(AsyncPostgresSaver, object()),
    )

    def stale_tool() -> str:
        return 'stale'

    context = RuntimeContext(
        tools=[
            StructuredTool.from_function(
                func=stale_tool,
                name='stale_tool',
                description='stale tool',
            ),
        ],
    )

    result = await service.prepare_prompt(context, make_state(mcp=mcp_config))

    assert mcp_tools.calls == []
    assert rag_retrieval.calls == []
    assert context.tools == []
    assert len(renderer.system_calls) == 1
    assert renderer.system_calls[0][0] == result.payload
    assert renderer.system_calls[0][1] == []  # mcp_servers
    assert renderer.system_calls[0][2] == []  # rag_documents
    assert len(renderer.user_calls) == 1
    assert renderer.user_calls[0][0] == result.payload
    assert renderer.user_calls[0][1] == []  # mcp_servers
    assert renderer.user_calls[0][2] == []  # rag_documents
    assert result.system_prompt == 'rendered system prompt'
    assert result.tools == []
    assert [type(message).__name__ for message in result.messages] == [
        'SystemMessage',
        'HumanMessage',
        'AIMessage',
        'HumanMessage',
    ]
    assert [str(message.content) for message in result.messages] == [
        'base system prompt',
        'Earlier message',
        'Earlier answer',
        'rendered user prompt',
    ]


@pytest.mark.asyncio
async def test_prepare_prompt_retrieves_rag_documents_when_embedding_is_configured() -> None:
    renderer = StubJinjaRendererRepository()
    mcp_tools = StubMcpToolsRepository()
    rag_retrieval = StubRagRetrievalService()
    service = GraphService(
        jinja_repository=cast(JinjaRendererRepository, renderer),
        mcp_tools_repository=cast(McpToolsRepository, mcp_tools),
        model_factory_repository=cast(ModelFactoryRepository, object()),
        rag_retrieval_service=cast(RagRetrievalService, rag_retrieval),
        checkpointer=cast(AsyncPostgresSaver, object()),
    )
    embedding = make_embedding()
    state = make_state(mcp=None, embedding=embedding)

    result = await service.prepare_prompt(RuntimeContext(), state)

    assert rag_retrieval.calls == [(embedding, state.user_context.x_workspace_id, 'Latest question', 5)]
    assert renderer.system_calls[0][0] == result.payload
    assert renderer.system_calls[0][2] == []
    assert renderer.user_calls[0][0] == result.payload
    assert renderer.user_calls[0][2] == []


@pytest.mark.asyncio
async def test_llm_uses_async_model_invocation_to_allow_streaming() -> None:
    model = StubStreamingModel()
    service = GraphService(
        jinja_repository=cast(JinjaRendererRepository, object()),
        mcp_tools_repository=cast(McpToolsRepository, object()),
        model_factory_repository=cast(ModelFactoryRepository, StubModelFactoryRepository(model)),
        rag_retrieval_service=cast(RagRetrievalService, StubRagRetrievalService()),
        checkpointer=cast(AsyncPostgresSaver, object()),
    )

    state = make_state(mcp=None)
    state.messages = [AIMessage(content='previous answer')]

    result = await service.llm(RuntimeContext(), state)

    assert model.ainvoke_calls == [state.messages]
    assert result.response_text == 'streamed answer'
    assert isinstance(result.messages[-1], AIMessage)
    assert result.messages[-1].content == 'streamed answer'
