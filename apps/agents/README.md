# agents — AnyNote Agents Service

FastAPI + LangGraph backend that owns LLM interaction. The service is
stateless w.r.t. credentials — every request carries the provider
config. Conversation state is persisted by LangGraph's
`AsyncPostgresSaver` in the `agents` database.

## Setup

```bash
pnpm install                              # installs agents too
pnpm --filter agents build                # uv sync --frozen
docker compose up -d                      # postgres/ollama/qdrant/...
ollama pull gemma4                        # pulls the default model
```

## Dev loop

```bash
pnpm --filter agents dev                  # http://localhost:8080
pnpm --filter agents test                 # unit tests only
pnpm --filter agents test -- -m integration   # requires running Ollama
pnpm --filter agents check-types
pnpm --filter agents lint
pnpm --filter agents format
```

Alternative via Makefile in this directory:

```bash
make install   # lock + sync
make dev
make test
```

## Layout

- `agents/entrypoints/rest/` — FastAPI routers
- `agents/services/` — LangChain factory, Jinja renderer, LangGraph pipeline
- `agents/schemas/` — pydantic request/response + SSE event models
- `agents/di/` — Dishka providers
- `agents/prompts/` — Jinja prompt templates
- `tests/` — pytest

## Owned database tables

LangGraph's `AsyncPostgresSaver` owns the `checkpoints*` family of
tables in the `agents` database. Do NOT manage those with Alembic —
let the checkpointer run its own `setup()` on startup.
