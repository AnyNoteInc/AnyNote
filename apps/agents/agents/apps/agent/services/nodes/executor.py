from __future__ import annotations

import logging
import time
from collections.abc import Sequence
from typing import Any
from uuid import uuid4

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, SystemMessage, ToolMessage
from langchain_core.tools import StructuredTool
from langgraph.types import interrupt

from agents.apps.agent.enums import PlanStepStatus
from agents.apps.agent.repositories import AgentJinjaRenderer
from agents.apps.agent.schemas import AgentState, PlanStep
from agents.apps.agent.services.tool_registry import ToolMeta

log = logging.getLogger(__name__)

MAX_TOOL_CALLS_PER_STEP = 10


async def executor_node(
    state: AgentState,
    *,
    llm: BaseChatModel,
    tools: Sequence[StructuredTool],
    tool_registry: dict[str, ToolMeta],
    renderer: AgentJinjaRenderer | None = None,
) -> AgentState:
    step = _current_step(state)
    if step is None:
        return state.model_copy(update={'current_step_id': None})

    prompt = (renderer or _renderer()).render_executor(
        current_step=step.model_dump(),
        plan=[s.model_dump() for s in state.plan],
        long_term_memories=[m.model_dump() for m in state.long_term_memories],
    )
    messages: list[BaseMessage] = [SystemMessage(content=prompt), *state.messages]
    bound = llm.bind_tools(list(tools)) if tools else llm
    tool_calls_made = state.tool_calls_made

    for _ in range(MAX_TOOL_CALLS_PER_STEP):
        ai = await bound.ainvoke(messages)
        messages.append(ai)
        if not getattr(ai, 'tool_calls', None):
            break
        for call in ai.tool_calls:
            tool_calls_made += 1
            messages.append(await _run_tool(call, tools, tool_registry, state))

    final_text = _last_text(messages)
    new_plan = _mark_done(state.plan, step.id, summary=final_text[:200])
    next_id = _next_pending(new_plan)
    if next_id is not None:
        new_plan = _mark_running(new_plan, next_id)
    return state.model_copy(update={
        'messages': messages,
        'plan': new_plan,
        'current_step_id': next_id,
        'tool_calls_made': tool_calls_made,
        'draft_answer': final_text,
    })


async def _run_tool(
    call: Any,
    tools: Sequence[StructuredTool],
    tool_registry: dict[str, ToolMeta],
    state: AgentState,
) -> ToolMessage:
    name = call['name'] if isinstance(call, dict) else call.name
    args = call['args'] if isinstance(call, dict) else call.args
    call_id = call['id'] if isinstance(call, dict) else call.id
    meta = tool_registry.get(name)
    if meta and meta.required_scope and meta.required_scope not in state.context.scopes:
        return ToolMessage(
            content=f'Permission denied: tool {name} requires scope {meta.required_scope}',
            tool_call_id=call_id,
        )
    if meta and meta.requires_confirmation and not state.context.allow_destructive:
        decision = interrupt({
            'confirmation_id': str(uuid4()),
            'tool': name,
            'args_preview': meta.preview(args),
            'summary': meta.summarize(args),
        })
        if isinstance(decision, dict) and decision.get('action') == 'deny':
            return ToolMessage(
                content=f'User denied calling {name}.',
                tool_call_id=call_id,
            )
    tool = next((t for t in tools if t.name == name), None)
    if tool is None:
        return ToolMessage(content=f"tool '{name}' not registered", tool_call_id=call_id)
    time.monotonic()
    try:
        result = await tool.ainvoke(args)
        return ToolMessage(content=str(result), tool_call_id=call_id)
    except Exception as exc:
        log.warning('tool %s raised: %s', name, exc)
        return ToolMessage(content=f"tool '{name}' error: {exc}", tool_call_id=call_id)


def _current_step(state: AgentState) -> PlanStep | None:
    if state.current_step_id is None:
        return None
    for s in state.plan:
        if s.id == state.current_step_id:
            return s
    return None


def _last_text(messages: list[BaseMessage]) -> str:
    for m in reversed(messages):
        if isinstance(m, AIMessage):
            return str(m.content) if isinstance(m.content, str) else ''
    return ''


def _mark_done(plan: list[PlanStep], step_id: str, *, summary: str) -> list[PlanStep]:
    return [
        s.model_copy(update={'status': PlanStepStatus.DONE, 'result_summary': summary})
        if s.id == step_id else s
        for s in plan
    ]


def _mark_running(plan: list[PlanStep], step_id: str) -> list[PlanStep]:
    return [
        s.model_copy(update={'status': PlanStepStatus.RUNNING})
        if s.id == step_id else s
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
