"""LangGraph pipeline for chat requests."""

from __future__ import annotations

from collections.abc import Callable
from typing import TypeAlias, TypedDict

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import StructuredTool
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from agents.apps.chat.repositories.mcp_tools import fetch_mcp_tools
from agents.apps.chat.repositories.model_factory import create_chat_model
from agents.apps.chat.repositories.prompt_renderer import JinjaRenderer
from agents.apps.chat.schemas import GenerateRequest, ModelConfig


class GraphState(TypedDict, total=False):
    payload: GenerateRequest
    system_prompt: str
    messages: list[BaseMessage]
    response_text: str
    tools: list[StructuredTool]


LlmFactory = Callable[[ModelConfig], BaseChatModel]
CompiledGraph: TypeAlias = (  # noqa: UP040
    CompiledStateGraph[GraphState, None, GraphState, GraphState]
)


def build_graph(
    *,
    renderer: JinjaRenderer,
    checkpointer: BaseCheckpointSaver[str],
    llm_factory: LlmFactory = create_chat_model,
) -> CompiledGraph:
    async def prepare_prompt(state: GraphState) -> GraphState:
        payload = state["payload"]
        system_prompt = renderer.render(payload)
        messages: list[BaseMessage] = [SystemMessage(content=system_prompt)]
        for msg in payload.conversation.messages:
            if msg.role == "user":
                messages.append(HumanMessage(content=msg.content))
            else:
                messages.append(AIMessage(content=msg.content))
        messages.append(HumanMessage(content=payload.user_request.text))

        servers = payload.mcp.servers if payload.mcp else []
        reachable = [server for server in servers if server.url]
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
        registered = {tool.name: tool for tool in state.get("tools") or []}
        additions: list[BaseMessage] = []
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
            additions.append(ToolMessage(content=str(content), tool_call_id=call_id))
        return {"messages": [*state["messages"], *additions]}

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
