from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import Any

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_core.tools import StructuredTool

from agents.apps.agent.enums import PlanStepStatus
from agents.apps.agent.repositories import AgentJinjaRenderer
from agents.apps.agent.schemas import AgentState, PlanStep

log = logging.getLogger(__name__)


async def executor_node(
    state: AgentState,
    *,
    llm: BaseChatModel,
    tools: Sequence[StructuredTool],
    renderer: AgentJinjaRenderer | None = None,
) -> AgentState:
    """One LLM call per invocation. Hands off to tool_runner when the LLM
    requests tools; marks the step done otherwise.

    Splitting the LLM call from tool execution is what makes interrupt-resume
    safe — the AIMessage with tool_calls is committed to state.messages
    before tool_runner triggers any interrupt, so resume re-runs only the
    tool node, not the LLM.
    """
    step = _current_step(state)
    if step is None:
        return state.model_copy(update={'current_step_id': None})

    prompt = (renderer or _renderer()).render_executor(
        current_step=step.model_dump(),
        plan=[s.model_dump() for s in state.plan],
        long_term_memories=[m.model_dump() for m in state.long_term_memories],
        chat_history=[m.model_dump() for m in state.chat_history],
    )

    # GigaChat requires system at position 0 and at least one user/assistant
    # message after. Seed the prior chat_history + user message the first time
    # we enter the executor for this run so the model can quote/copy text from
    # earlier turns (e.g. when the user says "create a page with the text
    # above"). Subsequent calls extend state.messages and skip re-seeding.
    if state.messages:
        messages: list[BaseMessage] = [SystemMessage(content=prompt), *state.messages]
    else:
        messages = [SystemMessage(content=prompt)]
        for prior in state.chat_history:
            content = prior.content
            if prior.role.value == 'user':
                messages.append(HumanMessage(content=content))
            elif prior.role.value == 'assistant':
                messages.append(AIMessage(content=content))
        messages.append(HumanMessage(content=state.user_message))

    bound = llm.bind_tools(list(tools)) if tools else llm
    ai = await bound.ainvoke(messages)

    new_messages: list[BaseMessage] = list(state.messages)
    if not state.messages:
        new_messages.append(HumanMessage(content=state.user_message))
    new_messages.append(ai)

    pending = list(getattr(ai, 'tool_calls', None) or [])
    if pending:
        new_plan = _mark_running(state.plan, step.id)
        return state.model_copy(update={
            'messages': new_messages,
            'plan': new_plan,
            'pending_tool_calls': [_serialize_call(c) for c in pending],
        })

    final_text = str(ai.content) if isinstance(ai.content, str) else ''
    new_plan = _mark_done(state.plan, step.id, summary=final_text[:200])
    next_id = _next_pending(new_plan)
    if next_id is not None:
        new_plan = _mark_running(new_plan, next_id)
    return state.model_copy(update={
        'messages': new_messages,
        'plan': new_plan,
        'current_step_id': next_id,
        'pending_tool_calls': [],
        'draft_answer': final_text,
    })


def _serialize_call(call: Any) -> dict[str, Any]:
    return {
        'name': call['name'] if isinstance(call, dict) else call.name,
        'args': call['args'] if isinstance(call, dict) else call.args,
        'id': call['id'] if isinstance(call, dict) else call.id,
    }


def _current_step(state: AgentState) -> PlanStep | None:
    if state.current_step_id is None:
        return None
    for s in state.plan:
        if s.id == state.current_step_id:
            return s
    return None


def _mark_running(plan: list[PlanStep], step_id: str) -> list[PlanStep]:
    return [
        s.model_copy(update={'status': PlanStepStatus.RUNNING})
        if s.id == step_id and s.status != PlanStepStatus.DONE
        else s
        for s in plan
    ]


def _mark_done(plan: list[PlanStep], step_id: str, *, summary: str) -> list[PlanStep]:
    return [
        s.model_copy(update={'status': PlanStepStatus.DONE, 'result_summary': summary})
        if s.id == step_id
        else s
        for s in plan
    ]


def _next_pending(plan: list[PlanStep]) -> str | None:
    for s in plan:
        if s.status == PlanStepStatus.PENDING:
            return s.id
    return None


def _renderer() -> AgentJinjaRenderer:
    from agents.settings import settings
    return AgentJinjaRenderer(settings)
