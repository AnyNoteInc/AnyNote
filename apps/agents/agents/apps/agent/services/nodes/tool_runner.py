from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import Any
from uuid import uuid4

from langchain_core.messages import ToolMessage
from langchain_core.tools import StructuredTool
from langgraph.types import interrupt

from agents.apps.agent.schemas import AgentState
from agents.apps.agent.services.tool_registry import ToolMeta

log = logging.getLogger(__name__)


async def tool_runner_node(
    state: AgentState,
    *,
    tools: Sequence[StructuredTool],
    tool_registry: dict[str, ToolMeta],
) -> AgentState:
    """Run each pending tool call, pausing for confirmation as needed.

    The AIMessage that produced these tool_calls is already in state.messages
    (saved by the executor node before transitioning here). On interrupt
    resume, only this node restarts — the LLM call is NOT re-executed, so
    the tool definitely runs once approved.
    """
    if not state.pending_tool_calls:
        return state

    new_tool_messages: list[ToolMessage] = []
    tool_calls_made = state.tool_calls_made

    for call in state.pending_tool_calls:
        tool_calls_made += 1
        new_tool_messages.append(await _run_tool(call, tools, tool_registry, state))

    return state.model_copy(update={
        'messages': [*state.messages, *new_tool_messages],
        'pending_tool_calls': [],
        'tool_calls_made': tool_calls_made,
    })


async def _run_tool(
    call: dict[str, Any],
    tools: Sequence[StructuredTool],
    tool_registry: dict[str, ToolMeta],
    state: AgentState,
) -> ToolMessage:
    name = str(call['name'])
    args = call['args']
    call_id = str(call['id'])
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
            return ToolMessage(content=f'User denied calling {name}.', tool_call_id=call_id)
    tool = next((t for t in tools if t.name == name), None)
    if tool is None:
        return ToolMessage(content=f"tool '{name}' not registered", tool_call_id=call_id)
    try:
        result = await tool.ainvoke(args)
        return ToolMessage(content=str(result), tool_call_id=call_id)
    except Exception as exc:
        log.warning('tool %s raised: %s', name, exc)
        return ToolMessage(content=f"tool '{name}' error: {exc}", tool_call_id=call_id)
