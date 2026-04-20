"""Generate-stream use case for chat SSE responses."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Literal

from langchain_core.messages import AIMessageChunk
from langchain_core.runnables import RunnableConfig

from agents.apps.chat.errors import ProviderError
from agents.apps.chat.schemas import GenerateRequest, ServerEvent
from agents.apps.chat.services.graph_service import CompiledGraph, GraphState

_INTERNAL_ERROR_MESSAGE = "Internal server error"


def normalize_event(event: ServerEvent) -> str:
    return event.model_dump_json()


def _extract_token_text(content: object) -> str | None:
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


class GenerateStreamUseCase:
    def __init__(self, graph: CompiledGraph) -> None:
        self._graph = graph

    async def stream(self, body: GenerateRequest) -> AsyncIterator[dict[str, str]]:
        config: RunnableConfig = {"configurable": {"thread_id": str(body.thread_id)}}
        initial_state: GraphState = {"payload": body}
        stream_modes: list[Literal["messages"]] = ["messages"]

        try:
            async for item in self._graph.astream(initial_state, config, stream_mode=stream_modes):
                if not (isinstance(item, tuple) and len(item) == 2):
                    continue
                mode, chunk = item
                if mode != "messages":
                    continue
                if not (isinstance(chunk, tuple) and len(chunk) == 2):
                    continue
                message, _metadata = chunk
                if isinstance(message, AIMessageChunk):
                    content = _extract_token_text(message.content)
                    if content:
                        yield {"data": normalize_event(ServerEvent.token(content))}
            yield {"data": normalize_event(ServerEvent.done())}
        except ProviderError as exc:
            yield {"data": normalize_event(ServerEvent.error(exc.code, str(exc)))}
        except Exception:
            yield {
                "data": normalize_event(ServerEvent.error("INTERNAL_ERROR", _INTERNAL_ERROR_MESSAGE))
            }
