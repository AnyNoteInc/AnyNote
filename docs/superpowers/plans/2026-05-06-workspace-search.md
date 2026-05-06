# Workspace-wide Page Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Cmd/Alt+K-driven workspace-wide page search dialog with sidebar entry, recent-search history, Postgres FTS + Qdrant fallback, and integration with the existing block-anchor scroll/flash mechanism.

**Architecture:** Server orchestrates two parallel branches in a single tRPC procedure (`search.search`); Postgres FTS uses a generated `tsvector` column on `Page`; Qdrant search calls a new thin HTTP endpoint on `apps/agents` that wraps `RagRetrievalService`. Recent-search history is a new `SearchHistory` table with upsert + prune-to-20 semantics. The dialog is mounted in a `SearchDialogProvider` scoped to `/workspaces/[id]/...`, where a global `Cmd+K`/`Alt+K` listener and the new sidebar entry both dispatch `open()`.

**Tech Stack:** Prisma 7 (`Unsupported("tsvector")` + raw SQL migration) · tRPC v11 (`protectedProcedure`) · FastAPI (`apps/agents`) with Dishka DI · MUI v6 via `@repo/ui/components` · Next.js 16 App Router (`'use client'` provider) · Vitest + Playwright for tests.

**Spec reference:** [docs/superpowers/specs/2026-05-06-workspace-search-design.md](../specs/2026-05-06-workspace-search-design.md)

---

## File map

**Created:**
- `packages/db/prisma/migrations/<ts>_search_index_and_history/migration.sql`
- `apps/agents/agents/apps/search/__init__.py`
- `apps/agents/agents/apps/search/router.py`
- `apps/agents/agents/apps/search/schemas.py`
- `apps/agents/tests/apps/search/__init__.py`
- `apps/agents/tests/apps/search/test_router.py`
- `packages/trpc/src/services/page-search.ts`
- `packages/trpc/src/services/__tests__/page-search.test.ts`
- `packages/trpc/src/routers/search.ts`
- `packages/trpc/test/search-router.test.ts`
- `apps/web/src/components/search/search-dialog-provider.tsx`
- `apps/web/src/components/search/search-dialog.tsx`
- `apps/web/src/components/search/sidebar-search-trigger.tsx`
- `apps/web/src/components/search/use-search-hotkey.ts`
- `apps/web/src/components/search/highlight-matches.tsx`
- `apps/web/src/components/search/__tests__/highlight-matches.test.tsx`
- `apps/e2e/search.spec.ts`

**Modified:**
- `packages/db/prisma/schema.prisma` (add `SearchHistory` model, `Page.searchVector`, reciprocal relations)
- `apps/agents/agents/router.py` (mount `search_router`)
- `packages/trpc/src/index.ts` (mount `search` router)
- `packages/ui/src/components/index.ts` (export `LinearProgress`, `HistoryIcon`, `CloseIcon`)
- `apps/web/src/components/workspace/workspace-sidebar.tsx` (insert `<SidebarSearchTrigger />`)
- `apps/web/src/components/workspace/workspace-layout-client.tsx` (wrap with `<SearchDialogProvider>`, mount `useSearchHotkey`)

---

## Task 1: Database schema and migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<ts>_search_index_and_history/migration.sql` (Prisma generates filename)

- [ ] **Step 1: Edit `packages/db/prisma/schema.prisma`**

Find the `model Page {` block and add the tsvector field plus index near the bottom (before the closing brace):

```prisma
  searchVector  Unsupported("tsvector")?  @map("search_vector")

  searchHistory SearchHistory[]

  @@index([searchVector], type: Gin, name: "Page_searchVector_idx")
```

Find the `model User {` block and add a back-relation:

```prisma
  searchHistory SearchHistory[]
```

Find the `model Workspace {` block and add a back-relation:

```prisma
  searchHistory SearchHistory[]
```

Append a new model at the bottom of the file:

```prisma
model SearchHistory {
  id            String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId        String   @map("user_id") @db.Uuid
  workspaceId   String   @map("workspace_id") @db.Uuid
  pageId        String   @map("page_id") @db.Uuid
  lastVisitedAt DateTime @default(now()) @map("last_visited_at") @db.Timestamptz(6)

  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  page      Page      @relation(fields: [pageId], references: [id], onDelete: Cascade)

  @@unique([userId, workspaceId, pageId])
  @@index([userId, workspaceId, lastVisitedAt(sort: Desc)])
  @@map("search_history")
}
```

- [ ] **Step 2: Generate migration skeleton (without applying)**

Run:
```bash
pnpm --filter @repo/db exec prisma migrate dev --name search_index_and_history --create-only
```

Expected: a new migration directory `packages/db/prisma/migrations/<timestamp>_search_index_and_history/` with `migration.sql`.

- [ ] **Step 3: Hand-edit the generated `migration.sql`**

Prisma cannot generate a `GENERATED ALWAYS AS ... STORED` column for an `Unsupported` type. Replace the `ALTER TABLE "pages" ADD COLUMN "search_vector" tsvector;` line (Prisma will have generated something close to this) with:

```sql
-- Generated tsvector column on pages
ALTER TABLE "pages" ADD COLUMN "search_vector" tsvector
GENERATED ALWAYS AS (
  setweight(to_tsvector('russian', coalesce(title, '')), 'A') ||
  setweight(jsonb_to_tsvector('russian', coalesce(content, '{}'::jsonb), '["string"]'), 'B')
) STORED;
```

Keep the `CREATE INDEX "Page_searchVector_idx" ON "pages" USING GIN ("search_vector");` line and the `search_history` table / FK / unique-index lines as Prisma generated them.

- [ ] **Step 4: Apply the migration**

Run:
```bash
pnpm --filter @repo/db exec prisma migrate dev
```

Expected: migration applies, `prisma generate` runs.

- [ ] **Step 5: Verify the FTS column populates**

Run:
```bash
docker compose exec postgres psql -U postgres -d anynote -c 'SELECT id, search_vector IS NOT NULL AS has_vec FROM pages LIMIT 5;'
```

Expected: rows with `has_vec = t`. If table is empty, run a smoke insert + select instead.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): add Page.searchVector and SearchHistory model"
```

---

## Task 2: apps/agents — search Pydantic schemas

**Files:**
- Create: `apps/agents/agents/apps/search/__init__.py`
- Create: `apps/agents/agents/apps/search/schemas.py`

- [ ] **Step 1: Create the empty package init**

Create an empty `apps/agents/agents/apps/search/__init__.py` (matches sibling `processing/__init__.py`).

- [ ] **Step 2: Create `apps/agents/agents/apps/search/schemas.py`**

```python
"""Schemas for the page-search HTTP API."""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from pydantic import Field

from agents.apps.processing.schemas import EmbeddingProviderConfigSchema
from fast_clean.schemas.request_response import RequestResponseSchema


class SearchRequestSchema(RequestResponseSchema):
    workspaceId: UUID
    query: Annotated[str, Field(min_length=1, max_length=500)]
    limit: Annotated[int, Field(default=10, ge=1, le=50)]
    embedding: EmbeddingProviderConfigSchema


class SearchResultSchema(RequestResponseSchema):
    pageId: UUID
    title: str
    blockNumber: int
    content: str


class SearchResponseSchema(RequestResponseSchema):
    results: list[SearchResultSchema]
```

Notes:
- We reuse `EmbeddingProviderConfigSchema` from `processing/schemas.py` (the same one consumed by `/vectorization`).
- `RequestResponseSchema` is the project's base schema (snake_case + camelCase aliases). Confirmed by existing `RagDocumentSchema` use.

- [ ] **Step 3: Commit**

```bash
git add apps/agents/agents/apps/search/__init__.py apps/agents/agents/apps/search/schemas.py
git commit -m "feat(agents): add page-search schemas"
```

---

## Task 3: apps/agents — search router + mount + integration test

**Files:**
- Create: `apps/agents/agents/apps/search/router.py`
- Modify: `apps/agents/agents/router.py` (mount)
- Create: `apps/agents/tests/apps/search/__init__.py`
- Create: `apps/agents/tests/apps/search/test_router.py`

- [ ] **Step 1: Write the failing endpoint test**

Create an empty `apps/agents/tests/apps/search/__init__.py`.

Create `apps/agents/tests/apps/search/test_router.py`:

```python
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from agents.apps.chat.schemas import RagDocumentSchema
from agents.apps.chat.services.rag_retrieval import RagRetrievalService
from agents.bootstrap import create_app
from agents.router import apply_routes
from fastapi.testclient import TestClient


@pytest.fixture
def app_with_mock_rag(monkeypatch):
    docs = [
        RagDocumentSchema(
            page_id=uuid4(),
            workspace_id=uuid4(),
            title='Page A',
            page_type='TEXT',
            block_number=2,
            content='hello world',
        ),
    ]

    async def fake_retrieve(self, *, embedding, workspace_id, query, k=5):
        return docs

    monkeypatch.setattr(RagRetrievalService, 'retrieve', fake_retrieve)
    return create_app([apply_routes]), docs


def _payload(workspace_id: str, query: str = 'hello'):
    return {
        'workspaceId': workspace_id,
        'query': query,
        'limit': 10,
        'embedding': {
            'provider': 'ollama',
            'modelSlug': 'nomic-embed-text',
            'vectorSize': 768,
            'connection': {'baseUrl': 'http://localhost:11434'},
        },
    }


def test_search_returns_rag_results(app_with_mock_rag):
    app, docs = app_with_mock_rag
    with TestClient(app) as client:
        ws_id = str(uuid4())
        res = client.post('/v1/search', json=_payload(ws_id))
        assert res.status_code == 200
        body = res.json()
        assert len(body['results']) == 1
        assert body['results'][0]['title'] == 'Page A'
        assert body['results'][0]['blockNumber'] == 2
        assert body['results'][0]['content'] == 'hello world'


def test_search_rejects_empty_query():
    app = create_app([apply_routes])
    with TestClient(app) as client:
        ws_id = str(uuid4())
        payload = _payload(ws_id, query='')
        res = client.post('/v1/search', json=payload)
        assert res.status_code == 422  # pydantic validation


def test_search_rejects_long_query():
    app = create_app([apply_routes])
    with TestClient(app) as client:
        ws_id = str(uuid4())
        payload = _payload(ws_id, query='x' * 600)
        res = client.post('/v1/search', json=payload)
        assert res.status_code == 422
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:
```bash
pnpm --filter agents exec pytest tests/apps/search/test_router.py -v
```

Expected: 404 on the POST (router not mounted) for the first test; first test fails.

- [ ] **Step 3: Implement the search router**

Create `apps/agents/agents/apps/search/router.py`:

```python
"""Page search HTTP routes."""

from __future__ import annotations

from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter

from agents.apps.chat.services import RagRetrievalService

from .schemas import SearchRequestSchema, SearchResponseSchema, SearchResultSchema

router = APIRouter(prefix='/v1/search', tags=['Search'])


@router.post('', response_model=SearchResponseSchema)
@inject
async def search_pages(
    payload: SearchRequestSchema,
    rag: FromDishka[RagRetrievalService],
) -> SearchResponseSchema:
    docs = await rag.retrieve(
        embedding=payload.embedding,
        workspace_id=payload.workspaceId,
        query=payload.query,
        k=payload.limit,
    )
    return SearchResponseSchema(
        results=[
            SearchResultSchema(
                pageId=doc.page_id,
                title=doc.title,
                blockNumber=doc.block_number,
                content=doc.content,
            )
            for doc in docs
        ],
    )
```

- [ ] **Step 4: Mount the router**

Edit `apps/agents/agents/router.py`. Add an import and an `include_router` call:

```python
from fast_clean.contrib.healthcheck.router import router as healthcheck_router
from fastapi import FastAPI

from agents.apps.chat.router import router as chat_router
from agents.apps.processing.router import router as processing_router
from agents.apps.search.router import router as search_router


def apply_routes(app: FastAPI) -> None:
    app.include_router(chat_router)
    app.include_router(healthcheck_router)
    app.include_router(processing_router)
    app.include_router(search_router)
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run:
```bash
pnpm --filter agents exec pytest tests/apps/search/test_router.py -v
```

Expected: 3 passed.

- [ ] **Step 6: Run the full agents test suite to confirm no regression**

Run:
```bash
pnpm --filter agents test
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add apps/agents/agents/apps/search apps/agents/agents/router.py apps/agents/tests/apps/search
git commit -m "feat(agents): expose /v1/search endpoint over RagRetrievalService"
```

---

## Task 4: tRPC service helpers — `findFirstMatchingBlock` + `extractExcerpt`

**Files:**
- Create: `packages/trpc/src/services/page-search.ts` (helpers only; PG/Qdrant branches added in Task 5/6)
- Create: `packages/trpc/src/services/__tests__/page-search.test.ts`

- [ ] **Step 1: Write the failing unit tests**

Create `packages/trpc/src/services/__tests__/page-search.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'

import { extractExcerpt, findFirstMatchingBlock } from '../page-search'

describe('findFirstMatchingBlock', () => {
  it('returns null on non-doc input', () => {
    expect(findFirstMatchingBlock(null, 'foo')).toBeNull()
    expect(findFirstMatchingBlock({ type: 'paragraph' }, 'foo')).toBeNull()
  })

  it('returns null when no top-level child contains the query', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'apples' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'oranges' }] },
      ],
    }
    expect(findFirstMatchingBlock(doc, 'banana')).toBeNull()
  })

  it('finds first matching block index (case-insensitive)', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Lorem ipsum' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello WORLD foo' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'world again' }] },
      ],
    }
    const hit = findFirstMatchingBlock(doc, 'world')
    expect(hit?.blockNumber).toBe(1)
    expect(hit?.excerpt).toContain('WORLD')
  })

  it('walks nested marks and child arrays', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          content: [
            { type: 'text', text: 'Intro: ' },
            { type: 'text', text: 'targetWord', marks: [{ type: 'bold' }] },
          ],
        },
      ],
    }
    expect(findFirstMatchingBlock(doc, 'targetword')?.blockNumber).toBe(0)
  })

  it('handles Cyrillic input', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Это поиск по тексту' }] },
      ],
    }
    expect(findFirstMatchingBlock(doc, 'поиск')?.blockNumber).toBe(0)
  })
})

describe('extractExcerpt', () => {
  it('returns full text if shorter than window', () => {
    expect(extractExcerpt('hello world', 'world', 100)).toBe('hello world')
  })

  it('truncates with ellipsis on both sides when match is in the middle', () => {
    const text = 'a'.repeat(200) + ' MATCH ' + 'b'.repeat(200)
    const out = extractExcerpt(text, 'match', 50)
    expect(out.startsWith('…')).toBe(true)
    expect(out.endsWith('…')).toBe(true)
    expect(out.toLowerCase()).toContain('match')
  })

  it('replaces newlines with spaces', () => {
    const text = 'line one\nline two with match\nline three'
    const out = extractExcerpt(text, 'match', 100)
    expect(out).not.toContain('\n')
    expect(out).toContain('match')
  })

  it('returns the original string if query is missing', () => {
    expect(extractExcerpt('hello world', 'nope', 100)).toBe('hello world')
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:
```bash
pnpm --filter @repo/trpc test -- page-search
```

Expected: cannot resolve `../page-search` — FAIL.

- [ ] **Step 3: Implement the helpers**

Create `packages/trpc/src/services/page-search.ts`:

```typescript
const MAX_EXCERPT_WINDOW = 100

type TiptapNode = {
  type?: string
  text?: string
  content?: TiptapNode[]
}

function extractText(node: TiptapNode): string {
  if (typeof node.text === 'string') return node.text
  if (!Array.isArray(node.content)) return ''
  return node.content.map(extractText).join('')
}

export function findFirstMatchingBlock(
  doc: unknown,
  query: string,
): { blockNumber: number; excerpt: string } | null {
  if (
    !doc ||
    typeof doc !== 'object' ||
    (doc as TiptapNode).type !== 'doc' ||
    !Array.isArray((doc as TiptapNode).content)
  ) {
    return null
  }
  const lower = query.toLowerCase()
  const blocks = (doc as TiptapNode).content as TiptapNode[]
  for (let i = 0; i < blocks.length; i++) {
    const text = extractText(blocks[i])
    if (text.toLowerCase().includes(lower)) {
      return { blockNumber: i, excerpt: extractExcerpt(text, query, MAX_EXCERPT_WINDOW) }
    }
  }
  return null
}

export function extractExcerpt(text: string, query: string, window: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const idx = flat.toLowerCase().indexOf(query.toLowerCase())
  if (idx < 0) return flat
  const start = Math.max(0, idx - window)
  const end = Math.min(flat.length, idx + query.length + window)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < flat.length ? '…' : ''
  return `${prefix}${flat.slice(start, end)}${suffix}`
}

export type SearchResultItem = {
  pageId: string
  title: string
  icon: string | null
  blockNumber: number | null
  excerpt: string | null
  source: 'postgres' | 'qdrant'
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run:
```bash
pnpm --filter @repo/trpc test -- page-search
```

Expected: all tests in `__tests__/page-search.test.ts` pass.

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/services/page-search.ts packages/trpc/src/services/__tests__/page-search.test.ts
git commit -m "feat(trpc): add page-search text helpers (findFirstMatchingBlock, extractExcerpt)"
```

---

## Task 5: tRPC service — `searchPg` Postgres FTS branch

**Files:**
- Modify: `packages/trpc/src/services/page-search.ts`

- [ ] **Step 1: Write a failing unit test for `searchPg`**

Append to `packages/trpc/src/services/__tests__/page-search.test.ts`:

```typescript
import { vi } from 'vitest'
import { searchPg } from '../page-search'

const WS = '11111111-1111-1111-1111-111111111111'
const PG_ROW = (overrides: Partial<{ id: string; title: string; type: string; content: unknown }> = {}) => ({
  id: '22222222-2222-2222-2222-222222222222',
  title: 'A doc',
  icon: null,
  type: 'TEXT',
  content: {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'foo bar baz' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'matchword here' }] },
    ],
  },
  ...overrides,
})

function mockPrisma(rows: unknown[]) {
  return { $queryRaw: vi.fn(async () => rows) } as unknown as import('@repo/db').PrismaClient
}

describe('searchPg', () => {
  it('returns empty when query shorter than 2 chars', async () => {
    const prisma = mockPrisma([])
    expect(await searchPg(prisma, WS, 'a')).toEqual([])
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })

  it('returns empty when prisma yields no rows', async () => {
    const prisma = mockPrisma([])
    expect(await searchPg(prisma, WS, 'matchword')).toEqual([])
  })

  it('maps rows + locates matching block for TEXT pages', async () => {
    const prisma = mockPrisma([PG_ROW()])
    const out = await searchPg(prisma, WS, 'matchword')
    expect(out).toHaveLength(1)
    expect(out[0].pageId).toBe('22222222-2222-2222-2222-222222222222')
    expect(out[0].blockNumber).toBe(1)
    expect(out[0].excerpt).toContain('matchword')
    expect(out[0].source).toBe('postgres')
  })

  it('returns null block/excerpt for non-TEXT pages', async () => {
    const prisma = mockPrisma([PG_ROW({ type: 'EXCALIDRAW', content: null })])
    const out = await searchPg(prisma, WS, 'matchword')
    expect(out).toHaveLength(1)
    expect(out[0].blockNumber).toBeNull()
    expect(out[0].excerpt).toBeNull()
  })

  it('returns null block/excerpt when title matches but content does not', async () => {
    const prisma = mockPrisma([
      PG_ROW({
        title: 'matchword title',
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'unrelated' }] }] },
      }),
    ])
    const out = await searchPg(prisma, WS, 'matchword')
    expect(out[0].blockNumber).toBeNull()
    expect(out[0].excerpt).toBeNull()
  })
})
```

- [ ] **Step 2: Run and confirm fail**

Run:
```bash
pnpm --filter @repo/trpc test -- page-search
```

Expected: import error for `searchPg`.

- [ ] **Step 3: Implement `searchPg`**

In `packages/trpc/src/services/page-search.ts`, add an import at the top of the file:

```typescript
import type { Prisma, PrismaClient } from '@repo/db'
```

Then append the new code below the existing helpers:

```typescript
type PgRow = {
  id: string
  title: string | null
  icon: string | null
  type: string
  content: Prisma.JsonValue | null
}

export async function searchPg(
  prisma: PrismaClient,
  workspaceId: string,
  rawQuery: string,
): Promise<SearchResultItem[]> {
  const query = rawQuery.trim().slice(0, 200)
  if (query.length < 2) return []

  const rows = await prisma.$queryRaw<PgRow[]>`
    SELECT id, title, icon, content, type::text AS type
    FROM "pages"
    WHERE "workspace_id" = ${workspaceId}::uuid
      AND "deleted_at" IS NULL
      AND "archived" = false
      AND "search_vector" @@ websearch_to_tsquery('russian', ${query})
    ORDER BY ts_rank("search_vector", websearch_to_tsquery('russian', ${query})) DESC
    LIMIT 10
  `

  return rows.map((row) => {
    if (row.type !== 'TEXT' || !row.content) {
      return {
        pageId: row.id,
        title: row.title ?? '',
        icon: row.icon,
        blockNumber: null,
        excerpt: null,
        source: 'postgres' as const,
      }
    }
    const hit = findFirstMatchingBlock(row.content, query)
    return {
      pageId: row.id,
      title: row.title ?? '',
      icon: row.icon,
      blockNumber: hit?.blockNumber ?? null,
      excerpt: hit?.excerpt ?? null,
      source: 'postgres' as const,
    }
  })
}
```

- [ ] **Step 4: Run and confirm pass**

Run:
```bash
pnpm --filter @repo/trpc test -- page-search
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/services/page-search.ts packages/trpc/src/services/__tests__/page-search.test.ts
git commit -m "feat(trpc): add searchPg Postgres FTS branch"
```

---

## Task 6: tRPC service — `searchQdrant` agents-backed branch

**Files:**
- Modify: `packages/trpc/src/services/page-search.ts`
- Modify: `packages/trpc/src/services/__tests__/page-search.test.ts`

- [ ] **Step 1: Write failing tests for `searchQdrant`**

Append to `packages/trpc/src/services/__tests__/page-search.test.ts`:

```typescript
import { searchQdrant } from '../page-search'

vi.mock('../../helpers/plan', () => ({
  getWorkspaceFeatures: vi.fn(),
}))
import { getWorkspaceFeatures } from '../../helpers/plan'

describe('searchQdrant', () => {
  const ENV_BACKUP = process.env.AGENTS_SERVICE_URL
  beforeEach(() => {
    process.env.AGENTS_SERVICE_URL = 'http://agents.local'
    vi.restoreAllMocks()
    vi.mocked(getWorkspaceFeatures).mockResolvedValue({ pageIndexingEnabled: true } as never)
  })
  afterAll(() => {
    process.env.AGENTS_SERVICE_URL = ENV_BACKUP
  })

  function prismaWithAi(opts: {
    aiSettings: unknown
    pages?: Array<{ id: string; icon: string | null }>
  }) {
    return {
      workspaceAiSettings: { findUnique: vi.fn(async () => opts.aiSettings) },
      page: {
        findMany: vi.fn(async () => opts.pages ?? []),
      },
    } as unknown as import('@repo/db').PrismaClient
  }

  const VALID_AI = {
    embeddingsModel: {
      slug: 'nomic-embed-text',
      vectorSize: 768,
      provider: { slug: 'ollama', connection: { baseUrl: 'http://localhost:11434' } },
    },
  }

  it('returns [] when query shorter than 2 chars', async () => {
    const prisma = prismaWithAi({ aiSettings: VALID_AI })
    expect(await searchQdrant(prisma, WS, 'a')).toEqual([])
  })

  it('returns [] when no embedding model configured', async () => {
    const prisma = prismaWithAi({ aiSettings: { embeddingsModel: null } })
    expect(await searchQdrant(prisma, WS, 'matchword')).toEqual([])
  })

  it('returns [] when plan does not have indexing', async () => {
    vi.mocked(getWorkspaceFeatures).mockResolvedValueOnce({ pageIndexingEnabled: false } as never)
    const prisma = prismaWithAi({ aiSettings: VALID_AI })
    expect(await searchQdrant(prisma, WS, 'matchword')).toEqual([])
  })

  it('returns [] on agents 5xx', async () => {
    const prisma = prismaWithAi({ aiSettings: VALID_AI })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    expect(await searchQdrant(prisma, WS, 'matchword')).toEqual([])
  })

  it('maps results and filters out deleted/archived pages', async () => {
    const aliveId = '33333333-3333-3333-3333-333333333333'
    const deletedId = '44444444-4444-4444-4444-444444444444'
    const prisma = prismaWithAi({
      aiSettings: VALID_AI,
      pages: [{ id: aliveId, icon: '📄' }],
    })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      results: [
        { pageId: aliveId, title: 'Alive', blockNumber: 3, content: 'snippet text' },
        { pageId: deletedId, title: 'Gone', blockNumber: 0, content: '...' },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await searchQdrant(prisma, WS, 'matchword')
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0]).toBe('http://agents.local/v1/search')
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({
      pageId: aliveId,
      title: 'Alive',
      icon: '📄',
      blockNumber: 3,
      excerpt: 'snippet text',
      source: 'qdrant',
    })
  })
})
```

- [ ] **Step 2: Run and confirm fail**

Run:
```bash
pnpm --filter @repo/trpc test -- page-search
```

Expected: import error for `searchQdrant`.

- [ ] **Step 3: Implement `searchQdrant`**

Append to `packages/trpc/src/services/page-search.ts`:

```typescript
import { getWorkspaceFeatures } from '../helpers/plan'

type WorkspaceAiSettingsRow = {
  embeddingsModel: {
    slug: string
    vectorSize: number
    provider: { slug: string; connection: unknown }
  } | null
} | null

type EmbeddingPayload = {
  provider: string
  modelSlug: string
  vectorSize: number
  connection: Record<string, string>
}

function normalizeConnection(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}

function buildEmbedding(ai: WorkspaceAiSettingsRow): EmbeddingPayload | null {
  if (!ai?.embeddingsModel) return null
  return {
    provider: ai.embeddingsModel.provider.slug,
    modelSlug: ai.embeddingsModel.slug,
    vectorSize: ai.embeddingsModel.vectorSize,
    connection: normalizeConnection(ai.embeddingsModel.provider.connection),
  }
}

type AgentsSearchResult = { pageId: string; title: string; blockNumber: number; content: string }

export async function searchQdrant(
  prisma: PrismaClient,
  workspaceId: string,
  rawQuery: string,
): Promise<SearchResultItem[]> {
  const query = rawQuery.trim().slice(0, 200)
  if (query.length < 2) return []

  const ai = (await prisma.workspaceAiSettings.findUnique({
    where: { workspaceId },
    include: { embeddingsModel: { include: { provider: true } } },
  })) as WorkspaceAiSettingsRow

  const embedding = buildEmbedding(ai)
  if (!embedding) return []

  const features = await getWorkspaceFeatures(workspaceId)
  if (!features.pageIndexingEnabled) return []

  const url = process.env.AGENTS_SERVICE_URL ?? 'http://localhost:8080'
  try {
    const res = await fetch(`${url}/v1/search`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-workspace-id': workspaceId,
      },
      body: JSON.stringify({ workspaceId, query, limit: 10, embedding }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return []
    const body = (await res.json()) as { results: AgentsSearchResult[] }
    const ids = body.results.map((r) => r.pageId)
    if (ids.length === 0) return []
    const pages = await prisma.page.findMany({
      where: { id: { in: ids }, workspaceId, deletedAt: null, archived: false },
      select: { id: true, icon: true },
    })
    const iconMap = new Map(pages.map((p) => [p.id, p.icon]))
    const aliveIds = new Set(pages.map((p) => p.id))
    return body.results
      .filter((r) => aliveIds.has(r.pageId))
      .map((r) => ({
        pageId: r.pageId,
        title: r.title,
        icon: iconMap.get(r.pageId) ?? null,
        blockNumber: r.blockNumber,
        excerpt: r.content,
        source: 'qdrant' as const,
      }))
  } catch {
    return []
  }
}
```

- [ ] **Step 4: Run and confirm pass**

Run:
```bash
pnpm --filter @repo/trpc test -- page-search
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/services/page-search.ts packages/trpc/src/services/__tests__/page-search.test.ts
git commit -m "feat(trpc): add searchQdrant agents-backed branch"
```

---

## Task 7: tRPC search router — `search.search` + history procs

**Files:**
- Create: `packages/trpc/src/routers/search.ts`
- Create: `packages/trpc/test/search-router.test.ts`

- [ ] **Step 1: Write the failing router test**

Create `packages/trpc/test/search-router.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return { ...actual, prisma: {} }
})

vi.mock('../src/services/page-search', () => ({
  searchPg: vi.fn(),
  searchQdrant: vi.fn(),
}))

import type { PrismaClient } from '@repo/db'

import { searchRouter } from '../src/routers/search'
import { searchPg, searchQdrant } from '../src/services/page-search'
import { createCallerFactory } from '../src/trpc'

const USER = '99999999-9999-9999-9999-999999999999'
const WS = '11111111-1111-1111-1111-111111111111'
const PAGE_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const PAGE_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

function ctx(prisma: PrismaClient) {
  return {
    prisma,
    user: { id: USER },
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {},
    returnUrlBase: 'http://localhost:3000',
  }
}

function memberPrisma(extras: Partial<Record<string, unknown>> = {}): PrismaClient {
  return {
    workspaceMember: { findUnique: vi.fn(async () => ({ role: 'MEMBER' })) },
    ...extras,
  } as unknown as PrismaClient
}

describe('search.search', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns postgres results when non-empty', async () => {
    vi.mocked(searchPg).mockResolvedValue([
      { pageId: PAGE_A, title: 'PG hit', icon: null, blockNumber: 1, excerpt: '…hit…', source: 'postgres' },
    ])
    vi.mocked(searchQdrant).mockResolvedValue([
      { pageId: PAGE_B, title: 'should be ignored', icon: null, blockNumber: 0, excerpt: 'x', source: 'qdrant' },
    ])
    const caller = createCallerFactory(searchRouter)(ctx(memberPrisma()))
    const out = await caller.search({ workspaceId: WS, query: 'q' })
    expect(out).toHaveLength(1)
    expect(out[0].source).toBe('postgres')
    expect(out[0].pageId).toBe(PAGE_A)
  })

  it('falls back to qdrant when postgres empty', async () => {
    vi.mocked(searchPg).mockResolvedValue([])
    vi.mocked(searchQdrant).mockResolvedValue([
      { pageId: PAGE_B, title: 'Qd hit', icon: null, blockNumber: 0, excerpt: 'x', source: 'qdrant' },
    ])
    const caller = createCallerFactory(searchRouter)(ctx(memberPrisma()))
    const out = await caller.search({ workspaceId: WS, query: 'q' })
    expect(out).toHaveLength(1)
    expect(out[0].source).toBe('qdrant')
  })

  it('rejects non-members', async () => {
    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => null) },
    } as unknown as PrismaClient
    const caller = createCallerFactory(searchRouter)(ctx(prisma))
    await expect(caller.search({ workspaceId: WS, query: 'q' })).rejects.toThrow(/участник/)
  })

  it('propagates postgres failure as a real error', async () => {
    vi.mocked(searchPg).mockRejectedValue(new Error('DB down'))
    vi.mocked(searchQdrant).mockResolvedValue([])
    const caller = createCallerFactory(searchRouter)(ctx(memberPrisma()))
    await expect(caller.search({ workspaceId: WS, query: 'q' })).rejects.toThrow('DB down')
  })

  it('returns [] when both branches fail / are empty', async () => {
    vi.mocked(searchPg).mockResolvedValue([])
    vi.mocked(searchQdrant).mockRejectedValue(new Error('agents down'))
    const caller = createCallerFactory(searchRouter)(ctx(memberPrisma()))
    const out = await caller.search({ workspaceId: WS, query: 'q' })
    expect(out).toEqual([])
  })
})

describe('search.history', () => {
  beforeEach(() => vi.clearAllMocks())

  it('history.list returns favorited flag, excludes deleted/archived pages', async () => {
    const prisma = memberPrisma({
      searchHistory: {
        findMany: vi.fn(async () => [
          {
            pageId: PAGE_A,
            page: { id: PAGE_A, title: 'A', icon: '📄', deletedAt: null, archived: false },
          },
          {
            pageId: PAGE_B,
            page: { id: PAGE_B, title: 'Gone', icon: null, deletedAt: new Date(), archived: false },
          },
        ]),
      },
      favoritePage: {
        findMany: vi.fn(async () => [{ pageId: PAGE_A }]),
      },
    })
    const caller = createCallerFactory(searchRouter)(ctx(prisma))
    const out = await caller.history.list({ workspaceId: WS })
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({ pageId: PAGE_A, title: 'A', icon: '📄', isFavorite: true })
  })

  it('history.add upserts and prunes', async () => {
    const upsert = vi.fn(async () => ({}))
    const exec = vi.fn(async () => 0)
    const prisma = memberPrisma({
      searchHistory: { upsert },
      $executeRaw: exec,
    })
    const caller = createCallerFactory(searchRouter)(ctx(prisma))
    await caller.history.add({ workspaceId: WS, pageId: PAGE_A })
    expect(upsert).toHaveBeenCalledOnce()
    expect(exec).toHaveBeenCalledOnce()
  })

  it('history.add swallows P2003 FK violation', async () => {
    const err = new Error('FK') as Error & { code?: string }
    err.code = 'P2003'
    const prisma = memberPrisma({
      searchHistory: { upsert: vi.fn(async () => { throw err }) },
      $executeRaw: vi.fn(),
    })
    const caller = createCallerFactory(searchRouter)(ctx(prisma))
    await expect(
      caller.history.add({ workspaceId: WS, pageId: PAGE_A }),
    ).resolves.toBeUndefined()
  })

  it('history.remove deletes the unique row', async () => {
    const deleteMany = vi.fn(async () => ({ count: 1 }))
    const prisma = memberPrisma({
      searchHistory: { deleteMany },
    })
    const caller = createCallerFactory(searchRouter)(ctx(prisma))
    await caller.history.remove({ workspaceId: WS, pageId: PAGE_A })
    expect(deleteMany).toHaveBeenCalledWith({
      where: { userId: USER, workspaceId: WS, pageId: PAGE_A },
    })
  })
})
```

- [ ] **Step 2: Run and confirm fail**

Run:
```bash
pnpm --filter @repo/trpc test -- search-router
```

Expected: import error for `searchRouter`.

- [ ] **Step 3: Implement the router**

Create `packages/trpc/src/routers/search.ts`:

```typescript
import { Prisma } from '@repo/db'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { searchPg, searchQdrant, type SearchResultItem } from '../services/page-search'
import { protectedProcedure, router } from '../trpc'

async function assertWorkspaceMember(
  ctx: { prisma: import('@repo/db').PrismaClient; user: { id: string } },
  workspaceId: string,
) {
  const member = await ctx.prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: ctx.user.id } },
  })
  if (!member) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Вы не являетесь участником воркспейса' })
  }
  return member
}

const HISTORY_LIMIT_DISPLAYED = 5
const HISTORY_LIMIT_STORED = 20

export type HistoryItem = {
  pageId: string
  title: string
  icon: string | null
  isFavorite: boolean
}

export const searchRouter = router({
  search: protectedProcedure
    .input(z.object({
      workspaceId: z.string().uuid(),
      query: z.string().max(200),
    }))
    .query(async ({ input, ctx }): Promise<SearchResultItem[]> => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      const [pg, vec] = await Promise.allSettled([
        searchPg(ctx.prisma, input.workspaceId, input.query),
        searchQdrant(ctx.prisma, input.workspaceId, input.query),
      ])
      if (pg.status === 'rejected') throw pg.reason
      if (pg.value.length > 0) return pg.value
      return vec.status === 'fulfilled' ? vec.value : []
    }),

  history: router({
    list: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid() }))
      .query(async ({ input, ctx }): Promise<HistoryItem[]> => {
        await assertWorkspaceMember(ctx, input.workspaceId)
        const rows = await ctx.prisma.searchHistory.findMany({
          where: { userId: ctx.user.id, workspaceId: input.workspaceId },
          orderBy: { lastVisitedAt: 'desc' },
          take: HISTORY_LIMIT_DISPLAYED * 2,
          include: {
            page: { select: { id: true, title: true, icon: true, deletedAt: true, archived: true } },
          },
        })
        const live = rows.filter((r) => r.page.deletedAt === null && r.page.archived === false)
        const ids = live.map((r) => r.pageId)
        const favs = await ctx.prisma.favoritePage.findMany({
          where: { userId: ctx.user.id, pageId: { in: ids } },
          select: { pageId: true },
        })
        const favSet = new Set(favs.map((f) => f.pageId))
        return live.slice(0, HISTORY_LIMIT_DISPLAYED).map((r) => ({
          pageId: r.pageId,
          title: r.page.title ?? '',
          icon: r.page.icon,
          isFavorite: favSet.has(r.pageId),
        }))
      }),

    add: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid(), pageId: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        await assertWorkspaceMember(ctx, input.workspaceId)
        try {
          await ctx.prisma.searchHistory.upsert({
            where: {
              userId_workspaceId_pageId: {
                userId: ctx.user.id,
                workspaceId: input.workspaceId,
                pageId: input.pageId,
              },
            },
            create: {
              userId: ctx.user.id,
              workspaceId: input.workspaceId,
              pageId: input.pageId,
            },
            update: { lastVisitedAt: new Date() },
          })
          await ctx.prisma.$executeRaw`
            DELETE FROM "search_history"
            WHERE "user_id" = ${ctx.user.id}::uuid
              AND "workspace_id" = ${input.workspaceId}::uuid
              AND id NOT IN (
                SELECT id FROM "search_history"
                WHERE "user_id" = ${ctx.user.id}::uuid
                  AND "workspace_id" = ${input.workspaceId}::uuid
                ORDER BY "last_visited_at" DESC
                LIMIT ${HISTORY_LIMIT_STORED}
              )
          `
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
            return
          }
          // tolerate manually-thrown FK errors in tests
          if (err instanceof Error && (err as Error & { code?: string }).code === 'P2003') return
          throw err
        }
      }),

    remove: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid(), pageId: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        await assertWorkspaceMember(ctx, input.workspaceId)
        await ctx.prisma.searchHistory.deleteMany({
          where: {
            userId: ctx.user.id,
            workspaceId: input.workspaceId,
            pageId: input.pageId,
          },
        })
      }),
  }),
})
```

- [ ] **Step 4: Run and confirm pass**

Run:
```bash
pnpm --filter @repo/trpc test -- search-router
```

Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/routers/search.ts packages/trpc/test/search-router.test.ts
git commit -m "feat(trpc): add search router with parallel PG/Qdrant + history procs"
```

---

## Task 8: Mount the search router in `appRouter`

**Files:**
- Modify: `packages/trpc/src/index.ts`

- [ ] **Step 1: Locate and edit**

Open `packages/trpc/src/index.ts`. Add the import alongside other router imports:

```typescript
import { searchRouter } from './routers/search'
```

Find the `appRouter = router({...})` definition and add the entry alphabetically next to `page`:

```typescript
  page: pageRouter,
  search: searchRouter,
```

- [ ] **Step 2: Verify type-checking still passes**

Run:
```bash
pnpm --filter @repo/trpc check-types
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/trpc/src/index.ts
git commit -m "feat(trpc): mount search router on appRouter"
```

---

## Task 9: Add missing UI exports

**Files:**
- Modify: `packages/ui/src/components/index.ts`

- [ ] **Step 1: Edit exports**

Open `packages/ui/src/components/index.ts`. Add these export lines (group with the other re-exports, keeping alphabetical order in each cluster):

```typescript
export { default as LinearProgress, type LinearProgressProps } from '@mui/material/LinearProgress'
export { default as InputBase, type InputBaseProps } from '@mui/material/InputBase'
export { default as CircularProgress, type CircularProgressProps } from '@mui/material/CircularProgress'
export { default as HistoryIcon } from '@mui/icons-material/History'
export { default as CloseIcon } from '@mui/icons-material/Close'
```

- [ ] **Step 2: Verify build**

Run:
```bash
pnpm --filter @repo/ui check-types
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/index.ts
git commit -m "feat(ui): export LinearProgress, InputBase, CircularProgress, HistoryIcon, CloseIcon"
```

---

## Task 10: `highlight-matches` helper + tests

**Files:**
- Create: `apps/web/src/components/search/highlight-matches.tsx`
- Create: `apps/web/src/components/search/__tests__/highlight-matches.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/search/__tests__/highlight-matches.test.tsx`:

```typescript
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { HighlightMatches } from '../highlight-matches'

describe('HighlightMatches', () => {
  it('renders the original text when query is empty', () => {
    const html = renderToStaticMarkup(<HighlightMatches text="hello world" query="" />)
    expect(html).toBe('hello world')
  })

  it('wraps single match (case-insensitive)', () => {
    const html = renderToStaticMarkup(<HighlightMatches text="Hello WORLD" query="world" />)
    expect(html).toContain('<mark>WORLD</mark>')
    expect(html).toContain('Hello ')
  })

  it('wraps multiple matches', () => {
    const html = renderToStaticMarkup(<HighlightMatches text="foo bar foo baz" query="foo" />)
    const mark = html.match(/<mark>foo<\/mark>/g)
    expect(mark).toHaveLength(2)
  })

  it('escapes regex metacharacters in query', () => {
    const html = renderToStaticMarkup(<HighlightMatches text="a.b" query="." />)
    expect(html).toContain('<mark>.</mark>')
    expect(html).toContain('a')
    expect(html).toContain('b')
  })
})
```

- [ ] **Step 2: Run and confirm fail**

Run:
```bash
pnpm --filter web exec vitest run src/components/search/__tests__/highlight-matches.test.tsx
```

Expected: import resolution error.

- [ ] **Step 3: Implement**

Create `apps/web/src/components/search/highlight-matches.tsx`:

```tsx
import { Fragment } from 'react'

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function HighlightMatches({ text, query }: { text: string; query: string }) {
  const trimmed = query.trim()
  if (!trimmed) return <>{text}</>
  const re = new RegExp(`(${escapeRegex(trimmed)})`, 'gi')
  const parts = text.split(re)
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 1) return <mark key={i}>{part}</mark>
        return <Fragment key={i}>{part}</Fragment>
      })}
    </>
  )
}
```

- [ ] **Step 4: Run and confirm pass**

Run:
```bash
pnpm --filter web exec vitest run src/components/search/__tests__/highlight-matches.test.tsx
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/search/highlight-matches.tsx apps/web/src/components/search/__tests__/highlight-matches.test.tsx
git commit -m "feat(web): add HighlightMatches component"
```

---

## Task 11: `SearchDialogProvider` + hook

**Files:**
- Create: `apps/web/src/components/search/search-dialog-provider.tsx`

- [ ] **Step 1: Implement the provider**

Create `apps/web/src/components/search/search-dialog-provider.tsx`:

```tsx
'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

import { SearchDialog } from './search-dialog'

type Ctx = { open: () => void; close: () => void; isOpen: boolean }

const SearchDialogContext = createContext<Ctx | null>(null)

export function SearchDialogProvider({
  workspaceId,
  children,
}: {
  workspaceId: string
  children: ReactNode
}) {
  const [isOpen, setOpen] = useState(false)
  const open = useCallback(() => setOpen(true), [])
  const close = useCallback(() => setOpen(false), [])
  const value = useMemo<Ctx>(() => ({ open, close, isOpen }), [open, close, isOpen])
  return (
    <SearchDialogContext.Provider value={value}>
      {children}
      {isOpen && <SearchDialog workspaceId={workspaceId} onClose={close} />}
    </SearchDialogContext.Provider>
  )
}

export function useSearchDialog(): Ctx {
  const ctx = useContext(SearchDialogContext)
  if (!ctx) {
    throw new Error('useSearchDialog must be used within SearchDialogProvider')
  }
  return ctx
}
```

This file imports `SearchDialog` which we will create in the next task. It will not type-check until Task 12 completes — that's intentional because the provider's closure depends on the dialog's existence. Both tasks compose into one working unit.

- [ ] **Step 2: Skip standalone verification**

Defer compile/test verification to the end of Task 12, where the dialog file resolves the import.

- [ ] **Step 3: Don't commit yet**

This change is incomplete on its own; commit at the end of Task 12.

---

## Task 12: `SearchDialog` component

**Files:**
- Create: `apps/web/src/components/search/search-dialog.tsx`

- [ ] **Step 1: Implement the dialog**

Create `apps/web/src/components/search/search-dialog.tsx`:

```tsx
'use client'

import {
  Box,
  Chip,
  CircularProgress,
  CloseIcon,
  Dialog,
  HistoryIcon,
  IconButton,
  InputBase,
  LinearProgress,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  SearchIcon,
  StarBorderIcon,
  StarIcon,
  Stack,
  Typography,
} from '@repo/ui/components'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'

import { trpc } from '@/trpc/client'

import { HighlightMatches } from './highlight-matches'

const DEBOUNCE_MS = 250
const MIN_QUERY = 2
const MAX_QUERY = 200

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])
  return debounced
}

export function SearchDialog({
  workspaceId,
  onClose,
}: {
  workspaceId: string
  onClose: () => void
}) {
  const router = useRouter()
  const [rawQuery, setRawQuery] = useState('')
  const trimmed = rawQuery.trim().slice(0, MAX_QUERY)
  const debounced = useDebouncedValue(trimmed, DEBOUNCE_MS)
  const utils = trpc.useUtils()

  const searchQuery = trpc.search.search.useQuery(
    { workspaceId, query: debounced },
    { enabled: debounced.length >= MIN_QUERY, staleTime: 0 },
  )

  const historyQuery = trpc.search.history.list.useQuery(
    { workspaceId },
    { enabled: trimmed.length === 0 },
  )

  const addToHistory = trpc.search.history.add.useMutation()
  const removeFromHistory = trpc.search.history.remove.useMutation({
    onSuccess: () => utils.search.history.list.invalidate({ workspaceId }),
  })
  const addFavorite = trpc.page.addFavorite.useMutation({
    onSuccess: () => utils.search.history.list.invalidate({ workspaceId }),
  })
  const removeFavorite = trpc.page.removeFavorite.useMutation({
    onSuccess: () => utils.search.history.list.invalidate({ workspaceId }),
  })

  const isShowingResults = trimmed.length >= MIN_QUERY
  const showLoading = isShowingResults && searchQuery.isFetching
  const results = useMemo(() => searchQuery.data ?? [], [searchQuery.data])

  function navigateToPage(pageId: string, blockNumber: number | null) {
    addToHistory.mutate({ workspaceId, pageId })
    onClose()
    const hash = blockNumber !== null ? `#${blockNumber}` : ''
    router.push(`/workspaces/${workspaceId}/pages/${pageId}${hash}`)
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" keepMounted={false}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, py: 1.25 }}>
        <SearchIcon fontSize="small" />
        <InputBase
          autoFocus
          fullWidth
          placeholder="Поиск по страницам"
          value={rawQuery}
          onChange={(e) => setRawQuery(e.target.value)}
          inputProps={{ 'aria-label': 'Поиск по страницам', maxLength: MAX_QUERY }}
        />
        <Chip
          label="Esc"
          size="small"
          onClick={onClose}
          variant="outlined"
          sx={{ cursor: 'pointer' }}
        />
      </Stack>

      {showLoading && <LinearProgress />}

      <Box sx={{ minHeight: 200, maxHeight: 480, overflowY: 'auto' }}>
        {!isShowingResults ? (
          <EmptyState
            historyQuery={historyQuery}
            onPick={(item) => navigateToPage(item.pageId, null)}
            onRemove={(pageId) => removeFromHistory.mutate({ workspaceId, pageId })}
            onToggleFavorite={(pageId, isFav) =>
              isFav
                ? removeFavorite.mutate({ pageId })
                : addFavorite.mutate({ pageId })
            }
          />
        ) : results.length === 0 && !searchQuery.isFetching ? (
          <Box sx={{ p: 3 }}>
            <Typography variant="body2" color="text.secondary">
              Ничего не найдено по запросу «{trimmed}»
            </Typography>
          </Box>
        ) : (
          <List dense>
            {results.map((item) => (
              <ListItemButton
                key={`${item.pageId}-${item.blockNumber ?? 'title'}`}
                onClick={() => navigateToPage(item.pageId, item.blockNumber)}
              >
                <ListItemIcon sx={{ minWidth: 32 }}>
                  <Typography component="span" sx={{ fontSize: 16 }}>
                    {item.icon ?? '📄'}
                  </Typography>
                </ListItemIcon>
                <ListItemText
                  primary={item.title || 'Без названия'}
                  secondary={
                    item.blockNumber !== null && item.excerpt ? (
                      <Box component="span" sx={{ display: 'block' }}>
                        Блок {item.blockNumber + 1}:{' '}
                        <HighlightMatches text={item.excerpt} query={trimmed} />
                      </Box>
                    ) : null
                  }
                />
              </ListItemButton>
            ))}
          </List>
        )}
      </Box>
    </Dialog>
  )
}

type HistoryQuery = ReturnType<typeof trpc.search.history.list.useQuery>

function EmptyState({
  historyQuery,
  onPick,
  onRemove,
  onToggleFavorite,
}: {
  historyQuery: HistoryQuery
  onPick: (item: { pageId: string }) => void
  onRemove: (pageId: string) => void
  onToggleFavorite: (pageId: string, isFav: boolean) => void
}) {
  if (historyQuery.isLoading) {
    return (
      <Box sx={{ p: 3, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress size={20} />
      </Box>
    )
  }
  const items = historyQuery.data ?? []
  if (items.length === 0) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="body2" color="text.secondary">
          Здесь появятся страницы, по которым вы перейдёте из поиска
        </Typography>
      </Box>
    )
  }
  return (
    <>
      <Typography
        variant="overline"
        color="text.secondary"
        sx={{ display: 'block', px: 2, pt: 1.5 }}
      >
        Ранее искали
      </Typography>
      <List dense>
        {items.map((item) => (
          <ListItemButton
            key={item.pageId}
            onClick={() => onPick(item)}
            sx={{ pr: 1 }}
          >
            <ListItemIcon sx={{ minWidth: 32 }}>
              <HistoryIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary={item.title || 'Без названия'} />
            <IconButton
              size="small"
              edge="end"
              aria-label={item.isFavorite ? 'Убрать из избранного' : 'В избранное'}
              onClick={(e) => {
                e.stopPropagation()
                onToggleFavorite(item.pageId, item.isFavorite)
              }}
            >
              {item.isFavorite ? (
                <StarIcon fontSize="small" color="warning" />
              ) : (
                <StarBorderIcon fontSize="small" />
              )}
            </IconButton>
            <IconButton
              size="small"
              edge="end"
              aria-label="Удалить из истории"
              onClick={(e) => {
                e.stopPropagation()
                onRemove(item.pageId)
              }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </ListItemButton>
        ))}
      </List>
    </>
  )
}
```

Note on imports: the `Box`, `Chip`, `Stack`, `Typography`, `IconButton`, `InputBase`, `CircularProgress` symbols are already exported from `@repo/ui/components` (verified during exploration). The newly added exports `LinearProgress`, `HistoryIcon`, `CloseIcon` come from Task 9.

- [ ] **Step 2: Type-check the web package**

Run:
```bash
pnpm --filter web check-types
```

Expected: PASS — both `search-dialog.tsx` and `search-dialog-provider.tsx` resolve cleanly.

- [ ] **Step 3: Commit (covers Task 11 + Task 12)**

```bash
git add apps/web/src/components/search/search-dialog-provider.tsx apps/web/src/components/search/search-dialog.tsx
git commit -m "feat(web): add SearchDialog and provider"
```

---

## Task 13: `SidebarSearchTrigger` + insert into sidebar

**Files:**
- Create: `apps/web/src/components/search/sidebar-search-trigger.tsx`
- Modify: `apps/web/src/components/workspace/workspace-sidebar.tsx`

- [ ] **Step 1: Create the trigger**

Create `apps/web/src/components/search/sidebar-search-trigger.tsx`:

```tsx
'use client'

import {
  ListItemButton,
  ListItemIcon,
  ListItemText,
  SearchIcon,
  Typography,
} from '@repo/ui/components'

import { useSearchDialog } from './search-dialog-provider'

export function SidebarSearchTrigger() {
  const { open } = useSearchDialog()
  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  const hint = isMac ? '⌘K' : 'Alt+K'
  return (
    <ListItemButton onClick={open} dense aria-label="Открыть поиск">
      <ListItemIcon sx={{ minWidth: 28 }}>
        <SearchIcon sx={{ fontSize: 16 }} />
      </ListItemIcon>
      <ListItemText
        primary="Поиск"
        primaryTypographyProps={{ fontSize: 14 }}
      />
      <Typography variant="caption" color="text.secondary">
        {hint}
      </Typography>
    </ListItemButton>
  )
}
```

- [ ] **Step 2: Insert into the sidebar**

Open `apps/web/src/components/workspace/workspace-sidebar.tsx`. Locate the `<Stack spacing={0.25} sx={{ py: 0.75 }}>` block around line 155. Add an import at the top:

```typescript
import { SidebarSearchTrigger } from '../search/sidebar-search-trigger'
```

Replace the Stack contents to put `SidebarSearchTrigger` first:

```tsx
<Stack spacing={0.25} sx={{ py: 0.75 }}>
  <SidebarSearchTrigger />
  {features.chatsEnabled && <SearchSidebarSection workspaceId={workspace.id} />}
  <NavItem
    icon={<SettingsIcon sx={{ fontSize: 16 }} />}
    label="Настройки"
    href={`/workspaces/${workspace.id}/settings`}
    matchPrefix={`/workspaces/${workspace.id}/settings`}
    pathname={pathname}
  />
</Stack>
```

- [ ] **Step 3: Type-check**

Run:
```bash
pnpm --filter web check-types
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/search/sidebar-search-trigger.tsx apps/web/src/components/workspace/workspace-sidebar.tsx
git commit -m "feat(web): add Поиск trigger to workspace sidebar"
```

---

## Task 14: `useSearchHotkey` + wire `SearchDialogProvider` into workspace layout

**Files:**
- Create: `apps/web/src/components/search/use-search-hotkey.ts`
- Modify: `apps/web/src/components/workspace/workspace-layout-client.tsx`

- [ ] **Step 1: Implement the hotkey hook**

Create `apps/web/src/components/search/use-search-hotkey.ts`:

```typescript
'use client'

import { useEffect } from 'react'

import { useSearchDialog } from './search-dialog-provider'

export function useSearchHotkey() {
  const { open } = useSearchDialog()
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.repeat) return
      const platform = typeof navigator !== 'undefined' ? navigator.platform : ''
      const isMac = /Mac|iPhone|iPad/.test(platform)
      const matchMac =
        isMac && e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'k'
      const matchOther =
        !isMac && e.altKey && !e.metaKey && !e.ctrlKey && e.key.toLowerCase() === 'k'
      if (!matchMac && !matchOther) return
      e.preventDefault()
      open()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])
}
```

- [ ] **Step 2: Wrap the workspace layout**

Open `apps/web/src/components/workspace/workspace-layout-client.tsx`. Add imports:

```typescript
import { SearchDialogProvider } from '../search/search-dialog-provider'
import { useSearchHotkey } from '../search/use-search-hotkey'
```

The component currently returns `<WorkspaceShell ... />` (around lines 145–151). Wrap that return in `<SearchDialogProvider>` and add a hotkey component inside it:

```tsx
function WorkspaceHotkeyMount() {
  useSearchHotkey()
  return null
}

// inside WorkspaceLayoutClient:
return (
  <SearchDialogProvider workspaceId={workspace.id}>
    <WorkspaceHotkeyMount />
    <WorkspaceShell
      sidebarHidden={hidden}
      sidebar={<WorkspaceSidebar {...sidebarProps} onHide={() => setHidden(true)} />}
      main={activePageId ? <PageEditorProvider>{mainContent}</PageEditorProvider> : mainContent}
    />
  </SearchDialogProvider>
)
```

`WorkspaceHotkeyMount` is a tiny inner component declared at the bottom of the same file (so it can call `useSearchHotkey` inside the provider's subtree without adding another file).

- [ ] **Step 3: Type-check + lint**

Run:
```bash
pnpm --filter web check-types
pnpm --filter web lint
```

Expected: both PASS.

- [ ] **Step 4: Quick local smoke test**

Start `docker compose up -d` if it isn't already running, then in another shell:

```bash
pnpm --filter web dev
```

In the browser:
1. Sign in, enter a workspace.
2. Press `Cmd+K` (or `Alt+K` on non-Mac). Dialog opens.
3. Type a known page title — see results.
4. Click a result — page opens, hash present in URL.
5. Press `Esc` — dialog closes.

This is a manual sanity check — the formal verification is in the E2E task.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/search/use-search-hotkey.ts apps/web/src/components/workspace/workspace-layout-client.tsx
git commit -m "feat(web): wire SearchDialogProvider and Cmd/Alt+K hotkey into workspace layout"
```

---

## Task 15: E2E Playwright spec

**Files:**
- Create: `apps/e2e/search.spec.ts`

- [ ] **Step 1: Write the spec**

Create `apps/e2e/search.spec.ts`:

```typescript
import { expect, test } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

test('Cmd+K search → click result → block highlight + history', async ({ page, browserName }) => {
  await signUpAndAuthAs(page, { firstName: 'Search', lastName: 'Tester' })

  // Create a workspace if onboarding doesn't auto-place us in one.
  await page.waitForURL(/\/workspaces\/[0-9a-f-]+/)

  // Create two text pages with known content.
  // (We piggy-back on the page tree; specifics of the create flow may vary slightly.)
  await page.getByRole('button', { name: /создать|new page|плюс/i }).first().click()
  await page.keyboard.type('Alpha doc')
  await page.keyboard.press('Enter')
  await page.locator('[contenteditable="true"]').first().click()
  await page.keyboard.type('first paragraph\nsecond paragraph with needle word')

  await page.goBack()
  await page.getByRole('button', { name: /создать|new page|плюс/i }).first().click()
  await page.keyboard.type('Beta doc')
  await page.keyboard.press('Enter')
  await page.locator('[contenteditable="true"]').first().click()
  await page.keyboard.type('unrelated content')

  // Wait briefly for content snapshots to flush (autosave debounces).
  await page.waitForTimeout(2000)

  // Open the search dialog with the hotkey.
  const isMac = browserName === 'webkit' || process.platform === 'darwin'
  await page.keyboard.press(isMac ? 'Meta+K' : 'Alt+K')

  await expect(page.getByPlaceholder('Поиск по страницам')).toBeVisible()

  // Type query, expect at least one result for Alpha doc.
  await page.getByPlaceholder('Поиск по страницам').fill('needle')
  const result = page.getByRole('button', { name: /Alpha doc/ })
  await expect(result).toBeVisible({ timeout: 5000 })

  // Click the result.
  await result.first().click()

  // URL hash should reference the matching block.
  await page.waitForURL(/#\d+/)
  const url = new URL(page.url())
  const blockIndex = Number(url.hash.slice(1))
  expect(Number.isFinite(blockIndex)).toBe(true)

  // Block-flash class should appear on the target block within 500 ms of navigation.
  await expect(
    page.locator(`[data-block-index="${blockIndex}"].block-flash`),
  ).toBeVisible({ timeout: 1500 })

  // Reopen the dialog: empty state should now list Alpha doc in history.
  await page.keyboard.press(isMac ? 'Meta+K' : 'Alt+K')
  const historyHeading = page.getByText('Ранее искали')
  await expect(historyHeading).toBeVisible()
  await expect(page.getByRole('button', { name: /Alpha doc/ })).toBeVisible()
})
```

- [ ] **Step 2: Run the spec**

Pre-req: `docker compose up -d` (Postgres + Mailhog).

Run:
```bash
pnpm exec playwright test apps/e2e/search.spec.ts
```

Expected: PASS. If selector mismatches surface (the "create page" affordance may differ), tighten selectors using `page.getByTestId` or whatever the existing E2E helpers use — see other specs in `apps/e2e/` for the exact creation flow.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/search.spec.ts
git commit -m "test(e2e): cover Cmd+K workspace search end-to-end"
```

---

## Task 16: Final verification

**Files:** none

- [ ] **Step 1: Run lint**

```bash
pnpm lint
```

Expected: 0 warnings.

- [ ] **Step 2: Run formatting**

```bash
pnpm format
```

If anything reformats, stage and add to a follow-up commit.

- [ ] **Step 3: Run type-check**

```bash
pnpm check-types
```

Expected: PASS across all packages.

- [ ] **Step 4: Run the merge-gate**

```bash
pnpm gates
```

Expected: lint + types + build + test all green. Husky will run the same gate on commit.

- [ ] **Step 5: If anything failed, fix in place + commit**

```bash
git add -A && git commit -m "chore(search): post-implementation lint/format fixes"
```

---

## Self-Review Notes

The plan has been re-read against [the spec](../specs/2026-05-06-workspace-search-design.md):

- ✅ Spec §1.1 (Page.searchVector) → Task 1.
- ✅ Spec §1.2 (SearchHistory) → Task 1.
- ✅ Spec §2.1 (apps/agents endpoint) → Tasks 2 + 3.
- ✅ Spec §2.2 (tRPC router) → Tasks 4–8.
- ✅ Spec §2.3 (searchPg + JSON walk) → Tasks 4 + 5.
- ✅ Spec §2.4 (searchQdrant + plan/AI gating) → Task 6.
- ✅ Spec §2.5 (merge in `search.search`) → Task 7.
- ✅ Spec §2.6 (history procs incl. prune to 20) → Task 7.
- ✅ Spec §3.1 (SearchDialogProvider) → Task 11.
- ✅ Spec §3.2 (Sidebar trigger) → Task 13.
- ✅ Spec §3.3 (SearchDialog states + click + history) → Task 12.
- ✅ Spec §3.4 (Cmd/Alt+K hotkey) → Task 14.
- ✅ Spec §3.5 (transpile/icons) → Task 9 (+ verified existing exports).
- ✅ Spec §4 (edge cases) — all addressed in code: query trim/length caps in Task 5/6/12; `try/catch` for FK in Task 7; soft-fail of qdrant in Task 6; deleted/archived filter in Task 6/7.
- ✅ Spec §5 (testing) — Tasks 3, 4, 5, 6, 7, 10, 15 cover the four layers.
- ✅ Spec §6 (verification commands) → Task 16.

Type/symbol consistency verified:
- `SearchResultItem` shape matches across `page-search.ts`, `search.ts` router, and `search-dialog.tsx` consumption.
- `HistoryItem` shape matches between router (Task 7) and dialog (Task 12).
- `searchHistory` Prisma model camelCase fields used consistently (`lastVisitedAt`).
- The `search_history` table name (`@@map`) is used in raw SQL prune and migration; Prisma model accessor is `prisma.searchHistory`.
- `findFirstMatchingBlock` returns the same `{ blockNumber, excerpt }` shape consumed by `searchPg`.
- The `/v1/search` HTTP path matches between `apps/agents/router.py` (`prefix='/v1/search'`) and the fetch URL in `searchQdrant`.
