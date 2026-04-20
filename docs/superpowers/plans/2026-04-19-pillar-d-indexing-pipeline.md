# Pillar D — Transactional Outbox + Qdrant Indexing Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a transactional outbox in the main DB plus a new `apps/indexer` Python worker that drains the outbox, embeds page content with Ollama, and upserts points into a Qdrant collection.

**Architecture:** `apps/web` writes outbox rows in the same Postgres transaction as page mutations. A standalone Python worker (`apps/indexer`) polls the outbox via `FOR UPDATE SKIP LOCKED`, computes embeddings, and upserts deterministic Qdrant points. Failures retry with exponential backoff; idempotent point ids make the pipeline crash-safe.

**Tech Stack:** Python 3.12, FastAPI (worker host with `/health` only), Dishka DI, asyncpg, qdrant-client, httpx (Ollama HTTP), Prisma 7, Postgres 16, Qdrant v1.12, Ollama, Turborepo, pnpm.

---

## Branch

Already on `feat/indexing-pipeline` (created from `main` after Pillar B1 merge). All commits below land on this branch.

---

## Task 1: `OutboxEvent` Prisma model + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (append enum + model after `PageFile`)
- Create: `packages/db/prisma/migrations/YYYYMMDDHHMMSS_pillar_d_outbox_events/migration.sql` (auto-generated)
- Modify: `packages/db/src/index.ts` (re-export new types if `@prisma/client` doesn't already)
- Test: `packages/db/test/outbox.test.ts`

- [ ] **Step 1.1: Add the enum + model to schema.prisma**

Append the following to `packages/db/prisma/schema.prisma` (after the existing `PageFile` model):

```prisma
enum OutboxEventStatus {
  PENDING
  PROCESSING
  DONE
  FAILED
}

model OutboxEvent {
  id            BigInt            @id @default(autoincrement())
  eventType     String            @map("event_type")     @db.VarChar(64)
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

- [ ] **Step 1.2: Generate migration + Prisma client**

```bash
pnpm --filter @repo/db prisma:generate
pnpm --filter @repo/db exec prisma migrate dev --name pillar_d_outbox_events
```

Expected: a new migration directory under `packages/db/prisma/migrations/` containing `migration.sql` with `CREATE TYPE "OutboxEventStatus"` and `CREATE TABLE "outbox_events"`. Migration applies cleanly to the local dev DB.

- [ ] **Step 1.3: Verify the generated SQL**

Open `packages/db/prisma/migrations/<new>/migration.sql` and confirm it contains:
- `CREATE TYPE "OutboxEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');`
- `CREATE TABLE "outbox_events"` with `id BIGSERIAL`, snake_case columns, Timestamptz(6).
- Two indexes (`outbox_events_status_next_attempt_at_idx`, `outbox_events_aggregate_type_aggregate_id_idx`).

If column names are camelCase, the `@map` annotations are missing — return to Step 1.1.

- [ ] **Step 1.4: Write the test**

Create `packages/db/test/outbox.test.ts`:

```ts
import { describe, expect, it, afterAll } from "vitest"
import { prisma } from "../src/index"
import { randomUUID } from "node:crypto"

describe("outbox_events table", () => {
  const created: bigint[] = []

  afterAll(async () => {
    if (created.length > 0) {
      await prisma.outboxEvent.deleteMany({ where: { id: { in: created } } })
    }
    await prisma.$disconnect()
  })

  it("persists and reads back a row with default status PENDING", async () => {
    const aggregateId = randomUUID()
    const row = await prisma.outboxEvent.create({
      data: {
        eventType: "page.upserted",
        aggregateType: "page",
        aggregateId,
        workspaceId: randomUUID(),
        payload: { source: "test" },
      },
    })
    created.push(row.id)
    expect(row.status).toBe("PENDING")
    expect(row.attempts).toBe(0)
    expect(row.payload).toEqual({ source: "test" })
  })
})
```

- [ ] **Step 1.5: Run the test**

```bash
pnpm --filter @repo/db test
```

Expected: PASS for the new spec (and any pre-existing specs). If `prisma.outboxEvent` is undefined, the client wasn't regenerated — re-run `pnpm --filter @repo/db prisma:generate`.

- [ ] **Step 1.6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/ packages/db/test/outbox.test.ts
git commit -m "$(cat <<'EOF'
feat(db): add OutboxEvent model + pillar_d_outbox_events migration

Adds OutboxEventStatus enum (PENDING/PROCESSING/DONE/FAILED) and
OutboxEvent table with snake_case columns + Timestamptz(6), workspace
denormalized for worker scoping, two indexes covering the worker claim
query and aggregate lookups.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `enqueueOutboxEvent` helper

**Files:**
- Create: `packages/db/src/outbox.ts`
- Modify: `packages/db/src/index.ts` (re-export)
- Test: `packages/db/test/enqueue.test.ts`

- [ ] **Step 2.1: Write the helper**

Create `packages/db/src/outbox.ts`:

```ts
import type { Prisma } from "@prisma/client"

export type OutboxAggregateType = "page" | "file"

export interface EnqueueOutboxEventArgs {
  eventType: string
  aggregateType: OutboxAggregateType
  aggregateId: string
  workspaceId?: string | null
  payload?: Prisma.InputJsonValue
}

export async function enqueueOutboxEvent(
  tx: Prisma.TransactionClient,
  args: EnqueueOutboxEventArgs,
): Promise<void> {
  await tx.outboxEvent.create({
    data: {
      eventType: args.eventType,
      aggregateType: args.aggregateType,
      aggregateId: args.aggregateId,
      workspaceId: args.workspaceId ?? null,
      payload: args.payload ?? {},
    },
  })
}
```

- [ ] **Step 2.2: Re-export from package index**

Add to `packages/db/src/index.ts` (in the existing exports section):

```ts
export { enqueueOutboxEvent } from "./outbox"
export type { OutboxAggregateType, EnqueueOutboxEventArgs } from "./outbox"
```

- [ ] **Step 2.3: Write the test**

Create `packages/db/test/enqueue.test.ts`:

```ts
import { describe, expect, it, afterAll } from "vitest"
import { randomUUID } from "node:crypto"
import { prisma } from "../src/index"
import { enqueueOutboxEvent } from "../src/outbox"

describe("enqueueOutboxEvent", () => {
  const created: bigint[] = []

  afterAll(async () => {
    if (created.length > 0) {
      await prisma.outboxEvent.deleteMany({ where: { id: { in: created } } })
    }
    await prisma.$disconnect()
  })

  it("inserts an outbox row inside a transaction", async () => {
    const aggregateId = randomUUID()
    const workspaceId = randomUUID()
    await prisma.$transaction(async (tx) => {
      await enqueueOutboxEvent(tx, {
        eventType: "page.upserted",
        aggregateType: "page",
        aggregateId,
        workspaceId,
        payload: { test: true },
      })
    })
    const rows = await prisma.outboxEvent.findMany({ where: { aggregateId } })
    expect(rows).toHaveLength(1)
    expect(rows[0].eventType).toBe("page.upserted")
    expect(rows[0].workspaceId).toBe(workspaceId)
    created.push(rows[0].id)
  })

  it("rolls back the row when the surrounding transaction throws", async () => {
    const aggregateId = randomUUID()
    await expect(
      prisma.$transaction(async (tx) => {
        await enqueueOutboxEvent(tx, {
          eventType: "page.deleted",
          aggregateType: "page",
          aggregateId,
        })
        throw new Error("boom")
      }),
    ).rejects.toThrow("boom")
    const rows = await prisma.outboxEvent.findMany({ where: { aggregateId } })
    expect(rows).toHaveLength(0)
  })
})
```

- [ ] **Step 2.4: Run the test**

```bash
pnpm --filter @repo/db test
```

Expected: PASS for both new specs.

- [ ] **Step 2.5: Commit**

```bash
git add packages/db/src/outbox.ts packages/db/src/index.ts packages/db/test/enqueue.test.ts
git commit -m "$(cat <<'EOF'
feat(db): add enqueueOutboxEvent transactional helper

Helper takes a Prisma TransactionClient so the caller can guarantee
atomicity between the aggregate write and the outbox row.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Wire emitter into Page tRPC mutations

**Files:**
- Modify: `packages/trpc/src/routers/page.ts` — wrap `create`, `update`, `delete`, `restore` (and any soft-delete / permanent-delete) mutations in `prisma.$transaction` and call `enqueueOutboxEvent`
- Test: `packages/trpc/test/page-outbox.test.ts`

- [ ] **Step 3.1: Audit the existing page router**

```bash
pnpm grep -n "prisma.page.create\|prisma.page.update\|prisma.page.delete\|prisma.page.deleteMany" packages/trpc/src/routers/page.ts
```

Note each procedure name and which mutation it performs. Common procedure names: `create`, `update`, `rename`, `move`, `softDelete` / `delete`, `restore`, `permanentDelete`.

- [ ] **Step 3.2: Update `create`**

Find the `create` procedure. Replace the `prisma.page.create({ data: ... })` line with a `prisma.$transaction(async (tx) => { ... })` block that creates the page and enqueues a `page.upserted` event:

```ts
const page = await prisma.$transaction(async (tx) => {
  const created = await tx.page.create({
    data: { /* existing fields */ },
    select: { /* existing select */ },
  })
  await enqueueOutboxEvent(tx, {
    eventType: "page.upserted",
    aggregateType: "page",
    aggregateId: created.id,
    workspaceId: created.workspaceId,
  })
  return created
})
```

Add `import { enqueueOutboxEvent } from "@repo/db"` at the top of the file.

- [ ] **Step 3.3: Update `update` / `rename` / `move` (every mutation that changes page content or metadata)**

For each, wrap in a transaction and emit `page.upserted` after the update. The pattern:

```ts
return prisma.$transaction(async (tx) => {
  const updated = await tx.page.update({
    where: { id: input.id },
    data: { /* existing fields */ },
    select: { /* existing select */ },
  })
  await enqueueOutboxEvent(tx, {
    eventType: "page.upserted",
    aggregateType: "page",
    aggregateId: updated.id,
    workspaceId: updated.workspaceId,
  })
  return updated
})
```

If the existing select doesn't return `workspaceId`, add it.

- [ ] **Step 3.4: Update soft-delete (`delete` / `softDelete`)**

Soft-delete sets `deletedAt`. Treat it as `page.deleted` (the index should not retain points for soft-deleted pages — they're invisible to users):

```ts
return prisma.$transaction(async (tx) => {
  const deleted = await tx.page.update({
    where: { id: input.id },
    data: { deletedAt: new Date() },
    select: { id: true, workspaceId: true },
  })
  await enqueueOutboxEvent(tx, {
    eventType: "page.deleted",
    aggregateType: "page",
    aggregateId: deleted.id,
    workspaceId: deleted.workspaceId,
  })
  return deleted
})
```

- [ ] **Step 3.5: Update `restore`**

Restore clears `deletedAt`. Emit `page.upserted` so the worker re-indexes:

```ts
return prisma.$transaction(async (tx) => {
  const restored = await tx.page.update({
    where: { id: input.id },
    data: { deletedAt: null },
    select: { id: true, workspaceId: true },
  })
  await enqueueOutboxEvent(tx, {
    eventType: "page.upserted",
    aggregateType: "page",
    aggregateId: restored.id,
    workspaceId: restored.workspaceId,
  })
  return restored
})
```

- [ ] **Step 3.6: Update permanent-delete (if present)**

Same as soft-delete but the page row is removed:

```ts
return prisma.$transaction(async (tx) => {
  const removed = await tx.page.delete({
    where: { id: input.id },
    select: { id: true, workspaceId: true },
  })
  await enqueueOutboxEvent(tx, {
    eventType: "page.deleted",
    aggregateType: "page",
    aggregateId: removed.id,
    workspaceId: removed.workspaceId,
  })
  return removed
})
```

- [ ] **Step 3.7: Write a test**

Create `packages/trpc/test/page-outbox.test.ts`. Look first at `packages/trpc/test/` for an existing fixture (workspace + user). If none exists, write minimal setup using `prisma` directly:

```ts
import { describe, expect, it, beforeAll, afterAll } from "vitest"
import { randomUUID } from "node:crypto"
import { prisma } from "@repo/db"
import { appRouter } from "../src/index"

describe("page mutations enqueue outbox events", () => {
  let workspaceId: string
  let userId: string
  const createdPageIds: string[] = []
  const createdEventIds: bigint[] = []

  beforeAll(async () => {
    userId = randomUUID()
    await prisma.user.create({
      data: { id: userId, email: `outbox-${userId}@test.local`, firstName: "T", lastName: "T" },
    })
    const ws = await prisma.workspace.create({
      data: { name: "outbox-test", ownerId: userId },
    })
    workspaceId = ws.id
  })

  afterAll(async () => {
    await prisma.outboxEvent.deleteMany({ where: { id: { in: createdEventIds } } })
    await prisma.page.deleteMany({ where: { id: { in: createdPageIds } } })
    await prisma.workspaceMember.deleteMany({ where: { workspaceId } })
    await prisma.workspace.deleteMany({ where: { id: workspaceId } })
    await prisma.user.deleteMany({ where: { id: userId } })
    await prisma.$disconnect()
  })

  it("emits page.upserted on create", async () => {
    const caller = appRouter.createCaller({
      prisma,
      user: { id: userId, email: `outbox-${userId}@test.local` } as any,
      headers: new Headers(),
      resHeaders: new Headers(),
    } as any)
    const page = await caller.page.create({ workspaceId, title: "Outbox test" })
    createdPageIds.push(page.id)
    const events = await prisma.outboxEvent.findMany({ where: { aggregateId: page.id } })
    createdEventIds.push(...events.map((e) => e.id))
    expect(events).toHaveLength(1)
    expect(events[0].eventType).toBe("page.upserted")
    expect(events[0].workspaceId).toBe(workspaceId)
  })

  it("emits page.deleted on soft-delete", async () => {
    const caller = appRouter.createCaller({
      prisma,
      user: { id: userId, email: `outbox-${userId}@test.local` } as any,
      headers: new Headers(),
      resHeaders: new Headers(),
    } as any)
    const page = await caller.page.create({ workspaceId, title: "Outbox delete test" })
    createdPageIds.push(page.id)
    await caller.page.delete({ id: page.id })
    const events = await prisma.outboxEvent.findMany({
      where: { aggregateId: page.id },
      orderBy: { id: "asc" },
    })
    createdEventIds.push(...events.map((e) => e.id))
    expect(events.map((e) => e.eventType)).toEqual(["page.upserted", "page.deleted"])
  })
})
```

If the existing tRPC caller signature differs, adapt — the goal is to call the real procedure and assert outbox rows are written.

- [ ] **Step 3.8: Run tRPC tests**

```bash
pnpm --filter @repo/trpc test
```

Expected: PASS. If a procedure name differs (e.g. it's `softDelete` instead of `delete`), update the test accordingly. If types fail because of explicit return annotations conflicting with the new transaction return, narrow the `select` clauses to match the previous public shape.

- [ ] **Step 3.9: Commit**

```bash
git add packages/trpc/src/routers/page.ts packages/trpc/test/page-outbox.test.ts
git commit -m "$(cat <<'EOF'
feat(trpc): emit outbox events from Page mutations

Wraps create/update/rename/move/delete/restore in prisma.$transaction
and calls enqueueOutboxEvent so every page mutation produces an
exactly-one outbox row in the same transaction. Soft-delete emits
page.deleted; restore emits page.upserted (worker re-indexes).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `apps/indexer/` scaffold

**Files:**
- Create: `apps/indexer/pyproject.toml`
- Create: `apps/indexer/package.json`
- Create: `apps/indexer/Makefile`
- Create: `apps/indexer/Dockerfile`
- Create: `apps/indexer/README.md`
- Create: `apps/indexer/indexer/__init__.py` (empty)
- Create: `apps/indexer/indexer/settings.py`
- Create: `apps/indexer/indexer/exceptions.py`
- Create: `apps/indexer/indexer/main.py`
- Create: `apps/indexer/indexer/entrypoints/__init__.py` (empty)
- Create: `apps/indexer/indexer/entrypoints/rest/__init__.py` (empty)
- Create: `apps/indexer/indexer/entrypoints/rest/router.py`
- Create: `apps/indexer/indexer/services/__init__.py` (empty)
- Create: `apps/indexer/indexer/di/__init__.py` (empty)
- Create: `apps/indexer/tests/__init__.py` (empty)
- Create: `apps/indexer/tests/conftest.py`
- Create: `apps/indexer/tests/test_settings.py`
- Modify: `turbo.json` `globalEnv` (rename `ENGINES_INDEX_*` → `INDEXER_*`, add new vars)

- [ ] **Step 4.1: Write `pyproject.toml`**

```toml
[project]
name = "indexer"
version = "0.1.0"
description = "AnyNote indexer worker — drains transactional outbox into Qdrant"
requires-python = ">=3.12,<3.13"
dependencies = [
    "fastapi[standard]>=0.116",
    "uvicorn[standard]>=0.30",
    "pydantic>=2.9",
    "pydantic-settings>=2.6",
    "dishka>=1.4",
    "httpx>=0.27",
    "asyncpg>=0.30",
    "qdrant-client>=1.12",
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

[tool.hatch.build.targets.wheel]
packages = ["indexer"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
addopts = "-ra --strict-markers"
markers = [
    "integration: integration tests that require live services (Postgres, Qdrant, Ollama)",
]
pythonpath = ["."]
testpaths = ["tests"]

[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "W", "I", "N", "B", "UP", "ASYNC", "RUF"]
ignore = ["E501"]

[tool.mypy]
python_version = "3.12"
strict = true
warn_return_any = true
warn_unused_ignores = true
plugins = ["pydantic.mypy"]
```

- [ ] **Step 4.2: Write `package.json`**

```json
{
  "name": "indexer",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "uv run uvicorn --factory indexer.main:create_app --host 0.0.0.0 --port 8081 --reload",
    "build": "uv sync --frozen",
    "check-types": "uv run mypy indexer tests",
    "lint": "uv run ruff check indexer tests",
    "format": "uv run ruff format indexer tests",
    "test": "uv run pytest -m 'not integration'"
  }
}
```

- [ ] **Step 4.3: Write `Makefile`**

```makefile
.PHONY: dev install lint typecheck test test-int format

dev:
	uv run uvicorn --factory indexer.main:create_app --host 0.0.0.0 --port 8081 --reload

install:
	uv sync

lint:
	uv run ruff check indexer tests

typecheck:
	uv run mypy indexer tests

test:
	uv run pytest -m 'not integration'

test-int:
	uv run pytest -m integration

format:
	uv run ruff format indexer tests
```

- [ ] **Step 4.4: Write `Dockerfile`**

```dockerfile
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    UV_SYSTEM_PYTHON=1

RUN pip install --no-cache-dir uv

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY indexer ./indexer

EXPOSE 8081

CMD ["uv", "run", "uvicorn", "--factory", "indexer.main:create_app", "--host", "0.0.0.0", "--port", "8081"]
```

- [ ] **Step 4.5: Write `settings.py`**

```python
"""Pydantic settings for the indexer worker."""

from __future__ import annotations

import uuid

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=None,
        populate_by_name=True,
        extra="ignore",
    )

    indexer_database_url: str = Field(alias="INDEXER_DATABASE_URL")
    indexer_qdrant_url: str = Field(default="http://localhost:6333", alias="INDEXER_QDRANT_URL")
    indexer_qdrant_api_key: str = Field(default="dev-qdrant-key", alias="INDEXER_QDRANT_API_KEY")
    indexer_qdrant_collection: str = Field(
        default="anynote-pages", alias="INDEXER_QDRANT_COLLECTION"
    )
    indexer_poll_interval_ms: int = Field(default=1000, alias="INDEXER_POLL_INTERVAL_MS")
    indexer_batch: int = Field(default=16, alias="INDEXER_BATCH")
    indexer_lock_ttl_ms: int = Field(default=60_000, alias="INDEXER_LOCK_TTL_MS")
    indexer_max_attempts: int = Field(default=5, alias="INDEXER_MAX_ATTEMPTS")
    indexer_worker_id: str = Field(
        default_factory=lambda: f"indexer-{uuid.uuid4().hex[:12]}",
        alias="INDEXER_WORKER_ID",
    )
    indexer_log_level: str = Field(default="INFO", alias="INDEXER_LOG_LEVEL")

    embeddings_provider: str = Field(default="ollama", alias="EMBEDDINGS_PROVIDER")
    embeddings_model: str = Field(default="nomic-embed-text", alias="EMBEDDINGS_MODEL")
    embeddings_dim: int = Field(default=768, alias="EMBEDDINGS_DIM")

    ollama_base_url: str = Field(default="http://localhost:11434", alias="OLLAMA_BASE_URL")
    openai_api_key: str = Field(default="", alias="OPENAI_API_KEY")
```

- [ ] **Step 4.6: Write `exceptions.py`**

```python
"""Indexer exception hierarchy."""

from __future__ import annotations


class IndexerError(Exception):
    """Base error for the indexer service."""

    code: str = "INTERNAL_ERROR"


class EmbeddingsError(IndexerError):
    code = "EMBEDDINGS_ERROR"


class QdrantWriterError(IndexerError):
    code = "QDRANT_ERROR"


class OutboxClaimError(IndexerError):
    code = "OUTBOX_CLAIM_ERROR"


class HandlerError(IndexerError):
    code = "HANDLER_ERROR"
```

- [ ] **Step 4.7: Write `main.py` (placeholder app factory + health stub)**

```python
"""Indexer FastAPI app factory."""

from __future__ import annotations

from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from dishka import make_async_container
from dishka.integrations.fastapi import setup_dishka
from fastapi import FastAPI

from indexer.di.providers import AppProvider, AppSingletonsProvider
from indexer.entrypoints.rest.router import api_router
from indexer.settings import Settings


def create_app() -> FastAPI:
    settings = Settings()
    container = make_async_container(
        AppProvider(),
        AppSingletonsProvider(),
        context={Settings: settings},
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        # Worker start/stop wiring lands in Task 10.
        yield

    app = FastAPI(title="AnyNote Indexer", version="0.1.0", lifespan=lifespan)
    app.include_router(api_router)
    setup_dishka(container=container, app=app)
    return app
```

- [ ] **Step 4.8: Write `entrypoints/rest/router.py` placeholder**

```python
"""Aggregate router for the indexer service."""

from __future__ import annotations

from fastapi import APIRouter

api_router = APIRouter()
```

The actual `/health` endpoint lands in Task 11.

- [ ] **Step 4.9: Write `tests/conftest.py`**

```python
"""Test fixtures for the indexer service."""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest


@pytest.fixture(autouse=True)
def _deterministic_env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("INDEXER_DATABASE_URL", "postgresql://user:password@localhost:5432/anynote")
    monkeypatch.setenv("INDEXER_QDRANT_URL", "http://localhost:6333")
    monkeypatch.setenv("INDEXER_QDRANT_API_KEY", "dev-qdrant-key")
    monkeypatch.setenv("INDEXER_QDRANT_COLLECTION", "anynote-pages-test")
    monkeypatch.setenv("INDEXER_WORKER_ID", "test-worker-123")
    monkeypatch.setenv("EMBEDDINGS_PROVIDER", "ollama")
    monkeypatch.setenv("EMBEDDINGS_MODEL", "nomic-embed-text")
    monkeypatch.setenv("EMBEDDINGS_DIM", "768")
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://localhost:11434")
    yield
```

- [ ] **Step 4.10: Write `tests/test_settings.py`**

```python
"""Tests for the Settings class."""

from __future__ import annotations

from indexer.settings import Settings


def test_settings_load_defaults() -> None:
    s = Settings()
    assert s.indexer_qdrant_collection == "anynote-pages-test"
    assert s.indexer_batch == 16
    assert s.embeddings_dim == 768
    assert s.indexer_worker_id == "test-worker-123"


def test_settings_database_url_required() -> None:
    s = Settings()
    assert s.indexer_database_url.startswith("postgresql://")
```

- [ ] **Step 4.11: Write minimal `README.md`**

```markdown
# apps/indexer

AnyNote indexer worker. Drains the `outbox_events` table from the main
Postgres database, computes embeddings, and upserts points into Qdrant.

## Quick start (host)

```bash
docker compose up -d postgres qdrant ollama
docker compose exec -T ollama ollama pull nomic-embed-text
pnpm --filter indexer dev
curl http://localhost:8081/health
```

## Tests

```bash
pnpm --filter indexer test            # unit
pnpm --filter indexer test-int        # integration (needs infra)
```
```

- [ ] **Step 4.12: Provisional `di/providers.py` placeholder**

Create `apps/indexer/indexer/di/providers.py`:

```python
"""Dishka providers for the indexer. Filled out in Task 5."""

from __future__ import annotations

from dishka import Provider, Scope, from_context

from indexer.settings import Settings


class AppProvider(Provider):
    scope = Scope.APP
    settings = from_context(provides=Settings, scope=Scope.APP)


class AppSingletonsProvider(Provider):
    scope = Scope.APP
```

- [ ] **Step 4.13: Update `turbo.json` `globalEnv`**

Edit `turbo.json`. In the `globalEnv` array:

- Remove: `"ENGINES_INDEX_DELAY_MS"`, `"ENGINES_INDEX_BATCH"`, `"ENGINES_INDEX_LOCK_TTL_MS"`.
- Add (alphabetically grouped near the other indexer/embeddings vars):

```
"INDEXER_DATABASE_URL",
"INDEXER_QDRANT_URL",
"INDEXER_QDRANT_API_KEY",
"INDEXER_QDRANT_COLLECTION",
"INDEXER_POLL_INTERVAL_MS",
"INDEXER_BATCH",
"INDEXER_LOCK_TTL_MS",
"INDEXER_MAX_ATTEMPTS",
"INDEXER_WORKER_ID",
"INDEXER_LOG_LEVEL",
"OPENAI_API_KEY",
```

`EMBEDDINGS_*` and `OLLAMA_BASE_URL` are already present from B1.

- [ ] **Step 4.14: Install + lock**

```bash
cd apps/indexer && uv sync && cd -
```

Expected: `uv.lock` created in `apps/indexer/`.

- [ ] **Step 4.15: Run unit tests**

```bash
pnpm --filter indexer test
```

Expected: `test_settings.py` passes (2 cases).

- [ ] **Step 4.16: Lint + typecheck**

```bash
pnpm --filter indexer lint
pnpm --filter indexer check-types
```

Expected: green.

- [ ] **Step 4.17: Commit**

```bash
git add apps/indexer turbo.json
git commit -m "$(cat <<'EOF'
feat(indexer): scaffold apps/indexer (Python worker, FastAPI host)

Mirrors the apps/agents layout: pyproject + uv.lock + package.json with
Turbo-compatible scripts (dev/build/check-types/lint/test/format),
Dishka DI placeholder, pydantic-settings with INDEXER_*/EMBEDDINGS_*
env vars, exception hierarchy, FastAPI app factory listening on 8081.

Renames ENGINES_INDEX_* → INDEXER_* in turbo.json globalEnv (those
were preliminary names from B1; the worker now lives in apps/indexer,
not apps/engines).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Dishka providers (full)

**Files:**
- Modify: `apps/indexer/indexer/di/providers.py` (replace the placeholder from Task 4)
- Test: `apps/indexer/tests/test_di_container.py`

- [ ] **Step 5.1: Replace the providers module**

```python
"""Dishka providers for the indexer."""

from __future__ import annotations

from collections.abc import AsyncIterator

import asyncpg
from dishka import Provider, Scope, from_context, provide
from qdrant_client import AsyncQdrantClient

from indexer.services.chunker import Chunker
from indexer.services.embeddings import EmbeddingsProvider, create_embeddings
from indexer.services.outbox import OutboxRepo
from indexer.services.qdrant_writer import QdrantWriter
from indexer.services.worker import IndexerWorker
from indexer.settings import Settings


class AppProvider(Provider):
    scope = Scope.APP
    settings = from_context(provides=Settings, scope=Scope.APP)

    @provide(scope=Scope.APP)
    async def db_pool(self, settings: Settings) -> AsyncIterator[asyncpg.Pool]:
        pool = await asyncpg.create_pool(settings.indexer_database_url, min_size=1, max_size=4)
        try:
            yield pool
        finally:
            await pool.close()

    @provide(scope=Scope.APP)
    async def qdrant_client(self, settings: Settings) -> AsyncIterator[AsyncQdrantClient]:
        client = AsyncQdrantClient(
            url=settings.indexer_qdrant_url,
            api_key=settings.indexer_qdrant_api_key,
        )
        try:
            yield client
        finally:
            await client.close()


class AppSingletonsProvider(Provider):
    scope = Scope.APP

    @provide(scope=Scope.APP)
    def chunker(self) -> Chunker:
        return Chunker()

    @provide(scope=Scope.APP)
    def embeddings(self, settings: Settings) -> EmbeddingsProvider:
        return create_embeddings(settings)

    @provide(scope=Scope.APP)
    def qdrant_writer(
        self, client: AsyncQdrantClient, settings: Settings
    ) -> QdrantWriter:
        return QdrantWriter(client=client, settings=settings)

    @provide(scope=Scope.APP)
    def outbox_repo(self, pool: asyncpg.Pool, settings: Settings) -> OutboxRepo:
        return OutboxRepo(pool=pool, settings=settings)

    @provide(scope=Scope.APP)
    def worker(
        self,
        pool: asyncpg.Pool,
        outbox: OutboxRepo,
        chunker: Chunker,
        embeddings: EmbeddingsProvider,
        qdrant: QdrantWriter,
        settings: Settings,
    ) -> IndexerWorker:
        return IndexerWorker(
            pool=pool,
            outbox=outbox,
            chunker=chunker,
            embeddings=embeddings,
            qdrant=qdrant,
            settings=settings,
        )
```

NOTE: `Chunker`, `OutboxRepo`, `QdrantWriter`, `IndexerWorker`, `EmbeddingsProvider`, `create_embeddings` are added in subsequent tasks. The container won't actually build until those exist; the test below only asserts the providers register without raising.

- [ ] **Step 5.2: Write the container test**

Create `apps/indexer/tests/test_di_container.py`:

```python
"""Smoke test that the Dishka container can be constructed with placeholder env."""

from __future__ import annotations

import pytest
from dishka import make_async_container

from indexer.di.providers import AppProvider, AppSingletonsProvider
from indexer.settings import Settings


@pytest.mark.asyncio
async def test_container_builds() -> None:
    settings = Settings()
    container = make_async_container(
        AppProvider(), AppSingletonsProvider(), context={Settings: settings}
    )
    try:
        # Resolve only the leaf with no IO (Settings).
        resolved = await container.get(Settings)
        assert resolved.indexer_qdrant_collection == "anynote-pages-test"
    finally:
        await container.close()
```

This test is intentionally narrow — full resolution requires the real services that are built in T6–T10.

- [ ] **Step 5.3: Run the test (expected to FAIL until T6–T10 land)**

```bash
pnpm --filter indexer test
```

Expected: `test_di_container.py` errors at import time (missing services) — that's expected. Mark this step "in flight" and continue. The test will go green after T10.

To unblock the test for now, add a small guard or skip — temporarily wrap the import block in `tests/test_di_container.py`:

```python
import pytest
pytest.importorskip("indexer.services.worker")
```

Place it at the top of the file. The test will be `SKIPPED` until T10 fills in services, then will run automatically.

- [ ] **Step 5.4: Run again — should be SKIPPED, not failed**

```bash
pnpm --filter indexer test
```

Expected: `test_di_container.py` reports SKIPPED. The other tests (settings) still pass.

- [ ] **Step 5.5: Commit**

```bash
git add apps/indexer/indexer/di/providers.py apps/indexer/tests/test_di_container.py
git commit -m "$(cat <<'EOF'
feat(indexer): wire Dishka providers (asyncpg pool, qdrant client, services)

AppProvider owns IO-bound singletons (asyncpg pool, AsyncQdrantClient)
with proper teardown. AppSingletonsProvider wires Chunker, embeddings
adapter, QdrantWriter, OutboxRepo, IndexerWorker. Container test is
importorskip-gated until services land (T6–T10).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Embeddings adapter (Ollama + OpenAI scaffold)

**Files:**
- Create: `apps/indexer/indexer/services/embeddings/__init__.py`
- Create: `apps/indexer/indexer/services/embeddings/ollama.py`
- Create: `apps/indexer/indexer/services/embeddings/openai.py`
- Test: `apps/indexer/tests/test_embeddings_factory.py`
- Test: `apps/indexer/tests/test_embeddings_ollama.py` (integration)

- [ ] **Step 6.1: Write the embeddings package init (Protocol + factory)**

`apps/indexer/indexer/services/embeddings/__init__.py`:

```python
"""Embeddings provider abstraction."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from indexer.exceptions import EmbeddingsError
from indexer.settings import Settings


@runtime_checkable
class EmbeddingsProvider(Protocol):
    dim: int

    async def embed(self, texts: list[str]) -> list[list[float]]: ...


def create_embeddings(settings: Settings) -> EmbeddingsProvider:
    provider = settings.embeddings_provider.lower()
    if provider == "ollama":
        from indexer.services.embeddings.ollama import OllamaEmbeddings

        return OllamaEmbeddings(
            base_url=settings.ollama_base_url,
            model=settings.embeddings_model,
            dim=settings.embeddings_dim,
        )
    if provider == "openai":
        from indexer.services.embeddings.openai import OpenAIEmbeddings

        return OpenAIEmbeddings(
            api_key=settings.openai_api_key,
            model=settings.embeddings_model,
            dim=settings.embeddings_dim,
        )
    raise EmbeddingsError(f"Unknown EMBEDDINGS_PROVIDER: {settings.embeddings_provider!r}")
```

- [ ] **Step 6.2: Write the Ollama implementation**

`apps/indexer/indexer/services/embeddings/ollama.py`:

```python
"""Ollama embeddings adapter (HTTP)."""

from __future__ import annotations

import httpx

from indexer.exceptions import EmbeddingsError


class OllamaEmbeddings:
    def __init__(self, *, base_url: str, model: str, dim: int) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.dim = dim

    async def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as client:
            vectors: list[list[float]] = []
            for text in texts:
                try:
                    resp = await client.post(
                        f"{self.base_url}/api/embeddings",
                        json={"model": self.model, "prompt": text},
                    )
                except httpx.HTTPError as exc:
                    raise EmbeddingsError(f"Ollama transport error: {exc}") from exc
                if resp.status_code != 200:
                    raise EmbeddingsError(
                        f"Ollama returned {resp.status_code}: {resp.text[:200]}"
                    )
                payload = resp.json()
                vec = payload.get("embedding")
                if not isinstance(vec, list) or len(vec) != self.dim:
                    raise EmbeddingsError(
                        f"Unexpected Ollama embedding shape (got {type(vec).__name__}, "
                        f"len={len(vec) if isinstance(vec, list) else 'n/a'}, expected {self.dim})"
                    )
                vectors.append([float(x) for x in vec])
            return vectors
```

- [ ] **Step 6.3: Write the OpenAI scaffold**

`apps/indexer/indexer/services/embeddings/openai.py`:

```python
"""OpenAI embeddings adapter — scaffold only, not exercised in Pillar D."""

from __future__ import annotations


class OpenAIEmbeddings:
    def __init__(self, *, api_key: str, model: str, dim: int) -> None:
        self.api_key = api_key
        self.model = model
        self.dim = dim

    async def embed(self, texts: list[str]) -> list[list[float]]:
        raise NotImplementedError("OpenAI embeddings are scaffolded in Pillar D; wire in Pillar G")
```

- [ ] **Step 6.4: Write the unit factory test**

`apps/indexer/tests/test_embeddings_factory.py`:

```python
"""Tests for the embeddings provider selector."""

from __future__ import annotations

import pytest

from indexer.exceptions import EmbeddingsError
from indexer.services.embeddings import create_embeddings
from indexer.services.embeddings.ollama import OllamaEmbeddings
from indexer.services.embeddings.openai import OpenAIEmbeddings
from indexer.settings import Settings


def test_factory_picks_ollama_by_default() -> None:
    s = Settings()
    provider = create_embeddings(s)
    assert isinstance(provider, OllamaEmbeddings)
    assert provider.dim == 768


def test_factory_picks_openai(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EMBEDDINGS_PROVIDER", "openai")
    monkeypatch.setenv("EMBEDDINGS_MODEL", "text-embedding-3-small")
    monkeypatch.setenv("EMBEDDINGS_DIM", "1536")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    s = Settings()
    provider = create_embeddings(s)
    assert isinstance(provider, OpenAIEmbeddings)
    assert provider.dim == 1536


def test_factory_rejects_unknown(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EMBEDDINGS_PROVIDER", "weird")
    s = Settings()
    with pytest.raises(EmbeddingsError):
        create_embeddings(s)
```

- [ ] **Step 6.5: Write the Ollama integration test**

`apps/indexer/tests/test_embeddings_ollama.py`:

```python
"""Integration test against a real Ollama with nomic-embed-text pulled."""

from __future__ import annotations

import pytest

from indexer.services.embeddings.ollama import OllamaEmbeddings


@pytest.mark.integration
async def test_ollama_embeddings_shape() -> None:
    embedder = OllamaEmbeddings(
        base_url="http://localhost:11434", model="nomic-embed-text", dim=768
    )
    vectors = await embedder.embed(["hello world", "second text"])
    assert len(vectors) == 2
    assert all(len(v) == 768 for v in vectors)
    assert all(isinstance(x, float) for x in vectors[0])
```

- [ ] **Step 6.6: Run unit tests**

```bash
pnpm --filter indexer test
```

Expected: PASS for `test_embeddings_factory.py`. `test_embeddings_ollama.py` is skipped (no `-m integration`). `test_settings.py` still passes.

- [ ] **Step 6.7: Commit**

```bash
git add apps/indexer/indexer/services/embeddings apps/indexer/tests/test_embeddings_factory.py apps/indexer/tests/test_embeddings_ollama.py
git commit -m "$(cat <<'EOF'
feat(indexer): embeddings adapter (Ollama HTTP + OpenAI scaffold)

Protocol-based EmbeddingsProvider with a settings-driven factory.
Ollama implementation hits /api/embeddings via httpx with shape
validation and surfaces transport/protocol errors as EmbeddingsError.
OpenAI scaffold raises NotImplementedError so Pillar D stays minimal
without breaking the factory selector test.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Tiptap → text + chunker

**Files:**
- Create: `apps/indexer/indexer/services/chunker.py`
- Test: `apps/indexer/tests/test_chunker.py`

- [ ] **Step 7.1: Write the chunker module**

```python
"""Tiptap JSON → text extraction + chunking."""

from __future__ import annotations

from typing import Any


def tiptap_to_text(content: dict[str, Any] | None) -> str:
    """Walk a Tiptap JSON document and return plain text."""
    if not content:
        return ""
    parts: list[str] = []
    _walk(content, parts)
    text = "".join(parts)
    while "\n\n\n" in text:
        text = text.replace("\n\n\n", "\n\n")
    return text.strip()


def _walk(node: dict[str, Any], parts: list[str]) -> None:
    node_type = node.get("type")
    if node_type == "text":
        parts.append(str(node.get("text", "")))
        return
    children = node.get("content")
    if isinstance(children, list):
        for child in children:
            if isinstance(child, dict):
                _walk(child, parts)
    if node_type in {"paragraph", "heading", "blockquote", "listItem", "codeBlock"}:
        parts.append("\n\n")
    elif node_type == "hardBreak":
        parts.append("\n")


class Chunker:
    """Splits text into chunks of approximately `max_chars` with `overlap` overlap."""

    def __init__(self, *, max_chars: int = 2000, overlap: int = 200) -> None:
        self.max_chars = max_chars
        self.overlap = overlap

    def chunk(self, text: str) -> list[str]:
        text = text.strip()
        if not text:
            return []
        if len(text) <= self.max_chars:
            return [text]

        # Prefer splitting on paragraph boundaries.
        paragraphs = [p for p in text.split("\n\n") if p.strip()]
        chunks: list[str] = []
        buffer = ""
        for para in paragraphs:
            if not buffer:
                buffer = para
                continue
            candidate = f"{buffer}\n\n{para}"
            if len(candidate) <= self.max_chars:
                buffer = candidate
            else:
                chunks.append(buffer)
                buffer = para
        if buffer:
            chunks.append(buffer)

        # Hard-split any oversized chunk (a single very long paragraph).
        result: list[str] = []
        for chunk in chunks:
            if len(chunk) <= self.max_chars:
                result.append(chunk)
            else:
                result.extend(self._hard_split(chunk))
        return result

    def _hard_split(self, text: str) -> list[str]:
        chunks: list[str] = []
        step = max(1, self.max_chars - self.overlap)
        start = 0
        while start < len(text):
            end = start + self.max_chars
            chunks.append(text[start:end])
            if end >= len(text):
                break
            start += step
        return chunks
```

- [ ] **Step 7.2: Write the test**

`apps/indexer/tests/test_chunker.py`:

```python
"""Tests for the Tiptap extractor and chunker."""

from __future__ import annotations

from indexer.services.chunker import Chunker, tiptap_to_text


def test_tiptap_empty() -> None:
    assert tiptap_to_text(None) == ""
    assert tiptap_to_text({}) == ""


def test_tiptap_simple_paragraph() -> None:
    doc = {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [{"type": "text", "text": "hello world"}],
            }
        ],
    }
    assert tiptap_to_text(doc) == "hello world"


def test_tiptap_multi_paragraph() -> None:
    doc = {
        "type": "doc",
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "first"}]},
            {"type": "paragraph", "content": [{"type": "text", "text": "second"}]},
        ],
    }
    assert tiptap_to_text(doc) == "first\n\nsecond"


def test_tiptap_heading_and_list() -> None:
    doc = {
        "type": "doc",
        "content": [
            {"type": "heading", "content": [{"type": "text", "text": "Title"}]},
            {
                "type": "bulletList",
                "content": [
                    {
                        "type": "listItem",
                        "content": [
                            {"type": "paragraph", "content": [{"type": "text", "text": "a"}]}
                        ],
                    },
                    {
                        "type": "listItem",
                        "content": [
                            {"type": "paragraph", "content": [{"type": "text", "text": "b"}]}
                        ],
                    },
                ],
            },
        ],
    }
    text = tiptap_to_text(doc)
    assert "Title" in text and "a" in text and "b" in text


def test_chunker_empty() -> None:
    assert Chunker().chunk("") == []
    assert Chunker().chunk("   ") == []


def test_chunker_single_short_chunk() -> None:
    assert Chunker(max_chars=100).chunk("hello world") == ["hello world"]


def test_chunker_splits_on_paragraphs() -> None:
    text = "p1\n\np2\n\np3"
    chunks = Chunker(max_chars=4, overlap=0).chunk(text)
    assert chunks == ["p1", "p2", "p3"]


def test_chunker_hard_splits_long_paragraph() -> None:
    text = "a" * 500
    chunker = Chunker(max_chars=200, overlap=50)
    chunks = chunker.chunk(text)
    assert len(chunks) >= 3
    for c in chunks:
        assert len(c) <= 200
```

- [ ] **Step 7.3: Run the test**

```bash
pnpm --filter indexer test
```

Expected: all chunker tests PASS.

- [ ] **Step 7.4: Commit**

```bash
git add apps/indexer/indexer/services/chunker.py apps/indexer/tests/test_chunker.py
git commit -m "$(cat <<'EOF'
feat(indexer): tiptap_to_text extractor + paragraph-aware chunker

tiptap_to_text recursively walks a Tiptap document, joining inline
text and inserting paragraph breaks for block-level node types.
Chunker greedily packs paragraphs up to max_chars, falling back to a
hard split with overlap for any single paragraph that exceeds the
limit. Char-based to avoid pulling in a tokenizer dep — ~500 tokens
≈ 2000 chars for an EN+RU mix.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Qdrant writer + collection bootstrap

**Files:**
- Create: `apps/indexer/indexer/services/qdrant_writer.py`
- Test: `apps/indexer/tests/test_qdrant_writer.py` (integration)

- [ ] **Step 8.1: Write the writer**

```python
"""Qdrant collection bootstrap + per-page upsert/delete helpers."""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from qdrant_client import AsyncQdrantClient
from qdrant_client.http import models as qmodels

from indexer.exceptions import QdrantWriterError
from indexer.settings import Settings

_NAMESPACE = uuid.UUID("a8a8a8a8-1111-2222-3333-444444444444")


def _point_id(page_id: str, chunk_index: int) -> str:
    return str(uuid.uuid5(_NAMESPACE, f"{page_id}:{chunk_index}"))


class QdrantWriter:
    def __init__(self, *, client: AsyncQdrantClient, settings: Settings) -> None:
        self.client = client
        self.collection = settings.indexer_qdrant_collection
        self.dim = settings.embeddings_dim

    async def ensure_collection(self) -> None:
        try:
            collections = await self.client.get_collections()
        except Exception as exc:  # noqa: BLE001 — surface as our domain error
            raise QdrantWriterError(f"Qdrant unreachable: {exc}") from exc
        existing = {c.name for c in collections.collections}
        if self.collection in existing:
            return
        await self.client.create_collection(
            collection_name=self.collection,
            vectors_config=qmodels.VectorParams(
                size=self.dim, distance=qmodels.Distance.COSINE
            ),
        )
        for field, schema in [
            ("workspace_id", qmodels.PayloadSchemaType.KEYWORD),
            ("page_id", qmodels.PayloadSchemaType.KEYWORD),
            ("ownership", qmodels.PayloadSchemaType.KEYWORD),
        ]:
            await self.client.create_payload_index(
                collection_name=self.collection,
                field_name=field,
                field_schema=schema,
            )

    async def upsert_page(
        self,
        *,
        page_id: str,
        workspace_id: str,
        ownership: str,
        type_: str,
        title: str | None,
        chunks: Sequence[str],
        vectors: Sequence[Sequence[float]],
    ) -> None:
        if len(chunks) != len(vectors):
            raise QdrantWriterError(
                f"chunks/vectors mismatch ({len(chunks)} vs {len(vectors)})"
            )
        points = [
            qmodels.PointStruct(
                id=_point_id(page_id, i),
                vector=list(vec),
                payload={
                    "workspace_id": workspace_id,
                    "page_id": page_id,
                    "ownership": ownership,
                    "type": type_,
                    "title": title or "",
                    "chunk_index": i,
                    "chunk_text": chunk,
                },
            )
            for i, (chunk, vec) in enumerate(zip(chunks, vectors, strict=True))
        ]
        # If chunks shrank for a re-indexed page, delete the tail first.
        await self._delete_chunks_above(page_id, len(chunks))
        if points:
            await self.client.upsert(collection_name=self.collection, points=points)

    async def delete_page(self, *, page_id: str) -> None:
        await self.client.delete(
            collection_name=self.collection,
            points_selector=qmodels.FilterSelector(
                filter=qmodels.Filter(
                    must=[
                        qmodels.FieldCondition(
                            key="page_id", match=qmodels.MatchValue(value=page_id)
                        )
                    ]
                )
            ),
        )

    async def _delete_chunks_above(self, page_id: str, keep: int) -> None:
        await self.client.delete(
            collection_name=self.collection,
            points_selector=qmodels.FilterSelector(
                filter=qmodels.Filter(
                    must=[
                        qmodels.FieldCondition(
                            key="page_id", match=qmodels.MatchValue(value=page_id)
                        ),
                        qmodels.FieldCondition(
                            key="chunk_index",
                            range=qmodels.Range(gte=keep),
                        ),
                    ]
                )
            ),
        )
```

- [ ] **Step 8.2: Write the integration test**

`apps/indexer/tests/test_qdrant_writer.py`:

```python
"""Integration tests for QdrantWriter against a real Qdrant."""

from __future__ import annotations

import uuid

import pytest
from qdrant_client import AsyncQdrantClient
from qdrant_client.http import models as qmodels

from indexer.services.qdrant_writer import QdrantWriter
from indexer.settings import Settings


@pytest.fixture
async def writer() -> QdrantWriter:
    settings = Settings()
    client = AsyncQdrantClient(
        url=settings.indexer_qdrant_url, api_key=settings.indexer_qdrant_api_key
    )
    w = QdrantWriter(client=client, settings=settings)
    # Make a clean ephemeral collection for each test run.
    try:
        await client.delete_collection(settings.indexer_qdrant_collection)
    except Exception:
        pass
    await w.ensure_collection()
    return w


@pytest.mark.integration
async def test_upsert_then_query(writer: QdrantWriter) -> None:
    page_id = str(uuid.uuid4())
    workspace_id = str(uuid.uuid4())
    chunks = ["alpha", "beta"]
    vectors = [[0.1] * 768, [0.2] * 768]
    await writer.upsert_page(
        page_id=page_id,
        workspace_id=workspace_id,
        ownership="TEXT",
        type_="TEXT",
        title="Hello",
        chunks=chunks,
        vectors=vectors,
    )
    result, _ = await writer.client.scroll(
        collection_name=writer.collection,
        scroll_filter=qmodels.Filter(
            must=[qmodels.FieldCondition(key="page_id", match=qmodels.MatchValue(value=page_id))]
        ),
        limit=10,
    )
    assert len(result) == 2
    payloads = sorted(r.payload["chunk_text"] for r in result)
    assert payloads == ["alpha", "beta"]


@pytest.mark.integration
async def test_delete_page_removes_all_chunks(writer: QdrantWriter) -> None:
    page_id = str(uuid.uuid4())
    workspace_id = str(uuid.uuid4())
    await writer.upsert_page(
        page_id=page_id,
        workspace_id=workspace_id,
        ownership="TEXT",
        type_="TEXT",
        title="To delete",
        chunks=["one", "two", "three"],
        vectors=[[0.1] * 768, [0.2] * 768, [0.3] * 768],
    )
    await writer.delete_page(page_id=page_id)
    result, _ = await writer.client.scroll(
        collection_name=writer.collection,
        scroll_filter=qmodels.Filter(
            must=[qmodels.FieldCondition(key="page_id", match=qmodels.MatchValue(value=page_id))]
        ),
        limit=10,
    )
    assert result == []
```

- [ ] **Step 8.3: Lint + typecheck**

```bash
pnpm --filter indexer check-types
pnpm --filter indexer lint
```

Expected: green. If `qdrant_client.http.models` exposes Range under a different name, adjust to use `Range(gte=keep)` directly or substitute with two FieldConditions.

- [ ] **Step 8.4: Run unit tests (integration test still gated)**

```bash
pnpm --filter indexer test
```

Expected: PASS.

- [ ] **Step 8.5: Commit**

```bash
git add apps/indexer/indexer/services/qdrant_writer.py apps/indexer/tests/test_qdrant_writer.py
git commit -m "$(cat <<'EOF'
feat(indexer): QdrantWriter with deterministic point ids + tombstones

ensure_collection() bootstraps the anynote-pages collection on first
run with cosine distance and payload indexes for workspace_id/page_id/
ownership. Point ids are uuid5(NAMESPACE, "{page_id}:{chunk_index}"),
making upserts idempotent and crash-safe. Re-index of a page with
fewer chunks first deletes the tail; delete_page removes all chunks
via payload filter.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Outbox repository (claim/ack/fail)

**Files:**
- Create: `apps/indexer/indexer/services/outbox.py`
- Test: `apps/indexer/tests/test_outbox_repo.py` (integration)

- [ ] **Step 9.1: Write the repo**

```python
"""Outbox repository — claim, ack, fail using FOR UPDATE SKIP LOCKED."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

import asyncpg

from indexer.exceptions import OutboxClaimError
from indexer.settings import Settings


@dataclass(slots=True)
class OutboxRow:
    id: int
    event_type: str
    aggregate_type: str
    aggregate_id: str
    workspace_id: str | None
    payload: dict[str, Any]
    attempts: int


def _backoff_seconds(attempts: int) -> int:
    return min(60 * (2**attempts), 30 * 60)


class OutboxRepo:
    def __init__(self, *, pool: asyncpg.Pool, settings: Settings) -> None:
        self.pool = pool
        self.settings = settings

    async def claim_batch(self) -> list[OutboxRow]:
        worker_id = self.settings.indexer_worker_id
        batch = self.settings.indexer_batch
        lock_ttl = timedelta(milliseconds=self.settings.indexer_lock_ttl_ms)
        max_attempts = self.settings.indexer_max_attempts

        try:
            async with self.pool.acquire() as conn:
                async with conn.transaction():
                    rows = await conn.fetch(
                        """
                        WITH candidate AS (
                            SELECT id
                            FROM outbox_events
                            WHERE status = 'PENDING'
                              AND attempts < $3
                              AND next_attempt_at <= now()
                              AND (locked_at IS NULL OR locked_at < now() - $4::interval)
                            ORDER BY created_at
                            LIMIT $1
                            FOR UPDATE SKIP LOCKED
                        )
                        UPDATE outbox_events o
                        SET locked_at = now(), locked_by = $2
                        FROM candidate c
                        WHERE o.id = c.id
                        RETURNING o.id, o.event_type, o.aggregate_type, o.aggregate_id,
                                  o.workspace_id, o.payload, o.attempts
                        """,
                        batch,
                        worker_id,
                        max_attempts,
                        lock_ttl,
                    )
        except Exception as exc:  # noqa: BLE001
            raise OutboxClaimError(f"claim_batch failed: {exc}") from exc

        return [
            OutboxRow(
                id=int(r["id"]),
                event_type=r["event_type"],
                aggregate_type=r["aggregate_type"],
                aggregate_id=str(r["aggregate_id"]),
                workspace_id=str(r["workspace_id"]) if r["workspace_id"] else None,
                payload=dict(r["payload"]) if r["payload"] else {},
                attempts=int(r["attempts"]),
            )
            for r in rows
        ]

    async def mark_done(self, row_id: int) -> None:
        async with self.pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE outbox_events
                SET status = 'DONE', processed_at = now(), locked_at = NULL,
                    locked_by = NULL, last_error = NULL
                WHERE id = $1
                """,
                row_id,
            )

    async def mark_failed_or_retry(self, row: OutboxRow, error: str) -> None:
        new_attempts = row.attempts + 1
        max_attempts = self.settings.indexer_max_attempts
        if new_attempts >= max_attempts:
            async with self.pool.acquire() as conn:
                await conn.execute(
                    """
                    UPDATE outbox_events
                    SET status = 'FAILED', attempts = $2, last_error = $3,
                        locked_at = NULL, locked_by = NULL, processed_at = now()
                    WHERE id = $1
                    """,
                    row.id,
                    new_attempts,
                    error[:1000],
                )
        else:
            backoff = _backoff_seconds(new_attempts)
            async with self.pool.acquire() as conn:
                await conn.execute(
                    """
                    UPDATE outbox_events
                    SET status = 'PENDING', attempts = $2, last_error = $3,
                        next_attempt_at = now() + ($4::int * interval '1 second'),
                        locked_at = NULL, locked_by = NULL
                    WHERE id = $1
                    """,
                    row.id,
                    new_attempts,
                    error[:1000],
                    backoff,
                )

    async def queue_lag(self) -> int:
        async with self.pool.acquire() as conn:
            value = await conn.fetchval(
                "SELECT count(*) FROM outbox_events WHERE status = 'PENDING'"
            )
            return int(value or 0)
```

- [ ] **Step 9.2: Write the integration test**

`apps/indexer/tests/test_outbox_repo.py`:

```python
"""Integration tests for OutboxRepo against the real Postgres."""

from __future__ import annotations

import asyncio
import uuid

import asyncpg
import pytest

from indexer.services.outbox import OutboxRepo
from indexer.settings import Settings


@pytest.fixture
async def repo() -> OutboxRepo:
    settings = Settings()
    pool = await asyncpg.create_pool(settings.indexer_database_url, min_size=1, max_size=2)
    yield OutboxRepo(pool=pool, settings=settings)
    await pool.close()


async def _insert_event(pool: asyncpg.Pool) -> int:
    async with pool.acquire() as conn:
        return int(
            await conn.fetchval(
                """
                INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, workspace_id, payload)
                VALUES ('page.upserted', 'page', $1::uuid, $2::uuid, '{}'::jsonb)
                RETURNING id
                """,
                str(uuid.uuid4()),
                str(uuid.uuid4()),
            )
        )


@pytest.mark.integration
async def test_claim_then_mark_done(repo: OutboxRepo) -> None:
    row_id = await _insert_event(repo.pool)
    rows = await repo.claim_batch()
    assert any(r.id == row_id for r in rows)
    await repo.mark_done(row_id)
    async with repo.pool.acquire() as conn:
        status = await conn.fetchval("SELECT status FROM outbox_events WHERE id = $1", row_id)
    assert status == "DONE"


@pytest.mark.integration
async def test_concurrent_claim_skips_locked(repo: OutboxRepo) -> None:
    ids = [await _insert_event(repo.pool) for _ in range(4)]
    a, b = await asyncio.gather(repo.claim_batch(), repo.claim_batch())
    seen = {r.id for r in a + b}
    # Each event claimed at most once across both calls.
    assert len(a) + len(b) == len(seen)
    for row_id in ids:
        await repo.mark_done(row_id)


@pytest.mark.integration
async def test_failure_increments_and_backoffs(repo: OutboxRepo) -> None:
    row_id = await _insert_event(repo.pool)
    rows = await repo.claim_batch()
    target = next(r for r in rows if r.id == row_id)
    await repo.mark_failed_or_retry(target, "boom")
    async with repo.pool.acquire() as conn:
        rec = await conn.fetchrow(
            "SELECT attempts, status, last_error FROM outbox_events WHERE id = $1", row_id
        )
    assert rec["attempts"] == 1
    assert rec["status"] == "PENDING"
    assert rec["last_error"] == "boom"
    await repo.mark_done(row_id)
```

- [ ] **Step 9.3: Lint + typecheck**

```bash
pnpm --filter indexer check-types
pnpm --filter indexer lint
```

Expected: green.

- [ ] **Step 9.4: Run unit tests**

```bash
pnpm --filter indexer test
```

Expected: PASS (the integration tests in test_outbox_repo.py are skipped without -m integration).

- [ ] **Step 9.5: Commit**

```bash
git add apps/indexer/indexer/services/outbox.py apps/indexer/tests/test_outbox_repo.py
git commit -m "$(cat <<'EOF'
feat(indexer): outbox repo with FOR UPDATE SKIP LOCKED + backoff

claim_batch atomically selects PENDING rows whose lock has aged out
or never existed, sets locked_at/locked_by, and returns the row data
in a single SQL round-trip. mark_done clears the lock, marks DONE,
and stamps processed_at. mark_failed_or_retry bumps attempts; if
attempts hit INDEXER_MAX_ATTEMPTS the row is FAILED, otherwise the
status stays PENDING with next_attempt_at pushed out by an
exponential backoff capped at 30 minutes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Worker loop + handlers + lifespan

**Files:**
- Create: `apps/indexer/indexer/services/handlers.py`
- Create: `apps/indexer/indexer/services/worker.py`
- Modify: `apps/indexer/indexer/main.py` (start/stop the worker in lifespan)
- Test: `apps/indexer/tests/test_worker_tick.py`

- [ ] **Step 10.1: Write handlers.py**

```python
"""Per-event handlers used by the worker."""

from __future__ import annotations

import json
from typing import Any

import asyncpg

from indexer.exceptions import HandlerError
from indexer.services.chunker import Chunker, tiptap_to_text
from indexer.services.embeddings import EmbeddingsProvider
from indexer.services.outbox import OutboxRow
from indexer.services.qdrant_writer import QdrantWriter


async def handle_page_upserted(
    row: OutboxRow,
    *,
    pool: asyncpg.Pool,
    chunker: Chunker,
    embeddings: EmbeddingsProvider,
    qdrant: QdrantWriter,
) -> None:
    async with pool.acquire() as conn:
        page = await conn.fetchrow(
            """
            SELECT id, workspace_id, ownership, type, title, content, deleted_at
            FROM pages WHERE id = $1::uuid
            """,
            row.aggregate_id,
        )
    if page is None or page["deleted_at"] is not None:
        # Page disappeared or was soft-deleted between enqueue and processing.
        await qdrant.delete_page(page_id=row.aggregate_id)
        return

    raw_content = page["content"]
    if isinstance(raw_content, str):
        content_obj: dict[str, Any] | None = json.loads(raw_content)
    else:
        content_obj = raw_content
    text = tiptap_to_text(content_obj)
    chunks = chunker.chunk(text)
    if not chunks:
        # No text — make sure no stale points exist for this page.
        await qdrant.delete_page(page_id=row.aggregate_id)
        return
    try:
        vectors = await embeddings.embed(chunks)
    except Exception as exc:  # noqa: BLE001
        raise HandlerError(f"embedding failed: {exc}") from exc
    await qdrant.upsert_page(
        page_id=str(page["id"]),
        workspace_id=str(page["workspace_id"]),
        ownership=str(page["ownership"]),
        type_=str(page["type"]),
        title=page["title"],
        chunks=chunks,
        vectors=vectors,
    )


async def handle_page_deleted(row: OutboxRow, *, qdrant: QdrantWriter) -> None:
    await qdrant.delete_page(page_id=row.aggregate_id)


async def handle_file_event(row: OutboxRow) -> None:
    # Pillar D ships file events as no-ops. File extraction lands in a follow-up pillar.
    return None
```

- [ ] **Step 10.2: Write worker.py**

```python
"""Worker loop: claim → dispatch → ack/nack."""

from __future__ import annotations

import asyncio
import logging

import asyncpg

from indexer.services.chunker import Chunker
from indexer.services.embeddings import EmbeddingsProvider
from indexer.services.handlers import (
    handle_file_event,
    handle_page_deleted,
    handle_page_upserted,
)
from indexer.services.outbox import OutboxRepo, OutboxRow
from indexer.services.qdrant_writer import QdrantWriter
from indexer.settings import Settings

log = logging.getLogger(__name__)


class IndexerWorker:
    def __init__(
        self,
        *,
        pool: asyncpg.Pool,
        outbox: OutboxRepo,
        chunker: Chunker,
        embeddings: EmbeddingsProvider,
        qdrant: QdrantWriter,
        settings: Settings,
    ) -> None:
        self.pool = pool
        self.outbox = outbox
        self.chunker = chunker
        self.embeddings = embeddings
        self.qdrant = qdrant
        self.settings = settings

    async def tick(self) -> int:
        rows = await self.outbox.claim_batch()
        for row in rows:
            try:
                await self._dispatch(row)
            except Exception as exc:  # noqa: BLE001
                log.exception("indexer handler error for row %s", row.id)
                await self.outbox.mark_failed_or_retry(row, str(exc))
            else:
                await self.outbox.mark_done(row.id)
        return len(rows)

    async def _dispatch(self, row: OutboxRow) -> None:
        if row.event_type == "page.upserted":
            await handle_page_upserted(
                row,
                pool=self.pool,
                chunker=self.chunker,
                embeddings=self.embeddings,
                qdrant=self.qdrant,
            )
        elif row.event_type == "page.deleted":
            await handle_page_deleted(row, qdrant=self.qdrant)
        elif row.event_type in {"file.upserted", "file.deleted"}:
            await handle_file_event(row)
        else:
            log.warning("unknown event_type %s for row %s", row.event_type, row.id)

    async def run_forever(self, stop_event: asyncio.Event) -> None:
        log.info("indexer worker %s starting", self.settings.indexer_worker_id)
        await self.qdrant.ensure_collection()
        interval = max(0.05, self.settings.indexer_poll_interval_ms / 1000.0)
        while not stop_event.is_set():
            try:
                await self.tick()
            except Exception:
                log.exception("indexer tick crashed; sleeping before retry")
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=interval)
            except asyncio.TimeoutError:
                pass
        log.info("indexer worker %s stopped", self.settings.indexer_worker_id)
```

- [ ] **Step 10.3: Wire worker into FastAPI lifespan in `main.py`**

Replace `apps/indexer/indexer/main.py`:

```python
"""Indexer FastAPI app factory + worker lifecycle."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from dishka import make_async_container
from dishka.integrations.fastapi import setup_dishka
from fastapi import FastAPI

from indexer.di.providers import AppProvider, AppSingletonsProvider
from indexer.entrypoints.rest.router import api_router
from indexer.services.worker import IndexerWorker
from indexer.settings import Settings

log = logging.getLogger(__name__)


def create_app() -> FastAPI:
    settings = Settings()
    logging.basicConfig(level=settings.indexer_log_level)
    container = make_async_container(
        AppProvider(),
        AppSingletonsProvider(),
        context={Settings: settings},
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        worker = await container.get(IndexerWorker)
        stop_event = asyncio.Event()
        task = asyncio.create_task(worker.run_forever(stop_event), name="indexer-worker")
        try:
            yield
        finally:
            stop_event.set()
            try:
                await asyncio.wait_for(task, timeout=10.0)
            except asyncio.TimeoutError:
                task.cancel()
            await container.close()

    app = FastAPI(title="AnyNote Indexer", version="0.1.0", lifespan=lifespan)
    app.include_router(api_router)
    setup_dishka(container=container, app=app)
    return app
```

- [ ] **Step 10.4: Write the worker tick test (unit, no IO)**

`apps/indexer/tests/test_worker_tick.py`:

```python
"""Unit test: tick claims rows, dispatches, acks; failures call retry."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from indexer.services.outbox import OutboxRow
from indexer.services.worker import IndexerWorker


def _row(event_type: str = "page.upserted") -> OutboxRow:
    return OutboxRow(
        id=1, event_type=event_type, aggregate_type="page",
        aggregate_id="00000000-0000-0000-0000-000000000001",
        workspace_id=None, payload={}, attempts=0,
    )


@pytest.mark.asyncio
async def test_tick_marks_done_on_success() -> None:
    outbox = MagicMock()
    outbox.claim_batch = AsyncMock(return_value=[_row()])
    outbox.mark_done = AsyncMock()
    outbox.mark_failed_or_retry = AsyncMock()
    qdrant = MagicMock()
    qdrant.delete_page = AsyncMock()
    qdrant.upsert_page = AsyncMock()
    pool = MagicMock()

    class _Conn:
        async def fetchrow(self, *_args: Any, **_kw: Any) -> dict[str, Any]:
            return {
                "id": "00000000-0000-0000-0000-000000000001",
                "workspace_id": "00000000-0000-0000-0000-000000000002",
                "ownership": "TEXT",
                "type": "TEXT",
                "title": "t",
                "content": {"type": "doc", "content": [{"type": "paragraph",
                            "content": [{"type": "text", "text": "hi"}]}]},
                "deleted_at": None,
            }

    class _Acquire:
        async def __aenter__(self) -> _Conn:
            return _Conn()

        async def __aexit__(self, *_a: Any) -> None:
            return None

    pool.acquire = MagicMock(return_value=_Acquire())
    embeddings = MagicMock()
    embeddings.embed = AsyncMock(return_value=[[0.1] * 768])
    chunker = MagicMock()
    chunker.chunk = MagicMock(return_value=["hi"])

    settings = MagicMock(indexer_max_attempts=5)
    worker = IndexerWorker(
        pool=pool, outbox=outbox, chunker=chunker,
        embeddings=embeddings, qdrant=qdrant, settings=settings,
    )
    n = await worker.tick()
    assert n == 1
    outbox.mark_done.assert_awaited_once_with(1)
    outbox.mark_failed_or_retry.assert_not_awaited()
    qdrant.upsert_page.assert_awaited_once()


@pytest.mark.asyncio
async def test_tick_marks_failed_on_handler_exception() -> None:
    outbox = MagicMock()
    row = _row()
    outbox.claim_batch = AsyncMock(return_value=[row])
    outbox.mark_done = AsyncMock()
    outbox.mark_failed_or_retry = AsyncMock()
    qdrant = MagicMock()
    qdrant.delete_page = AsyncMock(side_effect=RuntimeError("qdrant down"))
    pool = MagicMock()
    embeddings = MagicMock()
    chunker = MagicMock()
    settings = MagicMock(indexer_max_attempts=5)

    worker = IndexerWorker(
        pool=pool, outbox=outbox, chunker=chunker,
        embeddings=embeddings, qdrant=qdrant, settings=settings,
    )
    # Force handler dispatch into page.deleted (which only calls qdrant.delete_page).
    row.event_type = "page.deleted"
    n = await worker.tick()
    assert n == 1
    outbox.mark_failed_or_retry.assert_awaited_once()
    outbox.mark_done.assert_not_awaited()
```

- [ ] **Step 10.5: Run unit tests**

```bash
pnpm --filter indexer test
```

Expected: all PASS. The previously-skipped `test_di_container.py` should now run (services exist) — it should report PASS. If it fails because of an unrelated import issue, fix the import order; the test only resolves `Settings`.

- [ ] **Step 10.6: Lint + typecheck**

```bash
pnpm --filter indexer check-types
pnpm --filter indexer lint
```

Expected: green.

- [ ] **Step 10.7: Commit**

```bash
git add apps/indexer/indexer/services/handlers.py apps/indexer/indexer/services/worker.py apps/indexer/indexer/main.py apps/indexer/tests/test_worker_tick.py
git commit -m "$(cat <<'EOF'
feat(indexer): worker loop + handlers + FastAPI lifespan integration

IndexerWorker.tick() drains a single claim batch with per-row error
isolation: any handler exception lands in mark_failed_or_retry while
successful rows are mark_done'd. run_forever spins on stop_event with
INDEXER_POLL_INTERVAL_MS gaps. The FastAPI lifespan starts the worker
as a background task on app startup and signals + awaits its stop on
shutdown so dev reloads and test teardowns are clean.

handle_page_upserted reads the page row, walks Tiptap content into
text, chunks, embeds, and upserts. handle_page_deleted is a single
qdrant.delete_page call. file.* events are no-ops in Pillar D.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: `/health` endpoint

**Files:**
- Create: `apps/indexer/indexer/entrypoints/rest/health.py`
- Modify: `apps/indexer/indexer/entrypoints/rest/router.py` (mount health)
- Test: `apps/indexer/tests/test_health.py`

- [ ] **Step 11.1: Write the health endpoint**

```python
"""Health endpoint reports queue lag + qdrant reachability."""

from __future__ import annotations

from typing import Any

from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter

from indexer.services.outbox import OutboxRepo
from indexer.services.qdrant_writer import QdrantWriter

router = APIRouter()


@router.get("/health")
@inject
async def health(
    outbox: FromDishka[OutboxRepo], qdrant: FromDishka[QdrantWriter]
) -> dict[str, Any]:
    try:
        lag = await outbox.queue_lag()
        db_status: str | None = None
    except Exception as exc:  # noqa: BLE001
        lag = -1
        db_status = f"unreachable: {exc.__class__.__name__}"
    try:
        await qdrant.client.get_collections()
        qdrant_status = "reachable"
    except Exception:  # noqa: BLE001
        qdrant_status = "unreachable"
    return {
        "status": "ok",
        "queue_lag": lag,
        "qdrant": qdrant_status,
        "database": db_status or "reachable",
        "version": "0.1.0",
    }
```

- [ ] **Step 11.2: Mount the router**

Edit `apps/indexer/indexer/entrypoints/rest/router.py`:

```python
"""Aggregate router for the indexer service."""

from __future__ import annotations

from fastapi import APIRouter

from indexer.entrypoints.rest.health import router as health_router

api_router = APIRouter()
api_router.include_router(health_router)
```

- [ ] **Step 11.3: Write the test**

`apps/indexer/tests/test_health.py`:

```python
"""Tests for the /health endpoint with stubbed dependencies."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from dishka import Provider, Scope, make_async_container, provide
from dishka.integrations.fastapi import setup_dishka
from fastapi import FastAPI
from fastapi.testclient import TestClient

from indexer.entrypoints.rest.health import router as health_router
from indexer.services.outbox import OutboxRepo
from indexer.services.qdrant_writer import QdrantWriter


class _StubProvider(Provider):
    scope = Scope.APP

    def __init__(
        self, *, outbox: OutboxRepo, qdrant: QdrantWriter
    ) -> None:
        super().__init__()
        self._outbox = outbox
        self._qdrant = qdrant

    @provide(scope=Scope.APP)
    def outbox(self) -> OutboxRepo:
        return self._outbox

    @provide(scope=Scope.APP)
    def qdrant(self) -> QdrantWriter:
        return self._qdrant


def _build_app(*, outbox: OutboxRepo, qdrant: QdrantWriter) -> FastAPI:
    app = FastAPI()
    app.include_router(health_router)
    container = make_async_container(_StubProvider(outbox=outbox, qdrant=qdrant))
    setup_dishka(container=container, app=app)
    return app


def test_health_ok() -> None:
    outbox = MagicMock(spec=OutboxRepo)
    outbox.queue_lag = AsyncMock(return_value=3)
    qdrant = MagicMock(spec=QdrantWriter)
    qdrant.client = MagicMock()
    qdrant.client.get_collections = AsyncMock(return_value=MagicMock(collections=[]))

    app = _build_app(outbox=outbox, qdrant=qdrant)
    with TestClient(app) as client:
        r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["queue_lag"] == 3
    assert body["qdrant"] == "reachable"


def test_health_qdrant_unreachable() -> None:
    outbox = MagicMock(spec=OutboxRepo)
    outbox.queue_lag = AsyncMock(return_value=0)
    qdrant = MagicMock(spec=QdrantWriter)
    qdrant.client = MagicMock()
    qdrant.client.get_collections = AsyncMock(side_effect=RuntimeError("nope"))

    app = _build_app(outbox=outbox, qdrant=qdrant)
    with TestClient(app) as client:
        r = client.get("/health")
    body = r.json()
    assert body["qdrant"] == "unreachable"
    assert body["status"] == "ok"
```

- [ ] **Step 11.4: Run unit tests**

```bash
pnpm --filter indexer test
```

Expected: PASS.

- [ ] **Step 11.5: Commit**

```bash
git add apps/indexer/indexer/entrypoints/rest/health.py apps/indexer/indexer/entrypoints/rest/router.py apps/indexer/tests/test_health.py
git commit -m "$(cat <<'EOF'
feat(indexer): /health endpoint reports queue lag + qdrant reachability

Test uses Dishka container override with stub OutboxRepo/QdrantWriter
to keep the spec hermetic.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: End-to-end integration test

**Files:**
- Create: `apps/indexer/tests/test_pipeline_end_to_end.py` (integration)

- [ ] **Step 12.1: Write the e2e test**

```python
"""End-to-end pipeline test against real Postgres + Qdrant + Ollama."""

from __future__ import annotations

import asyncio
import json
import uuid

import asyncpg
import pytest
from qdrant_client import AsyncQdrantClient
from qdrant_client.http import models as qmodels

from indexer.services.chunker import Chunker
from indexer.services.embeddings.ollama import OllamaEmbeddings
from indexer.services.outbox import OutboxRepo
from indexer.services.qdrant_writer import QdrantWriter
from indexer.services.worker import IndexerWorker
from indexer.settings import Settings


@pytest.mark.integration
async def test_end_to_end_index_then_delete() -> None:
    settings = Settings()
    pool = await asyncpg.create_pool(settings.indexer_database_url, min_size=1, max_size=2)
    qdrant_client = AsyncQdrantClient(
        url=settings.indexer_qdrant_url, api_key=settings.indexer_qdrant_api_key
    )
    qdrant = QdrantWriter(client=qdrant_client, settings=settings)
    try:
        await qdrant_client.delete_collection(settings.indexer_qdrant_collection)
    except Exception:
        pass
    await qdrant.ensure_collection()

    outbox = OutboxRepo(pool=pool, settings=settings)
    embeddings = OllamaEmbeddings(
        base_url=settings.ollama_base_url,
        model=settings.embeddings_model,
        dim=settings.embeddings_dim,
    )
    worker = IndexerWorker(
        pool=pool, outbox=outbox, chunker=Chunker(),
        embeddings=embeddings, qdrant=qdrant, settings=settings,
    )

    # Provision a real workspace + page row so the handler can SELECT it.
    user_id = str(uuid.uuid4())
    workspace_id = str(uuid.uuid4())
    page_id = str(uuid.uuid4())
    content = {
        "type": "doc",
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "hello qdrant"}]}
        ],
    }
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO \"user\" (id, email, first_name, last_name, email_verified) "
            "VALUES ($1::uuid, $2, 'T', 'T', false)",
            user_id, f"e2e-{user_id}@test.local",
        )
        await conn.execute(
            "INSERT INTO workspaces (id, name, owner_id) VALUES ($1::uuid, 'e2e', $2::uuid)",
            workspace_id, user_id,
        )
        await conn.execute(
            "INSERT INTO pages (id, workspace_id, title, type, ownership, content) "
            "VALUES ($1::uuid, $2::uuid, 'E2E', 'TEXT', 'TEXT', $3::jsonb)",
            page_id, workspace_id, json.dumps(content),
        )
        await conn.execute(
            "INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, workspace_id) "
            "VALUES ('page.upserted', 'page', $1::uuid, $2::uuid)",
            page_id, workspace_id,
        )

    n = await worker.tick()
    assert n >= 1

    result, _ = await qdrant_client.scroll(
        collection_name=settings.indexer_qdrant_collection,
        scroll_filter=qmodels.Filter(
            must=[qmodels.FieldCondition(key="page_id", match=qmodels.MatchValue(value=page_id))]
        ),
        limit=10,
    )
    assert len(result) >= 1
    assert any(p.payload["chunk_text"].startswith("hello") for p in result)

    # Now enqueue a delete and tick again.
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, workspace_id) "
            "VALUES ('page.deleted', 'page', $1::uuid, $2::uuid)",
            page_id, workspace_id,
        )
    await worker.tick()

    result2, _ = await qdrant_client.scroll(
        collection_name=settings.indexer_qdrant_collection,
        scroll_filter=qmodels.Filter(
            must=[qmodels.FieldCondition(key="page_id", match=qmodels.MatchValue(value=page_id))]
        ),
        limit=10,
    )
    assert result2 == []

    # Cleanup.
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM outbox_events WHERE aggregate_id = $1::uuid", page_id)
        await conn.execute("DELETE FROM pages WHERE id = $1::uuid", page_id)
        await conn.execute("DELETE FROM workspaces WHERE id = $1::uuid", workspace_id)
        await conn.execute('DELETE FROM "user" WHERE id = $1::uuid', user_id)
    await qdrant_client.close()
    await pool.close()
```

- [ ] **Step 12.2: Lint + typecheck**

```bash
pnpm --filter indexer check-types
pnpm --filter indexer lint
```

Expected: green.

- [ ] **Step 12.3: Run unit tests (e2e is gated)**

```bash
pnpm --filter indexer test
```

Expected: PASS. The e2e test is skipped without `-m integration`.

- [ ] **Step 12.4: Commit**

```bash
git add apps/indexer/tests/test_pipeline_end_to_end.py
git commit -m "$(cat <<'EOF'
test(indexer): end-to-end pipeline integration test

Provisions a real user/workspace/page row, enqueues page.upserted,
runs one worker tick, asserts Qdrant has the points, then enqueues
page.deleted, ticks again, asserts the points are gone. Cleans up
all created rows. Marked @pytest.mark.integration so it stays out
of the default suite.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Compose + .env.example + README polish

**Files:**
- Modify: `compose.yml` (add indexer service under `profiles: ["worker"]`, optional qdrant healthcheck)
- Create: `.env.example` at repo root (or modify if it exists)
- Modify: `apps/indexer/README.md` (failure model + ops notes)

- [ ] **Step 13.1: Add indexer service to compose.yml**

Add under the `services:` block (after `redis`):

```yaml
  indexer:
    build:
      context: ./apps/indexer
    profiles: ["worker"]
    depends_on:
      postgres:
        condition: service_healthy
      qdrant:
        condition: service_started
      ollama:
        condition: service_started
    environment:
      INDEXER_DATABASE_URL: postgresql://user:password@postgres:5432/anynote
      INDEXER_QDRANT_URL: http://qdrant:6333
      INDEXER_QDRANT_API_KEY: ${QDRANT_API_KEY:-dev-qdrant-key}
      INDEXER_QDRANT_COLLECTION: anynote-pages
      INDEXER_POLL_INTERVAL_MS: "1000"
      INDEXER_BATCH: "16"
      EMBEDDINGS_PROVIDER: ollama
      EMBEDDINGS_MODEL: nomic-embed-text
      EMBEDDINGS_DIM: "768"
      OLLAMA_BASE_URL: http://ollama:11434
    ports:
      - "8081:8081"
```

The `profiles: ["worker"]` keeps the indexer out of plain `docker compose up -d`; engineers opt-in with `docker compose --profile worker up -d indexer`.

- [ ] **Step 13.2: Create or extend `.env.example` at repo root**

If `.env.example` doesn't exist, create it. Otherwise append. Add a Pillar D section:

```bash
# ── Pillar D — Indexer ─────────────────────────────────────────────
INDEXER_DATABASE_URL=postgresql://user:password@localhost:5432/anynote
INDEXER_QDRANT_URL=http://localhost:6333
INDEXER_QDRANT_API_KEY=dev-qdrant-key
INDEXER_QDRANT_COLLECTION=anynote-pages
INDEXER_POLL_INTERVAL_MS=1000
INDEXER_BATCH=16
INDEXER_LOCK_TTL_MS=60000
INDEXER_MAX_ATTEMPTS=5
INDEXER_LOG_LEVEL=INFO

# Embeddings (consumed by indexer + future apps/engines)
EMBEDDINGS_PROVIDER=ollama
EMBEDDINGS_MODEL=nomic-embed-text
EMBEDDINGS_DIM=768

OPENAI_API_KEY=
```

- [ ] **Step 13.3: Polish `apps/indexer/README.md`**

Replace the file with:

```markdown
# apps/indexer

AnyNote indexer worker. Drains the `outbox_events` table from the main
Postgres database, computes embeddings via Ollama, and upserts points
into Qdrant.

## Quick start (host)

```bash
docker compose up -d postgres qdrant ollama
docker compose exec -T ollama ollama pull nomic-embed-text
pnpm --filter indexer dev
curl http://localhost:8081/health
```

## Quick start (compose worker profile)

```bash
docker compose --profile worker up -d indexer
docker compose logs -f indexer
```

## Tests

```bash
pnpm --filter indexer test            # unit (default)
pnpm --filter indexer test-int        # integration (needs infra)
```

## Failure model

| Scenario | Behavior |
|---|---|
| Qdrant unreachable | `attempts++`, `next_attempt_at = now() + min(60s * 2^attempts, 30min)`, row stays PENDING |
| Embedding API error | same backoff |
| Page row missing (race with delete) | log + ack DONE |
| `attempts >= INDEXER_MAX_ATTEMPTS` | mark FAILED; no further retries |
| Worker crash mid-row | `locked_at` ages out past `INDEXER_LOCK_TTL_MS`; row reclaimed |
| Worker crash post-Qdrant pre-ack | re-processed; Qdrant upsert is idempotent (deterministic point id) |

## Environment

See repo-root `.env.example` for the full list of `INDEXER_*` /
`EMBEDDINGS_*` / `OLLAMA_BASE_URL` / `OPENAI_API_KEY` variables.
```

- [ ] **Step 13.4: Run full-workspace gates**

```bash
pnpm check-types
pnpm lint
pnpm build
```

Expected: green.

- [ ] **Step 13.5: Commit**

```bash
git add compose.yml .env.example apps/indexer/README.md
git commit -m "$(cat <<'EOF'
feat(indexer): compose worker profile + .env.example + README

compose.yml adds an indexer service gated by profiles: ["worker"] so
docker compose up -d stays unchanged. Indexer container reads sane
defaults from the shell, talks to postgres/qdrant/ollama via Compose
DNS, and exposes /health on 8081.

.env.example documents every Pillar D env var with dev-friendly
defaults so new contributors can copy-paste straight into a .env.

README adds the host + compose quick-start paths and a failure-model
table mirroring the spec.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Final gates + smoke + hand-off

**Files:** none modified unless a gate uncovers a fix.

- [ ] **Step 14.1: Re-install + Prisma generate + migrate**

```bash
pnpm install
pnpm --filter @repo/db prisma:generate
pnpm --filter @repo/db exec prisma migrate deploy
```

Expected: every migration (Pillar A + Pillar D) reports already applied or applies cleanly.

- [ ] **Step 14.2: Type-check across the workspace**

```bash
pnpm check-types
```

Expected: green. If `packages/trpc` errors because a new `select` clause excluded a previously-returned field, restore the field in the select.

- [ ] **Step 14.3: Lint**

```bash
pnpm lint
```

Expected: green.

- [ ] **Step 14.4: Build**

```bash
pnpm build
```

Expected: green.

- [ ] **Step 14.5: Unit tests across workspaces**

```bash
pnpm --filter @repo/db test
pnpm --filter @repo/trpc test
pnpm --filter indexer test
pnpm --filter agents test
```

Expected: each PASS. `agents` must NOT regress.

- [ ] **Step 14.6: Integration tests**

```bash
docker compose up -d postgres qdrant ollama
docker compose exec -T ollama ollama pull nomic-embed-text
pnpm --filter indexer test-int
```

Expected: `test_embeddings_ollama.py`, `test_qdrant_writer.py`, `test_outbox_repo.py`, `test_pipeline_end_to_end.py` all PASS.

- [ ] **Step 14.7: Smoke test the indexer worker**

```bash
pnpm --filter indexer dev &
INDEXER_PID=$!
sleep 4
curl -s http://localhost:8081/health
kill $INDEXER_PID 2>/dev/null || true
```

Expected: JSON `{"status":"ok","queue_lag":<int>,"qdrant":"reachable","database":"reachable","version":"0.1.0"}`.

- [ ] **Step 14.8: Branch state review**

```bash
git log --oneline main..HEAD
git status
git diff main..HEAD --stat
```

Expected: ~13 commits in sequence, clean tree, sensible total churn.

- [ ] **Step 14.9: Recovery if any gate failed**

- Narrow miss (missing import, wrong type annotation, forgotten env in `turbo.json`): re-dispatch a focused fix subagent with `fix(indexer|db|trpc): …` scope; do NOT amend.
- Cross-cutting design gap (e.g. payload shape needs new fields, asyncpg + Prisma deadlock under real concurrency, Qdrant client API drift): escalate to the user — Pillar D's contract should not be silently redefined.

- [ ] **Step 14.10: Hand-off (no autonomous merge)**

Report to the user:
- Commit list + `git diff main..HEAD --stat`
- Confirmed gates (`check-types`, `lint`, `build`, unit tests, integration tests)
- `GET /health` smoke output
- Out-of-scope follow-ups per the spec (file extraction, search tRPC procedure, engines MCP server [Pillar E], workspace AI settings UI [Pillar F], operator-driven re-index admin tool [Pillar G])

The user decides merge timing — typically `git merge --no-ff feat/indexing-pipeline` into `main`, mirroring Pillars A + B1.

---

## Self-Review — spec ↔ plan coverage

| Spec goal | Task |
|-----------|------|
| 1. `outbox_events` table in main DB via Prisma migration | T1 |
| 2. `enqueueOutboxEvent(tx, …)` helper in `@repo/db` | T2 |
| 3. `apps/indexer/` service (pyproject/uv.lock/package.json) — worker-only + `/health` | T4, T11 |
| 4. Poll with `FOR UPDATE SKIP LOCKED`, batch, exponential backoff | T9, T10 |
| 5. Pluggable embeddings (Ollama concrete, OpenAI scaffold) | T6 |
| 6. Tiptap→text + chunker | T7 |
| 7. `anynote-pages` collection + payload indexes, auto-bootstrap | T8 |
| 8. Tombstones delete by `page_id` payload filter | T8, T10 |
| 9. Unit + integration tests (chunker, factory, outbox, worker, e2e) | T1–T12 |
| 10. `turbo.json` `globalEnv` rename + additions | T4 |
| 11. Compose profile for the indexer | T13 |
| 12. Repo green across every gate | T14 |

**Placeholder scan:** every step contains literal code or commands. No "TBD" / "implement the rest" / "appropriate error handling" language. Three explicit contingency notes (Step 5.3 importorskip until services land; Step 8.3 `Range` model alternative; Step 14.9 recovery branch) are recovery instructions, not placeholders.

**Naming consistency:** `OutboxEvent` / `OutboxEventStatus` / `outbox_events` / `enqueueOutboxEvent` / `OutboxRepo` / `OutboxRow` match Prisma + helper + Python. `IndexerWorker` / `QdrantWriter` / `Chunker` / `EmbeddingsProvider` / `OllamaEmbeddings` / `OpenAIEmbeddings` match across the DI container, services, tests, and lifespan wiring. Env-var names (`INDEXER_*`, `EMBEDDINGS_*`, `OLLAMA_BASE_URL`, `OPENAI_API_KEY`) match spec, pyproject, Settings, conftest, `.env.example`, Compose, and `turbo.json`.

**Scope check:** single pillar, 13 content-producing commits + final verification, no scope creep into apps/web UI / Pillar E MCP / Pillar F AI settings / Pillar G reindex admin. File-extraction stubs exist in dispatch only (no-op handlers) so the schema is forward-compatible without touching scope D.

### Critical Files for Implementation

- `/Users/victor/Projects/anynote/packages/db/prisma/schema.prisma`
- `/Users/victor/Projects/anynote/packages/db/src/outbox.ts`
- `/Users/victor/Projects/anynote/packages/trpc/src/routers/page.ts`
- `/Users/victor/Projects/anynote/apps/indexer/indexer/services/worker.py`
- `/Users/victor/Projects/anynote/apps/indexer/indexer/services/outbox.py`
- `/Users/victor/Projects/anynote/apps/indexer/indexer/services/qdrant_writer.py`
- `/Users/victor/Projects/anynote/apps/indexer/indexer/services/handlers.py`
