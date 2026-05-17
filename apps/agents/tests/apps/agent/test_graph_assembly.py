import pytest
from langgraph.checkpoint.memory import MemorySaver

from agents.apps.agent.services.graph import build_agent_graph


def test_build_agent_graph_compiles():
    saver = MemorySaver()
    g = build_agent_graph(checkpointer=saver)
    nodes = set(g.get_graph().nodes.keys())
    # Includes start/end markers from LangGraph plus our five
    assert {'router', 'planner', 'executor', 'critic', 'memory_writer'} <= nodes
