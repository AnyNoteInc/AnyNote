"""Unit tests for the SSE event discriminated union."""

from __future__ import annotations

import json

from agents.schemas.streaming import ServerEvent


def test_token_event_roundtrip() -> None:
    evt = ServerEvent.token("Привет")
    data = evt.model_dump_json()
    obj = json.loads(data)
    assert obj == {"type": "token", "text": "Привет"}


def test_heartbeat_event() -> None:
    obj = json.loads(ServerEvent.heartbeat().model_dump_json())
    assert obj == {"type": "heartbeat"}


def test_done_event() -> None:
    obj = json.loads(ServerEvent.done().model_dump_json())
    assert obj == {"type": "done"}


def test_error_event() -> None:
    obj = json.loads(ServerEvent.error(code="PROVIDER_ERROR", message="oops").model_dump_json())
    assert obj == {"type": "error", "code": "PROVIDER_ERROR", "message": "oops"}
