from unittest.mock import patch

import pytest
from agents.apps.agent.services.nodes.tool_runner import tool_runner_node
from agents.apps.agent.services.tool_registry import ToolMeta
from langchain_core.messages import ToolMessage
from langchain_core.tools import StructuredTool
from pydantic import BaseModel

from tests.apps.agent.factories import make_state


class _Args(BaseModel):
    x: int = 0


class _CreatePageArgs(BaseModel):
    title: str
    markdown: str | None = None


def _fake_tool(name: str, returns: str = 'OK') -> StructuredTool:
    async def _call(**kwargs):
        return returns

    return StructuredTool.from_function(coroutine=_call, name=name, description='t', args_schema=_Args)


@pytest.mark.asyncio
async def test_tool_runner_returns_unchanged_when_no_pending() -> None:
    state = make_state(pending_tool_calls=[])
    out = await tool_runner_node(state, tools=[_fake_tool('a')], tool_registry={})
    # No-op: returns state unchanged (identity or equivalent)
    assert out.pending_tool_calls == []
    assert out.tool_calls_made == state.tool_calls_made


@pytest.mark.asyncio
async def test_tool_runner_invokes_each_pending_call_and_clears_list() -> None:
    state = make_state(pending_tool_calls=[
        {'name': 'a', 'args': {'x': 1}, 'id': 'call-1'},
    ])
    out = await tool_runner_node(state, tools=[_fake_tool('a', returns='RESULT')], tool_registry={})
    assert out.pending_tool_calls == []
    assert out.tool_calls_made == state.tool_calls_made + 1
    # ToolMessage appended to messages
    last = out.messages[-1]
    assert isinstance(last, ToolMessage)
    assert last.tool_call_id == 'call-1'
    assert 'RESULT' in str(last.content)


@pytest.mark.asyncio
async def test_tool_runner_returns_not_registered_message_for_unknown_tool() -> None:
    state = make_state(pending_tool_calls=[
        {'name': 'missing', 'args': {}, 'id': 'call-x'},
    ])
    out = await tool_runner_node(state, tools=[], tool_registry={})
    assert out.pending_tool_calls == []
    last = out.messages[-1]
    assert isinstance(last, ToolMessage)
    assert 'not registered' in str(last.content)


@pytest.mark.asyncio
async def test_tool_runner_runs_multiple_calls_in_order() -> None:
    state = make_state(pending_tool_calls=[
        {'name': 'a', 'args': {'x': 1}, 'id': 'call-1'},
        {'name': 'b', 'args': {'x': 2}, 'id': 'call-2'},
    ])
    tools = [_fake_tool('a', returns='A_RESULT'), _fake_tool('b', returns='B_RESULT')]
    out = await tool_runner_node(state, tools=tools, tool_registry={})
    assert out.pending_tool_calls == []
    assert out.tool_calls_made == state.tool_calls_made + 2
    assert len(out.messages) == len(state.messages) + 2
    assert out.messages[-2].tool_call_id == 'call-1'  # type: ignore[attr-defined]
    assert out.messages[-1].tool_call_id == 'call-2'  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_tool_runner_fires_interrupt_for_confirmation_tool() -> None:
    meta = ToolMeta(
        name='createPage',
        required_scope='pages:write',
        requires_confirmation=True,
        summarize=lambda args: 'Create X',
        preview=lambda args: args,
    )
    state = make_state(pending_tool_calls=[
        {'name': 'anynote__createPage', 'args': {'x': 0}, 'id': 'call-c'},
    ])
    tool = _fake_tool('anynote__createPage', returns='created')

    with patch('agents.apps.agent.services.nodes.tool_runner.interrupt') as fake_interrupt:
        fake_interrupt.return_value = {'action': 'allow'}
        out = await tool_runner_node(
            state,
            tools=[tool],
            tool_registry={'anynote__createPage': meta},
        )
        fake_interrupt.assert_called_once()
        last = out.messages[-1]
        assert isinstance(last, ToolMessage)
        assert 'created' in str(last.content)


@pytest.mark.asyncio
async def test_tool_runner_returns_deny_message_on_user_deny() -> None:
    meta = ToolMeta(
        name='createPage',
        required_scope='pages:write',
        requires_confirmation=True,
        summarize=lambda args: 'Create X',
        preview=lambda args: args,
    )
    state = make_state(pending_tool_calls=[
        {'name': 'anynote__createPage', 'args': {'x': 0}, 'id': 'call-d'},
    ])
    tool = _fake_tool('anynote__createPage', returns='created')

    with patch('agents.apps.agent.services.nodes.tool_runner.interrupt') as fake_interrupt:
        fake_interrupt.return_value = {'action': 'deny'}
        out = await tool_runner_node(
            state,
            tools=[tool],
            tool_registry={'anynote__createPage': meta},
        )
        last = out.messages[-1]
        assert isinstance(last, ToolMessage)
        assert 'denied' in str(last.content).lower()


@pytest.mark.asyncio
async def test_tool_runner_fills_create_page_markdown_from_previous_assistant_reply() -> None:
    captured: dict[str, object] = {}

    async def _create_page(**kwargs):
        captured.update(kwargs)
        return {'pageId': 'page-1'}

    tool = StructuredTool.from_function(
        coroutine=_create_page,
        name='anynote__createPage',
        description='create page',
        args_schema=_CreatePageArgs,
    )
    state = make_state(
        user_message='создай стараницу',
        chat_history=[
            {'role': 'user', 'content': 'напиши как готовить яичницу'},
            {
                'role': 'assistant',
                'content': 'Чтобы приготовить яичницу, разогрейте сковороду и разбейте яйца.',
            },
        ],
        pending_tool_calls=[
            {'name': 'anynote__createPage', 'args': {'title': 'Как готовить яичницу'}, 'id': 'call-page'},
        ],
    )

    out = await tool_runner_node(state, tools=[tool], tool_registry={})

    assert out.pending_tool_calls == []
    assert captured['markdown'] == 'Чтобы приготовить яичницу, разогрейте сковороду и разбейте яйца.'


@pytest.mark.asyncio
async def test_tool_runner_fills_create_page_markdown_for_matching_short_topic_followup() -> None:
    captured: dict[str, object] = {}

    async def _create_page(**kwargs):
        captured.update(kwargs)
        return {'pageId': 'page-1'}

    tool = StructuredTool.from_function(
        coroutine=_create_page,
        name='anynote__createPage',
        description='create page',
        args_schema=_CreatePageArgs,
    )
    previous = '## Русская баня\n\nРусская баня — это пар, веник и традиционный отдых.'
    state = make_state(
        user_message='создай страницу о бане',
        chat_history=[
            {'role': 'user', 'content': 'расскажи мне про русскую баню'},
            {'role': 'assistant', 'content': previous},
        ],
        pending_tool_calls=[
            {'name': 'anynote__createPage', 'args': {'title': 'Русская баня'}, 'id': 'call-page'},
        ],
    )

    out = await tool_runner_node(state, tools=[tool], tool_registry={})

    assert out.pending_tool_calls == []
    assert captured['markdown'] == previous
