# Pillar D — Transactional Outbox + Qdrant Indexing Pipeline Design

**Date:** 2026-04-19
**Author:** brainstormed with Claude
**Status:** Draft → pending user review

## Context

Pillars A (DB foundation) and B1 (`apps/agents` FastAPI MVP) are merged
into `main`. The agents service can run an LLM end-to-end given a
fully-formed payload, but it does NOT yet retrieve any context from the
workspace's pages — `rag.documents[]` is currently rendered into the
prompt only when the caller (apps/web) explicitly attaches it.

Pillar D builds the indexing half of the eventual RAG loop: every page
write in `apps/web` becomes a Qdrant point that downstream consumers
(Pillar E `apps/engines` MCP server, ad-hoc tRPC search) can query.

The transport between the write side (Postgres, owned by `apps/web`) and
the index side (Qdrant) is a transactional outbox: a Postgres table that
receives event rows in the same transaction as the page mutation. A
dedicated worker drains that table, computes embeddings, and upserts to
Qdrant. The outbox guarantees at-least-once delivery without coupling
the request path to Qdrant availability.

## Goals

1. New table `outbox_events` in the main `DATABASE_URL` Postgres database
   (next to `Page`, `File`), modeled in Prisma and migrated with the
   existing `pnpm --filter @repo/db prisma migrate dev` flow.
2. `enqueueOutboxEvent(tx, …)` helper in `packages/db` (or `packages/trpc`)
   used inside every `Page` mutation in `apps/web`'s tRPC router so the
   write and the event are atomic.
3. New `apps/indexer/` Python service (mirrors `apps/agents` layout):
   `pyproject.toml` + `uv.lock` + `package.json` with Turbo-compatible
   scripts. **Worker only — no HTTP API except `/health`.**
4. Indexer polls `outbox_events` with `SELECT … FOR UPDATE SKIP LOCKED`,
   processes a configurable batch (`INDEXER_BATCH`), and marks rows
   `done` / `failed`. Failures retried with exponential backoff up to
   `INDEXER_MAX_ATTEMPTS`.
5. Embedding adapter pluggable by provider (`EMBEDDINGS_PROVIDER`):
   Ollama (`nomic-embed-text`, dim 768) is the only concrete one in D;
   OpenAI is scaffolded but not exercised.
6. Tiptap-JSON → plain-text extractor + simple chunker (~500 tokens,
   50 overlap, naïve newline-aware split). One Qdrant point per chunk.
7. Qdrant collection `anynote-pages` auto-bootstrapped on indexer
   startup (`create_if_not_exists`), payload schema documented.
8. Tombstone handling: `page.deleted` events delete every point whose
   `page_id` matches via Qdrant payload filter.
9. Tests: unit tests for chunker / extractor / outbox claim logic, one
   integration test that uses a real ephemeral Qdrant + Ollama and a
   real outbox row to assert end-to-end indexing.
10. `turbo.json` `globalEnv` updated with `INDEXER_*` and
    `EMBEDDINGS_*` (some already added during B1; rename
    `ENGINES_INDEX_*` → `INDEXER_*` to reflect the new home).
11. `docker compose` adds an `indexer` service definition (commented-out
    or `profiles: ["worker"]`-gated so it doesn't run on every `up -d`).
12. Repo green: `pnpm check-types`, `pnpm lint`, `pnpm build`, plus
    `pnpm --filter indexer test` all pass.

## Non-Goals

- File-content indexing. Only `Page` rows feed the queue in D. The
  outbox shape supports `aggregateType="file"` so a future pillar can
  add a file extractor (PDF/DOCX/TXT → text) without schema changes.
- Search-time tRPC procedure. Pillar E's MCP server is the first real
  consumer. `apps/web` does not get a search box in D.
- Re-indexing on workspace AI settings change (e.g. switching embeddings
  provider invalidates all points). Operator-driven for now.
- Streaming progress events to the UI. Indexer is a backend worker.
- Multi-tenant isolation beyond payload-filter scoping. Single Qdrant
  collection, every point payload carries `workspace_id`; a malicious
  query that omits the workspace filter would leak across workspaces.
  Pillar E's MCP server is responsible for enforcing the filter on the
  read path.
- Real production embedding model. `nomic-embed-text` is fine for dev;
  switching to BGE / Jina / OpenAI is a config change in F.
- Authentication on the indexer's `/health` endpoint. It binds only to
  loopback in dev; production exposure is out of scope for D.

## Architecture

### Write path (`apps/web` → Postgres)

```
tRPC mutation (page.create / page.update / page.delete / restore)
   └─ prisma.$transaction:
        1. UPDATE pages SET …
        2. INSERT INTO outbox_events (event_type, aggregate_id, payload)
   └─ COMMIT
```

The Postgres transaction is the durability boundary. If the worker
crashes before processing, the row stays `pending`. If Qdrant is down,
the worker bumps `attempts` and the row becomes claimable again after
the backoff window.

### Read path (`apps/indexer` → Qdrant)

```
Loop (every INDEXER_POLL_INTERVAL_MS):
  BEGIN
    rows = SELECT … FROM outbox_events
           WHERE status = 'pending'
             AND (locked_at IS NULL OR locked_at < now() - lock_ttl)
             AND attempts < INDEXER_MAX_ATTEMPTS
             AND next_attempt_at <= now()
           ORDER BY created_at
           LIMIT INDEXER_BATCH
           FOR UPDATE SKIP LOCKED;
    UPDATE outbox_events SET locked_at = now(), locked_by = $worker_id
    WHERE id = ANY(rows.id);
  COMMIT;

  for each row:
    try:
      handle(row)             # see below
      mark_done(row)
    except:
      mark_failed_or_retry(row)
```

`handle(row)` switches on `event_type`:
- `page.upserted` → fetch `Page` from Postgres, extract text from
  `content` (Tiptap JSON), chunk, embed each chunk, upsert into Qdrant.
- `page.deleted` → delete every point with payload `{page_id == X}`
  from Qdrant.
- `file.upserted` / `file.deleted` → no-op stub in D, log + mark done.

### `outbox_events` schema (Prisma)

```prisma
enum OutboxEventStatus {
  PENDING
  PROCESSING   // reserved for an explicit two-phase claim; D uses locked_at
  DONE
  FAILED       // dead-letter — attempts exhausted
}

model OutboxEvent {
  id            BigInt            @id @default(autoincrement())
  eventType     String            @map("event_type")    @db.VarChar(64)
  aggregateType String            @map("aggregate_type") @db.VarChar(32)
  aggregateId   String            @map("aggregate_id")   @db.Uuid
  workspaceId   String?           @map("workspace_id")   @db.Uuid
  payload       Json              @default("{}")
  status        OutboxEventStatus @default(PENDING)
  attempts      Int               @default(0)
  nextAttemptAt DateTime          @default(now()) @map("next_attempt_at") @db.Timestamptz(6)
  lockedAt      DateTime?         @map("locked_at")      @db.Timestamptz(6)
  lockedBy      String?           @map("locked_by")      @db.VarChar(64)
  processedAt   DateTime?         @map("processed_at")   @db.Timestamptz(6)
  lastError     String?           @map("last_error")     @db.Text
  createdAt     DateTime          @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([status, nextAttemptAt])
  @@index([aggregateType, aggregateId])
  @@map("outbox_events")
}
```

`workspaceId` is denormalized so the worker can index without a join.
`BigInt id` because volume-wise this table is append-heavy and we want
strict ordering.

### Embedding adapter

```
EmbeddingsProvider (Protocol):
  async def embed(self, texts: list[str]) -> list[list[float]]
  dim: int

OllamaEmbeddings:  # default
  base_url = settings.OLLAMA_BASE_URL
  model    = settings.EMBEDDINGS_MODEL  # default "nomic-embed-text"
  dim      = settings.EMBEDDINGS_DIM    # default 768

OpenAIEmbeddings:  # scaffolded, not tested in D
  api_key = settings.OPENAI_API_KEY
  model   = settings.EMBEDDINGS_MODEL   # e.g. "text-embedding-3-small"
  dim     = settings.EMBEDDINGS_DIM     # 1536
```

Provider chosen by `EMBEDDINGS_PROVIDER` env (`ollama` | `openai`).

### Qdrant collection `anynote-pages`

- Vectors: size = `EMBEDDINGS_DIM`, distance = `Cosine`
- Point id: deterministic `uuid5(NAMESPACE, f"{page_id}:{chunk_index}")`
  so re-indexing the same page upserts (no duplicates).
- Payload:
  ```
  {
    "workspace_id": "<uuid>",
    "page_id": "<uuid>",
    "ownership": "TEXT" | "SKILL" | "AGENT",
    "type": "TEXT" | "EXCALIDRAW",
    "title": "...",
    "chunk_index": 0,
    "chunk_text": "..."
  }
  ```
- `payload_indexes` for `workspace_id`, `page_id`, `ownership`.

### Service layout (`apps/indexer/`)

Mirrors `apps/agents/`:

```
apps/indexer/
  pyproject.toml
  uv.lock
  package.json
  Dockerfile
  Makefile
  README.md
  indexer/
    __init__.py
    main.py                  # uvicorn factory exposing /health
    settings.py              # pydantic-settings
    exceptions.py
    di/
      providers.py           # Dishka providers (settings, asyncpg pool, qdrant client, embeddings)
    entrypoints/
      rest/
        health.py            # GET /health (queue lag, qdrant reachable, embeddings reachable)
    services/
      outbox.py              # claim/ack/fail
      chunker.py             # tiptap_json → list[str]
      embeddings/
        __init__.py          # provider selector
        ollama.py
        openai.py
      qdrant_writer.py       # upsert / delete
      worker.py              # the polling loop
  tests/
    conftest.py
    test_chunker.py
    test_outbox_claim.py
    test_qdrant_writer.py
    test_embeddings_ollama.py  # @pytest.mark.integration
    test_pipeline_end_to_end.py # @pytest.mark.integration
```

### Settings

```
INDEXER_DATABASE_URL          # main DB (same as DATABASE_URL)
INDEXER_QDRANT_URL            # http://localhost:6333
INDEXER_QDRANT_API_KEY        # dev-qdrant-key
INDEXER_QDRANT_COLLECTION     # anynote-pages
INDEXER_POLL_INTERVAL_MS      # 1000
INDEXER_BATCH                 # 16
INDEXER_LOCK_TTL_MS           # 60000
INDEXER_MAX_ATTEMPTS          # 5
INDEXER_WORKER_ID             # auto-generated uuid if unset
EMBEDDINGS_PROVIDER           # "ollama" | "openai"
EMBEDDINGS_MODEL              # "nomic-embed-text"
EMBEDDINGS_DIM                # 768
OLLAMA_BASE_URL               # http://localhost:11434
OPENAI_API_KEY                # blank in dev
```

`turbo.json` `globalEnv`: drop `ENGINES_INDEX_DELAY_MS`,
`ENGINES_INDEX_BATCH`, `ENGINES_INDEX_LOCK_TTL_MS` (those were
preliminary names from B1); add the `INDEXER_*` set above.

### Operational worker startup

Indexer is started just like agents: `pnpm --filter indexer dev` runs
`uv run uvicorn --factory indexer.main:create_app --port 8081 --reload`.
The worker loop runs in a background asyncio task started during the
FastAPI lifespan. The HTTP layer exists only so health probes have a
target and so dev tooling (Turbo, Compose) can manage it like any other
app. **Default port is 8081** to avoid conflict with agents (8080).

## Failure model

| Scenario | Behavior |
|---|---|
| Qdrant unreachable | `attempts++`, `next_attempt_at = now() + backoff(attempts)`, row stays pending |
| Embedding API error | same as above |
| Page row missing (race with delete) | log + mark `done` (event is moot) |
| `attempts >= INDEXER_MAX_ATTEMPTS` | mark `FAILED`, log, do not retry |
| Worker crash mid-row | `locked_at` ages out → row reclaimed by another loop iteration |
| Worker crash after Qdrant write but before `mark_done` | re-processed, Qdrant upsert is idempotent (deterministic point id) |

Backoff formula: `min(60s * 2^attempts, 30min)`.

## Testing strategy

- **Unit (no infra)**: chunker, embeddings provider selector, outbox
  claim SQL (parameterized via test DB).
- **Integration (requires `docker compose up`)**:
  - `test_embeddings_ollama.py` — calls real Ollama, asserts vector
    shape.
  - `test_pipeline_end_to_end.py` — inserts an `OutboxEvent` row,
    runs one tick of the worker, asserts Qdrant has the expected
    point payload, then inserts a `page.deleted` event and asserts
    points are gone. Skipped unless `-m integration`.
- The indexer's pytest config matches agents': `addopts = "-ra
  --strict-markers"` + `markers = ["integration: …"]`.

## Open questions resolved during brainstorm

- **Where does the worker live?** New `apps/indexer` Python service.
  `apps/engines` (Pillar E) is a different concern (MCP server +
  read-side queries). Splitting keeps each service single-purpose;
  the Python tooling is reused from agents.
- **Postgres vs Redis as queue?** Postgres `FOR UPDATE SKIP LOCKED`
  is enough at AnyNote's scale and avoids introducing a second source
  of truth. Redis stays available for caching / rate limiting later.
- **Per-event vs aggregate-coalesced processing?** Per-event in D.
  Coalescing (de-dup of multiple `page.upserted` rows in flight) can be
  added later; the deterministic point id already prevents duplicates
  in Qdrant.
- **What if the embedding model dim changes?** Out of scope — operators
  drop the collection and re-index. A migration story is Pillar G.

## Out of scope for D, listed for traceability

- File extraction & indexing
- Workspace-level "rebuild index" admin action
- Search tRPC procedure
- Engines MCP server (E)
- Workspace AI settings UI (F)

## Success criteria

- `pnpm install && pnpm --filter @repo/db prisma migrate dev` runs the
  D migration cleanly.
- `docker compose up -d` then `pnpm --filter indexer dev` starts the
  worker; `curl http://localhost:8081/health` returns `{"status":"ok",
  "queue_lag": <int>, "qdrant": "reachable"}`.
- Creating a page in `apps/web` results in `outbox_events.status = DONE`
  within ~2s and a Qdrant point queryable by `page_id` payload filter.
- Deleting the page removes the points within ~2s.
- All workspace gates green; `pnpm --filter indexer test` passes
  unit tests; integration tests pass with infra running.
