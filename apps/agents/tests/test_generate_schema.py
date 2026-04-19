"""Unit tests for the GenerateRequest pydantic schema."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from pydantic import ValidationError

from agents.schemas.generate import GenerateRequest


def _valid_payload() -> dict[str, Any]:
    return {
        "threadId": str(uuid.uuid4()),
        "model": {
            "provider": "ollama",
            "name": "gemma4",
            "connection": {"baseUrl": "http://localhost:11434"},
            "settings": {"temperature": 0.2, "maxOutputTokens": 1024, "topP": 1.0},
        },
        "instructions": {
            "systemPrompt": "Ты помощник",
            "appPrompt": "Правила apps/web",
            "outputContract": {
                "format": "markdown",
                "citationsRequired": True,
                "language": "ru",
            },
        },
        "conversation": {"messages": [], "maxHistoryTokens": 1000},
        "skills": [],
        "agents": [],
        "mcp": {"servers": []},
        "userRequest": {"text": "Привет"},
    }


def test_minimal_valid_payload_parses() -> None:
    body = GenerateRequest.model_validate(_valid_payload())
    assert body.model.provider == "ollama"
    assert body.user_request.text == "Привет"


def test_camelcase_roundtrip() -> None:
    body = GenerateRequest.model_validate(_valid_payload())
    dumped = body.model_dump(by_alias=True)
    assert "threadId" in dumped
    assert "userRequest" in dumped


def test_empty_user_request_fails() -> None:
    payload = _valid_payload()
    payload["userRequest"]["text"] = "   "
    with pytest.raises(ValidationError):
        GenerateRequest.model_validate(payload)


def test_unknown_provider_fails() -> None:
    payload = _valid_payload()
    payload["model"]["provider"] = "anthropic"
    with pytest.raises(ValidationError):
        GenerateRequest.model_validate(payload)


def test_minimum_required_only() -> None:
    payload = {
        "threadId": str(uuid.uuid4()),
        "model": {"provider": "ollama", "name": "gemma4"},
        "conversation": {"messages": []},
        "userRequest": {"text": "hi"},
    }
    body = GenerateRequest.model_validate(payload)
    assert body.instructions is None
    assert body.rag is None
    assert body.skills == []
    assert body.agents == []
    assert body.mcp is None


def test_invalid_thread_id_fails() -> None:
    payload = _valid_payload()
    payload["threadId"] = "not-a-uuid"
    with pytest.raises(ValidationError):
        GenerateRequest.model_validate(payload)
