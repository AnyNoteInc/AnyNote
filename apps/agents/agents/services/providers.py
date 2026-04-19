"""Factory that maps a ModelConfig to a configured LangChain ChatModel."""

from __future__ import annotations

from langchain_core.language_models import BaseChatModel
from langchain_gigachat.chat_models import GigaChat
from langchain_ollama import ChatOllama
from langchain_openai import ChatOpenAI

from agents.exceptions import InvalidPayloadError
from agents.schemas.generate import ModelConfig


def create_chat_model(config: ModelConfig) -> BaseChatModel:
    """Return a ChatModel instance for the provider named in the payload.

    Credentials come from ``config.connection``. Nothing is stored in the
    service; each request carries what it needs.
    """
    settings = config.settings
    temperature = settings.temperature if settings.temperature is not None else 0.2
    max_tokens = settings.max_output_tokens

    if config.provider == "ollama":
        base_url = config.connection.base_url or "http://localhost:11434"
        return ChatOllama(model=config.name, base_url=base_url, temperature=temperature)

    if config.provider == "openai":
        return ChatOpenAI(
            model=config.name,
            api_key=config.connection.api_key,
            organization=config.connection.organization,
            temperature=temperature,
            max_tokens=max_tokens,
        )

    if config.provider == "gigachat":
        credentials = f"{config.connection.client_id}:{config.connection.client_secret}"
        return GigaChat(
            credentials=credentials,
            scope=config.connection.scope or "GIGACHAT_API_PERS",
            model=config.name,
            temperature=temperature,
        )

    raise InvalidPayloadError(f"Unknown provider: {config.provider!r}")
