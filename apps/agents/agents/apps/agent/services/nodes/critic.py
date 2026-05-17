from __future__ import annotations

import json
import logging

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import SystemMessage

from agents.apps.agent.enums import CriticVerdict, PlanStepStatus
from agents.apps.agent.schemas import AgentState, PlanStep
from agents.apps.agent.repositories import AgentJinjaRenderer

log = logging.getLogger(__name__)

MAX_REVISIONS = 2


async def critic_node(
    state: AgentState,
    *,
    llm: BaseChatModel,
    renderer: AgentJinjaRenderer | None = None,
) -> AgentState:
    prompt = (renderer or _renderer()).render_critic(
        user_message=state.user_message,
        plan=[s.model_dump() for s in state.plan],
        draft_answer=state.draft_answer,
        revision_count=state.revision_count,
    )
    msg = await llm.ainvoke([SystemMessage(content=prompt)])
    verdict, feedback, revised_plan = _parse(str(msg.content))

    if verdict == CriticVerdict.REVISE and state.revision_count >= MAX_REVISIONS:
        verdict = CriticVerdict.REJECT
        feedback = f'(forced reject: revision cap reached) {feedback}'

    update: dict[str, object] = {
        'critic_verdict': verdict,
        'critic_feedback': feedback,
    }
    if verdict == CriticVerdict.APPROVE:
        update['final_answer'] = state.draft_answer
    elif verdict == CriticVerdict.REVISE:
        update['revision_count'] = state.revision_count + 1
        update['last_critic_feedback'] = feedback
        if revised_plan:
            update['plan'] = [
                PlanStep(id=str(p['id']), title=str(p['title']),
                         status=PlanStepStatus.PENDING)
                for p in revised_plan
            ]
            update['current_step_id'] = revised_plan[0]['id'] if revised_plan else None
            update['draft_answer'] = ''
            update['messages'] = []
    else:  # REJECT
        update['final_answer'] = feedback
    return state.model_copy(update=update)


def _parse(text: str) -> tuple[CriticVerdict, str, list[dict[str, object]] | None]:
    try:
        data = json.loads(text)
        verdict_raw = str(data.get('verdict', 'approve')).lower()
        verdict = {
            'approve': CriticVerdict.APPROVE,
            'revise': CriticVerdict.REVISE,
            'reject': CriticVerdict.REJECT,
        }.get(verdict_raw, CriticVerdict.APPROVE)
        return verdict, str(data.get('feedback', '')), data.get('revised_plan')
    except Exception as exc:  # noqa: BLE001
        log.warning('critic parse failure, defaulting to approve: %s', exc)
        return CriticVerdict.APPROVE, '(critic output unparseable; defaulting to approve)', None


def _renderer() -> AgentJinjaRenderer:
    from agents.settings import settings
    return AgentJinjaRenderer(settings)
