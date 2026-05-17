from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any

from langchain_core.runnables import RunnableConfig
from langgraph.types import Command

from agents.apps.agent.events import ServerEvent
from agents.apps.agent.schemas import AgentContext, AgentResumeRequest, AgentState
from agents.apps.agent.use_cases._streaming import stream_graph


@dataclass
class ResumeAgentUseCase:
    """Resume a graph run that is paused on a confirmation interrupt."""

    build_graph: Callable[[], Any]
    run_streamer: Callable[..., Any]  # unused in this impl; kept for API parity with plan

    async def __call__(
        self,
        *,
        request: AgentResumeRequest,
        context: AgentContext,
        jwt: str,
    ) -> AsyncIterator[ServerEvent]:
        graph = self.build_graph()
        config: RunnableConfig = {'configurable': {'thread_id': str(request.chat_id)}}

        # Validate the pending interrupt matches the supplied confirmation_id.
        snap = await graph.aget_state(config)
        interrupts = getattr(snap, 'interrupts', None) or []
        if not any(
            i.value.get('confirmation_id') == request.confirmation_id for i in interrupts
        ):
            yield ServerEvent.error(
                'CONFIRMATION_MISMATCH',
                'No matching pending confirmation',
                recoverable=False,
            )
            return

        # Reconstruct a minimal initial_state from the snapshot so _node_events
        # can merge partial updates for diff computation.
        initial_state = AgentState.model_validate(snap.values)

        try:
            async for event in stream_graph(
                graph,
                Command(resume={'action': request.action}),
                config,
                initial_state,
            ):
                yield event
        except Exception as exc:
            yield ServerEvent.error('INTERNAL_ERROR', str(exc), recoverable=False)
            return

        yield ServerEvent.done()
