# apps/agents cleanup — design

Date: 2026-05-30
Status: approved-pending-review
Scope: `apps/agents` (Python 3.13 / FastAPI / LangGraph / Dishka / fast_clean)

## Goal

A structural cleanup of `apps/agents` to a single, consistent convention set, with
no behavior change. Ten rules (below) are applied across the app. The merge gate
for this work is `pnpm --filter agents lint` + `check-types` + `test`.

## Non-goals

- No behavior changes, no endpoint/contract changes, no new features.
- No change to the LLM/graph logic, prompts, or node behavior.
- No unification of the two error hierarchies (`AgentError` vs
  `BusinessLogicException`) — only physical file merges.
- No change to the dev script (`--env-file .env` stays; it becomes redundant but
  harmless once env reads go through settings).

## Baseline (established before work; treat as known-pre-existing)

- `ruff check agents tests` — clean.
- `mypy agents tests` — **1 error**: `agents/apps/agent/repositories/mcp_client.py:98`
  `Variable "item_py" is not valid as a type [valid-type]`. **In scope to fix** (bonus),
  so the end state is **0 mypy errors**.
- `pytest -m 'not integration'` — 135 passed, **1 failed**:
  `tests/apps/search/test_router.py::test_search_returns_rag_results` (requires a live,
  version-compatible Qdrant; environmental). **Out of scope**; must not regress further.

## Toolchain facts that constrain the design

- `mypy` runs with `strict = true`, `python_version = "3.12"`, `pydantic.mypy` plugin.
  This is the primary safety net: every missed rename / broken import / broken
  forward-ref surfaces as a mypy error.
- `ruff` (`E,F,W,I,N,B,UP,ASYNC,RUF`) does **not** auto-add or auto-remove
  `from __future__ import annotations`; that sweep is manual.
- On the 3.12 target, modern syntax (`X | Y`, `list[str]`, `Self`) is native — so
  `from __future__ import annotations` is not required anywhere once the single
  `TYPE_CHECKING` annotation in `errors.py` is quoted.
- fast_clean's `ContainerManager` auto-discovers every module named `depends` and
  registers every module-level `dishka.Provider` instance found in it. **Therefore
  the dishka `Provider` must remain in `depends.py`** — "clean depends" means
  depends.py holds *only* the Provider.
- fast_clean's exception handlers map `BusinessLogicException`→400, `PermissionDenied`→403,
  `ModelNotFound`→404, `ModelAlreadyExists`→409. **There is no 401 handler.** JWT
  failures must therefore be translated to `HTTPException(401)` at the presentation
  edge (a guard), not by raising a domain error and relying on a global handler.
- dishka FastAPI integration exposes the request-scoped container at
  `request.state.dishka_container`; `.get()` on it resolves APP-scoped services too.
- pydantic-settings (`CoreSettingsSchema`): `env_file='.env'`, `env_nested_delimiter='__'`,
  `case_sensitive=False`, `extra='ignore'`. A flat scalar field `foo_bar` reads env
  `FOO_BAR`. The 3 target vars already exist in `apps/agents/.env`.

## Rules → concrete changes

### Rule 1 — remove `from __future__ import annotations` where not required

Remove from **all** `apps/agents` files (source + tests; ~40 files). Nothing requires
it on the 3.12 target after Rule 2's `errors.py` annotation is quoted. mypy verifies
no forward-ref regressions.

### Rule 2 — no `*_shared`; merge into `errors` / `enums`

- `agents/apps/agent/enums_shared.py` → move `ModelProviderEnum`, `RoleEnum` into
  `agents/apps/agent/enums.py`; **delete** `enums_shared.py`.
  - Update imports (per blast-radius audit): `schemas.py`, `repositories/model_factory.py`,
    `services/history_compactor.py`, `processing/schemas.py`,
    `processing/repositories/embedding_factory.py`, and tests
    (`test_model_factory.py`, `test_embedding_factory.py`, `test_vectorize_page.py`,
    `test_history_compactor.py`, `factories.py`).
  - Update `services/checkpoint_serde.py` allowlist: module `enums_shared` → `enums`
    for both enums.
- `agents/apps/agent/errors_shared.py` → move `InvalidPayloadError`, `ProviderError`,
  `UnauthorizedError`, `McpRequestError` into `agents/apps/agent/errors.py`; **delete**
  `errors_shared.py`.
  - In `errors.py`, keep the `TYPE_CHECKING` import of `McpServerSchema` and quote the
    annotation: `def __init__(self, server: 'McpServerSchema', ...)` (so the merged file
    needs no `from __future__`).
  - Update imports: `repositories/model_factory.py`,
    `processing/repositories/embedding_factory.py`, and tests
    (`test_model_factory.py`, `test_embedding_factory.py`).

### Rule 3 — every schema carries the `Schema` suffix

**Move + rename:** `ServerEvent` (+ its `EventType` literal) from `events.py` into
`schemas.py` as `ServerEventSchema`; **delete** `events.py`. Update 7 import sites
(`router.py`, `use_cases/run_agent.py`, `use_cases/resume_agent.py`, the new streaming
service, tests `test_events.py`, `test_use_case_run_agent.py`).

**Rename in place** (word-boundary-aware — `PlanStep` must NOT touch `PlanStepStatus`,
which is an enum and stays):

| current | new | notes |
|---|---|---|
| `ServerEvent` | `ServerEventSchema` | moved from events.py |
| `AgentRunRequest` | `AgentRunRequestSchema` | HTTP request |
| `AgentResumeRequest` | `AgentResumeRequestSchema` | HTTP request |
| `LlmValidationResponse` | `LlmValidationResponseSchema` | HTTP response |
| `McpValidationResponse` | `McpValidationResponseSchema` | HTTP response |
| `PlanStep` | `PlanStepSchema` | embedded; serde allowlist line |
| `MemoryItem` | `MemoryItemSchema` | embedded; serde allowlist line |
| `MemoryWrite` | `MemoryWriteSchema` | embedded; serde allowlist line |
| `Citation` | `CitationSchema` | embedded; serde allowlist line |
| `PendingConfirmation` | `PendingConfirmationSchema` | embedded; serde allowlist line |
| `EmbeddingValidationRequest` (processing) | `EmbeddingValidationRequestSchema` | |
| `EmbeddingValidationResponse` (processing) | `EmbeddingValidationResponseSchema` | |

**Kept unsuffixed (deliberate):** only `AgentState` (LangGraph graph state) and
`AgentContext` (auth context). Already-suffixed models (`ModelSettingsSchema`,
`ModelConfigSchema`, `ConversationMessageSchema`, `McpServerSchema`, `RagDocumentSchema`,
plus all of `processing/`+`search/`) are unchanged.

`services/checkpoint_serde.py` allowlist updates: rename the 5 embedded-model
qualnames; **leave** `AgentState`, `AgentContext`, `ConversationMessageSchema`,
`McpServerSchema`, `ModelConfigSchema`, `ModelSettingsSchema`, the 4 `enums.*`, and the
2 `processing.schemas.*` entries. (Renaming the 5 embedded models invalidates any
in-flight *paused* checkpoint — acceptable: paused runs are ephemeral, and the enum
module move already invalidates them.)

### Rules 4 + 5 + 9 — every function in an architecture entity; `depends.py` clean

New **service** `agents/apps/agent/services/jwt_verifier.py`:
```
class JwtVerifierService:
    def __init__(self, secret_b64: str | None, audience: str) -> None
    def verify_chat(self, token: str) -> AgentContext      # was verify_agents_jwt core
    def verify_service(self, token: str) -> None            # was verify_agents_service_token core
    # private: _secret() -> bytes, _decode(token) -> dict, _context_from_claims(claims)
```
- `_audience` → constructor arg from `settings.better_auth_jwt_agents_audience`.
- `_secret` → constructor takes `settings.agents_jwt_secret`; `_secret()` keeps the lazy
  base64/length validation, still raising `JwtVerificationError`.
- `claims_to_context` → private `_context_from_claims`.
- `verify_agents_jwt_for_test` → **deleted**; `test_jwt_verify.py` drives
  `JwtVerifierService(...).verify_chat(token)` directly.

New **presentation** module `agents/apps/agent/guards.py`:
```
async def verify_agents_jwt(authorization: Header, request: Request) -> AgentContext
async def verify_agents_service_token(authorization: Header, request: Request) -> None
```
- Each resolves `JwtVerifierService` from `request.state.dishka_container`, calls it, and
  maps `JwtVerificationError` → `HTTPException(401)` (preserving current status/detail).
- `router.py` and `validation/router.py` import the guard from `.guards` (only the import
  path changes; `Depends(...)` usage is identical).

New **service** `agents/apps/agent/services/graph_streaming.py`:
```
class GraphStreamingService:
    async def stream(self, graph, input, config, initial_state: AgentState) -> AsyncIterator[ServerEventSchema]
    # private methods: _process_values_chunk, _process_updates_chunk, _interrupt_events,
    #                  _yield_final_events, _diff_plan_events, _node_events, _Done sentinel
```
- `use_cases/_streaming.py` → **deleted**; its body becomes this service.
- `RunAgentUseCase` / `ResumeAgentUseCase` (`@dataclass`) gain a
  `streaming_service: GraphStreamingService` field and call `self.streaming_service.stream(...)`
  instead of the free `stream_graph(...)`.

`agents/apps/agent/depends.py` final state: **only** `AgentProvider` + `agent_provider`.
`AgentProvider` gains:
- `jwt_verifier` provider (APP scope; settings via `SettingsRepositoryProtocol`).
- `graph_streaming_service` provider.
- `action_log_repo` / `memory_writer_client` become async + read `settings.web_base_url`
  (replacing `_web_url()`).
- `run_agent_use_case` / `resume_agent_use_case` pass `streaming_service=...`.

### Rule 6 — repeated logic → `utils.py`

New `agents/apps/agent/utils.py` → `extract_bearer_token(authorization: str) -> str | None`
(pure, framework-agnostic). Used by both guards (raise 401 on `None`) and both router
handlers (`jwt_token = extract_bearer_token(authorization) or ''`), removing the
duplicated `authorization.split(' ', 1)[1]` / `partition(' ')` parsing.

### Rule 7 — env only via settings

Add to `agents/settings.py::SettingsSchema`:
```
agents_jwt_secret: str | None = None
better_auth_jwt_agents_audience: str = 'agents'
web_base_url: str = 'http://localhost:3000'
```
Remove the 3 `os.environ.get(...)` reads from `depends.py`. (Defaults mirror the prior
`os.environ.get` fallbacks; `agents_jwt_secret` stays optional so non-chat deployments
start, with the lazy `JwtVerifierService._secret()` raising only on use.)

### Rule 8 — `__init__` re-exports via `as`, not `__all__`

- `agent/repositories/__init__.py` — convert to `from .x import Y as Y`, drop `__all__`.
- `processing/repositories/__init__.py` — drop the redundant `__all__` (already `as`).
- `processing/use_cases/__init__.py` — convert to `as`, drop `__all__`.
- `agent/services/__init__.py` (currently empty) — add `as` re-exports for
  `JwtVerifierService`, `GraphStreamingService`.
- `agent/use_cases/__init__.py`, `processing/services/__init__.py` — already `as`; no change.

### Bonus — `mcp_client.py:98`

Fix the dynamic `list[item_py]` generic construction so mypy strict passes (targeted
`cast`/restructure; `# type: ignore[valid-type]` only if no clean restructure — note
`warn_unused_ignores=true` means it must be genuinely needed). End state: 0 mypy errors.

## New file layout (agent module)

```
apps/agent/
  depends.py            # ONLY AgentProvider + agent_provider
  guards.py             # NEW: FastAPI auth guards (presentation)
  utils.py              # NEW: extract_bearer_token
  enums.py              # + ModelProviderEnum, RoleEnum   (enums_shared.py deleted)
  errors.py             # + InvalidPayload/Provider/Unauthorized/McpRequest (errors_shared.py deleted)
  schemas.py            # + ServerEventSchema/EventType   (events.py deleted); models suffixed
  router.py
  repositories/__init__.py        # `as` re-exports, no __all__
  services/
    __init__.py                   # `as` re-exports incl. the 2 new services
    jwt_verifier.py               # NEW
    graph_streaming.py            # NEW
    ... (existing)
  use_cases/
    __init__.py                   # already `as`
    run_agent.py / resume_agent.py  # + streaming_service field   (_streaming.py deleted)
    validate_provider.py
```

## Execution strategy

Phased; after **each** phase run `ruff check` + `mypy agents tests` + `pytest -m 'not integration'`
and confirm: ruff clean, mypy ≤ baseline (→ 0 after the bonus phase), pytest = 135 passed
/ 1 known-env-fail. Suggested phase order (leaf-first, each on a green tree):

1. Settings (Rule 7) — add fields; no consumers yet.
2. Merge `*_shared` (Rule 2) + serde enum-module fix.
3. Schema suffixes + `events.py`→`schemas.py` (Rule 3) + serde qualname fixes.
4. Extract `JwtVerifierService` + `guards.py` + `utils.py`; clean `depends.py` of JWT/_web_url (Rules 4/5/6/7).
5. Extract `GraphStreamingService`; inject into use cases (Rule 9).
6. `__init__` re-exports (Rule 8).
7. `from __future__` sweep (Rule 1).
8. Bonus mcp_client.py:98 fix; final full verify.

## Risks & mitigations

- **Word-boundary renames** (`PlanStep` vs `PlanStepStatus`): use `\bPlanStep\b`; mypy
  catches any slip (`PlanStepStatus` is referenced 16×).
- **Checkpoint serde**: only the 5 embedded-model qualnames + 2 enum modules change in the
  allowlist; in-flight paused runs break (accepted). New runs serialize/deserialize fine.
- **401 preservation**: guards keep raising `HTTPException(401)`; verified by
  `test_verify_service_token.py` and `test_jwt_verify.py` (the latter rewritten onto the
  service). Do not route JWT failures through `BusinessLogicException` (would become 400).
- **`__future__` removal**: only `errors.py` has a `TYPE_CHECKING` annotation; quote it.
  mypy strict is the backstop for any other forward-ref.
- **dishka in guards**: `request.state.dishka_container.get(JwtVerifierService)` — APP-scoped
  service resolves through the request container.
```
