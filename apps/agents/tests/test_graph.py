"""Unit tests for the compiled LangGraph pipeline (no real LLM call)."""

from __future__ import annotations

import uuid

import pytest
from langchain_core.language_models.fake_chat_models import FakeListChatModel
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver

from agents.schemas.generate import (
    Conversation,
    GenerateRequest,
    ModelConfig,
    UserRequest,
)
from agents.services.graph import GraphState, build_graph
from agents.services.prompt_renderer import JinjaRenderer


def _payload(user_text: str = "Привет") -> GenerateRequest:
    return GenerateRequest(
        thread_id=uuid.uuid4(),
        model=ModelConfig(provider="ollama", name="gemma4"),
        conversation=Conversation(messages=[]),
        user_request=UserRequest(text=user_text),
    )


@pytest.mark.asyncio
async def test_graph_runs_end_to_end_with_fake_llm() -> None:
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
    assert "system_prompt" in final_state
    assert "# CURRENT USER REQUEST" in final_state["system_prompt"]
    assert final_state["response_text"].startswith("Привет")


def test_graph_state_shape() -> None:
    keys = set(GraphState.__annotations__.keys())
    assert {"payload", "system_prompt", "messages", "response_text"} <= keys
