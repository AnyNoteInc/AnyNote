"""POST /api/v1/generate — streams LLM tokens as SSE."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Literal

from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter, Depends
from langchain_core.messages import AIMessageChunk
from langchain_core.runnables import RunnableConfig
from sse_starlette.sse import EventSourceResponse

from agents.entrypoints.rest.auth import require_bearer
from agents.exceptions import ProviderError
from agents.schemas.generate import GenerateRequest
from agents.schemas.streaming import ServerEvent
from agents.services.graph import CompiledGraph, GraphState

router = APIRouter(prefix="/api/v1")


@router.post("/generate", dependencies=[Depends(require_bearer)])
@inject
async def generate(
    body: GenerateRequest,
    graph: FromDishka[CompiledGraph],
) -> EventSourceResponse:
    """Run the LangGraph pipeline and stream AI tokens as SSE events.

    LangGraph's ``stream_mode=["messages"]`` yields ``(mode, (message,
    metadata))`` tuples. We forward every non-empty ``AIMessageChunk``
    string content as a ``type=token`` event, then emit ``type=done``.
    Errors raised mid-stream surface as ``type=error`` events; the HTTP
    status stays 200 because headers were already flushed.
    """

    async def event_stream() -> AsyncIterator[dict[str, str]]:
        config: RunnableConfig = {"configurable": {"thread_id": str(body.thread_id)}}
        initial_state: GraphState = {"payload": body}
        stream_modes: list[Literal["messages"]] = ["messages"]
        try:
            # stream_mode as a list causes LangGraph to yield
            # (mode_name, chunk) tuples. For "messages" mode, each chunk
            # is itself an (AIMessageChunk, metadata) tuple.
            async for item in graph.astream(initial_state, config, stream_mode=stream_modes):
                if not (isinstance(item, tuple) and len(item) == 2):
                    continue
                mode, chunk = item
                if mode != "messages":
                    continue
                if not (isinstance(chunk, tuple) and len(chunk) == 2):
                    continue
                message, _metadata = chunk
                if isinstance(message, AIMessageChunk):
                    content = message.content
                    if isinstance(content, str) and content:
                        yield {"data": ServerEvent.token(content).model_dump_json()}
            yield {"data": ServerEvent.done().model_dump_json()}
        except ProviderError as exc:
            yield {
                "data": json.dumps(
                    {"type": "error", "code": exc.code, "message": str(exc)},
                    ensure_ascii=False,
                )
            }
        except Exception as exc:
            # Unknown errors surface as wire-level events; the HTTP status
            # is already 200 because headers were flushed before streaming.
            yield {
                "data": json.dumps(
                    {"type": "error", "code": "INTERNAL_ERROR", "message": str(exc)},
                    ensure_ascii=False,
                )
            }

    return EventSourceResponse(event_stream(), ping=15)
