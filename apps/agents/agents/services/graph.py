"""LangGraph pipeline.

Default flow: ``prepare_prompt → llm`` for backwards compatibility.

If the request payload contains ``mcp.servers`` with reachable URLs we
fetch their tools, bind them to the model, and add a ToolNode with a
conditional edge so the model can drive a tool-call loop:

    prepare_prompt → llm ⟶ (tool_calls?) → tools → llm → … → END
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TypedDict

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langchain_core.tools import StructuredTool
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from agents.schemas.generate import GenerateRequest, ModelConfig
from agents.services.mcp_tools import fetch_mcp_tools
from agents.services.prompt_renderer import JinjaRenderer


class GraphState(TypedDict, total=False):
    payload: GenerateRequest
    system_prompt: str
    messages: list[BaseMessage]
    response_text: str
    tools: list[StructuredTool]


LlmFactory = Callable[[ModelConfig], BaseChatModel]

CompiledGraph = CompiledStateGraph[GraphState, None, GraphState, GraphState]


def build_graph(
    *,
    renderer: JinjaRenderer,
    llm_factory: LlmFactory,
    checkpointer: BaseCheckpointSaver[str],
) -> CompiledGraph:
    """Compile the prepare_prompt → llm pipeline with optional tool-call loop."""

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

        servers = payload.mcp.servers if payload.mcp else []
        reachable = [s for s in servers if s.url]
        tools = await fetch_mcp_tools(reachable) if reachable else []

        return {
            "system_prompt": system_prompt,
            "messages": messages,
            "tools": tools,
        }

    async def llm(state: GraphState) -> GraphState:
        payload = state["payload"]
        model = llm_factory(payload.model)
        tools = state.get("tools") or []
        bound = model.bind_tools(tools) if tools else model
        result = await bound.ainvoke(state["messages"])
        text = result.content if isinstance(result.content, str) else str(result.content)
        return {
            "messages": [*state["messages"], result],
            "response_text": text,
        }

    async def tools_node(state: GraphState) -> GraphState:
        last = state["messages"][-1]
        tool_calls = getattr(last, "tool_calls", None) or []
        registered = {t.name: t for t in state.get("tools") or []}
        new_messages: list[BaseMessage] = []
        for call in tool_calls:
            name = call["name"] if isinstance(call, dict) else call.name
            args = call["args"] if isinstance(call, dict) else call.args
            call_id = call["id"] if isinstance(call, dict) else call.id
            tool = registered.get(name)
            if tool is None:
                content = f"tool '{name}' is not registered"
            else:
                try:
                    content = await tool.ainvoke(args)
                except Exception as exc:
                    content = f"tool '{name}' raised: {exc}"
            new_messages.append(ToolMessage(content=str(content), tool_call_id=call_id))
        return {"messages": [*state["messages"], *new_messages]}

    def route_after_llm(state: GraphState) -> str:
        last = state["messages"][-1]
        tool_calls = getattr(last, "tool_calls", None) or []
        if tool_calls and (state.get("tools") or []):
            return "tools"
        return END

    workflow: StateGraph[GraphState, None, GraphState, GraphState] = StateGraph(GraphState)
    workflow.add_node("prepare_prompt", prepare_prompt)
    workflow.add_node("llm", llm)
    workflow.add_node("tools", tools_node)
    workflow.add_edge(START, "prepare_prompt")
    workflow.add_edge("prepare_prompt", "llm")
    workflow.add_conditional_edges("llm", route_after_llm, {"tools": "tools", END: END})
    workflow.add_edge("tools", "llm")
    return workflow.compile(checkpointer=checkpointer)
