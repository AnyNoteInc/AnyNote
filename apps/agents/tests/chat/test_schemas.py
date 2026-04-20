from __future__ import annotations

import pytest
from pydantic import ValidationError

from agents.apps.chat.errors import InvalidPayloadError
from agents.apps.chat.schemas import GenerateRequest, ServerEvent


def test_generate_request_rejects_blank_text() -> None:
    with pytest.raises(ValidationError):
        GenerateRequest.model_validate(
            {
                "threadId": "adf9f5bf-1679-421d-9f34-8f8fc2d2f542",
                "model": {"provider": "ollama", "name": "gemma4"},
                "conversation": {"messages": []},
                "userRequest": {"text": "   "},
            }
        )


def test_server_event_token_shape() -> None:
    event = ServerEvent.token("hello")
    assert event.model_dump() == {"type": "token", "text": "hello"}


def test_invalid_payload_error_status_code() -> None:
    error = InvalidPayloadError("bad payload")
    assert error.http_status == 422
