from __future__ import annotations

import pytest
from pydantic import ValidationError

from agents.apps.chat.enums import ModelProvider
from agents.apps.chat.errors import InvalidPayloadError, UnauthorizedError
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


def test_model_provider_members_are_uppercase() -> None:
    assert ModelProvider.OLLAMA.value == "ollama"
    assert ModelProvider.OPENAI.value == "openai"
    assert ModelProvider.GIGACHAT.value == "gigachat"


def test_server_event_token_shape() -> None:
    event = ServerEvent.token("hello")
    assert event.model_dump() == {"type": "token", "text": "hello"}


def test_server_event_done_shape() -> None:
    event = ServerEvent.done()
    assert event.model_dump() == {"type": "done"}


def test_server_event_error_shape() -> None:
    event = ServerEvent.error("PROVIDER_ERROR", "oops")
    assert event.model_dump() == {
        "type": "error",
        "code": "PROVIDER_ERROR",
        "message": "oops",
    }


def test_invalid_payload_error_status_code() -> None:
    error = InvalidPayloadError("bad payload")
    assert error.http_status == 422
    assert error.code == "INVALID_PAYLOAD"
    assert str(error) == "bad payload"


def test_unauthorized_error_shape() -> None:
    error = UnauthorizedError()
    assert error.http_status == 401
    assert error.code == "UNAUTHORIZED"
    assert error.message == "Invalid bearer token"
