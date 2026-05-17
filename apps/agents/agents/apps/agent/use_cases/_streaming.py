"""Shared streaming helpers used by RunAgentUseCase and ResumeAgentUseCase.

LangGraph 1.1.x astream with stream_mode=['values', 'updates'] yields tuples
of (mode, data). Values mode emits the full state dict; updates mode emits
{node_name: delta_dict}.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from langchain_core.runnables import RunnableConfig

from agents.apps.agent.events import ServerEvent
from agents.apps.agent.schemas import AgentState


async def stream_graph(
    graph: Any,
    input: Any,
    config: RunnableConfig,
    initial_state: AgentState,
) -> AsyncIterator[ServerEvent]:
    """Stream ServerEvents from a compiled LangGraph graph.

    Handles both initial runs (input=AgentState) and resume runs
    (input=Command). Emits router_decision on router node updates,
    plan_step events on new plan entries, critic_verdict on critic updates,
    confirmation_required on interrupts, and final token/citation events.
    """
    last_plan_ids: set[str] = set()

    async for chunk in graph.astream(input, config, stream_mode=['values', 'updates']):
        mode, data = chunk
        if mode == 'values':
            state = AgentState.model_validate(data)
            for ev in _diff_plan_events(state, last_plan_ids):
                yield ev
            last_plan_ids = {s.id for s in state.plan}
        elif mode == 'updates':
            for node_name, partial_data in data.items():
                async for ev in _node_events(node_name, partial_data, initial_state):
                    yield ev

        snap = await graph.aget_state(config)
        if snap and snap.interrupts:
            for itr in snap.interrupts:
                payload = itr.value
                yield ServerEvent.confirmation_required(
                    confirmation_id=payload['confirmation_id'],
                    tool=payload['tool'],
                    summary=payload['summary'],
                    args_preview=payload['args_preview'],
                )
            return

    final_snap = await graph.aget_state(config)
    if final_snap:
        final = AgentState.model_validate(final_snap.values)
        if final.final_answer:
            yield ServerEvent.token(final.final_answer)
        for c in final.citations:
            yield ServerEvent.citation(
                page_id=c.page_id, workspace_id=c.workspace_id,
                block_number=c.block_number, title=c.title, quote=c.quote,
            )


def _diff_plan_events(state: AgentState, last_ids: set[str]) -> list[ServerEvent]:
    """Return plan_step events for steps that are new since the last snapshot."""
    new_ids = {s.id for s in state.plan} - last_ids
    return [
        ServerEvent.plan_step(id=s.id, title=s.title, position=idx, status=s.status.value)
        for idx, s in enumerate(state.plan)
        if s.id in new_ids
    ]


async def _node_events(
    node_name: str,
    partial_data: dict[str, Any],
    initial_state: AgentState,
) -> AsyncIterator[ServerEvent]:
    """Yield per-node update events from updates-mode stream chunks."""
    merged = {**initial_state.model_dump(by_alias=True), **partial_data}
    state = AgentState.model_validate(merged)
    if node_name == 'router':
        yield ServerEvent.router_decision(
            kind=state.routing_kind.value,
            reason=state.last_critic_feedback or '',
        )
    if node_name == 'critic' and state.critic_verdict:
        yield ServerEvent.critic_verdict(
            verdict=state.critic_verdict.value,
            feedback=state.critic_feedback or '',
            revision_count=state.revision_count,
        )
