# apps/agents Fast-clean Refactor Design

**Date:** 2026-04-20  
**Author:** brainstormed with Codex  
**Status:** Draft -> pending user review

## Context

`apps/agents` already exists as a FastAPI + Dishka + LangGraph service with:

- REST routes in `agents/entrypoints/rest`
- domain logic in `agents/services`
- request/streaming models in `agents/schemas`
- app composition in `agents/main.py`

The goal is to refactor the existing service (not create a new project) into a
`yafs`-style layout with deep `fast-clean` integration, while preserving
provider coverage (`Ollama + OpenAI + GigaChat`) and moving chat domain logic
under `agents/apps/chat`.

## Decisions Captured During Brainstorming

1. `fast-clean` integration level: **maximum**.
2. API compatibility: **can be changed** during refactor.
3. Scope: refactor existing `apps/agents`, no new standalone service.
4. Provider support in chat domain: **keep all three** (`Ollama/OpenAI/GigaChat`).
5. `yafs` usage mode: take structure/patterns, adapt content to current `agents`.
6. Alembic: include full scaffold for future domain tables; do not manage LangGraph checkpoint tables.
7. File naming conventions: use `.python-version` and `Dockerfile` (correct names from `yafs`).
8. Integration tests: run under marker (`integration`), skip when environment/services are unavailable.

## Chosen Refactor Strategy

Recommended and approved strategy: **phased cutover inside current app**.

Why this strategy:

- Keeps service runnable at each migration step.
- Reduces regression risk compared to big-bang replacement.
- Allows progressive movement of code into `apps/chat/*` with targeted tests.

## Goals

1. Reorganize `apps/agents/agents` into a `yafs`-style package layout.
2. Introduce `fast-clean` application bootstrap patterns in REST startup path.
3. Move chat business logic into `agents/apps/chat` with clear layer boundaries:
   - `repositories`: IO and external adapters
   - `services`: domain behavior and orchestration helpers
   - `use_cases`: user-facing application scenarios
4. Add `cmd/rest.py` entrypoint and a top-level `bootstrap.py` + `router.py`.
5. Add `cli` scaffold for future commands.
6. Add/align infrastructure files in `apps/agents` following requested list.
7. Add Alembic scaffold for future domain migrations.
8. Keep the application runnable and validated via unit + integration tests.

## Non-Goals

- No new independent product/service outside existing `apps/agents`.
- No removal of existing model providers.
- No Alembic ownership of LangGraph checkpoint tables (`checkpoint*` family).
- No requirement to preserve old route contracts during the migration.

## Target Layout

Target package structure in `apps/agents/agents`:

```text
agents/
  __init__.py
  settings.py
  bootstrap.py
  router.py

  apps/
    __init__.py
    chat/
      __init__.py
      depends.py
      router.py
      enums.py
      errors.py
      schemas.py
      repositories/
        __init__.py
        ...
      services/
        __init__.py
        ...
      use_cases/
        __init__.py
        ...

  cli/
    __init__.py
    app.py
    bootstrap.py
    commands/
      __init__.py

  cmd/
    __init__.py
    rest.py
```

Target app-level files in `apps/agents` (adapted from `yafs` list):

- `.dockerignore`
- `.gitignore`
- `.pre-commit-config.yaml`
- `.python-version`
- `Dockerfile`
- `Makefile`
- `alembic.ini`
- `cli`
- `py.typed`
- `pytest.ini`

## Mapping From Current Modules

- `agents/main.py` -> split into `agents/bootstrap.py` (app creation) + `agents/cmd/rest.py` (runtime entrypoint).
- `agents/entrypoints/rest/*` -> `agents/apps/chat/router.py` + top-level `agents/router.py` aggregator.
- `agents/di/providers.py` -> `agents/apps/chat/depends.py` plus bootstrap wiring.
- `agents/services/graph.py` -> `apps/chat/services/graph_service.py` + use-case boundary.
- `agents/services/providers.py` -> `apps/chat/repositories/model_factory.py`.
- `agents/services/mcp_tools.py` -> `apps/chat/repositories/mcp_tools.py`.
- `agents/services/prompt_renderer.py` -> `apps/chat/repositories/prompt_renderer.py`.
- `agents/schemas/generate.py`, `agents/schemas/streaming.py` -> `apps/chat/schemas.py` (or submodules re-exported there).
- `agents/exceptions.py` -> `apps/chat/errors.py` (+ app-wide registration).

## Layered Architecture

### Repositories (`apps/chat/repositories`)

Responsibilities:

- provider-specific chat model creation (`ollama/openai/gigachat`)
- MCP HTTP tool discovery and invocation adapters
- prompt template loading/rendering
- other external IO helpers needed by chat flow

Rules:

- no FastAPI request objects
- no route-level response formatting
- deterministic, narrow contracts consumed by services/use-cases

### Services (`apps/chat/services`)

Responsibilities:

- LangGraph state-machine assembly/execution helpers
- message preparation/normalization
- streaming event conversion helpers

Rules:

- orchestrates repositories
- no direct framework routing concerns
- may be stateless utilities or APP-scoped service classes

### Use Cases (`apps/chat/use_cases`)

Responsibilities:

- user scenarios (`generate_stream`, potentially future chat actions)
- enforce request-level flow and domain constraints
- return domain output consumed by router

Rules:

- one use case = one user scenario
- explicit dependencies injected via Dishka

## Routing and Entry Points

### `agents/apps/chat/router.py`

- FastAPI `APIRouter` for chat API.
- Handles request parsing, auth dependency, and SSE response wrapping.
- Calls `GenerateStreamUseCase` as the application boundary.

### `agents/router.py`

- Main route aggregator.
- Includes:
  - healthcheck router (fast-clean contrib route or equivalent)
  - chat router

### `agents/cmd/rest.py`

- Imports `create_app` from `bootstrap` and `apply_routes` from `router`.
- Exposes `app = create_app([apply_routes])` for uvicorn factory/entrypoint usage.

### CLI scaffold (`agents/cli/*`)

- Add Typer-based shell matching `yafs` style.
- Keep commands as placeholders only (no feature work now).

## Bootstrap and DI Design

`agents/bootstrap.py` composes app startup and lifecycle, following `yafs` patterns with adaptation:

- Build settings and project metadata.
- Initialize container for FastAPI/Dishka integration.
- Apply `fast-clean` integrations:
  - `use_logging`
  - `use_sentry` (enabled conditionally from settings)
  - `use_middleware`
  - `use_monitoring`
  - `use_exceptions_handlers`
  - `use_toml_info`
- Register chat-specific exception handlers.
- Apply route functions passed into `create_app(...)`.
- Ensure async resource cleanup on shutdown (container + pools/checkpointer).

`agents/apps/chat/depends.py` owns provider declarations and scopes:

- APP scope: settings context, DB pool, LangGraph checkpointer, long-lived services.
- REQUEST scope: use-cases and request-local adapters.

## Data Flow: `POST /generate` (SSE)

1. Router receives payload (`GenerateRequest`) and auth context.
2. Router resolves `GenerateStreamUseCase` from Dishka.
3. Use-case calls graph service to execute streaming pipeline.
4. Service uses repositories for:
   - model factory (provider-specific chat model)
   - prompt rendering
   - MCP tool adapters
   - checkpoint-backed graph execution
5. Router emits SSE events:
   - `token`
   - `done`
   - `error` (for runtime stream exceptions)

This preserves functional behavior while relocating responsibilities into the new layered structure.

## Provider Policy

Required provider support after refactor:

- `ollama`
- `openai`
- `gigachat`

Implementation must keep provider-specific connection settings and model options available from request payload.

## Alembic and Database Policy

### What is added

- `alembic.ini`
- `migrations/` scaffold (`env.py`, `script.py.mako`, `versions/`)
- `Makefile` or scripts for `revision` / `upgrade` commands

### Ownership boundaries

- Alembic manages only future custom domain tables.
- LangGraph checkpoint tables are excluded from autogeneration and migrations.

Practical rule for migration env:

- exclude table names matching checkpoint families (`checkpoint*` / `checkpoints*`) from Alembic autogen.
- keep `AsyncPostgresSaver.setup()` responsible for checkpoint storage lifecycle.

## Test Strategy

### Unit tests

- Move/update tests to match new module boundaries (`apps/chat/repositories/services/use_cases`).
- Cover:
  - provider factory behavior for 3 providers
  - prompt rendering
  - payload/schema validation
  - route-level auth and error formatting

### Integration test (Ollama)

- Keep/add a real integration scenario calling the chat generate endpoint.
- Marker: `@pytest.mark.integration`.
- Default test run excludes integration tests.
- Integration test performs live probe of Ollama endpoint/model availability.
- If services are unavailable, test is skipped (not failed).

## Runtime Validation Criteria

The refactor is considered operational when:

1. Build/install commands succeed for `apps/agents`.
2. REST app starts from `agents/cmd/rest.py` and serves configured routes.
3. Non-integration tests pass in local/default CI runs.
4. Integration tests pass in environment with running Postgres + Ollama.
5. Legacy pre-refactor module paths are removed after cutover (no dead duplicate stack).

## Phased Cutover Plan (Implementation-Oriented)

1. Introduce new skeleton (`bootstrap`, `router`, `cmd/rest`, `apps/chat/*`, `cli/*`) while keeping old code intact.
2. Port schemas/errors/enums into `apps/chat` and add compatibility imports if temporarily needed.
3. Port repositories (model factory, MCP tools, prompt renderer).
4. Port services (graph orchestration and helpers).
5. Port use-case (`generate_stream`) and rewire chat router.
6. Switch top-level app creation and routing to new modules.
7. Add fast-clean bootstrap wiring and finalize Dishka providers in `depends.py`.
8. Add Alembic scaffold and checkpoint table exclusion rules.
9. Update tests to target new paths; add/confirm Ollama integration marker flow.
10. Remove legacy modules (`entrypoints/rest`, old `services/schemas/di` paths) once green.

## Risks and Mitigations

1. Risk: behavior regressions during route and stream migration.
   Mitigation: migrate with staged tests and keep a temporary compatibility window.

2. Risk: lifecycle/resource leaks after DI/bootstrap changes.
   Mitigation: explicit lifespan shutdown cleanup and health/integration validation.

3. Risk: accidental Alembic migration over checkpoint tables.
   Mitigation: explicit exclusion in Alembic env and tests for autogen output.

4. Risk: provider drift for OpenAI/GigaChat while focusing on Ollama.
   Mitigation: retain provider factory unit tests for all providers, even if integration uses Ollama only.

## Definition of Done

- New architecture exists and is the only active code path.
- `apps/chat` owns chat domain logic by layer.
- `fast-clean` startup pattern is integrated in bootstrap.
- Requested infra files from `yafs` style are present in `apps/agents` (adapted, not copied blindly).
- Alembic scaffold is present and safe for checkpoint boundaries.
- Integration test with Ollama exists, runs under marker, and skips when unavailable.
