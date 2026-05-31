import logging
import re
from collections.abc import Sequence
from typing import Any

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import StructuredTool

from agents.apps.agent.enums import PlanStepStatus
from agents.apps.agent.repositories import AgentJinjaRenderer
from agents.apps.agent.schemas import AgentState, PlanStepSchema

log = logging.getLogger(__name__)
_PAGE_URL_RE = re.compile(
    r'/workspaces/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
    r'/pages/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
    re.IGNORECASE,
)


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

    create_page_url = _latest_create_page_url(state)
    if create_page_url and _is_create_page_request(state.user_message):
        final_text = _create_page_answer(create_page_url)
        new_plan = _mark_done(state.plan, step.id, summary=final_text[:200])
        next_id = _next_pending(new_plan)
        if next_id is not None:
            new_plan = _mark_running(new_plan, next_id)
        return state.model_copy(update={
            'plan': new_plan,
            'current_step_id': next_id,
            'pending_tool_calls': [],
            'draft_answer': final_text,
        })

    prompt = (renderer or _renderer()).render_executor(
        current_step=step.model_dump(),
        plan=[s.model_dump() for s in state.plan],
        long_term_memories=[m.model_dump() for m in state.long_term_memories],
        chat_history=[m.model_dump() for m in state.chat_history],
        attachments=[a.model_dump() for a in state.attachments],
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
        'draft_reasoning': extract_reasoning_text(ai),
    })


def extract_reasoning_text(message: object) -> str:
    """Concatenate reasoning content blocks from an LLM message, if any."""
    blocks = getattr(message, 'content_blocks', None)
    if not blocks:
        return ''
    parts = [
        str(b.get('reasoning') or '')
        for b in blocks
        if isinstance(b, dict) and b.get('type') == 'reasoning'
    ]
    return '\n'.join(p for p in parts if p)


def _serialize_call(call: Any) -> dict[str, Any]:
    return {
        'name': call['name'] if isinstance(call, dict) else call.name,
        'args': call['args'] if isinstance(call, dict) else call.args,
        'id': call['id'] if isinstance(call, dict) else call.id,
    }


def _current_step(state: AgentState) -> PlanStepSchema | None:
    if state.current_step_id is None:
        return None
    for s in state.plan:
        if s.id == state.current_step_id:
            return s
    return None


def _mark_running(plan: list[PlanStepSchema], step_id: str) -> list[PlanStepSchema]:
    return [
        s.model_copy(update={'status': PlanStepStatus.RUNNING})
        if s.id == step_id and s.status != PlanStepStatus.DONE
        else s
        for s in plan
    ]


def _mark_done(plan: list[PlanStepSchema], step_id: str, *, summary: str) -> list[PlanStepSchema]:
    return [
        s.model_copy(update={'status': PlanStepStatus.DONE, 'result_summary': summary})
        if s.id == step_id
        else s
        for s in plan
    ]


def _next_pending(plan: list[PlanStepSchema]) -> str | None:
    for s in plan:
        if s.status == PlanStepStatus.PENDING:
            return s.id
    return None


def _latest_create_page_url(state: AgentState) -> str | None:
    tool_call_names: dict[str, str] = {}
    latest_url: str | None = None
    for message in state.messages:
        if isinstance(message, AIMessage):
            for call in getattr(message, 'tool_calls', None) or []:
                tool_call_names[str(call.get('id'))] = str(call.get('name'))
            continue
        if not isinstance(message, ToolMessage):
            continue
        if tool_call_names.get(str(message.tool_call_id)) not in {'anynote__createPage', 'createPage'}:
            continue
        content = str(message.content)
        lowered = content.lower()
        if 'error' in lowered or 'denied' in lowered or 'permission denied' in lowered:
            continue
        match = _PAGE_URL_RE.search(content)
        if match:
            latest_url = match.group(0)
    return latest_url


def _is_create_page_request(user_message: str) -> bool:
    text = user_message.lower().replace('\u0451', '\u0435')
    has_create_intent = any(
        token in text
        for token in ('создай', 'создать', 'сделай', 'сохрани', 'запиши', 'create', 'save')
    )
    has_page_target = any(token in text for token in ('страниц', 'стараниц', 'page', 'note'))
    return has_create_intent and has_page_target


def _create_page_answer(url: str) -> str:
    return f'Страница создана: [здесь]({url}).'


def _renderer() -> AgentJinjaRenderer:
    from agents.settings import settings
    return AgentJinjaRenderer(settings)
