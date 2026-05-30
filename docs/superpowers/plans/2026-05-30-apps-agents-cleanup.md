# apps/agents Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply ten structural cleanup rules to `apps/agents` with zero behavior change, ending fully green (ruff clean, 0 mypy errors, tests pass).

**Architecture:** Python 3.13 / FastAPI / LangGraph / Dishka / fast_clean. Layered per app: `repositories` (I/O), `services` (logic), `use_cases` (orchestration), `depends.py` (the dishka `Provider` only — fast_clean auto-discovers `Provider` instances in modules named `depends`). Presentation = `router.py` + a new `guards.py`.

**Tech Stack:** mypy `strict=true` (py3.12 target, `pydantic.mypy` plugin) is the primary safety net; ruff (`E,F,W,I,N,B,UP,ASYNC,RUF`); pytest (`asyncio_mode=auto`).

**Spec:** `docs/superpowers/specs/2026-05-30-apps-agents-cleanup-design.md`

---

## Conventions for every task

All commands run from `apps/agents/`. The standing verification triplet (referred to as **VERIFY** below) is:

```bash
uv run ruff check agents tests
uv run mypy agents tests
uv run pytest -m 'not integration' -q
```

**Expected at VERIFY (Tasks 1–7):**
- ruff: `All checks passed!`
- mypy: **exactly 1 error**, the pre-existing `agents/apps/agent/repositories/mcp_client.py:98 ... [valid-type]`, and **no others**. (Fixed in Task 8 → 0.)
- pytest: all pass **except** the single known environmental failure `tests/apps/search/test_router.py::test_search_returns_rag_results` (needs a live, version-matched Qdrant). If any *other* test fails, the task broke something.

If `ruff check` reports import-ordering (`I001`) after a rename sweep, run `uv run ruff check --fix agents tests` (it consolidates duplicate `from X import ...` lines) then re-run the triplet.

---

## Task 1: Add settings fields (Rule 7 groundwork)

**Files:**
- Modify: `agents/settings.py`

- [ ] **Step 1: Add the three env-backed fields**

Replace the body of `agents/settings.py` with:

```python
from typing import Annotated

from fast_clean.settings import (
    CoreDbSettingsSchema,
    CoreServiceSettingsSchema,
    CoreSettingsSchema,
)
from pydantic import Field


class SettingsSchema(CoreSettingsSchema):
    cors_origins: Annotated[list[str], Field(default_factory=list)]
    db: CoreDbSettingsSchema
    qdrant: CoreServiceSettingsSchema
    agents_jwt_secret: str | None = None
    better_auth_jwt_agents_audience: str = 'agents'
    web_base_url: str = 'http://localhost:3000'


settings = SettingsSchema()  # pyright: ignore[reportCallIssue]  # all fields populated from env
```

(Field names map case-insensitively to `AGENTS_JWT_SECRET`, `BETTER_AUTH_JWT_AGENTS_AUDIENCE`, `WEB_BASE_URL`, which already exist in `apps/agents/.env`. No consumers yet — this is groundwork for Task 4.)

- [ ] **Step 2: VERIFY** (see triplet above)

- [ ] **Step 3: Commit**

```bash
git add agents/settings.py
git commit -m "refactor(agents): add jwt/web settings fields (rule 7 groundwork)"
```

---

## Task 2: Merge `enums_shared` + `errors_shared` (Rule 2)

**Files:**
- Modify: `agents/apps/agent/enums.py`, `agents/apps/agent/errors.py`
- Delete: `agents/apps/agent/enums_shared.py`, `agents/apps/agent/errors_shared.py`
- Sweep imports across importers + `services/checkpoint_serde.py`

- [ ] **Step 1: Rewrite `agents/apps/agent/enums.py`** (append the two moved enums; add `auto` import)

```python
from enum import StrEnum, auto


class PlanStepStatus(StrEnum):
    PENDING = 'pending'
    RUNNING = 'running'
    DONE = 'done'
    FAILED = 'failed'
    SKIPPED = 'skipped'


class CriticVerdict(StrEnum):
    APPROVE = 'approve'
    REVISE = 'revise'
    REJECT = 'reject'


class RoutingKind(StrEnum):
    TRIVIAL = 'trivial'
    COMPLEX = 'complex'


class AgentMemoryScope(StrEnum):
    WORKSPACE = 'workspace'
    USER = 'user'


class ModelProviderEnum(StrEnum):
    OLLAMA = auto()
    OPENAI = auto()
    GIGACHAT = auto()
    YANDEXGPT = auto()
    ANTHROPIC = auto()
    DEEPSEEK = auto()


class RoleEnum(StrEnum):
    USER = auto()
    ASSISTANT = auto()
```

- [ ] **Step 2: Rewrite `agents/apps/agent/errors.py`** (append the four moved errors; quote the `McpServerSchema` annotation so no `from __future__` is needed)

```python
from typing import TYPE_CHECKING

from fast_clean.exceptions import BusinessLogicException

if TYPE_CHECKING:
    from agents.apps.agent.schemas import McpServerSchema


class AgentError(Exception):
    """Base error for the agent module."""


class JwtVerificationError(AgentError):
    code = 'JWT_INVALID'


class ScopeDeniedError(AgentError):
    code = 'SCOPE_DENIED'


class McpServerUnreachable(AgentError):
    code = 'MCP_UNREACHABLE'


class ConfirmationMismatch(AgentError):
    code = 'CONFIRMATION_MISMATCH'


class PlanLimitReached(AgentError):
    code = 'PLAN_LIMIT'


class InvalidPayloadError(BusinessLogicException):
    def __init__(self, message: str) -> None:
        self.code = 'INVALID_PAYLOAD'
        self.raw_message = message

    @property
    def message(self) -> str:
        return f'Invalid payload: {self.raw_message}, code: {self.code}'


class ProviderError(BusinessLogicException):
    def __init__(self, message: str, code: str = 'PROVIDER_ERROR') -> None:
        self.code = code
        self.raw_message = message

    @property
    def message(self) -> str:
        return f'Provider error: {self.raw_message}, code: {self.code}'


class UnauthorizedError(BusinessLogicException):
    def __init__(self) -> None:
        self.code = 'UNAUTHORIZED'
        self.raw_message = 'Invalid bearer token'

    @property
    def message(self) -> str:
        return f'Unauthorized: {self.raw_message}, code: {self.code}'


class McpRequestError(BusinessLogicException):
    def __init__(self, server: 'McpServerSchema', error: dict[str, object]) -> None:
        self.server = server
        self.error = error

    @property
    def message(self) -> str:
        return f'Error from MCP server {self.server.name} at {self.server.url}: {self.error}'
```

- [ ] **Step 3: Point importers at the merged modules** (substring sweep; `enums_shared`→`enums`, `errors_shared`→`errors` — also fixes the `'agents.apps.agent.enums_shared'` string in `checkpoint_serde.py`)

```bash
perl -pi -e 's/enums_shared/enums/g'   $(grep -rl 'enums_shared'  agents tests --include='*.py')
perl -pi -e 's/errors_shared/errors/g' $(grep -rl 'errors_shared' agents tests --include='*.py')
```

- [ ] **Step 4: Delete the merged-away files**

```bash
git rm agents/apps/agent/enums_shared.py agents/apps/agent/errors_shared.py
```

- [ ] **Step 5: Consolidate any now-duplicated imports**

```bash
uv run ruff check --fix agents tests
```

- [ ] **Step 6: VERIFY**

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(agents): merge enums_shared/errors_shared into enums/errors (rule 2)"
```

---

## Task 3: `Schema` suffix on transport DTOs + fold `events.py` into `schemas.py` (Rule 3)

**Files:**
- Modify: `agents/apps/agent/schemas.py` (append `ServerEventSchema`; in-place renames)
- Delete: `agents/apps/agent/events.py`
- Sweep renames across `agents/` + `tests/`
- Touches (via sweep): `router.py`, `use_cases/run_agent.py`, `use_cases/resume_agent.py`, `use_cases/_streaming.py`, `use_cases/validate_provider.py`, `validation/router.py`, `processing/schemas.py`, `processing/use_cases/validate_embedding.py`, `services/checkpoint_serde.py`, tests

- [ ] **Step 1: Append `EventType` + `ServerEventSchema` to `schemas.py`** and add `Self` to the typing import.

Change the typing import line in `agents/apps/agent/schemas.py`:

```python
from typing import Annotated, Any, Literal
```
to:
```python
from typing import Annotated, Any, Literal, Self
```

Then append at the end of `agents/apps/agent/schemas.py` (this is the old `events.py` content, class renamed to `ServerEventSchema`):

```python
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
```

- [ ] **Step 2: Rename `ServerEvent`→`ServerEventSchema` everywhere, then fix the import module path**

```bash
perl -pi -e 's/\bServerEvent\b/ServerEventSchema/g' $(grep -rlw 'ServerEvent' agents tests --include='*.py')
perl -pi -e 's/from agents\.apps\.agent\.events import/from agents.apps.agent.schemas import/g; s/from \.events import/from .schemas import/g' $(grep -rl '\.events import' agents tests --include='*.py')
```

- [ ] **Step 3: Delete `events.py`**

```bash
git rm agents/apps/agent/events.py
```

- [ ] **Step 4: Rename the remaining transport DTOs** (word-boundary safe — `\bPlanStep\b` leaves `PlanStepStatus` and `\bMemoryWrite\b` leaves `MemoryWriterClient` untouched; these sweeps also update the matching qualname strings in `checkpoint_serde.py` automatically)

```bash
for sym in AgentRunRequest AgentResumeRequest LlmValidationResponse McpValidationResponse \
           PlanStep MemoryItem MemoryWrite Citation PendingConfirmation \
           EmbeddingValidationRequest EmbeddingValidationResponse; do
  files=$(grep -rlw "$sym" agents tests --include='*.py')
  [ -n "$files" ] && perl -pi -e "s/\\b${sym}\\b/${sym}Schema/g" $files
done
```

- [ ] **Step 5: Sanity-check `checkpoint_serde.py`** — confirm the allowlist now reads `CitationSchema`, `MemoryItemSchema`, `MemoryWriteSchema`, `PendingConfirmationSchema`, `PlanStepSchema`, that `AgentState`/`AgentContext`/`ConversationMessageSchema`/`McpServerSchema`/`ModelConfigSchema`/`ModelSettingsSchema` are unchanged, and that `PlanStepStatus` (enum) was NOT renamed:

```bash
grep -nE "PlanStep|Citation|Memory|Pending|AgentState|AgentContext" agents/apps/agent/services/checkpoint_serde.py
```
Expected: `('agents.apps.agent.enums', 'PlanStepStatus')` intact; the five embedded models carry `Schema`.

- [ ] **Step 6: Consolidate imports, then VERIFY**

```bash
uv run ruff check --fix agents tests
```
Then run the VERIFY triplet.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(agents): suffix transport DTOs with Schema, fold events into schemas (rule 3)"
```

---

## Task 4: Extract JWT into a service + presentation guards + utils; clean `depends.py` (Rules 4, 5, 6, 7)

**Files:**
- Create: `agents/apps/agent/utils.py`, `agents/apps/agent/services/jwt_verifier.py`, `agents/apps/agent/guards.py`
- Modify: `agents/apps/agent/depends.py`, `agents/apps/agent/router.py`, `agents/apps/validation/router.py`
- Rewrite tests: `tests/apps/agent/test_jwt_verify.py`, `tests/apps/agent/test_verify_service_token.py`

- [ ] **Step 1: Create `agents/apps/agent/utils.py`**

```python
def extract_bearer_token(authorization: str) -> str | None:
    """Return the token from an ``Authorization: Bearer <token>`` header, or None
    if the scheme is not bearer / the token is empty."""
    scheme, _, token = authorization.partition(' ')
    if scheme.lower() != 'bearer' or not token:
        return None
    return token
```

- [ ] **Step 2: Create `agents/apps/agent/services/jwt_verifier.py`**

```python
import base64

import jwt

from agents.apps.agent.errors import JwtVerificationError
from agents.apps.agent.schemas import AgentContext


class JwtVerifierService:
    """Verifies HS256 agents JWTs. Secret + audience come from settings."""

    def __init__(self, secret_b64: str | None, audience: str) -> None:
        self._secret_b64 = secret_b64
        self._audience = audience

    def verify_chat(self, token: str) -> AgentContext:
        """Full chat-token verification → AgentContext (sub/wsid/cid/scopes)."""
        return self._context_from_claims(self._decode(token))

    def verify_service(self, token: str) -> None:
        """Internal service token: signature + audience only (no cid/scopes)."""
        self._decode(token)

    def _secret(self) -> bytes:
        if not self._secret_b64:
            raise JwtVerificationError('AGENTS_JWT_SECRET is not set')
        key = base64.b64decode(self._secret_b64)
        if len(key) != 32:
            raise JwtVerificationError('AGENTS_JWT_SECRET must decode to 32 bytes')
        return key

    def _decode(self, token: str) -> dict[str, object]:
        try:
            return jwt.decode(
                token,
                self._secret(),
                algorithms=['HS256'],
                audience=self._audience,
            )
        except jwt.PyJWTError as exc:
            raise JwtVerificationError(str(exc)) from exc

    def _context_from_claims(self, claims: dict[str, object]) -> AgentContext:
        raw_scopes = claims.get('scopes', [])
        scopes: frozenset[str] = frozenset(
            s for s in (raw_scopes if isinstance(raw_scopes, list) else []) if isinstance(s, str)
        )
        return AgentContext(
            user_id=claims['sub'],
            workspace_id=claims['wsid'],
            chat_id=claims['cid'],
            scopes=scopes,
        )
```

- [ ] **Step 3: Create `agents/apps/agent/guards.py`** (presentation seam; maps `JwtVerificationError` → HTTP 401, since fast_clean has no 401 handler)

```python
from typing import Annotated

from dishka import AsyncContainer
from fastapi import Header, HTTPException, Request, status

from agents.apps.agent.errors import JwtVerificationError
from agents.apps.agent.schemas import AgentContext
from agents.apps.agent.services.jwt_verifier import JwtVerifierService
from agents.apps.agent.utils import extract_bearer_token


async def _verifier(request: Request) -> JwtVerifierService:
    container: AsyncContainer = request.state.dishka_container
    return await container.get(JwtVerifierService)


def _require_token(authorization: str) -> str:
    token = extract_bearer_token(authorization)
    if token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail='missing bearer token',
        )
    return token


async def verify_agents_jwt(
    authorization: Annotated[str, Header()],
    request: Request,
) -> AgentContext:
    """FastAPI dependency: verifies the agents JWT and returns the context."""
    token = _require_token(authorization)
    verifier = await _verifier(request)
    try:
        return verifier.verify_chat(token)
    except JwtVerificationError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
        ) from exc


async def verify_agents_service_token(
    authorization: Annotated[str, Header()],
    request: Request,
) -> None:
    """FastAPI dependency for internal service calls: signature+audience only."""
    token = _require_token(authorization)
    verifier = await _verifier(request)
    try:
        verifier.verify_service(token)
    except JwtVerificationError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
        ) from exc
```

- [ ] **Step 4: Rewrite `agents/apps/agent/depends.py`** (only the dishka Provider remains; JWT funcs + `_web_url` gone; `web_base_url` from settings; JWT verifier provided)

```python
from collections.abc import AsyncIterator

from dishka import Provider, Scope, provide
from fast_clean.repositories import SettingsRepositoryProtocol
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from agents.apps.agent.repositories import ActionLogRepository, AgentJinjaRenderer, MemoryWriterClient
from agents.apps.agent.repositories.mcp_client import McpClient
from agents.apps.agent.repositories.model_factory import ModelFactoryRepository
from agents.apps.agent.services.checkpoint_serde import build_checkpoint_serde
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
        mcp_client: McpClient,
        memory_writer_client: MemoryWriterClient,
        action_log_repo: ActionLogRepository,
        renderer: AgentJinjaRenderer,
        model_factory: ModelFactoryRepository,
        checkpointer: AsyncPostgresSaver,
        rag_service: RagRetrievalService,
    ) -> ResumeAgentUseCase:
        return ResumeAgentUseCase(
            llm_factory=model_factory.make,
            mcp_client=mcp_client,
            rag_service=rag_service,
            memory_writer_client=memory_writer_client,
            action_log_repo=action_log_repo,
            renderer=renderer,
            checkpointer=checkpointer,
        )


agent_provider = AgentProvider()
```

(Note: `run_agent_use_case`/`resume_agent_use_case` get their `streaming_service` argument in Task 5 — leave them as above for now.)

- [ ] **Step 5: Repoint the guard import in `agents/apps/agent/router.py`**

Change:
```python
from .depends import verify_agents_jwt
```
to:
```python
from .guards import verify_agents_jwt
from .utils import extract_bearer_token
```

And in **both** the `run` and `resume` handlers replace:
```python
    jwt_token = authorization.split(' ', 1)[1]
```
with:
```python
    jwt_token = extract_bearer_token(authorization) or ''
```

- [ ] **Step 6: Repoint the guard import in `agents/apps/validation/router.py`**

Change:
```python
from agents.apps.agent.depends import verify_agents_service_token
```
to:
```python
from agents.apps.agent.guards import verify_agents_service_token
```

- [ ] **Step 7: Rewrite `tests/apps/agent/test_jwt_verify.py`** onto the service

```python
import base64
import os
import secrets
import time
from uuid import uuid4

import jwt
import pytest
from agents.apps.agent.errors import JwtVerificationError
from agents.apps.agent.services.jwt_verifier import JwtVerifierService


@pytest.fixture(autouse=True)
def setup_env(monkeypatch):
    raw_key = secrets.token_bytes(32)
    monkeypatch.setenv('AGENTS_JWT_SECRET', base64.b64encode(raw_key).decode())
    monkeypatch.setenv('BETTER_AUTH_JWT_AGENTS_AUDIENCE', 'agents')


def _verifier(*, secret_b64: str | None = None, audience: str = 'agents') -> JwtVerifierService:
    return JwtVerifierService(secret_b64=secret_b64 or os.environ['AGENTS_JWT_SECRET'], audience=audience)


def sign(claims: dict, *, aud: str = 'agents', ttl: int = 300, secret_b64: str | None = None) -> str:
    secret_b64 = secret_b64 or os.environ['AGENTS_JWT_SECRET']
    key = base64.b64decode(secret_b64)
    payload = {
        'iat': int(time.time()),
        'exp': int(time.time()) + ttl,
        'aud': aud,
        **claims,
    }
    return jwt.encode(payload, key, algorithm='HS256')


def test_accepts_valid_token() -> None:
    user_id, ws_id, chat_id = str(uuid4()), str(uuid4()), str(uuid4())
    token = sign({
        'sub': user_id,
        'wsid': ws_id,
        'cid': chat_id,
        'scopes': ['pages:read'],
    })
    ctx = _verifier().verify_chat(token)
    assert str(ctx.user_id) == user_id
    assert str(ctx.workspace_id) == ws_id
    assert str(ctx.chat_id) == chat_id
    assert ctx.scopes == frozenset({'pages:read'})


def test_rejects_expired() -> None:
    token = sign(
        {'sub': str(uuid4()), 'wsid': str(uuid4()), 'cid': str(uuid4()), 'scopes': []},
        ttl=-100,
    )
    with pytest.raises(JwtVerificationError):
        _verifier().verify_chat(token)


def test_rejects_wrong_audience() -> None:
    token = sign(
        {'sub': str(uuid4()), 'wsid': str(uuid4()), 'cid': str(uuid4()), 'scopes': []},
        aud='wrong',
    )
    with pytest.raises(JwtVerificationError):
        _verifier().verify_chat(token)
```

- [ ] **Step 8: Rewrite `tests/apps/agent/test_verify_service_token.py`** — service + util cover the verification matrix; one async guard test preserves the HTTP 401 contract via a fake request/container (`asyncio_mode=auto`, so no decorator needed; the agent-tests mypy override disables `arg-type`)

```python
import base64
import os
import time

import jwt
import pytest
from agents.apps.agent.errors import JwtVerificationError
from agents.apps.agent.guards import verify_agents_service_token
from agents.apps.agent.services.jwt_verifier import JwtVerifierService
from agents.apps.agent.utils import extract_bearer_token
from fastapi import HTTPException

# Ensure AGENTS_JWT_SECRET is available even if .env wasn't loaded
os.environ.setdefault('AGENTS_JWT_SECRET', base64.b64encode(b'0' * 32).decode())


def _verifier() -> JwtVerifierService:
    return JwtVerifierService(
        secret_b64=os.environ['AGENTS_JWT_SECRET'],
        audience=os.environ.get('BETTER_AUTH_JWT_AGENTS_AUDIENCE', 'agents'),
    )


def _make_token(**overrides) -> str:
    secret = base64.b64decode(os.environ['AGENTS_JWT_SECRET'])
    claims = {
        'sub': 'u1',
        'wsid': 'w1',
        'aud': os.environ.get('BETTER_AUTH_JWT_AGENTS_AUDIENCE', 'agents'),
        'exp': int(time.time()) + 60,
    }
    claims.update(overrides)
    return jwt.encode(claims, secret, algorithm='HS256')


class _FakeContainer:
    def __init__(self, verifier: JwtVerifierService) -> None:
        self._verifier = verifier

    async def get(self, dependency_type):
        return self._verifier


class _FakeRequest:
    def __init__(self, verifier: JwtVerifierService) -> None:
        self.state = type('S', (), {'dishka_container': _FakeContainer(verifier)})()


# --- service: verification matrix ---

def test_service_accepts_valid_token() -> None:
    _verifier().verify_service(_make_token())  # no raise


def test_service_rejects_bad_signature() -> None:
    with pytest.raises(JwtVerificationError):
        _verifier().verify_service('not.a.jwt')


def test_service_rejects_wrong_audience() -> None:
    with pytest.raises(JwtVerificationError):
        _verifier().verify_service(_make_token(aud='not-agents'))


def test_service_rejects_expired_token() -> None:
    with pytest.raises(JwtVerificationError):
        _verifier().verify_service(_make_token(exp=int(time.time()) - 10))


# --- util: bearer parsing ---

def test_extract_bearer_token() -> None:
    assert extract_bearer_token(f'Bearer {_make_token()}') is not None
    assert extract_bearer_token('') is None
    assert extract_bearer_token('Basic abc') is None


# --- guard: HTTP 401 contract preserved ---

async def test_guard_rejects_missing_token() -> None:
    with pytest.raises(HTTPException) as ei:
        await verify_agents_service_token('', _FakeRequest(_verifier()))
    assert ei.value.status_code == 401


async def test_guard_rejects_bad_token() -> None:
    with pytest.raises(HTTPException) as ei:
        await verify_agents_service_token('Bearer not.a.jwt', _FakeRequest(_verifier()))
    assert ei.value.status_code == 401


async def test_guard_accepts_valid_token() -> None:
    result = await verify_agents_service_token(f'Bearer {_make_token()}', _FakeRequest(_verifier()))
    assert result is None
```

- [ ] **Step 9: VERIFY**

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor(agents): extract JwtVerifierService + guards + utils, clean depends (rules 4-7)"
```

---

## Task 5: Extract `GraphStreamingService`, inject into use cases (Rule 9)

**Files:**
- Create: `agents/apps/agent/services/graph_streaming.py`
- Delete: `agents/apps/agent/use_cases/_streaming.py`
- Modify: `agents/apps/agent/use_cases/run_agent.py`, `agents/apps/agent/use_cases/resume_agent.py`, `agents/apps/agent/depends.py`

- [ ] **Step 1: Create `agents/apps/agent/services/graph_streaming.py`** (the old `_streaming.py` body as a class; free helpers → methods; `ServerEvent`→`ServerEventSchema`; imports from `schemas`)

```python
"""Streams ServerEventSchema items from a compiled LangGraph graph.

LangGraph 1.1.x astream with stream_mode=['values', 'updates'] yields tuples
of (mode, data). Values mode emits the full state dict; updates mode emits
{node_name: delta_dict}.
"""

from collections.abc import AsyncIterator
from typing import Any

from langchain_core.runnables import RunnableConfig

from agents.apps.agent.schemas import AgentState, ServerEventSchema


class _Done:
    """Sentinel yielded by _process_updates_chunk to stop the outer stream."""


class GraphStreamingService:
    async def stream(
        self,
        graph: Any,
        input: Any,
        config: RunnableConfig,
        initial_state: AgentState,
    ) -> AsyncIterator[ServerEventSchema]:
        """Stream ServerEventSchema items from a compiled LangGraph graph.

        Handles both initial runs (input=AgentState) and resume runs
        (input=Command). Emits router_decision on router node updates,
        plan_step events on new plan entries, critic_verdict on critic updates,
        confirmation_required on interrupts, and final token/citation events.
        """
        # Track each plan step we've emitted by (id -> last status) so we can
        # re-emit plan_step events when status changes (PENDING -> RUNNING -> DONE).
        last_plan_states: dict[str, str] = {}

        async for chunk in graph.astream(input, config, stream_mode=['values', 'updates']):
            mode, data = chunk
            if mode == 'values':
                events, last_plan_states = self._process_values_chunk(data, last_plan_states)
                for ev in events:
                    yield ev
                continue
            done = False
            async for ev in self._process_updates_chunk(data, initial_state):
                if isinstance(ev, _Done):
                    done = True
                    break
                yield ev
            if done:
                return

        async for ev in self._yield_final_events(graph, config):
            yield ev

    def _process_values_chunk(
        self,
        data: Any,
        last_plan_states: dict[str, str],
    ) -> tuple[list[ServerEventSchema], dict[str, str]]:
        try:
            state = AgentState.model_validate(data)
        except Exception:
            # values-mode for intermediate states can carry non-state shapes
            # (e.g. interrupt tuples). Skip — interrupts are surfaced via updates.
            return [], last_plan_states
        events = self._diff_plan_events(state, last_plan_states)
        return events, {s.id: s.status.value for s in state.plan}

    async def _process_updates_chunk(
        self,
        data: Any,
        initial_state: AgentState,
    ) -> AsyncIterator[Any]:
        interrupts = data.get('__interrupt__') if isinstance(data, dict) else None
        if interrupts:
            for ev in self._interrupt_events(interrupts):
                yield ev
            yield _Done()
            return
        if not isinstance(data, dict):
            return
        for node_name, partial_data in data.items():
            if not isinstance(partial_data, dict):
                continue
            async for ev in self._node_events(node_name, partial_data, initial_state):
                yield ev

    def _interrupt_events(self, interrupts: Any) -> list[ServerEventSchema]:
        out: list[ServerEventSchema] = []
        for itr in interrupts:
            payload = getattr(itr, 'value', None) or {}
            if isinstance(payload, dict) and 'confirmation_id' in payload:
                out.append(ServerEventSchema.confirmation_required(
                    confirmation_id=str(payload['confirmation_id']),
                    tool=str(payload.get('tool', '')),
                    summary=str(payload.get('summary', '')),
                    args_preview=payload.get('args_preview') or {},
                ))
        return out

    async def _yield_final_events(self, graph: Any, config: RunnableConfig) -> AsyncIterator[ServerEventSchema]:
        final_snap = await graph.aget_state(config)
        if not final_snap:
            return
        final = AgentState.model_validate(final_snap.values)
        if final.final_answer:
            yield ServerEventSchema.token(final.final_answer)
        for c in final.citations:
            yield ServerEventSchema.citation(
                page_id=c.page_id, workspace_id=c.workspace_id,
                block_number=c.block_number, title=c.title, quote=c.quote,
            )

    def _diff_plan_events(self, state: AgentState, last_states: dict[str, str]) -> list[ServerEventSchema]:
        """Return plan_step events for steps that are new OR whose status changed
        since the last snapshot. The web translator upserts blocks by id, so
        re-emitting an existing step with a new status flips the UI block from
        Pending -> Running -> Done.
        """
        out: list[ServerEventSchema] = []
        for idx, s in enumerate(state.plan):
            prev_status = last_states.get(s.id)
            if prev_status == s.status.value:
                continue
            out.append(
                ServerEventSchema.plan_step(id=s.id, title=s.title, position=idx, status=s.status.value),
            )
        return out

    async def _node_events(
        self,
        node_name: str,
        partial_data: dict[str, Any],
        initial_state: AgentState,
    ) -> AsyncIterator[ServerEventSchema]:
        """Yield per-node update events from updates-mode stream chunks."""
        merged = {**initial_state.model_dump(by_alias=True), **partial_data}
        state = AgentState.model_validate(merged)
        if node_name == 'router':
            yield ServerEventSchema.router_decision(
                kind=state.routing_kind.value,
                reason=state.last_critic_feedback or '',
            )
        if node_name == 'critic' and state.critic_verdict:
            yield ServerEventSchema.critic_verdict(
                verdict=state.critic_verdict.value,
                feedback=state.critic_feedback or '',
                revision_count=state.revision_count,
            )
```

- [ ] **Step 2: Delete `_streaming.py`**

```bash
git rm agents/apps/agent/use_cases/_streaming.py
```

- [ ] **Step 3: Modify `agents/apps/agent/use_cases/run_agent.py`** — drop the `stream_graph` import, add a `streaming_service` field, call it.

Remove this import line:
```python
from agents.apps.agent.use_cases._streaming import stream_graph
```
Add this import (next to the other service imports):
```python
from agents.apps.agent.services.graph_streaming import GraphStreamingService
```
Add the field to the dataclass (after `checkpointer: Any`):
```python
    streaming_service: GraphStreamingService
```
Replace the call:
```python
            async for event in stream_graph(graph, initial, config, initial):
                yield event
```
with:
```python
            async for event in self.streaming_service.stream(graph, initial, config, initial):
                yield event
```

- [ ] **Step 4: Modify `agents/apps/agent/use_cases/resume_agent.py`** — same pattern.

Remove:
```python
from agents.apps.agent.use_cases._streaming import stream_graph
```
Add:
```python
from agents.apps.agent.services.graph_streaming import GraphStreamingService
```
Add the field (after `checkpointer: Any`):
```python
    streaming_service: GraphStreamingService
```
Replace:
```python
            async for event in stream_graph(
                graph,
                Command(resume={'action': request.action}),
                config,
                state,
            ):
                yield event
```
with:
```python
            async for event in self.streaming_service.stream(
                graph,
                Command(resume={'action': request.action}),
                config,
                state,
            ):
                yield event
```

- [ ] **Step 5: Wire `GraphStreamingService` in `agents/apps/agent/depends.py`**

Add the import (next to the other service imports):
```python
from agents.apps.agent.services.graph_streaming import GraphStreamingService
```
Add a provider line (next to `rag_retrieval_service = provide(RagRetrievalService)`):
```python
    graph_streaming_service = provide(GraphStreamingService, scope=Scope.APP)
```
Add `streaming_service` to **both** use-case providers — parameter and constructor arg. For `run_agent_use_case` and `resume_agent_use_case`, add the parameter:
```python
        streaming_service: GraphStreamingService,
```
and the constructor keyword:
```python
            streaming_service=streaming_service,
```

- [ ] **Step 6: VERIFY**

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(agents): extract GraphStreamingService, inject into use cases (rule 9)"
```

---

## Task 6: `__init__` re-exports via `as`, drop `__all__` (Rule 8)

**Files:**
- Modify: `agents/apps/agent/repositories/__init__.py`, `agents/apps/processing/repositories/__init__.py`, `agents/apps/processing/use_cases/__init__.py`, `agents/apps/agent/services/__init__.py`

- [ ] **Step 1: Rewrite `agents/apps/agent/repositories/__init__.py`**

```python
from .action_log import ActionLogRepository as ActionLogRepository
from .jinja_renderer import AgentJinjaRenderer as AgentJinjaRenderer
from .memory_writer_client import MemoryWriterClient as MemoryWriterClient
from .model_factory import ModelFactoryRepository as ModelFactoryRepository
```

- [ ] **Step 2: Rewrite `agents/apps/processing/repositories/__init__.py`** (drop the redundant `__all__`)

```python
from .embedding_factory import EmbeddingFactoryRepository as EmbeddingFactoryRepository
from .vector_store_repository import VectorStoreRepository as VectorStoreRepository
```

- [ ] **Step 3: Rewrite `agents/apps/processing/use_cases/__init__.py`**

```python
from .delete_page_vectors import DeletePageVectorsUseCase as DeletePageVectorsUseCase
from .delete_workspace_vectors import DeleteWorkspaceVectorsUseCase as DeleteWorkspaceVectorsUseCase
from .validate_embedding import ValidateEmbeddingUseCase as ValidateEmbeddingUseCase
from .vectorize_page import VectorizePageUseCase as VectorizePageUseCase
```

- [ ] **Step 4: Write `agents/apps/agent/services/__init__.py`** (was empty; add `as` re-exports for the two new services)

```python
from .graph_streaming import GraphStreamingService as GraphStreamingService
from .jwt_verifier import JwtVerifierService as JwtVerifierService
```

- [ ] **Step 5: VERIFY**

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(agents): normalize __init__ re-exports to as-form (rule 8)"
```

---

## Task 7: Remove `from __future__ import annotations` where not required (Rule 1)

**Files:** every remaining `apps/agents` `.py` file that still has the line (the files created/rewritten in Tasks 2–6 were already written without it).

- [ ] **Step 1: List remaining occurrences**

```bash
grep -rn 'from __future__ import annotations' agents tests --include='*.py'
```

- [ ] **Step 2: Strip the line from every file that has it**

```bash
perl -ni -e 'print unless /^from __future__ import annotations$/' \
  $(grep -rl 'from __future__ import annotations' agents tests --include='*.py')
```

- [ ] **Step 3: Clean up the blank line some files now lead with, then VERIFY**

```bash
uv run ruff check --fix agents tests
```
Then run the VERIFY triplet. **If mypy reports a forward-reference error** (`Name "X" is not defined` in an annotation), it means that one file genuinely needed lazy annotations — fix by quoting the offending annotation (e.g. `x: 'X'`) or moving the definition earlier. Expected: none (the only `TYPE_CHECKING` site, `errors.py`, was already quoted in Task 2).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(agents): drop unneeded from __future__ import annotations (rule 1)"
```

---

## Task 8: Fix pre-existing `mcp_client.py:98` + final verification (Bonus)

**Files:**
- Modify: `agents/apps/agent/repositories/mcp_client.py`

- [ ] **Step 1: Fix the dynamic-generic `valid-type` error**

In `agents/apps/agent/repositories/mcp_client.py`, change:
```python
        item_py, _ = _resolve_json_type(item_type)
        return (list[item_py] if item_py is not Any else list), allow_null
```
to:
```python
        item_py, _ = _resolve_json_type(item_type)
        # item_py is a type built at runtime from the JSON schema; mypy can't treat a
        # local variable as a type parameter, but the construction is intentional.
        return (list[item_py] if item_py is not Any else list), allow_null  # type: ignore[valid-type]
```

- [ ] **Step 2: Confirm mypy is now fully clean**

Run: `uv run mypy agents tests`
Expected: `Success: no issues found ...` — **0 errors** (the pre-existing `mcp_client.py:98` error is now gone and no others were introduced).

- [ ] **Step 3: Final full VERIFY**

```bash
uv run ruff check agents tests
uv run mypy agents tests
uv run pytest -m 'not integration' -q
```
Expected: ruff clean; mypy 0 errors; pytest all pass except the known `test_search_returns_rag_results` env failure.

- [ ] **Step 4: Commit**

```bash
git add agents/apps/agent/repositories/mcp_client.py
git commit -m "fix(agents): resolve mcp_client dynamic-generic mypy valid-type error"
```

---

## Self-review notes (for the implementer)

- **Rename safety:** `\bPlanStep\b` never touches `PlanStepStatus`; `\bMemoryWrite\b` never touches `MemoryWriterClient`. The Task-3 sweep also cascades into `checkpoint_serde.py`'s qualname strings (those are the renames we want). `AgentState`/`AgentContext` are deliberately never in any rename loop.
- **401 contract:** preserved by `guards.py` raising `HTTPException(401)`; covered by the rewritten `test_verify_service_token.py` guard tests. Do **not** route JWT failures through `BusinessLogicException` (fast_clean maps that to 400).
- **DI for guards:** `request.state.dishka_container.get(JwtVerifierService)` — `JwtVerifierService` is registered (APP scope) in `AgentProvider`, so `.get()` resolves it on demand.
- **Checkpoint serde:** only the 5 embedded-model qualnames + the 2 enum module paths change; in-flight *paused* runs break (accepted; ephemeral). New runs round-trip fine.
- **Known baseline:** `tests/apps/search/test_router.py::test_search_returns_rag_results` fails without a live, version-matched Qdrant — pre-existing, out of scope, must not regress further.
```
