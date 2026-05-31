from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from agents.apps.agent.schemas import ServerEventSchema
from agents.apps.agent.services.graph_streaming import GraphStreamingService

from tests.apps.agent.factories import make_state


def test_thinking_event_serializes() -> None:
    ev = ServerEventSchema(type='thinking', text='let me think')
    data = ev.model_dump_json(exclude_none=True)
    assert '"type":"thinking"' in data
    assert 'let me think' in data


def _graph_with_final_state(state) -> AsyncMock:
    snapshot = SimpleNamespace(values=state.model_dump(by_alias=True))
    graph = AsyncMock()
    graph.aget_state = AsyncMock(return_value=snapshot)
    return graph


@pytest.mark.asyncio
async def test_final_events_emit_thinking_before_token() -> None:
    state = make_state()
    state = state.model_copy(update={
        'final_reasoning': 'I reasoned about it',
        'final_answer': 'the answer',
    })
    graph = _graph_with_final_state(state)

    # streamed_any_token=False → fallback path, final_answer is emitted as token
    events = [ev async for ev in GraphStreamingService()._yield_final_events(graph, {}, False)]

    types = [e.type for e in events]
    assert types[:2] == ['thinking', 'token']
    assert events[0].text == 'I reasoned about it'
    assert events[1].text == 'the answer'


@pytest.mark.asyncio
async def test_final_events_skip_thinking_when_no_reasoning() -> None:
    state = make_state()
    state = state.model_copy(update={'final_reasoning': '', 'final_answer': 'the answer'})
    graph = _graph_with_final_state(state)

    # streamed_any_token=False → fallback path, final_answer is emitted as token
    events = [ev async for ev in GraphStreamingService()._yield_final_events(graph, {}, False)]

    types = [e.type for e in events]
    assert 'thinking' not in types
    assert types[0] == 'token'
