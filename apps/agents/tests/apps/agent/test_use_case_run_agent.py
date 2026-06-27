import json
from unittest.mock import AsyncMock, MagicMock

import pytest
from agents.apps.agent.schemas import AgentRunRequestSchema, ServerEventSchema
from agents.apps.agent.services.graph_streaming import GraphStreamingService
from agents.apps.agent.use_cases.run_agent import (
    _GRAPH_RECURSION_LIMIT,
    RunAgentUseCase,
)
from langchain_core.messages import AIMessage
from langgraph.checkpoint.memory import MemorySaver
from langgraph.errors import GraphRecursionError

from tests.apps.agent.factories import make_context


@pytest.mark.asyncio
async def test_run_agent_streams_router_decision_first() -> None:
    # Stub LLM so router → planner → executor → critic → memory_writer all complete
    # quickly with deterministic outputs.
    router_resp = json.dumps({'kind': 'trivial', 'reason': 'ok'})
    critic_resp = json.dumps({'verdict': 'approve', 'feedback': 'looks good'})
    # router: trivial; critic: approve — executor returns text, memory_writer is no-op
    call_count = 0

    async def fake_ainvoke(messages):
        nonlocal call_count
        call_count += 1
        # First call is the router, subsequent calls (executor, critic) return plain text
        if call_count == 1:
            return AIMessage(content=router_resp)
        elif call_count == 2:
            return AIMessage(content='answer text')
        else:
            return AIMessage(content=critic_resp)

    fake_llm = MagicMock()
    fake_llm.bind_tools = lambda tools: fake_llm
    fake_llm.ainvoke = fake_ainvoke

    use_case = RunAgentUseCase(
        llm_factory=lambda model, reasoning=None: fake_llm,
        mcp_client=AsyncMock(
            discover_all=AsyncMock(return_value={}),
            build_langchain_tools=lambda d, s: [],
        ),
        rag_service=AsyncMock(retrieve=AsyncMock(return_value=[])),
        memory_writer_client=AsyncMock(write_batch=AsyncMock(return_value=None)),
        action_log_repo=AsyncMock(write_batch=AsyncMock(return_value=None)),
        renderer=MagicMock(
            render_router=lambda **kw: 'router-prompt',
            render_planner=lambda **kw: 'planner-prompt',
            render_executor=lambda **kw: 'executor-prompt',
            render_critic=lambda **kw: 'critic-prompt',
        ),
        checkpointer=MemorySaver(),
        streaming_service=GraphStreamingService(),
    )

    context = make_context()
    request = AgentRunRequestSchema.model_validate(
        {
            'chat_id': str(context.chat_id),
            'user_message': 'hi',
            'chat_history': [],
            'model': {'provider': 'openai', 'name': 'gpt-4o-mini', 'connection': {'api_key': 'sk'}, 'settings': {}},
        }
    )

    events: list[ServerEventSchema] = []
    async for ev in use_case(request=request, context=context, jwt='jwt'):
        events.append(ev)

    types = [e.type for e in events]
    assert types[0] == 'router_decision'
    assert 'done' in types


@pytest.mark.asyncio
async def test_run_agent_emits_recoverable_error_on_recursion_limit() -> None:
    # When the graph blows past its super-step ceiling, the use case must set an
    # explicit recursion_limit on the config AND degrade gracefully: a RECOVERABLE
    # error event, not the hard unrecoverable INTERNAL_ERROR.
    class RecursionStreamingService:
        async def stream(self, graph, initial, config, init):
            assert config.get('recursion_limit') == _GRAPH_RECURSION_LIMIT
            # `if False: yield` makes this an async generator (so the use case
            # consumes it with `async for`) without any unreachable code: the
            # yield is never executed, and the raise below is the live behaviour.
            if False:
                yield
            raise GraphRecursionError('Recursion limit reached')

    use_case = RunAgentUseCase(
        llm_factory=lambda model, reasoning=None: MagicMock(),
        mcp_client=AsyncMock(
            discover_all=AsyncMock(return_value={}),
            build_langchain_tools=lambda d, s: [],
        ),
        rag_service=AsyncMock(retrieve=AsyncMock(return_value=[])),
        memory_writer_client=AsyncMock(write_batch=AsyncMock(return_value=None)),
        action_log_repo=AsyncMock(write_batch=AsyncMock(return_value=None)),
        renderer=MagicMock(),
        checkpointer=MemorySaver(),
        streaming_service=RecursionStreamingService(),
    )

    context = make_context()
    request = AgentRunRequestSchema.model_validate(
        {
            'chat_id': str(context.chat_id),
            'user_message': 'hi',
            'chat_history': [],
            'model': {'provider': 'openai', 'name': 'gpt-4o-mini', 'connection': {'api_key': 'sk'}, 'settings': {}},
        }
    )

    events: list[ServerEventSchema] = []
    async for ev in use_case(request=request, context=context, jwt='jwt'):
        events.append(ev)

    error_events = [e for e in events if e.type == 'error']
    assert error_events, 'expected an error event'
    assert any(e.recoverable is True for e in error_events)
    # The hard unrecoverable INTERNAL_ERROR path must NOT be taken here.
    assert not any(e.code == 'INTERNAL_ERROR' for e in error_events)
