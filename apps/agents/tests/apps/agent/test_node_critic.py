import json
from unittest.mock import AsyncMock

import pytest
from agents.apps.agent.enums import CriticVerdict, PlanStepStatus
from agents.apps.agent.schemas import PlanStepSchema
from agents.apps.agent.services.nodes.critic import critic_node
from langchain_core.messages import AIMessage, ToolMessage

from tests.apps.agent.factories import make_state


@pytest.mark.asyncio
async def test_critic_approve_promotes_draft_to_final() -> None:
    fake_llm = AsyncMock()
    fake_llm.ainvoke = AsyncMock(return_value=AIMessage(content=json.dumps({
        'verdict': 'approve', 'feedback': 'lgtm', 'revised_plan': None,
    })))
    state = make_state()
    state = state.model_copy(update={'draft_answer': 'final text'})
    out = await critic_node(state, llm=fake_llm)
    assert out.critic_verdict == CriticVerdict.APPROVE
    assert out.final_answer == 'final text'


@pytest.mark.asyncio
async def test_critic_revise_increments_revision_count_and_swaps_plan() -> None:
    fake_llm = AsyncMock()
    fake_llm.ainvoke = AsyncMock(return_value=AIMessage(content=json.dumps({
        'verdict': 'revise', 'feedback': 'cite sources',
        'revised_plan': [{'id': '1', 'title': 'recite with citations'}],
    })))
    state = make_state()
    state = state.model_copy(update={'draft_answer': 'draft', 'revision_count': 0})
    out = await critic_node(state, llm=fake_llm)
    assert out.critic_verdict == CriticVerdict.REVISE
    assert out.revision_count == 1
    assert out.last_critic_feedback == 'cite sources'
    assert out.plan and out.plan[0].title == 'recite with citations'


@pytest.mark.asyncio
async def test_critic_at_revision_cap_can_only_approve_or_reject() -> None:
    fake_llm = AsyncMock()
    fake_llm.ainvoke = AsyncMock(return_value=AIMessage(content=json.dumps({
        'verdict': 'revise', 'feedback': 'try again', 'revised_plan': None,
    })))
    state = make_state()
    state = state.model_copy(update={'draft_answer': 'draft', 'revision_count': 2})
    out = await critic_node(state, llm=fake_llm)
    # Cap reached: forced to REJECT instead of REVISE
    assert out.critic_verdict == CriticVerdict.REJECT


@pytest.mark.asyncio
async def test_critic_approves_successful_create_page_even_when_llm_requests_revision() -> None:
    fake_llm = AsyncMock()
    fake_llm.ainvoke = AsyncMock(return_value=AIMessage(content=json.dumps({
        'verdict': 'revise',
        'feedback': 'answer should include more instructions',
        'revised_plan': [{'id': '1', 'title': 'Create the page again and add a better answer'}],
    })))
    url = '/workspaces/28531e45-1bf1-4640-90f2-12b9bd17f5f3/pages/96409533-ddbc-422e-941d-2c4d2abf3098'
    state = make_state(user_message='создай страницу о бане')
    state = state.model_copy(update={
        'draft_answer': 'Чтобы просмотреть ее, просто перейдите по данной ссылке',
        'revision_count': 2,
        'plan': [PlanStepSchema(id='1', title='Create the page', status=PlanStepStatus.DONE)],
        'messages': [
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
        ],
    })

    out = await critic_node(state, llm=fake_llm)

    fake_llm.ainvoke.assert_not_called()
    assert out.critic_verdict == CriticVerdict.APPROVE
    assert out.revision_count == 2
    assert out.final_answer == f'Страница создана: [здесь]({url}).'
