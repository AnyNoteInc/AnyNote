
from typing import Annotated, Literal, Self
from uuid import UUID

from fast_clean.schemas.request_response import RequestResponseSchema
from langchain_core.messages import BaseMessage
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, ConfigDict, Field

from .enums import ModelProviderEnum, RoleEnum


class UserContextSchema(BaseModel):
    x_user_id: UUID
    """
    Идентификатор пользователя.
    """
    x_workspace_id: UUID
    """
    Идентификатор рабочего пространства.
    """


class AgentConfigSchema(RequestResponseSchema):
    title: str
    markdown: str

class SkillConfigSchema(RequestResponseSchema):
    name: str
    description: str


class RagDocumentSchema(RequestResponseSchema):
    model_config = ConfigDict(populate_by_name=True)

    page_id: UUID
    """
    PageId идентификатор документа
    """
    workspace_id: UUID
    """
    WorkspaceId идентификатор рабочего пространства.
    """
    title: str
    """
    Заголовок документа.
    """
    page_type: str
    """
    Тип страницы.
    """
    block_number: int
    """
    Порядковый номер блока на странице.
    """
    content: str
    """
    Текст контента (исходный чанк до нормализации).
    """


class RagDocumentsSchema(RequestResponseSchema):
    documents: Annotated[list[RagDocumentSchema], Field(default_factory=list)]


class McpToolSchema(BaseModel):
    name: str
    description: str = ''


class McpServerToolsSchema(BaseModel):
    name: str
    description: str = ''
    tools: list[McpToolSchema] = Field(default_factory=list)


class ModelConnectionSchema(RequestResponseSchema):
    base_url: str | None = None
    api_key: str | None = None
    organization: str | None = None
    client_id: str | None = None
    client_secret: str | None = None
    scope: str | None = None


class ModelSettingsSchema(RequestResponseSchema):
    temperature: float | None = None
    top_p: float | None = None


class ModelConfigSchema(RequestResponseSchema):
    provider: ModelProviderEnum
    name: str
    connection: ModelConnectionSchema = Field(default_factory=ModelConnectionSchema)
    settings: ModelSettingsSchema = Field(default_factory=ModelSettingsSchema)


class ConversationMessageSchema(RequestResponseSchema):
    role: RoleEnum
    content: str


class McpServerSchema(RequestResponseSchema):
    name: str
    description: str = ''
    url: str
    tools: list[str] = Field(default_factory=list)

    headers: dict[str, str] = Field(default_factory=dict)

    retries: int = 3
    verify: bool = True

class McpConfigSchema(RequestResponseSchema):
    servers: list[McpServerSchema] = Field(default_factory=list)


class ServerEvent(RequestResponseSchema):
    type: Literal["token", "status", "done", "error"]
    text: str | None = None
    id: str | None = None
    kind: Literal["tool", "confirmation"] | None = None
    state: Literal["pending", "running", "done", "error", "required"] | None = None
    title: str | None = None
    detail: str | None = None
    code: str | None = None
    message: str | None = None

    @classmethod
    def token(cls, text: str) -> Self:
        return cls(type="token", text=text)

    @classmethod
    def status(
        cls,
        id: str,
        kind: Literal["tool", "confirmation"],
        state: Literal["pending", "running", "done", "error", "required"],
        title: str,
        detail: str | None = None,
    ) -> Self:
        return cls(type="status", id=id, kind=kind, state=state, title=title, detail=detail)

    @classmethod
    def done(cls) -> Self:
        return cls(type="done")

    @classmethod
    def error(cls, code: str, message: str) -> Self:
        return cls(type="error", code=code, message=message)


class InstructionRequestSchema(RequestResponseSchema):
    format: str = 'markdown'
    language: str = 'en'
    citations_required: bool


class QueryRequestSchema(RequestResponseSchema):
    thread_id: UUID
    """
    Идентификатор чата.
    """
    model: ModelConfigSchema
    """
    Конфигурация модели.
    """
    system_prompt: str = ''
    instruction: InstructionRequestSchema
    """
    Инструкция.
    """
    messages: Annotated[list[ConversationMessageSchema], Field(default_factory=list)]
    """
    Сообщения пользователя.
    """
    rag: RagDocumentsSchema | None = None
    """
    Документы для Retrieval Augmented Generation. Если указано, будет добавлено в контекст модели.
    """
    mcp: McpConfigSchema | None = None
    """
    Список mcp серверов, доступных для инструментов. Если не указан, инструменты использоваться не будут.
    """
    query: str
    """
    Запрос пользователя.
    """


class GraphStateSchema(BaseModel):
    system_prompt: str
    payload: QueryRequestSchema
    user_context: UserContextSchema
    messages: Annotated[list[BaseMessage], Field(default_factory=list)]
    tools: Annotated[list[McpServerToolsSchema], Field(default_factory=list)]
    response_text: str = ''


class RuntimeContext(BaseModel):
    tools: list[StructuredTool] =  Field(default_factory=list)
