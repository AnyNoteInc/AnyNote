from unittest.mock import patch

import pytest
from agents.apps.agent.services.nodes.tool_runner import _run_tool
from agents.apps.agent.services.tool_registry import ToolMeta
from langchain_core.messages import ToolMessage
from langchain_core.tools import StructuredTool
from pydantic import BaseModel

from tests.apps.agent.factories import make_state


class _Args(BaseModel):
    title: str


async def _coroutine(**kwargs):
    return 'ok'


@pytest.mark.asyncio
async def test_run_tool_calls_interrupt_for_destructive_tool() -> None:
    tool = StructuredTool.from_function(coroutine=_coroutine, name='anynote__createPage',
                                         description='', args_schema=_Args)
    meta = ToolMeta(
        name='createPage', required_scope='pages:write', requires_confirmation=True,
        summarize=lambda args: f'Create {args["title"]}',
        preview=lambda args: args,
    )
    state = make_state()
    call = {'name': 'anynote__createPage', 'args': {'title': 'X'}, 'id': 'cid'}

    with patch('agents.apps.agent.services.nodes.tool_runner.interrupt') as fake_interrupt:
        fake_interrupt.return_value = {'action': 'allow'}
        result = await _run_tool(call, [tool], {'anynote__createPage': meta}, state)
        fake_interrupt.assert_called_once()
        assert isinstance(result, ToolMessage)
        assert 'ok' in result.content


@pytest.mark.asyncio
async def test_run_tool_returns_deny_message_when_user_denies() -> None:
    tool = StructuredTool.from_function(coroutine=_coroutine, name='anynote__createPage',
                                         description='', args_schema=_Args)
    meta = ToolMeta(
        name='createPage', required_scope='pages:write', requires_confirmation=True,
        summarize=lambda args: 'X', preview=lambda args: args,
    )
    state = make_state()
    call = {'name': 'anynote__createPage', 'args': {'title': 'X'}, 'id': 'cid'}

    with patch('agents.apps.agent.services.nodes.tool_runner.interrupt') as fake_interrupt:
        fake_interrupt.return_value = {'action': 'deny'}
        result = await _run_tool(call, [tool], {'anynote__createPage': meta}, state)
        assert 'denied' in result.content.lower()


@pytest.mark.asyncio
async def test_run_tool_skips_interrupt_when_allow_destructive_set() -> None:
    tool = StructuredTool.from_function(coroutine=_coroutine, name='anynote__createPage',
                                         description='', args_schema=_Args)
    meta = ToolMeta(
        name='createPage', required_scope='pages:write', requires_confirmation=True,
        summarize=lambda args: 'X', preview=lambda args: args,
    )
    state = make_state()
    state = state.model_copy(update={
        'context': state.context.model_copy(update={'allow_destructive': True}),
    })
    call = {'name': 'anynote__createPage', 'args': {'title': 'X'}, 'id': 'cid'}

    with patch('agents.apps.agent.services.nodes.tool_runner.interrupt') as fake_interrupt:
        result = await _run_tool(call, [tool], {'anynote__createPage': meta}, state)
        fake_interrupt.assert_not_called()
        assert 'ok' in result.content
