from collections.abc import AsyncIterator
from dataclasses import dataclass
from logging import getLogger
from typing import Literal

from langchain_core.messages import AIMessage, AIMessageChunk, AnyMessage, ToolMessage
from langchain_core.runnables import RunnableConfig

from ..errors import ProviderError
from ..schemas import GraphStateSchema, QueryRequestSchema, ServerEvent, UserContextSchema
from ..services import GraphService

INTERNAL_ERROR_MESSAGE = "Internal server error"


logger = getLogger(__name__)


def _tool_call_field(call: object, key: str) -> str | None:
    if isinstance(call, dict):
        value = call.get(key)
    else:
        value = getattr(call, key, None)
    return value if isinstance(value, str) and value else None

@dataclass
class GenerateStreamUseCase:
    graph_service: GraphService


    async def __call__(self, query_request: QueryRequestSchema, user_context: UserContextSchema) -> AsyncIterator[ServerEvent]:
        config: RunnableConfig = {"configurable": {"thread_id": str(query_request.thread_id)}}
        initial_state = GraphStateSchema.model_validate({
            'payload': query_request,
            'system_prompt': query_request.system_prompt,
            'user_context': user_context,
        })
        stream_modes: list[Literal['messages'] | Literal['updates']] = ['messages', 'updates']
        tool_titles: dict[str, str] = {}

        try:
            graph = self.graph_service.make_graph(initial_state)
            async for chunk in graph.astream(initial_state, config, stream_mode=stream_modes, version='v2'):
                if chunk['type'] == 'messages':
                    message_chunk, _metadata = chunk['data']
                    if isinstance(message_chunk, AIMessageChunk):
                        token_text = self.extract_token_text(message_chunk.content)
                        if token_text:
                            yield ServerEvent.token(token_text)

                elif chunk["type"] == 'updates':
                    for source, update in chunk["data"].items():
                        if source not in ("model", "tools"):
                            continue
                        for event in self.render_status_events(source, update["messages"], tool_titles):
                            yield event
            yield ServerEvent.done()
        except ProviderError as exc:
            yield ServerEvent.error(exc.code, str(exc))
        except Exception as exc:
            logger.exception("Unexpected error during GenerateStreamUseCase execution", exc_info=exc)
            yield ServerEvent.error("INTERNAL_ERROR", INTERNAL_ERROR_MESSAGE)

    @staticmethod
    def extract_token_text(content: object) -> str | None:
        if isinstance(content, str):
            return content or None
        if isinstance(content, list):
            fragments: list[str] = []
            for block in content:
                if isinstance(block, str):
                    if block:
                        fragments.append(block)
                    continue
                if isinstance(block, dict) and block.get("type") == "text":
                    text = block.get("text")
                    if isinstance(text, str) and text:
                        fragments.append(text)
            return "".join(fragments) or None
        return None

    def render_status_events(
        self,
        source: str,
        messages: list[AnyMessage],
        tool_titles: dict[str, str],
    ) -> list[ServerEvent]:
        events: list[ServerEvent] = []

        if source == "model":
            for message in messages:
                if not isinstance(message, AIMessage):
                    continue
                for call in message.tool_calls:
                    call_id = _tool_call_field(call, "id")
                    title = _tool_call_field(call, "name")
                    if not call_id or not title:
                        continue
                    tool_titles[call_id] = title
                    events.append(
                        ServerEvent.status(
                            id=call_id,
                            kind="tool",
                            state="running",
                            title=title,
                        ),
                    )
            return events

        for message in messages:
            if not isinstance(message, ToolMessage):
                continue
            detail = self.extract_token_text(message.content)
            title = tool_titles.get(message.tool_call_id, "Tool")
            state: Literal["done", "error"] = "done"
            if detail and (" raised:" in detail or " is not registered" in detail):
                state = "error"
            events.append(
                ServerEvent.status(
                    id=message.tool_call_id,
                    kind="tool",
                    state=state,
                    title=title,
                    detail=detail,
                ),
            )
        return events
