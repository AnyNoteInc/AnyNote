from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from agents.apps.agent.schemas import AgentResumeRequest
from agents.apps.agent.use_cases.resume_agent import ResumeAgentUseCase

from tests.apps.agent.factories import make_context


async def _async_iter(items):
    for it in items:
        yield it


@pytest.mark.asyncio
async def test_resume_uses_command_resume_with_action(monkeypatch) -> None:
    context = make_context()
    confirmation_id = 'cid-123'

    # Build a fake graph whose get_state returns a snapshot with a matching interrupt.
    fake_interrupt = MagicMock()
    fake_interrupt.value = {'confirmation_id': confirmation_id, 'tool': 't', 'summary': 's', 'args_preview': {}}

    fake_snap = MagicMock()
    fake_snap.interrupts = [fake_interrupt]
    # Provide minimal values so AgentState.model_validate succeeds.
    fake_snap.values = {
        'context': context.model_dump(),
        'user_message': 'hi',
        'chat_history': [],
        'model': {'provider': 'openai', 'name': 'gpt-4o-mini',
                  'connection': {'api_key': 'sk'}, 'settings': {}},
        'mcp_servers': [],
    }

    fake_graph = MagicMock()
    fake_graph.aget_state = AsyncMock(return_value=fake_snap)
    # astream returns an empty async iterable — no events, just a clean finish.
    fake_graph.astream = MagicMock(return_value=_async_iter([]))

    use_case = ResumeAgentUseCase(
        build_graph=lambda: fake_graph,
        run_streamer=AsyncMock(return_value=_async_iter([])),
    )

    request = AgentResumeRequest(
        chat_id=context.chat_id,
        confirmation_id=confirmation_id,
        action='allow',
    )

    events = []
    async for ev in use_case(request=request, context=context, jwt='jwt'):
        events.append(ev)

    # No error event — confirmation was found and streaming completed normally.
    assert not any(e.type == 'error' for e in events)
    assert any(e.type == 'done' for e in events)


@pytest.mark.asyncio
async def test_resume_emits_error_on_confirmation_mismatch() -> None:
    context = make_context()

    fake_snap = MagicMock()
    fake_snap.interrupts = []

    fake_graph = MagicMock()
    fake_graph.aget_state = AsyncMock(return_value=fake_snap)

    use_case = ResumeAgentUseCase(
        build_graph=lambda: fake_graph,
        run_streamer=AsyncMock(return_value=_async_iter([])),
    )

    request = AgentResumeRequest(
        chat_id=context.chat_id,
        confirmation_id='nonexistent',
        action='allow',
    )

    events = []
    async for ev in use_case(request=request, context=context, jwt='jwt'):
        events.append(ev)

    assert events[0].type == 'error'
    assert events[0].code == 'CONFIRMATION_MISMATCH'
