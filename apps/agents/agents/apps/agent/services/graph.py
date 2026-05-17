from __future__ import annotations

from collections.abc import Callable
from typing import Any

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from agents.apps.agent.enums import CriticVerdict, RoutingKind
from agents.apps.agent.schemas import AgentState

type CompiledAgentGraph = CompiledStateGraph[AgentState, None, AgentState, AgentState]


def build_agent_graph(
    *,
    checkpointer: BaseCheckpointSaver[Any],
    router_node: Callable[..., Any] | None = None,
    planner_node: Callable[..., Any] | None = None,
    executor_node: Callable[..., Any] | None = None,
    critic_node: Callable[..., Any] | None = None,
    memory_writer_node: Callable[..., Any] | None = None,
) -> CompiledAgentGraph:
    """Build the Plan-Execute-Critic graph.

    Node implementations are passed in to keep the builder pure and testable.
    The use-case layer wires real ones via Dishka.
    """
    from agents.apps.agent.services.nodes.critic import critic_node as _c
    from agents.apps.agent.services.nodes.executor import executor_node as _e
    from agents.apps.agent.services.nodes.memory_writer import memory_writer_node as _m
    from agents.apps.agent.services.nodes.planner import planner_node as _p
    from agents.apps.agent.services.nodes.router import route_node as _r

    router_node = router_node or _r
    planner_node = planner_node or _p
    executor_node = executor_node or _e
    critic_node = critic_node or _c
    memory_writer_node = memory_writer_node or _m

    g: StateGraph[AgentState, None, AgentState, AgentState] = StateGraph(AgentState)
    g.add_node('router', router_node)
    g.add_node('planner', planner_node)
    g.add_node('executor', executor_node)
    g.add_node('critic', critic_node)
    g.add_node('memory_writer', memory_writer_node)

    g.add_edge(START, 'router')
    g.add_conditional_edges('router', _after_router, {
        'planner': 'planner', 'executor': 'executor',
    })
    g.add_edge('planner', 'executor')
    g.add_conditional_edges('executor', _after_executor, {
        'executor': 'executor', 'critic': 'critic',
    })
    g.add_conditional_edges('critic', _after_critic, {
        'planner': 'planner', 'memory_writer': 'memory_writer',
    })
    g.add_edge('memory_writer', END)

    return g.compile(checkpointer=checkpointer)


def _after_router(state: AgentState) -> str:
    return 'executor' if state.routing_kind == RoutingKind.TRIVIAL else 'planner'


def _after_executor(state: AgentState) -> str:
    return 'executor' if state.current_step_id is not None else 'critic'


def _after_critic(state: AgentState) -> str:
    if state.critic_verdict == CriticVerdict.REVISE:
        return 'planner'
    return 'memory_writer'
