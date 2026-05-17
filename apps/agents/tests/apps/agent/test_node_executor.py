from unittest.mock import AsyncMock

import pytest
from agents.apps.agent.enums import PlanStepStatus
from agents.apps.agent.services.nodes.executor import executor_node
from langchain_core.messages import AIMessage

from tests.apps.agent.factories import make_state


@pytest.mark.asyncio
async def test_executor_marks_step_done_on_plain_text_response() -> None:
    fake_llm = AsyncMock()
    fake_llm.bind_tools = lambda tools: fake_llm
    fake_llm.ainvoke = AsyncMock(return_value=AIMessage(content='готово'))
    state = make_state(user_message='Q')
    state.plan = []  # current step set explicitly
    from agents.apps.agent.schemas import PlanStep
    state.plan = [PlanStep(id='1', title='step', status=PlanStepStatus.RUNNING)]
    state.current_step_id = '1'

    out = await executor_node(state, llm=fake_llm, tools=[], tool_registry={})
    assert out.plan[0].status == PlanStepStatus.DONE
    assert out.draft_answer == 'готово'
    assert out.current_step_id is None  # all steps done


@pytest.mark.asyncio
async def test_executor_advances_to_next_step() -> None:
    fake_llm = AsyncMock()
    fake_llm.bind_tools = lambda tools: fake_llm
    fake_llm.ainvoke = AsyncMock(return_value=AIMessage(content='step1 done'))
    state = make_state()
    from agents.apps.agent.schemas import PlanStep
    state.plan = [
        PlanStep(id='1', title='a', status=PlanStepStatus.RUNNING),
        PlanStep(id='2', title='b', status=PlanStepStatus.PENDING),
    ]
    state.current_step_id = '1'

    out = await executor_node(state, llm=fake_llm, tools=[], tool_registry={})
    assert out.plan[0].status == PlanStepStatus.DONE
    assert out.current_step_id == '2'
    assert out.plan[1].status == PlanStepStatus.RUNNING
