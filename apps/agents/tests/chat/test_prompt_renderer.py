from __future__ import annotations

from agents.apps.chat.repositories.prompt_renderer import JinjaRenderer
from agents.apps.chat.schemas import GenerateRequest


def test_prompt_renderer_includes_user_request() -> None:
    payload = GenerateRequest.model_validate(
        {
            "threadId": "adf9f5bf-1679-421d-9f34-8f8fc2d2f542",
            "model": {"provider": "ollama", "name": "gemma4"},
            "conversation": {"messages": []},
            "userRequest": {"text": "hello"},
        }
    )
    rendered = JinjaRenderer().render(payload)
    assert "hello" in rendered
