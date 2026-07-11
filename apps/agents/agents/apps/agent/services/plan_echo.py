"""Shared predicate for the question-echo plan (one step titled = user message).

Two code paths produce such a plan: trivial routing (route_node seeds a single
step just to give the executor a current_step_id, planner bypassed) and the
planner fallback on unparseable LLM output (_fallback titles the lone step with
user_message). Either way the title carries no planning value — and QUOTING it
back anywhere replays the user's own words:

- in SSE plan_step events the chat renders the question as an assistant block
  (suppressed in GraphStreamingService._diff_plan_events);
- inside the executor system prompt ("You are working on plan step: '<the whole
  user message>'") weaker models echo the quoted instruction text into the
  answer — for inline AI that boilerplate then lands in the document on accept.
"""

from agents.apps.agent.schemas import AgentState

# Descriptive, NOT directive: this title is quoted into the executor system
# prompt for REGULAR trivially-routed chat turns too, where a «выведи только
# итоговый результат» instruction would suppress useful explanations. Inline-AI
# runs get their result-only contract from INLINE_AI_SYSTEM_PROMPT (apps/web).
NEUTRAL_ECHO_STEP_TITLE = 'Ответить на запрос пользователя из последнего сообщения.'


def is_question_echo_plan(state: AgentState) -> bool:
    """True when the plan is a single step that merely echoes the question."""
    return (
        len(state.plan) == 1
        and state.plan[0].title.strip() == state.user_message.strip()
    )
