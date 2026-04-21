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

        try:
            graph = self.graph_service.make_graph(initial_state)
            async for chunk in graph.astream(initial_state, config, stream_mode=stream_modes, version='v2'):
                if chunk['type'] == 'messages':
                    token, metadata = chunk['data']
                    if isinstance(token, AIMessageChunk):
                        token = self.extract_token_text(token.content)
                        if token:
                            yield ServerEvent.token(token)

                elif chunk["type"] == 'updates':
                    for source, update in chunk["data"].items():
                        if source in ("model", "tools"):  # `source` captures node name
                            content = self.render_completed_message(update["messages"][-1])
                            if content:
                                yield ServerEvent.token(content)
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

    def render_completed_message(self,message: AnyMessage) -> str | None:
        if isinstance(message, AIMessage) and message.tool_calls:
            return ','.join([str(call) for call in message.tool_calls])
        if isinstance(message, ToolMessage):
            return self.extract_token_text(message.content_blocks)
