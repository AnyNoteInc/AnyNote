from typing import Annotated, Any, Literal, Self
from uuid import UUID

from fast_clean.schemas.request_response import RequestResponseSchema
from langchain_core.messages import BaseMessage
from pydantic import BaseModel, ConfigDict, Field

from agents.apps.agent.enums import (
    AgentMemoryScope,
    CriticVerdict,
    ModelProviderEnum,
    PlanStepStatus,
    RoleEnum,
    RoutingKind,
)
from agents.apps.processing.schemas import (
    EmbeddingProviderConfigSchema,
)
from agents.apps.processing.schemas import (
    ModelConnectionSchema as ModelConnectionSchema,
)


class ModelSettingsSchema(RequestResponseSchema):
    # LangGraph checkpoint dumps with field names (top_p), so accept both
    # field names and camelCase aliases when re-validating.
    model_config = ConfigDict(populate_by_name=True)

    temperature: float | None = None
    top_p: float | None = None


class ModelConfigSchema(RequestResponseSchema):
    model_config = ConfigDict(populate_by_name=True)

    provider: ModelProviderEnum
    name: str
    connection: ModelConnectionSchema = Field(default_factory=ModelConnectionSchema)
    settings: ModelSettingsSchema = Field(default_factory=ModelSettingsSchema)


class ReasoningConfigSchema(RequestResponseSchema):
    model_config = ConfigDict(populate_by_name=True)

    enabled: bool = False
    effort: Literal['low', 'medium', 'high'] = 'medium'


class ConversationMessageSchema(RequestResponseSchema):
    role: RoleEnum
    content: str


class McpServerSchema(RequestResponseSchema):
    model_config = ConfigDict(populate_by_name=True)

    name: str
    description: str = ''
    url: str
    transport: Literal['HTTP_JSONRPC', 'SSE', 'STREAMABLE_HTTP'] = 'HTTP_JSONRPC'
    tools: list[str] = Field(default_factory=list)
    headers: dict[str, str] = Field(default_factory=dict)
    retries: int = 3
    verify: bool = True
    workspace_id: str | None = None


class AttachmentSchema(RequestResponseSchema):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    name: str
    mime: str
    size_bytes: int
    included: bool
    content: str | None = None


class LlmValidationResponseSchema(RequestResponseSchema):
    ok: bool
    error: str | None = None


class McpValidationResponseSchema(RequestResponseSchema):
    ok: bool
    tools: list[str] = Field(default_factory=list)
    error: str | None = None


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


class PlanStepSchema(BaseModel):
    id: str
    title: str
    status: PlanStepStatus = PlanStepStatus.PENDING
    result_summary: str | None = None


class MemoryItemSchema(BaseModel):
    key: str
    content: str
    scope: AgentMemoryScope


class MemoryWriteSchema(BaseModel):
    scope: AgentMemoryScope
    key: str
    content: str


class CitationSchema(BaseModel):
    page_id: UUID
    workspace_id: UUID
    block_number: int
    title: str
    quote: str | None = None


class PendingConfirmationSchema(BaseModel):
    confirmation_id: str
    tool: str
    args: dict[str, object]
    summary: str
    args_preview: dict[str, object]


class AgentRunRequestSchema(BaseModel):
    chat_id: UUID
    user_message: str
    chat_history: Annotated[list[ConversationMessageSchema], Field(default_factory=list)]
    model_config_: ModelConfigSchema = Field(..., alias='model')
    embedding_config: EmbeddingProviderConfigSchema | None = None
    mcp_servers: Annotated[list[McpServerSchema], Field(default_factory=list)]
    agent_system_prompt: str | None = None
    long_term_memories: Annotated[list[MemoryItemSchema], Field(default_factory=list)]
    allow_destructive: bool = False
    attachments: Annotated[list[AttachmentSchema], Field(default_factory=list)]
    reasoning: ReasoningConfigSchema = Field(default_factory=ReasoningConfigSchema)

    model_config = ConfigDict(populate_by_name=True)


class AgentResumeRequestSchema(BaseModel):
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
    long_term_memories: list[MemoryItemSchema] = []
    attachments: list[AttachmentSchema] = []
    rag_documents: list[object] = []  # filled by planner

    # planning
    routing_kind: RoutingKind = RoutingKind.COMPLEX
    plan: list[PlanStepSchema] = []
    current_step_id: str | None = None

    # execution
    messages: list[BaseMessage] = []
    tool_calls_made: int = 0
    pending_tool_calls: list[dict[str, Any]] = []
    last_critic_feedback: str | None = None
    revision_count: int = 0
    draft_answer: str = ''
    pending_memory_writes: list[MemoryWriteSchema] = []
    pending_confirmations: dict[str, PendingConfirmationSchema] = {}

    # output
    final_answer: str = ''
    critic_verdict: CriticVerdict | None = None
    critic_feedback: str | None = None
    citations: list[CitationSchema] = []

    model_config = ConfigDict(populate_by_name=True, arbitrary_types_allowed=True)


EventType = Literal[
    'router_decision', 'plan_step', 'step_started', 'step_completed',
    'token', 'tool_status', 'confirmation_required',
    'memory_write_proposed', 'critic_verdict', 'citation',
    'usage', 'done', 'error',
]


class ServerEventSchema(BaseModel):
    type: EventType
    # union fields — only the subset for the given type is non-null
    text: str | None = None
    step_id: str | None = None
    id: str | None = None
    title: str | None = None
    position: int | None = None
    status: Literal['pending', 'running', 'done', 'failed', 'skipped'] | None = None
    tool: str | None = None
    state: Literal['running', 'done', 'error'] | None = None
    detail: str | None = None
    duration_ms: int | None = None
    confirmation_id: str | None = None
    summary: str | None = None
    args_preview: dict[str, Any] | None = None
    scope: Literal['workspace', 'user'] | None = None
    key: str | None = None
    content_preview: str | None = None
    verdict: Literal['approve', 'revise', 'reject'] | None = None
    feedback: str | None = None
    revision_count: int | None = None
    page_id: UUID | None = None
    workspace_id: UUID | None = None
    block_number: int | None = None
    quote: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    cost_usd: float | None = None
    code: str | None = None
    message: str | None = None
    recoverable: bool | None = None
    kind: Literal['trivial', 'complex'] | None = None
    reason: str | None = None
    result_summary: str | None = None

    @classmethod
    def token(cls, text: str, step_id: str | None = None) -> Self:
        return cls(type='token', text=text, step_id=step_id)

    @classmethod
    def router_decision(cls, kind: Literal['trivial', 'complex'], reason: str) -> Self:
        return cls(type='router_decision', kind=kind, reason=reason)

    @classmethod
    def plan_step(
        cls,
        id: str,
        title: str,
        position: int,
        status: Literal['pending', 'running', 'done', 'failed', 'skipped'],
    ) -> Self:
        return cls(type='plan_step', id=id, title=title, position=position, status=status)

    @classmethod
    def step_started(cls, step_id: str) -> Self:
        return cls(type='step_started', step_id=step_id)

    @classmethod
    def step_completed(cls, step_id: str, result_summary: str) -> Self:
        return cls(type='step_completed', step_id=step_id, result_summary=result_summary)

    @classmethod
    def tool_status(
        cls,
        id: str,
        tool: str,
        state: Literal['running', 'done', 'error'],
        title: str,
        detail: str | None = None,
        duration_ms: int | None = None,
    ) -> Self:
        return cls(type='tool_status', id=id, tool=tool, state=state, title=title,
                   detail=detail, duration_ms=duration_ms)

    @classmethod
    def confirmation_required(
        cls,
        confirmation_id: str,
        tool: str,
        summary: str,
        args_preview: dict[str, Any],
    ) -> Self:
        return cls(type='confirmation_required', confirmation_id=confirmation_id,
                   tool=tool, summary=summary, args_preview=args_preview)

    @classmethod
    def memory_write_proposed(
        cls,
        scope: Literal['workspace', 'user'],
        key: str,
        content_preview: str,
    ) -> Self:
        return cls(type='memory_write_proposed', scope=scope, key=key,
                   content_preview=content_preview)

    @classmethod
    def critic_verdict(
        cls,
        verdict: Literal['approve', 'revise', 'reject'],
        feedback: str,
        revision_count: int,
    ) -> Self:
        return cls(type='critic_verdict', verdict=verdict, feedback=feedback,
                   revision_count=revision_count)

    @classmethod
    def citation(
        cls,
        page_id: UUID,
        workspace_id: UUID,
        block_number: int,
        title: str,
        quote: str | None = None,
    ) -> Self:
        return cls(type='citation', page_id=page_id, workspace_id=workspace_id,
                   block_number=block_number, title=title, quote=quote)

    @classmethod
    def usage(
        cls,
        prompt_tokens: int,
        completion_tokens: int,
        total_tokens: int,
        cost_usd: float | None = None,
    ) -> Self:
        return cls(type='usage', prompt_tokens=prompt_tokens,
                   completion_tokens=completion_tokens,
                   total_tokens=total_tokens, cost_usd=cost_usd)

    @classmethod
    def done(cls) -> Self:
        return cls(type='done')

    @classmethod
    def error(cls, code: str, message: str, recoverable: bool = False) -> Self:
        return cls(type='error', code=code, message=message, recoverable=recoverable)
