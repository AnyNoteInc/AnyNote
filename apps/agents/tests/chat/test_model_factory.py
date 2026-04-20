from __future__ import annotations

from agents.apps.chat.repositories.model_factory import create_chat_model
from agents.apps.chat.schemas import ModelConfig


def test_create_ollama_model() -> None:
    config = ModelConfig.model_validate({"provider": "ollama", "name": "gemma4"})
    model = create_chat_model(config)
    assert model.__class__.__name__ == "ChatOllama"
