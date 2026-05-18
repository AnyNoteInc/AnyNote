from __future__ import annotations

import json
import logging
from collections.abc import Sequence

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import SystemMessage

from agents.apps.agent.enums import CriticVerdict, PlanStepStatus
from agents.apps.agent.repositories import AgentJinjaRenderer
from agents.apps.agent.schemas import AgentState, PlanStep

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
    verdict, feedback = _enforce_revision_cap(verdict, feedback, state.revision_count)
    update = _build_verdict_update(verdict, feedback, revised_plan, state)
    return state.model_copy(update=update)


def _enforce_revision_cap(
    verdict: CriticVerdict,
    feedback: str,
    revision_count: int,
) -> tuple[CriticVerdict, str]:
    if verdict == CriticVerdict.REVISE and revision_count >= MAX_REVISIONS:
        return CriticVerdict.REJECT, f'(forced reject: revision cap reached) {feedback}'
    return verdict, feedback


def _build_verdict_update(
    verdict: CriticVerdict,
    feedback: str,
    revised_plan: list[dict[str, object]] | None,
    state: AgentState,
) -> dict[str, object]:
    update: dict[str, object] = {
        'critic_verdict': verdict,
        'critic_feedback': feedback,
    }
    if verdict == CriticVerdict.APPROVE:
        update['final_answer'] = state.draft_answer
    elif verdict == CriticVerdict.REVISE:
        update.update(_revise_update(feedback, revised_plan, state.revision_count))
    else:  # REJECT
        update['final_answer'] = feedback
    return update


def _revise_update(
    feedback: str,
    revised_plan: list[dict[str, object]] | None,
    revision_count: int,
) -> dict[str, object]:
    update: dict[str, object] = {
        'revision_count': revision_count + 1,
        'last_critic_feedback': feedback,
    }
    if revised_plan:
        normalised = _normalise_plan(revised_plan)
        update['plan'] = normalised
        update['current_step_id'] = normalised[0].id if normalised else None
        update['draft_answer'] = ''
        update['messages'] = []
    return update


def _normalise_plan(revised_plan: Sequence[object]) -> list[PlanStep]:
    """The critic LLM sometimes returns ``revised_plan`` as a list of plain
    strings (titles) instead of ``{id, title}`` dicts. Coerce to PlanStep."""
    normalised: list[PlanStep] = []
    for idx, entry in enumerate(revised_plan, start=1):
        step_id, step_title = _coerce_plan_entry(entry, idx)
        normalised.append(PlanStep(id=step_id, title=step_title, status=PlanStepStatus.PENDING))
    return normalised


def _coerce_plan_entry(entry: object, idx: int) -> tuple[str, str]:
    if isinstance(entry, dict):
        raw_id = entry.get('id')
        raw_title = entry.get('title')
        step_id = str(raw_id) if raw_id is not None else str(idx)
        step_title = str(raw_title) if raw_title is not None else f'Step {idx}'
        return step_id, step_title
    return str(idx), str(entry)


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
    except Exception as exc:
        log.warning('critic parse failure, defaulting to approve: %s', exc)
        return CriticVerdict.APPROVE, '(critic output unparseable; defaulting to approve)', None


def _renderer() -> AgentJinjaRenderer:
    from agents.settings import settings
    return AgentJinjaRenderer(settings)
