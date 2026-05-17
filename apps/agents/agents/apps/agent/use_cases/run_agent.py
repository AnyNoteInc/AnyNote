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
from agents.apps.agent.use_cases._streaming import stream_graph

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
            async for event in stream_graph(graph, initial, config, initial):
                yield event
        except Exception as exc:
            log.exception('agent run failed')
            yield ServerEvent.error('INTERNAL_ERROR', str(exc), recoverable=False)
            return

        yield ServerEvent.done()
