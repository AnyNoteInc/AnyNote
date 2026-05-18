from __future__ import annotations

import functools
import logging
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any

from langchain_core.runnables import RunnableConfig
from langgraph.types import Command

from agents.apps.agent.events import ServerEvent
from agents.apps.agent.schemas import (
    AgentContext,
    AgentResumeRequest,
    AgentState,
    McpServerSchema,
    MemoryWrite,
    ModelConfigSchema,
)
from agents.apps.agent.services.graph import build_agent_graph
from agents.apps.agent.services.internal_tools import (
    make_save_memory_tool,
    make_search_pages_tool,
)
from agents.apps.agent.services.tool_registry import build_registry_for_servers
from agents.apps.agent.use_cases._streaming import stream_graph

log = logging.getLogger(__name__)


@dataclass
class ResumeAgentUseCase:
    """Resume a graph run that is paused on a confirmation interrupt.

    On resume we must rebuild the LangGraph node bindings (llm, MCP tools, tool
    registry, renderer, memory writer) the same way RunAgentUseCase does so
    nodes can continue executing. The original request payload is recovered
    from the saved AgentState in the checkpoint.
    """

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
        request: AgentResumeRequest,
        context: AgentContext,
        jwt: str,
    ) -> AsyncIterator[ServerEvent]:
        from agents.apps.agent.services.nodes.critic import critic_node
        from agents.apps.agent.services.nodes.executor import executor_node
        from agents.apps.agent.services.nodes.memory_writer import memory_writer_node
        from agents.apps.agent.services.nodes.planner import planner_node
        from agents.apps.agent.services.nodes.router import route_node
        from agents.apps.agent.services.nodes.tool_runner import tool_runner_node

        config: RunnableConfig = {'configurable': {'thread_id': str(request.chat_id)}}

        # 1. Probe the snapshot — confirm the interrupt id matches.
        probe_graph = build_agent_graph(checkpointer=self.checkpointer)
        snap = await probe_graph.aget_state(config)
        interrupts = getattr(snap, 'interrupts', None) or []
        if not any(
            getattr(i, 'value', None) and i.value.get('confirmation_id') == request.confirmation_id
            for i in interrupts
        ):
            yield ServerEvent.error(
                'CONFIRMATION_MISMATCH',
                'No matching pending confirmation',
                recoverable=False,
            )
            return

        # 2. Recover the original payload from the saved state so we can rebuild
        # node partials identical to the original run.
        state = AgentState.model_validate(snap.values)
        model_config = ModelConfigSchema.model_validate(state.model_config_.model_dump(by_alias=True))
        mcp_servers: list[McpServerSchema] = [
            McpServerSchema.model_validate(s.model_dump()) for s in state.mcp_servers
        ]
        log.info('Resume: MCP servers count=%d', len(mcp_servers))

        discovered = await self.mcp_client.discover_all(mcp_servers)
        tools = self.mcp_client.build_langchain_tools(discovered, mcp_servers)
        tool_registry = build_registry_for_servers(
            discovered={k: [t.name for t in v] for k, v in discovered.items()},
        )

        pending_memory_writes: list[MemoryWrite] = list(state.pending_memory_writes)
        tools = [
            *tools,
            make_save_memory_tool(
                pending_memory_writes,
                memory_client=self.memory_writer_client,
                jwt=jwt,
                workspace_id=str(context.workspace_id),
                user_id=str(context.user_id),
            ),
        ]
        if state.embedding_config is not None:
            tools.append(
                make_search_pages_tool(
                    workspace_id=str(context.workspace_id),
                    embedding=state.embedding_config,
                    rag_service=self.rag_service,
                ),
            )

        llm = self.llm_factory(model_config)

        graph = build_agent_graph(
            checkpointer=self.checkpointer,
            router_node=functools.partial(route_node, llm=llm, renderer=self.renderer),
            planner_node=functools.partial(planner_node, llm=llm, renderer=self.renderer),
            executor_node=functools.partial(
                executor_node, llm=llm, tools=tools, renderer=self.renderer,
            ),
            tool_runner_node=functools.partial(
                tool_runner_node, tools=tools, tool_registry=tool_registry,
            ),
            critic_node=functools.partial(critic_node, llm=llm, renderer=self.renderer),
            memory_writer_node=functools.partial(
                memory_writer_node, memory_client=self.memory_writer_client, jwt=jwt,
            ),
        )

        try:
            async for event in stream_graph(
                graph,
                Command(resume={'action': request.action}),
                config,
                state,
            ):
                yield event
        except Exception as exc:
            log.exception('agent resume failed')
            yield ServerEvent.error('INTERNAL_ERROR', str(exc), recoverable=False)
            return

        yield ServerEvent.done()
