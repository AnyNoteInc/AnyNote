"""Unit tests for create_chat_model factory."""

from __future__ import annotations

import pytest
from langchain_gigachat.chat_models import GigaChat
from langchain_ollama import ChatOllama
from langchain_openai import ChatOpenAI

from agents.exceptions import InvalidPayloadError
from agents.schemas.generate import ModelConfig, ModelConnection, ModelSettings
from agents.services.providers import create_chat_model


def test_creates_ollama_model() -> None:
    cfg = ModelConfig(
        provider="ollama",
        name="gemma4",
        connection=ModelConnection(base_url="http://localhost:11434"),
        settings=ModelSettings(temperature=0.2),
    )
    model = create_chat_model(cfg)
    assert isinstance(model, ChatOllama)
    assert model.model == "gemma4"
    assert model.base_url == "http://localhost:11434"
    assert model.temperature == 0.2


def test_creates_openai_model() -> None:
    cfg = ModelConfig(
        provider="openai",
        name="gpt-4o",
        connection=ModelConnection(api_key="sk-fake", organization="org_123"),
        settings=ModelSettings(temperature=0.0, max_output_tokens=2048),
    )
    model = create_chat_model(cfg)
    assert isinstance(model, ChatOpenAI)
    assert model.model_name == "gpt-4o"


def test_creates_gigachat_model() -> None:
    cfg = ModelConfig(
        provider="gigachat",
        name="GigaChat-Pro",
        connection=ModelConnection(
            client_id="cid", client_secret="csecret", scope="GIGACHAT_API_PERS"
        ),
        settings=ModelSettings(temperature=0.1),
    )
    model = create_chat_model(cfg)
    assert isinstance(model, GigaChat)


def test_unknown_provider_raises() -> None:
    with pytest.raises(InvalidPayloadError):
        create_chat_model(
            ModelConfig.model_construct(provider="nope", name="x")  # type: ignore[arg-type]
        )
