"""Pydantic schemas for chat requests and SSE events."""

from __future__ import annotations

from typing import ClassVar, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

from agents.apps.chat.enums import ModelProvider


class CamelModel(BaseModel):
    """Base model that serializes fields as camelCase on the wire."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
    )


class ModelConnection(CamelModel):
    base_url: str | None = None
    api_key: str | None = None
    organization: str | None = None
    client_id: str | None = None
    client_secret: str | None = None
    scope: str | None = None


class ModelSettings(CamelModel):
    temperature: float | None = None
    max_output_tokens: int | None = None
    top_p: float | None = None


class ModelConfig(CamelModel):
    provider: ModelProvider
    name: str
    connection: ModelConnection = Field(default_factory=ModelConnection)
    settings: ModelSettings = Field(default_factory=ModelSettings)


class ConversationMessage(CamelModel):
    role: Literal["user", "assistant"]
    content: str


class Conversation(CamelModel):
    messages: list[ConversationMessage] = Field(default_factory=list)
    max_history_tokens: int | None = None
    summary: str | None = None


class McpServer(CamelModel):
    name: str
    description: str = ""
    url: str | None = None
    auth_header: str | None = None
    tools: list[str] = Field(default_factory=list)


class Mcp(CamelModel):
    servers: list[McpServer] = Field(default_factory=list)


class UserRequest(CamelModel):
    text: str

    @field_validator("text")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("userRequest.text must not be blank")
        return value


class GenerateRequest(CamelModel):
    thread_id: UUID
    model: ModelConfig
    conversation: Conversation = Field(default_factory=Conversation)
    mcp: Mcp | None = None
    user_request: UserRequest


class _EventModel(CamelModel):
    type: str


class TokenEvent(_EventModel):
    type: Literal["token"] = "token"
    text: str


class DoneEvent(_EventModel):
    type: Literal["done"] = "done"


class ErrorEvent(_EventModel):
    type: Literal["error"] = "error"
    code: str
    message: str


class ServerEvent:
    """Factory helpers for chat SSE payloads."""

    _token_event: ClassVar[type[TokenEvent]] = TokenEvent
    _done_event: ClassVar[type[DoneEvent]] = DoneEvent
    _error_event: ClassVar[type[ErrorEvent]] = ErrorEvent

    @classmethod
    def token(cls, text: str) -> TokenEvent:
        return cls._token_event(text=text)

    @classmethod
    def done(cls) -> DoneEvent:
        return cls._done_event()

    @classmethod
    def error(cls, code: str, message: str) -> ErrorEvent:
        return cls._error_event(code=code, message=message)
