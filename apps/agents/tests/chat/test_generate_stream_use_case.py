from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator
from typing import Any, cast

import pytest
from langchain_core.messages import AIMessageChunk

from agents.apps.chat.errors import ProviderError
from agents.apps.chat.schemas import GenerateRequest, ModelConfig, ServerEvent, UserRequest
from agents.apps.chat.use_cases.generate_stream import (
    GenerateStreamUseCase,
    normalize_event,
)


def _payload() -> GenerateRequest:
    return GenerateRequest(
        thread_id=uuid.uuid4(),
        model=ModelConfig(provider="ollama", name="gemma4"),
        user_request=UserRequest(text="hello"),
    )


def _event_payloads(events: list[dict[str, str]]) -> list[str]:
    return [json.loads(event["data"])["type"] for event in events]


def _use_case(graph: object) -> GenerateStreamUseCase:
    return GenerateStreamUseCase(cast(Any, graph))


@pytest.mark.asyncio
async def test_normalize_event_maps_token_message() -> None:
    payload = normalize_event(ServerEvent.token("x"))
    assert json.loads(payload)["type"] == "token"


@pytest.mark.asyncio
async def test_generate_stream_use_case_streams_token_and_done() -> None:
    class FakeGraph:
        async def astream(self, *args: object, **kwargs: object) -> AsyncIterator[object]:
            yield ("messages", (AIMessageChunk(content="hi"), {}))

    events = [event async for event in _use_case(FakeGraph()).stream(_payload())]

    assert _event_payloads(events) == ["token", "done"]
    assert json.loads(events[0]["data"])["text"] == "hi"


@pytest.mark.asyncio
async def test_generate_stream_use_case_maps_provider_error() -> None:
    class FakeGraph:
        async def astream(self, *args: object, **kwargs: object) -> AsyncIterator[object]:
            raise ProviderError("upstream failed", "PROVIDER_ERROR")
            yield  # pragma: no cover

    events = [event async for event in _use_case(FakeGraph()).stream(_payload())]

    assert _event_payloads(events) == ["error"]
    payload = json.loads(events[0]["data"])
    assert payload == {
        "type": "error",
        "code": "PROVIDER_ERROR",
        "message": "upstream failed",
    }


@pytest.mark.asyncio
async def test_generate_stream_use_case_sanitizes_generic_exception() -> None:
    class FakeGraph:
        async def astream(self, *args: object, **kwargs: object) -> AsyncIterator[object]:
            raise RuntimeError("secret details")
            yield  # pragma: no cover

    events = [event async for event in _use_case(FakeGraph()).stream(_payload())]

    assert _event_payloads(events) == ["error"]
    payload = json.loads(events[0]["data"])
    assert payload == {
        "type": "error",
        "code": "INTERNAL_ERROR",
        "message": "Internal server error",
    }


@pytest.mark.asyncio
async def test_generate_stream_use_case_extracts_token_from_list_content() -> None:
    class FakeGraph:
        async def astream(self, *args: object, **kwargs: object) -> AsyncIterator[object]:
            yield ("messages", (AIMessageChunk(content=[{"type": "text", "text": "hello"}]), {}))

    events = [event async for event in _use_case(FakeGraph()).stream(_payload())]

    assert _event_payloads(events) == ["token", "done"]
    assert json.loads(events[0]["data"])["text"] == "hello"
