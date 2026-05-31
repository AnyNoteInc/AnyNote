import pytest

from langchain_core.tools import StructuredTool
from langgraph.checkpoint.memory import MemorySaver
from langgraph.config import get_stream_writer
from langgraph.graph import START, StateGraph

from agents.apps.agent.schemas import AgentState
from agents.apps.agent.services.graph_streaming import GraphStreamingService
from agents.apps.agent.services.nodes.tool_runner import tool_runner_node

from tests.apps.agent.factories import make_state


@pytest.mark.asyncio
async def test_tool_status_custom_events_are_translated_in_order():
    def node(state: AgentState):
        writer = get_stream_writer()
        writer({'kind': 'tool_status', 'id': 't1', 'tool': 'search', 'state': 'running', 'title': 'search'})
        writer({'kind': 'tool_status', 'id': 't1', 'tool': 'search', 'state': 'done', 'title': 'search', 'detail': 'ok'})
        return {}

    g = StateGraph(AgentState)
    g.add_node('executor', node)
    g.add_edge(START, 'executor')
    compiled = g.compile(checkpointer=MemorySaver())

    initial = make_state(user_message='hi')
    config = {'configurable': {'thread_id': 't'}}

    events = [
        ev async for ev in GraphStreamingService().stream(compiled, initial, config, initial)
    ]
    tool_events = [e for e in events if e.type == 'tool_status']
    assert [(e.id, e.state) for e in tool_events] == [('t1', 'running'), ('t1', 'done')]
    assert tool_events[1].detail == 'ok'


@pytest.mark.asyncio
async def test_tool_runner_emits_running_then_done():
    async def _echo(value: str) -> str:
        return f'echoed:{value}'

    tool = StructuredTool.from_function(coroutine=_echo, name='echo', description='echo')

    async def runner(state: AgentState):
        return await tool_runner_node(state, tools=[tool], tool_registry={})

    g = StateGraph(AgentState)
    g.add_node('tool_runner', runner)
    g.add_edge(START, 'tool_runner')
    compiled = g.compile(checkpointer=MemorySaver())

    initial = make_state(
        user_message='hi',
        pending_tool_calls=[{'name': 'echo', 'args': {'value': 'x'}, 'id': 'call-1'}],
    )
    config = {'configurable': {'thread_id': 't2'}}

    events = [e async for e in GraphStreamingService().stream(compiled, initial, config, initial)]
    tool_events = [(e.id, e.state) for e in events if e.type == 'tool_status']
    assert ('call-1', 'running') in tool_events
    assert ('call-1', 'done') in tool_events
    assert tool_events.index(('call-1', 'running')) < tool_events.index(('call-1', 'done'))


@pytest.mark.asyncio
async def test_tool_runner_emits_error_for_camelcase_tool_failure():
    async def _boom(value: str) -> str:
        raise RuntimeError('kaboom')

    tool = StructuredTool.from_function(coroutine=_boom, name='createPage', description='x')

    async def runner(state: AgentState):
        return await tool_runner_node(state, tools=[tool], tool_registry={})

    g = StateGraph(AgentState)
    g.add_node('tool_runner', runner)
    g.add_edge(START, 'tool_runner')
    compiled = g.compile(checkpointer=MemorySaver())

    initial = make_state(
        user_message='hi',
        pending_tool_calls=[{'name': 'createPage', 'args': {'value': 'x'}, 'id': 'cp1'}],
    )
    config = {'configurable': {'thread_id': 'err1'}}

    events = [e async for e in GraphStreamingService().stream(compiled, initial, config, initial)]
    tool_events = {(e.id, e.state) for e in events if e.type == 'tool_status'}
    assert ('cp1', 'error') in tool_events
    assert ('cp1', 'done') not in tool_events


@pytest.mark.asyncio
async def test_tool_runner_emits_error_for_unregistered_tool():
    async def runner(state: AgentState):
        return await tool_runner_node(state, tools=[], tool_registry={})

    g = StateGraph(AgentState)
    g.add_node('tool_runner', runner)
    g.add_edge(START, 'tool_runner')
    compiled = g.compile(checkpointer=MemorySaver())

    initial = make_state(
        user_message='hi',
        pending_tool_calls=[{'name': 'ghostTool', 'args': {}, 'id': 'g1'}],
    )
    config = {'configurable': {'thread_id': 'unreg1'}}

    events = [e async for e in GraphStreamingService().stream(compiled, initial, config, initial)]
    tool_events = {(e.id, e.state) for e in events if e.type == 'tool_status'}
    assert ('g1', 'error') in tool_events
    assert ('g1', 'done') not in tool_events
