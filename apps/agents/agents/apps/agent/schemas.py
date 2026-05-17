from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from fast_clean.schemas.request_response import RequestResponseSchema
from langchain_core.messages import BaseMessage
from pydantic import BaseModel, ConfigDict, Field

from agents.apps.agent.enums import (
    AgentMemoryScope,
    CriticVerdict,
    PlanStepStatus,
    RoutingKind,
)
from agents.apps.agent.enums_shared import ModelProviderEnum, RoleEnum
from agents.apps.processing.schemas import (
    EmbeddingProviderConfigSchema,
    ModelConnectionSchema as ModelConnectionSchema,
)


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
    transport: Literal['HTTP_JSONRPC', 'SSE'] = 'HTTP_JSONRPC'
    tools: list[str] = Field(default_factory=list)
    headers: dict[str, str] = Field(default_factory=dict)
    retries: int = 3
    verify: bool = True


class RagDocumentSchema(RequestResponseSchema):
    model_config = ConfigDict(populate_by_name=True)

    page_id: UUID
    workspace_id: UUID
    title: str
    page_type: str
    block_number: int
    content: str


class AgentContext(BaseModel):
    user_id: UUID
    workspace_id: UUID
    chat_id: UUID
    scopes: frozenset[str]
    allow_destructive: bool = False

    model_config = ConfigDict(frozen=True)


class PlanStep(BaseModel):
    id: str
    title: str
    status: PlanStepStatus = PlanStepStatus.PENDING
    result_summary: str | None = None


class MemoryItem(BaseModel):
    key: str
    content: str
    scope: AgentMemoryScope


class MemoryWrite(BaseModel):
    scope: AgentMemoryScope
    key: str
    content: str


class Citation(BaseModel):
    page_id: UUID
    workspace_id: UUID
    block_number: int
    title: str
    quote: str | None = None


class PendingConfirmation(BaseModel):
    confirmation_id: str
    tool: str
    args: dict[str, object]
    summary: str
    args_preview: dict[str, object]


class AgentRunRequest(BaseModel):
    chat_id: UUID
    user_message: str
    chat_history: Annotated[list[ConversationMessageSchema], Field(default_factory=list)]
    model_config_: ModelConfigSchema = Field(..., alias='model')
    embedding_config: EmbeddingProviderConfigSchema | None = None
    mcp_servers: Annotated[list[McpServerSchema], Field(default_factory=list)]
    agent_system_prompt: str | None = None
    long_term_memories: Annotated[list[MemoryItem], Field(default_factory=list)]
    allow_destructive: bool = False

    model_config = ConfigDict(populate_by_name=True)


class AgentResumeRequest(BaseModel):
    chat_id: UUID
    confirmation_id: str
    action: Literal['allow', 'deny']


class AgentState(BaseModel):
    # input snapshot
    context: AgentContext
    user_message: str
    chat_history: list[ConversationMessageSchema]
    model_config_: ModelConfigSchema = Field(..., alias='model')
    embedding_config: EmbeddingProviderConfigSchema | None = None
    mcp_servers: list[McpServerSchema]
    agent_system_prompt: str | None = None
    long_term_memories: list[MemoryItem] = []
    rag_documents: list[object] = []  # filled by planner

    # planning
    routing_kind: RoutingKind = RoutingKind.COMPLEX
    plan: list[PlanStep] = []
    current_step_id: str | None = None

    # execution
    messages: list[BaseMessage] = []
    tool_calls_made: int = 0
    last_critic_feedback: str | None = None
    revision_count: int = 0
    draft_answer: str = ''
    pending_memory_writes: list[MemoryWrite] = []
    pending_confirmations: dict[str, PendingConfirmation] = {}

    # output
    final_answer: str = ''
    critic_verdict: CriticVerdict | None = None
    critic_feedback: str | None = None
    citations: list[Citation] = []

    model_config = ConfigDict(populate_by_name=True, arbitrary_types_allowed=True)
