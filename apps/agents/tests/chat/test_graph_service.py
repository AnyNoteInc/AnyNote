from __future__ import annotations

import uuid

import pytest
from langchain_core.language_models.fake_chat_models import FakeListChatModel
from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver

from agents.apps.chat.repositories.prompt_renderer import JinjaRenderer
from agents.apps.chat.schemas import Conversation, GenerateRequest, ModelConfig, UserRequest
from agents.apps.chat.services.graph_service import GraphState, build_graph


@pytest.fixture
def checkpointer() -> InMemorySaver:
    return InMemorySaver()


def _payload(user_text: str = "Привет") -> GenerateRequest:
    return GenerateRequest(
        thread_id=uuid.uuid4(),
        model=ModelConfig(provider="ollama", name="gemma4"),
        conversation=Conversation(messages=[]),
        user_request=UserRequest(text=user_text),
    )


def test_build_graph_returns_compiled_graph(checkpointer: InMemorySaver) -> None:
    graph = build_graph(renderer=JinjaRenderer(), checkpointer=checkpointer)
    assert hasattr(graph, "astream")


@pytest.mark.asyncio
async def test_build_graph_runs_end_to_end_with_fake_llm() -> None:
    renderer = JinjaRenderer()
    fake_llm = FakeListChatModel(responses=["Привет, Вася!"])
    checkpointer = InMemorySaver()
    graph = build_graph(
        renderer=renderer,
        llm_factory=lambda _cfg: fake_llm,
        checkpointer=checkpointer,
    )

    payload = _payload()
    config: RunnableConfig = {"configurable": {"thread_id": str(payload.thread_id)}}
    initial_state: GraphState = {"payload": payload}

    final_state = await graph.ainvoke(initial_state, config)

    assert final_state is not None
    assert "response_text" in final_state
    assert final_state["response_text"] == "Привет, Вася!"
    assert any(
        isinstance(message, AIMessage) and message.content == "Привет, Вася!"
        for message in final_state["messages"]
    )
