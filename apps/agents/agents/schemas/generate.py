"""Pydantic request/response models for POST /api/v1/generate."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel


class _CamelModel(BaseModel):
    """Base that aliases all fields to camelCase for the wire format."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
    )


class ModelConnection(_CamelModel):
    base_url: str | None = None
    api_key: str | None = None
    organization: str | None = None
    client_id: str | None = None
    client_secret: str | None = None
    scope: str | None = None


class ModelSettings(_CamelModel):
    temperature: float | None = None
    max_output_tokens: int | None = None
    top_p: float | None = None


class ModelConfig(_CamelModel):
    provider: Literal["ollama", "openai", "gigachat"]
    name: str
    connection: ModelConnection = Field(default_factory=ModelConnection)
    settings: ModelSettings = Field(default_factory=ModelSettings)


class OutputContract(_CamelModel):
    format: str = "markdown"
    citations_required: bool = False
    language: str = "ru"


class Instructions(_CamelModel):
    system_prompt: str | None = None
    app_prompt: str | None = None
    output_contract: OutputContract | None = None


class RagDocument(_CamelModel):
    id: str
    title: str
    content: str


class RagContext(_CamelModel):
    enabled: bool = False
    strategy: Literal["optional", "required"] | None = None
    documents: list[RagDocument] = Field(default_factory=list)


class ConversationMessage(_CamelModel):
    role: Literal["user", "assistant"]
    content: str


class Conversation(_CamelModel):
    messages: list[ConversationMessage] = Field(default_factory=list)
    max_history_tokens: int | None = None
    summary: str | None = None


class Skill(_CamelModel):
    id: str
    title: str
    markdown: str


class Agent(_CamelModel):
    id: str
    title: str
    markdown: str


class McpServer(_CamelModel):
    name: str
    description: str
    tools: list[str] = Field(default_factory=list)


class McpConfig(_CamelModel):
    servers: list[McpServer] = Field(default_factory=list)


class UserRequest(_CamelModel):
    text: str

    @field_validator("text")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("userRequest.text must not be blank")
        return value


class GenerateRequest(_CamelModel):
    thread_id: UUID
    model: ModelConfig
    instructions: Instructions | None = None
    rag: RagContext | None = None
    conversation: Conversation = Field(default_factory=Conversation)
    skills: list[Skill] = Field(default_factory=list)
    agents: list[Agent] = Field(default_factory=list)
    mcp: McpConfig | None = None
    user_request: UserRequest
