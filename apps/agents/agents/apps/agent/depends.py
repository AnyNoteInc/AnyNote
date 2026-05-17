from __future__ import annotations

import base64
import os
from collections.abc import AsyncIterator
from typing import Annotated

import jwt
from dishka import Provider, Scope, provide
from fast_clean.repositories import SettingsRepositoryProtocol
from fastapi import Header, HTTPException, status
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from agents.apps.agent.repositories import ActionLogRepository, AgentJinjaRenderer, MemoryWriterClient
from agents.apps.agent.repositories.mcp_client import McpClient
from agents.apps.agent.use_cases.resume_agent import ResumeAgentUseCase
from agents.apps.agent.use_cases.run_agent import RunAgentUseCase
from agents.apps.agent.repositories.model_factory import ModelFactoryRepository
from agents.apps.agent.services.rag_retrieval import RagRetrievalService
from agents.settings import SettingsSchema

from .errors import JwtVerificationError
from .schemas import AgentContext


def _audience() -> str:
    return os.environ.get('BETTER_AUTH_JWT_AGENTS_AUDIENCE', 'agents')


def _secret() -> bytes:
    raw = os.environ.get('AGENTS_JWT_SECRET')
    if not raw:
        raise JwtVerificationError('AGENTS_JWT_SECRET is not set')
    key = base64.b64decode(raw)
    if len(key) != 32:
        raise JwtVerificationError('AGENTS_JWT_SECRET must decode to 32 bytes')
    return key


def _decode(token: str) -> dict[str, object]:
    try:
        return jwt.decode(
            token,
            _secret(),
            algorithms=['HS256'],
            audience=_audience(),
        )
    except jwt.PyJWTError as exc:
        raise JwtVerificationError(str(exc)) from exc


def claims_to_context(claims: dict[str, object]) -> AgentContext:
    raw_scopes = claims.get('scopes', [])
    scopes: frozenset[str] = frozenset(s for s in (raw_scopes if isinstance(raw_scopes, list) else []) if isinstance(s, str))
    return AgentContext(
        user_id=claims['sub'],
        workspace_id=claims['wsid'],
        chat_id=claims['cid'],
        scopes=scopes,
    )


async def verify_agents_jwt(
    authorization: Annotated[str, Header()],
) -> AgentContext:
    """FastAPI dependency: verifies the agents JWT and returns the context."""
    scheme, _, token = authorization.partition(' ')
    if scheme.lower() != 'bearer' or not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='missing bearer token',
        )
    try:
        return claims_to_context(_decode(token))
    except JwtVerificationError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
        ) from exc


# Test seam — bypasses Header dependency for direct test calls.
async def verify_agents_jwt_for_test(token: str) -> AgentContext:
    return claims_to_context(_decode(token))


def _web_url() -> str:
    return os.environ.get('WEB_BASE_URL', 'http://localhost:3000')


class AgentProvider(Provider):
    scope = Scope.REQUEST

    @provide(scope=Scope.APP)
    async def jinja_renderer(self, settings_repo: SettingsRepositoryProtocol) -> AgentJinjaRenderer:
        settings = await settings_repo.get(SettingsSchema)
        return AgentJinjaRenderer(settings)

    @provide(scope=Scope.APP)
    def action_log_repo(self) -> ActionLogRepository:
        return ActionLogRepository(web_base_url=_web_url())

    @provide(scope=Scope.APP)
    def memory_writer_client(self) -> MemoryWriterClient:
        return MemoryWriterClient(web_base_url=_web_url())

    @provide(scope=Scope.APP)
    def mcp_client(self) -> McpClient:
        return McpClient()

    model_factory_repository = provide(ModelFactoryRepository, scope=Scope.APP)
    rag_retrieval_service = provide(RagRetrievalService)

    @provide(scope=Scope.APP)
    async def checkpointer(self, settings_repo: SettingsRepositoryProtocol) -> AsyncIterator[AsyncPostgresSaver]:
        settings = await settings_repo.get(SettingsSchema)
        # `settings.db.dsn` includes SQLAlchemy driver prefix (e.g. postgresql+psycopg_async://).
        # LangGraph's AsyncPostgresSaver wraps libpq directly and only accepts the raw
        # `postgresql://` form.
        db = settings.db
        conn = f'postgresql://{db.user}:{db.password}@{db.host}:{db.port}/{db.name}'
        async with AsyncPostgresSaver.from_conn_string(conn) as saver:
            await saver.setup()
            yield saver

    @provide
    def run_agent_use_case(
        self,
        mcp_client: McpClient,
        memory_writer_client: MemoryWriterClient,
        action_log_repo: ActionLogRepository,
        renderer: AgentJinjaRenderer,
        model_factory: ModelFactoryRepository,
        checkpointer: AsyncPostgresSaver,
        rag_service: RagRetrievalService,
    ) -> RunAgentUseCase:
        return RunAgentUseCase(
            llm_factory=model_factory.make,
            mcp_client=mcp_client,
            rag_service=rag_service,
            memory_writer_client=memory_writer_client,
            action_log_repo=action_log_repo,
            renderer=renderer,
            checkpointer=checkpointer,
        )

    @provide
    def resume_agent_use_case(
        self,
        checkpointer: AsyncPostgresSaver,
    ) -> ResumeAgentUseCase:
        from agents.apps.agent.services.graph import build_agent_graph

        def _build_graph() -> object:
            return build_agent_graph(checkpointer=checkpointer)

        return ResumeAgentUseCase(
            build_graph=_build_graph,
            run_streamer=lambda graph, config: None,  # unused; stream_graph called directly
        )


agent_provider = AgentProvider()
