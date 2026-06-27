# Performance Audit Quick-Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 8 low-risk, high-value quick-wins from the 2026-06-27 performance & architecture audit (`docs/superpowers/specs/2026-06-27-performance-architecture-audit-design.md` §2), each independently committable.

**Architecture:** Eight self-contained tasks across four runtimes (engines/NestJS, agents/Python, web/Next.js, domain/TS). Task 1 (the only real bug — indexer ignoring encrypted credentials) extracts a shared decrypt-first resolver into `@repo/auth` so web and engines stop diverging. The rest are bounded fetches, parallelized queries, an O(n) rewrite, a Qdrant index, and a recursion guard. No new infrastructure; no Redis; nothing gated on the multi-replica decision.

**Tech Stack:** TypeScript (NestJS 11, Next.js 16, Prisma 7, vitest, jest), Python 3.13 (FastAPI/LangGraph, pytest, qdrant-client ≥1.12), Turborepo/pnpm workspaces.

**Task order (independent — can be done in any order, but listed by risk/value):**
1. X1 — indexer `connectionEnc` bug (the only correctness fix) — engines + auth
2. X2 — billing renewal cron Sentry guard — engines
3. R2 — Qdrant payload index — agents
4. R4 — agent recursion limit + graceful degrade — agents
5. D1 — bound chat-history message fetch — web
6. D4 — cap BOARD grouping rows — domain
7. A3 — O(n) `flattenTree` — web
8. W1 — drop redundant client `getMyRole` query — web

**Conventions (apply to every task):**
- Prettier: `semi: false`, single quotes, trailing commas, 100-char width. Run `pnpm format` if unsure.
- Conventional Commits with scope. Husky runs lint-staged + gates on commit — never `--no-verify`.
- Commit messages end with the `Co-Authored-By` trailer (omitted from the snippets below for brevity — add it).

---

## Task 1: X1 — Indexer ignores `connectionEnc` (encrypted-cred workspaces never index)

The indexer cron selects only plaintext `provider.connection` and passes it to `parseAiProviderConnection`, which **throws** on the empty `{}` that every workspace-configured provider now stores (real creds live in `connectionEnc`). Pages FAIL after 5 outbox attempts and never index. Web already decrypts `connectionEnc` first via `apps/web/src/lib/chat/provider-connection.ts`; engines is the lone divergent path. Fix: extract the decrypt-first resolver into `@repo/auth`, have both web and engines use it, and make the indexer select + resolve `connectionEnc`.

**Files:**
- Create: `packages/auth/src/provider-connection.ts`
- Modify: `packages/auth/src/index.ts`
- Test: `packages/auth/test/provider-connection.test.ts` (create; check `packages/auth` test setup first — see Step 1)
- Modify: `apps/web/src/lib/chat/provider-connection.ts` (re-export the moved fn — keep the import path stable for existing callers)
- Modify: `apps/engines/package.json` (add `@repo/auth` dep)
- Modify: `apps/engines/src/apps/indexer/cron/vectorization-cron.service.ts:161-172,197`
- Test: `apps/engines/src/apps/indexer/cron/vectorization-cron.service.spec.ts`

- [ ] **Step 1: Confirm the auth package test runner**

Run: `cat packages/auth/package.json | grep -A2 '"test"'` and `ls packages/auth/test 2>/dev/null || ls packages/auth/src/*.test.ts 2>/dev/null`
Expected: identifies vitest vs jest and the test file location convention. Use that runner/location for the new test below (the plan assumes vitest + a `test/` dir; adjust the command and path if the package differs).

- [ ] **Step 2: Write the failing test for the shared resolver**

Create `packages/auth/test/provider-connection.test.ts` (the resolver is pure given a `decryptSecret`; we test precedence + the empty-object fallthrough). This mirrors the exact web behavior so we can delete the web copy:

```typescript
import { describe, it, expect } from 'vitest'
import { resolveProviderConnection } from '../src/provider-connection'

describe('resolveProviderConnection', () => {
  it('returns plaintext connection when connectionEnc is absent', () => {
    const out = resolveProviderConnection({
      workspaceId: 'w1',
      connection: { baseUrl: 'http://ollama:11434' },
      connectionEnc: null,
    })
    expect(out).toEqual({ baseUrl: 'http://ollama:11434' })
  })

  it('returns {} when both are empty', () => {
    expect(
      resolveProviderConnection({ workspaceId: null, connection: {}, connectionEnc: null }),
    ).toEqual({})
  })

  it('drops non-string values from the plaintext connection', () => {
    const out = resolveProviderConnection({
      workspaceId: null,
      connection: { apiKey: 'sk', nested: { x: 1 }, n: 5 },
      connectionEnc: null,
    })
    expect(out).toEqual({ apiKey: 'sk' })
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @repo/auth test -- provider-connection`
Expected: FAIL — `Cannot find module '../src/provider-connection'`.

- [ ] **Step 4: Create the shared resolver**

Create `packages/auth/src/provider-connection.ts` (verbatim move of the web function, which already imports `decryptSecret`/`EncryptedPayload` from this same package — now a local import):

```typescript
import { decryptSecret, type EncryptedPayload } from './secret-encryption'

/**
 * Resolve a provider's effective connection record, preferring encrypted
 * credentials (`connectionEnc`) over the plaintext `connection`. Global
 * providers (workspaceId null) also store their creds in connectionEnc, so the
 * two fields are NOT mutually exclusive. Returns a flat string→string map;
 * non-string values are dropped.
 *
 * Single source of truth for both apps/web (chat) and apps/engines (indexer) —
 * keeping these in sync previously failed silently (see audit X1).
 */
export function resolveProviderConnection(provider: {
  workspaceId: string | null
  connection: unknown
  connectionEnc: unknown
}): Record<string, string> {
  let raw: unknown
  if (provider.connectionEnc) {
    try {
      raw = JSON.parse(decryptSecret(provider.connectionEnc as EncryptedPayload))
    } catch (e) {
      throw new Error('Failed to decrypt provider credentials', { cause: e })
    }
  } else {
    raw = provider.connection
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}
```

- [ ] **Step 5: Export it from the auth barrel**

Modify `packages/auth/src/index.ts` — add after the existing `secret-encryption` re-export:

```typescript
export { resolveProviderConnection } from './provider-connection'
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @repo/auth test -- provider-connection`
Expected: PASS (3 tests).

- [ ] **Step 7: Re-point the web copy at the shared resolver**

Replace the body of `apps/web/src/lib/chat/provider-connection.ts` with a re-export so every existing web caller keeps working unchanged:

```typescript
export { resolveProviderConnection } from '@repo/auth'
```

- [ ] **Step 8: Verify web still type-checks**

Run: `rm -rf apps/web/.next/types && pnpm --filter web check-types`
Expected: PASS (no callers of `resolveProviderConnection` broke; the `.next/types` clear avoids stale-route TS2307).

- [ ] **Step 9: Add `@repo/auth` to engines deps**

Modify `apps/engines/package.json` — add to `dependencies` (alphabetical, next to the other `@repo/*`):

```json
    "@repo/auth": "workspace:*",
```

Run: `pnpm install`
Expected: lockfile updates, `@repo/auth` symlinked into `apps/engines/node_modules`.

- [ ] **Step 10: Write the failing engines test (encrypted-creds fixture)**

In `apps/engines/src/apps/indexer/cron/vectorization-cron.service.spec.ts`, the existing fixture (lines 8-12) uses plaintext `connection`. Add a NEW test that gives the provider an empty `connection` plus a populated `connectionEnc`, and asserts the indexer resolves the decrypted creds (not throws/retries). Mirror the existing `makePrismaMock` shape. The mock must extend the `provider` select to include `connectionEnc`. Add near the existing provider-parse-failure test (~line 309):

```typescript
  it('indexes when provider creds live in connectionEnc (encrypted)', async () => {
    // Encrypt a known connection with the same SECRETS_ENCRYPTION_KEY the test env sets.
    const enc = encryptSecret(JSON.stringify({ baseUrl: 'http://ollama:11434' }))
    const prisma = makePrismaMock({
      rows: [makeUpsertRow()],
      page: makeTextPage(),
      aiSettings: {
        embeddingsModel: {
          slug: 'nomic-embed-text',
          vectorSize: 768,
          provider: { slug: 'ollama', connection: {}, connectionEnc: enc },
        },
      },
    })
    const vectorize = jest.fn().mockResolvedValue(undefined)
    const svc = makeService(prisma, { vectorize })

    await svc.drainOnce()

    expect(vectorize).toHaveBeenCalledWith(
      expect.objectContaining({
        connection: { provider: 'ollama', baseUrl: 'http://ollama:11434' },
      }),
    )
  })
```

Notes for the implementer:
- Import `encryptSecret` from `@repo/auth` at the top of the spec.
- `makeUpsertRow`, `makeTextPage`, `makeService`, `drainOnce` are illustrative names — use the spec's actual fixture/entry helpers (read the file; the existing "calls agents for TEXT page" test at lines 61-102 shows the real names).
- Ensure the jest env has `SECRETS_ENCRYPTION_KEY` set (check `apps/engines/jest.setup.cjs`; if absent, set a base64 32-byte test key there — a missing key makes `encryptSecret`/`decryptSecret` throw).

- [ ] **Step 11: Run it to verify it fails**

Run: `pnpm --filter engines test -- vectorization-cron`
Expected: FAIL — current code selects only `connection`, so `connectionEnc` is undefined in the mock result and `parseAiProviderConnection('ollama', {})` throws → `vectorize` not called.

- [ ] **Step 12: Fix the indexer select + resolution**

In `apps/engines/src/apps/indexer/cron/vectorization-cron.service.ts`:

First, extend the provider select (was lines 161-172) to include `connectionEnc` and `workspaceId`:

```typescript
      const aiSettings = await this.prisma.workspaceAiSettings.findUnique({
        where: { workspaceId: row.workspace_id },
        select: {
          embeddingsModel: {
            select: {
              slug: true,
              vectorSize: true,
              provider: {
                select: { slug: true, connection: true, connectionEnc: true, workspaceId: true },
              },
            },
          },
        },
      })
```

Then replace the resolution line (was 197). Add the import at the top of the file:

```typescript
import { resolveProviderConnection } from '@repo/auth'
import { parseAiProviderConnection } from '@repo/db'
```

and change the resolution to decrypt-first, then validate:

```typescript
      const resolved = resolveProviderConnection(model.provider)
      const connection = parseAiProviderConnection(model.provider.slug, resolved)
```

(`parseAiProviderConnection` still runs — it validates the resolved record against the provider schema. The fix is feeding it the decrypted creds instead of the empty `{}`.)

- [ ] **Step 13: Run the engines tests to verify they pass**

Run: `pnpm --filter engines test -- vectorization-cron`
Expected: PASS — new encrypted test passes; the existing plaintext test (lines 61-102) still passes because `resolveProviderConnection` returns plaintext when `connectionEnc` is null; the existing empty-connection retry test (lines 309-353) still passes because empty `connection` + null `connectionEnc` resolves to `{}` and `parseAiProviderConnection` still throws.

- [ ] **Step 14: Commit**

```bash
git add packages/auth/src/provider-connection.ts packages/auth/src/index.ts packages/auth/test/provider-connection.test.ts apps/web/src/lib/chat/provider-connection.ts apps/engines/package.json apps/engines/src/apps/indexer/cron/vectorization-cron.service.ts apps/engines/src/apps/indexer/cron/vectorization-cron.service.spec.ts pnpm-lock.yaml
git commit -m "fix(indexer): resolve encrypted provider creds via shared connectionEnc resolver

Indexer selected only plaintext connection and threw on the empty {} that
workspace-configured providers store in connectionEnc, so those workspaces
silently never indexed. Extract the decrypt-first resolver to @repo/auth
(shared by web + engines) and have the indexer select + resolve connectionEnc.
Closes audit X1."
```

---

## Task 2: X2 — Billing renewal cron has no Sentry capture (money path)

`subscription-renewal-cron.service.ts` is the only `@Cron` lacking a top-level try/catch + `Sentry.captureException`. `SentryGlobalFilter` does NOT catch `@Cron` errors, so a DB blip in the batch-claim (`expireCanceled`, or the pre-loop `findMany` in `renewActive`) vanishes from ops on the money path. Mirror the webhook cron's exact idiom.

**Files:**
- Modify: `apps/engines/src/apps/billing/cron/subscription-renewal-cron.service.ts:12-19`
- Test: `apps/engines/src/apps/billing/cron/subscription-renewal-cron.service.spec.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create `apps/engines/src/apps/billing/cron/subscription-renewal-cron.service.spec.ts`. The cron must swallow + report a thrown batch error instead of propagating it. Mock the renewal service and `@sentry/nestjs`:

```typescript
import * as Sentry from '@sentry/nestjs'
import { SubscriptionRenewalCronService } from './subscription-renewal-cron.service'

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }))

describe('SubscriptionRenewalCronService', () => {
  afterEach(() => jest.clearAllMocks())

  it('captures to Sentry and does not throw when expireCanceled fails', async () => {
    const renewal = {
      expireCanceled: jest.fn().mockRejectedValue(new Error('db down')),
      renewActive: jest.fn().mockResolvedValue(undefined),
    }
    const svc = new SubscriptionRenewalCronService(renewal as never)

    await expect(svc.handleRenewals()).resolves.toBeUndefined()

    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ service: 'engines', worker: 'billing-renewal' }),
      }),
    )
  })
})
```

Note: confirm the constructor signature of `SubscriptionRenewalCronService` (how `renewal` is injected) and adjust the instantiation — read the existing service file.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter engines test -- subscription-renewal-cron`
Expected: FAIL — the unguarded `await this.renewal.expireCanceled()` rejects, `handleRenewals` throws, the `resolves` assertion fails and `captureException` is never called.

- [ ] **Step 3: Add the try/catch + Sentry guard**

In `apps/engines/src/apps/billing/cron/subscription-renewal-cron.service.ts`, add the import (if absent) and wrap the method body. The current body is:

```typescript
  async handleRenewals(): Promise<void> {
    this.logger.log('Starting subscription renewal cron')
    await this.renewal.expireCanceled()
    await this.renewal.renewActive()
  }
```

Add at the top of the file:

```typescript
import * as Sentry from '@sentry/nestjs'
```

and replace the method body:

```typescript
  async handleRenewals(): Promise<void> {
    this.logger.log('Starting subscription renewal cron')
    try {
      await this.renewal.expireCanceled()
      await this.renewal.renewActive()
    } catch (err) {
      this.logger.error('subscription renewal cron failed', err)
      Sentry.captureException(err, {
        tags: { service: 'engines', worker: 'billing-renewal', integration: 'billing' },
      })
    }
  }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter engines test -- subscription-renewal-cron`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/engines/src/apps/billing/cron/subscription-renewal-cron.service.ts apps/engines/src/apps/billing/cron/subscription-renewal-cron.service.spec.ts
git commit -m "fix(billing): capture renewal cron batch errors to Sentry

SentryGlobalFilter does not catch @Cron errors, so a DB failure in the renewal
batch-claim vanished from ops on the money path. Wrap handleRenewals in the
same try/catch + captureException the sibling crons use. Closes audit X2."
```

---

## Task 3: R2 — Qdrant payload index on `workspaceId` / `pageId`

Collections are created with only `VectorParams` — no `create_payload_index` anywhere. Every per-tenant filter (`workspaceId` on each RAG query; `pageId` on each per-page delete) is an unindexed payload scan over a collection holding ALL workspaces sharing an embedding model. Add idempotent keyword payload indexes in `ensure_collection`, run unconditionally so pre-existing collections get indexed too.

**Files:**
- Modify: `apps/agents/agents/apps/processing/repositories/vector_store_repository.py:37-46`
- Test: `apps/agents/tests/apps/processing/test_vector_store_repository.py`

- [ ] **Step 1: Write the failing test**

In `apps/agents/tests/apps/processing/test_vector_store_repository.py`, add a test asserting `create_payload_index` is called for both fields. Match the existing `_make_repo`/`AsyncMock` style:

```python
@pytest.mark.asyncio
async def test_ensure_collection_creates_payload_indexes() -> None:
    client = AsyncMock()
    client.create_collection = AsyncMock()
    client.create_payload_index = AsyncMock()
    repo = _make_repo(client=client)

    await repo.ensure_collection(COLLECTION, VECTOR_SIZE)

    indexed_fields = {
        call.kwargs.get('field_name') or call.args[1]
        for call in client.create_payload_index.call_args_list
    }
    assert {'workspaceId', 'pageId'} <= indexed_fields
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/agents && uv run pytest tests/apps/processing/test_vector_store_repository.py::test_ensure_collection_creates_payload_indexes -v`
Expected: FAIL — `create_payload_index` never called.

- [ ] **Step 3: Add the payload indexes**

In `apps/agents/agents/apps/processing/repositories/vector_store_repository.py`, add `PayloadSchemaType` to the existing `qdrant_client.http.models` import:

```python
from qdrant_client.http.models import (
    Distance,
    FieldCondition,
    Filter,
    MatchValue,
    PayloadSchemaType,
    PointStruct,
    VectorParams,
)
```

Then extend `ensure_collection` (was lines 37-46) to create indexes after the collection exists. Both `create_collection` (on first run) and the indexes are idempotent — Qdrant returns the existing index without error, so running unconditionally backfills pre-existing collections:

```python
    async def ensure_collection(self, name: str, vector_size: int) -> None:
        try:
            await self.client.create_collection(
                name,
                vectors_config=VectorParams(size=vector_size, distance=Distance.COSINE),
            )
        except UnexpectedResponse as e:
            # 409: collection already exists — idempotent, safe to ignore.
            if e.status_code != 409:
                raise
        # Payload indexes make the per-tenant filter (workspaceId on every RAG
        # query, pageId on every per-page delete) an indexed lookup instead of a
        # full payload scan. Idempotent — run unconditionally so pre-existing
        # collections get backfilled.
        for field in ('workspaceId', 'pageId'):
            await self.client.create_payload_index(
                collection_name=name,
                field_name=field,
                field_schema=PayloadSchemaType.KEYWORD,
            )
```

- [ ] **Step 4: Run the new test to verify it passes**

Run: `cd apps/agents && uv run pytest tests/apps/processing/test_vector_store_repository.py::test_ensure_collection_creates_payload_indexes -v`
Expected: PASS.

- [ ] **Step 5: Run the full repository test file (regression)**

Run: `cd apps/agents && uv run pytest tests/apps/processing/test_vector_store_repository.py -v`
Expected: PASS — `test_ensure_collection_creates_when_missing` still passes (it only asserts the collection name was passed; the added index calls don't affect it).

- [ ] **Step 6: Commit**

```bash
git add apps/agents/agents/apps/processing/repositories/vector_store_repository.py apps/agents/tests/apps/processing/test_vector_store_repository.py
git commit -m "perf(agents): add Qdrant payload indexes on workspaceId/pageId

Collections held all tenants sharing an embedding model with no payload index,
so every per-tenant RAG filter and per-page delete was a full payload scan. Add
idempotent KEYWORD indexes in ensure_collection (backfills existing
collections). Closes audit R2."
```

---

## Task 4: R4 — Agent recursion limit + tool-call budget + graceful degrade

The graph is invoked with no explicit `recursion_limit`; the default-25 super-step limit is the only backstop and `GraphRecursionError` surfaces as an unrecoverable `INTERNAL_ERROR` (the already-computed `draft_answer` is discarded). Set an explicit limit and, on `GraphRecursionError`, emit a recoverable partial answer from `draft_answer` instead of a hard error.

**Files:**
- Modify: `apps/agents/agents/apps/agent/use_cases/run_agent.py:119-142`
- Test: `apps/agents/tests/apps/agent/test_use_case_run_agent.py`

- [ ] **Step 1: Confirm `GraphRecursionError` import path**

Run: `cd apps/agents && uv run python -c "from langgraph.errors import GraphRecursionError; print('ok')"`
Expected: `ok`. (If it errors, find the correct path: `uv run python -c "import langgraph.errors as e; print([n for n in dir(e) if 'Recursion' in n])"` and use that.)

- [ ] **Step 2: Write the failing test**

In `apps/agents/tests/apps/agent/test_use_case_run_agent.py`, add a test that forces the streaming service to raise `GraphRecursionError` and asserts the use case emits a recoverable partial answer rather than `INTERNAL_ERROR(recoverable=False)`. Reuse the existing fixture style (`make_context`, `AgentRunRequestSchema`, direct iteration). The cleanest seam is to inject a `streaming_service` whose `stream` raises:

```python
@pytest.mark.asyncio
async def test_run_agent_emits_recoverable_partial_on_recursion_limit() -> None:
    from langgraph.errors import GraphRecursionError

    class BoomStreaming:
        async def stream(self, graph, initial, config, init):  # noqa: ANN001
            # Assert the use case set an explicit recursion_limit on the config.
            assert config.get('recursion_limit') is not None
            raise GraphRecursionError('Recursion limit reached')
            yield  # make this an async generator

    use_case = RunAgentUseCase(
        llm_factory=lambda model, reasoning=None: MagicMock(),
        mcp_client=AsyncMock(discover_all=AsyncMock(return_value={}), build_langchain_tools=lambda d, s: []),
        rag_service=AsyncMock(retrieve=AsyncMock(return_value=[])),
        memory_writer_client=AsyncMock(write_batch=AsyncMock(return_value=None)),
        action_log_repo=AsyncMock(write_batch=AsyncMock(return_value=None)),
        renderer=MagicMock(
            render_router=lambda **kw: 'p', render_planner=lambda **kw: 'p',
            render_executor=lambda **kw: 'p', render_critic=lambda **kw: 'p',
        ),
        checkpointer=MemorySaver(),
        streaming_service=BoomStreaming(),
    )

    context = make_context()
    request = AgentRunRequestSchema.model_validate({
        'chat_id': str(context.chat_id),
        'user_message': 'hi',
        'chat_history': [],
        'model': {'provider': 'openai', 'name': 'gpt-4o-mini',
                  'connection': {'api_key': 'sk'}, 'settings': {}},
    })

    events = [ev async for ev in use_case(request=request, context=context, jwt='jwt')]
    error_events = [e for e in events if e.type == 'error']
    assert error_events, 'expected an error event'
    # Recoverable, not the hard INTERNAL_ERROR(recoverable=False).
    assert error_events[0].recoverable is True
```

Note: confirm `make_context`, `RunAgentUseCase`, `MemorySaver`, `MagicMock`, `AsyncMock`, `AgentRunRequestSchema` are imported in the test module (the existing `test_run_agent_streams_router_decision_first` uses all of them — copy its imports).

- [ ] **Step 3: Run it to verify it fails**

Run: `cd apps/agents && uv run pytest tests/apps/agent/test_use_case_run_agent.py::test_run_agent_emits_recoverable_partial_on_recursion_limit -v`
Expected: FAIL on two counts — `config` has no `recursion_limit` key (assert inside `BoomStreaming.stream`), and the generic `except Exception` emits `recoverable=False`.

- [ ] **Step 4: Set the explicit limit + catch GraphRecursionError**

In `apps/agents/agents/apps/agent/use_cases/run_agent.py`:

Add the import near the top:

```python
from langgraph.errors import GraphRecursionError
```

Set an explicit `recursion_limit` on the config (was line 119). Pick a value strictly above the default-25 so genuine multi-tool flows aren't cut short, but bounded — `50` doubles the headroom:

```python
config: RunnableConfig = {
    'configurable': {'thread_id': str(request.chat_id)},
    'recursion_limit': 50,
}
```

Then add a `GraphRecursionError` branch BEFORE the generic `except Exception` (was lines 133-140):

```python
        try:
            async for event in self.streaming_service.stream(graph, initial, config, initial):
                yield event
        except GraphRecursionError as exc:
            # The agent exhausted its step budget. Surface a recoverable error so
            # the client can retry/continue rather than treating it as a crash.
            sentry_sdk.capture_exception(exc)
            log.warning('agent hit recursion limit')
            yield ServerEventSchema.error(
                'RECURSION_LIMIT',
                'The assistant reached its step limit before finishing. Try narrowing the request.',
                recoverable=True,
            )
            return
        except Exception as exc:
            sentry_sdk.capture_exception(exc)
            log.exception('agent run failed')
            yield ServerEventSchema.error('INTERNAL_ERROR', str(exc), recoverable=False)
            return
```

Note: verify `ServerEventSchema.error` accepts `recoverable` as a kwarg (the existing call passes it positionally/by-keyword — match its signature). `'RECURSION_LIMIT'` is a new error code string; if the client enumerates error codes, this is additive (recoverable=True path), but check there's no exhaustive switch that would break.

- [ ] **Step 5: Run the new test to verify it passes**

Run: `cd apps/agents && uv run pytest tests/apps/agent/test_use_case_run_agent.py::test_run_agent_emits_recoverable_partial_on_recursion_limit -v`
Expected: PASS.

- [ ] **Step 6: Run the run-agent test file (regression)**

Run: `cd apps/agents && uv run pytest tests/apps/agent/test_use_case_run_agent.py -v`
Expected: PASS — `test_run_agent_streams_router_decision_first` and the others still pass (the explicit `recursion_limit: 50` is well above the few steps those happy-path tests take).

- [ ] **Step 7: Commit**

```bash
git add apps/agents/agents/apps/agent/use_cases/run_agent.py apps/agents/tests/apps/agent/test_use_case_run_agent.py
git commit -m "feat(agents): explicit recursion_limit + recoverable degrade on overrun

Default-25 GraphRecursionError surfaced as an unrecoverable INTERNAL_ERROR,
discarding the draft answer. Set recursion_limit=50 and emit a recoverable
RECURSION_LIMIT event on overrun so the client can retry. Closes audit R4."
```

---

## Task 5: D1 — Bound the chat-history per-chat message fetch

`buildChatHistoryMessages` runs one `chatMessage.findMany` per ancestor chat with NO `take`, loading every DONE message (heavy `parts` JSON) only to keep the first + last N in JS. The `(chatId, createdAt)` index already exists. Fetch a bounded DESC window (`take: lastCount + 1`, +1 to also capture the conversation's first message), then reorder ascending in JS. Behavior must stay identical to the current `pickHistory` output.

**Files:**
- Modify: `apps/web/src/lib/chat/chat-history.ts:94-98` (and the `pickHistory` interaction)
- Test: `apps/web/test/chat-history.test.ts`

- [ ] **Step 1: Read the existing slicing semantics carefully**

The current code (lines 50-60, 94-98) loads ALL DONE messages ascending, then `pickHistory` keeps `[first, ...last lastCount (excluding first)]`. To preserve this with a bounded fetch we still need the **first** message of each chat plus the **last `lastCount`**. A single DESC `take: lastCount + 1` does NOT guarantee the very first message when the chat is long. So: fetch the last window AND the first message, then merge. This keeps output identical.

- [ ] **Step 2: Write the failing test (asserts a bounded query is issued)**

In `apps/web/test/chat-history.test.ts`, extend `createPrismaMock` so `chatMessage.findMany` records its args, then add a test asserting a `take` is passed and the output still matches the existing first+last semantics. Add to the mock (around lines 28-45) a spy capture, then:

```typescript
  it('issues a bounded fetch (take) and still returns first + last N', async () => {
    const msgs = makeMessages(30, 'USER').map((m, i) => ({ ...m, id: `m${i}` }))
    const findManySpy = vi.fn(async ({ where, take, orderBy }: any) => {
      const all = msgs.filter((m) => (where.status ? m.status === where.status : true))
      // emulate prisma: apply orderBy + take
      const ordered = orderBy?.createdAt === 'desc' ? [...all].reverse() : all
      return take ? ordered.slice(0, take) : ordered
    })
    const prisma = {
      chat: { findFirst: vi.fn(async () => ({ id: 'c', parentId: null, workspaceId: 'w' })) },
      chatMessage: { findMany: findManySpy },
    }

    const out = await buildChatHistoryMessages({ prisma: prisma as never, chatId: 'c', workspaceId: 'w' })

    // A bounded fetch was used (no unbounded scan).
    const tookBounded = findManySpy.mock.calls.some(([arg]) => typeof arg.take === 'number')
    expect(tookBounded).toBe(true)
    // Current-chat semantics: first message + last 10.
    expect(out[0]).toMatchObject({ /* maps to m0 */ })
    expect(out).toHaveLength(1 + 10) // first + CURRENT_CHAT_LAST_COUNT, first not double-counted
  })
```

Adjust the exact assertions to the real return shape of `buildChatHistoryMessages` (read how `makeMessages` and the role/text mapping produce entries; the existing 15-message test at lines ~127-185 shows the expected `[first, ...last]` shape). The load-bearing assertions are: (a) a `take` was passed, (b) output equals the old first+last set.

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter web test -- chat-history`
Expected: FAIL — no `take` is currently passed (`tookBounded` is false).

- [ ] **Step 4: Implement the bounded fetch**

In `apps/web/src/lib/chat/chat-history.ts`, replace the unbounded `findMany` (lines 94-98) inside the chain loop. Fetch the last-window DESC and the first message separately, then merge in ascending order:

```typescript
    const lastCount = isCurrent ? CURRENT_CHAT_LAST_COUNT : ANCESTOR_LAST_COUNT

    // Bounded window: the last `lastCount` messages (DESC + take, served by the
    // (chatId, createdAt) index) plus the conversation's first message — exactly
    // the set pickHistory used to compute, without loading the whole chat.
    const [lastDesc, firstRows] = await Promise.all([
      args.prisma.chatMessage.findMany({
        where: { chatId: chain[i], status: 'DONE' satisfies ChatMessageStatus },
        orderBy: { createdAt: 'desc' },
        take: lastCount,
        select: { id: true, role: true, parts: true, createdAt: true },
      }) as Promise<MessageRow[]>,
      args.prisma.chatMessage.findMany({
        where: { chatId: chain[i], status: 'DONE' satisfies ChatMessageStatus },
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: { id: true, role: true, parts: true, createdAt: true },
      }) as Promise<MessageRow[]>,
    ])

    const lastAsc = [...lastDesc].reverse()
    const first = firstRows[0]
    const tail = first ? lastAsc.filter((m) => m.id !== first.id) : lastAsc
    const messages = first ? [first, ...tail] : lastAsc
```

Then this `messages` array is already in the final `[first, ...last]` shape — remove the now-redundant `pickHistory(messages, lastCount)` call at the original slicing site (the per-chat `pickHistory` is superseded; keep `pickHistory` only if another caller uses it — grep first; if unused, delete it and its test references).

- [ ] **Step 5: Run the full chat-history suite (regression)**

Run: `pnpm --filter web test -- chat-history`
Expected: PASS — all 11 existing cases still pass (they mock `findMany` returning in-memory arrays; the merge produces the same first+last output) plus the new bounded-fetch case. If a case asserted `pickHistory` directly and you removed it, update that case to assert via `buildChatHistoryMessages`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/chat/chat-history.ts apps/web/test/chat-history.test.ts
git commit -m "perf(chat): bound per-chat history fetch with take + index

buildChatHistoryMessages loaded every DONE message (heavy parts JSON) per
ancestor chat only to keep first + last N. Fetch the last window DESC via the
(chatId, createdAt) index plus the first message, merge in JS. Closes audit D1."
```

---

## Task 6: D4 — Cap BOARD grouping rows

`listGroupedRows` calls `findRowsForGrouping` without a `take`, loading every row + cells and hydrating relation/rollup for all in memory. The repository method already accepts an optional `take` (the widget path passes `MAX_WIDGET_ROWS + 1` to detect truncation). Mirror that: cap the BOARD fetch and surface a `truncated` flag.

**Files:**
- Modify: `packages/domain/src/.../database/services/database.service.ts:1374` (and `listGroupedRows` return)
- Modify: `packages/domain/src/.../database/dto/database.dto.ts` (`GroupedRowsResult` — add `truncated`)
- Test: `packages/domain/test/database/...` (find the BOARD grouping test; create if absent)

- [ ] **Step 1: Locate/confirm the BOARD grouping test**

Run: `grep -rl "listGroupedRows" packages/domain/test`
Expected: a test file, or no output (then create `packages/domain/test/database/list-grouped-rows.test.ts` mirroring the widget-aggregation test fixture style at `packages/domain/test/dashboard/widget-aggregation.test.ts`).

- [ ] **Step 2: Add `MAX_BOARD_ROWS` and write the failing test**

The widget cap `MAX_WIDGET_ROWS = 5000` lives in `dashboard.dto.ts`. Add a sibling `MAX_BOARD_ROWS` in the database dto (BOARD views are smaller than dashboards; 1000 is a focused-board ceiling). In `database.dto.ts` near `GroupedRowsResult`:

```typescript
/** Max rows a BOARD view materializes before truncating (focused-view MVP cap). */
export const MAX_BOARD_ROWS = 1000
```

Then the failing test asserts: (a) the repo is called with `take: MAX_BOARD_ROWS + 1`, (b) when overfetched, the result carries `truncated: true` and is sliced to `MAX_BOARD_ROWS`:

```typescript
import { MAX_BOARD_ROWS } from '../../src/.../database/dto/database.dto' // fix path

it('caps BOARD rows at MAX_BOARD_ROWS and flags truncated', async () => {
  const many = Array.from({ length: MAX_BOARD_ROWS + 1 }, (_, i) => row({ id: `r${i}` }))
  const fetchSpy = vi.fn(async () => many)
  const repo = makeRepo(many, { findRowsForGrouping: fetchSpy })

  const r = await makeService(repo).listGroupedRows('u1', groupedInput())

  expect(fetchSpy).toHaveBeenCalledWith(expect.objectContaining({ take: MAX_BOARD_ROWS + 1 }))
  expect(r.truncated).toBe(true)
  const total = r.groups.reduce((n, g) => n + g.rows.length, 0)
  expect(total).toBe(MAX_BOARD_ROWS)
})
```

Adjust `row`, `makeRepo`, `makeService`, `groupedInput` to the real helpers (copy from `widget-aggregation.test.ts`; `groupedInput` builds a valid `ListGroupedRowsInput` with a `groupBy` property).

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @repo/domain test -- list-grouped-rows`
Expected: FAIL — `findRowsForGrouping` called without `take`; `r.truncated` is `undefined`.

- [ ] **Step 4: Add `truncated` to the result type**

In `database.dto.ts`, extend `GroupedRowsResult`:

```typescript
export interface GroupedRowsResult {
  groups: Array<{
    key: string | null
    label: string
    color: string | null
    rows: DatabaseRowView[]
  }>
  /** True when more than MAX_BOARD_ROWS matched and the board was truncated. */
  truncated: boolean
}
```

- [ ] **Step 5: Cap the fetch in `listGroupedRows`**

In `database.service.ts` (`listGroupedRows`, ~line 1374), change the fetch to pass the cap, detect overflow, slice BEFORE grouping/`augmentRows`, and thread `truncated` into the returned object:

```typescript
    const fetched = await this.repo.findRowsForGrouping({
      sourceId: source.id,
      where: groupingWhere,
      take: MAX_BOARD_ROWS + 1,
    })
    const truncated = fetched.length > MAX_BOARD_ROWS
    const capped = truncated ? fetched.slice(0, MAX_BOARD_ROWS) : fetched
```

Use `capped` everywhere the method currently uses `fetched` (the grouping + `augmentRows` call), and add `truncated` to the returned `GroupedRowsResult`. Import `MAX_BOARD_ROWS` at the top of the service.

- [ ] **Step 6: Run the new test + the database suite (regression)**

Run: `pnpm --filter @repo/domain test -- list-grouped-rows` then `pnpm --filter @repo/domain test`
Expected: PASS. If any existing caller/test destructures `GroupedRowsResult` and now fails on the added field, it's additive — fix only genuine type errors. Check tRPC + web consumers of `listGroupedRows` for the return-shape change:

Run: `grep -rn "listGroupedRows" packages/trpc apps/web`
For each consumer, the added `truncated` field is non-breaking (extra property); if a UI should show a "showing first N" banner, that's a follow-up, not this task.

- [ ] **Step 7: Verify cross-package types**

Run: `pnpm --filter @repo/domain check-types && pnpm --filter @repo/trpc check-types && rm -rf apps/web/.next/types && pnpm --filter web check-types`
Expected: PASS (shared-model change — must check engines too if it consumes this; `grep -rn "listGroupedRows" apps/engines` — if hit, run `pnpm --filter engines check-types`).

- [ ] **Step 8: Commit**

```bash
git add packages/domain/src packages/domain/test
git commit -m "perf(database): cap BOARD grouping rows + surface truncated flag

listGroupedRows loaded and hydrated every row uncapped. Mirror the widget path:
fetch MAX_BOARD_ROWS + 1, slice, and return truncated. Closes audit D4."
```

---

## Task 7: A3 — O(n) `flattenTree`

`flattenTree` calls `orderSiblings(pages.filter(p => p.parentId === parentId))` at every recursion level — each is a full O(n) scan + Map rebuild, making the whole flatten O(n²) over the uncapped workspace page set, recomputed on every expand/reorder. Rewrite to bucket children by `parentId` once (O(n)), then DFS, ordering each sibling group with the SAME chain/dangling-head/cycle semantics `orderSiblings` already encodes. Output must be byte-identical to today's.

**Files:**
- Modify: `apps/web/src/components/workspace/types.ts:80-96`
- Test: `apps/web/test/components/workspace/flatten-tree.test.ts` (create)

- [ ] **Step 1: Write the characterization test FIRST (lock current output)**

Before changing `flattenTree`, create `apps/web/test/components/workspace/flatten-tree.test.ts` that runs the CURRENT `flattenTree` over a multi-level fixture (with a dangling-prev head and a collapsed node) and snapshots the exact `[{id, depth, collapsed}, ...]` sequence. This locks behavior so the O(n) rewrite is provably equivalent. Reuse the `PageItem` shape and the dangling-head scenarios from `order-siblings.test.ts` (lines 34-62):

```typescript
import { describe, it, expect } from 'vitest'
import { flattenTree, type PageItem } from '../../../src/components/workspace/types'

const p = (id: string, parentId: string | null, prevPageId: string | null, createdAt: string): PageItem => ({
  id, title: id, icon: null, parentId, prevPageId, collectionId: 'c',
  createdById: 'u', createdAt, type: 'TEXT',
}) as PageItem

describe('flattenTree', () => {
  it('flattens depth + order + collapse identically to orderSiblings semantics', () => {
    const pages: PageItem[] = [
      p('a', null, null, '2024-01-01'),
      p('b', null, 'a', '2024-01-02'),
      p('a1', 'a', null, '2024-01-03'),
      p('a2', 'a', 'a1', '2024-01-04'),
      // dangling-prev head: prev points outside the set → treated as a view-local head
      p('b1', 'b', 'ghost', '2024-01-05'),
    ]
    const flat = flattenTree(pages, null, 0, new Set(['a'])) // 'a' collapsed → its children hidden
    expect(flat.map((n) => ({ id: n.id, depth: n.depth, collapsed: n.collapsed }))).toEqual([
      { id: 'a', depth: 0, collapsed: true },
      { id: 'b', depth: 0, collapsed: false },
      { id: 'b1', depth: 1, collapsed: false },
    ])
  })
})
```

- [ ] **Step 2: Run it against the CURRENT implementation**

Run: `pnpm --filter web test -- flatten-tree`
Expected: PASS (this characterizes existing behavior). If the expected array above doesn't match the real output, FIX THE TEST to match what the current `flattenTree` actually returns — the test must encode today's truth before the rewrite.

- [ ] **Step 3: Rewrite `flattenTree` to O(n)**

In `apps/web/src/components/workspace/types.ts`, replace `flattenTree` (lines 80-96). Bucket children by `parentId` once, then DFS, calling `orderSiblings` per bucket (each bucket is already the per-parent sibling set, so `orderSiblings` runs on a small group, not a full-set filter). Keep `orderSiblings` exactly as-is — it owns the chain/dangling/cycle semantics:

```typescript
export function flattenTree(
  pages: PageItem[],
  parentId: string | null = null,
  depth = 0,
  collapsedIds: Set<string> = new Set(),
): FlatPageItem[] {
  // Bucket children by parentId ONCE (O(n)) instead of filtering the full set at
  // every recursion level (the old O(n²)). orderSiblings still owns chain order +
  // dangling-head + cycle semantics — it just runs per small bucket now.
  const childrenByParent = new Map<string | null, PageItem[]>()
  for (const page of pages) {
    const key = page.parentId
    const bucket = childrenByParent.get(key)
    if (bucket) bucket.push(page)
    else childrenByParent.set(key, [page])
  }

  const result: FlatPageItem[] = []
  const walk = (pid: string | null, d: number): void => {
    const siblings = orderSiblings(childrenByParent.get(pid) ?? [])
    for (const page of siblings) {
      const collapsed = collapsedIds.has(page.id)
      result.push({ ...page, depth: d, collapsed })
      if (!collapsed) walk(page.id, d + 1)
    }
  }
  walk(parentId, depth)
  return result
}
```

- [ ] **Step 4: Run the characterization test + the orderSiblings suite (regression)**

Run: `pnpm --filter web test -- flatten-tree order-siblings`
Expected: PASS — identical output (the characterization test from Step 2 is the proof of equivalence; `orderSiblings` is untouched so its 8 cases still pass).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/workspace/types.ts apps/web/test/components/workspace/flatten-tree.test.ts
git commit -m "perf(sidebar): flatten page tree in O(n) via parentId bucketing

flattenTree filtered the full page set at every recursion level (O(n^2),
recomputed on every expand/reorder). Bucket children by parentId once, then DFS;
orderSiblings semantics unchanged (locked by a characterization test). Audit A3."
```

---

## Task 8: W1 — Drop the redundant client `getMyRole` query

The `(active)` layout resolves `getMyRole` server-side (for `accessKind`), then `workspace-layout-client.tsx` re-queries the SAME membership row client-side via `useQuery` just to compute `historyEnabled`. Pass the role down as a prop and delete the client query — one fewer round-trip per navigation, no behavior change.

**Files:**
- Modify: `apps/web/src/app/(protected)/(active)/layout.tsx:22-42`
- Modify: `apps/web/src/components/workspace/workspace-layout-client.tsx:207-209` (+ props type)

- [ ] **Step 1: Pass the resolved role as a prop from the layout**

In `apps/web/src/app/(protected)/(active)/layout.tsx`, the layout already has `const myRole = await trpc.workspace.getMyRole(...)` (line 22). Add `role={myRole}` to the `<WorkspaceLayoutClient>` props (around lines 30-42):

```tsx
      <WorkspaceLayoutClient
        workspace={{ id: workspace.id, name: workspace.name, icon: workspace.icon }}
        accessKind={accessKind}
        role={myRole}
        features={features}
        pages={pages}
        user={{
          id: session.user.id,
          firstName: session.user.firstName,
          lastName: session.user.lastName,
          email: session.user.email,
          image: session.user.image ?? null,
        }}
      >
        {children}
      </WorkspaceLayoutClient>
```

- [ ] **Step 2: Accept the prop and drop the client query**

In `apps/web/src/components/workspace/workspace-layout-client.tsx`:

Add `role` to the component's props type. The exact role type is the return of `workspace.getMyRole` — a `WorkspaceMemberRole | null`. Find the existing props interface and add:

```typescript
  role: 'OWNER' | 'ADMIN' | 'EDITOR' | 'COMMENTER' | 'VIEWER' | null
```

(Confirm the exact enum members by checking the `WorkspaceMemberRole` Prisma enum / the `getMyRole` return type — use the imported type if one is exported, e.g. `import type { WorkspaceMemberRole } from '@repo/db'` and type it `WorkspaceMemberRole | null`.)

Then replace the client query (lines 207-209):

```typescript
  const historyEnabled = role === 'OWNER' || role === 'ADMIN' || role === 'EDITOR'
```

Remove the now-unused `trpc.workspace.getMyRole.useQuery(...)` line and `myRoleQ`/`role` derivation. Destructure `role` from props instead.

- [ ] **Step 3: Verify types**

Run: `rm -rf apps/web/.next/types && pnpm --filter web check-types`
Expected: PASS. If `trpc` import becomes unused, remove it; if other code read `myRoleQ.isLoading` for a loading state, replace with the now-synchronous `role` (no loading state needed — it's resolved server-side).

- [ ] **Step 4: Verify the change at runtime (RSC prop boundary)**

Per CLAUDE.md, RSC→client prop wiring on a dynamic route only fails at request time. Start the dev server and load a workspace page:

Run: `docker compose up -d` (if not running) then `pnpm --filter web dev` in the background, then `curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3000/app` (or a known page route after auth — at minimum confirm no `"Functions cannot be passed directly to Client Components"` error in the dev log for the `(active)` layout). `role` is a plain string|null — safe to cross the boundary.
Expected: route renders; history provider still gates on the role; no serialization error.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(protected)/(active)/layout.tsx" apps/web/src/components/workspace/workspace-layout-client.tsx
git commit -m "perf(web): drop redundant client getMyRole query, prop-drill role

The (active) layout already resolves getMyRole server-side; the client
re-queried the same membership row just to gate history. Pass role as a prop.
Closes audit W1."
```

---

## Final verification

- [ ] **Run the full merge gate**

Run: `pnpm gates`
Expected: `check-types`, `lint`, `check-architecture`, `build`, `test` all green (GATES_EXIT=0). The agents Python tests run via their own filter — also run `cd apps/agents && uv run pytest -m "not integration"` to cover R2/R4.

- [ ] **Integration sweep for shared-model / cross-app changes**

Tasks 1 (auth export consumed by engines) and 6 (`GroupedRowsResult` shape) touch shared code. Confirm engines + agents + web all type-check and test green (covered by `pnpm gates`, but verify the engines filter specifically ran: `pnpm --filter engines test`).
