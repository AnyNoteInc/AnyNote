from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from agents.apps.agent.schemas import AgentResumeRequestSchema
from agents.apps.agent.use_cases.resume_agent import ResumeAgentUseCase

from tests.apps.agent.factories import make_context


async def _async_iter(items):
    for it in items:
        yield it


def _state_values(context):
    return {
        'context': context.model_dump(),
        'user_message': 'hi',
        'chat_history': [],
        'model': {
            'provider': 'openai',
            'name': 'gpt-4o-mini',
            'connection': {'api_key': 'sk'},
            'settings': {},
        },
        'mcp_servers': [],
    }


def _build_use_case():
    mcp_client = MagicMock()
    mcp_client.discover_all = AsyncMock(return_value={})
    mcp_client.build_langchain_tools = MagicMock(return_value=[])
    return ResumeAgentUseCase(
        llm_factory=MagicMock(return_value=MagicMock()),
        mcp_client=mcp_client,
        rag_service=MagicMock(),
        memory_writer_client=MagicMock(),
        action_log_repo=MagicMock(),
        renderer=MagicMock(),
        checkpointer=MagicMock(),
    )


@pytest.mark.asyncio
async def test_resume_runs_graph_when_confirmation_matches() -> None:
    context = make_context()
    confirmation_id = 'cid-123'

    fake_interrupt = MagicMock()
    fake_interrupt.value = {
        'confirmation_id': confirmation_id,
        'tool': 't',
        'summary': 's',
        'args_preview': {},
    }
    fake_snap = MagicMock()
    fake_snap.interrupts = [fake_interrupt]
    fake_snap.values = _state_values(context)

    fake_graph = MagicMock()
    fake_graph.aget_state = AsyncMock(return_value=fake_snap)
    fake_graph.astream = MagicMock(return_value=_async_iter([]))

    use_case = _build_use_case()

    request = AgentResumeRequestSchema(
        chat_id=context.chat_id,
        confirmation_id=confirmation_id,
        action='allow',
    )

    with patch(
        'agents.apps.agent.use_cases.resume_agent.build_agent_graph',
        return_value=fake_graph,
    ):
        events = [ev async for ev in use_case(request=request, context=context, jwt='jwt')]

    assert not any(e.type == 'error' for e in events)
    assert any(e.type == 'done' for e in events)


@pytest.mark.asyncio
async def test_resume_emits_error_on_confirmation_mismatch() -> None:
    context = make_context()

    fake_snap = MagicMock()
    fake_snap.interrupts = []
    fake_graph = MagicMock()
    fake_graph.aget_state = AsyncMock(return_value=fake_snap)

    use_case = _build_use_case()
    request = AgentResumeRequestSchema(
        chat_id=context.chat_id,
        confirmation_id='nonexistent',
        action='allow',
    )

    with patch(
        'agents.apps.agent.use_cases.resume_agent.build_agent_graph',
        return_value=fake_graph,
    ):
        events = [ev async for ev in use_case(request=request, context=context, jwt='jwt')]

    assert events[0].type == 'error'
    assert events[0].code == 'CONFIRMATION_MISMATCH'
