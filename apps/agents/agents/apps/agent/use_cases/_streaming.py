"""Shared streaming helpers used by RunAgentUseCase and ResumeAgentUseCase.

LangGraph 1.1.x astream with stream_mode=['values', 'updates'] yields tuples
of (mode, data). Values mode emits the full state dict; updates mode emits
{node_name: delta_dict}.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from langchain_core.runnables import RunnableConfig

from agents.apps.agent.schemas import AgentState, ServerEventSchema


async def stream_graph(
    graph: Any,
    input: Any,
    config: RunnableConfig,
    initial_state: AgentState,
) -> AsyncIterator[ServerEventSchema]:
    """Stream ServerEvents from a compiled LangGraph graph.

    Handles both initial runs (input=AgentState) and resume runs
    (input=Command). Emits router_decision on router node updates,
    plan_step events on new plan entries, critic_verdict on critic updates,
    confirmation_required on interrupts, and final token/citation events.
    """
    # Track each plan step we've emitted by (id -> last status) so we can
    # re-emit plan_step events when status changes (PENDING → RUNNING → DONE).
    # Without this the UI block stays at "Pending" forever even after the
    # executor finishes the step.
    last_plan_states: dict[str, str] = {}

    async for chunk in graph.astream(input, config, stream_mode=['values', 'updates']):
        mode, data = chunk
        if mode == 'values':
            events, last_plan_states = _process_values_chunk(data, last_plan_states)
            for ev in events:
                yield ev
            continue
        done = False
        async for ev in _process_updates_chunk(data, initial_state):
            if isinstance(ev, _Done):
                done = True
                break
            yield ev
        if done:
            return

    async for ev in _yield_final_events(graph, config):
        yield ev


def _process_values_chunk(
    data: Any,
    last_plan_states: dict[str, str],
) -> tuple[list[ServerEventSchema], dict[str, str]]:
    try:
        state = AgentState.model_validate(data)
    except Exception:
        # values-mode for intermediate states can carry non-state shapes
        # (e.g. interrupt tuples). Skip — interrupts are surfaced via updates.
        return [], last_plan_states
    events = _diff_plan_events(state, last_plan_states)
    return events, {s.id: s.status.value for s in state.plan}


class _Done:
    """Sentinel yielded by _process_updates_chunk to stop the outer stream."""


async def _process_updates_chunk(
    data: Any,
    initial_state: AgentState,
) -> AsyncIterator[Any]:
    interrupts = data.get('__interrupt__') if isinstance(data, dict) else None
    if interrupts:
        for ev in _interrupt_events(interrupts):
            yield ev
        yield _Done()
        return
    if not isinstance(data, dict):
        return
    for node_name, partial_data in data.items():
        if not isinstance(partial_data, dict):
            continue
        async for ev in _node_events(node_name, partial_data, initial_state):
            yield ev


def _interrupt_events(interrupts: Any) -> list[ServerEventSchema]:
    out: list[ServerEventSchema] = []
    for itr in interrupts:
        payload = getattr(itr, 'value', None) or {}
        if isinstance(payload, dict) and 'confirmation_id' in payload:
            out.append(ServerEventSchema.confirmation_required(
                confirmation_id=str(payload['confirmation_id']),
                tool=str(payload.get('tool', '')),
                summary=str(payload.get('summary', '')),
                args_preview=payload.get('args_preview') or {},
            ))
    return out


async def _yield_final_events(graph: Any, config: RunnableConfig) -> AsyncIterator[ServerEventSchema]:
    final_snap = await graph.aget_state(config)
    if not final_snap:
        return
    final = AgentState.model_validate(final_snap.values)
    if final.final_answer:
        yield ServerEventSchema.token(final.final_answer)
    for c in final.citations:
        yield ServerEventSchema.citation(
            page_id=c.page_id, workspace_id=c.workspace_id,
            block_number=c.block_number, title=c.title, quote=c.quote,
        )


def _diff_plan_events(state: AgentState, last_states: dict[str, str]) -> list[ServerEventSchema]:
    """Return plan_step events for steps that are new OR whose status changed
    since the last snapshot. The web translator upserts blocks by id, so
    re-emitting an existing step with a new status flips the UI block from
    Pending → Running → Done.
    """
    out: list[ServerEventSchema] = []
    for idx, s in enumerate(state.plan):
        prev_status = last_states.get(s.id)
        if prev_status == s.status.value:
            continue
        out.append(
            ServerEventSchema.plan_step(id=s.id, title=s.title, position=idx, status=s.status.value),
        )
    return out


async def _node_events(
    node_name: str,
    partial_data: dict[str, Any],
    initial_state: AgentState,
) -> AsyncIterator[ServerEventSchema]:
    """Yield per-node update events from updates-mode stream chunks."""
    merged = {**initial_state.model_dump(by_alias=True), **partial_data}
    state = AgentState.model_validate(merged)
    if node_name == 'router':
        yield ServerEventSchema.router_decision(
            kind=state.routing_kind.value,
            reason=state.last_critic_feedback or '',
        )
    if node_name == 'critic' and state.critic_verdict:
        yield ServerEventSchema.critic_verdict(
            verdict=state.critic_verdict.value,
            feedback=state.critic_feedback or '',
            revision_count=state.revision_count,
        )
