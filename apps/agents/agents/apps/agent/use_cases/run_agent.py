from __future__ import annotations

import functools
import logging
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any

from langchain_core.runnables import RunnableConfig

from agents.apps.agent.events import ServerEvent
from agents.apps.agent.schemas import AgentContext, AgentRunRequest, AgentState
from agents.apps.agent.services.graph import build_agent_graph
from agents.apps.agent.services.history_compactor import trim_chat_history
from agents.apps.agent.services.tool_registry import build_registry_for_servers

log = logging.getLogger(__name__)


@dataclass
class RunAgentUseCase:
    llm_factory: Callable[[Any], Any]
    mcp_client: Any
    rag_service: Any
    memory_writer_client: Any
    action_log_repo: Any
    renderer: Any
    checkpointer: Any

    async def __call__(
        self,
        *,
        request: AgentRunRequest,
        context: AgentContext,
        jwt: str,
    ) -> AsyncIterator[ServerEvent]:
        from agents.apps.agent.services.nodes.critic import critic_node
        from agents.apps.agent.services.nodes.executor import executor_node
        from agents.apps.agent.services.nodes.memory_writer import memory_writer_node
        from agents.apps.agent.services.nodes.planner import planner_node
        from agents.apps.agent.services.nodes.router import route_node

        # Discover MCP tools up front so planner sees descriptions.
        discovered = await self.mcp_client.discover_all(request.mcp_servers)
        tools = self.mcp_client.build_langchain_tools(discovered, request.mcp_servers)
        tool_registry = build_registry_for_servers(
            request.mcp_servers,
            discovered={k: [t.name for t in v] for k, v in discovered.items()},
        )

        llm = self.llm_factory(request.model_config_)

        graph = build_agent_graph(
            checkpointer=self.checkpointer,
            router_node=functools.partial(route_node, llm=llm, renderer=self.renderer),
            planner_node=functools.partial(planner_node, llm=llm, renderer=self.renderer),
            executor_node=functools.partial(
                executor_node, llm=llm, tools=tools,
                tool_registry=tool_registry, renderer=self.renderer,
            ),
            critic_node=functools.partial(critic_node, llm=llm, renderer=self.renderer),
            memory_writer_node=functools.partial(
                memory_writer_node, memory_client=self.memory_writer_client, jwt=jwt,
            ),
        )
        config: RunnableConfig = {'configurable': {'thread_id': str(request.chat_id)}}

        initial = AgentState.model_validate({
            'context': context.model_dump(),
            'user_message': request.user_message,
            'chat_history': [m.model_dump() for m in trim_chat_history(request.chat_history)],
            'model': request.model_config_.model_dump(by_alias=True),
            'embedding_config': request.embedding_config.model_dump() if request.embedding_config else None,
            'mcp_servers': [s.model_dump() for s in request.mcp_servers],
            'agent_system_prompt': request.agent_system_prompt,
            'long_term_memories': [m.model_dump() for m in request.long_term_memories],
        })

        try:
            async for event in _stream(graph, initial, config):
                yield event
        except Exception as exc:
            log.exception('agent run failed')
            yield ServerEvent.error('INTERNAL_ERROR', str(exc), recoverable=False)
            return

        yield ServerEvent.done()


async def _stream(
    graph: Any,
    initial: AgentState,
    config: RunnableConfig,
) -> AsyncIterator[ServerEvent]:
    """Stream events from the Plan-Execute-Critic graph.

    LangGraph 1.1.x astream with stream_mode=['values', 'updates'] yields
    tuples of (mode, data). Values mode emits the full state; updates mode
    emits {node_name: delta_dict}.
    """
    last_plan_ids: set[str] = set()

    async for chunk in graph.astream(initial, config, stream_mode=['values', 'updates']):
        mode, data = chunk
        if mode == 'values':
            state = AgentState.model_validate(data)
            for ev in _diff_to_events(state, last_plan_ids):
                yield ev
            last_plan_ids = {s.id for s in state.plan}
        elif mode == 'updates':
            for node_name, partial_data in data.items():
                merged = {**initial.model_dump(by_alias=True), **partial_data}
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

        # Check for confirmation interrupts after each chunk.
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
            return  # stop streaming; web closes SSE

    # Final state — emit final-answer tokens and citations.
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


def _diff_to_events(state: AgentState, last_ids: set[str]) -> list[ServerEvent]:
    """Yield plan_step events for newly added plan steps."""
    events = []
    new_ids = {s.id for s in state.plan} - last_ids
    for idx, step in enumerate(state.plan):
        if step.id in new_ids:
            events.append(ServerEvent.plan_step(
                id=step.id, title=step.title, position=idx,
                status=step.status.value,
            ))
    return events
