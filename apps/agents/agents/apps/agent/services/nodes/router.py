import json
import logging
from uuid import uuid4

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import SystemMessage

from agents.apps.agent.enums import PlanStepStatus, RoutingKind
from agents.apps.agent.repositories import AgentJinjaRenderer
from agents.apps.agent.schemas import AgentState, PlanStepSchema

log = logging.getLogger(__name__)


async def route_node(
    state: AgentState,
    *,
    llm: BaseChatModel,
    renderer: AgentJinjaRenderer | None = None,
) -> AgentState:
    prompt = (renderer or _renderer()).render_router(
        user_message=state.user_message,
        chat_history=state.chat_history,
    )
    msg = await llm.ainvoke([SystemMessage(content=prompt)])
    kind, reason = _parse(str(msg.content))
    update: dict[str, object] = {'routing_kind': kind, 'last_critic_feedback': reason}
    if kind == RoutingKind.TRIVIAL:
        step = PlanStepSchema(id=str(uuid4()), title=state.user_message,
                              status=PlanStepStatus.PENDING)
        # Trivial routing skips the planner, so point current_step_id at the
        # seeded step here — otherwise the executor sees current_step_id=None,
        # returns early without an LLM call, and the turn yields an empty plan
        # stub with no answer (breaks every follow-up turn).
        update['plan'] = [step]
        update['current_step_id'] = step.id
    return state.model_copy(update=update)


def _parse(text: str) -> tuple[RoutingKind, str]:
    try:
        data = json.loads(text)
        kind_raw = str(data.get('kind', 'complex')).lower()
        reason = str(data.get('reason', ''))
        kind = RoutingKind.TRIVIAL if kind_raw == 'trivial' else RoutingKind.COMPLEX
        return kind, reason
    except Exception as exc:
        log.warning('router parse failure, defaulting to complex: %s', exc)
        return RoutingKind.COMPLEX, 'fallback (router parse failure)'


def _renderer() -> AgentJinjaRenderer:
    from agents.settings import settings
    return AgentJinjaRenderer(settings)
