from unittest.mock import AsyncMock

import pytest
from agents.apps.agent.enums import PlanStepStatus
from agents.apps.agent.schemas import PlanStepSchema
from agents.apps.agent.services.nodes.executor import executor_node
from langchain_core.messages import AIMessage, ToolMessage

from tests.apps.agent.factories import make_state


def _fake_llm(response: AIMessage) -> AsyncMock:
    llm = AsyncMock()
    llm.bind_tools = lambda tools: llm
    llm.ainvoke = AsyncMock(return_value=response)
    return llm


@pytest.mark.asyncio
async def test_executor_marks_step_done_on_plain_text_response() -> None:
    state = make_state(user_message='Q')
    state.plan = [PlanStepSchema(id='1', title='step', status=PlanStepStatus.RUNNING)]
    state.current_step_id = '1'

    out = await executor_node(state, llm=_fake_llm(AIMessage(content='готово')), tools=[])
    assert out.plan[0].status == PlanStepStatus.DONE
    assert out.draft_answer == 'готово'
    assert out.current_step_id is None  # all steps done
    assert out.pending_tool_calls == []


@pytest.mark.asyncio
async def test_executor_advances_to_next_step() -> None:
    state = make_state()
    state.plan = [
        PlanStepSchema(id='1', title='a', status=PlanStepStatus.RUNNING),
        PlanStepSchema(id='2', title='b', status=PlanStepStatus.PENDING),
    ]
    state.current_step_id = '1'

    out = await executor_node(state, llm=_fake_llm(AIMessage(content='step1 done')), tools=[])
    assert out.plan[0].status == PlanStepStatus.DONE
    assert out.current_step_id == '2'
    assert out.plan[1].status == PlanStepStatus.RUNNING
    assert out.pending_tool_calls == []


@pytest.mark.asyncio
async def test_executor_saves_pending_tool_calls_when_ai_requests_tools() -> None:
    """When the LLM returns an AIMessage with tool_calls, executor saves them
    to pending_tool_calls and marks the step RUNNING without running the tools."""
    ai = AIMessage(
        content='',
        tool_calls=[{'name': 'anynote__createPage', 'args': {'title': 'My Page'}, 'id': 'call-abc', 'type': 'tool_call'}],
    )

    state = make_state()
    state.plan = [PlanStepSchema(id='1', title='step', status=PlanStepStatus.RUNNING)]
    state.current_step_id = '1'

    out = await executor_node(state, llm=_fake_llm(ai), tools=[])
    assert len(out.pending_tool_calls) == 1
    assert out.pending_tool_calls[0]['name'] == 'anynote__createPage'
    assert out.pending_tool_calls[0]['id'] == 'call-abc'
    # AIMessage is in state.messages
    assert any(isinstance(m, AIMessage) for m in out.messages)
    # Step stays RUNNING (not DONE) while tools are pending
    assert out.plan[0].status == PlanStepStatus.RUNNING
    # tool_calls_made is NOT incremented here — tool_runner does that
    assert out.tool_calls_made == state.tool_calls_made


@pytest.mark.asyncio
async def test_executor_returns_empty_pending_when_no_tool_calls() -> None:
    state = make_state()
    state.plan = [PlanStepSchema(id='1', title='step', status=PlanStepStatus.RUNNING)]
    state.current_step_id = '1'

    out = await executor_node(state, llm=_fake_llm(AIMessage(content='done')), tools=[])
    assert out.pending_tool_calls == []


@pytest.mark.asyncio
async def test_executor_finishes_successful_create_page_without_extra_llm_call() -> None:
    url = '/workspaces/28531e45-1bf1-4640-90f2-12b9bd17f5f3/pages/96409533-ddbc-422e-941d-2c4d2abf3098'
    state = make_state(user_message='создай страницу о бане')
    state.plan = [PlanStepSchema(id='1', title='Create page', status=PlanStepStatus.RUNNING)]
    state.current_step_id = '1'
    state.messages = [
        AIMessage(
            content='',
            tool_calls=[{
                'name': 'anynote__createPage',
                'args': {'title': 'Русская баня'},
                'id': 'call-page',
                'type': 'tool_call',
            }],
        ),
        ToolMessage(content=str({'pageId': '96409533-ddbc-422e-941d-2c4d2abf3098', 'url': url}), tool_call_id='call-page'),
    ]
    llm = _fake_llm(AIMessage(content='should not be used'))

    out = await executor_node(state, llm=llm, tools=[])

    llm.ainvoke.assert_not_called()
    assert out.plan[0].status == PlanStepStatus.DONE
    assert out.current_step_id is None
    assert out.draft_answer == f'Страница создана: [здесь]({url}).'
