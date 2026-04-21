
from typing import Annotated, Literal, Self
from langchain_core.tools import StructuredTool
from langchain_core.messages import BaseMessage
from uuid import UUID
from fast_clean.schemas.request_response import RequestResponseSchema

from pydantic import BaseModel, Field


from .enums import ModelProviderEnum, RoleEnum



class AgentConfigSchema(RequestResponseSchema):
    title: str
    markdown: str

class SkillConfigSchema(RequestResponseSchema):
    name: str
    description: str



class RagDocumentSchema(RequestResponseSchema):
    id: UUID
    """
    PageId идентификатор документа
    """
    title: str
    """
    Заголовок документа.
    """
    content: str
    """
    Текст контекнта.
    """


class RagDocumentsSchema(RequestResponseSchema):
    documents: Annotated[list[RagDocumentSchema], Field(default_factory=list)]


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
    auth_header: str | None = None
    tools: list[str] = Field(default_factory=list)

    retries: int = 3
    verify: bool = True

class McpConfigSchema(RequestResponseSchema):
    servers: list[McpServerSchema] = Field(default_factory=list)




class ServerEvent(RequestResponseSchema):
    type: Literal["token", "done", "error"]
    text: str | None = None
    code: str | None = None
    message: str | None = None

    @classmethod
    def token(cls, text: str) -> Self:
        return cls(type="token", text=text)

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
    agents: Annotated[list[AgentConfigSchema], Field(default_factory=list)]
    """
    Список агентов.
    """
    skills: Annotated[list[SkillConfigSchema], Field(default_factory=list)]
    """
    Спилы пользователя.
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
    messages: Annotated[list[BaseMessage], Field(default_factory=list)]
    tools: Annotated[list[StructuredTool], Field(default_factory=list)]
    response_text: str = ''
    


