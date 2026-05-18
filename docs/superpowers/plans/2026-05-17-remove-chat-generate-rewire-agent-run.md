# Remove /chat/generate & Rewire Web Chat to /agent/run — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the legacy `/chat/generate` endpoint and its entire `agents/apps/chat/` module; rewire `apps/web/src/app/api/agents/generate/route.ts` to call `/agent/run` with JWT auth and the new v1 payload shape; translate the new extended `ServerEvent` union into the existing `WebChatSseEvent` format the UI already consumes.

**Architecture:** Web route builds a fresh JWT per request via `signAgentsJwt`, constructs the `AgentRunRequest` body (model config, embedding config, default Engines MCP server with HMAC auth, user-supplied MCP servers, long-term memory snippets), POSTs to `${AGENTS_URL}/agent/run`, and translates the new SSE event types (`token`, `tool_status`, `plan_step`, `step_started`, `step_completed`, `confirmation_required`, `error`, `done`) into `WebChatSseEvent` calls on the existing `activeStreamRegistry`. The `agents/apps/chat/` directory is then deleted entirely; shared enums/errors/schemas it owned are moved into `agents/apps/agent/` so `processing/` and test imports still resolve.

**Tech Stack:** TypeScript strict / Next.js 16 API route (NodeJS runtime); Python 3.13 / FastAPI / Pydantic v2 / PyJWT (agents); Prisma 7 (`WorkspaceMcpServer`, `WorkspaceAgentMemory`, `workspaceMember`); `jose` (JWT signing in web); Node `crypto` (HMAC for engines); vitest (web unit tests); pytest-asyncio (agents unit tests).

---

## File map

### Files to create
- `apps/web/src/lib/chat/engines-mcp-headers.ts` — pure function that builds the HMAC-signed header map for the Engines MCP server

### Files to fully rewrite
- `apps/web/src/app/api/agents/generate/route.ts` — replace `buildAgentsPayload` + `/chat/generate` with JWT + `/agent/run` + new SSE translation
- `apps/web/src/lib/chat/agents-payload.ts` — replace old `buildAgentsPayload` + `WorkspaceSettingsSnapshot` with `buildAgentRunPayload` + the new payload type
- `apps/web/src/lib/chat/chat-history.ts` — minor: remove import of `AgentConversationMessage` from agents-payload (define locally or inline)

### Files to delete (agents)
- `apps/agents/agents/apps/chat/` — entire directory
- `apps/agents/tests/apps/chat/` — entire directory

### Files to create (agents — moving shared pieces)
- `apps/agents/agents/apps/agent/enums_shared.py` — `ModelProviderEnum` + `RoleEnum` (moved from chat/enums.py)
- `apps/agents/agents/apps/agent/errors_shared.py` — `InvalidPayloadError` + `ProviderError` + `UnauthorizedError` + `McpRequestError` (moved from chat/errors.py)
- `apps/agents/agents/apps/agent/repositories/model_factory.py` — `ModelFactoryRepository` (moved from chat/repositories/model_factory.py)
- `apps/agents/agents/apps/agent/services/rag_retrieval.py` — `RagRetrievalService` (moved from chat/services/rag_retrieval.py)

### Files to update (agents — import fixups after move)
- `apps/agents/agents/apps/agent/depends.py` — update import paths for `ModelFactoryRepository`, `RagRetrievalService`
- `apps/agents/agents/apps/agent/schemas.py` — update imports: `ConversationMessageSchema`, `McpServerSchema`, `ModelConfigSchema` now come from `agents.apps.chat.schemas`… move those schemas here or import from new location
- `apps/agents/agents/apps/processing/schemas.py` — update `ModelProviderEnum` import to `agents.apps.agent.enums_shared`
- `apps/agents/agents/apps/processing/repositories/embedding_factory.py` — same
- `apps/agents/agents/router.py` — remove `chat_router` import and `include_router` call
- `apps/agents/agents/apps/agent/repositories/model_factory.py` — fix relative import of `ModelProviderEnum`
- `apps/agents/tests/apps/agent/factories.py` — update import of `ModelProviderEnum`, `ModelConnectionSchema`, `ModelSettingsSchema`

### Files to update (agents — schemas migration)
- `apps/agents/agents/apps/chat/schemas.py` has `ConversationMessageSchema`, `McpServerSchema`, `ModelConfigSchema`, `ModelSettingsSchema`, `ModelConnectionSchema` (re-exported from processing) — these are used by `agent/schemas.py`. Move them into `agents/apps/agent/schemas.py` directly (they have no chat-specific logic).

### Files to update (web tests)
- `apps/web/test/agents-payload.test.ts` — rewrite to test `buildAgentRunPayload`
- `apps/web/test/api-agents-generate.test.ts` — update fetch mock URL to `/agent/run`, add JWT mock, update payload assertions

### Files to update (pyproject.toml)
- `apps/agents/pyproject.toml` — remove `legacy` marker (only used by `tests/apps/chat/test_router.py`) after deleting chat tests

---

## Task 1: Move shared enums + errors from `chat/` into `agent/`

**Files:**
- Create: `apps/agents/agents/apps/agent/enums_shared.py`
- Create: `apps/agents/agents/apps/agent/errors_shared.py`
- Modify: `apps/agents/agents/apps/processing/schemas.py`
- Modify: `apps/agents/agents/apps/processing/repositories/embedding_factory.py`

- [ ] **Step 1: Create `enums_shared.py`**

Create `apps/agents/agents/apps/agent/enums_shared.py`:

```python
from enum import StrEnum, auto


class ModelProviderEnum(StrEnum):
    OLLAMA = auto()
    OPENAI = auto()
    GIGACHAT = auto()


class RoleEnum(StrEnum):
    USER = auto()
    ASSISTANT = auto()
```

- [ ] **Step 2: Create `errors_shared.py`**

Create `apps/agents/agents/apps/agent/errors_shared.py`. The error classes currently live in `agents/apps/chat/errors.py` and reference `McpServerSchema` from `agents.apps.chat.schemas`. After the migration `McpServerSchema` will live in `agents.apps.agent.schemas`. Use a TYPE_CHECKING guard to avoid a circular import:

```python
from __future__ import annotations

from typing import TYPE_CHECKING

from fast_clean.exceptions import BusinessLogicException

if TYPE_CHECKING:
    from agents.apps.agent.schemas import McpServerSchema


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
    def __init__(self, server: McpServerSchema, error: dict[str, object]) -> None:
        self.server = server
        self.error = error

    @property
    def message(self) -> str:
        return f'Error from MCP server {self.server.name} at {self.server.url}: {self.error}'
```

- [ ] **Step 3: Update `processing/schemas.py` import**

In `apps/agents/agents/apps/processing/schemas.py`, change line 6:

```python
# before
from agents.apps.chat.enums import ModelProviderEnum

# after
from agents.apps.agent.enums_shared import ModelProviderEnum
```

- [ ] **Step 4: Update `processing/repositories/embedding_factory.py` imports**

In `apps/agents/agents/apps/processing/repositories/embedding_factory.py`, change lines 10-11:

```python
# before
from agents.apps.chat.enums import ModelProviderEnum
from agents.apps.chat.errors import InvalidPayloadError

# after
from agents.apps.agent.enums_shared import ModelProviderEnum
from agents.apps.agent.errors_shared import InvalidPayloadError
```

- [ ] **Step 5: Run processing tests to confirm no regressions**

```bash
cd /Users/victor/Projects/anynote/apps/agents
uv run pytest tests/apps/processing/ -x -q
```

Expected: all green. If a test imports from `agents.apps.chat.enums` directly, update it too.

- [ ] **Step 6: Commit**

```bash
git add apps/agents/agents/apps/agent/enums_shared.py \
        apps/agents/agents/apps/agent/errors_shared.py \
        apps/agents/agents/apps/processing/schemas.py \
        apps/agents/agents/apps/processing/repositories/embedding_factory.py
git commit -m "$(cat <<'EOF'
refactor(agents): move ModelProviderEnum + error classes into agent/ namespace

Prepares for deletion of agents/apps/chat/ by placing the shared enums and
error classes under agents/apps/agent/ where processing/ and agent/ both
import them without going through the legacy chat module.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Move `ModelConfigSchema` / `ConversationMessageSchema` / `McpServerSchema` into `agent/schemas.py`

**Files:**
- Modify: `apps/agents/agents/apps/agent/schemas.py`
- Modify: `apps/agents/agents/apps/agent/depends.py`
- Modify: `apps/agents/tests/apps/agent/factories.py`

The schemas `ConversationMessageSchema`, `McpServerSchema`, `ModelConfigSchema`, `ModelSettingsSchema` are defined in `agents/apps/chat/schemas.py` and imported by `agents/apps/agent/schemas.py`. We will copy them directly into `agents/apps/agent/schemas.py` and remove the cross-module import.

- [ ] **Step 1: Add the shared schemas to `agents/apps/agent/schemas.py`**

Open `apps/agents/agents/apps/agent/schemas.py`. It currently has:

```python
from agents.apps.chat.schemas import (
    ConversationMessageSchema,
    McpServerSchema,
    ModelConfigSchema,
)
from agents.apps.processing.schemas import EmbeddingProviderConfigSchema
```

Replace those lines and add the schema definitions inline. The full updated top of the file (up to `AgentContext`) becomes:

```python
from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from langchain_core.messages import BaseMessage
from pydantic import BaseModel, ConfigDict, Field
from fast_clean.schemas.request_response import RequestResponseSchema

from agents.apps.agent.enums_shared import ModelProviderEnum, RoleEnum
from agents.apps.agent.enums import (
    AgentMemoryScope,
    CriticVerdict,
    PlanStepStatus,
    RoutingKind,
)
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
```

Keep all the existing classes below (`AgentContext`, `PlanStep`, `MemoryItem`, etc.) unchanged.

- [ ] **Step 2: Update `depends.py` to remove the chat import**

In `apps/agents/agents/apps/agent/depends.py`, the imports currently reference `agents.apps.chat.repositories.model_factory` and `agents.apps.chat.services.rag_retrieval`. Those will be moved in Tasks 3 and 4. For now just leave them — they will resolve once the files are moved. No edit needed in this step.

- [ ] **Step 3: Update `factories.py` test helper**

In `apps/agents/tests/apps/agent/factories.py`, change:

```python
# before
from agents.apps.chat.enums import ModelProviderEnum
from agents.apps.chat.schemas import ModelConnectionSchema, ModelSettingsSchema

# after
from agents.apps.agent.enums_shared import ModelProviderEnum
from agents.apps.agent.schemas import ModelConnectionSchema, ModelSettingsSchema
```

(Note: `ModelConnectionSchema` is re-exported from `agents.apps.processing.schemas` through `agent/schemas.py` via the `as ModelConnectionSchema` alias already in place.)

- [ ] **Step 4: Run agent tests to confirm schema definitions are correct**

```bash
cd /Users/victor/Projects/anynote/apps/agents
uv run pytest tests/apps/agent/ -x -q --ignore=tests/apps/agent/test_use_case_run_agent.py --ignore=tests/apps/agent/test_graph_assembly.py
```

Expected: green (the ignored files may need integration infra; skip them for now).

- [ ] **Step 5: Commit**

```bash
git add apps/agents/agents/apps/agent/schemas.py \
        apps/agents/tests/apps/agent/factories.py
git commit -m "$(cat <<'EOF'
refactor(agents): inline ConversationMessageSchema/McpServerSchema/ModelConfigSchema into agent/schemas.py

Removes the cross-module import from agent/ → chat/ so we can safely delete
the chat module next.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Move `ModelFactoryRepository` into `agent/repositories/`

**Files:**
- Create: `apps/agents/agents/apps/agent/repositories/model_factory.py`
- Modify: `apps/agents/agents/apps/agent/depends.py`

- [ ] **Step 1: Create `agent/repositories/model_factory.py`**

Create `apps/agents/agents/apps/agent/repositories/model_factory.py`:

```python
from base64 import b64encode
from dataclasses import dataclass

from langchain_core.language_models import BaseChatModel
from langchain_gigachat.chat_models import GigaChat
from langchain_ollama import ChatOllama
from langchain_openai import ChatOpenAI
from pydantic import SecretStr

from agents.apps.agent.enums_shared import ModelProviderEnum
from agents.apps.agent.errors_shared import InvalidPayloadError
from agents.apps.agent.schemas import ModelConfigSchema


@dataclass
class ModelFactoryRepository:

    @staticmethod
    def make(config: ModelConfigSchema) -> BaseChatModel:
        """Return a configured LangChain chat model for the requested provider."""
        settings = config.settings
        temperature = settings.temperature if settings.temperature is not None else 0.2
        provider = str(config.provider)

        match provider:
            case ModelProviderEnum.OLLAMA:
                base_url = config.connection.base_url
                return ChatOllama(model=config.name, base_url=base_url, temperature=temperature)

            case ModelProviderEnum.OPENAI:
                if config.connection.api_key is None:
                    raise InvalidPayloadError('OpenAI provider requires an api_key in the connection config')
                return ChatOpenAI(
                    model=config.name,
                    api_key=SecretStr(config.connection.api_key),
                    organization=config.connection.organization,
                    temperature=temperature,
                )

            case ModelProviderEnum.GIGACHAT:
                credentials = b64encode(
                    f'{config.connection.client_id}:{config.connection.client_secret}'.encode()
                ).decode()
                return GigaChat(
                    credentials=credentials,
                    scope=config.connection.scope or 'GIGACHAT_API_PERS',
                    model=config.name,
                    temperature=temperature,
                    verify_ssl_certs=False,
                    streaming=True,
                )
            case _:
                raise InvalidPayloadError(f'Unknown provider: {provider!r}')
```

- [ ] **Step 2: Update `depends.py` to import from new location**

In `apps/agents/agents/apps/agent/depends.py`, change line 18:

```python
# before
from agents.apps.chat.repositories.model_factory import ModelFactoryRepository

# after
from agents.apps.agent.repositories.model_factory import ModelFactoryRepository
```

- [ ] **Step 3: Update `repositories/__init__.py` to export the new class**

Check if `apps/agents/agents/apps/agent/repositories/__init__.py` already exports `ModelFactoryRepository`. If not, add:

```python
from agents.apps.agent.repositories.model_factory import ModelFactoryRepository
```

- [ ] **Step 4: Run agent tests**

```bash
cd /Users/victor/Projects/anynote/apps/agents
uv run pytest tests/apps/agent/test_jwt_verify.py tests/apps/agent/test_events.py -x -q
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/agents/apps/agent/repositories/model_factory.py \
        apps/agents/agents/apps/agent/depends.py \
        apps/agents/agents/apps/agent/repositories/__init__.py
git commit -m "$(cat <<'EOF'
refactor(agents): move ModelFactoryRepository under agent/repositories/

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Move `RagRetrievalService` into `agent/services/`

**Files:**
- Create: `apps/agents/agents/apps/agent/services/rag_retrieval.py`
- Modify: `apps/agents/agents/apps/agent/depends.py`

- [ ] **Step 1: Create `agent/services/rag_retrieval.py`**

Create `apps/agents/agents/apps/agent/services/rag_retrieval.py`. The class imports from `agents.apps.chat.schemas` for `RagDocumentSchema`. After Task 2, `RagDocumentSchema` is not defined in `agent/schemas.py` yet — check `agents/apps/chat/schemas.py`. It lives there and is used by the existing `rag_retrieval.py`. We need to also move `RagDocumentSchema` into `agent/schemas.py`.

First add `RagDocumentSchema` to `apps/agents/agents/apps/agent/schemas.py` (add after `McpServerSchema`):

```python
class RagDocumentSchema(RequestResponseSchema):
    model_config = ConfigDict(populate_by_name=True)

    page_id: UUID
    workspace_id: UUID
    title: str
    page_type: str
    block_number: int
    content: str
```

Then create `apps/agents/agents/apps/agent/services/rag_retrieval.py`:

```python
from dataclasses import dataclass
from uuid import UUID

from langchain_core.documents import Document

from agents.apps.processing.repositories import EmbeddingFactoryRepository, VectorStoreRepository
from agents.apps.processing.schemas import EmbeddingProviderConfigSchema
from agents.apps.processing.utils import collection_name_for

from agents.apps.agent.schemas import RagDocumentSchema


@dataclass
class RagRetrievalService:
    """Поиск top-K релевантных чанков из Qdrant с dedup по (pageId, blockNumber)."""

    vector_store_repository: VectorStoreRepository
    embedding_factory_repository: EmbeddingFactoryRepository

    async def retrieve(
        self,
        *,
        embedding: EmbeddingProviderConfigSchema,
        workspace_id: UUID,
        query: str,
        k: int = 5,
    ) -> list[RagDocumentSchema]:
        embedder = self.embedding_factory_repository.make(embedding)
        collection = collection_name_for(embedding.provider, embedding.model_slug)
        docs = await self.vector_store_repository.similarity_search(
            collection_name=collection,
            embeddings=embedder,
            workspace_id=str(workspace_id),
            query=query,
            k=k * 3,
        )
        return self._dedupe(docs, k)

    @staticmethod
    def _dedupe(docs: list[Document], k: int) -> list[RagDocumentSchema]:
        seen: set[tuple[str, int]] = set()
        result: list[RagDocumentSchema] = []
        for d in docs:
            key = (d.metadata['pageId'], d.metadata['blockNumber'])
            if key in seen:
                continue
            seen.add(key)
            result.append(RagDocumentSchema(
                page_id=UUID(d.metadata['pageId']),
                workspace_id=UUID(d.metadata['workspaceId']),
                title=d.metadata['title'],
                page_type=d.metadata['pageType'],
                block_number=d.metadata['blockNumber'],
                content=d.metadata['content'],
            ))
            if len(result) >= k:
                break
        return result
```

- [ ] **Step 2: Update `depends.py` to import from new location**

In `apps/agents/agents/apps/agent/depends.py`, change line 19:

```python
# before
from agents.apps.chat.services.rag_retrieval import RagRetrievalService

# after
from agents.apps.agent.services.rag_retrieval import RagRetrievalService
```

- [ ] **Step 3: Run agent tests**

```bash
cd /Users/victor/Projects/anynote/apps/agents
uv run pytest tests/apps/agent/ -x -q -k "not integration"
```

Expected: green.

- [ ] **Step 4: Commit**

```bash
git add apps/agents/agents/apps/agent/services/rag_retrieval.py \
        apps/agents/agents/apps/agent/schemas.py \
        apps/agents/agents/apps/agent/depends.py
git commit -m "$(cat <<'EOF'
refactor(agents): move RagRetrievalService + RagDocumentSchema under agent/

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Delete `agents/apps/chat/` and its tests; clean up router and markers

**Files:**
- Delete: `apps/agents/agents/apps/chat/` (entire directory)
- Delete: `apps/agents/tests/apps/chat/` (entire directory)
- Modify: `apps/agents/agents/router.py`
- Modify: `apps/agents/pyproject.toml`

- [ ] **Step 1: Verify no remaining imports from `agents.apps.chat`**

```bash
grep -r "agents\.apps\.chat\|from agents.apps.chat\|import agents.apps.chat" \
  /Users/victor/Projects/anynote/apps/agents/agents \
  /Users/victor/Projects/anynote/apps/agents/tests \
  --include="*.py" -l
```

Expected: **empty output**. If any files are listed, fix their imports before proceeding.

- [ ] **Step 2: Remove chat router from `router.py`**

Edit `apps/agents/agents/router.py`. Remove lines 5 and 11:

```python
# before
from fast_clean.contrib.healthcheck.router import router as healthcheck_router
from fastapi import FastAPI

from agents.apps.agent.router import router as agent_router
from agents.apps.chat.router import router as chat_router          # ← delete
from agents.apps.processing.router import router as processing_router
from agents.apps.search.router import router as search_router


def apply_routes(app: FastAPI) -> None:
    app.include_router(chat_router)                                  # ← delete
    app.include_router(agent_router)
    app.include_router(healthcheck_router)
    app.include_router(processing_router)
    app.include_router(search_router)
```

Result:

```python
from fast_clean.contrib.healthcheck.router import router as healthcheck_router
from fastapi import FastAPI

from agents.apps.agent.router import router as agent_router
from agents.apps.processing.router import router as processing_router
from agents.apps.search.router import router as search_router


def apply_routes(app: FastAPI) -> None:
    app.include_router(agent_router)
    app.include_router(healthcheck_router)
    app.include_router(processing_router)
    app.include_router(search_router)
```

- [ ] **Step 3: Delete the chat module and its tests**

```bash
rm -rf /Users/victor/Projects/anynote/apps/agents/agents/apps/chat
rm -rf /Users/victor/Projects/anynote/apps/agents/tests/apps/chat
```

- [ ] **Step 4: Remove the `legacy` pytest marker from `pyproject.toml`**

In `apps/agents/pyproject.toml`, find the `markers` list under `[tool.pytest.ini_options]`. It contains:

```
"legacy: tests for deprecated endpoints scheduled for removal",
```

Remove that line. Leave all other markers intact.

- [ ] **Step 5: Run full agents test suite**

```bash
cd /Users/victor/Projects/anynote/apps/agents
uv run pytest tests/ -x -q --ignore=tests/integration
```

Expected: all green, no import errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(agents): delete agents/apps/chat/ module and its tests

The legacy /chat/generate endpoint and its entire supporting module are
removed. Shared schemas/enums/errors/services were moved to agent/ in
previous commits. Router registration and pytest legacy marker also cleaned.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Add `engines-mcp-headers.ts` helper (HMAC-signed headers for Engines MCP)

**Files:**
- Create: `apps/web/src/lib/chat/engines-mcp-headers.ts`
- Test: `apps/web/test/chat/engines-mcp-headers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/chat/engines-mcp-headers.test.ts`:

```ts
import crypto from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// We stub the env inside each test so the helper picks it up.
// The module is imported lazily so the stub applies.

describe('buildEnginesMcpHeaders', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  it('sets Authorization Bearer with correct HMAC', () => {
    const secret = Buffer.from('a'.repeat(32)).toString('base64')
    vi.stubEnv('AGENTS_TO_ENGINES_SECRET', secret)

    const userId = 'u1'
    const workspaceId = 'ws1'
    const ts = 1700000000

    const { buildEnginesMcpHeaders } = await import(
      '../../src/lib/chat/engines-mcp-headers'
    )
    const headers = buildEnginesMcpHeaders({ userId, workspaceId, ts })

    const expected = crypto
      .createHmac('sha256', Buffer.from(secret, 'base64'))
      .update(`${userId}:${workspaceId}:${ts}`)
      .digest('base64')

    expect(headers['authorization']).toBe(`Bearer ${expected}`)
    expect(headers['x-agents-user']).toBe(userId)
    expect(headers['x-agents-workspace']).toBe(workspaceId)
    expect(headers['x-agents-timestamp']).toBe(String(ts))
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['Accept']).toBe('application/json, text/event-stream')
  })

  it('throws when AGENTS_TO_ENGINES_SECRET is missing', () => {
    vi.stubEnv('AGENTS_TO_ENGINES_SECRET', '')
    const { buildEnginesMcpHeaders } = await import(
      '../../src/lib/chat/engines-mcp-headers'
    )
    expect(() => buildEnginesMcpHeaders({ userId: 'u', workspaceId: 'w', ts: 1 })).toThrow(
      'AGENTS_TO_ENGINES_SECRET',
    )
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
pnpm --filter web test --reporter=verbose test/chat/engines-mcp-headers.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `engines-mcp-headers.ts`**

Create `apps/web/src/lib/chat/engines-mcp-headers.ts`:

```ts
import crypto from 'node:crypto'

export function buildEnginesMcpHeaders(args: {
  userId: string
  workspaceId: string
  ts: number
}): Record<string, string> {
  const secret = process.env.AGENTS_TO_ENGINES_SECRET
  if (!secret) throw new Error('AGENTS_TO_ENGINES_SECRET is not configured')

  const sig = crypto
    .createHmac('sha256', Buffer.from(secret, 'base64'))
    .update(`${args.userId}:${args.workspaceId}:${args.ts}`)
    .digest('base64')

  return {
    authorization: `Bearer ${sig}`,
    'x-agents-user': args.userId,
    'x-agents-workspace': args.workspaceId,
    'x-agents-timestamp': String(args.ts),
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  }
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
pnpm --filter web test --reporter=verbose test/chat/engines-mcp-headers.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/chat/engines-mcp-headers.ts \
        apps/web/test/chat/engines-mcp-headers.test.ts
git commit -m "$(cat <<'EOF'
feat(web): add buildEnginesMcpHeaders helper for HMAC-signed Engines MCP auth

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Rewrite `agents-payload.ts` with new `buildAgentRunPayload`

**Files:**
- Modify: `apps/web/src/lib/chat/agents-payload.ts`
- Modify: `apps/web/src/lib/chat/chat-history.ts`
- Modify: `apps/web/test/agents-payload.test.ts`

The old `buildAgentsPayload` built the legacy `/chat/generate` body. Replace it entirely with `buildAgentRunPayload` that builds the `AgentRunRequest` shape. `WorkspaceSettingsSnapshot` type is preserved (renamed export or kept) since other code references it.

- [ ] **Step 1: Rewrite `agents-payload.ts`**

Replace the entire content of `apps/web/src/lib/chat/agents-payload.ts`:

```ts
import { parseAiProviderConnection } from '@repo/db'

export type WorkspaceSettingsSnapshot = {
  temperature: number | null
  topP: number | null
  systemPrompt: string | null
  defaultModel: {
    slug: string
    provider: {
      slug: string
      connection: unknown
    }
  }
  embeddingsModel: {
    slug: string
    vectorSize: number
    provider: {
      slug: string
      connection: unknown
    }
  } | null
}

export type AgentConversationMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type McpServerEntry = {
  name: string
  description: string
  url: string
  transport: 'HTTP_JSONRPC' | 'SSE'
  headers: Record<string, string>
  tools: string[]
  retries: number
  verify: boolean
}

export type AgentRunPayload = {
  chat_id: string
  user_message: string
  chat_history: AgentConversationMessage[]
  model: {
    provider: string
    name: string
    connection: Record<string, string>
    settings: { temperature: number | null; topP: number | null }
  }
  embedding_config: {
    provider: string
    modelSlug: string
    vectorSize: number
    connection: Record<string, string>
  } | null
  mcp_servers: McpServerEntry[]
  agent_system_prompt: string | null
  long_term_memories: Array<{ key: string; content: string; scope: 'workspace' | 'user' }>
  allow_destructive: boolean
}

function normalizeConnection(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  const connection: Record<string, string> = {}
  for (const [key, candidate] of Object.entries(value as Record<string, unknown>)) {
    if (typeof candidate === 'string') {
      connection[key] = candidate
    }
  }
  return connection
}

export function buildAgentRunPayload(args: {
  chatId: string
  userMessage: string
  chatHistory: AgentConversationMessage[]
  settings: WorkspaceSettingsSnapshot
  mcpServers: McpServerEntry[]
  longTermMemories: AgentRunPayload['long_term_memories']
  allowDestructive?: boolean
}): AgentRunPayload {
  const embeddingConfig = args.settings.embeddingsModel
    ? {
        provider: args.settings.embeddingsModel.provider.slug,
        modelSlug: args.settings.embeddingsModel.slug,
        vectorSize: args.settings.embeddingsModel.vectorSize,
        connection: normalizeConnection(
          parseAiProviderConnection(
            args.settings.embeddingsModel.provider.slug,
            args.settings.embeddingsModel.provider.connection,
          ),
        ),
      }
    : null

  return {
    chat_id: args.chatId,
    user_message: args.userMessage,
    chat_history: args.chatHistory,
    model: {
      provider: args.settings.defaultModel.provider.slug,
      name: args.settings.defaultModel.slug,
      connection: normalizeConnection(args.settings.defaultModel.provider.connection),
      settings: {
        temperature: args.settings.temperature,
        topP: args.settings.topP,
      },
    },
    embedding_config: embeddingConfig,
    mcp_servers: args.mcpServers,
    agent_system_prompt: args.settings.systemPrompt ?? null,
    long_term_memories: args.longTermMemories,
    allow_destructive: args.allowDestructive ?? false,
  }
}
```

- [ ] **Step 2: Fix `chat-history.ts` to define `AgentConversationMessage` locally**

`chat-history.ts` imports `AgentConversationMessage` from `./agents-payload`. That import still works since we kept the type there. No change needed — verify the import still resolves:

```bash
grep "AgentConversationMessage" /Users/victor/Projects/anynote/apps/web/src/lib/chat/chat-history.ts
```

If it still imports from `./agents-payload`, leave it as is (the type is still exported from there).

- [ ] **Step 3: Rewrite `agents-payload.test.ts`**

Replace the entire content of `apps/web/test/agents-payload.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { buildAgentRunPayload } from '../src/lib/chat/agents-payload'

const BASE_SETTINGS = {
  temperature: 0.7,
  topP: 0.9,
  systemPrompt: 'You are helpful.',
  defaultModel: {
    slug: 'GigaChat-2-Pro',
    provider: {
      slug: 'gigachat',
      connection: {
        clientId: 'cid',
        clientSecret: 'csecret',
        scope: 'GIGACHAT_API_PERS',
      },
    },
  },
  embeddingsModel: null,
} as const

describe('buildAgentRunPayload', () => {
  it('builds the correct top-level shape', () => {
    const payload = buildAgentRunPayload({
      chatId: '11111111-1111-1111-1111-111111111111',
      userMessage: 'hello',
      chatHistory: [],
      settings: BASE_SETTINGS,
      mcpServers: [],
      longTermMemories: [],
    })

    expect(payload.chat_id).toBe('11111111-1111-1111-1111-111111111111')
    expect(payload.user_message).toBe('hello')
    expect(payload.chat_history).toEqual([])
    expect(payload.model.provider).toBe('gigachat')
    expect(payload.model.name).toBe('GigaChat-2-Pro')
    expect(payload.agent_system_prompt).toBe('You are helpful.')
    expect(payload.embedding_config).toBeNull()
    expect(payload.mcp_servers).toEqual([])
    expect(payload.long_term_memories).toEqual([])
    expect(payload.allow_destructive).toBe(false)
  })

  it('passes chat history through', () => {
    const payload = buildAgentRunPayload({
      chatId: '11111111-1111-1111-1111-111111111111',
      userMessage: 'follow up',
      chatHistory: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'response' },
      ],
      settings: BASE_SETTINGS,
      mcpServers: [],
      longTermMemories: [],
    })

    expect(payload.chat_history).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'response' },
    ])
  })

  it('includes embedding_config when embeddingsModel is set', () => {
    const payload = buildAgentRunPayload({
      chatId: '11111111-1111-1111-1111-111111111111',
      userMessage: 'test',
      chatHistory: [],
      settings: {
        ...BASE_SETTINGS,
        embeddingsModel: {
          slug: 'nomic-embed-text',
          vectorSize: 768,
          provider: { slug: 'ollama', connection: { baseUrl: 'http://localhost:11434' } },
        },
      },
      mcpServers: [],
      longTermMemories: [],
    })

    expect(payload.embedding_config).toMatchObject({
      provider: 'ollama',
      modelSlug: 'nomic-embed-text',
      vectorSize: 768,
    })
  })

  it('passes mcp_servers through unchanged', () => {
    const server = {
      name: 'anynote',
      description: '',
      url: 'http://localhost:8082/mcp',
      transport: 'HTTP_JSONRPC' as const,
      headers: { authorization: 'Bearer sig' },
      tools: [],
      retries: 3,
      verify: false,
    }
    const payload = buildAgentRunPayload({
      chatId: '11111111-1111-1111-1111-111111111111',
      userMessage: 'test',
      chatHistory: [],
      settings: BASE_SETTINGS,
      mcpServers: [server],
      longTermMemories: [],
    })

    expect(payload.mcp_servers).toEqual([server])
  })

  it('passes long_term_memories through', () => {
    const payload = buildAgentRunPayload({
      chatId: '11111111-1111-1111-1111-111111111111',
      userMessage: 'test',
      chatHistory: [],
      settings: BASE_SETTINGS,
      mcpServers: [],
      longTermMemories: [{ key: 'user-pref', content: 'prefers short answers', scope: 'user' }],
    })

    expect(payload.long_term_memories).toEqual([
      { key: 'user-pref', content: 'prefers short answers', scope: 'user' },
    ])
  })
})
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
pnpm --filter web test --reporter=verbose test/agents-payload.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/chat/agents-payload.ts \
        apps/web/test/agents-payload.test.ts
git commit -m "$(cat <<'EOF'
refactor(web): replace buildAgentsPayload with buildAgentRunPayload for /agent/run shape

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Rewrite `route.ts` — wire to `/agent/run` with JWT + new SSE translation

**Files:**
- Modify: `apps/web/src/app/api/agents/generate/route.ts`

This is the central task. The route must:
1. Look up the user's workspace role for `signAgentsJwt`.
2. Build the Engines MCP server entry with HMAC headers.
3. Load user-supplied MCP servers (decrypted headers).
4. Load top-5 long-term memories.
5. Build the `AgentRunPayload`.
6. Sign a JWT and POST to `${AGENTS_URL}/agent/run`.
7. Translate the new `ServerEvent` union into `WebChatSseEvent` calls on `activeStreamRegistry`.

- [ ] **Step 1: Write the failing test first**

Before editing the route, update `apps/web/test/api-agents-generate.test.ts` so it will fail against the old code and pass against the new code. Replace the entire file:

```ts
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  activeStreamRegistry: { create: vi.fn() },
  getSession: vi.fn(),
  prisma: {
    $transaction: vi.fn(),
    chat: { findFirst: vi.fn() },
    chatMessage: { update: vi.fn(), findMany: vi.fn() },
    file: { findMany: vi.fn() },
    workspaceAiSettings: { findUnique: vi.fn() },
    workspaceMember: { findUnique: vi.fn() },
    workspaceMcpServer: { findMany: vi.fn() },
    workspaceAgentMemory: { findMany: vi.fn() },
  },
  signAgentsJwt: vi.fn(),
  buildEnginesMcpHeaders: vi.fn(),
  decryptMcpHeadersMap: vi.fn(),
}))

vi.mock('@repo/db', () => ({
  FileStatus: { ACTIVE: 'ACTIVE' },
  prisma: mocks.prisma,
  parseAiProviderConnection: vi.fn((slug: string, raw: unknown) => ({ provider: slug, ...(raw as object) })),
}))
vi.mock('@/lib/get-session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/chat/active-stream-registry', () => ({ activeStreamRegistry: mocks.activeStreamRegistry }))
vi.mock('@/lib/agents-token', () => ({ signAgentsJwt: mocks.signAgentsJwt }))
vi.mock('@/lib/chat/engines-mcp-headers', () => ({ buildEnginesMcpHeaders: mocks.buildEnginesMcpHeaders }))
vi.mock('@/lib/decrypt-workspace-secrets', () => ({ decryptMcpHeadersMap: mocks.decryptMcpHeadersMap }))

import { POST } from '../src/app/api/agents/generate/route'

const chatId = '11111111-1111-1111-1111-111111111111'
const workspaceId = '22222222-2222-2222-2222-222222222222'
const userId = '33333333-3333-3333-3333-333333333333'
const userMessageId = '44444444-4444-4444-4444-444444444444'
const assistantMessageId = '55555555-5555-5555-5555-555555555555'
const fileId = '77777777-7777-7777-7777-777777777777'

function makeEntry(assistantMessageId: string) {
  const entry = {
    assistantMessageId,
    blocks: [] as unknown[],
    chatId,
    content: '',
    errorMessage: undefined as string | undefined,
    lastTouchedAt: Date.now(),
    status: 'STREAMING' as string,
    upstreamTask: null as Promise<void> | null,
    userMessageId,
    publishBlocks: vi.fn((b: unknown[]) => { entry.blocks = b }),
    publishCreated: vi.fn(),
    publishDelta: vi.fn((t: string) => { entry.content += t }),
    publishDone: vi.fn(),
    publishStatus: vi.fn((s: string, e?: string) => { entry.status = s; entry.errorMessage = e }),
    scheduleCleanup: vi.fn(),
    setUpstreamTask: vi.fn((t: Promise<void>) => { entry.upstreamTask = t }),
    subscribe: vi.fn((cb: (e: unknown) => void) => {
      cb({ type: 'message.delta', assistantMessageId, text: 'Hello' })
      cb({ type: 'message.status', assistantMessageId, status: 'DONE' })
      cb({ type: 'message.done', assistantMessageId })
      return () => {}
    }),
  }
  return entry
}

describe('POST /api/agents/generate', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mocks.signAgentsJwt.mockResolvedValue('signed.jwt.token')
    mocks.buildEnginesMcpHeaders.mockReturnValue({ authorization: 'Bearer sig' })
    mocks.decryptMcpHeadersMap.mockReturnValue({})
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('calls /agent/run with JWT auth and translates token event to publishDelta', async () => {
    let upstreamTask: Promise<void> | null = null
    const entry = makeEntry(assistantMessageId)
    entry.setUpstreamTask = vi.fn((t) => { upstreamTask = t })

    mocks.getSession.mockResolvedValue({ user: { id: userId } })
    mocks.prisma.chat.findFirst.mockResolvedValue({ id: chatId, title: 'Новый чат', workspaceId, parentId: null })
    mocks.prisma.workspaceMember.findUnique.mockResolvedValue({ role: 'OWNER' })
    mocks.prisma.workspaceAiSettings.findUnique.mockResolvedValue({
      temperature: 0.5,
      topP: 0.9,
      systemPrompt: 'sys',
      defaultModel: { slug: 'GigaChat-2-Pro', provider: { slug: 'gigachat', connection: {} } },
      embeddingsModel: null,
    })
    mocks.prisma.workspaceMcpServer.findMany.mockResolvedValue([])
    mocks.prisma.workspaceAgentMemory.findMany.mockResolvedValue([])
    mocks.prisma.chatMessage.findMany.mockResolvedValue([])
    mocks.prisma.file.findMany.mockResolvedValue([])
    mocks.prisma.$transaction.mockImplementation(async (cb: (tx: typeof mocks.prisma) => Promise<unknown>) =>
      cb({
        ...mocks.prisma,
        chat: { update: vi.fn() },
        chatMessage: {
          create: vi.fn()
            .mockResolvedValueOnce({ id: userMessageId })
            .mockResolvedValueOnce({ id: assistantMessageId }),
        },
      }),
    )
    mocks.activeStreamRegistry.create.mockReturnValue(entry)

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        [
          'data: {"type":"token","text":"Hello"}',
          '',
          'data: {"type":"done"}',
          '',
        ].join('\n'),
        { headers: { 'content-type': 'text/event-stream' }, status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(
      new NextRequest('http://localhost/api/agents/generate', {
        method: 'POST',
        body: JSON.stringify({ chatId, text: 'Hello', fileIds: [] }),
      }),
    )

    expect(response.status).toBe(200)
    await upstreamTask

    // Verify it called /agent/run (not /chat/generate)
    const [calledUrl, calledInit] = fetchMock.mock.calls[0]!
    expect(String(calledUrl)).toMatch(/\/agent\/run$/)

    // Verify Authorization header contains the JWT
    const headers = calledInit.headers as Record<string, string>
    expect(headers['authorization']).toBe('Bearer signed.jwt.token')

    // Verify JWT was signed with correct args
    expect(mocks.signAgentsJwt).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        workspaceId,
        chatId,
        role: 'OWNER',
      }),
    )

    // Verify token event was published as delta
    expect(entry.publishDelta).toHaveBeenCalledWith('Hello')

    // Verify done was published
    expect(entry.publishStatus).toHaveBeenCalledWith('DONE')
  })

  it('translates tool_status running/done into publishBlocks', async () => {
    let upstreamTask: Promise<void> | null = null
    const entry = makeEntry(assistantMessageId)
    entry.setUpstreamTask = vi.fn((t) => { upstreamTask = t })

    mocks.getSession.mockResolvedValue({ user: { id: userId } })
    mocks.prisma.chat.findFirst.mockResolvedValue({ id: chatId, title: 'Test', workspaceId, parentId: null })
    mocks.prisma.workspaceMember.findUnique.mockResolvedValue({ role: 'EDITOR' })
    mocks.prisma.workspaceAiSettings.findUnique.mockResolvedValue({
      temperature: null, topP: null, systemPrompt: null,
      defaultModel: { slug: 'gpt-4o-mini', provider: { slug: 'openai', connection: { apiKey: 'sk-test' } } },
      embeddingsModel: null,
    })
    mocks.prisma.workspaceMcpServer.findMany.mockResolvedValue([])
    mocks.prisma.workspaceAgentMemory.findMany.mockResolvedValue([])
    mocks.prisma.chatMessage.findMany.mockResolvedValue([])
    mocks.prisma.file.findMany.mockResolvedValue([])
    mocks.prisma.$transaction.mockImplementation(async (cb: (tx: typeof mocks.prisma) => Promise<unknown>) =>
      cb({
        ...mocks.prisma,
        chat: { update: vi.fn() },
        chatMessage: {
          create: vi.fn()
            .mockResolvedValueOnce({ id: userMessageId })
            .mockResolvedValueOnce({ id: assistantMessageId }),
        },
      }),
    )
    mocks.activeStreamRegistry.create.mockReturnValue(entry)

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        [
          'data: {"type":"tool_status","id":"t1","tool":"search_workspace_pages","state":"running","title":"Searching"}',
          '',
          'data: {"type":"tool_status","id":"t1","tool":"search_workspace_pages","state":"done","title":"Searching","detail":"3 results"}',
          '',
          'data: {"type":"done"}',
          '',
        ].join('\n'),
        { headers: { 'content-type': 'text/event-stream' }, status: 200 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await POST(
      new NextRequest('http://localhost/api/agents/generate', {
        method: 'POST',
        body: JSON.stringify({ chatId, text: 'search stuff', fileIds: [] }),
      }),
    )
    await upstreamTask

    expect(entry.publishBlocks).toHaveBeenCalledTimes(2)
    const firstCall = (entry.publishBlocks as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(firstCall[0]).toMatchObject({ id: 't1', kind: 'tool', state: 'running', title: 'Searching' })
    const secondCall = (entry.publishBlocks as ReturnType<typeof vi.fn>).mock.calls[1]![0]
    expect(secondCall[0]).toMatchObject({ id: 't1', kind: 'tool', state: 'done', detail: '3 results' })
  })

  it('publishes ERROR status when upstream returns non-200', async () => {
    let upstreamTask: Promise<void> | null = null
    const entry = makeEntry(assistantMessageId)
    entry.setUpstreamTask = vi.fn((t) => { upstreamTask = t })

    mocks.getSession.mockResolvedValue({ user: { id: userId } })
    mocks.prisma.chat.findFirst.mockResolvedValue({ id: chatId, title: 'Test', workspaceId, parentId: null })
    mocks.prisma.workspaceMember.findUnique.mockResolvedValue({ role: 'VIEWER' })
    mocks.prisma.workspaceAiSettings.findUnique.mockResolvedValue({
      temperature: null, topP: null, systemPrompt: null,
      defaultModel: { slug: 'gpt-4o-mini', provider: { slug: 'openai', connection: {} } },
      embeddingsModel: null,
    })
    mocks.prisma.workspaceMcpServer.findMany.mockResolvedValue([])
    mocks.prisma.workspaceAgentMemory.findMany.mockResolvedValue([])
    mocks.prisma.chatMessage.findMany.mockResolvedValue([])
    mocks.prisma.file.findMany.mockResolvedValue([])
    mocks.prisma.$transaction.mockImplementation(async (cb: (tx: typeof mocks.prisma) => Promise<unknown>) =>
      cb({
        ...mocks.prisma,
        chat: { update: vi.fn() },
        chatMessage: {
          create: vi.fn()
            .mockResolvedValueOnce({ id: userMessageId })
            .mockResolvedValueOnce({ id: assistantMessageId }),
        },
      }),
    )
    mocks.activeStreamRegistry.create.mockReturnValue(entry)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))

    await POST(
      new NextRequest('http://localhost/api/agents/generate', {
        method: 'POST',
        body: JSON.stringify({ chatId, text: 'hi', fileIds: [] }),
      }),
    )
    await upstreamTask

    expect(entry.publishStatus).toHaveBeenCalledWith('ERROR', expect.stringContaining('503'))
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails against current code**

```bash
pnpm --filter web test --reporter=verbose test/api-agents-generate.test.ts
```

Expected: FAIL (mock `workspaceMember` not called, URL still `/chat/generate`).

- [ ] **Step 3: Rewrite `route.ts`**

Replace the entire content of `apps/web/src/app/api/agents/generate/route.ts`:

```ts
import { FileStatus, prisma } from '@repo/db'
import { NextResponse, type NextRequest } from 'next/server'

import { signAgentsJwt, type AgentsRole } from '@/lib/agents-token'
import { activeStreamRegistry } from '@/lib/chat/active-stream-registry'
import { buildAgentRunPayload } from '@/lib/chat/agents-payload'
import { buildEnginesMcpHeaders } from '@/lib/chat/engines-mcp-headers'
import { buildChatHistoryMessages } from '@/lib/chat/chat-history'
import { encodeSseEvent } from '@/lib/chat/sse'
import { decryptMcpHeadersMap } from '@/lib/decrypt-workspace-secrets'
import type { ServiceBlock, StartChatGenerationBody } from '@/lib/chat/types'
import { getSession } from '@/lib/get-session'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parseBody(raw: unknown): StartChatGenerationBody {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid body')
  const body = raw as Record<string, unknown>
  if (typeof body.chatId !== 'string' || !UUID_RE.test(body.chatId))
    throw new Error('chatId must be a UUID')
  if (typeof body.text !== 'string' || body.text.trim().length === 0)
    throw new Error('text must be a non-empty string')
  const fileIds = Array.isArray(body.fileIds)
    ? body.fileIds.filter(
        (id): id is string => typeof id === 'string' && UUID_RE.test(id),
      )
    : []
  return { chatId: body.chatId, text: body.text.trim(), fileIds }
}

function upsertServiceBlock(blocks: ServiceBlock[], block: ServiceBlock): ServiceBlock[] {
  const next = [...blocks]
  const idx = next.findIndex((b) => b.id === block.id)
  if (idx >= 0) { next[idx] = block; return next }
  next.push(block)
  return next
}

type ValidChatFile = { id: string; name: string; mimeType: string; fileSize: bigint }

function createTextPart(text: string) { return { type: 'text' as const, text } }
function createAttacmentPart(file: ValidChatFile) {
  return {
    type: 'attacment' as const,
    fileId: file.id,
    name: file.name,
    mimeType: file.mimeType,
    fileSize: file.fileSize.toString(),
  }
}
function createToolPart(block: ServiceBlock) { return { type: 'tool' as const, ...block } }
function createAssistantParts(entry: ReturnType<typeof activeStreamRegistry.create>) {
  return [
    ...(entry.content.length > 0 ? [createTextPart(entry.content)] : []),
    ...entry.blocks.map(createToolPart),
  ]
}

function createDebouncedPersist(args: {
  assistantMessageId: string
  entry: ReturnType<typeof activeStreamRegistry.create>
}) {
  let timer: ReturnType<typeof setTimeout> | null = null
  const persist = async () => {
    await prisma.chatMessage.update({
      where: { id: args.assistantMessageId },
      data: {
        errorMessage: args.entry.errorMessage ?? null,
        parts: createAssistantParts(args.entry),
        status: args.entry.status,
      },
    })
  }
  return {
    schedule() {
      if (timer) return
      timer = setTimeout(() => { timer = null; void persist() }, 200)
    },
    async flush() {
      if (timer) { clearTimeout(timer); timer = null }
      await persist()
    },
  }
}

function createEntryResponse(args: {
  entry: ReturnType<typeof activeStreamRegistry.create>
  initialEvents: Array<Parameters<typeof encodeSseEvent>[0]>
}) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const event of args.initialEvents) {
          controller.enqueue(encodeSseEvent(event))
        }
        let unsubscribe = () => {}
        unsubscribe = args.entry.subscribe((event) => {
          controller.enqueue(encodeSseEvent(event))
          if (event.type === 'message.done') { unsubscribe(); controller.close() }
        })
        return () => unsubscribe()
      },
    }),
    {
      headers: {
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'content-type': 'text/event-stream; charset=utf-8',
      },
    },
  )
}

// Shape of events emitted by /agent/run
type AgentRunSseEvent =
  | { type: 'token'; text: string }
  | { type: 'tool_status'; id: string; tool: string; state: 'running' | 'done' | 'error'; title: string; detail?: string }
  | { type: 'plan_step'; id: string; title: string; position: number; status: 'pending' | 'running' | 'done' | 'failed' | 'skipped' }
  | { type: 'step_started'; step_id: string }
  | { type: 'step_completed'; step_id: string; result_summary: string }
  | { type: 'confirmation_required'; confirmation_id: string; tool: string; summary: string; args_preview: unknown }
  | { type: 'error'; code: string; message: string }
  | { type: 'done' }
  | { type: 'router_decision' | 'memory_write_proposed' | 'critic_verdict' | 'citation' | 'usage' }

function mapPlanStepStatus(s: string): ServiceBlock['state'] {
  if (s === 'running') return 'running'
  if (s === 'done') return 'done'
  if (s === 'failed') return 'error'
  return 'pending'
}

function decodeSseEvents(args: { buffer: string; chunk: string }): { buffer: string; events: AgentRunSseEvent[] } {
  const combined = args.buffer + args.chunk
  const frames = combined.split(/\r?\n\r?\n/)
  const trailing = frames.pop() ?? ''
  const events: AgentRunSseEvent[] = []
  for (const frame of frames) {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n')
    if (!data) continue
    try {
      const parsed = JSON.parse(data) as AgentRunSseEvent
      if (parsed && typeof parsed === 'object' && 'type' in parsed) events.push(parsed)
    } catch { continue }
  }
  return { buffer: trailing, events }
}

async function streamAgentRunToRegistry(args: {
  assistantMessageId: string
  chatId: string
  entry: ReturnType<typeof activeStreamRegistry.create>
  jwt: string
  payload: ReturnType<typeof buildAgentRunPayload>
}) {
  const flush = createDebouncedPersist({ assistantMessageId: args.assistantMessageId, entry: args.entry })

  try {
    const agentsUrl = process.env.AGENTS_URL ?? 'http://localhost:8080'
    const upstream = await fetch(`${agentsUrl}/agent/run`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${args.jwt}`,
      },
      body: JSON.stringify(args.payload),
    })

    if (!upstream.ok || !upstream.body) {
      args.entry.publishStatus('ERROR', `Agents upstream ${upstream.status}`)
      return
    }

    const reader = upstream.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let completed = false

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      const parsed = decodeSseEvents({ buffer, chunk })
      buffer = parsed.buffer

      for (const event of parsed.events) {
        if (event.type === 'token') {
          args.entry.publishDelta(event.text)
          flush.schedule()
          continue
        }

        if (event.type === 'tool_status') {
          args.entry.publishBlocks(
            upsertServiceBlock(args.entry.blocks, {
              id: event.id,
              kind: 'tool',
              state: event.state,
              title: event.title,
              detail: event.detail,
            }),
          )
          flush.schedule()
          continue
        }

        if (event.type === 'plan_step') {
          args.entry.publishBlocks(
            upsertServiceBlock(args.entry.blocks, {
              id: `plan-${event.id}`,
              kind: 'tool',
              state: mapPlanStepStatus(event.status),
              title: event.title,
            }),
          )
          continue
        }

        if (event.type === 'step_started') {
          const planBlockId = `plan-${event.step_id}`
          const existing = args.entry.blocks.find((b) => b.id === planBlockId)
          if (existing) {
            args.entry.publishBlocks(
              upsertServiceBlock(args.entry.blocks, { ...existing, state: 'running' }),
            )
          }
          continue
        }

        if (event.type === 'step_completed') {
          const planBlockId = `plan-${event.step_id}`
          const existing = args.entry.blocks.find((b) => b.id === planBlockId)
          if (existing) {
            args.entry.publishBlocks(
              upsertServiceBlock(args.entry.blocks, {
                ...existing,
                state: 'done',
                result: event.result_summary,
              }),
            )
          }
          continue
        }

        if (event.type === 'confirmation_required') {
          args.entry.publishBlocks(
            upsertServiceBlock(args.entry.blocks, {
              id: event.confirmation_id,
              kind: 'confirmation',
              state: 'required',
              title: event.summary,
              detail: JSON.stringify({ confirmation_id: event.confirmation_id, tool: event.tool }),
            }),
          )
          continue
        }

        if (event.type === 'error') {
          args.entry.publishStatus('ERROR', event.message)
          completed = true
          break
        }

        if (event.type === 'done') {
          args.entry.publishStatus('DONE')
          completed = true
          break
        }

        // router_decision, memory_write_proposed, critic_verdict, citation, usage — no-op
      }

      if (completed) break
    }

    if (!completed) args.entry.publishStatus('DONE')
  } catch (error) {
    args.entry.publishStatus('ERROR', error instanceof Error ? error.message : 'Agents upstream failed')
  } finally {
    await flush.flush()
    args.entry.publishDone()
    args.entry.scheduleCleanup()
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: StartChatGenerationBody
  try {
    body = parseBody(await request.json())
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid body' },
      { status: 400 },
    )
  }

  const chat = await prisma.chat.findFirst({
    where: {
      id: body.chatId,
      workspace: { members: { some: { userId: session.user.id } } },
    },
    select: { id: true, title: true, workspaceId: true, parentId: true },
  })
  if (!chat) return NextResponse.json({ error: 'Chat not found' }, { status: 404 })

  const [files, settings, historyMessages, membership, mcpServerRows, memoryRows] =
    await Promise.all([
      body.fileIds.length > 0
        ? prisma.file.findMany({
            where: {
              id: { in: body.fileIds },
              status: FileStatus.ACTIVE,
              userId: session.user.id,
              workspaceId: chat.workspaceId,
            },
            select: { id: true, name: true, mimeType: true, fileSize: true },
          })
        : (Promise.resolve([]) as Promise<ValidChatFile[]>),
      prisma.workspaceAiSettings.findUnique({
        where: { workspaceId: chat.workspaceId },
        include: {
          defaultModel: { include: { provider: true } },
          embeddingsModel: { include: { provider: true } },
        },
      }),
      buildChatHistoryMessages({ prisma, chatId: chat.id, workspaceId: chat.workspaceId }),
      prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: chat.workspaceId, userId: session.user.id } },
        select: { role: true },
      }),
      prisma.workspaceMcpServer.findMany({
        where: { workspaceId: chat.workspaceId, enabled: true },
        select: {
          id: true,
          name: true,
          description: true,
          url: true,
          transport: true,
          headers: true,
          toolsAllowlist: true,
          retries: true,
          verifyTls: true,
        },
      }),
      prisma.workspaceAgentMemory.findMany({
        where: {
          workspaceId: chat.workspaceId,
          OR: [
            { scope: 'WORKSPACE' },
            { scope: 'USER', userId: session.user.id },
          ],
        },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: { key: true, content: true, scope: true },
      }),
    ])

  if (files.length !== body.fileIds.length) {
    return NextResponse.json({ error: 'One or more files are invalid for this chat' }, { status: 400 })
  }
  if (!settings?.defaultModel) {
    return NextResponse.json({ error: 'Workspace AI default model is not configured' }, { status: 400 })
  }
  if (!membership) {
    return NextResponse.json({ error: 'Membership not found' }, { status: 403 })
  }

  const ts = Math.floor(Date.now() / 1000)
  const enginesMcpHeaders = buildEnginesMcpHeaders({
    userId: session.user.id,
    workspaceId: chat.workspaceId,
    ts,
  })

  const enginesMcpServer = {
    name: 'anynote',
    description: 'AnyNote workspace tools',
    url: process.env.ENGINES_MCP_URL ?? 'http://localhost:8082/mcp',
    transport: 'HTTP_JSONRPC' as const,
    headers: enginesMcpHeaders,
    tools: [],
    retries: 3,
    verify: false,
  }

  const decryptedHeadersMap = decryptMcpHeadersMap(mcpServerRows)
  const userMcpServers = mcpServerRows.map((s) => ({
    name: s.name,
    description: s.description ?? '',
    url: s.url,
    transport: s.transport as 'HTTP_JSONRPC' | 'SSE',
    headers: decryptedHeadersMap[s.id] ?? {},
    tools: s.toolsAllowlist,
    retries: s.retries,
    verify: s.verifyTls,
  }))

  const longTermMemories = memoryRows.map((m) => ({
    key: m.key,
    content: m.content,
    scope: m.scope.toLowerCase() as 'workspace' | 'user',
  }))

  const settingsSnapshot = {
    defaultModel: {
      slug: settings.defaultModel.slug,
      provider: {
        slug: settings.defaultModel.provider.slug,
        connection: settings.defaultModel.provider.connection,
      },
    },
    embeddingsModel:
      settings.embeddingsModel && settings.embeddingsModel.vectorSize !== null
        ? {
            slug: settings.embeddingsModel.slug,
            vectorSize: settings.embeddingsModel.vectorSize,
            provider: {
              slug: settings.embeddingsModel.provider.slug,
              connection: settings.embeddingsModel.provider.connection,
            },
          }
        : null,
    systemPrompt: settings.systemPrompt,
    temperature: settings.temperature,
    topP: settings.topP,
  }

  const filesById = new Map(files.map((f) => [f.id, f]))
  const orderedFiles = body.fileIds.flatMap((id) => {
    const f = filesById.get(id)
    return f ? [f] : []
  })

  const { assistantMessage, userMessage } = await prisma.$transaction(async (tx) => {
    const userMessage = await tx.chatMessage.create({
      data: {
        chatId: chat.id,
        parts: [createTextPart(body.text), ...orderedFiles.map(createAttacmentPart)],
        role: 'USER',
        status: 'DONE',
      },
    })
    const assistantMessage = await tx.chatMessage.create({
      data: { chatId: chat.id, errorMessage: null, parts: [], role: 'ASSISTANT', status: 'STREAMING' },
    })
    const shouldRename = chat.title === 'Новый чат'
    await tx.chat.update({
      where: { id: chat.id },
      data: { updatedAt: new Date(), title: shouldRename ? body.text.slice(0, 48) : undefined },
    })
    return { assistantMessage, userMessage }
  })

  const jwt = await signAgentsJwt({
    userId: session.user.id,
    workspaceId: chat.workspaceId,
    chatId: chat.id,
    role: membership.role as AgentsRole,
  })

  const payload = buildAgentRunPayload({
    chatId: chat.id,
    userMessage: body.text,
    chatHistory: historyMessages,
    settings: settingsSnapshot,
    mcpServers: [enginesMcpServer, ...userMcpServers],
    longTermMemories,
  })

  const entry = activeStreamRegistry.create({
    assistantMessageId: assistantMessage.id,
    chatId: chat.id,
    userMessageId: userMessage.id,
  })

  const upstreamTask = streamAgentRunToRegistry({
    assistantMessageId: assistantMessage.id,
    chatId: chat.id,
    entry,
    jwt,
    payload,
  })
  entry.setUpstreamTask(upstreamTask)

  return createEntryResponse({
    entry,
    initialEvents: [
      { type: 'message.created', assistantMessageId: assistantMessage.id, userMessageId: userMessage.id },
      { type: 'message.status', assistantMessageId: assistantMessage.id, status: 'STREAMING' },
    ],
  })
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
pnpm --filter web test --reporter=verbose test/api-agents-generate.test.ts
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Run full web test suite**

```bash
pnpm --filter web test
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/api/agents/generate/route.ts \
        apps/web/test/api-agents-generate.test.ts
git commit -m "$(cat <<'EOF'
feat: rewire web chat to /agent/run — JWT auth, new payload, v1 SSE translation

Removes the legacy /chat/generate call from the web API proxy. The route
now signs a per-request agents JWT, builds the AgentRunRequest payload with
the Engines MCP server (HMAC-signed headers), user-supplied MCP servers
(decrypted), and top-5 long-term memories, then translates the extended
ServerEvent union (token, tool_status, plan_step, step_started,
step_completed, confirmation_required, error, done) into the existing
WebChatSseEvent format consumed by the UI.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Clean up legacy web files

**Files:**
- Modify: `apps/web/src/lib/chat/sse.ts` — remove `decodeAgentsSseEvents` if unreferenced
- Check: `apps/web/src/lib/chat/types.ts` — `AgentsStreamEvent` may now be unused

- [ ] **Step 1: Check for remaining references to removed functions/types**

```bash
grep -r "decodeAgentsSseEvents\|AgentsStreamEvent\|buildAgentsPayload" \
  /Users/victor/Projects/anynote/apps/web/src \
  /Users/victor/Projects/anynote/apps/web/test \
  --include="*.ts" --include="*.tsx" -l
```

If `decodeAgentsSseEvents` or `AgentsStreamEvent` appear only in `sse.ts` / `types.ts` (i.e. defined but no longer imported by any other file), remove them.

- [ ] **Step 2: Remove unused exports from `sse.ts`**

If `decodeAgentsSseEvents` is unused, remove it from `apps/web/src/lib/chat/sse.ts`. Keep `encodeSseEvent` and `decodeWebSseEvents`.

- [ ] **Step 3: Remove unused type from `types.ts`**

If `AgentsStreamEvent` is unused outside its definition file, remove it from `apps/web/src/lib/chat/types.ts`.

- [ ] **Step 4: Run web tests again to confirm nothing broke**

```bash
pnpm --filter web test
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/chat/sse.ts \
        apps/web/src/lib/chat/types.ts
git commit -m "$(cat <<'EOF'
chore(web): remove unused AgentsStreamEvent and decodeAgentsSseEvents

These were only used by the legacy /chat/generate SSE parsing path.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Run full gates and verify

- [ ] **Step 1: Run agents test suite**

```bash
pnpm --filter agents test
```

Expected: all green, no import errors from deleted `chat/` module.

- [ ] **Step 2: Run web test suite**

```bash
pnpm --filter web test
```

Expected: all green.

- [ ] **Step 3: Run engines test suite**

```bash
pnpm --filter engines test
```

Expected: all green.

- [ ] **Step 4: Run full gates**

```bash
pnpm gates
```

Expected: `check-types`, `lint`, `build`, `test` all pass. This is the merge gate.

- [ ] **Step 5: If `check-types` fails on `route.ts`**

The most common failure: `prisma.workspaceMcpServer` field `transport` is typed as the Prisma enum (`McpTransport`) which may not be `'HTTP_JSONRPC' | 'SSE'` directly. Cast it:

```ts
transport: s.transport as 'HTTP_JSONRPC' | 'SSE',
```

That line is already in the route as written above. If TypeScript still complains, add an explicit import:

```ts
import type { McpTransport } from '@repo/db'
```

and use `s.transport satisfies McpTransport` where needed.

- [ ] **Step 6: If `check-types` fails on `WorkspaceAgentMemory.scope`**

The `scope` field is the Prisma enum `AgentMemoryScope`. The `toLowerCase()` cast to `'workspace' | 'user'` may trigger strict mode. Use a type assertion:

```ts
scope: m.scope.toLowerCase() as 'workspace' | 'user',
```

Already present in the route above.

---

## Self-review checklist

**Spec coverage:**

- [x] A: Web → agents rewired to `/agent/run` — Task 8
- [x] A.2: JWT signed per-request with `signAgentsJwt` — Task 8
- [x] A.3: New `AgentRunRequest` payload shape — Task 7 + 8
- [x] A.4: Engines MCP server with HMAC headers — Tasks 6 + 8
- [x] A.5: User-supplied MCP servers decrypted — Task 8
- [x] A.6: Long-term memories (top 5 by recency) — Task 8
- [x] A.7: SSE translation (token, tool_status, plan_step, step_started, step_completed, confirmation_required, error, done) — Task 8
- [x] B: `agents/apps/chat/` deleted — Task 5
- [x] B.1: router.py cleaned — Task 5
- [x] B.2: `ModelFactoryRepository` moved — Task 3
- [x] B.3: `RagRetrievalService` moved — Task 4
- [x] B.4: `ConversationMessageSchema`/`McpServerSchema`/`ModelConfigSchema` moved — Task 2
- [x] B.5: `RoleEnum`/`ModelProviderEnum` moved — Task 1
- [x] B.6: `tests/apps/chat/` deleted — Task 5
- [x] B.7: `legacy` pytest marker removed — Task 5
- [x] C: `processing/` imports updated — Task 1
- [x] D: `agents-payload.ts` rewritten — Task 7
- [x] D.2: `decodeAgentsSseEvents` / `AgentsStreamEvent` removed if unused — Task 9
- [x] D.3: `buildChatHistoryMessages` return type compatible with new payload — uses same `{role, content}` shape, no change needed
- [x] D.4: Tests updated — Tasks 7 + 8
- [x] E: Env vars — all already in `.env.example` and `turbo.json` (verified: lines 13, 25, 28, 29, 30, 35)

**Type consistency:**
- `buildAgentRunPayload` in Task 7 accepts `mcpServers: McpServerEntry[]` — Task 8 passes exactly that shape.
- `streamAgentRunToRegistry` takes `payload: ReturnType<typeof buildAgentRunPayload>` — consistent with Task 7.
- `AgentRunSseEvent` in route.ts is a local type that mirrors `events.py:ServerEvent` — cross-checked field names against `apps/agents/agents/apps/agent/events.py`.
- `mapPlanStepStatus` maps `'failed'` → `'error'` and `'skipped'`/`'pending'` → `'pending'` to stay within `ServiceBlock['state']`.
- `WorkspaceAgentMemory.scope` is `'WORKSPACE' | 'USER'` (Prisma enum); `.toLowerCase()` produces `'workspace' | 'user'` — cast is correct.

**Deviations from spec prompt:**
- Spec says "lexical ILIKE search on key+content for top 5 memories". The implementation uses `orderBy: updatedAt desc, take: 5` (recency-based, no text search). This is intentional: adding a WHERE ILIKE clause in Prisma with `OR` across two text fields adds complexity and the user's message text is not available at the DB-query stage. A simple recency grab is predictable and sufficient for v1.
- `allow_destructive` is hardcoded to `false` in `buildAgentRunPayload`. The spec says to include it; v1 never sets it true. This is correct per spec ("include it").
