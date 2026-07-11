from unittest.mock import patch
from uuid import uuid4

import pytest
from agents.apps.agent.services.nodes.tool_runner import tool_runner_node
from agents.apps.agent.services.tool_registry import ToolMeta
from langchain_core.messages import ToolMessage
from langchain_core.tools import StructuredTool
from pydantic import BaseModel

from tests.apps.agent.factories import make_context, make_state


class _Args(BaseModel):
    x: int = 0


class _CreatePageArgs(BaseModel):
    title: str
    markdown: str | None = None


class _PageArgs(BaseModel):
    pageId: str  # noqa: N815 — must match the MCP tool arg name


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


def _page_write_meta(name: str = 'updatePage') -> ToolMeta:
    return ToolMeta(
        name=name,
        required_scope='pages:write',
        requires_confirmation=True,
        summarize=lambda args: f'Update {args.get("pageId")}',
        preview=lambda args: args,
        page_arg='pageId',
    )


def _page_write_tool(name: str, on_call) -> StructuredTool:
    return StructuredTool.from_function(
        coroutine=on_call, name=name, description='t', args_schema=_PageArgs,
    )


@pytest.mark.asyncio
async def test_tool_runner_denies_page_bound_write_targeting_other_page() -> None:
    bound = uuid4()
    invoked = False

    async def _update(**kwargs):
        nonlocal invoked
        invoked = True
        return 'updated'

    state = make_state(
        context=make_context(page_id=bound),
        pending_tool_calls=[
            {'name': 'anynote__updatePage', 'args': {'pageId': str(uuid4())}, 'id': 'call-1'},
        ],
    )
    with patch('agents.apps.agent.services.nodes.tool_runner.interrupt') as fake_interrupt:
        out = await tool_runner_node(
            state,
            tools=[_page_write_tool('anynote__updatePage', _update)],
            tool_registry={'anynote__updatePage': _page_write_meta()},
        )
        fake_interrupt.assert_not_called()
    assert invoked is False
    last = out.messages[-1]
    assert isinstance(last, ToolMessage)
    assert 'Permission denied' in str(last.content)
    assert str(bound) in str(last.content)


@pytest.mark.asyncio
async def test_tool_runner_allows_page_bound_write_targeting_bound_page() -> None:
    bound = uuid4()

    async def _update(**kwargs):
        return 'updated'

    state = make_state(
        context=make_context(page_id=bound),
        pending_tool_calls=[
            {'name': 'anynote__updatePage', 'args': {'pageId': str(bound)}, 'id': 'call-1'},
        ],
    )
    with patch('agents.apps.agent.services.nodes.tool_runner.interrupt') as fake_interrupt:
        fake_interrupt.return_value = {'action': 'allow'}
        out = await tool_runner_node(
            state,
            tools=[_page_write_tool('anynote__updatePage', _update)],
            tool_registry={'anynote__updatePage': _page_write_meta()},
        )
        # Confirmation still fires as before — the binding gate lets it through.
        fake_interrupt.assert_called_once()
    last = out.messages[-1]
    assert isinstance(last, ToolMessage)
    assert 'updated' in str(last.content)


@pytest.mark.asyncio
async def test_tool_runner_unbound_context_ignores_page_binding_gate() -> None:
    async def _update(**kwargs):
        return 'updated'

    state = make_state(
        pending_tool_calls=[
            {'name': 'anynote__updatePage', 'args': {'pageId': str(uuid4())}, 'id': 'call-1'},
        ],
    )
    with patch('agents.apps.agent.services.nodes.tool_runner.interrupt') as fake_interrupt:
        fake_interrupt.return_value = {'action': 'allow'}
        out = await tool_runner_node(
            state,
            tools=[_page_write_tool('anynote__updatePage', _update)],
            tool_registry={'anynote__updatePage': _page_write_meta()},
        )
    last = out.messages[-1]
    assert isinstance(last, ToolMessage)
    assert 'updated' in str(last.content)


@pytest.mark.asyncio
async def test_tool_runner_denies_forbidden_tool_in_page_bound_chat() -> None:
    bound = uuid4()
    meta = ToolMeta(
        name='createPage',
        required_scope='pages:write',
        requires_confirmation=True,
        summarize=lambda args: 'Create X',
        preview=lambda args: args,
        forbidden_when_page_bound=True,
    )
    state = make_state(
        context=make_context(page_id=bound),
        pending_tool_calls=[
            {'name': 'anynote__createPage', 'args': {'title': 'X'}, 'id': 'call-1'},
        ],
    )
    tool = _fake_tool('anynote__createPage', returns='created')
    with patch('agents.apps.agent.services.nodes.tool_runner.interrupt') as fake_interrupt:
        out = await tool_runner_node(
            state, tools=[tool], tool_registry={'anynote__createPage': meta},
        )
        fake_interrupt.assert_not_called()
    last = out.messages[-1]
    assert isinstance(last, ToolMessage)
    assert 'Permission denied' in str(last.content)
    assert str(bound) in str(last.content)
    assert 'created' not in str(last.content)


@pytest.mark.asyncio
async def test_tool_runner_allows_read_tool_in_page_bound_chat() -> None:
    bound = uuid4()
    meta = ToolMeta(
        name='getPageMarkdown',
        required_scope='pages:read',
        requires_confirmation=False,
        summarize=lambda args: 'Read page',
        preview=lambda args: args,
    )

    async def _read(**kwargs):
        return 'page text'

    # Reads stay unrestricted: the tool may target any page, not just the bound one.
    state = make_state(
        context=make_context(page_id=bound),
        pending_tool_calls=[
            {'name': 'anynote__getPageMarkdown', 'args': {'pageId': str(uuid4())}, 'id': 'call-1'},
        ],
    )
    out = await tool_runner_node(
        state,
        tools=[_page_write_tool('anynote__getPageMarkdown', _read)],
        tool_registry={'anynote__getPageMarkdown': meta},
    )
    last = out.messages[-1]
    assert isinstance(last, ToolMessage)
    assert 'page text' in str(last.content)


@pytest.mark.asyncio
async def test_tool_runner_denies_delete_file_in_page_bound_chat() -> None:
    bound = uuid4()
    # required_scope=None isolates the binding gate from the scope gate
    # (make_context's default scopes do not include files:delete).
    meta = ToolMeta(
        name='delete_file',
        required_scope=None,
        requires_confirmation=True,
        summarize=lambda args: 'Delete file',
        preview=lambda args: args,
        forbidden_when_page_bound=True,
    )
    state = make_state(
        context=make_context(page_id=bound),
        pending_tool_calls=[
            {'name': 'anynote__delete_file', 'args': {'x': 0}, 'id': 'call-1'},
        ],
    )
    tool = _fake_tool('anynote__delete_file', returns='deleted')
    with patch('agents.apps.agent.services.nodes.tool_runner.interrupt') as fake_interrupt:
        out = await tool_runner_node(
            state, tools=[tool], tool_registry={'anynote__delete_file': meta},
        )
        fake_interrupt.assert_not_called()
    last = out.messages[-1]
    assert isinstance(last, ToolMessage)
    assert 'cannot be used in a page-bound chat' in str(last.content)
    assert str(bound) in str(last.content)
    assert 'deleted' not in str(last.content)


def _reminder_meta() -> ToolMeta:
    # required_scope=None isolates the binding gate from the scope gate
    # (make_context's default scopes do not include reminders:write).
    return ToolMeta(
        name='createReminder',
        required_scope=None,
        requires_confirmation=True,
        summarize=lambda args: f'Create reminder on {args.get("pageId")}',
        preview=lambda args: args,
        page_arg='pageId',
    )


@pytest.mark.asyncio
async def test_tool_runner_denies_create_reminder_targeting_other_page() -> None:
    bound = uuid4()
    invoked = False

    async def _create(**kwargs):
        nonlocal invoked
        invoked = True
        return 'reminder created'

    state = make_state(
        context=make_context(page_id=bound),
        pending_tool_calls=[
            {'name': 'anynote__createReminder', 'args': {'pageId': str(uuid4())}, 'id': 'call-1'},
        ],
    )
    with patch('agents.apps.agent.services.nodes.tool_runner.interrupt') as fake_interrupt:
        out = await tool_runner_node(
            state,
            tools=[_page_write_tool('anynote__createReminder', _create)],
            tool_registry={'anynote__createReminder': _reminder_meta()},
        )
        fake_interrupt.assert_not_called()
    assert invoked is False
    last = out.messages[-1]
    assert isinstance(last, ToolMessage)
    assert f'may only target pageId={bound}' in str(last.content)


@pytest.mark.asyncio
async def test_tool_runner_allows_create_reminder_on_bound_page() -> None:
    bound = uuid4()

    async def _create(**kwargs):
        return 'reminder created'

    state = make_state(
        context=make_context(page_id=bound),
        pending_tool_calls=[
            {'name': 'anynote__createReminder', 'args': {'pageId': str(bound)}, 'id': 'call-1'},
        ],
    )
    with patch('agents.apps.agent.services.nodes.tool_runner.interrupt') as fake_interrupt:
        fake_interrupt.return_value = {'action': 'allow'}
        out = await tool_runner_node(
            state,
            tools=[_page_write_tool('anynote__createReminder', _create)],
            tool_registry={'anynote__createReminder': _reminder_meta()},
        )
        fake_interrupt.assert_called_once()
    last = out.messages[-1]
    assert isinstance(last, ToolMessage)
    assert 'reminder created' in str(last.content)


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
