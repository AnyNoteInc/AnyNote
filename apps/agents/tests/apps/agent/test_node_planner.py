import json
from unittest.mock import AsyncMock

import pytest
from langchain_core.messages import AIMessage

from agents.apps.agent.enums import PlanStepStatus
from agents.apps.agent.services.nodes.planner import planner_node
from tests.apps.agent.factories import make_state


@pytest.mark.asyncio
async def test_planner_emits_plan_steps_from_model_output():
    fake_llm = AsyncMock()
    fake_llm.ainvoke = AsyncMock(return_value=AIMessage(content=json.dumps({
        'plan': [
            {'id': '1', 'title': 'Найти страницы'},
            {'id': '2', 'title': 'Прочитать релевантные'},
            {'id': '3', 'title': 'Сформировать ответ'},
        ],
    })))
    state = make_state(user_message='Q')
    out = await planner_node(state, llm=fake_llm)
    assert [s.id for s in out.plan] == ['1', '2', '3']
    assert all(s.status == PlanStepStatus.PENDING for s in out.plan)
    assert out.current_step_id == '1'


@pytest.mark.asyncio
async def test_planner_falls_back_to_single_step_on_invalid_output():
    fake_llm = AsyncMock()
    fake_llm.ainvoke = AsyncMock(return_value=AIMessage(content='garbage'))
    state = make_state(user_message='Q')
    out = await planner_node(state, llm=fake_llm)
    assert len(out.plan) == 1
    assert out.plan[0].title.startswith('Q')


@pytest.mark.asyncio
async def test_planner_clears_critic_feedback_after_replan():
    fake_llm = AsyncMock()
    fake_llm.ainvoke = AsyncMock(return_value=AIMessage(content=json.dumps({
        'plan': [{'id': '1', 'title': 't'}],
    })))
    state = make_state(user_message='Q')
    state = state.model_copy(update={
        'last_critic_feedback': 'previous',
        'revision_count': 1,
    })
    out = await planner_node(state, llm=fake_llm)
    assert out.last_critic_feedback is None
    assert out.revision_count == 1  # revision count preserved, feedback consumed
