from collections.abc import AsyncIterator

from dishka import Provider, Scope, provide
from fast_clean.repositories import SettingsRepositoryProtocol
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from agents.apps.agent.repositories import ActionLogRepository, AgentJinjaRenderer, MemoryWriterClient
from agents.apps.agent.repositories.mcp_client import McpClient
from agents.apps.agent.repositories.model_factory import ModelFactoryRepository
from agents.apps.agent.services.checkpoint_serde import build_checkpoint_serde
from agents.apps.agent.services.graph_streaming import GraphStreamingService
from agents.apps.agent.services.jwt_verifier import JwtVerifierService
from agents.apps.agent.services.rag_retrieval import RagRetrievalService
from agents.apps.agent.use_cases.resume_agent import ResumeAgentUseCase
from agents.apps.agent.use_cases.run_agent import RunAgentUseCase
from agents.apps.agent.use_cases.validate_provider import ValidateLlmUseCase, ValidateMcpUseCase
from agents.settings import SettingsSchema


class AgentProvider(Provider):
    scope = Scope.REQUEST

    @provide(scope=Scope.APP)
    async def jinja_renderer(self, settings_repo: SettingsRepositoryProtocol) -> AgentJinjaRenderer:
        settings = await settings_repo.get(SettingsSchema)
        return AgentJinjaRenderer(settings)

    @provide(scope=Scope.APP)
    async def jwt_verifier(self, settings_repo: SettingsRepositoryProtocol) -> JwtVerifierService:
        settings = await settings_repo.get(SettingsSchema)
        return JwtVerifierService(
            secret_b64=settings.agents_jwt_secret,
            audience=settings.better_auth_jwt_agents_audience,
        )

    @provide(scope=Scope.APP)
    async def action_log_repo(self, settings_repo: SettingsRepositoryProtocol) -> ActionLogRepository:
        settings = await settings_repo.get(SettingsSchema)
        return ActionLogRepository(web_base_url=settings.web_base_url)

    @provide(scope=Scope.APP)
    async def memory_writer_client(self, settings_repo: SettingsRepositoryProtocol) -> MemoryWriterClient:
        settings = await settings_repo.get(SettingsSchema)
        return MemoryWriterClient(web_base_url=settings.web_base_url)

    @provide(scope=Scope.APP)
    def mcp_client(self) -> McpClient:
        return McpClient()

    model_factory_repository = provide(ModelFactoryRepository, scope=Scope.APP)
    rag_retrieval_service = provide(RagRetrievalService)
    graph_streaming_service = provide(GraphStreamingService, scope=Scope.APP)
    validate_llm_use_case = provide(ValidateLlmUseCase)
    validate_mcp_use_case = provide(ValidateMcpUseCase)

    @provide(scope=Scope.APP)
    async def checkpointer(self, settings_repo: SettingsRepositoryProtocol) -> AsyncIterator[AsyncPostgresSaver]:
        settings = await settings_repo.get(SettingsSchema)
        # `settings.db.dsn` includes SQLAlchemy driver prefix (e.g. postgresql+psycopg_async://).
        # LangGraph's AsyncPostgresSaver wraps libpq directly and only accepts the raw
        # `postgresql://` form.
        db = settings.db
        conn = f'postgresql://{db.user}:{db.password}@{db.host}:{db.port}/{db.name}'
        async with AsyncPostgresSaver.from_conn_string(conn, serde=build_checkpoint_serde()) as saver:
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
        streaming_service: GraphStreamingService,
    ) -> RunAgentUseCase:
        return RunAgentUseCase(
            llm_factory=model_factory.make,
            mcp_client=mcp_client,
            rag_service=rag_service,
            memory_writer_client=memory_writer_client,
            action_log_repo=action_log_repo,
            renderer=renderer,
            checkpointer=checkpointer,
            streaming_service=streaming_service,
        )

    @provide
    def resume_agent_use_case(
        self,
        mcp_client: McpClient,
        memory_writer_client: MemoryWriterClient,
        action_log_repo: ActionLogRepository,
        renderer: AgentJinjaRenderer,
        model_factory: ModelFactoryRepository,
        checkpointer: AsyncPostgresSaver,
        rag_service: RagRetrievalService,
        streaming_service: GraphStreamingService,
    ) -> ResumeAgentUseCase:
        return ResumeAgentUseCase(
            llm_factory=model_factory.make,
            mcp_client=mcp_client,
            rag_service=rag_service,
            memory_writer_client=memory_writer_client,
            action_log_repo=action_log_repo,
            renderer=renderer,
            checkpointer=checkpointer,
            streaming_service=streaming_service,
        )


agent_provider = AgentProvider()
