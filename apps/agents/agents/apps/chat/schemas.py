"""Pydantic schemas for chat requests and SSE events."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_serializer
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


class McpConfig(CamelModel):
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
    mcp: McpConfig | None = None
    user_request: UserRequest


class ServerEvent(CamelModel):
    type: Literal["token", "done", "error"]
    text: str | None = None
    code: str | None = None
    message: str | None = None

    @classmethod
    def token(cls, text: str) -> ServerEvent:
        return cls(type="token", text=text)

    @classmethod
    def done(cls) -> ServerEvent:
        return cls(type="done")

    @classmethod
    def error(cls, code: str, message: str) -> ServerEvent:
        return cls(type="error", code=code, message=message)

    @model_serializer(mode="plain")
    def _serialize(self) -> dict[str, str]:
        data: dict[str, str] = {"type": self.type}
        if self.text is not None:
            data["text"] = self.text
        if self.code is not None:
            data["code"] = self.code
        if self.message is not None:
            data["message"] = self.message
        return data
