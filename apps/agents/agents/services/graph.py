"""LangGraph pipeline: prepare_prompt → llm.

The graph is intentionally minimal in B1. Pillar B2 will add tool-calling
edges between `llm` and a `tool_executor` node.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TypedDict

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from agents.schemas.generate import GenerateRequest, ModelConfig
from agents.services.prompt_renderer import JinjaRenderer


class GraphState(TypedDict, total=False):
    payload: GenerateRequest
    system_prompt: str
    messages: list[BaseMessage]
    response_text: str


LlmFactory = Callable[[ModelConfig], BaseChatModel]

# Alias used by Dishka providers and the /generate endpoint so both sides
# reference the exact same parameterized CompiledStateGraph type. Dishka
# resolves dependencies by exact type equality, so the provider's return
# annotation must match the consumer's FromDishka[...] annotation.
CompiledGraph = CompiledStateGraph[GraphState, None, GraphState, GraphState]


def build_graph(
    *,
    renderer: JinjaRenderer,
    llm_factory: LlmFactory,
    checkpointer: BaseCheckpointSaver[str],
) -> CompiledGraph:
    """Compile the prepare_prompt → llm pipeline with the given checkpointer."""

    async def prepare_prompt(state: GraphState) -> GraphState:
        payload = state["payload"]
        system_prompt = renderer.render(payload)
        messages: list[BaseMessage] = [SystemMessage(content=system_prompt)]
        for m in payload.conversation.messages:
            if m.role == "user":
                messages.append(HumanMessage(content=m.content))
            else:
                messages.append(AIMessage(content=m.content))
        messages.append(HumanMessage(content=payload.user_request.text))
        return {"system_prompt": system_prompt, "messages": messages}

    async def llm(state: GraphState) -> GraphState:
        payload = state["payload"]
        model = llm_factory(payload.model)
        result = await model.ainvoke(state["messages"])
        text = result.content if isinstance(result.content, str) else str(result.content)
        return {"response_text": text}

    workflow: StateGraph[GraphState, None, GraphState, GraphState] = StateGraph(GraphState)
    workflow.add_node("prepare_prompt", prepare_prompt)
    workflow.add_node("llm", llm)
    workflow.add_edge(START, "prepare_prompt")
    workflow.add_edge("prepare_prompt", "llm")
    workflow.add_edge("llm", END)
    return workflow.compile(checkpointer=checkpointer)
