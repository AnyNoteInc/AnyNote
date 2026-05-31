import functools
import logging
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Any

from langchain_core.runnables import RunnableConfig

from agents.apps.agent.schemas import (
    AgentContext,
    AgentRunRequestSchema,
    AgentState,
    MemoryWriteSchema,
    ServerEventSchema,
)
from agents.apps.agent.services.graph import build_agent_graph
from agents.apps.agent.services.graph_streaming import GraphStreamingService
from agents.apps.agent.services.history_compactor import trim_chat_history
from agents.apps.agent.services.internal_tools import (
    make_save_memory_tool,
    make_search_pages_tool,
)
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
    streaming_service: GraphStreamingService

    async def __call__(
        self,
        *,
        request: AgentRunRequestSchema,
        context: AgentContext,
        jwt: str,
    ) -> AsyncIterator[ServerEventSchema]:
        from agents.apps.agent.services.nodes.critic import critic_node
        from agents.apps.agent.services.nodes.executor import executor_node
        from agents.apps.agent.services.nodes.memory_writer import memory_writer_node
        from agents.apps.agent.services.nodes.planner import planner_node
        from agents.apps.agent.services.nodes.router import route_node
        from agents.apps.agent.services.nodes.tool_runner import tool_runner_node

        # Discover MCP tools up front so planner sees descriptions.
        log.info('MCP servers in payload count=%d names=%s', len(request.mcp_servers),
                 [s.name for s in request.mcp_servers])
        discovered = await self.mcp_client.discover_all(request.mcp_servers)
        log.info('MCP discover_all: %s', {k: len(v) for k, v in discovered.items()})
        tools = self.mcp_client.build_langchain_tools(discovered, request.mcp_servers)
        log.info('LangChain tools count=%d', len(tools))
        tool_registry = build_registry_for_servers(
            discovered={k: [t.name for t in v] for k, v in discovered.items()},
        )

        # Internal agent tools — live inside apps/agents (no MCP). Share the
        # same tool list given to the executor so the LLM calls them the same
        # way as MCP tools. recall_memory not wired here in v1 — relevant facts
        # are already loaded by web into request.long_term_memories and
        # surfaced to the planner via the prompt.
        pending_memory_writes: list[MemoryWriteSchema] = []
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
        if request.embedding_config is not None:
            tools.append(
                make_search_pages_tool(
                    workspace_id=str(context.workspace_id),
                    embedding=request.embedding_config,
                    rag_service=self.rag_service,
                ),
            )
        log.info('Total tools count=%d (incl. internal)', len(tools))

        llm = self.llm_factory(request.model_config_)

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
            'attachments': [a.model_dump() for a in request.attachments],
        })

        try:
            async for event in self.streaming_service.stream(graph, initial, config, initial):
                yield event
        except Exception as exc:
            log.exception('agent run failed')
            yield ServerEventSchema.error('INTERNAL_ERROR', str(exc), recoverable=False)
            return

        yield ServerEventSchema.done()
