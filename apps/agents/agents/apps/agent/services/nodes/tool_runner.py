import json
import logging
import re
from collections.abc import Sequence
from typing import Any
from uuid import uuid4

from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.tools import StructuredTool
from langgraph.config import get_stream_writer
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


def _short(text: str, limit: int = 500) -> str:
    return text if len(text) <= limit else text[:limit] + '…'


def _emit_tool_status(call_id: str, name: str, state: str, *, detail: str | None = None) -> None:
    """Best-effort custom event so the web layer can render real tool lifecycle.

    Wrapped in try/except: get_stream_writer() is only bound when the graph is
    consumed with stream_mode including 'custom'; unit tests that call the node
    directly (no stream) must not crash.
    """
    try:
        writer = get_stream_writer()
    except RuntimeError:
        return
    writer({
        'kind': 'tool_status',
        'id': call_id,
        'tool': name,
        'state': state,
        'title': name,
        'detail': detail,
    })


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
        call = _enrich_call_from_chat_history(call, state)
        call_id = str(call['id'])
        name = str(call['name'])
        _emit_tool_status(call_id, name, 'running')
        prior = _prior_tool_result(name, call.get('args') or {}, state.messages)
        if prior is not None:
            log.info(
                'tool_runner: deduping duplicate %s call; reusing prior result',
                call['name'],
            )
            new_tool_messages.append(ToolMessage(content=prior, tool_call_id=call_id))
            _emit_tool_status(call_id, name, 'done', detail=_short(prior))
            continue
        msg = await _run_tool(call, tools, tool_registry, state)
        new_tool_messages.append(msg)
        is_error = isinstance(msg.content, str) and msg.content.lower().startswith(
            (
                f"tool '{name.lower()}' error",
                f"tool '{name.lower()}' not registered",
                'permission denied',
                'user denied',
            )
        )
        _emit_tool_status(
            call_id, name, 'error' if is_error else 'done', detail=_short(str(msg.content)),
        )

    return state.model_copy(update={
        'messages': [*state.messages, *new_tool_messages],
        'pending_tool_calls': [],
        'tool_calls_made': tool_calls_made,
    })


def _enrich_call_from_chat_history(call: dict[str, Any], state: AgentState) -> dict[str, Any]:
    name = str(call.get('name', ''))
    if name not in {'anynote__createPage', 'createPage'}:
        return call

    args = call.get('args') or {}
    if not isinstance(args, dict):
        return call
    markdown = args.get('markdown')
    if isinstance(markdown, str) and markdown.strip():
        return call
    previous_reply = _latest_assistant_reply(state)
    if previous_reply is None:
        return call
    if not _should_fill_create_page_markdown(state.user_message, previous_reply):
        return call

    return {**call, 'args': {**args, 'markdown': previous_reply}}


def _latest_assistant_reply(state: AgentState) -> str | None:
    for message in reversed(state.chat_history):
        if message.role.value != 'assistant':
            continue
        content = message.content.strip()
        if content:
            return content
    return None


def _should_fill_create_page_markdown(user_message: str, previous_reply: str | None = None) -> bool:
    text = user_message.lower().replace('\u0451', '\u0435').strip()
    if not text:
        return False
    if any(token in text for token in ('пуст', 'empty', 'blank')):
        return False
    has_create_intent = any(
        token in text
        for token in (
            'создай',
            'создать',
            'сделай',
            'сохрани',
            'запиши',
            'create',
            'save',
        )
    )
    has_page_target = any(token in text for token in ('страниц', 'стараниц', 'page', 'note'))
    if not (has_create_intent and has_page_target):
        return False
    if any(
        token in text
        for token in (
            'выше',
            'это',
            'из разговора',
            'из диалога',
            'из чата',
            'обсуждени',
            'above',
            'conversation',
            'chat',
        )
    ):
        return True
    words = [word for word in text.replace(',', ' ').replace('.', ' ').split() if word]
    has_explicit_new_topic = any(token in words for token in ('про', '\u043e', 'about'))
    if has_explicit_new_topic:
        return _topic_matches_previous_reply(words, previous_reply)
    return len(words) <= 4


def _topic_matches_previous_reply(words: Sequence[str], previous_reply: str | None) -> bool:
    if not previous_reply:
        return False
    reply = previous_reply.lower().replace('\u0451', '\u0435')
    for word in words:
        token = re.sub(r'[^\w-]+', '', word, flags=re.UNICODE)
        if len(token) < 4 or token in {
            'создай',
            'создать',
            'сделай',
            'сохрани',
            'запиши',
            'страницу',
            'стараницу',
            'страница',
            'стараница',
            'page',
            'note',
            'about',
        }:
            continue
        if token[:3] in reply:
            return True
    return False


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
