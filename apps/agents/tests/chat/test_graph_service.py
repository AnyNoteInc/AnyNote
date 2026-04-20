from __future__ import annotations

import pytest
from langgraph.checkpoint.memory import InMemorySaver

from agents.apps.chat.repositories.prompt_renderer import JinjaRenderer
from agents.apps.chat.services.graph_service import build_graph


@pytest.fixture
def checkpointer() -> InMemorySaver:
    return InMemorySaver()


def test_build_graph_returns_compiled_graph(checkpointer: object) -> None:
    graph = build_graph(renderer=JinjaRenderer(), checkpointer=checkpointer)
    assert hasattr(graph, "astream")
