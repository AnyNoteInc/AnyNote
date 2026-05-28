# MCP Tooling Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ~18 MCP tools to `apps/engines` over existing Prisma models (workspaces, page navigation, search-by-title, reminders, notifications, favorites, diagram pages), fix the broken `search_pages` tool, and raise the RAG similarity threshold to 0.7.

**Architecture:** Each tool is an `@Tool()` method on an `@Injectable()` `*.tools.ts` class (the existing anynote convention), authorized with `requireAuth(req)` + `assertMember(prisma, userId, workspaceId)`, registered in `mcp.module.ts`, with Python metadata (scope + confirmation) in `apps/agents` `tool_registry.py`. Business logic lives in small services. No new transports, no schema migrations.

**Tech Stack:** NestJS 11 + `@rekog/mcp-nest` + Zod (engines), Prisma 7 (`@repo/db`), Yjs + `@hocuspocus/transformer` (diagram seeding), Python/FastAPI/Qdrant (agents threshold), Jest (engines tests), Pytest (agents tests).

**Spec:** [docs/superpowers/specs/2026-05-28-mcp-tooling-expansion-design.md](docs/superpowers/specs/2026-05-28-mcp-tooling-expansion-design.md)

**Conventions (every engines tool task follows these):**
- Tool method signature: `name(args, _context: Context, req: AuthedRequest)` delegates to an `async doName(auth, args)` for testability (mirrors `SearchTools`).
- `requireAuth(req)` and `assertMember` imports exactly as in [search.tools.ts](apps/engines/src/apps/mcp/tools/search.tools.ts).
- Zod helpers (`mcpInput`, `mcpUuid`, `mcpNullableUuidOptional`) from [utils/mcp-input.ts](apps/engines/src/apps/mcp/utils/mcp-input.ts).
- `.js` extensions on all relative imports (NodeNext).
- After adding a tool class: register it in `mcp.module.ts` `providers` **and** `exports`, and add a `DEFAULT_ENGINES_TOOLS` entry in `apps/agents` `tool_registry.py`.
- Tests live next to source as `*.spec.ts`; run with `pnpm --filter engines test`. Agents tests under `apps/agents/tests/`, run with `pnpm --filter agents test`.
- Commit after each task with a Conventional Commit (`feat(mcp): …`).

---

## Phase 0 — RAG similarity threshold (agents)

### Task 1: Raise RAG threshold to 0.7 in `/v1/search`

**Files:**
- Modify: `apps/agents/agents/apps/search/schemas.py`
- Modify: `apps/agents/agents/apps/search/router.py`
- Modify: `apps/agents/agents/apps/agent/services/rag_retrieval.py`
- Modify: `apps/agents/agents/apps/processing/repositories/vector_store_repository.py`
- Test: `apps/agents/tests/apps/processing/test_vector_store_threshold.py` (create)

- [ ] **Step 1: Write the failing test**

Create `apps/agents/tests/apps/processing/test_vector_store_threshold.py`:

```python
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from agents.apps.processing.repositories.vector_store_repository import VectorStoreRepository


@pytest.mark.asyncio
async def test_similarity_search_forwards_score_threshold() -> None:
    client = AsyncMock()
    client.get_collection.return_value = SimpleNamespace()  # collection_exists -> True
    client.query_points.return_value = SimpleNamespace(points=[])
    embeddings = AsyncMock()
    embeddings.aembed_query.return_value = [0.1, 0.2, 0.3]

    repo = VectorStoreRepository(client=client)
    await repo.similarity_search(
        collection_name='c',
        embeddings=embeddings,
        workspace_id='w',
        query='hello',
        k=5,
        score_threshold=0.7,
    )

    _, kwargs = client.query_points.call_args
    assert kwargs['score_threshold'] == 0.7


@pytest.mark.asyncio
async def test_similarity_search_threshold_defaults_to_none() -> None:
    client = AsyncMock()
    client.get_collection.return_value = SimpleNamespace()
    client.query_points.return_value = SimpleNamespace(points=[])
    embeddings = AsyncMock()
    embeddings.aembed_query.return_value = [0.1]

    repo = VectorStoreRepository(client=client)
    await repo.similarity_search(
        collection_name='c', embeddings=embeddings, workspace_id='w', query='q', k=1,
    )

    _, kwargs = client.query_points.call_args
    assert kwargs['score_threshold'] is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/agents && uv run pytest tests/apps/processing/test_vector_store_threshold.py -v`
Expected: FAIL — `query_points` called without a `score_threshold` kwarg (`KeyError`).

- [ ] **Step 3: Add `score_threshold` to `similarity_search` and forward it**

In `apps/agents/agents/apps/processing/repositories/vector_store_repository.py`, change the `similarity_search` signature and the `query_points` call:

```python
    async def similarity_search(
        self,
        *,
        collection_name: str,
        embeddings: Embeddings,
        workspace_id: str,
        query: str,
        k: int = 5,
        score_threshold: float | None = None,
    ) -> list[Document]:
        """Embed `query`, run a workspace-filtered vector search, return Documents.

        Bypasses langchain-qdrant's QdrantVectorStore (which requires sync QdrantClient)
        by calling AsyncQdrantClient.query_points directly.
        """
        if not query.strip():
            return []
        if not await self.collection_exists(collection_name):
            return []
        vector = await embeddings.aembed_query(query)
        res = await self.client.query_points(
            collection_name=collection_name,
            query=vector,
            limit=k,
            score_threshold=score_threshold,
            query_filter=Filter(must=[FieldCondition(key='workspaceId', match=MatchValue(value=workspace_id))]),
            with_payload=True,
            with_vectors=False,
        )
```

(Leave the `return [Document(...) ...]` block unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/agents && uv run pytest tests/apps/processing/test_vector_store_threshold.py -v`
Expected: PASS (both tests).

- [ ] **Step 5: Thread the threshold through `retrieve` and the route**

In `apps/agents/agents/apps/agent/services/rag_retrieval.py`, add the parameter and pass it down:

```python
    async def retrieve(
        self,
        *,
        embedding: EmbeddingProviderConfigSchema,
        workspace_id: UUID,
        query: str,
        k: int = 5,
        score_threshold: float | None = 0.7,
    ) -> list[RagDocumentSchema]:
        embedder = self.embedding_factory_repository.make(embedding)
        collection = collection_name_for(embedding.provider, embedding.model_slug)
        docs = await self.vector_store_repository.similarity_search(
            collection_name=collection,
            embeddings=embedder,
            workspace_id=str(workspace_id),
            query=query,
            k=k * 3,
            score_threshold=score_threshold,
        )
        return self._dedupe(docs, k)
```

In `apps/agents/agents/apps/search/schemas.py`, add the field to `SearchRequestSchema` (after `embedding`):

```python
    embedding: EmbeddingProviderConfigSchema
    score_threshold: Annotated[float, Field(default=0.7, ge=0.0, le=1.0)]
```

In `apps/agents/agents/apps/search/router.py`, pass it through:

```python
    docs = await rag.retrieve(
        embedding=payload.embedding,
        workspace_id=payload.workspace_id,
        query=payload.query,
        k=payload.limit,
        score_threshold=payload.score_threshold,
    )
```

- [ ] **Step 6: Run the agents test suite + type check**

Run: `cd apps/agents && uv run pytest tests/apps/processing -q && uv run mypy agents/apps/search agents/apps/agent/services/rag_retrieval.py agents/apps/processing/repositories/vector_store_repository.py`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add apps/agents/agents/apps/search apps/agents/agents/apps/agent/services/rag_retrieval.py apps/agents/agents/apps/processing/repositories/vector_store_repository.py apps/agents/tests/apps/processing/test_vector_store_threshold.py
git commit -m "feat(agents): add score_threshold (default 0.7) to RAG /v1/search"
```

---

## Phase 1 — Search: fix `search_pages` + add `searchPagesByTitle` (engines)

### Task 2: `EmbeddingConfigService` — resolve a workspace embedding payload

Extracts the embedding-building logic currently inlined in the indexer cron so the MCP search tool can reuse it. Shared providers only (plaintext `connection`), matching the cron — encrypted custom-provider creds are out of scope here (the agent-chat RAG path already covers those via the web-built payload).

**Files:**
- Create: `apps/engines/src/apps/mcp/services/embedding-config.service.ts`
- Test: `apps/engines/src/apps/mcp/services/embedding-config.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/engines/src/apps/mcp/services/embedding-config.service.spec.ts`:

```ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'

import { EmbeddingConfigService } from './embedding-config.service.js'

describe('EmbeddingConfigService.forWorkspace', () => {
  const findUnique = jest.fn<(...args: unknown[]) => Promise<unknown>>()
  const prisma = { workspaceAiSettings: { findUnique } } as unknown as PrismaClient
  let svc: EmbeddingConfigService

  beforeEach(() => {
    jest.clearAllMocks()
    svc = new EmbeddingConfigService(prisma)
  })

  it('builds an embedding payload from the workspace embeddings model', async () => {
    findUnique.mockResolvedValue({
      embeddingsModel: {
        slug: 'text-embedding-3-small',
        vectorSize: 1536,
        provider: { slug: 'openai', connection: { apiKey: 'sk-x' } },
      },
    })

    const result = await svc.forWorkspace('w1')

    expect(result).toEqual({
      provider: 'openai',
      modelSlug: 'text-embedding-3-small',
      vectorSize: 1536,
      connection: { apiKey: 'sk-x' },
    })
  })

  it('returns null when no embeddings model is configured', async () => {
    findUnique.mockResolvedValue({ embeddingsModel: null })
    expect(await svc.forWorkspace('w1')).toBeNull()
  })

  it('returns null when vectorSize is missing', async () => {
    findUnique.mockResolvedValue({
      embeddingsModel: { slug: 's', vectorSize: null, provider: { slug: 'openai', connection: {} } },
    })
    expect(await svc.forWorkspace('w1')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter engines test -- embedding-config.service`
Expected: FAIL — cannot find module `./embedding-config.service.js`.

- [ ] **Step 3: Implement the service**

Create `apps/engines/src/apps/mcp/services/embedding-config.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common'
import { parseAiProviderConnection, type AiProviderConnection, type PrismaClient } from '@repo/db'

import { PRISMA } from '../../../infra/db/db.providers.js'

export type EmbeddingPayload = {
  provider: 'ollama' | 'openai' | 'gigachat'
  modelSlug: string
  vectorSize: number
  connection: AiProviderConnection
}

@Injectable()
export class EmbeddingConfigService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async forWorkspace(workspaceId: string): Promise<EmbeddingPayload | null> {
    const ai = await this.prisma.workspaceAiSettings.findUnique({
      where: { workspaceId },
      select: {
        embeddingsModel: {
          select: {
            slug: true,
            vectorSize: true,
            provider: { select: { slug: true, connection: true } },
          },
        },
      },
    })
    const model = ai?.embeddingsModel
    if (!model || model.vectorSize === null) return null
    return {
      provider: model.provider.slug as EmbeddingPayload['provider'],
      modelSlug: model.slug,
      vectorSize: model.vectorSize,
      connection: parseAiProviderConnection(model.provider.slug, model.provider.connection),
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter engines test -- embedding-config.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/engines/src/apps/mcp/services/embedding-config.service.ts apps/engines/src/apps/mcp/services/embedding-config.service.spec.ts
git commit -m "feat(mcp): add EmbeddingConfigService to resolve workspace embedding payload"
```

### Task 3: `PageFtsService` — Postgres full-text page search

Ports `searchPg` from [packages/trpc/src/services/page-search.ts](packages/trpc/src/services/page-search.ts) into engines (engines cannot import tRPC service internals).

**Files:**
- Create: `apps/engines/src/apps/mcp/services/page-fts.service.ts`
- Test: `apps/engines/src/apps/mcp/services/page-fts.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/engines/src/apps/mcp/services/page-fts.service.spec.ts`:

```ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'

import { PageFtsService } from './page-fts.service.js'

describe('PageFtsService.search', () => {
  const queryRaw = jest.fn<(...args: unknown[]) => Promise<unknown>>()
  const prisma = { $queryRaw: queryRaw } as unknown as PrismaClient
  let svc: PageFtsService

  beforeEach(() => {
    jest.clearAllMocks()
    svc = new PageFtsService(prisma)
  })

  it('maps rows and finds an excerpt for TEXT pages', async () => {
    queryRaw.mockResolvedValue([
      {
        id: 'p1',
        title: 'Roadmap',
        icon: null,
        type: 'TEXT',
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'launch plan here' }] }] },
      },
    ])

    const out = await svc.search('w1', 'launch')

    expect(out).toEqual([
      { pageId: 'p1', title: 'Roadmap', icon: null, type: 'TEXT', blockNumber: 0, excerpt: 'launch plan here' },
    ])
  })

  it('returns empty for queries shorter than 2 chars without hitting the db', async () => {
    expect(await svc.search('w1', 'a')).toEqual([])
    expect(queryRaw).not.toHaveBeenCalled()
  })

  it('returns null blockNumber/excerpt for non-TEXT pages', async () => {
    queryRaw.mockResolvedValue([{ id: 'p2', title: 'Board', icon: '📋', type: 'KANBAN', content: null }])
    const out = await svc.search('w1', 'board')
    expect(out[0]).toEqual({ pageId: 'p2', title: 'Board', icon: '📋', type: 'KANBAN', blockNumber: null, excerpt: null })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter engines test -- page-fts.service`
Expected: FAIL — cannot find module `./page-fts.service.js`.

- [ ] **Step 3: Implement the service**

Create `apps/engines/src/apps/mcp/services/page-fts.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common'
import { Prisma, type PrismaClient } from '@repo/db'

import { PRISMA } from '../../../infra/db/db.providers.js'

const MAX_EXCERPT_WINDOW = 100
const MAX_QUERY_LENGTH = 200
const MIN_QUERY_LENGTH = 2
const PG_DICT = 'russian'
const RESULT_LIMIT = 10

export type PageFtsHit = {
  pageId: string
  title: string
  icon: string | null
  type: string
  blockNumber: number | null
  excerpt: string | null
}

type TiptapNode = { type?: string; text?: string; content?: TiptapNode[] }
type PgRow = { id: string; title: string | null; icon: string | null; type: string; content: Prisma.JsonValue | null }

function extractText(node: TiptapNode): string {
  if (typeof node.text === 'string') return node.text
  if (!Array.isArray(node.content)) return ''
  return node.content.map(extractText).join('')
}

function extractExcerpt(text: string, query: string, window: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const idx = flat.toLowerCase().indexOf(query.toLowerCase())
  if (idx < 0) return flat
  const start = Math.max(0, idx - window)
  const end = Math.min(flat.length, idx + query.length + window)
  return `${start > 0 ? '...' : ''}${flat.slice(start, end)}${end < flat.length ? '...' : ''}`
}

function findFirstMatchingBlock(doc: unknown, query: string): { blockNumber: number; excerpt: string } | null {
  const root = doc as TiptapNode | null
  if (!root || root.type !== 'doc' || !Array.isArray(root.content)) return null
  const lower = query.toLowerCase()
  for (let i = 0; i < root.content.length; i += 1) {
    const text = extractText(root.content[i] ?? {})
    if (text.toLowerCase().includes(lower)) {
      return { blockNumber: i, excerpt: extractExcerpt(text, query, MAX_EXCERPT_WINDOW) }
    }
  }
  return null
}

function normalizeQuery(raw: string): string | null {
  const query = raw.trim().slice(0, MAX_QUERY_LENGTH)
  return query.length < MIN_QUERY_LENGTH ? null : query
}

@Injectable()
export class PageFtsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async search(workspaceId: string, rawQuery: string): Promise<PageFtsHit[]> {
    const query = normalizeQuery(rawQuery)
    if (!query) return []

    const rows = await this.prisma.$queryRaw<PgRow[]>`
      SELECT id, title, icon, content, type::text AS type
      FROM "pages"
      WHERE "workspace_id" = ${workspaceId}::uuid
        AND "deleted_at" IS NULL
        AND "archived" = false
        AND "search_vector" @@ websearch_to_tsquery(${PG_DICT}, ${query})
      ORDER BY ts_rank("search_vector", websearch_to_tsquery(${PG_DICT}, ${query})) DESC
      LIMIT ${RESULT_LIMIT}
    `

    return rows.map((row) => {
      const base = { pageId: row.id, title: row.title ?? '', icon: row.icon, type: row.type }
      if (row.type !== 'TEXT' || !row.content) {
        return { ...base, blockNumber: null, excerpt: null }
      }
      const hit = findFirstMatchingBlock(row.content, query)
      return { ...base, blockNumber: hit?.blockNumber ?? null, excerpt: hit?.excerpt ?? null }
    })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter engines test -- page-fts.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/engines/src/apps/mcp/services/page-fts.service.ts apps/engines/src/apps/mcp/services/page-fts.service.spec.ts
git commit -m "feat(mcp): add PageFtsService for Postgres full-text page search"
```

### Task 4: Extend `AgentsSearchClient` to send embedding + scoreThreshold

**Files:**
- Modify: `apps/engines/src/apps/mcp/services/agents-search.client.ts`
- Test: `apps/engines/src/apps/mcp/services/agents-search.client.spec.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `apps/engines/src/apps/mcp/services/agents-search.client.spec.ts`:

```ts
import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals'

import { createAgentsSearchClient } from './agents-search.client.js'

describe('createAgentsSearchClient.searchRag', () => {
  const fetchMock = jest.fn<typeof fetch>()
  beforeEach(() => {
    jest.clearAllMocks()
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('posts workspaceId, embedding and scoreThreshold and maps results', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ results: [{ page_id: 'p', workspace_id: 'w', block_number: 2, title: 't', content: 'c' }] }),
        { status: 200 },
      ),
    )
    const client = createAgentsSearchClient('http://agents')
    const embedding = { provider: 'openai' as const, modelSlug: 'm', vectorSize: 3, connection: {} }

    const hits = await client.searchRag({ workspaceId: 'w', query: 'q', k: 5, embedding })

    expect(hits).toEqual([{ pageId: 'p', workspaceId: 'w', blockNumber: 2, title: 't', content: 'c' }])
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)
    expect(body).toMatchObject({ workspaceId: 'w', query: 'q', limit: 5, embedding, scoreThreshold: 0.7 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter engines test -- agents-search.client`
Expected: FAIL — `searchRag` does not send `embedding`/`scoreThreshold`.

- [ ] **Step 3: Update the client**

Replace `apps/engines/src/apps/mcp/services/agents-search.client.ts` with:

```ts
/** Thin HTTP wrapper around apps/agents POST /v1/search. */
import type { EmbeddingPayload } from './embedding-config.service.js'

export interface AgentsSearchHit {
  pageId: string
  workspaceId: string
  blockNumber: number
  title: string
  content: string
}

export interface AgentsSearchClient {
  searchRag(args: {
    workspaceId: string
    query: string
    k: number
    embedding: EmbeddingPayload
    scoreThreshold?: number
  }): Promise<AgentsSearchHit[]>
}

export function createAgentsSearchClient(baseUrl: string): AgentsSearchClient {
  return {
    async searchRag({ workspaceId, query, k, embedding, scoreThreshold }) {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), 30_000)
      try {
        const res = await fetch(`${baseUrl}/v1/search`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            workspaceId,
            query,
            limit: k,
            embedding,
            scoreThreshold: scoreThreshold ?? 0.7,
          }),
          signal: ctl.signal,
        })
        if (!res.ok) {
          throw new Error(`agents search ${res.status}: ${await res.text()}`)
        }
        const data = (await res.json()) as {
          results: Array<{
            page_id: string
            workspace_id: string
            block_number: number
            title: string
            content: string
          }>
        }
        return data.results.map((r) => ({
          pageId: r.page_id,
          workspaceId: r.workspace_id,
          blockNumber: r.block_number,
          title: r.title,
          content: r.content,
        }))
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter engines test -- agents-search.client`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/engines/src/apps/mcp/services/agents-search.client.ts apps/engines/src/apps/mcp/services/agents-search.client.spec.ts
git commit -m "feat(mcp): thread embedding config + scoreThreshold into agents search client"
```

### Task 5: Fix `search_pages` (two-stage) + add `searchPagesByTitle`

**Files:**
- Modify: `apps/engines/src/apps/mcp/tools/search.tools.ts`
- Modify: `apps/engines/src/apps/mcp/mcp.module.ts`
- Modify: `apps/agents/agents/apps/agent/services/tool_registry.py`
- Test: `apps/engines/src/apps/mcp/tools/search.tools.spec.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Replace `apps/engines/src/apps/mcp/tools/search.tools.spec.ts` with:

```ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'

import type { AuthedRequest } from '../../api/auth/auth-context.js'
import type { AgentsSearchClient, AgentsSearchHit } from '../services/agents-search.client.js'
import type { EmbeddingConfigService } from '../services/embedding-config.service.js'
import type { PageFtsService } from '../services/page-fts.service.js'
import { SearchTools } from './search.tools.js'

describe('SearchTools', () => {
  const findUnique = jest.fn<(...args: unknown[]) => Promise<unknown>>()
  const prisma = { workspaceMember: { findUnique } } as unknown as PrismaClient
  const searchRag = jest.fn<AgentsSearchClient['searchRag']>()
  const ftsSearch = jest.fn<PageFtsService['search']>()
  const forWorkspace = jest.fn<EmbeddingConfigService['forWorkspace']>()
  const agents: AgentsSearchClient = { searchRag }
  const fts = { search: ftsSearch } as unknown as PageFtsService
  const embeddingConfig = { forWorkspace } as unknown as EmbeddingConfigService
  const member = { headers: {}, auth: { userId: 'u1', source: 'api-key' as const } } as AuthedRequest
  let tools: SearchTools

  beforeEach(() => {
    jest.clearAllMocks()
    findUnique.mockResolvedValue({ workspaceId: 'w1' })
    tools = new SearchTools(agents, prisma, fts, embeddingConfig)
  })

  it('search_pages merges title hits then RAG hits, deduped by pageId', async () => {
    ftsSearch.mockResolvedValue([
      { pageId: 'p1', title: 'T1', icon: null, type: 'TEXT', blockNumber: 0, excerpt: 'title hit' },
    ])
    forWorkspace.mockResolvedValue({ provider: 'openai', modelSlug: 'm', vectorSize: 3, connection: {} })
    searchRag.mockResolvedValue([
      { pageId: 'p1', workspaceId: 'w1', blockNumber: 1, title: 'T1', content: 'rag dup' },
      { pageId: 'p2', workspaceId: 'w1', blockNumber: 0, title: 'T2', content: 'rag hit' },
    ])

    const out = await tools.searchPages({ workspaceId: 'w1', query: 'hi', k: 10 }, {} as never, member)

    expect(out.results.map((r: AgentsSearchHit) => r.pageId)).toEqual(['p1', 'p2'])
  })

  it('search_pages skips RAG when no embedding configured', async () => {
    ftsSearch.mockResolvedValue([])
    forWorkspace.mockResolvedValue(null)
    const out = await tools.searchPages({ workspaceId: 'w1', query: 'hi', k: 10 }, {} as never, member)
    expect(out.results).toEqual([])
    expect(searchRag).not.toHaveBeenCalled()
  })

  it('search_pages tolerates a RAG error and returns title hits', async () => {
    ftsSearch.mockResolvedValue([
      { pageId: 'p1', title: 'T1', icon: null, type: 'TEXT', blockNumber: null, excerpt: null },
    ])
    forWorkspace.mockResolvedValue({ provider: 'openai', modelSlug: 'm', vectorSize: 3, connection: {} })
    searchRag.mockRejectedValue(new Error('agents 500'))
    const out = await tools.searchPages({ workspaceId: 'w1', query: 'hi', k: 10 }, {} as never, member)
    expect(out.results.map((r: AgentsSearchHit) => r.pageId)).toEqual(['p1'])
  })

  it('searchPagesByTitle returns candidate pages', async () => {
    ftsSearch.mockResolvedValue([
      { pageId: 'p1', title: 'Roadmap', icon: '🗺️', type: 'TEXT', blockNumber: 0, excerpt: 'x' },
    ])
    const out = await tools.searchPagesByTitle({ workspaceId: 'w1', query: 'road', limit: 5 }, {} as never, member)
    expect(out.pages).toEqual([{ id: 'p1', title: 'Roadmap', type: 'TEXT', icon: '🗺️' }])
  })

  it('rejects non-member', async () => {
    findUnique.mockResolvedValue(null)
    await expect(
      tools.searchPages({ workspaceId: 'w1', query: 'q', k: 5 }, {} as never, member),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('throws Unauthorized when req.auth is missing', async () => {
    await expect(
      tools.searchPages({ workspaceId: 'w1', query: 'q', k: 5 }, {} as never, { headers: {} } as AuthedRequest),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter engines test -- search.tools`
Expected: FAIL — `SearchTools` constructor takes 2 args, no `searchPagesByTitle`.

- [ ] **Step 3: Rewrite `search.tools.ts`**

Replace `apps/engines/src/apps/mcp/tools/search.tools.ts` with:

```ts
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import type { Context } from '@rekog/mcp-nest'
import { Tool } from '@rekog/mcp-nest'
import type { PrismaClient } from '@repo/db'
import { z } from 'zod'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { assertMember } from '../../api/auth/membership.js'
import type { AuthContext, AuthedRequest } from '../../api/auth/auth-context.js'
import type { AgentsSearchClient, AgentsSearchHit } from '../services/agents-search.client.js'
import { EmbeddingConfigService } from '../services/embedding-config.service.js'
import { PageFtsService } from '../services/page-fts.service.js'

export const AGENTS_SEARCH_CLIENT = 'AGENTS_SEARCH_CLIENT'

export const SearchPagesInput = z.object({
  workspaceId: z.string().uuid(),
  query: z.string().min(1).max(500),
  k: z.number().int().min(1).max(20).default(10),
})
export type SearchPagesArgs = z.infer<typeof SearchPagesInput>

export const SearchByTitleInput = z.object({
  workspaceId: z.string().uuid(),
  query: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(20).default(10),
})
export type SearchByTitleArgs = z.infer<typeof SearchByTitleInput>

export type TitlePageHit = { id: string; title: string; type: string; icon: string | null }

function requireAuth(req: AuthedRequest | undefined): AuthContext {
  if (!req?.auth) throw new UnauthorizedException('Unauthenticated MCP request')
  return req.auth
}

@Injectable()
export class SearchTools {
  constructor(
    @Inject(AGENTS_SEARCH_CLIENT) private readonly agentsClient: AgentsSearchClient,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly fts: PageFtsService,
    private readonly embeddingConfig: EmbeddingConfigService,
  ) {}

  @Tool({
    name: 'search_pages',
    description:
      'Поиск по страницам рабочего пространства: сначала полнотекстовый поиск по ' +
      'названию и тексту, затем семантический (RAG) поиск, если в воркспейсе ' +
      'настроена модель эмбеддингов. Возвращает объединённый список без дублей. ' +
      'Параметры: workspaceId (uuid), query (1-500), k (1-20, default 10).',
    parameters: SearchPagesInput,
  })
  searchPages(args: SearchPagesArgs, _context: Context, req: AuthedRequest) {
    return this.doSearchPages(requireAuth(req), args)
  }

  async doSearchPages(auth: AuthContext, args: SearchPagesArgs): Promise<{ results: AgentsSearchHit[] }> {
    await assertMember(this.prisma, auth.userId, args.workspaceId)

    const titleHits: AgentsSearchHit[] = (await this.fts.search(args.workspaceId, args.query)).map((h) => ({
      pageId: h.pageId,
      workspaceId: args.workspaceId,
      blockNumber: h.blockNumber ?? 0,
      title: h.title,
      content: h.excerpt ?? '',
    }))

    let ragHits: AgentsSearchHit[] = []
    const embedding = await this.embeddingConfig.forWorkspace(args.workspaceId)
    if (embedding) {
      try {
        ragHits = await this.agentsClient.searchRag({
          workspaceId: args.workspaceId,
          query: args.query,
          k: args.k,
          embedding,
        })
      } catch {
        ragHits = []
      }
    }

    const seen = new Set<string>()
    const results: AgentsSearchHit[] = []
    for (const hit of [...titleHits, ...ragHits]) {
      if (seen.has(hit.pageId)) continue
      seen.add(hit.pageId)
      results.push(hit)
      if (results.length >= args.k) break
    }
    return { results }
  }

  @Tool({
    name: 'searchPagesByTitle',
    description:
      'Поиск страниц по названию (и тексту) через полнотекстовый индекс Postgres. ' +
      'Используй для запросов вида "найди страницу с названием X", "на какой ' +
      'странице встречается Y". Возвращает несколько кандидатов: id, title, type, icon. ' +
      'Параметры: workspaceId (uuid), query (1-200), limit (1-20, default 10).',
    parameters: SearchByTitleInput,
  })
  searchPagesByTitle(args: SearchByTitleArgs, _context: Context, req: AuthedRequest) {
    return this.doSearchPagesByTitle(requireAuth(req), args)
  }

  async doSearchPagesByTitle(auth: AuthContext, args: SearchByTitleArgs): Promise<{ pages: TitlePageHit[] }> {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    const hits = await this.fts.search(args.workspaceId, args.query)
    return {
      pages: hits.slice(0, args.limit).map((h) => ({ id: h.pageId, title: h.title, type: h.type, icon: h.icon })),
    }
  }
}
```

- [ ] **Step 4: Register the new services in `mcp.module.ts`**

In `apps/engines/src/apps/mcp/mcp.module.ts`: add imports and providers for `PageFtsService` and `EmbeddingConfigService`.

Add near the other service imports:
```ts
import { EmbeddingConfigService } from './services/embedding-config.service.js'
import { PageFtsService } from './services/page-fts.service.js'
```
Add to the `providers` array (anywhere among the services):
```ts
    PageFtsService,
    EmbeddingConfigService,
```

- [ ] **Step 5: Add the `searchPagesByTitle` registry entry in agents**

In `apps/agents/agents/apps/agent/services/tool_registry.py`, add inside `DEFAULT_ENGINES_TOOLS` (next to `search_pages`):
```python
    'searchPagesByTitle': ToolMeta('searchPagesByTitle', SCOPE_PAGES_READ, False,
                                    _summary_generic('searchPagesByTitle'), _preview_default),
```

- [ ] **Step 6: Run tests + type check**

Run: `pnpm --filter engines test -- search.tools && pnpm --filter engines check-types`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add apps/engines/src/apps/mcp/tools/search.tools.ts apps/engines/src/apps/mcp/tools/search.tools.spec.ts apps/engines/src/apps/mcp/mcp.module.ts apps/agents/agents/apps/agent/services/tool_registry.py
git commit -m "feat(mcp): two-stage search_pages (FTS+RAG) and add searchPagesByTitle"
```

## Phase 2 — Workspaces & members (engines)

> Scope trim vs spec: extending `getWorkspaceStats` with reminder/favorite counts is dropped (the existing stats already serve "статистика по пространству X"; avoids churn in `StatsService` + its spec). Reminder/favorite totals are available via `listReminders`/`listFavorites`.

### Task 6: `list_workspaces` — flag current & default workspace

**Files:**
- Modify: `apps/engines/src/apps/mcp/tools/workspaces.tools.ts`
- Modify: `apps/engines/src/apps/mcp/tools/workspaces.tools.spec.ts`
- Modify: `apps/agents/agents/apps/agent/services/tool_registry.py`

- [ ] **Step 1: Update the test**

Replace `apps/engines/src/apps/mcp/tools/workspaces.tools.spec.ts` with:

```ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { UnauthorizedException } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'

import type { AuthedRequest } from '../../api/auth/auth-context.js'
import type { Context } from '../utils/mcp-request-context.js'
import { WorkspacesTools } from './workspaces.tools.js'

describe('WorkspacesTools.listWorkspaces', () => {
  const findMany = jest.fn<(...args: unknown[]) => Promise<unknown>>()
  const findFirst = jest.fn<(...args: unknown[]) => Promise<unknown>>()
  const prisma = {
    workspaceMember: { findMany },
    userPreference: { findFirst },
  } as unknown as PrismaClient
  let tools: WorkspacesTools

  beforeEach(() => {
    jest.clearAllMocks()
    tools = new WorkspacesTools(prisma)
  })

  it('flags current and default workspaces', async () => {
    findMany.mockResolvedValue([
      { role: 'OWNER', workspace: { id: 'w1', name: 'A', slug: 'a' } },
      { role: 'EDITOR', workspace: { id: 'w2', name: 'B', slug: null } },
    ])
    findFirst.mockResolvedValue({ defaultWorkspaceId: 'w2' })

    const req = { auth: { userId: 'u1', source: 'api-key' as const } } as AuthedRequest
    const result = await tools.listWorkspaces({ workspaceId: 'w1' }, {} as Context, req)

    expect(result.workspaces).toEqual([
      { id: 'w1', name: 'A', slug: 'a', role: 'OWNER', isCurrent: true, isDefault: false },
      { id: 'w2', name: 'B', slug: null, role: 'EDITOR', isCurrent: false, isDefault: true },
    ])
  })

  it('throws UnauthorizedException when req.auth is missing', async () => {
    const req = { headers: {} } as AuthedRequest
    await expect(tools.listWorkspaces({}, {} as Context, req)).rejects.toBeInstanceOf(UnauthorizedException)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter engines test -- workspaces.tools`
Expected: FAIL — result lacks `isCurrent`/`isDefault`; `userPreference.findFirst` undefined.

- [ ] **Step 3: Rewrite `workspaces.tools.ts`**

Replace `apps/engines/src/apps/mcp/tools/workspaces.tools.ts` with:

```ts
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import type { Context } from '@rekog/mcp-nest'
import { Tool } from '@rekog/mcp-nest'
import type { PrismaClient } from '@repo/db'
import { z } from 'zod'

import { PRISMA } from '../../../infra/db/db.providers.js'
import type { AuthContext, AuthedRequest } from '../../api/auth/auth-context.js'
import { mcpInput } from '../utils/mcp-input.js'

export const ListWorkspacesInput = z.object({
  workspaceId: mcpInput(z.string().uuid().optional()),
})
export type ListWorkspacesArgs = z.infer<typeof ListWorkspacesInput>

export type WorkspaceSummary = {
  id: string
  name: string
  slug: string | null
  role: string
  isCurrent: boolean
  isDefault: boolean
}

function requireAuth(req: AuthedRequest | undefined): AuthContext {
  if (!req?.auth) throw new UnauthorizedException('Unauthenticated MCP request')
  return req.auth
}

@Injectable()
export class WorkspacesTools {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Tool({
    name: 'list_workspaces',
    description:
      'Список рабочих пространств пользователя с пометкой текущего (isCurrent) и ' +
      'дефолтного (isDefault). Возвращает id, name, slug, role, isCurrent, isDefault. ' +
      'Используй для "какие у меня пространства", "в каких пространствах я состою", ' +
      '"в каком пространстве я сейчас".',
    parameters: ListWorkspacesInput,
  })
  async listWorkspaces(args: ListWorkspacesArgs, _context: Context, req: AuthedRequest) {
    return this.doListWorkspaces(requireAuth(req), args)
  }

  async doListWorkspaces(
    auth: AuthContext,
    args: ListWorkspacesArgs,
  ): Promise<{ workspaces: WorkspaceSummary[] }> {
    const [rows, pref] = await Promise.all([
      this.prisma.workspaceMember.findMany({
        where: { userId: auth.userId },
        select: { role: true, workspace: { select: { id: true, name: true, slug: true } } },
        orderBy: { workspace: { name: 'asc' } },
        take: 200,
      }),
      this.prisma.userPreference.findFirst({
        where: { userId: auth.userId },
        select: { defaultWorkspaceId: true },
      }),
    ])
    return {
      workspaces: rows.map((r) => ({
        id: r.workspace.id,
        name: r.workspace.name,
        slug: r.workspace.slug,
        role: r.role,
        isCurrent: args.workspaceId != null && r.workspace.id === args.workspaceId,
        isDefault: pref?.defaultWorkspaceId === r.workspace.id,
      })),
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter engines test -- workspaces.tools`
Expected: PASS.

- [ ] **Step 5: Add scope constant + registry entry in agents**

In `apps/agents/agents/apps/agent/services/tool_registry.py`, add a scope constant near the others:
```python
SCOPE_WORKSPACES_READ = 'workspaces:read'
```
Add inside `DEFAULT_ENGINES_TOOLS`:
```python
    'list_workspaces': ToolMeta('list_workspaces', SCOPE_WORKSPACES_READ, False,
                                 _summary_generic('list_workspaces'), _preview_default),
```

- [ ] **Step 6: Commit**

```bash
git add apps/engines/src/apps/mcp/tools/workspaces.tools.ts apps/engines/src/apps/mcp/tools/workspaces.tools.spec.ts apps/agents/agents/apps/agent/services/tool_registry.py
git commit -m "feat(mcp): flag current/default workspace in list_workspaces"
```

### Task 7: `listWorkspaceMembers` tool

**Files:**
- Modify: `apps/engines/src/apps/mcp/tools/workspace.tools.ts`
- Create: `apps/engines/src/apps/mcp/tools/workspace-members.spec.ts`
- Modify: `apps/agents/agents/apps/agent/services/tool_registry.py`

- [ ] **Step 1: Write the failing test**

Create `apps/engines/src/apps/mcp/tools/workspace-members.spec.ts`:

```ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { ForbiddenException } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'

import type { AuthedRequest } from '../../api/auth/auth-context.js'
import type { PageWriter } from '../services/page-writer.service.js'
import type { StatsService } from '../services/stats.service.js'
import { WorkspaceTools } from './workspace.tools.js'

describe('WorkspaceTools.listWorkspaceMembers', () => {
  const memberFindUnique = jest.fn<(...args: unknown[]) => Promise<unknown>>()
  const memberFindMany = jest.fn<(...args: unknown[]) => Promise<unknown>>()
  const prisma = {
    workspaceMember: { findUnique: memberFindUnique, findMany: memberFindMany },
  } as unknown as PrismaClient
  let tools: WorkspaceTools

  beforeEach(() => {
    jest.clearAllMocks()
    tools = new WorkspaceTools(prisma, {} as PageWriter, {} as StatsService)
  })

  it('lists members with names and roles', async () => {
    memberFindUnique.mockResolvedValue({ workspaceId: 'w1' })
    memberFindMany.mockResolvedValue([
      { role: 'OWNER', user: { id: 'u1', firstName: 'Ann', lastName: 'Lee', email: 'a@x.io' } },
    ])
    const req = { headers: {}, auth: { userId: 'u1', source: 'api-key' as const } } as AuthedRequest

    const out = await tools.listWorkspaceMembers({ workspaceId: 'w1' }, {} as never, req)

    expect(out.members).toEqual([
      { userId: 'u1', firstName: 'Ann', lastName: 'Lee', email: 'a@x.io', role: 'OWNER' },
    ])
  })

  it('rejects non-member', async () => {
    memberFindUnique.mockResolvedValue(null)
    const req = { headers: {}, auth: { userId: 'u1', source: 'api-key' as const } } as AuthedRequest
    await expect(
      tools.listWorkspaceMembers({ workspaceId: 'w1' }, {} as never, req),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter engines test -- workspace-members`
Expected: FAIL — `listWorkspaceMembers` is not a function.

- [ ] **Step 3: Add the tool method to `WorkspaceTools`**

In `apps/engines/src/apps/mcp/tools/workspace.tools.ts`, add this method inside the `WorkspaceTools` class (e.g. right after `doGetWorkspaceStats`). It reuses the existing `GetWorkspaceStatsInput`/`GetWorkspaceStatsArgs` (both are `{ workspaceId }`):

```ts
  @Tool({
    name: 'listWorkspaceMembers',
    description:
      'Список участников рабочего пространства: userId, имя, фамилия, email, роль. ' +
      'Используй чтобы сопоставить имя человека с пользователем (например для ' +
      'назначения ответственного из протокола встречи) или показать команду. ' +
      'Параметр: workspaceId (uuid).',
    parameters: GetWorkspaceStatsInput,
  })
  listWorkspaceMembers(args: GetWorkspaceStatsArgs, _context: Context, req: AuthedRequest) {
    return this.doListWorkspaceMembers(requireAuth(req), args)
  }

  async doListWorkspaceMembers(auth: AuthContext, args: GetWorkspaceStatsArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    const rows = await this.prisma.workspaceMember.findMany({
      where: { workspaceId: args.workspaceId },
      select: {
        role: true,
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
    })
    return {
      members: rows.map((m) => ({
        userId: m.user.id,
        firstName: m.user.firstName,
        lastName: m.user.lastName,
        email: m.user.email,
        role: m.role,
      })),
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter engines test -- workspace-members`
Expected: PASS.

- [ ] **Step 5: Add registry entry in agents**

In `apps/agents/agents/apps/agent/services/tool_registry.py`, add inside `DEFAULT_ENGINES_TOOLS`:
```python
    'listWorkspaceMembers': ToolMeta('listWorkspaceMembers', SCOPE_WORKSPACES_READ, False,
                                      _summary_generic('listWorkspaceMembers'), _preview_default),
```

- [ ] **Step 6: Commit**

```bash
git add apps/engines/src/apps/mcp/tools/workspace.tools.ts apps/engines/src/apps/mcp/tools/workspace-members.spec.ts apps/agents/agents/apps/agent/services/tool_registry.py
git commit -m "feat(mcp): add listWorkspaceMembers tool"
```

---

## Phase 3 — Reminders CRUD (engines)

Backed by `Reminder` (`pageId, workspaceId, createdById, label, dueAt, offsets[], audience, doneAt, doneById, deletedAt`) + `ReminderRecipient`. "My reminders" = `createdById == me` OR `recipients` contains me. Mutations require `createdById == me`.

### Task 8: `ReminderService` + `ReminderNotFoundError`

**Files:**
- Modify: `apps/engines/src/apps/mcp/errors/mcp.errors.ts`
- Create: `apps/engines/src/apps/mcp/services/reminder.service.ts`
- Test: `apps/engines/src/apps/mcp/services/reminder.service.spec.ts`

- [ ] **Step 1: Add the error class**

In `apps/engines/src/apps/mcp/errors/mcp.errors.ts`, append:
```ts
export class ReminderNotFoundError extends HttpException {
  constructor(reminderId: string) {
    super(
      { code: 'REMINDER_NOT_FOUND', message: `REMINDER_NOT_FOUND: reminder ${reminderId} not found or not owned by caller` },
      404,
    )
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `apps/engines/src/apps/mcp/services/reminder.service.spec.ts`:

```ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'

import { PageNotFoundError, ReminderNotFoundError } from '../errors/mcp.errors.js'
import { ReminderService } from './reminder.service.js'

describe('ReminderService', () => {
  const pageFindUnique = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const reminderCreate = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const reminderFindUnique = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const reminderUpdate = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const reminderUpdateMany = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const prisma = {
    page: { findUnique: pageFindUnique },
    reminder: {
      create: reminderCreate,
      findUnique: reminderFindUnique,
      update: reminderUpdate,
      updateMany: reminderUpdateMany,
    },
  } as unknown as PrismaClient
  let svc: ReminderService

  beforeEach(() => {
    jest.clearAllMocks()
    svc = new ReminderService(prisma)
  })

  it('createReminder verifies the page belongs to the workspace', async () => {
    pageFindUnique.mockResolvedValue({ workspaceId: 'w-other' })
    await expect(
      svc.createReminder({ userId: 'u1', workspaceId: 'w1', pageId: 'p1', dueAt: new Date('2026-06-01T10:00:00Z') }),
    ).rejects.toBeInstanceOf(PageNotFoundError)
  })

  it('createReminder creates with defaults', async () => {
    pageFindUnique.mockResolvedValue({ workspaceId: 'w1' })
    reminderCreate.mockResolvedValue({ id: 'r1' })
    const id = await svc.createReminder({
      userId: 'u1', workspaceId: 'w1', pageId: 'p1', dueAt: new Date('2026-06-01T10:00:00Z'), label: 'Ship',
    })
    expect(id).toBe('r1')
    expect(reminderCreate).toHaveBeenCalledWith({
      data: {
        pageId: 'p1', workspaceId: 'w1', createdById: 'u1', label: 'Ship',
        dueAt: new Date('2026-06-01T10:00:00Z'), audience: 'ME', offsets: [],
      },
      select: { id: true },
    })
  })

  it('moveReminder shifts an owned reminder by a relative delta', async () => {
    reminderFindUnique.mockResolvedValue({ id: 'r1', createdById: 'u1', dueAt: new Date('2026-06-01T10:00:00Z') })
    reminderUpdate.mockResolvedValue({})
    const out = await svc.moveReminder({ userId: 'u1', reminderId: 'r1', shift: { days: 2, hours: 5 } })
    expect(out.dueAt).toEqual(new Date('2026-06-03T15:00:00Z'))
    expect(reminderUpdate).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { dueAt: new Date('2026-06-03T15:00:00Z') },
    })
  })

  it('moveReminder rejects a reminder owned by someone else', async () => {
    reminderFindUnique.mockResolvedValue({ id: 'r1', createdById: 'u2', dueAt: new Date() })
    await expect(
      svc.moveReminder({ userId: 'u1', reminderId: 'r1', shift: { days: 1 } }),
    ).rejects.toBeInstanceOf(ReminderNotFoundError)
  })

  it('deleteReminder soft-deletes owned reminders and returns the count', async () => {
    reminderUpdateMany.mockResolvedValue({ count: 3 })
    const out = await svc.deleteReminder({ userId: 'u1', all: true })
    expect(out.count).toBe(3)
    expect(reminderUpdateMany).toHaveBeenCalledWith({
      where: { createdById: 'u1', deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter engines test -- reminder.service`
Expected: FAIL — cannot find module `./reminder.service.js`.

- [ ] **Step 4: Implement `ReminderService`**

Create `apps/engines/src/apps/mcp/services/reminder.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { PageNotFoundError, ReminderNotFoundError } from '../errors/mcp.errors.js'

type Audience = 'ME' | 'WORKSPACE' | 'LIST'

export type CreateReminderInput = {
  userId: string
  workspaceId: string
  pageId: string
  dueAt: Date
  label?: string | null
  audience?: Audience
  offsets?: number[]
}
export type ListRemindersInput = {
  userId: string
  workspaceId?: string
  pageId?: string
  includeDone?: boolean
}
export type MoveReminderInput = {
  userId: string
  reminderId: string
  dueAt?: Date
  shift?: { days?: number; hours?: number; minutes?: number }
}
export type DeleteReminderInput = {
  userId: string
  reminderId?: string
  reminderIds?: string[]
  all?: boolean
  pageId?: string
}

function shiftMs(shift: { days?: number; hours?: number; minutes?: number }): number {
  return (shift.days ?? 0) * 86_400_000 + (shift.hours ?? 0) * 3_600_000 + (shift.minutes ?? 0) * 60_000
}

@Injectable()
export class ReminderService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async createReminder(input: CreateReminderInput): Promise<string> {
    const page = await this.prisma.page.findUnique({
      where: { id: input.pageId },
      select: { workspaceId: true },
    })
    if (!page || page.workspaceId !== input.workspaceId) throw new PageNotFoundError(input.pageId)
    const reminder = await this.prisma.reminder.create({
      data: {
        pageId: input.pageId,
        workspaceId: input.workspaceId,
        createdById: input.userId,
        label: input.label ?? null,
        dueAt: input.dueAt,
        audience: input.audience ?? 'ME',
        offsets: input.offsets ?? [],
      },
      select: { id: true },
    })
    return reminder.id
  }

  async listReminders(input: ListRemindersInput) {
    const rows = await this.prisma.reminder.findMany({
      where: {
        deletedAt: null,
        OR: [{ createdById: input.userId }, { recipients: { some: { userId: input.userId } } }],
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        ...(input.pageId ? { pageId: input.pageId } : {}),
        ...(input.includeDone ? {} : { doneAt: null }),
      },
      select: {
        id: true,
        label: true,
        dueAt: true,
        doneAt: true,
        page: { select: { id: true, title: true } },
        workspace: { select: { id: true, name: true } },
      },
      orderBy: { dueAt: 'asc' },
      take: 200,
    })
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      dueAt: r.dueAt,
      done: r.doneAt != null,
      page: r.page,
      workspace: r.workspace,
    }))
  }

  async moveReminder(input: MoveReminderInput): Promise<{ id: string; dueAt: Date }> {
    const reminder = await this.prisma.reminder.findUnique({
      where: { id: input.reminderId },
      select: { id: true, createdById: true, dueAt: true },
    })
    if (!reminder || reminder.createdById !== input.userId) throw new ReminderNotFoundError(input.reminderId)
    const dueAt = input.dueAt ?? new Date(reminder.dueAt.getTime() + shiftMs(input.shift ?? {}))
    await this.prisma.reminder.update({ where: { id: input.reminderId }, data: { dueAt } })
    return { id: input.reminderId, dueAt }
  }

  async deleteReminder(input: DeleteReminderInput): Promise<{ count: number }> {
    const result = await this.prisma.reminder.updateMany({
      where: {
        createdById: input.userId,
        deletedAt: null,
        ...(input.reminderId ? { id: input.reminderId } : {}),
        ...(input.reminderIds ? { id: { in: input.reminderIds } } : {}),
        ...(input.pageId ? { pageId: input.pageId } : {}),
      },
      data: { deletedAt: new Date() },
    })
    return { count: result.count }
  }

  async completeReminder(input: { userId: string; reminderId: string }): Promise<{ id: string }> {
    const result = await this.prisma.reminder.updateMany({
      where: {
        id: input.reminderId,
        doneAt: null,
        OR: [{ createdById: input.userId }, { recipients: { some: { userId: input.userId } } }],
      },
      data: { doneAt: new Date(), doneById: input.userId },
    })
    if (result.count === 0) throw new ReminderNotFoundError(input.reminderId)
    return { id: input.reminderId }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter engines test -- reminder.service`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/engines/src/apps/mcp/errors/mcp.errors.ts apps/engines/src/apps/mcp/services/reminder.service.ts apps/engines/src/apps/mcp/services/reminder.service.spec.ts
git commit -m "feat(mcp): add ReminderService (create/list/move/delete/complete)"
```

### Task 9: `ReminderTools` (5 tools) + wiring

**Files:**
- Create: `apps/engines/src/apps/mcp/tools/reminder.tools.ts`
- Test: `apps/engines/src/apps/mcp/tools/reminder.tools.spec.ts`
- Modify: `apps/engines/src/apps/mcp/mcp.module.ts`
- Modify: `apps/agents/agents/apps/agent/services/tool_registry.py`

- [ ] **Step 1: Write the failing test**

Create `apps/engines/src/apps/mcp/tools/reminder.tools.spec.ts`:

```ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { BadRequestException, ForbiddenException } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'

import type { AuthedRequest } from '../../api/auth/auth-context.js'
import type { ReminderService } from '../services/reminder.service.js'
import { ReminderTools } from './reminder.tools.js'

describe('ReminderTools', () => {
  const findUnique = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const prisma = { workspaceMember: { findUnique } } as unknown as PrismaClient
  const service = {
    createReminder: jest.fn(),
    listReminders: jest.fn(),
    moveReminder: jest.fn(),
    deleteReminder: jest.fn(),
    completeReminder: jest.fn(),
  } as unknown as ReminderService
  const req = { headers: {}, auth: { userId: 'u1', source: 'api-key' as const } } as AuthedRequest
  let tools: ReminderTools

  beforeEach(() => {
    jest.clearAllMocks()
    findUnique.mockResolvedValue({ workspaceId: 'w1' })
    tools = new ReminderTools(prisma, service)
  })

  it('createReminder forwards to the service', async () => {
    ;(service.createReminder as jest.Mock).mockResolvedValue('r1')
    const out = await tools.createReminder(
      { workspaceId: 'w1', pageId: 'p1', dueAt: new Date('2026-06-01T10:00:00Z'), audience: 'ME' },
      {} as never,
      req,
    )
    expect(out).toEqual({ reminderId: 'r1' })
    expect(service.createReminder).toHaveBeenCalled()
  })

  it('moveReminder rejects when neither dueAt nor shift is provided', async () => {
    await expect(
      tools.moveReminder({ workspaceId: 'w1', reminderId: 'r1' }, {} as never, req),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('moveReminder rejects when both dueAt and shift are provided', async () => {
    await expect(
      tools.moveReminder(
        { workspaceId: 'w1', reminderId: 'r1', dueAt: new Date(), shift: { days: 1 } },
        {} as never,
        req,
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('deleteReminder rejects when no selector is provided', async () => {
    await expect(
      tools.deleteReminder({ workspaceId: 'w1' }, {} as never, req),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('rejects a non-member caller', async () => {
    findUnique.mockResolvedValue(null)
    await expect(
      tools.createReminder({ workspaceId: 'w1', pageId: 'p1', dueAt: new Date(), audience: 'ME' }, {} as never, req),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter engines test -- reminder.tools`
Expected: FAIL — cannot find module `./reminder.tools.js`.

- [ ] **Step 3: Implement `ReminderTools`**

Create `apps/engines/src/apps/mcp/tools/reminder.tools.ts`:

```ts
import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import type { Context } from '@rekog/mcp-nest'
import { Tool } from '@rekog/mcp-nest'
import type { PrismaClient } from '@repo/db'
import { z } from 'zod'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { assertMember } from '../../api/auth/membership.js'
import type { AuthContext, AuthedRequest } from '../../api/auth/auth-context.js'
import { ReminderService } from '../services/reminder.service.js'
import { mcpInput, mcpNullableUuidOptional, mcpUuid } from '../utils/mcp-input.js'

const CreateReminderInput = z.object({
  workspaceId: z.string().uuid(),
  pageId: mcpUuid(),
  dueAt: z.coerce.date(),
  label: mcpInput(z.string().max(200).optional()),
  audience: mcpInput(z.enum(['ME', 'WORKSPACE', 'LIST']).default('ME')),
  offsets: mcpInput(z.array(z.number().int()).optional()),
})
const ListRemindersInput = z.object({
  workspaceId: mcpInput(z.string().uuid().optional()),
  pageId: mcpNullableUuidOptional(),
  includeDone: mcpInput(z.boolean().default(false)),
})
const MoveReminderInput = z.object({
  workspaceId: z.string().uuid(),
  reminderId: mcpUuid(),
  dueAt: mcpInput(z.coerce.date().optional()),
  shift: mcpInput(
    z.object({
      days: z.number().int().optional(),
      hours: z.number().int().optional(),
      minutes: z.number().int().optional(),
    }).optional(),
  ),
})
const DeleteReminderInput = z.object({
  workspaceId: z.string().uuid(),
  reminderId: mcpNullableUuidOptional(),
  reminderIds: mcpInput(z.array(z.string().uuid()).optional()),
  all: mcpInput(z.boolean().optional()),
  pageId: mcpNullableUuidOptional(),
})
const CompleteReminderInput = z.object({
  workspaceId: z.string().uuid(),
  reminderId: mcpUuid(),
})

type CreateReminderArgs = z.infer<typeof CreateReminderInput>
type ListRemindersArgs = z.infer<typeof ListRemindersInput>
type MoveReminderArgs = z.infer<typeof MoveReminderInput>
type DeleteReminderArgs = z.infer<typeof DeleteReminderInput>
type CompleteReminderArgs = z.infer<typeof CompleteReminderInput>

function requireAuth(req: AuthedRequest | undefined): AuthContext {
  if (!req?.auth) throw new UnauthorizedException('Unauthenticated MCP request')
  return req.auth
}

@Injectable()
export class ReminderTools {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly reminders: ReminderService,
  ) {}

  @Tool({
    name: 'createReminder',
    description:
      'Создаёт напоминание на странице с датой/временем срабатывания (dueAt, ISO 8601). ' +
      'Используй для протокола встречи: на каждое поручение со сроком ставь напоминание. ' +
      'Требует подтверждения. Параметры: workspaceId, pageId, dueAt, label (опц.), ' +
      'audience (ME|WORKSPACE|LIST, def ME), offsets (опц., секунды до dueAt).',
    parameters: CreateReminderInput,
  })
  createReminder(args: CreateReminderArgs, _context: Context, req: AuthedRequest) {
    return this.doCreateReminder(requireAuth(req), args)
  }

  async doCreateReminder(auth: AuthContext, args: CreateReminderArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    const reminderId = await this.reminders.createReminder({
      userId: auth.userId,
      workspaceId: args.workspaceId,
      pageId: args.pageId,
      dueAt: args.dueAt,
      label: args.label,
      audience: args.audience,
      offsets: args.offsets,
    })
    return { reminderId }
  }

  @Tool({
    name: 'listReminders',
    description:
      'Список моих напоминаний (созданных мной или где я получатель). По умолчанию ' +
      'только невыполненные в текущем воркспейсе; без workspaceId — по всем моим ' +
      'пространствам. Возвращает id, label, dueAt, done, page, workspace. ' +
      'Используй для "какие у меня напоминания". Параметры: workspaceId (опц.), ' +
      'pageId (опц.), includeDone (def false).',
    parameters: ListRemindersInput,
  })
  listReminders(args: ListRemindersArgs, _context: Context, req: AuthedRequest) {
    return this.doListReminders(requireAuth(req), args)
  }

  async doListReminders(auth: AuthContext, args: ListRemindersArgs) {
    if (args.workspaceId) await assertMember(this.prisma, auth.userId, args.workspaceId)
    const reminders = await this.reminders.listReminders({
      userId: auth.userId,
      workspaceId: args.workspaceId ?? undefined,
      pageId: args.pageId ?? undefined,
      includeDone: args.includeDone,
    })
    return { reminders }
  }

  @Tool({
    name: 'moveReminder',
    description:
      'Переносит срок напоминания. Укажи РОВНО ОДНО: dueAt (новая дата ISO) ИЛИ ' +
      'shift (относительный сдвиг {days,hours,minutes}). "сдвинь на 2 дня" → ' +
      'shift {days:2}; "на 5 часов" → shift {hours:5}. Требует подтверждения. ' +
      'Параметры: workspaceId, reminderId, dueAt? , shift?.',
    parameters: MoveReminderInput,
  })
  moveReminder(args: MoveReminderArgs, _context: Context, req: AuthedRequest) {
    return this.doMoveReminder(requireAuth(req), args)
  }

  async doMoveReminder(auth: AuthContext, args: MoveReminderArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    const hasDue = args.dueAt != null
    const hasShift = args.shift != null
    if (hasDue === hasShift) {
      throw new BadRequestException('Provide exactly one of dueAt or shift')
    }
    return this.reminders.moveReminder({
      userId: auth.userId,
      reminderId: args.reminderId,
      dueAt: args.dueAt ?? undefined,
      shift: args.shift ?? undefined,
    })
  }

  @Tool({
    name: 'deleteReminder',
    description:
      'Удаляет мои напоминания (мягко). Укажи reminderId, или reminderIds[], или ' +
      'all:true (опц. вместе с pageId — все на странице). Требует подтверждения. ' +
      'Параметры: workspaceId, reminderId?, reminderIds?, all?, pageId?.',
    parameters: DeleteReminderInput,
  })
  deleteReminder(args: DeleteReminderArgs, _context: Context, req: AuthedRequest) {
    return this.doDeleteReminder(requireAuth(req), args)
  }

  async doDeleteReminder(auth: AuthContext, args: DeleteReminderArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    const hasSelector = args.reminderId != null || (args.reminderIds?.length ?? 0) > 0 || args.all === true
    if (!hasSelector) {
      throw new BadRequestException('Provide reminderId, reminderIds, or all:true')
    }
    return this.reminders.deleteReminder({
      userId: auth.userId,
      reminderId: args.reminderId ?? undefined,
      reminderIds: args.reminderIds ?? undefined,
      all: args.all ?? undefined,
      pageId: args.pageId ?? undefined,
    })
  }

  @Tool({
    name: 'completeReminder',
    description:
      'Отмечает напоминание выполненным. Параметры: workspaceId, reminderId.',
    parameters: CompleteReminderInput,
  })
  completeReminder(args: CompleteReminderArgs, _context: Context, req: AuthedRequest) {
    return this.doCompleteReminder(requireAuth(req), args)
  }

  async doCompleteReminder(auth: AuthContext, args: CompleteReminderArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    return this.reminders.completeReminder({ userId: auth.userId, reminderId: args.reminderId })
  }
}
```

- [ ] **Step 4: Wire into `mcp.module.ts`**

Add imports:
```ts
import { ReminderService } from './services/reminder.service.js'
import { ReminderTools } from './tools/reminder.tools.js'
```
Add `ReminderService` and `ReminderTools` to `providers`, and `ReminderTools` to `exports`.

- [ ] **Step 5: Add registry entries in agents**

In `apps/agents/agents/apps/agent/services/tool_registry.py`, add scope constants:
```python
SCOPE_REMINDERS_READ = 'reminders:read'
SCOPE_REMINDERS_WRITE = 'reminders:write'
```
Add inside `DEFAULT_ENGINES_TOOLS`:
```python
    'createReminder':   ToolMeta('createReminder', SCOPE_REMINDERS_WRITE, True,
                                  lambda a: f'Создать напоминание на странице {a.get("pageId")}', _preview_default),
    'listReminders':    ToolMeta('listReminders', SCOPE_REMINDERS_READ, False,
                                  _summary_generic('listReminders'), _preview_default),
    'moveReminder':     ToolMeta('moveReminder', SCOPE_REMINDERS_WRITE, True,
                                  lambda a: f'Перенести напоминание {a.get("reminderId")}', _preview_default),
    'deleteReminder':   ToolMeta('deleteReminder', SCOPE_REMINDERS_WRITE, True,
                                  lambda a: 'Удалить напоминания', _preview_default),
    'completeReminder': ToolMeta('completeReminder', SCOPE_REMINDERS_WRITE, False,
                                  _summary_generic('completeReminder'), _preview_default),
```

- [ ] **Step 6: Run tests + type check**

Run: `pnpm --filter engines test -- reminder.tools && pnpm --filter engines check-types`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/engines/src/apps/mcp/tools/reminder.tools.ts apps/engines/src/apps/mcp/tools/reminder.tools.spec.ts apps/engines/src/apps/mcp/mcp.module.ts apps/agents/agents/apps/agent/services/tool_registry.py
git commit -m "feat(mcp): add reminder CRUD tools"
```

---

## Phase 4 — Notifications (engines)

Account-wide (no `workspaceId`). Backed by `NotificationInApp` (`userId`, `readAt`) joined to `NotificationEvent`.

### Task 10: `NotificationService` + `NotificationTools`

**Files:**
- Create: `apps/engines/src/apps/mcp/services/notification.service.ts`
- Test: `apps/engines/src/apps/mcp/services/notification.service.spec.ts`
- Create: `apps/engines/src/apps/mcp/tools/notification.tools.ts`
- Test: `apps/engines/src/apps/mcp/tools/notification.tools.spec.ts`
- Modify: `apps/engines/src/apps/mcp/mcp.module.ts`
- Modify: `apps/agents/agents/apps/agent/services/tool_registry.py`

- [ ] **Step 1: Write the failing service test**

Create `apps/engines/src/apps/mcp/services/notification.service.spec.ts`:

```ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'

import { NotificationService } from './notification.service.js'

describe('NotificationService', () => {
  const findMany = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const updateMany = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const prisma = { notificationInApp: { findMany, updateMany } } as unknown as PrismaClient
  let svc: NotificationService

  beforeEach(() => {
    jest.clearAllMocks()
    svc = new NotificationService(prisma)
  })

  it('lists unread by default and maps event fields', async () => {
    findMany.mockResolvedValue([
      {
        id: 'n1',
        readAt: null,
        createdAt: new Date('2026-05-28T00:00:00Z'),
        event: { type: 'REMINDER_DUE', category: 'SERVICE', resourceUrl: '/p/1' },
      },
    ])
    const out = await svc.list({ userId: 'u1', unreadOnly: true, limit: 50 })
    expect(out).toEqual([
      { id: 'n1', type: 'REMINDER_DUE', category: 'SERVICE', resourceUrl: '/p/1', read: false, createdAt: new Date('2026-05-28T00:00:00Z') },
    ])
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u1', readAt: null } }))
  })

  it('markRead(all) clears all unread for the user', async () => {
    updateMany.mockResolvedValue({ count: 4 })
    const out = await svc.markRead({ userId: 'u1', all: true })
    expect(out.count).toBe(4)
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', readAt: null },
      data: { readAt: expect.any(Date) },
    })
  })

  it('markRead(ids) clears only the given ids', async () => {
    updateMany.mockResolvedValue({ count: 1 })
    await svc.markRead({ userId: 'u1', ids: ['n1'] })
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', readAt: null, id: { in: ['n1'] } },
      data: { readAt: expect.any(Date) },
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter engines test -- notification.service`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement `NotificationService`**

Create `apps/engines/src/apps/mcp/services/notification.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'

import { PRISMA } from '../../../infra/db/db.providers.js'

export type ListNotificationsInput = { userId: string; unreadOnly: boolean; limit: number }
export type MarkReadInput = { userId: string; all?: boolean; ids?: string[] }

@Injectable()
export class NotificationService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async list(input: ListNotificationsInput) {
    const rows = await this.prisma.notificationInApp.findMany({
      where: { userId: input.userId, ...(input.unreadOnly ? { readAt: null } : {}) },
      select: {
        id: true,
        readAt: true,
        createdAt: true,
        event: { select: { type: true, category: true, resourceUrl: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: input.limit,
    })
    return rows.map((r) => ({
      id: r.id,
      type: r.event.type,
      category: r.event.category,
      resourceUrl: r.event.resourceUrl,
      read: r.readAt != null,
      createdAt: r.createdAt,
    }))
  }

  async markRead(input: MarkReadInput): Promise<{ count: number }> {
    const result = await this.prisma.notificationInApp.updateMany({
      where: {
        userId: input.userId,
        readAt: null,
        ...(input.all ? {} : { id: { in: input.ids ?? [] } }),
      },
      data: { readAt: new Date() },
    })
    return { count: result.count }
  }
}
```

- [ ] **Step 4: Run service test to verify it passes**

Run: `pnpm --filter engines test -- notification.service`
Expected: PASS.

- [ ] **Step 5: Write the failing tools test**

Create `apps/engines/src/apps/mcp/tools/notification.tools.spec.ts`:

```ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { BadRequestException, UnauthorizedException } from '@nestjs/common'

import type { AuthedRequest } from '../../api/auth/auth-context.js'
import type { NotificationService } from '../services/notification.service.js'
import { NotificationTools } from './notification.tools.js'

describe('NotificationTools', () => {
  const service = { list: jest.fn(), markRead: jest.fn() } as unknown as NotificationService
  const req = { headers: {}, auth: { userId: 'u1', source: 'api-key' as const } } as AuthedRequest
  let tools: NotificationTools

  beforeEach(() => {
    jest.clearAllMocks()
    tools = new NotificationTools(service)
  })

  it('listNotifications forwards defaults', async () => {
    ;(service.list as jest.Mock).mockResolvedValue([])
    const out = await tools.listNotifications({ unreadOnly: true, limit: 50 }, {} as never, req)
    expect(out).toEqual({ notifications: [] })
    expect(service.list).toHaveBeenCalledWith({ userId: 'u1', unreadOnly: true, limit: 50 })
  })

  it('markNotificationsRead(all) forwards', async () => {
    ;(service.markRead as jest.Mock).mockResolvedValue({ count: 2 })
    const out = await tools.markNotificationsRead({ all: true }, {} as never, req)
    expect(out).toEqual({ count: 2 })
  })

  it('markNotificationsRead rejects empty selector', async () => {
    await expect(
      tools.markNotificationsRead({}, {} as never, req),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('throws Unauthorized without auth', async () => {
    await expect(
      tools.listNotifications({ unreadOnly: true, limit: 50 }, {} as never, { headers: {} } as AuthedRequest),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })
})
```

- [ ] **Step 6: Implement `NotificationTools`**

Create `apps/engines/src/apps/mcp/tools/notification.tools.ts`:

```ts
import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common'
import type { Context } from '@rekog/mcp-nest'
import { Tool } from '@rekog/mcp-nest'
import { z } from 'zod'

import type { AuthContext, AuthedRequest } from '../../api/auth/auth-context.js'
import { NotificationService } from '../services/notification.service.js'
import { mcpInput } from '../utils/mcp-input.js'

const ListNotificationsInput = z.object({
  unreadOnly: mcpInput(z.boolean().default(true)),
  limit: mcpInput(z.number().int().positive().max(100).default(50)),
})
const MarkReadInput = z.object({
  all: mcpInput(z.boolean().optional()),
  ids: mcpInput(z.array(z.string().uuid()).optional()),
})

type ListNotificationsArgs = z.infer<typeof ListNotificationsInput>
type MarkReadArgs = z.infer<typeof MarkReadInput>

function requireAuth(req: AuthedRequest | undefined): AuthContext {
  if (!req?.auth) throw new UnauthorizedException('Unauthenticated MCP request')
  return req.auth
}

@Injectable()
export class NotificationTools {
  constructor(private readonly notifications: NotificationService) {}

  @Tool({
    name: 'listNotifications',
    description:
      'Список уведомлений пользователя (по всем пространствам). По умолчанию только ' +
      'непрочитанные. Возвращает id, type, category, resourceUrl, read, createdAt. ' +
      'Используй для "покажи мне уведомления". Параметры: unreadOnly (def true), limit (def 50).',
    parameters: ListNotificationsInput,
  })
  listNotifications(args: ListNotificationsArgs, _context: Context, req: AuthedRequest) {
    const auth = requireAuth(req)
    return this.notifications
      .list({ userId: auth.userId, unreadOnly: args.unreadOnly, limit: args.limit })
      .then((notifications) => ({ notifications }))
  }

  @Tool({
    name: 'markNotificationsRead',
    description:
      'Помечает уведомления прочитанными. Укажи all:true (все) или ids[] (конкретные). ' +
      'Используй для "прочитай все уведомления". Параметры: all?, ids?.',
    parameters: MarkReadInput,
  })
  markNotificationsRead(args: MarkReadArgs, _context: Context, req: AuthedRequest) {
    const auth = requireAuth(req)
    if (args.all !== true && (args.ids?.length ?? 0) === 0) {
      throw new BadRequestException('Provide all:true or a non-empty ids array')
    }
    return this.notifications.markRead({ userId: auth.userId, all: args.all, ids: args.ids })
  }
}
```

- [ ] **Step 7: Wire into `mcp.module.ts`**

Add imports for `NotificationService` and `NotificationTools`; add both to `providers`; add `NotificationTools` to `exports`.

- [ ] **Step 8: Add registry entries in agents**

Add scope constants:
```python
SCOPE_NOTIFICATIONS_READ = 'notifications:read'
SCOPE_NOTIFICATIONS_WRITE = 'notifications:write'
```
Add inside `DEFAULT_ENGINES_TOOLS`:
```python
    'listNotifications':     ToolMeta('listNotifications', SCOPE_NOTIFICATIONS_READ, False,
                                       _summary_generic('listNotifications'), _preview_default),
    'markNotificationsRead': ToolMeta('markNotificationsRead', SCOPE_NOTIFICATIONS_WRITE, False,
                                       _summary_generic('markNotificationsRead'), _preview_default),
```

- [ ] **Step 9: Run tests + type check, then commit**

Run: `pnpm --filter engines test -- notification && pnpm --filter engines check-types`
Expected: PASS.

```bash
git add apps/engines/src/apps/mcp/services/notification.service.ts apps/engines/src/apps/mcp/services/notification.service.spec.ts apps/engines/src/apps/mcp/tools/notification.tools.ts apps/engines/src/apps/mcp/tools/notification.tools.spec.ts apps/engines/src/apps/mcp/mcp.module.ts apps/agents/agents/apps/agent/services/tool_registry.py
git commit -m "feat(mcp): add notification list + mark-read tools"
```

---

## Phase 5 — Favorites (engines)

Backed by `FavoritePage` (`userId, pageId, position`, unique `(userId, pageId)`). Per-user, cross-workspace.

### Task 11: `FavoriteService` + `FavoriteTools`

**Files:**
- Create: `apps/engines/src/apps/mcp/services/favorite.service.ts`
- Test: `apps/engines/src/apps/mcp/services/favorite.service.spec.ts`
- Create: `apps/engines/src/apps/mcp/tools/favorite.tools.ts`
- Test: `apps/engines/src/apps/mcp/tools/favorite.tools.spec.ts`
- Modify: `apps/engines/src/apps/mcp/mcp.module.ts`
- Modify: `apps/agents/agents/apps/agent/services/tool_registry.py`

- [ ] **Step 1: Write the failing service test**

Create `apps/engines/src/apps/mcp/services/favorite.service.spec.ts`:

```ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'

import { PageNotFoundError } from '../errors/mcp.errors.js'
import { FavoriteService } from './favorite.service.js'

describe('FavoriteService', () => {
  const favFindMany = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const favAggregate = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const favUpsert = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const favDeleteMany = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const pageFindUnique = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const prisma = {
    favoritePage: { findMany: favFindMany, aggregate: favAggregate, upsert: favUpsert, deleteMany: favDeleteMany },
    page: { findUnique: pageFindUnique },
  } as unknown as PrismaClient
  let svc: FavoriteService

  beforeEach(() => {
    jest.clearAllMocks()
    svc = new FavoriteService(prisma)
  })

  it('lists favorites ordered by position', async () => {
    favFindMany.mockResolvedValue([
      { page: { id: 'p1', title: 'A', type: 'TEXT', icon: null, workspaceId: 'w1' } },
    ])
    const out = await svc.list({ userId: 'u1' })
    expect(out).toEqual([{ pageId: 'p1', title: 'A', type: 'TEXT', icon: null, workspaceId: 'w1' }])
  })

  it('add verifies the page is in the workspace and upserts at next position', async () => {
    pageFindUnique.mockResolvedValue({ workspaceId: 'w1' })
    favAggregate.mockResolvedValue({ _max: { position: 4 } })
    favUpsert.mockResolvedValue({})
    await svc.add({ userId: 'u1', workspaceId: 'w1', pageId: 'p1' })
    expect(favUpsert).toHaveBeenCalledWith({
      where: { userId_pageId: { userId: 'u1', pageId: 'p1' } },
      create: { userId: 'u1', pageId: 'p1', position: 5 },
      update: {},
    })
  })

  it('add rejects a page from another workspace', async () => {
    pageFindUnique.mockResolvedValue({ workspaceId: 'w-other' })
    await expect(svc.add({ userId: 'u1', workspaceId: 'w1', pageId: 'p1' })).rejects.toBeInstanceOf(PageNotFoundError)
  })

  it('remove deletes the favorite', async () => {
    favDeleteMany.mockResolvedValue({ count: 1 })
    const out = await svc.remove({ userId: 'u1', pageId: 'p1' })
    expect(out.count).toBe(1)
    expect(favDeleteMany).toHaveBeenCalledWith({ where: { userId: 'u1', pageId: 'p1' } })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter engines test -- favorite.service`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement `FavoriteService`**

Create `apps/engines/src/apps/mcp/services/favorite.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { PageNotFoundError } from '../errors/mcp.errors.js'

export type ListFavoritesInput = { userId: string; workspaceId?: string }
export type AddFavoriteInput = { userId: string; workspaceId: string; pageId: string }
export type RemoveFavoriteInput = { userId: string; pageId: string }

@Injectable()
export class FavoriteService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async list(input: ListFavoritesInput) {
    const rows = await this.prisma.favoritePage.findMany({
      where: { userId: input.userId, ...(input.workspaceId ? { page: { workspaceId: input.workspaceId } } : {}) },
      select: { page: { select: { id: true, title: true, type: true, icon: true, workspaceId: true } } },
      orderBy: { position: 'asc' },
      take: 200,
    })
    return rows.map((r) => ({
      pageId: r.page.id,
      title: r.page.title,
      type: r.page.type,
      icon: r.page.icon,
      workspaceId: r.page.workspaceId,
    }))
  }

  async add(input: AddFavoriteInput): Promise<{ ok: true }> {
    const page = await this.prisma.page.findUnique({
      where: { id: input.pageId },
      select: { workspaceId: true },
    })
    if (!page || page.workspaceId !== input.workspaceId) throw new PageNotFoundError(input.pageId)
    const agg = await this.prisma.favoritePage.aggregate({
      where: { userId: input.userId },
      _max: { position: true },
    })
    const position = (agg._max.position ?? 0) + 1
    await this.prisma.favoritePage.upsert({
      where: { userId_pageId: { userId: input.userId, pageId: input.pageId } },
      create: { userId: input.userId, pageId: input.pageId, position },
      update: {},
    })
    return { ok: true }
  }

  async remove(input: RemoveFavoriteInput): Promise<{ count: number }> {
    const result = await this.prisma.favoritePage.deleteMany({
      where: { userId: input.userId, pageId: input.pageId },
    })
    return { count: result.count }
  }
}
```

- [ ] **Step 4: Run service test to verify it passes**

Run: `pnpm --filter engines test -- favorite.service`
Expected: PASS.

- [ ] **Step 5: Write the failing tools test**

Create `apps/engines/src/apps/mcp/tools/favorite.tools.spec.ts`:

```ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { ForbiddenException } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'

import type { AuthedRequest } from '../../api/auth/auth-context.js'
import type { FavoriteService } from '../services/favorite.service.js'
import { FavoriteTools } from './favorite.tools.js'

describe('FavoriteTools', () => {
  const findUnique = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const prisma = { workspaceMember: { findUnique } } as unknown as PrismaClient
  const service = { list: jest.fn(), add: jest.fn(), remove: jest.fn() } as unknown as FavoriteService
  const req = { headers: {}, auth: { userId: 'u1', source: 'api-key' as const } } as AuthedRequest
  let tools: FavoriteTools

  beforeEach(() => {
    jest.clearAllMocks()
    findUnique.mockResolvedValue({ workspaceId: 'w1' })
    tools = new FavoriteTools(prisma, service)
  })

  it('listFavorites forwards', async () => {
    ;(service.list as jest.Mock).mockResolvedValue([])
    const out = await tools.listFavorites({}, {} as never, req)
    expect(out).toEqual({ favorites: [] })
    expect(service.list).toHaveBeenCalledWith({ userId: 'u1', workspaceId: undefined })
  })

  it('addFavorite checks membership then adds', async () => {
    ;(service.add as jest.Mock).mockResolvedValue({ ok: true })
    const out = await tools.addFavorite({ workspaceId: 'w1', pageId: 'p1' }, {} as never, req)
    expect(out).toEqual({ ok: true })
    expect(service.add).toHaveBeenCalledWith({ userId: 'u1', workspaceId: 'w1', pageId: 'p1' })
  })

  it('addFavorite rejects a non-member', async () => {
    findUnique.mockResolvedValue(null)
    await expect(
      tools.addFavorite({ workspaceId: 'w1', pageId: 'p1' }, {} as never, req),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('removeFavorite forwards by pageId', async () => {
    ;(service.remove as jest.Mock).mockResolvedValue({ count: 1 })
    const out = await tools.removeFavorite({ pageId: 'p1' }, {} as never, req)
    expect(out).toEqual({ count: 1 })
    expect(service.remove).toHaveBeenCalledWith({ userId: 'u1', pageId: 'p1' })
  })
})
```

- [ ] **Step 6: Implement `FavoriteTools`**

Create `apps/engines/src/apps/mcp/tools/favorite.tools.ts`:

```ts
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import type { Context } from '@rekog/mcp-nest'
import { Tool } from '@rekog/mcp-nest'
import type { PrismaClient } from '@repo/db'
import { z } from 'zod'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { assertMember } from '../../api/auth/membership.js'
import type { AuthContext, AuthedRequest } from '../../api/auth/auth-context.js'
import { FavoriteService } from '../services/favorite.service.js'
import { mcpInput, mcpUuid } from '../utils/mcp-input.js'

const ListFavoritesInput = z.object({
  workspaceId: mcpInput(z.string().uuid().optional()),
})
const AddFavoriteInput = z.object({
  workspaceId: z.string().uuid(),
  pageId: mcpUuid(),
})
const RemoveFavoriteInput = z.object({
  pageId: mcpUuid(),
})

type ListFavoritesArgs = z.infer<typeof ListFavoritesInput>
type AddFavoriteArgs = z.infer<typeof AddFavoriteInput>
type RemoveFavoriteArgs = z.infer<typeof RemoveFavoriteInput>

function requireAuth(req: AuthedRequest | undefined): AuthContext {
  if (!req?.auth) throw new UnauthorizedException('Unauthenticated MCP request')
  return req.auth
}

@Injectable()
export class FavoriteTools {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly favorites: FavoriteService,
  ) {}

  @Tool({
    name: 'listFavorites',
    description:
      'Список избранных страниц пользователя (по всем пространствам или по одному, ' +
      'если задан workspaceId). Возвращает pageId, title, type, icon, workspaceId. ' +
      'Параметр: workspaceId (опц.).',
    parameters: ListFavoritesInput,
  })
  listFavorites(args: ListFavoritesArgs, _context: Context, req: AuthedRequest) {
    const auth = requireAuth(req)
    return this.favorites
      .list({ userId: auth.userId, workspaceId: args.workspaceId ?? undefined })
      .then((favorites) => ({ favorites }))
  }

  @Tool({
    name: 'addFavorite',
    description: 'Добавляет страницу в избранное. Параметры: workspaceId, pageId.',
    parameters: AddFavoriteInput,
  })
  addFavorite(args: AddFavoriteArgs, _context: Context, req: AuthedRequest) {
    return this.doAddFavorite(requireAuth(req), args)
  }

  async doAddFavorite(auth: AuthContext, args: AddFavoriteArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    return this.favorites.add({ userId: auth.userId, workspaceId: args.workspaceId, pageId: args.pageId })
  }

  @Tool({
    name: 'removeFavorite',
    description: 'Убирает страницу из избранного. Параметр: pageId.',
    parameters: RemoveFavoriteInput,
  })
  removeFavorite(args: RemoveFavoriteArgs, _context: Context, req: AuthedRequest) {
    const auth = requireAuth(req)
    return this.favorites.remove({ userId: auth.userId, pageId: args.pageId })
  }
}
```

- [ ] **Step 7: Wire into `mcp.module.ts`**

Add imports for `FavoriteService` and `FavoriteTools`; add both to `providers`; add `FavoriteTools` to `exports`.

- [ ] **Step 8: Add registry entries in agents**

Add scope constants:
```python
SCOPE_FAVORITES_READ = 'favorites:read'
SCOPE_FAVORITES_WRITE = 'favorites:write'
```
Add inside `DEFAULT_ENGINES_TOOLS`:
```python
    'listFavorites':  ToolMeta('listFavorites', SCOPE_FAVORITES_READ, False,
                                _summary_generic('listFavorites'), _preview_default),
    'addFavorite':    ToolMeta('addFavorite', SCOPE_FAVORITES_WRITE, False,
                                _summary_generic('addFavorite'), _preview_default),
    'removeFavorite': ToolMeta('removeFavorite', SCOPE_FAVORITES_WRITE, False,
                                _summary_generic('removeFavorite'), _preview_default),
```

- [ ] **Step 9: Run tests + type check, then commit**

Run: `pnpm --filter engines test -- favorite && pnpm --filter engines check-types`
Expected: PASS.

```bash
git add apps/engines/src/apps/mcp/services/favorite.service.ts apps/engines/src/apps/mcp/services/favorite.service.spec.ts apps/engines/src/apps/mcp/tools/favorite.tools.ts apps/engines/src/apps/mcp/tools/favorite.tools.spec.ts apps/engines/src/apps/mcp/mcp.module.ts apps/agents/agents/apps/agent/services/tool_registry.py
git commit -m "feat(mcp): add favorites list/add/remove tools"
```

## Phase 6 — Page navigation & editing (engines)

All three tasks add methods to the existing `PageTools` ([page.tools.ts](apps/engines/src/apps/mcp/tools/page.tools.ts)) and (for append/archive) `PageWriter` ([page-writer.service.ts](apps/engines/src/apps/mcp/services/page-writer.service.ts)). `PageTools` already injects `prisma`, `writer`, `renderer`, `parser`, `stats`.

### Task 12: `listPages` — browse the page tree

**Files:**
- Modify: `apps/engines/src/apps/mcp/tools/page.tools.ts`
- Create: `apps/engines/src/apps/mcp/tools/page-listpages.spec.ts`
- Modify: `apps/agents/agents/apps/agent/services/tool_registry.py`

- [ ] **Step 1: Write the failing test**

Create `apps/engines/src/apps/mcp/tools/page-listpages.spec.ts`:

```ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { ForbiddenException } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'

import type { AuthedRequest } from '../../api/auth/auth-context.js'
import type { MarkdownParser } from '../services/markdown-parser.service.js'
import type { MarkdownRenderer } from '../services/markdown-renderer.service.js'
import type { PageWriter } from '../services/page-writer.service.js'
import type { StatsService } from '../services/stats.service.js'
import { PageTools } from './page.tools.js'

describe('PageTools.listPages', () => {
  const memberFindUnique = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const pageFindMany = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const prisma = {
    workspaceMember: { findUnique: memberFindUnique },
    page: { findMany: pageFindMany },
  } as unknown as PrismaClient
  const req = { headers: {}, auth: { userId: 'u1', source: 'api-key' as const } } as AuthedRequest
  let tools: PageTools

  beforeEach(() => {
    jest.clearAllMocks()
    memberFindUnique.mockResolvedValue({ workspaceId: 'w1' })
    tools = new PageTools(prisma, {} as PageWriter, {} as MarkdownRenderer, {} as MarkdownParser, {} as StatsService)
  })

  it('returns pages filtered to roots when parentId is null', async () => {
    pageFindMany.mockResolvedValue([{ id: 'p1', title: 'Root', type: 'TEXT', icon: null, parentId: null }])
    const out = await tools.listPages({ workspaceId: 'w1', parentId: null, limit: 200 }, {} as never, req)
    expect(out.pages).toEqual([{ id: 'p1', title: 'Root', type: 'TEXT', icon: null, parentId: null }])
    expect(pageFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: 'w1', archived: false, deletedAt: null, parentId: null },
      }),
    )
  })

  it('rejects a non-member', async () => {
    memberFindUnique.mockResolvedValue(null)
    await expect(
      tools.listPages({ workspaceId: 'w1', limit: 200 }, {} as never, req),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter engines test -- page-listpages`
Expected: FAIL — `listPages` is not a function.

- [ ] **Step 3: Add `listPages` to `PageTools`**

In `apps/engines/src/apps/mcp/tools/page.tools.ts`, add the input schema near the other schemas (after `PageIdInput`):

```ts
const ListPagesInput = z.object({
  workspaceId: z.string().uuid(),
  parentId: mcpNullableUuidOptional(),
  type: mcpInput(
    z.enum(['TEXT', 'EXCALIDRAW', 'GENOGRAM', 'MERMAID', 'PLANTUML', 'LIKEC4', 'DRAWIO', 'DATABASE', 'KANBAN', 'FORM']).optional(),
  ),
  query: mcpInput(z.string().max(200).optional()),
  limit: mcpInput(z.number().int().positive().max(500).default(200)),
})
type ListPagesArgs = z.infer<typeof ListPagesInput>
```

Add this method inside the `PageTools` class:

```ts
  @Tool({
    name: 'listPages',
    description:
      'Список страниц рабочего пространства (дерево). Используй чтобы осмотреть ' +
      'структуру и предложить родителя для новой страницы, или найти страницу по ' +
      'части названия. parentId: null — только корневые, uuid — дети узла, опустить — все. ' +
      'Возвращает id, title, type, icon, parentId. Параметры: workspaceId, parentId?, ' +
      'type?, query?, limit (def 200).',
    parameters: ListPagesInput,
  })
  listPages(args: ListPagesArgs, _context: Context, req: AuthedRequest) {
    return this.doListPages(requireAuth(req), args)
  }

  async doListPages(auth: AuthContext, args: ListPagesArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    const pages = await this.prisma.page.findMany({
      where: {
        workspaceId: args.workspaceId,
        archived: false,
        deletedAt: null,
        ...(args.parentId !== undefined ? { parentId: args.parentId } : {}),
        ...(args.type ? { type: args.type } : {}),
        ...(args.query ? { title: { contains: args.query, mode: 'insensitive' } } : {}),
      },
      select: { id: true, title: true, type: true, icon: true, parentId: true },
      orderBy: { createdAt: 'asc' },
      take: args.limit,
    })
    return { pages }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter engines test -- page-listpages`
Expected: PASS.

- [ ] **Step 5: Add registry entry in agents**

In `apps/agents/agents/apps/agent/services/tool_registry.py`, add inside `DEFAULT_ENGINES_TOOLS`:
```python
    'listPages': ToolMeta('listPages', SCOPE_PAGES_READ, False,
                           _summary_generic('listPages'), _preview_default),
```

- [ ] **Step 6: Commit**

```bash
git add apps/engines/src/apps/mcp/tools/page.tools.ts apps/engines/src/apps/mcp/tools/page-listpages.spec.ts apps/agents/agents/apps/agent/services/tool_registry.py
git commit -m "feat(mcp): add listPages tree-browse tool"
```

### Task 13: `appendToPage` — append markdown to a TEXT page

**Files:**
- Modify: `apps/engines/src/apps/mcp/services/page-writer.service.ts`
- Test: `apps/engines/src/apps/mcp/services/page-writer-append.spec.ts` (create)
- Modify: `apps/engines/src/apps/mcp/tools/page.tools.ts`
- Test: `apps/engines/src/apps/mcp/tools/page-append.spec.ts` (create)
- Modify: `apps/agents/agents/apps/agent/services/tool_registry.py`

- [ ] **Step 1: Write the failing PageWriter test**

Create `apps/engines/src/apps/mcp/services/page-writer-append.spec.ts`:

```ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'

import { PageNotFoundError } from '../errors/mcp.errors.js'
import { PageWriter } from './page-writer.service.js'

function makePrisma(page: unknown) {
  const update = jest.fn<(...a: unknown[]) => Promise<unknown>>().mockResolvedValue({})
  const outbox = jest.fn<(...a: unknown[]) => Promise<unknown>>().mockResolvedValue({})
  const findUnique = jest.fn<(...a: unknown[]) => Promise<unknown>>().mockResolvedValue(page)
  const tx = { page: { findUnique, update }, outboxEvent: { create: outbox } }
  const prisma = { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } as unknown as PrismaClient
  return { prisma, update, outbox }
}

describe('PageWriter.appendContent', () => {
  beforeEach(() => jest.clearAllMocks())

  it('appends nodes to an existing TEXT doc and rewrites content', async () => {
    const current = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }] }
    const appended = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'second' }] }] }
    const { prisma, update } = makePrisma({ id: 'p1', workspaceId: 'w1', type: 'TEXT', content: current })
    const writer = new PageWriter(prisma)

    await writer.appendContent({ userId: 'u1', workspaceId: 'w1', pageId: 'p1', appended })

    const data = (update.mock.calls[0]![0] as { data: { content: typeof current } }).data
    expect(data.content.content).toHaveLength(2)
  })

  it('throws PageNotFoundError for a page in another workspace', async () => {
    const { prisma } = makePrisma({ id: 'p1', workspaceId: 'w-other', type: 'TEXT', content: null })
    const writer = new PageWriter(prisma)
    await expect(
      writer.appendContent({ userId: 'u1', workspaceId: 'w1', pageId: 'p1', appended: { type: 'doc', content: [] } }),
    ).rejects.toBeInstanceOf(PageNotFoundError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter engines test -- page-writer-append`
Expected: FAIL — `appendContent` is not a function.

- [ ] **Step 3: Add `appendContent` to `PageWriter`**

In `apps/engines/src/apps/mcp/services/page-writer.service.ts`, change the `@nestjs/common` import to include `BadRequestException`:
```ts
import { BadRequestException, Inject, Injectable } from '@nestjs/common'
```
Add this type near the other input types:
```ts
type TiptapDoc = { type: 'doc'; content?: unknown[] }
export type AppendContentInput = {
  userId: string
  workspaceId: string
  pageId: string
  appended: unknown
}
```
Add this method inside the `PageWriter` class:
```ts
  async appendContent(input: AppendContentInput): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const page = await tx.page.findUnique({
        where: { id: input.pageId },
        select: { id: true, workspaceId: true, type: true, content: true },
      })
      if (!page || page.workspaceId !== input.workspaceId) throw new PageNotFoundError(input.pageId)
      if (page.type !== 'TEXT') throw new BadRequestException('appendToPage supports only TEXT pages')
      const current = (page.content as TiptapDoc | null) ?? { type: 'doc', content: [] }
      const appendedDoc = input.appended as TiptapDoc
      const merged: TiptapDoc = {
        type: 'doc',
        content: [...(current.content ?? []), ...(appendedDoc.content ?? [])],
      }
      await tx.page.update({
        where: { id: input.pageId },
        data: { content: merged as never, contentYjs: buildContentYjs(merged), updatedById: input.userId },
      })
      await tx.outboxEvent.create({
        data: { eventType: 'page.upserted', aggregateType: 'page', aggregateId: input.pageId, workspaceId: input.workspaceId, payload: {} },
      })
    })
  }
```

- [ ] **Step 4: Run PageWriter test to verify it passes**

Run: `pnpm --filter engines test -- page-writer-append`
Expected: PASS.

- [ ] **Step 5: Write the failing PageTools test**

Create `apps/engines/src/apps/mcp/tools/page-append.spec.ts`:

```ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'

import type { AuthedRequest } from '../../api/auth/auth-context.js'
import type { MarkdownParser } from '../services/markdown-parser.service.js'
import type { MarkdownRenderer } from '../services/markdown-renderer.service.js'
import type { PageWriter } from '../services/page-writer.service.js'
import type { StatsService } from '../services/stats.service.js'
import { PageTools } from './page.tools.js'

describe('PageTools.appendToPage', () => {
  const memberFindUnique = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const prisma = { workspaceMember: { findUnique: memberFindUnique } } as unknown as PrismaClient
  const parse = jest.fn<(md: string) => unknown>()
  const appendContent = jest.fn<(...a: unknown[]) => Promise<void>>()
  const parser = { parse } as unknown as MarkdownParser
  const writer = { appendContent } as unknown as PageWriter
  const req = { headers: {}, auth: { userId: 'u1', source: 'api-key' as const } } as AuthedRequest
  let tools: PageTools

  beforeEach(() => {
    jest.clearAllMocks()
    memberFindUnique.mockResolvedValue({ workspaceId: 'w1' })
    tools = new PageTools(prisma, writer, {} as MarkdownRenderer, parser, {} as StatsService)
  })

  it('parses markdown and forwards to PageWriter.appendContent', async () => {
    const parsed = { type: 'doc', content: [{ type: 'paragraph' }] }
    parse.mockReturnValue(parsed)
    appendContent.mockResolvedValue()
    const out = await tools.appendToPage({ workspaceId: 'w1', pageId: 'p1', markdown: '## note' }, {} as never, req)
    expect(out).toEqual({ ok: true })
    expect(parse).toHaveBeenCalledWith('## note')
    expect(appendContent).toHaveBeenCalledWith({ userId: 'u1', workspaceId: 'w1', pageId: 'p1', appended: parsed })
  })
})
```

- [ ] **Step 6: Add `appendToPage` to `PageTools`**

In `apps/engines/src/apps/mcp/tools/page.tools.ts`, add the schema near the others:
```ts
const AppendToPageInput = z.object({
  workspaceId: z.string().uuid(),
  pageId: mcpUuid(),
  markdown: z.string().min(1).max(50_000),
})
type AppendToPageArgs = z.infer<typeof AppendToPageInput>
```
Add this method inside the `PageTools` class:
```ts
  @Tool({
    name: 'appendToPage',
    description:
      'Дописывает Markdown в КОНЕЦ существующей TEXT-страницы (не перезаписывает). ' +
      'Используй для мелких правок/дополнений ("добавь раздел", "допиши итоги"). ' +
      'Требует подтверждения. Параметры: workspaceId, pageId, markdown (1-50000).',
    parameters: AppendToPageInput,
  })
  appendToPage(args: AppendToPageArgs, _context: Context, req: AuthedRequest) {
    return this.doAppendToPage(requireAuth(req), args)
  }

  async doAppendToPage(auth: AuthContext, args: AppendToPageArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    const appended = this.parser.parse(args.markdown)
    await this.writer.appendContent({
      userId: auth.userId,
      workspaceId: args.workspaceId,
      pageId: args.pageId,
      appended,
    })
    return { ok: true as const }
  }
```

- [ ] **Step 7: Add registry entry, run tests, commit**

In `tool_registry.py` add inside `DEFAULT_ENGINES_TOOLS`:
```python
    'appendToPage': ToolMeta('appendToPage', SCOPE_PAGES_WRITE, True,
                              lambda a: f'Дописать в страницу {a.get("pageId")}', _preview_default),
```
Run: `pnpm --filter engines test -- page-writer-append page-append && pnpm --filter engines check-types`
Expected: PASS.
```bash
git add apps/engines/src/apps/mcp/services/page-writer.service.ts apps/engines/src/apps/mcp/services/page-writer-append.spec.ts apps/engines/src/apps/mcp/tools/page.tools.ts apps/engines/src/apps/mcp/tools/page-append.spec.ts apps/agents/agents/apps/agent/services/tool_registry.py
git commit -m "feat(mcp): add appendToPage (markdown append to TEXT pages)"
```

### Task 14: `archivePage` / `restorePage`

**Files:**
- Modify: `apps/engines/src/apps/mcp/services/page-writer.service.ts`
- Test: `apps/engines/src/apps/mcp/services/page-writer-archive.spec.ts` (create)
- Modify: `apps/engines/src/apps/mcp/tools/page.tools.ts`
- Test: `apps/engines/src/apps/mcp/tools/page-archive.spec.ts` (create)
- Modify: `apps/agents/agents/apps/agent/services/tool_registry.py`

- [ ] **Step 1: Write the failing PageWriter test**

Create `apps/engines/src/apps/mcp/services/page-writer-archive.spec.ts`:

```ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'

import { PageNotFoundError } from '../errors/mcp.errors.js'
import { PageWriter } from './page-writer.service.js'

function makePrisma(page: unknown) {
  const update = jest.fn<(...a: unknown[]) => Promise<unknown>>().mockResolvedValue({})
  const outbox = jest.fn<(...a: unknown[]) => Promise<unknown>>().mockResolvedValue({})
  const findUnique = jest.fn<(...a: unknown[]) => Promise<unknown>>().mockResolvedValue(page)
  const tx = { page: { findUnique, update }, outboxEvent: { create: outbox } }
  const prisma = { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } as unknown as PrismaClient
  return { prisma, update }
}

describe('PageWriter.setArchived', () => {
  beforeEach(() => jest.clearAllMocks())

  it('sets archived true', async () => {
    const { prisma, update } = makePrisma({ id: 'p1', workspaceId: 'w1' })
    await new PageWriter(prisma).setArchived({ userId: 'u1', workspaceId: 'w1', pageId: 'p1', archived: true })
    expect(update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { archived: true, updatedById: 'u1' },
    })
  })

  it('throws for a page in another workspace', async () => {
    const { prisma } = makePrisma({ id: 'p1', workspaceId: 'w-other' })
    await expect(
      new PageWriter(prisma).setArchived({ userId: 'u1', workspaceId: 'w1', pageId: 'p1', archived: false }),
    ).rejects.toBeInstanceOf(PageNotFoundError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter engines test -- page-writer-archive`
Expected: FAIL — `setArchived` is not a function.

- [ ] **Step 3: Add `setArchived` to `PageWriter`**

Add inside the `PageWriter` class:
```ts
  async setArchived(input: {
    userId: string
    workspaceId: string
    pageId: string
    archived: boolean
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const page = await tx.page.findUnique({
        where: { id: input.pageId },
        select: { id: true, workspaceId: true },
      })
      if (!page || page.workspaceId !== input.workspaceId) throw new PageNotFoundError(input.pageId)
      await tx.page.update({
        where: { id: input.pageId },
        data: { archived: input.archived, updatedById: input.userId },
      })
      await tx.outboxEvent.create({
        data: { eventType: 'page.upserted', aggregateType: 'page', aggregateId: input.pageId, workspaceId: input.workspaceId, payload: {} },
      })
    })
  }
```

- [ ] **Step 4: Run PageWriter test; then write the failing PageTools test**

Run: `pnpm --filter engines test -- page-writer-archive` → PASS.

Create `apps/engines/src/apps/mcp/tools/page-archive.spec.ts`:

```ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'

import type { AuthedRequest } from '../../api/auth/auth-context.js'
import type { MarkdownParser } from '../services/markdown-parser.service.js'
import type { MarkdownRenderer } from '../services/markdown-renderer.service.js'
import type { PageWriter } from '../services/page-writer.service.js'
import type { StatsService } from '../services/stats.service.js'
import { PageTools } from './page.tools.js'

describe('PageTools archive/restore', () => {
  const memberFindUnique = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const prisma = { workspaceMember: { findUnique: memberFindUnique } } as unknown as PrismaClient
  const setArchived = jest.fn<(...a: unknown[]) => Promise<void>>()
  const writer = { setArchived } as unknown as PageWriter
  const req = { headers: {}, auth: { userId: 'u1', source: 'api-key' as const } } as AuthedRequest
  let tools: PageTools

  beforeEach(() => {
    jest.clearAllMocks()
    memberFindUnique.mockResolvedValue({ workspaceId: 'w1' })
    setArchived.mockResolvedValue()
    tools = new PageTools(prisma, writer, {} as MarkdownRenderer, {} as MarkdownParser, {} as StatsService)
  })

  it('archivePage sets archived=true', async () => {
    await tools.archivePage({ workspaceId: 'w1', pageId: 'p1' }, {} as never, req)
    expect(setArchived).toHaveBeenCalledWith({ userId: 'u1', workspaceId: 'w1', pageId: 'p1', archived: true })
  })

  it('restorePage sets archived=false', async () => {
    await tools.restorePage({ workspaceId: 'w1', pageId: 'p1' }, {} as never, req)
    expect(setArchived).toHaveBeenCalledWith({ userId: 'u1', workspaceId: 'w1', pageId: 'p1', archived: false })
  })
})
```

- [ ] **Step 5: Add `archivePage`/`restorePage` to `PageTools`**

These reuse the existing `PageIdInput`/`PageIdArgs` (`{ workspaceId, pageId }`). Add inside the `PageTools` class:
```ts
  @Tool({
    name: 'archivePage',
    description: 'Архивирует страницу (убирает из дерева и поиска). Требует подтверждения. Параметры: workspaceId, pageId.',
    parameters: PageIdInput,
  })
  archivePage(args: PageIdArgs, _context: Context, req: AuthedRequest) {
    return this.doSetArchived(requireAuth(req), args, true)
  }

  @Tool({
    name: 'restorePage',
    description: 'Восстанавливает архивированную страницу. Требует подтверждения. Параметры: workspaceId, pageId.',
    parameters: PageIdInput,
  })
  restorePage(args: PageIdArgs, _context: Context, req: AuthedRequest) {
    return this.doSetArchived(requireAuth(req), args, false)
  }

  async doSetArchived(auth: AuthContext, args: PageIdArgs, archived: boolean) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    await this.writer.setArchived({ userId: auth.userId, workspaceId: args.workspaceId, pageId: args.pageId, archived })
    return { ok: true as const }
  }
```

- [ ] **Step 6: Add registry entries, run tests, commit**

In `tool_registry.py` add inside `DEFAULT_ENGINES_TOOLS`:
```python
    'archivePage': ToolMeta('archivePage', SCOPE_PAGES_WRITE, True,
                             lambda a: f'Архивировать страницу {a.get("pageId")}', _preview_default),
    'restorePage': ToolMeta('restorePage', SCOPE_PAGES_WRITE, True,
                             lambda a: f'Восстановить страницу {a.get("pageId")}', _preview_default),
```
Run: `pnpm --filter engines test -- page-writer-archive page-archive && pnpm --filter engines check-types`
Expected: PASS.
```bash
git add apps/engines/src/apps/mcp/services/page-writer.service.ts apps/engines/src/apps/mcp/services/page-writer-archive.spec.ts apps/engines/src/apps/mcp/tools/page.tools.ts apps/engines/src/apps/mcp/tools/page-archive.spec.ts apps/agents/agents/apps/agent/services/tool_registry.py
git commit -m "feat(mcp): add archivePage/restorePage tools"
```

---

## Phase 7 — Diagram pages (engines)

> Scope note vs spec: validation is **structural** for all three kinds (no heavy parser deps in the engines runtime — `@likec4/language-services` is browser-oriented and resolves even on invalid input, and Mermaid's parser needs a DOM). Structural checks catch the common LLM failures (empty / wrong-language / missing markers) and return a hint for retry. Deeper per-kind validation (LikeC4 `hasErrors()`, Mermaid parser, PlantUML server render) is a documented follow-up.

### Task 15: `DiagramValidatorService` + `DiagramValidationError`

**Files:**
- Modify: `apps/engines/src/apps/mcp/errors/mcp.errors.ts`
- Create: `apps/engines/src/apps/mcp/services/diagram-validator.service.ts`
- Test: `apps/engines/src/apps/mcp/services/diagram-validator.service.spec.ts`

- [ ] **Step 1: Add the error class**

In `apps/engines/src/apps/mcp/errors/mcp.errors.ts`, append:
```ts
export class DiagramValidationError extends HttpException {
  constructor(kind: string, messages: string[]) {
    super(
      { code: 'DIAGRAM_VALIDATION_FAILED', message: `DIAGRAM_VALIDATION_FAILED (${kind}): ${messages.join('; ')}`, errors: messages },
      422,
    )
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `apps/engines/src/apps/mcp/services/diagram-validator.service.spec.ts`:

```ts
import { describe, it, expect } from '@jest/globals'

import { DiagramValidationError } from '../errors/mcp.errors.js'
import { DiagramValidatorService } from './diagram-validator.service.js'

describe('DiagramValidatorService.validate', () => {
  const svc = new DiagramValidatorService()

  it('accepts valid mermaid', () => {
    expect(() => svc.validate('MERMAID', 'graph TD; A-->B')).not.toThrow()
  })

  it('rejects mermaid without a known diagram keyword', () => {
    expect(() => svc.validate('MERMAID', 'hello world')).toThrow(DiagramValidationError)
  })

  it('accepts balanced plantuml', () => {
    expect(() => svc.validate('PLANTUML', '@startuml\nA -> B\n@enduml')).not.toThrow()
  })

  it('rejects plantuml without matching @start/@end', () => {
    expect(() => svc.validate('PLANTUML', '@startuml\nA -> B')).toThrow(DiagramValidationError)
  })

  it('accepts likec4 with a known block', () => {
    expect(() => svc.validate('LIKEC4', 'specification { element system }')).not.toThrow()
  })

  it('rejects empty source', () => {
    expect(() => svc.validate('LIKEC4', '   ')).toThrow(DiagramValidationError)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter engines test -- diagram-validator`
Expected: FAIL — cannot find module.

- [ ] **Step 4: Implement the validator**

Create `apps/engines/src/apps/mcp/services/diagram-validator.service.ts`:

```ts
import { Injectable } from '@nestjs/common'

import { DiagramValidationError } from '../errors/mcp.errors.js'

export type DiagramKind = 'MERMAID' | 'PLANTUML' | 'LIKEC4'

const MERMAID_KEYWORD =
  /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|gantt|pie|mindmap|journey|gitGraph|quadrantChart|timeline|sankey(-beta)?|xychart(-beta)?|block(-beta)?|requirementDiagram|c4context)\b/i

@Injectable()
export class DiagramValidatorService {
  validate(kind: DiagramKind, source: string): void {
    const trimmed = source.trim()
    if (!trimmed) throw new DiagramValidationError(kind, ['source is empty'])

    if (kind === 'MERMAID') {
      const firstLine = trimmed.split('\n')[0]?.trim() ?? ''
      if (!MERMAID_KEYWORD.test(firstLine)) {
        throw new DiagramValidationError(kind, [
          'first line must declare a Mermaid diagram type (e.g. "graph TD", "sequenceDiagram", "classDiagram")',
        ])
      }
      return
    }

    if (kind === 'PLANTUML') {
      const starts = (trimmed.match(/@start\w+/g) ?? []).length
      const ends = (trimmed.match(/@end\w+/g) ?? []).length
      if (starts === 0 || ends === 0) {
        throw new DiagramValidationError(kind, ['must contain a @start.../@end... block (e.g. @startuml ... @enduml)'])
      }
      if (starts !== ends) {
        throw new DiagramValidationError(kind, [`unbalanced @start (${starts}) and @end (${ends}) markers`])
      }
      return
    }

    // LIKEC4
    if (!/\b(specification|model|views)\b/.test(trimmed)) {
      throw new DiagramValidationError(kind, ['must contain at least one of: specification, model, views block'])
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter engines test -- diagram-validator`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/engines/src/apps/mcp/errors/mcp.errors.ts apps/engines/src/apps/mcp/services/diagram-validator.service.ts apps/engines/src/apps/mcp/services/diagram-validator.service.spec.ts
git commit -m "feat(mcp): add DiagramValidatorService (structural validation)"
```

### Task 16: `PageWriter.createDiagramPage` + `updateDiagramSource` (Yjs seeding)

**Files:**
- Modify: `apps/engines/src/apps/mcp/services/page-writer.service.ts`
- Test: `apps/engines/src/apps/mcp/services/page-writer-diagram.spec.ts` (create)

- [ ] **Step 1: Write the failing test (decodes the seeded Y.Text)**

Create `apps/engines/src/apps/mcp/services/page-writer-diagram.spec.ts`:

```ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'
import * as Y from 'yjs'

import { PageWriter } from './page-writer.service.js'

describe('PageWriter.createDiagramPage', () => {
  beforeEach(() => jest.clearAllMocks())

  it('creates a MERMAID page whose contentYjs decodes to the source under the "mermaid" Y.Text', async () => {
    const create = jest.fn<(...a: unknown[]) => Promise<unknown>>().mockResolvedValue({ id: 'p1' })
    const outbox = jest.fn<(...a: unknown[]) => Promise<unknown>>().mockResolvedValue({})
    const findUnique = jest.fn<(...a: unknown[]) => Promise<unknown>>()
    const tx = { page: { create, findUnique }, outboxEvent: { create: outbox } }
    const prisma = { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } as unknown as PrismaClient

    const id = await new PageWriter(prisma).createDiagramPage({
      userId: 'u1', workspaceId: 'w1', title: 'D', kind: 'MERMAID', source: 'graph TD; A-->B',
    })

    expect(id).toBe('p1')
    const data = (create.mock.calls[0]![0] as { data: { type: string; contentYjs: Uint8Array } }).data
    expect(data.type).toBe('MERMAID')
    const ydoc = new Y.Doc()
    Y.applyUpdate(ydoc, data.contentYjs)
    expect(ydoc.getText('mermaid').toString()).toBe('graph TD; A-->B')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter engines test -- page-writer-diagram`
Expected: FAIL — `createDiagramPage` is not a function.

- [ ] **Step 3: Add diagram methods to `PageWriter`**

In `apps/engines/src/apps/mcp/services/page-writer.service.ts`, add near `buildContentYjs` (bottom of file):
```ts
const DIAGRAM_DOC_NAME = { MERMAID: 'mermaid', PLANTUML: 'plantuml', LIKEC4: 'likec4' } as const
export type DiagramPageKind = keyof typeof DIAGRAM_DOC_NAME

function buildDiagramContentYjs(source: string, docName: string): Uint8Array<ArrayBuffer> {
  const ydoc = new Y.Doc()
  ydoc.getText(docName).insert(0, source)
  const src = Y.encodeStateAsUpdate(ydoc)
  const out = new Uint8Array(new ArrayBuffer(src.byteLength))
  out.set(src)
  return out
}
```
Add these methods inside the `PageWriter` class:
```ts
  async createDiagramPage(input: {
    userId: string
    workspaceId: string
    parentId?: string | null
    title: string
    kind: DiagramPageKind
    source: string
  }): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      await this.ensureParent(tx, input.parentId, input.workspaceId)
      const page = await tx.page.create({
        data: {
          workspaceId: input.workspaceId,
          parentId: input.parentId ?? null,
          title: input.title,
          ownership: 'TEXT',
          type: input.kind,
          contentYjs: buildDiagramContentYjs(input.source, DIAGRAM_DOC_NAME[input.kind]),
          createdById: input.userId,
          updatedById: input.userId,
        },
        select: { id: true },
      })
      await tx.outboxEvent.create({
        data: { eventType: 'page.upserted', aggregateType: 'page', aggregateId: page.id, workspaceId: input.workspaceId, payload: {} },
      })
      return page.id
    })
  }

  async updateDiagramSource(input: {
    userId: string
    workspaceId: string
    pageId: string
    source: string
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const page = await tx.page.findUnique({
        where: { id: input.pageId },
        select: { id: true, workspaceId: true, type: true },
      })
      if (!page || page.workspaceId !== input.workspaceId) throw new PageNotFoundError(input.pageId)
      const docName = DIAGRAM_DOC_NAME[page.type as DiagramPageKind]
      if (!docName) throw new BadRequestException('Page is not a diagram page')
      await tx.page.update({
        where: { id: input.pageId },
        data: { contentYjs: buildDiagramContentYjs(input.source, docName), updatedById: input.userId },
      })
      await tx.outboxEvent.create({
        data: { eventType: 'page.upserted', aggregateType: 'page', aggregateId: input.pageId, workspaceId: input.workspaceId, payload: {} },
      })
    })
  }
```
(`BadRequestException` was already added to the import in Task 13. If executing Phase 7 before Phase 6, add it to the `@nestjs/common` import.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter engines test -- page-writer-diagram`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/engines/src/apps/mcp/services/page-writer.service.ts apps/engines/src/apps/mcp/services/page-writer-diagram.spec.ts
git commit -m "feat(mcp): seed diagram pages (mermaid/plantuml/likec4) in PageWriter"
```

### Task 17: `DiagramTools` (`createDiagramPage`, `updateDiagramSource`) + wiring

**Files:**
- Create: `apps/engines/src/apps/mcp/tools/diagram.tools.ts`
- Test: `apps/engines/src/apps/mcp/tools/diagram.tools.spec.ts`
- Modify: `apps/engines/src/apps/mcp/mcp.module.ts`
- Modify: `apps/agents/agents/apps/agent/services/tool_registry.py`

- [ ] **Step 1: Write the failing test**

Create `apps/engines/src/apps/mcp/tools/diagram.tools.spec.ts`:

```ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { ForbiddenException } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'

import type { AuthedRequest } from '../../api/auth/auth-context.js'
import { DiagramValidationError } from '../errors/mcp.errors.js'
import { DiagramValidatorService } from '../services/diagram-validator.service.js'
import type { PageWriter } from '../services/page-writer.service.js'
import { DiagramTools } from './diagram.tools.js'

describe('DiagramTools.createDiagramPage', () => {
  const memberFindUnique = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const prisma = { workspaceMember: { findUnique: memberFindUnique } } as unknown as PrismaClient
  const createDiagramPage = jest.fn<(...a: unknown[]) => Promise<string>>()
  const writer = { createDiagramPage } as unknown as PageWriter
  const validator = new DiagramValidatorService()
  const req = { headers: {}, auth: { userId: 'u1', source: 'api-key' as const } } as AuthedRequest
  let tools: DiagramTools

  beforeEach(() => {
    jest.clearAllMocks()
    memberFindUnique.mockResolvedValue({ workspaceId: 'w1' })
    tools = new DiagramTools(prisma, writer, validator)
  })

  it('validates and creates a diagram page', async () => {
    createDiagramPage.mockResolvedValue('p1')
    const out = await tools.createDiagramPage(
      { workspaceId: 'w1', kind: 'MERMAID', source: 'graph TD; A-->B', title: 'D' },
      {} as never,
      req,
    )
    expect(out).toEqual({ pageId: 'p1', url: '/workspaces/w1/pages/p1' })
  })

  it('rejects invalid source before creating', async () => {
    await expect(
      tools.createDiagramPage({ workspaceId: 'w1', kind: 'MERMAID', source: 'nope', title: 'D' }, {} as never, req),
    ).rejects.toBeInstanceOf(DiagramValidationError)
    expect(createDiagramPage).not.toHaveBeenCalled()
  })

  it('rejects a non-member', async () => {
    memberFindUnique.mockResolvedValue(null)
    await expect(
      tools.createDiagramPage({ workspaceId: 'w1', kind: 'MERMAID', source: 'graph TD; A-->B', title: 'D' }, {} as never, req),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter engines test -- diagram.tools`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement `DiagramTools`**

Create `apps/engines/src/apps/mcp/tools/diagram.tools.ts`:

```ts
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import type { Context } from '@rekog/mcp-nest'
import { Tool } from '@rekog/mcp-nest'
import type { PrismaClient } from '@repo/db'
import { z } from 'zod'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { assertMember } from '../../api/auth/membership.js'
import type { AuthContext, AuthedRequest } from '../../api/auth/auth-context.js'
import { PageNotFoundError } from '../errors/mcp.errors.js'
import { DiagramValidatorService, type DiagramKind } from '../services/diagram-validator.service.js'
import { PageWriter } from '../services/page-writer.service.js'
import { mcpInput, mcpNullableUuidOptional, mcpUuid } from '../utils/mcp-input.js'

const CreateDiagramPageInput = z.object({
  workspaceId: z.string().uuid(),
  kind: z.enum(['MERMAID', 'PLANTUML', 'LIKEC4']),
  source: z.string().min(1).max(100_000),
  title: z.string().min(1).max(255),
  parentId: mcpNullableUuidOptional(),
})
const UpdateDiagramSourceInput = z.object({
  workspaceId: z.string().uuid(),
  pageId: mcpUuid(),
  source: z.string().min(1).max(100_000),
})

type CreateDiagramPageArgs = z.infer<typeof CreateDiagramPageInput>
type UpdateDiagramSourceArgs = z.infer<typeof UpdateDiagramSourceInput>

function requireAuth(req: AuthedRequest | undefined): AuthContext {
  if (!req?.auth) throw new UnauthorizedException('Unauthenticated MCP request')
  return req.auth
}

@Injectable()
export class DiagramTools {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly writer: PageWriter,
    private readonly validator: DiagramValidatorService,
  ) {}

  @Tool({
    name: 'createDiagramPage',
    description:
      'Создаёт страницу с диаграммой выбранного типа (MERMAID, PLANTUML, LIKEC4) из ' +
      'исходного кода. Сначала валидирует синтаксис; при ошибке вернёт сообщение для ' +
      'исправления и НЕ создаст страницу. Требует подтверждения. Параметры: ' +
      'workspaceId, kind, source (код диаграммы), title, parentId (опц.).',
    parameters: CreateDiagramPageInput,
  })
  createDiagramPage(args: CreateDiagramPageArgs, _context: Context, req: AuthedRequest) {
    return this.doCreateDiagramPage(requireAuth(req), args)
  }

  async doCreateDiagramPage(auth: AuthContext, args: CreateDiagramPageArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    this.validator.validate(args.kind, args.source)
    const pageId = await this.writer.createDiagramPage({
      userId: auth.userId,
      workspaceId: args.workspaceId,
      parentId: args.parentId,
      title: args.title,
      kind: args.kind,
      source: args.source,
    })
    return { pageId, url: `/workspaces/${args.workspaceId}/pages/${pageId}` }
  }

  @Tool({
    name: 'updateDiagramSource',
    description:
      'Перезаписывает исходный код существующей диаграммной страницы (после валидации). ' +
      'Требует подтверждения. Параметры: workspaceId, pageId, source.',
    parameters: UpdateDiagramSourceInput,
  })
  updateDiagramSource(args: UpdateDiagramSourceArgs, _context: Context, req: AuthedRequest) {
    return this.doUpdateDiagramSource(requireAuth(req), args)
  }

  async doUpdateDiagramSource(auth: AuthContext, args: UpdateDiagramSourceArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    const page = await this.prisma.page.findUnique({
      where: { id: args.pageId },
      select: { workspaceId: true, type: true },
    })
    if (!page || page.workspaceId !== args.workspaceId) throw new PageNotFoundError(args.pageId)
    this.validator.validate(page.type as DiagramKind, args.source)
    await this.writer.updateDiagramSource({
      userId: auth.userId,
      workspaceId: args.workspaceId,
      pageId: args.pageId,
      source: args.source,
    })
    return { ok: true as const }
  }
}
```

- [ ] **Step 4: Wire into `mcp.module.ts`**

Add imports for `DiagramValidatorService` and `DiagramTools`; add both to `providers`; add `DiagramTools` to `exports`.

- [ ] **Step 5: Add registry entries in agents**

In `tool_registry.py` add inside `DEFAULT_ENGINES_TOOLS`:
```python
    'createDiagramPage':  ToolMeta('createDiagramPage', SCOPE_PAGES_WRITE, True,
                                    lambda a: f'Создать {a.get("kind")}-диаграмму «{_truncate(a.get("title"))}»', _preview_default),
    'updateDiagramSource': ToolMeta('updateDiagramSource', SCOPE_PAGES_WRITE, True,
                                     lambda a: f'Обновить диаграмму {a.get("pageId")}', _preview_default),
```

- [ ] **Step 6: Run tests + type check, then commit**

Run: `pnpm --filter engines test -- diagram.tools && pnpm --filter engines check-types`
Expected: PASS.
```bash
git add apps/engines/src/apps/mcp/tools/diagram.tools.ts apps/engines/src/apps/mcp/tools/diagram.tools.spec.ts apps/engines/src/apps/mcp/mcp.module.ts apps/agents/agents/apps/agent/services/tool_registry.py
git commit -m "feat(mcp): add createDiagramPage/updateDiagramSource tools"
```

---

## Phase 8 — Verification & wrap-up

### Task 18: Full gates + spec status

**Files:**
- Modify: `docs/superpowers/specs/2026-05-28-mcp-tooling-expansion-design.md`

- [ ] **Step 1: Lint + type-check + test the changed workspaces**

Run: `pnpm --filter engines lint && pnpm --filter engines check-types && pnpm --filter engines test`
Expected: PASS, `--max-warnings 0` clean.

- [ ] **Step 2: Agents lint + tests**

Run: `cd apps/agents && uv run ruff check agents && uv run pytest tests/apps -q`
Expected: PASS.

- [ ] **Step 3: Sanity-check the MCP tool list end-to-end (optional, needs infra)**

With `docker compose up -d` running, start engines (`pnpm --filter @repo/engines dev`) and POST a `tools/list` JSON-RPC request to `/mcp` with a valid `ank_` key; confirm the new tool names appear: `searchPagesByTitle`, `listWorkspaceMembers`, `createReminder`, `listReminders`, `moveReminder`, `deleteReminder`, `completeReminder`, `listNotifications`, `markNotificationsRead`, `listFavorites`, `addFavorite`, `removeFavorite`, `listPages`, `appendToPage`, `archivePage`, `restorePage`, `createDiagramPage`, `updateDiagramSource`.

- [ ] **Step 4: Full merge gate**

Run (with the repo `.env` sourced, per project setup): `pnpm gates`
Expected: PASS (check-types + lint + build + test across the monorepo).

- [ ] **Step 5: Mark the spec implemented**

In `docs/superpowers/specs/2026-05-28-mcp-tooling-expansion-design.md`, change the status line to:
```markdown
**Status:** Implemented
```

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-05-28-mcp-tooling-expansion-design.md
git commit -m "docs(mcp): mark MCP tooling expansion spec implemented"
```

---

## Self-Review

**Spec coverage:**
- Item 1 (spaces + which I'm in + stats) → Task 6 (`list_workspaces` `isCurrent`/`isDefault`) + existing `getWorkspaceStats`; member roster → Task 7. ✔
- Item 2 (reminders get/move/delete + full CRUD) → Tasks 8–9. ✔
- Item 3 (notifications unread + mark all read) → Task 10. ✔
- Item 4 (parity — close gaps: page tree, markdown append, members, archive/restore) → Tasks 6, 7, 12, 13, 14. Tags/links deferred per spec. ✔
- Item 5 (MERMAID/PLANTUML/LIKEC4 page creation + validate where cheap) → Tasks 15–17 (structural validation; deeper validation flagged as follow-up). ✔
- Item 6 (search by title + RAG) → Tasks 3, 5. ✔
- Item 7 (RAG threshold 0.7) → Task 1. ✔
- Item 9 (favorites view/add/remove) → Task 11. ✔
- Use cases: UC1 (`createPage`+`appendToPage`+`search*`), UC2 (`createPage`+`listWorkspaceMembers`+`createReminder`), UC4 (`listPages`→`createPage`). ✔ UC3 (Kanban) deferred. ✔

**Type/name consistency:** `EmbeddingPayload` (Task 2) is the type imported by the search client (Task 4) and asserted in `SearchTools` tests (Task 5). `AgentsSearchHit` shape unchanged. `PageWriter.appendContent`/`setArchived`/`createDiagramPage`/`updateDiagramSource` names match between writer tasks (13/14/16) and tool tasks (13/14/17). `DiagramKind`/`DiagramPageKind` enums match the `kind` Zod enum. `requires_confirmation` matches the spec's confirmation policy. Every new tool has a `DEFAULT_ENGINES_TOOLS` entry and `mcp.module.ts` registration step.

**Deviations from spec (intentional, flagged):**
1. `getWorkspaceStats` reminder/favorite-count extension dropped (avoids churn; counts available via `listReminders`/`listFavorites`).
2. Diagram validation is **structural**, not full-parser (engines runtime stays dependency-light; deeper validation is a follow-up).
3. `search_pages` RAG stage reuses the engines plaintext-`connection` embedding path (shared providers); encrypted custom-provider RAG via the engines MCP tool is out of scope (the agent-chat path already covers custom providers).

**Placeholder scan:** none — every code/test step contains full content; commands have expected outcomes.

## Notes for the executor

- Run from the repo root; engines tests via `pnpm --filter engines test -- <file-substring>`, agents via `cd apps/agents && uv run pytest …`.
- Phases 1–7 are largely independent and can be reordered, **except**: Task 5 depends on Tasks 2–4; Task 9 depends on Task 8; Task 13/14/16 add methods to the same `PageWriter` and `page.tools.ts` (do Phase 6 before, or in the same pass as, Phase 7 to keep the `BadRequestException` import in one place).
- Husky runs lint-staged + gates on commit; keep each commit green. Do **not** use `--no-verify`.


