from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain_core.messages import AIMessage
from langgraph.checkpoint.memory import MemorySaver

from agents.apps.agent.events import ServerEvent
from agents.apps.agent.schemas import AgentRunRequest, AgentContext
from agents.apps.agent.use_cases.run_agent import RunAgentUseCase
from tests.apps.agent.factories import make_context


@pytest.mark.asyncio
async def test_run_agent_streams_router_decision_first():
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
        llm_factory=lambda model: fake_llm,
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
    )

    context = make_context()
    request = AgentRunRequest.model_validate({
        'chat_id': str(context.chat_id),
        'user_message': 'hi',
        'chat_history': [],
        'model': {'provider': 'openai', 'name': 'gpt-4o-mini',
                  'connection': {'api_key': 'sk'}, 'settings': {}},
    })

    events: list[ServerEvent] = []
    async for ev in use_case(request=request, context=context, jwt='jwt'):
        events.append(ev)

    types = [e.type for e in events]
    assert types[0] == 'router_decision'
    assert 'done' in types
