from dataclasses import dataclass

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import StructuredTool
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from ..enums import RoleEnum
from ..repositories import JinjaRendererRepository, McpToolsRepository, ModelFactoryRepository
from ..schemas import GraphStateSchema

type CompiledGraph = CompiledStateGraph[GraphStateSchema, None, GraphStateSchema, GraphStateSchema]


@dataclass
class GraphService:
    jinja_repository: JinjaRendererRepository
    mcp_tools_repository: McpToolsRepository
    model_factory_repository: ModelFactoryRepository
    checkpointer: AsyncPostgresSaver

    def make_graph(self, state: GraphStateSchema) -> CompiledGraph:
        """
        Собираем главный граф для обработки запроса.
        """

        workflow: StateGraph[GraphStateSchema, None, GraphStateSchema, GraphStateSchema] = StateGraph(GraphStateSchema)
        workflow.add_node('prepare_prompt', self.prepare_prompt)
        workflow.add_node('llm', self.llm)
        workflow.add_node('tools', self.tools)
        workflow.add_edge(START, 'prepare_prompt')
        workflow.add_edge('prepare_prompt', 'llm')
        workflow.add_conditional_edges('llm', self.route_after_llm, {'tools': 'tools', END: END})
        workflow.add_edge('tools', 'llm')
        return workflow.compile(checkpointer=self.checkpointer)

    async def prepare_prompt(self, state: GraphStateSchema) -> GraphStateSchema:
        payload = state.payload
        system_prompt = self.jinja_repository.render(state.payload)

        messages: list[BaseMessage] = [SystemMessage(content=system_prompt)]
        messages += [
            HumanMessage(content=msg.content) if msg.role == RoleEnum.USER else AIMessage(content=msg.content)
            for msg in payload.messages
        ]

        messages.append(HumanMessage(content=payload.query))

        servers = payload.mcp.servers if payload.mcp else []
        tools = await self.mcp_tools_repository.fetch_mcp_tools(servers) if servers else []

        return GraphStateSchema(
            payload=payload,
            user_context=state.user_context,
            system_prompt=system_prompt,
            tools=tools,
            messages=messages,
            response_text='',
        )

    async def llm(self, state: GraphStateSchema) -> GraphStateSchema:
        model = self.model_factory_repository.make(state.payload.model)
        bound = model.bind_tools(state.tools) if state.tools else model
        result = bound.invoke(state.messages)
        text = str(result.content)
        return GraphStateSchema(
            payload=state.payload,
            tools=state.tools,
            user_context=state.user_context,
            system_prompt=state.system_prompt,
            messages=[*state.messages, result],
            response_text=text,
        )

    async def tools(self, state: GraphStateSchema) -> GraphStateSchema:
        last = state.messages[-1]
        tool_calls = getattr(last, 'tool_calls', None) or []
        registered = {tool.name: tool for tool in state.tools}
        additions: list[BaseMessage] = []
        for call in tool_calls:
            name = call['name'] if isinstance(call, dict) else call.name
            args = call['args'] if isinstance(call, dict) else call.args
            call_id = call['id'] if isinstance(call, dict) else call.id
            tool = registered.get(name)
            if tool is None:
                content = f"tool '{name}' is not registered"
            else:
                try:
                    content = await tool.ainvoke(args)
                except Exception as exc:
                    content = f"tool '{name}' raised: {exc}"
            additions.append(ToolMessage(content=str(content), tool_call_id=call_id))
        return GraphStateSchema(
            payload=state.payload,
            user_context=state.user_context,
            system_prompt=state.system_prompt,
            tools=state.tools,
            messages=[*state.messages, *additions],
            response_text=state.response_text,
        )

    def route_after_llm(self, state: GraphStateSchema) -> str:
        last = state.messages[-1]
        tool_calls = getattr(last, 'tool_calls', [])
        if tool_calls and state.tools:
            return 'tools'
        return END
