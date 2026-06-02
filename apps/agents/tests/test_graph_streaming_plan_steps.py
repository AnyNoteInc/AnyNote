"""Plan-step emission rules for GraphStreamingService._diff_plan_events.

A single-step plan whose only title is the raw user message is an internal
artifact, not a real plan: trivial routing seeds it so the executor has a
current_step_id (router.route_node), and the planner fallback emits it on
unparseable LLM output (planner._fallback). Surfacing either as a plan_step
event makes the chat UI render the user's own question back as the first
assistant "service block" (the echoed-question bug). These tests pin that the
echo artifact is suppressed while genuine multi-step plans stay visible.
"""

from agents.apps.agent.enums import PlanStepStatus, RoutingKind
from agents.apps.agent.schemas import PlanStepSchema
from agents.apps.agent.services.graph_streaming import GraphStreamingService

from tests.apps.agent.factories import make_state


def _diff(state, last_states):
    return GraphStreamingService()._diff_plan_events(state, last_states)


def test_trivial_single_step_plan_emits_no_plan_step_event() -> None:
    state = make_state(user_message='какой у меня тулинг?')
    state = state.model_copy(update={
        'routing_kind': RoutingKind.TRIVIAL,
        'plan': [PlanStepSchema(id='s1', title='какой у меня тулинг?',
                                status=PlanStepStatus.PENDING)],
    })

    events = _diff(state, {})

    assert events == []


def test_complex_fallback_single_step_echoing_question_is_suppressed() -> None:
    # planner_node._fallback titles the lone step with user_message when the
    # planner LLM output is unparseable. routing_kind is COMPLEX here, but the
    # step is still a content-free echo of the question — suppress it too.
    state = make_state(user_message='какой у меня тулинг?')
    state = state.model_copy(update={
        'routing_kind': RoutingKind.COMPLEX,
        'plan': [PlanStepSchema(id='1', title='какой у меня тулинг?',
                                status=PlanStepStatus.PENDING)],
    })

    events = _diff(state, {})

    assert events == []


def test_complex_plan_still_emits_plan_step_events() -> None:
    state = make_state(user_message='Собери summary всех встреч')
    state = state.model_copy(update={
        'routing_kind': RoutingKind.COMPLEX,
        'plan': [
            PlanStepSchema(id='s1', title='Найти страницы встреч',
                           status=PlanStepStatus.PENDING),
            PlanStepSchema(id='s2', title='Сделать summary',
                           status=PlanStepStatus.PENDING),
        ],
    })

    events = _diff(state, {})

    assert [e.title for e in events] == ['Найти страницы встреч', 'Сделать summary']
