from __future__ import annotations

import json
import logging

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import SystemMessage

from agents.apps.agent.enums import PlanStepStatus
from agents.apps.agent.repositories import AgentJinjaRenderer
from agents.apps.agent.schemas import AgentState, PlanStepSchema

log = logging.getLogger(__name__)


async def planner_node(
    state: AgentState,
    *,
    llm: BaseChatModel,
    renderer: AgentJinjaRenderer | None = None,
) -> AgentState:
    prompt = (renderer or _renderer()).render_planner(
        user_message=state.user_message,
        chat_history=state.chat_history,
        long_term_memories=[m.model_dump() for m in state.long_term_memories],
        rag_documents=[d.model_dump() if hasattr(d, 'model_dump') else d
                       for d in state.rag_documents],
        mcp_servers=[s.model_dump() for s in state.mcp_servers],
        agent_system_prompt=state.agent_system_prompt,
        last_critic_feedback=state.last_critic_feedback,
    )
    msg = await llm.ainvoke([SystemMessage(content=prompt)])
    plan = _parse(str(msg.content), fallback_title=state.user_message)
    return state.model_copy(update={
        'plan': plan,
        'current_step_id': plan[0].id if plan else None,
        'last_critic_feedback': None,
    })


def _parse(text: str, *, fallback_title: str) -> list[PlanStepSchema]:
    try:
        data = json.loads(text)
        items = data.get('plan') or []
        return [
            PlanStepSchema(id=str(item['id']), title=str(item['title']),
                     status=PlanStepStatus.PENDING)
            for item in items if 'id' in item and 'title' in item
        ] or _fallback(fallback_title)
    except Exception as exc:
        log.warning('planner parse failure: %s', exc)
        return _fallback(fallback_title)


def _fallback(title: str) -> list[PlanStepSchema]:
    return [PlanStepSchema(id='1', title=title, status=PlanStepStatus.PENDING)]


def _renderer() -> AgentJinjaRenderer:
    from agents.settings import settings
    return AgentJinjaRenderer(settings)
