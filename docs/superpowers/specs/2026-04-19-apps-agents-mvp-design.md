# Pillar B1 — `apps/agents` FastAPI MVP Design

**Date:** 2026-04-19
**Author:** brainstormed with Claude
**Status:** Draft → pending user review

## Context

AnyNote is evolving into an AI knowledge workspace (see the roadmap covered
in `agent.md` and discussed earlier with Pillar A). Pillar A landed the DB
foundation (Chat/ChatMessage/ChatMessageFile renames, AiProvider/AiModel
catalog, Page.ownership). Pillar B1 stands up the Python backend that
actually talks to LLMs: `apps/agents` — a FastAPI service that receives a
prompt-ready JSON payload from `apps/web`, renders a Jinja prompt,
calls the selected LangChain provider, and streams tokens back over SSE.

Pillar B1 is intentionally "dumb pipe" scope: the service accepts the full
payload shape (model config, conversation, skills, agents, RAG documents,
MCP servers), renders everything into the prompt, and calls the LLM
once. It does NOT query Qdrant (RAG is Pillar D), does NOT execute MCP
tools (tool execution is Pillar E once `apps/engines` exists), and does
NOT yet produce paragraph-level citations. LangGraph is used even for
the single-node graph so that Pillar B2 can add tool-calling edges
without reshaping the public API.

## Goals

1. Stand up `apps/agents/` as a first-class monorepo app: `pyproject.toml`
   - `uv.lock` + `package.json` with Turbo-compatible scripts so that
     `pnpm dev --filter @repo/agents` works.
2. Update docker infra: replace Weaviate with Qdrant, add Ollama,
   auto-create the `agents` database on first Postgres start.
3. Implement a minimal but production-shaped FastAPI app with Dishka DI,
   pydantic-settings, async-first, structured error handling, and
   BearerToken auth.
4. Implement a LangChain provider factory capable of handling Ollama,
   OpenAI, and GigaChat, reading credentials from the incoming payload
   (no credentials stored in `apps/agents`).
5. Implement the prompt template from the roadmap verbatim as a Jinja2
   file (`prompts/default.j2`) and a thin renderer service.
6. Implement a LangGraph graph (`prepare_prompt → llm`) with
   `AsyncPostgresSaver` (LangGraph's Postgres checkpointer) wired to the
   `agents` database.
7. Expose `POST /api/v1/generate` returning `text/event-stream` with a
   structured SSE event schema (`token`, `heartbeat`, `done`, `error`).
8. pytest setup with unit tests (prompt renderer, provider factory,
   payload validation) and one integration test against a local Ollama
   `gemma4` model.
9. Update `turbo.json` `globalEnv` with all the service-specific
   variables so Turbo caches respect them.
10. Keep the repo green: `pnpm check-types`, `pnpm lint`, `pnpm build`
    all pass after the pillar lands.

## Non-Goals

- Qdrant queries / RAG execution. `rag.documents[]` from the payload is
  rendered into the prompt verbatim; no database lookups. Pillar D.
- MCP tool execution. `mcp.servers[]` is rendered into the prompt as
  metadata; the LLM may emit tool_call output but we do not execute it.
  Pillar B2 / E.
- Default `apps/engines` MCP server injection — Pillar E creates that
  server and Pillar B2 wires it into the default MCP list.
- Paragraph-level citations via vector search. Pillar B2 / D.
- Real credential testing for OpenAI and GigaChat. Scaffold only;
  Ollama is the concrete integration tested in B1.
- Conversation summarization logic. Payload's `conversation.summary` is
  consumed as-is; no automatic summarization on the agents side.
- apps/web integration (both client-side call and server-side tRPC
  procedure connecting to agents). That's a separate small pillar
  tracked under the Pillar F workspace AI settings UI; B1 delivers the
  agents-side API only.
- Deployment, k8s manifests, autoscaling — local-dev only at this
  point.
- Alembic migrations for any future custom tables in the `agents`
  database. `AsyncPostgresSaver.setup()` creates its own tables.

## Infrastructure Prerequisites (bundled with Pillar B1)

These are done as early tasks in the implementation plan because nothing
else works without them.

### 1. `compose.yml`

Replace the Weaviate service with Qdrant, add an Ollama service, mount
a `docker/postgres-init/` volume on Postgres, and add volumes for the
new services.

- `qdrant/qdrant:v1.12.4` on ports 6333 (REST) + 6334 (gRPC), env
  `QDRANT__SERVICE__API_KEY=${QDRANT_API_KEY:-dev-qdrant-key}`,
  `TELEMETRY_DISABLED=true`, healthcheck via `wget -qO- http://localhost:6333/readyz`.
- `ollama/ollama:latest` on port 11434, env `OLLAMA_KEEP_ALIVE=24h`,
  `OLLAMA_ORIGINS=*`, volume `ollama_data:/root/.ollama`.
- `postgres`: add env `POSTGRES_EXTRA_DATABASES=agents` (informational,
  parsed by init script) and mount `./docker/postgres-init:/docker-entrypoint-initdb.d:ro`.
- `redis`: add `redis_data:/data` volume (currently missing).
- Volumes: add `qdrant_data`, `redis_data`; remove `weaviate_data`.
- Port 8080 becomes free — that's where `apps/agents` listens.

### 2. `docker/postgres-init/01-create-agents-db.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  SELECT 'CREATE DATABASE agents'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'agents')\gexec
  GRANT ALL PRIVILEGES ON DATABASE agents TO "$POSTGRES_USER";
EOSQL
```

Idempotent (safe on re-create via `DROP SCHEMA` or `docker compose down -v`
cycles). Executable bit set.

### 3. `turbo.json` globalEnv

Add every new variable so Turbo cache keys include them:

```json
"globalEnv": [
  "NODE_ENV",
  "NEXT_PUBLIC_BASE_URL",
  "DATABASE_URL",
  "AGENTS_DATABASE_URL",
  "BETTER_AUTH_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_JWT_AUDIENCE",
  "S3_ENDPOINT", "S3_REGION", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET", "S3_FORCE_PATH_STYLE",
  "NEXT_PUBLIC_YJS_URL", "YJS_PORT",
  "QDRANT_URL", "QDRANT_API_KEY", "QDRANT_COLLECTION",
  "OLLAMA_BASE_URL", "OLLAMA_DEFAULT_MODEL",
  "AGENTS_SERVICE_URL", "AGENTS_SERVICE_TOKEN", "AGENTS_LOG_LEVEL",
  "ENGINES_PORT", "ENGINES_MCP_TOKEN", "ENGINES_INDEX_DELAY_MS",
  "ENGINES_INDEX_BATCH", "ENGINES_INDEX_LOCK_TTL_MS",
  "EMBEDDINGS_PROVIDER", "EMBEDDINGS_MODEL", "EMBEDDINGS_DIM"
]
```

### 4. `.gitignore`

Ensure Python-specific entries are present at repo root or added to
`apps/agents/.gitignore`:

```
__pycache__/
*.py[cod]
*.pyo
.pytest_cache/
.ruff_cache/
.mypy_cache/
.venv/
*.egg-info/
```

## Package Structure

```
apps/agents/
├── agents/                         # main Python package
│   ├── __init__.py
│   ├── main.py                     # FastAPI app factory
│   ├── settings.py                 # pydantic-settings
│   ├── exceptions.py               # AgentException hierarchy
│   ├── di/
│   │   ├── __init__.py
│   │   └── providers.py            # Dishka Providers (APP + REQUEST)
│   ├── entrypoints/
│   │   ├── __init__.py
│   │   └── rest/
│   │       ├── __init__.py
│   │       ├── router.py           # aggregates health + generate
│   │       ├── health.py           # GET /health
│   │       ├── generate.py         # POST /api/v1/generate
│   │       └── auth.py             # Bearer token dependency
│   ├── services/
│   │   ├── __init__.py
│   │   ├── providers.py            # create_chat_model factory
│   │   ├── prompt_renderer.py      # Jinja2 rendering
│   │   └── graph.py                # LangGraph definition + runner
│   ├── schemas/
│   │   ├── __init__.py
│   │   ├── generate.py             # request / response pydantic models
│   │   └── streaming.py            # SSE event discriminated union
│   └── prompts/
│       └── default.j2              # prompt template (from spec)
├── tests/
│   ├── __init__.py
│   ├── conftest.py                 # pytest fixtures (DI overrides)
│   ├── test_health.py
│   ├── test_prompt_renderer.py     # snapshot-style template rendering
│   ├── test_providers.py           # factory returns correct ChatModel
│   ├── test_generate_schema.py     # pydantic validation
│   └── test_generate_ollama.py     # integration: real Ollama call
├── package.json                     # turbo scripts via uv
├── pyproject.toml
├── uv.lock
├── Dockerfile
├── Makefile
├── .env.example                     # copies relevant keys from repo .env
├── .python-version                  # "3.12"
└── README.md
```

### `pyproject.toml` skeleton

```toml
[project]
name = "agents"
version = "0.1.0"
requires-python = "~=3.12"
dependencies = [
  "fastapi[standard]>=0.116",
  "uvicorn[standard]>=0.30",
  "pydantic>=2.9",
  "pydantic-settings>=2.6",
  "dishka>=1.4",
  "httpx>=0.27",
  "langchain>=0.3",
  "langchain-core>=0.3",
  "langchain-ollama>=0.2",
  "langchain-openai>=0.2",
  "langchain-gigachat>=0.3",
  "langgraph>=0.2",
  "langgraph-checkpoint-postgres>=2.0",
  "asyncpg>=0.30",
  "jinja2>=3.1",
  "sse-starlette>=2.1",
]

[dependency-groups]
dev = [
  "pytest>=8.3",
  "pytest-asyncio>=0.24",
  "pytest-httpx>=0.34",
  "ruff>=0.7",
  "mypy>=1.13",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.pytest.ini_options]
asyncio_mode = "auto"
addopts = "-ra"

[tool.ruff]
line-length = 100
target-version = "py312"

[tool.mypy]
python_version = "3.12"
strict = true
```

Library versions are pinned to floor-of-stable; exact upper bounds and
compat matrix resolved by `uv lock` at implementation time. If `uv`
discovers breaking changes during lock, adjust upwards but not
downwards.

### `package.json`

```json
{
  "name": "agents",
  "private": true,
  "scripts": {
    "dev": "uv run uvicorn agents.main:app --host 0.0.0.0 --port 8080 --reload",
    "build": "uv sync --frozen",
    "check-types": "uv run mypy agents tests",
    "lint": "uv run ruff check agents tests",
    "format": "uv run ruff format agents tests",
    "test": "uv run pytest"
  }
}
```

## Settings (`agents/settings.py`)

```python
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    agents_database_url: str = Field(alias="AGENTS_DATABASE_URL")
    agents_service_token: str = Field(alias="AGENTS_SERVICE_TOKEN")
    agents_log_level: str = Field(default="INFO", alias="AGENTS_LOG_LEVEL")
    ollama_base_url: str = Field(default="http://localhost:11434", alias="OLLAMA_BASE_URL")
    ollama_default_model: str = Field(default="gemma4", alias="OLLAMA_DEFAULT_MODEL")
```

Values come from the repo root `.env` (loaded by the host shell / docker
compose, not by `Settings` itself). `Settings()` picks them up from
`os.environ`.

## Dishka Providers

- **APP scope**:
  - `Settings` — singleton from env
  - `asyncpg.Pool` — connection pool to `AGENTS_DATABASE_URL`
  - `AsyncPostgresSaver` — initialised once, `.setup()` called during
    FastAPI startup event, used across requests

- **REQUEST scope**:
  - `JinjaRenderer` — holds `Environment` with the `prompts/` loader
  - `ChatModelFactory` — depends on nothing (pure factory function)
  - `ThreadContext` — extracted from incoming request payload's
    `threadId`

Providers declared in `agents/di/providers.py` via Dishka's
`Provider` class. FastAPI-Dishka integration registered in `main.py` via
`setup_dishka(container, app)`.

## REST Contract

### `POST /api/v1/generate`

**Request headers:**

- `Authorization: Bearer ${AGENTS_SERVICE_TOKEN}` (required)
- `Content-Type: application/json`

**Request body:** (see `schemas/generate.py`)

```typescript
{
  threadId: string                    // UUID, used as LangGraph thread_id
  model: {
    provider: "ollama" | "openai" | "gigachat"
    name: string
    connection?: {
      baseUrl?: string
      apiKey?: string
      organization?: string
      clientId?: string
      clientSecret?: string
      scope?: string
    }
    settings?: {
      temperature?: number
      maxOutputTokens?: number
      topP?: number
    }
  }
  instructions?: {
    systemPrompt?: string
    appPrompt?: string
    outputContract?: { format: string; citationsRequired: boolean; language: string }
  }
  rag?: {
    enabled: boolean
    strategy?: "optional" | "required"
    documents?: Array<{ id: string; title: string; content: string }>
  }
  conversation: {
    messages: Array<{ role: "user" | "assistant"; content: string }>
    maxHistoryTokens?: number
    summary?: string
  }
  skills?: Array<{ id: string; title: string; markdown: string }>
  agents?: Array<{ id: string; title: string; markdown: string }>
  mcp?: {
    servers?: Array<{ name: string; description: string; tools: string[] }>
  }
  userRequest: { text: string }
}
```

All camelCase → snake_case via pydantic `alias_generator = to_camel` and
`populate_by_name=True`. Internal code uses snake_case fields.

**Validation rules:**

- `threadId` is UUID.
- `conversation.messages` may be empty (first turn).
- `userRequest.text` is required, non-empty after strip.
- `model.provider` values are case-sensitive and restricted to the set
  above. No dynamic provider loading in B1.

**Response:** `text/event-stream` (SSE)

SSE event shape (all payloads JSON-serialised):

```
data: {"type":"token","text":"Пр"}
data: {"type":"token","text":"ив"}
data: {"type":"token","text":"ет"}
data: {"type":"heartbeat"}            // every 15s while streaming
data: {"type":"done"}
```

Mid-stream error:

```
data: {"type":"error","code":"PROVIDER_ERROR","message":"Ollama did not respond"}
```

After an `error` event, the stream closes. Clients MUST render the error
inline and not expect further events.

**HTTP-level errors** (before stream starts):

- `400 BAD_REQUEST` — schema invalid / empty user request
- `401 UNAUTHORIZED` — missing/invalid Bearer
- `409 CONFLICT` — `threadId` locked by another in-flight request
- `502 BAD_GATEWAY` — provider unreachable at connect time
- `500 INTERNAL_SERVER_ERROR` — everything else

JSON body for HTTP errors: `{"error":{"code":"...","message":"..."}}`.

### `GET /health`

Returns `{"status":"ok","database":"reachable","version":"0.1.0"}`.
Database ping is a `SELECT 1` on the agents pool. No auth required.

## Prompt Rendering

`agents/prompts/default.j2` is the template reproduced **verbatim** from
the Pillar B roadmap (`agent.md`): ROLE / EXECUTION PRIORITY / MODEL
CONTEXT / APPLICATION RULES / SYSTEM INSTRUCTIONS / OUTPUT CONTRACT /
ACTIVE AGENTS / ACTIVE SKILLS / AVAILABLE MCP SERVERS / RETRIEVED
CONTEXT / CONVERSATION SUMMARY / RECENT CONVERSATION MESSAGES / CURRENT
USER REQUEST / RESPONSE POLICY.

Renderer (`agents/services/prompt_renderer.py`) loads the template
once, exposes:

```python
def render_system_prompt(payload: GenerateRequest) -> str:
    ...
```

which returns the full text assembled from the payload. `prepare_prompt`
graph node consumes this as the first system message.

Missing optional sections (e.g. no skills) render as the literal
sentence from the template ("No retrieved context was provided.") —
consistent with the template's own `{{#if}}` fallbacks.

## Provider Factory

`agents/services/providers.py`:

```python
def create_chat_model(model_config: ModelConfig) -> BaseChatModel:
    match model_config.provider:
        case "ollama":
            return ChatOllama(
                model=model_config.name,
                base_url=model_config.connection.base_url or settings.ollama_base_url,
                temperature=model_config.settings.temperature,
                ...
            )
        case "openai":
            return ChatOpenAI(
                model=model_config.name,
                api_key=model_config.connection.api_key,
                organization=model_config.connection.organization,
                temperature=model_config.settings.temperature,
                max_tokens=model_config.settings.max_output_tokens,
            )
        case "gigachat":
            return GigaChat(  # from langchain_gigachat
                credentials=f"{model_config.connection.client_id}:{model_config.connection.client_secret}",
                scope=model_config.connection.scope or "GIGACHAT_API_PERS",
                model=model_config.name,
                temperature=model_config.settings.temperature,
            )
        case _:
            raise InvalidPayloadError(f"Unknown provider {model_config.provider}")
```

Credentials come from the request payload. `apps/agents` stores nothing.

**Reality check** for B1: only Ollama is integration-tested. OpenAI and
GigaChat code paths compile and construct models but are not exercised
with real calls. That's fine — the factory is the contract surface
apps/web will fill in later.

## LangGraph Pipeline

`agents/services/graph.py` defines a single StateGraph:

```
StateGraph(GraphState)
├── node "prepare_prompt" (GraphState → GraphState)
│    reads payload, renders Jinja prompt, builds messages list
├── node "llm" (GraphState → GraphState)
│    picks ChatModel via factory, streams tokens, appends AIMessage
└── edges: START → prepare_prompt → llm → END
```

`GraphState` (TypedDict):

```python
class GraphState(TypedDict):
    payload: GenerateRequest
    system_prompt: str
    messages: list[BaseMessage]
    response_tokens: list[str]  # appended by llm streaming callback
```

**Persistence:** `AsyncPostgresSaver(db_url=settings.agents_database_url)`.
`await checkpointer.setup()` is called once during FastAPI lifespan
startup — creates LangGraph's internal tables in the `agents` database.
Graph compiled as `graph = workflow.compile(checkpointer=checkpointer)`.

**Thread ID:** sourced from `payload.thread_id`. Each run is invoked
with `{"configurable": {"thread_id": payload.thread_id}}`. The
checkpointer persists conversation state across calls so subsequent
turns inherit it.

**Tool-call fallback in B1:** if the LLM emits `tool_calls` (shouldn't
happen without tools in context, but guard anyway), we ignore the
tool_calls field and stream only `.content`. No tool-executor node is
added in B1; Pillar B2 introduces it.

## Streaming Protocol Details

`agents/entrypoints/rest/generate.py` uses `sse-starlette`'s
`EventSourceResponse` to pipe the graph run. Pseudocode:

```python
async def generate(
    body: GenerateRequest,
    renderer: FromDishka[JinjaRenderer],
    factory: FromDishka[ChatModelFactory],
    graph: FromDishka[CompiledGraph],
) -> EventSourceResponse:
    async def event_stream():
        try:
            async for chunk in graph.astream(
                {"payload": body},
                {"configurable": {"thread_id": str(body.thread_id)}},
                stream_mode="messages",
            ):
                message, _ = chunk
                if isinstance(message, AIMessageChunk) and message.content:
                    yield {"data": ServerEvent.token(message.content).model_dump_json()}
            yield {"data": ServerEvent.done().model_dump_json()}
        except ProviderError as e:
            yield {"data": ServerEvent.error(code="PROVIDER_ERROR", message=str(e)).model_dump_json()}
    return EventSourceResponse(event_stream(), ping=15)  # 15s heartbeats
```

`ping=15` enables sse-starlette's built-in heartbeat.

## Error Handling

Module `agents/exceptions.py`:

```python
class AgentException(Exception):
    http_status: int = 500
    code: str = "INTERNAL_ERROR"

class InvalidPayloadError(AgentException):
    http_status = 400
    code = "INVALID_PAYLOAD"

class AuthError(AgentException):
    http_status = 401
    code = "UNAUTHORIZED"

class ThreadLockedError(AgentException):
    http_status = 409
    code = "THREAD_LOCKED"

class ProviderError(AgentException):
    http_status = 502
    code = "PROVIDER_ERROR"
```

Registered as FastAPI exception handler returning
`{"error":{"code":..., "message":...}}`. pydantic's
`RequestValidationError` is mapped to HTTP 400 with
`code="INVALID_PAYLOAD"` and the first error's `msg` field surfaced.

Mid-stream failures emit an SSE `error` event (as above) and close the
stream — the HTTP status is still 200 because the headers were already
flushed.

## Testing Strategy

`apps/agents/tests/conftest.py` provides:

- `settings` fixture — builds a test `Settings` instance with
  env-variable overrides via `monkeypatch.setenv`.
- `app` fixture — builds the FastAPI app with Dishka container
  overrides (fake `AsyncPostgresSaver` for unit tests,
  real for integration tests).
- `client` fixture — `httpx.AsyncClient` bound to the app.

### Unit tests

- `test_prompt_renderer.py` — ensures the Jinja template renders
  correctly given a sample payload; asserts presence of specific
  sections ("# ROLE", "# ACTIVE SKILLS") and variable substitution.
- `test_providers.py` — asserts that `create_chat_model` returns the
  expected class for each provider slug; asserts correct kwargs wiring
  via introspection of the returned instance.
- `test_generate_schema.py` — asserts pydantic validation of sample
  payloads (valid/invalid), camelCase aliasing, missing-required
  surface-level errors.
- `test_health.py` — calls `GET /health`, expects 200, expects the
  shape.

### Integration test

- `test_generate_ollama.py` — marked `@pytest.mark.integration`.
  Requires a running Ollama with `gemma4` pulled. Posts a minimal
  payload, asserts:
  - HTTP 200
  - response Content-Type is `text/event-stream`
  - at least one `{"type":"token"}` event
  - a `{"type":"done"}` event fires
  - total run time under 30s
    If Ollama is unreachable, the test is skipped with a message, not
    failed.

Running the integration test is opt-in:
`uv run pytest -m integration`.

## Turbo Integration

`turbo.json` already has the `dev`, `build`, `lint`, `check-types`, `test`
tasks defined at the root; `@repo/agents` exposes them via its
`package.json` scripts. No change to `turbo.json`'s `tasks:` block is
required for the agents app — only `globalEnv` gets extended.

`pnpm dev` at repo root will transparently start `apps/agents` alongside
`apps/web` and `apps/yjs`.

## Verification Plan

1. `docker compose up -d` with the new compose succeeds; `postgres`,
   `qdrant`, `ollama`, `minio`, `redis` all healthy; the `agents`
   database exists on first start.
2. `pnpm install` picks up `@repo/agents`; `pnpm --filter @repo/agents build`
   (runs `uv sync --frozen`) succeeds; lockfile committed.
3. `pnpm --filter @repo/agents check-types` — `mypy` clean.
4. `pnpm --filter @repo/agents lint` — `ruff check` clean.
5. `pnpm --filter @repo/agents test` (excluding integration) — unit
   tests green.
6. `pnpm --filter @repo/agents dev` starts the server on 8080;
   `GET http://localhost:8080/health` returns 200 with the expected
   JSON.
7. `ollama pull gemma4` on host, then
   `pnpm --filter @repo/agents test -- -m integration` — one POST to
   `/api/v1/generate` produces streamed tokens.
8. Full repo `pnpm check-types && pnpm lint && pnpm build` still green.

## Risks

- **LangChain/LangGraph API churn** — majors on the Python side ship
  frequently. We pin to floor-of-stable and run `uv lock` once; any
  library-level deviation is fixed at implementation, not now.
- **AsyncPostgresSaver schema conflicts** — the checkpointer creates
  its own tables. If a future pillar's Alembic migration accidentally
  touches `checkpoints*` tables, things break. Mitigation: never let
  Alembic manage checkpointer-owned tables (document in README).
- **SSE proxy buffering** — some reverse proxies buffer SSE, breaking
  streaming UX. Not a concern for local dev; note for ops-readiness
  pillar.
- **pydantic alias strictness** — camelCase aliasing must be consistent
  throughout. Test coverage in `test_generate_schema.py` catches drift.
- **No rate-limiting** — `/api/v1/generate` is unbounded. OK for local
  dev; flag as a Pillar F/ops concern.
- **Thread ID collisions across workspaces** — threads are global
  (namespaced by UUID only); if a malicious client guesses another
  workspace's thread UUID and has the service token, it could hijack
  state. Bearer token is the only gate. For B1 this is acceptable
  (dev-only); production hardening belongs to a later pillar.

## Out-of-scope Follow-ups

- **Pillar B2**: add tool-calling edges to the graph, execute
  user-configured MCP servers, inject the default apps/engines MCP
  server, add `citation` SSE events.
- **Pillar D**: at the end of Pillar D, apps/web will start populating
  `rag.documents[]` from Qdrant RAG results before POSTing; apps/agents
  does not change — it already renders whatever is passed.
- **Pillar F**: wire the apps/web workspace AI settings UI to the
  agents service (builds the payload, proxies the SSE stream to the
  user's browser).
- Deployment (Dockerfile final form, CI, k8s) — separate ops pillar.
- Rate-limiting, per-workspace quotas — separate pillar.
- Alembic migrations for future `apps/agents`-owned tables.
