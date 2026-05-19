from __future__ import annotations

import json
import logging
from collections.abc import Sequence
from typing import Any
from uuid import uuid4

from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.tools import StructuredTool
from langgraph.types import interrupt

from agents.apps.agent.schemas import AgentState
from agents.apps.agent.services.tool_registry import ToolMeta

log = logging.getLogger(__name__)

# Tool calls whose args differ only in fields outside this allowlist count as
# duplicates of an earlier call within the same run. Keeps the deduper from
# treating, e.g., createPage({title}) and createPage({title, markdown}) as
# different calls when GigaChat flips between the two within one turn.
_DEDUP_KEY_FIELDS: dict[str, tuple[str, ...]] = {
    'anynote__createPage': ('title',),
    'createPage': ('title',),
}


def _dedup_key(name: str, args: dict[str, Any]) -> str | None:
    fields = _DEDUP_KEY_FIELDS.get(name)
    if not fields:
        return None
    payload = {f: args.get(f) for f in fields}
    return json.dumps(payload, sort_keys=True, ensure_ascii=False)


def _prior_tool_result(
    name: str, args: dict[str, Any], messages: Sequence[Any]
) -> str | None:
    """Return the content of a previous successful tool call with the same
    deduplication key, or None if no match.

    Walks state.messages backwards: for each ToolMessage we find, locate the
    AIMessage that issued it and compare names + args. This survives across
    interrupt-resume because state.messages is the canonical run log.
    """
    key = _dedup_key(name, args)
    if key is None:
        return None
    ai_calls: dict[str, tuple[str, dict[str, Any]]] = {}
    for msg in messages:
        if isinstance(msg, AIMessage):
            for call in getattr(msg, 'tool_calls', None) or []:
                ai_calls[str(call.get('id'))] = (
                    str(call.get('name')),
                    call.get('args') or {},
                )
            continue
        if isinstance(msg, ToolMessage):
            prior_name, prior_args = ai_calls.get(str(msg.tool_call_id), ('', {}))
            if not prior_name:
                continue
            if _dedup_key(prior_name, prior_args) == key:
                content = msg.content
                return content if isinstance(content, str) else json.dumps(content)
    return None


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
        prior = _prior_tool_result(str(call['name']), call.get('args') or {}, state.messages)
        if prior is not None:
            log.info(
                'tool_runner: deduping duplicate %s call; reusing prior result',
                call['name'],
            )
            new_tool_messages.append(ToolMessage(content=prior, tool_call_id=str(call['id'])))
            continue
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
