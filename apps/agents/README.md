# agents — AnyNote Agents Service

FastAPI + LangGraph backend for AnyNote LLM interactions. Provider
configuration stays request-driven, so Ollama, OpenAI, and GigaChat
support remain available through the same chat pipeline.

## Entrypoints

- REST: `uv run uvicorn agents.cmd.rest:app --host 0.0.0.0 --port 8080 --reload`
- CLI: `uv run python cli --help`

## Setup

```bash
pnpm install
pnpm --filter agents build
docker compose up -d
ollama pull gemma4
```

## Tests

- Unit: `uv run pytest -m 'not integration'`
- Integration (Ollama): `uv run pytest -m integration`

## Dev Commands

```bash
pnpm --filter agents dev
pnpm --filter agents test
pnpm --filter agents check-types
pnpm --filter agents lint
pnpm --filter agents format
```

Alternative via Makefile in this directory:

```bash
make install
make dev
make test
make test-integration
```

## Layout

- `agents/bootstrap.py` — FastAPI bootstrap, fast-clean hooks, Dishka setup
- `agents/router.py` — top-level route registration
- `agents/apps/chat/` — chat schemas, repositories, services, use cases, router
- `agents/cli/` — Typer CLI scaffold
- `agents/prompts/` — Jinja prompt templates
- `tests/` — pytest coverage

## Owned database tables

LangGraph's `AsyncPostgresSaver` owns the `checkpoints*` family of
tables in the `agents` database. Keep those out of Alembic migrations
and let the checkpointer manage them during startup.
