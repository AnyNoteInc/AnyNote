# RAG Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ground workspace chat answers in indexed pages by retrieving relevant chunks from Qdrant in apps/engines, passing top pages as `rag.documents` to the agents service, and rendering them in the prompt.

**Architecture:** Search endpoint lives in apps/engines (owns Qdrant + Ollama). apps/web calls engines over HTTP, builds `rag.documents`, sends to apps/agents. Prompt template shows documents with id + title + content and teaches the LLM to fetch full text via `getPageMarkdown` MCP tool.

**Tech Stack:** NestJS (apps/engines), Next.js 16 App Router (apps/web), FastAPI + LangGraph + Jinja2 (apps/agents), Qdrant + Ollama (nomic-embed-text 768d), Jest + Playwright + pytest.

Spec: [docs/superpowers/specs/2026-04-22-rag-retrieval-design.md](../specs/2026-04-22-rag-retrieval-design.md)

---

## File Structure

**New files (apps/engines):**
- `apps/engines/src/apps/search/search.module.ts`
- `apps/engines/src/apps/search/search.controller.ts`
- `apps/engines/src/apps/search/search.controller.spec.ts`
- `apps/engines/src/apps/search/services/page-search.service.ts`
- `apps/engines/src/apps/search/services/page-search.service.spec.ts`
- `apps/engines/src/apps/search/dto/search.schema.ts`
- `apps/engines/src/apps/indexer/services/reindex-on-boot.service.ts`
- `apps/engines/src/apps/indexer/services/reindex-on-boot.service.spec.ts`
- `apps/engines/test/integration/search.e2e.spec.ts`

**New files (apps/web):**
- `apps/web/src/lib/chat/rag-search.ts`
- `apps/web/src/lib/chat/rag-search.test.ts`

**New files (apps/e2e):**
- `apps/e2e/rag.spec.ts`

**New files (apps/agents):**
- `apps/agents/tests/apps/chat/repositories/test_jinja_renderer.py`

**Modified files:**
- `apps/engines/src/apps/indexer/services/qdrant-writer.service.ts` — widen `QdrantPoint.payload` type
- `apps/engines/src/apps/indexer/services/qdrant-writer.service.spec.ts` — update fixture payload
- `apps/engines/src/apps/indexer/queue/indexing.processor.ts` — read extra page fields, populate new payload fields
- `apps/engines/src/apps/indexer/queue/indexing.processor.spec.ts` — assert new fields
- `apps/engines/src/apps/indexer/indexer.module.ts` — register `ReindexOnBootService`
- `apps/engines/src/app.module.ts` — register `SearchModule`
- `apps/web/src/lib/chat/agents-payload.ts` — add `rag` to builder output + types
- `apps/web/src/app/api/agents/generate/route.ts` — call `searchRagDocuments` before streaming
- `apps/agents/agents/apps/chat/templates/default.j2` — structured per-document block + MCP tool hints
- `turbo.json` — add `ENGINES_SERVICE_URL`, `INDEXER_REINDEX_ON_BOOT` to `globalEnv`

---

## Task 1: Widen `QdrantPoint.payload` type

Extend the payload shape to carry page metadata needed by RAG. No behaviour change yet — IndexingProcessor will populate the new fields in Task 2.

**Files:**
- Modify: `apps/engines/src/apps/indexer/services/qdrant-writer.service.ts`
- Test: `apps/engines/src/apps/indexer/services/qdrant-writer.service.spec.ts`

- [ ] **Step 1: Read the current writer test**

Run: `pnpm --filter=engines test qdrant-writer.service`
Expected: existing tests pass against the current shape.

- [ ] **Step 2: Update the writer test to assert the widened payload round-trips unchanged**

Edit `apps/engines/src/apps/indexer/services/qdrant-writer.service.spec.ts`. Find the existing `upsert` test and replace its point payload with:

```ts
await writer.upsert([
  {
    id: "11111111-1111-1111-1111-111111111111",
    vector: [0.1],
    payload: {
      pageId: "p1",
      workspaceId: "w1",
      chunkIndex: 0,
      title: "Hello",
      content: "normalized text",
      pageType: "TEXT",
      createdById: "u1",
      createdAt: "2026-04-22T00:00:00.000Z",
      updatedAt: "2026-04-22T00:00:00.000Z",
    },
  },
])
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter=engines test qdrant-writer.service`
Expected: TypeScript/Jest failure — `QdrantPoint.payload` does not accept the new fields.

- [ ] **Step 4: Widen the payload type**

In `apps/engines/src/apps/indexer/services/qdrant-writer.service.ts`, replace the `QdrantPoint` type:

```ts
export type QdrantPoint = {
  id: string
  vector: number[]
  payload: {
    pageId: string
    workspaceId: string
    chunkIndex: number
    title: string
    content: string
    pageType: string
    createdById: string
    createdAt: string
    updatedAt: string
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter=engines test qdrant-writer.service`
Expected: PASS.

- [ ] **Step 6: Run check-types in engines**

Run: `pnpm --filter=engines check-types`
Expected: PASS — widening is a safe change for the upsert call sites (they will fail in Task 2, which is expected).

- [ ] **Step 7: Commit**

```bash
git add apps/engines/src/apps/indexer/services/qdrant-writer.service.ts apps/engines/src/apps/indexer/services/qdrant-writer.service.spec.ts
git commit -m "feat(engines): widen Qdrant payload with title/content/pageType/createdById/createdAt/updatedAt"
```

Note: `check-types` for the IndexingProcessor call site will now fail because the processor does not yet supply the new fields. Task 2 fixes that.

---

## Task 2: Populate new payload fields in IndexingProcessor

Read the extra page columns via Prisma and fill them into every Qdrant point.

**Files:**
- Modify: `apps/engines/src/apps/indexer/queue/indexing.processor.ts`
- Test: `apps/engines/src/apps/indexer/queue/indexing.processor.spec.ts`

- [ ] **Step 1: Update the existing "processes chunks end-to-end" test to assert new payload fields**

Edit `apps/engines/src/apps/indexer/queue/indexing.processor.spec.ts`. In the `"processes chunks end-to-end when page is valid"` test (around line 69-94), change the mocked `findUnique` response to include the new fields and change the upsert assertion:

```ts
;(mockPrisma.page.findUnique as jest.Mock).mockResolvedValue({
  id: "p1",
  type: "TEXT",
  ownership: "TEXT",
  deletedAt: null,
  content: { type: "doc", content: [] },
  workspaceId: "w1",
  title: "Hello",
  createdById: "u1",
  createdAt: new Date("2026-04-22T00:00:00.000Z"),
  updatedAt: new Date("2026-04-22T01:00:00.000Z"),
} as never)
```

Replace the `expect(mockQdrant.upsert).toHaveBeenCalledWith(...)` block with:

```ts
expect(mockQdrant.upsert).toHaveBeenCalledWith([
  expect.objectContaining({
    vector: [0.1, 0.2],
    payload: {
      pageId: "p1",
      workspaceId: "w1",
      chunkIndex: 0,
      title: "Hello",
      content: "a",
      pageType: "TEXT",
      createdById: "u1",
      createdAt: "2026-04-22T00:00:00.000Z",
      updatedAt: "2026-04-22T01:00:00.000Z",
    },
  }),
  expect.objectContaining({
    vector: [0.3, 0.4],
    payload: expect.objectContaining({
      chunkIndex: 1,
      content: "b",
      title: "Hello",
    }),
  }),
])
```

- [ ] **Step 2: Apply the same page-mock extension to the other two tests that return a page**

In `"skips wrong page types but still deletes old points"` (around line 53) and `"drops empty normalized chunks"` (around line 96), add the new fields (`title: "Hello", createdById: "u1", createdAt: new Date(...), updatedAt: new Date(...)`) to the `findUnique` mock return object. This prevents runtime "undefined" errors when the processor reads them.

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter=engines test indexing.processor`
Expected: FAIL — payload missing new fields.

- [ ] **Step 4: Extend the Prisma select in `indexing.processor.ts`**

In `apps/engines/src/apps/indexer/queue/indexing.processor.ts` replace the `page.findUnique` select (around line 40-50) with:

```ts
const page = await this.prisma.page.findUnique({
  where: { id: pageId },
  select: {
    id: true,
    type: true,
    ownership: true,
    deletedAt: true,
    content: true,
    workspaceId: true,
    title: true,
    createdById: true,
    createdAt: true,
    updatedAt: true,
  },
})
```

- [ ] **Step 5: Populate new fields in every point's payload**

In the same file, replace the `points.push({...})` call (around line 78-82) with:

```ts
points.push({
  id: pointId(pageId, i),
  vector,
  payload: {
    pageId,
    workspaceId,
    chunkIndex: i,
    title: page.title ?? "",
    content: normalized,
    pageType: page.type,
    createdById: page.createdById ?? "",
    createdAt: page.createdAt.toISOString(),
    updatedAt: page.updatedAt.toISOString(),
  },
})
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter=engines test indexing.processor`
Expected: PASS (all 4 tests).

- [ ] **Step 7: Run check-types**

Run: `pnpm --filter=engines check-types`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/engines/src/apps/indexer/queue/indexing.processor.ts apps/engines/src/apps/indexer/queue/indexing.processor.spec.ts
git commit -m "feat(engines): populate Qdrant payload with page metadata (title, content, pageType, createdBy, timestamps)"
```

---

## Task 3: Add `ReindexOnBootService` for dev reindex

After the payload shape changed, old points miss the new fields. Add an opt-in env switch that re-enqueues every TEXT page via the outbox on app boot.

**Files:**
- Create: `apps/engines/src/apps/indexer/services/reindex-on-boot.service.ts`
- Create: `apps/engines/src/apps/indexer/services/reindex-on-boot.service.spec.ts`
- Modify: `apps/engines/src/apps/indexer/indexer.module.ts`

- [ ] **Step 1: Write the failing unit test**

Create `apps/engines/src/apps/indexer/services/reindex-on-boot.service.spec.ts`:

```ts
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals"
import type { PrismaClient } from "@repo/db"

import type { QdrantWriter } from "./qdrant-writer.service.js"
import { ReindexOnBootService } from "./reindex-on-boot.service.js"

describe("ReindexOnBootService", () => {
  const mockPrisma = {
    page: { findMany: jest.fn<(...a: unknown[]) => Promise<unknown[]>>() },
    outboxEvent: { create: jest.fn<(...a: unknown[]) => Promise<unknown>>() },
  } as unknown as PrismaClient
  const mockQdrant = {
    ensureCollection: jest.fn<(...a: unknown[]) => Promise<void>>(),
    wipeCollection: jest.fn<(...a: unknown[]) => Promise<void>>(),
  } as unknown as QdrantWriter

  const originalEnv = process.env.INDEXER_REINDEX_ON_BOOT

  beforeEach(() => {
    ;(mockPrisma.page.findMany as jest.Mock).mockReset()
    ;(mockPrisma.outboxEvent.create as jest.Mock).mockReset()
    ;(mockQdrant.wipeCollection as jest.Mock).mockReset()
  })

  afterEach(() => {
    process.env.INDEXER_REINDEX_ON_BOOT = originalEnv
  })

  it("is a no-op when env flag is absent", async () => {
    delete process.env.INDEXER_REINDEX_ON_BOOT
    const svc = new ReindexOnBootService(mockPrisma, mockQdrant)
    await svc.onApplicationBootstrap()
    expect(mockQdrant.wipeCollection).not.toHaveBeenCalled()
    expect(mockPrisma.page.findMany).not.toHaveBeenCalled()
  })

  it("wipes the collection and enqueues every live TEXT page when flag is true", async () => {
    process.env.INDEXER_REINDEX_ON_BOOT = "true"
    ;(mockPrisma.page.findMany as jest.Mock).mockResolvedValue([
      { id: "p1", workspaceId: "w1" },
      { id: "p2", workspaceId: "w2" },
    ] as never)
    ;(mockPrisma.outboxEvent.create as jest.Mock).mockResolvedValue({} as never)

    const svc = new ReindexOnBootService(mockPrisma, mockQdrant)
    await svc.onApplicationBootstrap()

    expect(mockQdrant.wipeCollection).toHaveBeenCalled()
    expect(mockPrisma.page.findMany).toHaveBeenCalledWith({
      where: { type: "TEXT", deletedAt: null },
      select: { id: true, workspaceId: true },
    })
    expect(mockPrisma.outboxEvent.create).toHaveBeenCalledTimes(2)
    expect(mockPrisma.outboxEvent.create).toHaveBeenCalledWith({
      data: {
        eventType: "page.upserted",
        aggregateType: "page",
        aggregateId: "p1",
        workspaceId: "w1",
        payload: {},
      },
    })
  })
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter=engines test reindex-on-boot`
Expected: FAIL — service and `wipeCollection` do not exist.

- [ ] **Step 3: Add `wipeCollection` method to `QdrantWriter`**

In `apps/engines/src/apps/indexer/services/qdrant-writer.service.ts`, add a method after `deleteByPageId`:

```ts
async wipeCollection(): Promise<void> {
  const existing = await this.qdrant.client.getCollections()
  const collections = existing.collections as { name: string }[] | undefined
  const exists = collections?.some((c) => c.name === this.qdrant.collection)
  if (exists) {
    await this.qdrant.client.deleteCollection(this.qdrant.collection)
  }
  await this.ensureCollection()
}
```

- [ ] **Step 4: Create the service**

Create `apps/engines/src/apps/indexer/services/reindex-on-boot.service.ts`:

```ts
import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common"
import type { PrismaClient } from "@repo/db"
import { Inject } from "@nestjs/common"

import { PRISMA } from "../../../infra/db/db.providers.js"
import { QdrantWriter } from "./qdrant-writer.service.js"

@Injectable()
export class ReindexOnBootService implements OnApplicationBootstrap {
  private readonly log = new Logger(ReindexOnBootService.name)

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly qdrant: QdrantWriter,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.INDEXER_REINDEX_ON_BOOT !== "true") return

    this.log.warn("INDEXER_REINDEX_ON_BOOT=true — wiping Qdrant collection and re-enqueuing all TEXT pages")
    await this.qdrant.wipeCollection()

    const pages = await this.prisma.page.findMany({
      where: { type: "TEXT", deletedAt: null },
      select: { id: true, workspaceId: true },
    })

    for (const page of pages) {
      await this.prisma.outboxEvent.create({
        data: {
          eventType: "page.upserted",
          aggregateType: "page",
          aggregateId: page.id,
          workspaceId: page.workspaceId,
          payload: {},
        },
      })
    }

    this.log.log(`Enqueued ${pages.length} pages for reindexing`)
  }
}
```

- [ ] **Step 5: Register the service in `IndexerModule`**

In `apps/engines/src/apps/indexer/indexer.module.ts`, add the import and provider:

```ts
import { ReindexOnBootService } from "./services/reindex-on-boot.service.js"

// in providers array, after QdrantWriter:
ReindexOnBootService,
```

- [ ] **Step 6: Run test to verify pass**

Run: `pnpm --filter=engines test reindex-on-boot`
Expected: PASS (2 tests).

- [ ] **Step 7: Run check-types + all engines tests**

Run: `pnpm --filter=engines check-types && pnpm --filter=engines test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/engines/src/apps/indexer/services/reindex-on-boot.service.ts apps/engines/src/apps/indexer/services/reindex-on-boot.service.spec.ts apps/engines/src/apps/indexer/services/qdrant-writer.service.ts apps/engines/src/apps/indexer/indexer.module.ts
git commit -m "feat(engines): add INDEXER_REINDEX_ON_BOOT switch to wipe Qdrant and reindex all TEXT pages"
```

---

## Task 4: Create `PageSearchService` with dedupe + threshold

Unit-tested service that embeds a query, calls Qdrant, dedupes hits by pageId, returns top-K documents.

**Files:**
- Create: `apps/engines/src/apps/search/services/page-search.service.ts`
- Create: `apps/engines/src/apps/search/services/page-search.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/engines/src/apps/search/services/page-search.service.spec.ts`:

```ts
import { jest, describe, it, expect, beforeEach } from "@jest/globals"

import type { EmbeddingClient } from "../../indexer/services/embedding-client.service.js"
import type { QdrantService } from "../../../infra/qdrant/qdrant.service.js"
import { PageSearchService } from "./page-search.service.js"

describe("PageSearchService", () => {
  const mockEmbed = { embed: jest.fn<(...a: unknown[]) => Promise<number[]>>() } as unknown as EmbeddingClient
  const mockQdrantClient = { search: jest.fn<(...a: unknown[]) => Promise<unknown[]>>() }
  const mockQdrant = { client: mockQdrantClient, collection: "page_chunks" } as unknown as QdrantService

  let service: PageSearchService

  beforeEach(() => {
    ;(mockEmbed.embed as jest.Mock).mockReset()
    ;(mockQdrantClient.search as jest.Mock).mockReset()
    service = new PageSearchService(mockEmbed, mockQdrant)
  })

  const makeHit = (args: { pageId: string; score: number; chunkIndex?: number; content?: string }) => ({
    id: `id-${args.pageId}-${args.chunkIndex ?? 0}`,
    score: args.score,
    payload: {
      pageId: args.pageId,
      workspaceId: "w1",
      chunkIndex: args.chunkIndex ?? 0,
      title: `Title ${args.pageId}`,
      content: args.content ?? `content ${args.pageId}-${args.chunkIndex ?? 0}`,
      pageType: "TEXT",
      createdById: "u1",
      createdAt: "2026-04-22T00:00:00.000Z",
      updatedAt: "2026-04-22T01:00:00.000Z",
    },
  })

  it("embeds query, calls Qdrant with workspace filter, maps hits to documents", async () => {
    ;(mockEmbed.embed as jest.Mock).mockResolvedValue([0.1, 0.2] as never)
    ;(mockQdrantClient.search as jest.Mock).mockResolvedValue([
      makeHit({ pageId: "p1", score: 0.9 }),
    ] as never)

    const result = await service.search({ workspaceId: "w1", query: "hello", topK: 5 })

    expect(mockEmbed.embed).toHaveBeenCalledWith("hello")
    expect(mockQdrantClient.search).toHaveBeenCalledWith(
      "page_chunks",
      expect.objectContaining({
        vector: [0.1, 0.2],
        filter: { must: [{ key: "workspaceId", match: { value: "w1" } }] },
        limit: 15,
        score_threshold: 0.35,
        with_payload: true,
      }),
    )
    expect(result.documents).toEqual([
      {
        id: "p1",
        title: "Title p1",
        content: "content p1-0",
        score: 0.9,
        updatedAt: "2026-04-22T01:00:00.000Z",
        pageType: "TEXT",
      },
    ])
  })

  it("dedupes by pageId, keeping the highest-scoring chunk per page", async () => {
    ;(mockEmbed.embed as jest.Mock).mockResolvedValue([0.1] as never)
    ;(mockQdrantClient.search as jest.Mock).mockResolvedValue([
      makeHit({ pageId: "p1", score: 0.7, chunkIndex: 0, content: "low" }),
      makeHit({ pageId: "p1", score: 0.9, chunkIndex: 1, content: "high" }),
      makeHit({ pageId: "p2", score: 0.8, chunkIndex: 0, content: "p2-best" }),
    ] as never)

    const result = await service.search({ workspaceId: "w1", query: "x" })

    expect(result.documents).toHaveLength(2)
    expect(result.documents[0]).toMatchObject({ id: "p1", content: "high", score: 0.9 })
    expect(result.documents[1]).toMatchObject({ id: "p2", content: "p2-best", score: 0.8 })
  })

  it("caps at topK pages after dedupe", async () => {
    ;(mockEmbed.embed as jest.Mock).mockResolvedValue([0.1] as never)
    ;(mockQdrantClient.search as jest.Mock).mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => makeHit({ pageId: `p${i}`, score: 0.9 - i * 0.05 })) as never,
    )

    const result = await service.search({ workspaceId: "w1", query: "x", topK: 3 })

    expect(result.documents).toHaveLength(3)
    expect(result.documents.map((d) => d.id)).toEqual(["p0", "p1", "p2"])
  })

  it("returns empty documents when Qdrant returns no hits", async () => {
    ;(mockEmbed.embed as jest.Mock).mockResolvedValue([0.1] as never)
    ;(mockQdrantClient.search as jest.Mock).mockResolvedValue([] as never)

    const result = await service.search({ workspaceId: "w1", query: "no match" })

    expect(result.documents).toEqual([])
  })

  it("passes custom scoreThreshold and topK to Qdrant", async () => {
    ;(mockEmbed.embed as jest.Mock).mockResolvedValue([0.1] as never)
    ;(mockQdrantClient.search as jest.Mock).mockResolvedValue([] as never)

    await service.search({ workspaceId: "w1", query: "x", topK: 7, scoreThreshold: 0.5 })

    expect(mockQdrantClient.search).toHaveBeenCalledWith(
      "page_chunks",
      expect.objectContaining({ limit: 21, score_threshold: 0.5 }),
    )
  })
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter=engines test page-search.service`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the service**

Create `apps/engines/src/apps/search/services/page-search.service.ts`:

```ts
import { Injectable, Logger } from "@nestjs/common"

import { QdrantService } from "../../../infra/qdrant/qdrant.service.js"
import { EmbeddingClient } from "../../indexer/services/embedding-client.service.js"

export type RagSearchDocument = {
  id: string
  title: string
  content: string
  score: number
  updatedAt: string
  pageType: string
}

export type SearchArgs = {
  workspaceId: string
  query: string
  topK?: number
  scoreThreshold?: number
}

type QdrantHit = {
  id: string | number
  score: number
  payload?: Record<string, unknown> | null
}

const DEFAULT_TOP_K = 5
const DEFAULT_SCORE_THRESHOLD = 0.35
const SEARCH_LIMIT_MULTIPLIER = 3

@Injectable()
export class PageSearchService {
  private readonly log = new Logger(PageSearchService.name)

  constructor(
    private readonly embedding: EmbeddingClient,
    private readonly qdrant: QdrantService,
  ) {}

  async search(args: SearchArgs): Promise<{ documents: RagSearchDocument[] }> {
    const topK = args.topK ?? DEFAULT_TOP_K
    const scoreThreshold = args.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD

    const vector = await this.embedding.embed(args.query)
    const hits = (await this.qdrant.client.search(this.qdrant.collection, {
      vector,
      filter: { must: [{ key: "workspaceId", match: { value: args.workspaceId } }] },
      limit: topK * SEARCH_LIMIT_MULTIPLIER,
      score_threshold: scoreThreshold,
      with_payload: true,
    })) as QdrantHit[]

    const bestPerPage = new Map<string, RagSearchDocument>()
    for (const hit of hits) {
      const payload = (hit.payload ?? {}) as {
        pageId?: string
        title?: string
        content?: string
        pageType?: string
        updatedAt?: string
      }
      if (!payload.pageId) continue
      const existing = bestPerPage.get(payload.pageId)
      if (existing && existing.score >= hit.score) continue
      bestPerPage.set(payload.pageId, {
        id: payload.pageId,
        title: payload.title ?? "",
        content: payload.content ?? "",
        score: hit.score,
        updatedAt: payload.updatedAt ?? "",
        pageType: payload.pageType ?? "",
      })
    }

    const documents = [...bestPerPage.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)

    return { documents }
  }
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm --filter=engines test page-search.service`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/engines/src/apps/search/services/page-search.service.ts apps/engines/src/apps/search/services/page-search.service.spec.ts
git commit -m "feat(engines): add PageSearchService with dedupe-by-page and score threshold"
```

---

## Task 5: Add zod request schema for search DTO

**Files:**
- Create: `apps/engines/src/apps/search/dto/search.schema.ts`

- [ ] **Step 1: Create the schema file**

Create `apps/engines/src/apps/search/dto/search.schema.ts`:

```ts
import { z } from "zod"

export const searchPagesRequestSchema = z.object({
  workspaceId: z.string().uuid(),
  query: z.string().trim().min(1).max(4000),
  topK: z.number().int().min(1).max(20).optional(),
  scoreThreshold: z.number().min(0).max(1).optional(),
})

export type SearchPagesRequest = z.infer<typeof searchPagesRequestSchema>

export type SearchPagesResponse = {
  documents: Array<{
    id: string
    title: string
    content: string
    score: number
    updatedAt: string
    pageType: string
  }>
}
```

- [ ] **Step 2: Run check-types**

Run: `pnpm --filter=engines check-types`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/engines/src/apps/search/dto/search.schema.ts
git commit -m "feat(engines): add zod schema for search request validation"
```

---

## Task 6: Create `SearchController` and `SearchModule`

**Files:**
- Create: `apps/engines/src/apps/search/search.controller.ts`
- Create: `apps/engines/src/apps/search/search.controller.spec.ts`
- Create: `apps/engines/src/apps/search/search.module.ts`
- Modify: `apps/engines/src/app.module.ts`
- Modify: `apps/engines/src/apps/indexer/indexer.module.ts` — export `EmbeddingClient` so `SearchModule` can reuse it

- [ ] **Step 1: Write the failing controller test**

Create `apps/engines/src/apps/search/search.controller.spec.ts`:

```ts
import { jest, describe, it, expect, beforeEach } from "@jest/globals"

import { SearchController } from "./search.controller.js"
import type { PageSearchService } from "./services/page-search.service.js"

describe("SearchController", () => {
  const mockService = { search: jest.fn<(...a: unknown[]) => Promise<unknown>>() } as unknown as PageSearchService
  let controller: SearchController

  beforeEach(() => {
    ;(mockService.search as jest.Mock).mockReset()
    controller = new SearchController(mockService)
  })

  it("returns documents from the service for a valid payload", async () => {
    ;(mockService.search as jest.Mock).mockResolvedValue({
      documents: [{ id: "p1", title: "T", content: "C", score: 0.9, updatedAt: "2026-04-22T00:00:00.000Z", pageType: "TEXT" }],
    } as never)

    const result = await controller.searchPages({
      workspaceId: "11111111-1111-1111-1111-111111111111",
      query: "hello",
    })

    expect(mockService.search).toHaveBeenCalledWith({
      workspaceId: "11111111-1111-1111-1111-111111111111",
      query: "hello",
      topK: undefined,
      scoreThreshold: undefined,
    })
    expect(result.documents).toHaveLength(1)
  })

  it("rejects invalid workspaceId with 400", async () => {
    await expect(
      controller.searchPages({ workspaceId: "not-a-uuid", query: "x" } as never),
    ).rejects.toMatchObject({ status: 400 })
  })

  it("rejects empty query with 400", async () => {
    await expect(
      controller.searchPages({ workspaceId: "11111111-1111-1111-1111-111111111111", query: "  " } as never),
    ).rejects.toMatchObject({ status: 400 })
  })
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter=engines test search.controller`
Expected: FAIL — controller does not exist.

- [ ] **Step 3: Implement the controller**

Create `apps/engines/src/apps/search/search.controller.ts`:

```ts
import { BadRequestException, Body, Controller, Post } from "@nestjs/common"
import { ApiOkResponse, ApiTags } from "@nestjs/swagger"

import { searchPagesRequestSchema, type SearchPagesResponse } from "./dto/search.schema.js"
import { PageSearchService } from "./services/page-search.service.js"

// INTERNAL ENDPOINT: no auth. Do not expose on public ingress.
@ApiTags("search")
@Controller("search")
export class SearchController {
  constructor(private readonly service: PageSearchService) {}

  @Post("pages")
  @ApiOkResponse({ description: "RAG documents for the query" })
  async searchPages(@Body() body: unknown): Promise<SearchPagesResponse> {
    const parsed = searchPagesRequestSchema.safeParse(body)
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten())
    }

    const { workspaceId, query, topK, scoreThreshold } = parsed.data
    const result = await this.service.search({ workspaceId, query, topK, scoreThreshold })
    return { documents: result.documents }
  }
}
```

- [ ] **Step 4: Create `SearchModule`**

Create `apps/engines/src/apps/search/search.module.ts`:

```ts
import { Module } from "@nestjs/common"

import { IndexerModule } from "../indexer/indexer.module.js"
import { QdrantModule } from "../../infra/qdrant/qdrant.module.js"
import { SearchController } from "./search.controller.js"
import { PageSearchService } from "./services/page-search.service.js"

@Module({
  imports: [IndexerModule, QdrantModule],
  controllers: [SearchController],
  providers: [PageSearchService],
})
export class SearchModule {}
```

- [ ] **Step 5: Export `EmbeddingClient` from `IndexerModule`**

In `apps/engines/src/apps/indexer/indexer.module.ts`, add `exports`:

```ts
@Module({
  imports: [
    BullModule.registerQueue({
      name: "indexing",
    }),
  ],
  providers: [
    OutboxCronService,
    OutboxDrainerService,
    IndexingProcessor,
    PageChunker,
    ProcessingClient,
    EmbeddingClient,
    QdrantWriter,
    ReindexOnBootService,
  ],
  exports: [EmbeddingClient],
})
export class IndexerModule {}
```

- [ ] **Step 6: Register `SearchModule` in `AppModule`**

In `apps/engines/src/app.module.ts`, add:

```ts
import { SearchModule } from "./apps/search/search.module.js"

// in imports array, after McpModule:
SearchModule,
```

- [ ] **Step 7: Run tests to verify pass**

Run: `pnpm --filter=engines test search`
Expected: PASS.

- [ ] **Step 8: Run check-types + lint**

Run: `pnpm --filter=engines check-types && pnpm --filter=engines lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/engines/src/apps/search/ apps/engines/src/apps/indexer/indexer.module.ts apps/engines/src/app.module.ts
git commit -m "feat(engines): expose POST /search/pages endpoint with zod validation"
```

---

## Task 7: Integration test for `/search/pages`

Verify end-to-end: index a page via the outbox → poll Qdrant → call the endpoint → assert the page is returned with correct payload.

**Files:**
- Create: `apps/engines/test/integration/search.e2e.spec.ts`

- [ ] **Step 1: Create the integration test**

Create `apps/engines/test/integration/search.e2e.spec.ts`:

```ts
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, jest } from "@jest/globals"
import type { INestApplication } from "@nestjs/common"
import { NestFactory } from "@nestjs/core"
import { prisma } from "@repo/db"

import { AppModule } from "../../src/app.module.js"
import { OutboxDrainerService } from "../../src/apps/indexer/cron/outbox-drainer.service.js"
import { QdrantWriter } from "../../src/apps/indexer/services/qdrant-writer.service.js"
import { SearchController } from "../../src/apps/search/search.controller.js"

jest.setTimeout(120000)

describe("Search e2e", () => {
  let app: INestApplication
  let drainer: OutboxDrainerService
  let writer: QdrantWriter
  let controller: SearchController

  let workspaceId: string
  let userId: string
  let pageId: string

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false })
    await app.init()
    drainer = app.get(OutboxDrainerService)
    writer = app.get(QdrantWriter)
    controller = app.get(SearchController)
    await writer.ensureCollection()
  })

  afterAll(async () => {
    await app.close()
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    const ws = await prisma.workspace.create({ data: { name: "test-ws-search" } })
    workspaceId = ws.id
    const user = await prisma.user.create({
      data: {
        name: "Test",
        firstName: "T",
        lastName: "U",
        email: `t-search-${workspaceId}@e.com`,
        emailVerified: true,
      },
    })
    userId = user.id
    await prisma.workspaceMember.create({ data: { workspaceId, userId, role: "OWNER" } })
  })

  afterEach(async () => {
    if (pageId) await prisma.page.delete({ where: { id: pageId } }).catch(() => undefined)
    if (workspaceId) await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined)
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined)
  })

  it("indexes a page and returns it via POST /search/pages", async () => {
    const marker = "Бразильский Медведь квартального отчёта"
    const page = await prisma.page.create({
      data: {
        workspaceId,
        title: "Quarterly notes",
        content: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: `Корпоративный кофе ${marker}` }] },
          ],
        },
        createdById: userId,
        updatedById: userId,
      },
    })
    pageId = page.id

    await prisma.outboxEvent.create({
      data: {
        eventType: "page.upserted",
        aggregateType: "page",
        aggregateId: pageId,
        workspaceId,
        payload: {},
      },
    })

    await drainer.drain()
    // BullMQ worker + Ollama embedding can take a while
    await new Promise((r) => setTimeout(r, 20000))

    const done = await prisma.outboxEvent.findFirst({ where: { aggregateId: pageId, status: "DONE" } })
    expect(done).toBeTruthy()

    const response = await controller.searchPages({
      workspaceId,
      query: "Как называется корпоративный кофе?",
    })

    expect(response.documents.length).toBeGreaterThan(0)
    const top = response.documents[0]
    expect(top.id).toBe(pageId)
    expect(top.title).toBe("Quarterly notes")
    expect(top.content).toContain(marker)
    expect(top.pageType).toBe("TEXT")
    expect(top.score).toBeGreaterThan(0.35)
  })

  it("respects workspace isolation (returns empty for foreign workspace)", async () => {
    // Index page in workspaceId (from beforeEach) with unique content
    const page = await prisma.page.create({
      data: {
        workspaceId,
        title: "Secret",
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "workspace-isolation-marker-xyz" }] }],
        },
        createdById: userId,
        updatedById: userId,
      },
    })
    pageId = page.id
    await prisma.outboxEvent.create({
      data: {
        eventType: "page.upserted",
        aggregateType: "page",
        aggregateId: pageId,
        workspaceId,
        payload: {},
      },
    })
    await drainer.drain()
    await new Promise((r) => setTimeout(r, 20000))

    // Create a second workspace and query with it
    const otherWs = await prisma.workspace.create({ data: { name: "other-ws" } })
    try {
      const response = await controller.searchPages({
        workspaceId: otherWs.id,
        query: "workspace-isolation-marker-xyz",
      })
      expect(response.documents).toEqual([])
    } finally {
      await prisma.workspace.delete({ where: { id: otherWs.id } }).catch(() => undefined)
    }
  })
})
```

- [ ] **Step 2: Run the integration test**

Prerequisite: `docker compose up -d` (Postgres, Redis, Qdrant, Ollama must be up).

Run: `pnpm --filter=engines test:integration search.e2e`
Expected: PASS (2 tests, ~45 s).

If the test fails because Ollama has no model pulled, run `curl http://localhost:11434/api/pull -d '{"name":"nomic-embed-text"}'` and retry.

- [ ] **Step 3: Commit**

```bash
git add apps/engines/test/integration/search.e2e.spec.ts
git commit -m "test(engines): integration test for /search/pages with workspace isolation"
```

---

## Task 8: Create `rag-search.ts` in apps/web with graceful failure

**Files:**
- Create: `apps/web/src/lib/chat/rag-search.ts`
- Create: `apps/web/src/lib/chat/rag-search.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/chat/rag-search.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { searchRagDocuments } from "./rag-search"

describe("searchRagDocuments", () => {
  const fetchSpy = vi.fn<typeof fetch>()
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    fetchSpy.mockReset()
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    process.env.ENGINES_SERVICE_URL = "http://engines:8082"
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("returns mapped documents on 200", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          documents: [
            { id: "p1", title: "T", content: "C", score: 0.9, updatedAt: "2026-04-22T00:00:00.000Z", pageType: "TEXT" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )

    const result = await searchRagDocuments({ workspaceId: "w1", query: "hello" })

    expect(result).toEqual([{ id: "p1", title: "T", content: "C" }])
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://engines:8080/search/pages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "content-type": "application/json" }),
        body: JSON.stringify({ workspaceId: "w1", query: "hello", topK: 5 }),
      }),
    )
  })

  it("returns [] on 5xx", async () => {
    fetchSpy.mockResolvedValue(new Response("boom", { status: 503 }))
    const result = await searchRagDocuments({ workspaceId: "w1", query: "x" })
    expect(result).toEqual([])
  })

  it("returns [] on network error", async () => {
    fetchSpy.mockRejectedValue(new Error("ECONNREFUSED"))
    const result = await searchRagDocuments({ workspaceId: "w1", query: "x" })
    expect(result).toEqual([])
  })

  it("returns [] on malformed JSON", async () => {
    fetchSpy.mockResolvedValue(
      new Response("not-json", { status: 200, headers: { "content-type": "application/json" } }),
    )
    const result = await searchRagDocuments({ workspaceId: "w1", query: "x" })
    expect(result).toEqual([])
  })

  it("honours custom topK", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ documents: [] }), { status: 200 }),
    )
    await searchRagDocuments({ workspaceId: "w1", query: "x", topK: 3 })
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ workspaceId: "w1", query: "x", topK: 3 }),
      }),
    )
  })
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter=web test rag-search`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the module**

Create `apps/web/src/lib/chat/rag-search.ts`:

```ts
export type RagDocument = { id: string; title: string; content: string }

type EnginesSearchResponse = {
  documents?: Array<{
    id?: string
    title?: string
    content?: string
  }>
}

const DEFAULT_TOP_K = 5
const REQUEST_TIMEOUT_MS = 5000

export async function searchRagDocuments(args: {
  workspaceId: string
  query: string
  topK?: number
}): Promise<RagDocument[]> {
  const baseUrl = process.env.ENGINES_SERVICE_URL ?? "http://localhost:8082"
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(`${baseUrl}/search/pages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: args.workspaceId,
        query: args.query,
        topK: args.topK ?? DEFAULT_TOP_K,
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      console.warn(`[rag-search] engines returned ${response.status}`)
      return []
    }

    const data = (await response.json()) as EnginesSearchResponse
    const documents = Array.isArray(data?.documents) ? data.documents : []
    return documents
      .filter((doc): doc is Required<NonNullable<EnginesSearchResponse["documents"]>[number]> => {
        return typeof doc?.id === "string" && typeof doc?.title === "string" && typeof doc?.content === "string"
      })
      .map((doc) => ({ id: doc.id, title: doc.title, content: doc.content }))
  } catch (error) {
    console.warn(`[rag-search] failed: ${(error as Error).message}`)
    return []
  } finally {
    clearTimeout(timeout)
  }
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm --filter=web test rag-search`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/chat/rag-search.ts apps/web/src/lib/chat/rag-search.test.ts
git commit -m "feat(web): add rag-search client with graceful failure"
```

---

## Task 9: Extend `buildAgentsPayload` to include `rag`

**Files:**
- Modify: `apps/web/src/lib/chat/agents-payload.ts`

- [ ] **Step 1: Search for existing tests of `buildAgentsPayload`**

Run: `grep -rn "buildAgentsPayload" apps/web/src apps/web/test 2>/dev/null | grep -v ".next" | head -10`

If a test file exists, extend it. If none exists, create `apps/web/src/lib/chat/agents-payload.test.ts` in Step 2.

- [ ] **Step 2: Create (or extend) the test**

Create `apps/web/src/lib/chat/agents-payload.test.ts` if absent:

```ts
import { describe, expect, it } from "vitest"

import { buildAgentsPayload, type WorkspaceSettingsSnapshot } from "./agents-payload"

const settings: WorkspaceSettingsSnapshot = {
  temperature: 0.3,
  topP: 0.9,
  systemPrompt: "be nice",
  defaultModel: {
    slug: "gigachat-2",
    provider: { slug: "gigachat", connection: { scope: "GIGACHAT_API_PERS" } },
  },
}

describe("buildAgentsPayload", () => {
  it("includes empty rag.documents when no rag passed", () => {
    const payload = buildAgentsPayload({
      chatId: "c1",
      workspaceId: "w1",
      userId: "u1",
      text: "hi",
      settings,
      rag: [],
    })
    expect(payload.rag).toEqual({ documents: [] })
  })

  it("passes provided rag documents through", () => {
    const payload = buildAgentsPayload({
      chatId: "c1",
      workspaceId: "w1",
      userId: "u1",
      text: "hi",
      settings,
      rag: [{ id: "p1", title: "T", content: "C" }],
    })
    expect(payload.rag).toEqual({ documents: [{ id: "p1", title: "T", content: "C" }] })
  })

  it("preserves existing top-level fields", () => {
    const payload = buildAgentsPayload({
      chatId: "c1",
      workspaceId: "w1",
      userId: "u1",
      text: "hi",
      settings,
      rag: [],
    })
    expect(payload.threadId).toBe("c1")
    expect(payload.query).toBe("hi")
    expect(payload.mcp.servers).toHaveLength(1)
    expect(payload.instruction).toEqual({ format: "markdown", language: "ru", citationsRequired: true })
  })
})
```

- [ ] **Step 3: Run test to verify failure**

Run: `pnpm --filter=web test agents-payload`
Expected: FAIL — `rag` field doesn't exist, or type error on `rag` arg.

- [ ] **Step 4: Modify `agents-payload.ts`**

In `apps/web/src/lib/chat/agents-payload.ts`, add the import and rag handling:

At the top add:

```ts
import type { RagDocument } from "./rag-search"

export type { RagDocument } from "./rag-search"
```

Replace the `buildAgentsPayload` function signature and body:

```ts
export function buildAgentsPayload(args: {
  chatId: string
  workspaceId: string
  userId: string
  text: string
  settings: WorkspaceSettingsSnapshot
  rag: RagDocument[]
}) {
  return {
    threadId: args.chatId,
    model: {
      provider: args.settings.defaultModel.provider.slug,
      name: args.settings.defaultModel.slug,
      connection: normalizeConnection(args.settings.defaultModel.provider.connection),
      settings: {
        temperature: args.settings.temperature,
        topP: args.settings.topP,
      },
    },
    systemPrompt: args.settings.systemPrompt ?? "",
    rag: { documents: args.rag },
    mcp: {
      servers: [
        {
          name: "AnyNote MCP Server",
          url: process.env.ANYNOTE_MCP_URL ?? "http://localhost:8090/api/mcp",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            "X-User-Id": args.userId,
            "X-Workspace-Id": args.workspaceId,
          },
          retries: 3,
          verify: false,
        },
      ],
    },
    instruction: {
      format: "markdown",
      language: "ru",
      citationsRequired: true,
    },
    query: args.text,
  }
}
```

- [ ] **Step 5: Run test to verify pass**

Run: `pnpm --filter=web test agents-payload`
Expected: PASS (3 tests).

- [ ] **Step 6: Run check-types**

Run: `pnpm --filter=web check-types`
Expected: FAIL at `generate/route.ts` — the call site doesn't yet pass `rag`. That's expected; Task 10 fixes it.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/chat/agents-payload.ts apps/web/src/lib/chat/agents-payload.test.ts
git commit -m "feat(web): add rag field to buildAgentsPayload"
```

---

## Task 10: Wire RAG search into `/api/agents/generate`

**Files:**
- Modify: `apps/web/src/app/api/agents/generate/route.ts`

- [ ] **Step 1: Update the route**

In `apps/web/src/app/api/agents/generate/route.ts`:

Add the import at the top:

```ts
import { searchRagDocuments, type RagDocument } from "@/lib/chat/rag-search"
```

Add `rag` to the `streamAgentsToRegistry` args type (around line 125-133):

```ts
async function streamAgentsToRegistry(args: {
  assistantMessageId: string
  chatId: string
  entry: ReturnType<typeof activeStreamRegistry.create>
  text: string
  userId: string
  workspaceId: string
  settings: WorkspaceSettingsSnapshot
  rag: RagDocument[]
}) {
```

Pass `rag` into `buildAgentsPayload` inside that function (around line 147-155):

```ts
body: JSON.stringify(
  buildAgentsPayload({
    chatId: args.chatId,
    settings: args.settings,
    text: args.text,
    userId: args.userId,
    workspaceId: args.workspaceId,
    rag: args.rag,
  }),
),
```

In the `POST` handler (around line 340-355), perform the RAG search before creating the upstream task:

```ts
const ragDocuments = await searchRagDocuments({
  workspaceId: chat.workspaceId,
  query: body.text,
  topK: 5,
})

const entry = activeStreamRegistry.create({
  assistantMessageId: assistantMessage.id,
  chatId: chat.id,
  userMessageId: userMessage.id,
})

const upstreamTask = streamAgentsToRegistry({
  assistantMessageId: assistantMessage.id,
  chatId: chat.id,
  entry,
  settings: settingsSnapshot,
  text: body.text,
  userId: session.user.id,
  workspaceId: chat.workspaceId,
  rag: ragDocuments,
})
```

- [ ] **Step 2: Run check-types**

Run: `pnpm --filter=web check-types`
Expected: PASS.

- [ ] **Step 3: Run web tests**

Run: `pnpm --filter=web test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api/agents/generate/route.ts
git commit -m "feat(web): call /search/pages before chat generate and attach rag.documents"
```

---

## Task 11: Polish `default.j2` prompt template

**Files:**
- Modify: `apps/agents/agents/apps/chat/templates/default.j2`
- Create: `apps/agents/tests/apps/chat/repositories/test_jinja_renderer.py`

- [ ] **Step 1: Write the failing renderer test**

Create `apps/agents/tests/apps/chat/repositories/__init__.py` (empty) if missing, then create `apps/agents/tests/apps/chat/repositories/test_jinja_renderer.py`:

```python
from pathlib import Path
from uuid import uuid4

from agents.apps.chat.repositories.jinja_renderer import JinjaRendererRepository
from agents.apps.chat.schemas import (
    InstructionRequestSchema,
    ModelConfigSchema,
    QueryRequestSchema,
    RagDocumentSchema,
    RagDocumentsSchema,
)
from agents.settings import SettingsSchema


def _make_settings() -> SettingsSchema:
    base_dir = Path(__file__).resolve().parents[4]
    return SettingsSchema(base_dir=str(base_dir))


def _make_payload(rag: RagDocumentsSchema | None) -> QueryRequestSchema:
    return QueryRequestSchema(
        thread_id=uuid4(),
        model=ModelConfigSchema(provider="gigachat", name="gigachat-2"),
        system_prompt="",
        instruction=InstructionRequestSchema(format="markdown", language="ru", citations_required=True),
        messages=[],
        rag=rag,
        mcp=None,
        query="Что такое корпоративный кофе?",
    )


def test_renders_rag_documents_with_id_title_and_content() -> None:
    renderer = JinjaRendererRepository(_make_settings())
    page_id = uuid4()
    payload = _make_payload(
        RagDocumentsSchema(
            documents=[
                RagDocumentSchema(id=page_id, title="Quarterly notes", content="Многострочный\nфрагмент"),
            ]
        )
    )

    output = renderer.render(payload, [])

    assert str(page_id) in output
    assert "Quarterly notes" in output
    assert "Многострочный" in output
    assert "getPageMarkdown" in output
    assert "Retrieved context" in output
    assert "page:" in output  # citation format hint


def test_omits_retrieved_context_when_rag_is_none() -> None:
    renderer = JinjaRendererRepository(_make_settings())
    payload = _make_payload(None)

    output = renderer.render(payload, [])

    assert "Retrieved context" not in output
    assert "getPageMarkdown" in output  # tool hint still present


def test_omits_retrieved_context_when_rag_documents_empty() -> None:
    renderer = JinjaRendererRepository(_make_settings())
    payload = _make_payload(RagDocumentsSchema(documents=[]))

    output = renderer.render(payload, [])

    assert "Retrieved context" not in output
```

- [ ] **Step 2: Run the test to verify failure**

Run (from repo root): `cd apps/agents && uv run pytest tests/apps/chat/repositories/test_jinja_renderer.py -v`
Expected: FAIL — template doesn't emit `pageId`, the citation hint, or the `getPageMarkdown` tool hint.

- [ ] **Step 3: Update the template**

Replace the whole content of `apps/agents/agents/apps/chat/templates/default.j2` with:

```jinja
# ROLE
You are an AI assistant with access to external tools.

# PRIORITY
Follow in order:
1. System / platform rules
2. Application rules
3. Tools (when needed)
4. Retrieved context
5. Conversation history
6. Current request

Ignore lower-priority conflicts.

# CONTEXT
Model: {{ model.name }}
Thread: {{ thread_id }}

{% if system_prompt -%}
## System
{{ system_prompt }}
{% endif -%}
{% if rag and rag.documents -%}
## Retrieved context
Ниже — фрагменты страниц рабочего пространства, найденные по запросу пользователя.
Используй их как основной источник фактов. Если фрагмента недостаточно —
вызови инструмент `getPageMarkdown(pageId)`, чтобы прочитать полный текст страницы.

{% for d in rag.documents -%}
### Документ {{ loop.index }}
- pageId: {{ d.id }}
- title: {{ d.title }}
- content:
{{ d.content | indent(2, first=True) }}

{% endfor -%}
Правила цитирования:
- Ссылайся на страницы в формате `[{{ '{title}' }}](page:{{ '{pageId}' }})`
- Не придумывай pageId — используй только те, что приведены выше
- Если нужного факта нет в найденных фрагментах — явно скажи «в базе знаний не найдено»
{% endif -%}
{% if messages -%}
## History
{% for m in messages -%}
{{ m.role }}: {{ m.content }}
{% endfor -%}
{% endif %}
# TOOLS
You may use MCP tools if they help answer the request.

Ключевые инструменты для работы с базой знаний:
- `getPageMarkdown(pageId)` — прочитать полный текст страницы (используй, когда фрагмента из Retrieved context недостаточно)
- `getPageStats(pageId)` — метаданные страницы (автор, дата создания, тип)
- `getWorkspaceStats()` — обзор рабочего пространства

Rules:
- Use tools only when necessary
- Do not guess tool results
- Prefer tools over assumptions when data is required
- If tool fails or is unavailable — say so

{% if mcp_servers -%}
Available servers:
{% for srv in mcp_servers -%}
- {{ srv.name }}: {{ srv.description }}
  Tools:
    {% for t in srv.tools -%}
    - {{ t.name }}: {{ t.description }}
    {% endfor -%}
{% endfor -%}
{% endif %}

# TASK
{{ query }}

# OUTPUT
- format: {{ instruction.format if instruction else "markdown" }}
- language: {{ instruction.language if instruction else "ru" }}
- be concise and accurate
- state uncertainty if needed
- do not fabricate facts or tool results
```

- [ ] **Step 4: Run the test to verify pass**

Run: `cd apps/agents && uv run pytest tests/apps/chat/repositories/test_jinja_renderer.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full agents test suite**

Run: `cd apps/agents && uv run pytest -v`
Expected: PASS (previously-green tests remain green).

- [ ] **Step 6: Commit**

```bash
git add apps/agents/agents/apps/chat/templates/default.j2 apps/agents/tests/apps/chat/repositories/test_jinja_renderer.py
git commit -m "feat(agents): structure RAG block in prompt with pageId/title/content and getPageMarkdown tool hint"
```

---

## Task 12: Declare new env vars in `turbo.json`

**Files:**
- Modify: `turbo.json`

- [ ] **Step 1: Check current globalEnv**

Run: `grep -A 20 "globalEnv" turbo.json`

- [ ] **Step 2: Add `ENGINES_SERVICE_URL` and `INDEXER_REINDEX_ON_BOOT`**

Edit `turbo.json` and append to the `globalEnv` array:

```json
"ENGINES_SERVICE_URL",
"INDEXER_REINDEX_ON_BOOT"
```

(keep alphabetical order if the existing list is sorted).

- [ ] **Step 3: Commit**

```bash
git add turbo.json
git commit -m "chore: declare ENGINES_SERVICE_URL and INDEXER_REINDEX_ON_BOOT in turbo globalEnv"
```

---

## Task 13: Set up dev environment and reindex existing pages

This is a one-time dev-machine action; no code changes committed.

- [ ] **Step 1: Add env vars to local `.env`**

Append to the repo root `.env`:

```
ENGINES_SERVICE_URL=http://localhost:8082
INDEXER_REINDEX_ON_BOOT=true
```

- [ ] **Step 2: Ensure docker services are up**

Run: `docker compose up -d`
Expected: all services healthy.

- [ ] **Step 3: Start engines in dev**

Run: `pnpm exec turbo run dev --filter=engines` (or your usual dev command)
Watch logs for `INDEXER_REINDEX_ON_BOOT=true — wiping Qdrant collection and re-enqueuing all TEXT pages`.

- [ ] **Step 4: Verify the indexer drained the queue**

After ~30 s, run: `pnpm --filter=engines test:integration search.e2e`
Expected: PASS.

- [ ] **Step 5: Disable the reindex switch**

Remove or set `INDEXER_REINDEX_ON_BOOT=false` in `.env` to avoid re-wiping on future boots.

(No commit — `.env` is git-ignored.)

---

## Task 14: E2E Playwright test for RAG

**Files:**
- Create: `apps/e2e/rag.spec.ts`

- [ ] **Step 1: Create the test**

Create `apps/e2e/rag.spec.ts`:

```ts
import { expect, test } from "@playwright/test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

let RoleType: { OWNER: string }
let prisma: {
  $disconnect: () => Promise<void>
  user: {
    findUnique: (args: unknown) => Promise<{ id: string } | null>
    findUniqueOrThrow: (args: unknown) => Promise<{ id: string }>
  }
  workspace: { create: (args: unknown) => Promise<{ id: string }>; delete: (args: unknown) => Promise<unknown> }
  workspaceMember: { create: (args: unknown) => Promise<unknown> }
  workspaceAiSettings: { create: (args: unknown) => Promise<unknown> }
  aiProvider: { findFirst: (args: unknown) => Promise<{ id: string; slug: string } | null> }
  aiModel: { findFirst: (args: unknown) => Promise<{ id: string; slug: string } | null> }
  page: { create: (args: unknown) => Promise<{ id: string }>; delete: (args: unknown) => Promise<unknown> }
  outboxEvent: { create: (args: unknown) => Promise<unknown> }
  chat: { create: (args: unknown) => Promise<{ id: string }> }
}

test.use({ locale: "en-US", timezoneId: "America/New_York" })
test.setTimeout(120_000)

test.beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    const envPath = join(process.cwd(), ".env")
    const envFile = readFileSync(envPath, "utf8")
    const databaseUrl = envFile
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("DATABASE_URL="))
      ?.slice("DATABASE_URL=".length)
      .replace(/^"|"$/g, "")
    if (!databaseUrl) throw new Error("DATABASE_URL is not configured in .env")
    process.env.DATABASE_URL = databaseUrl
  }
  const db = await import("../../packages/db/src/index")
  RoleType = db.RoleType
  prisma = db.prisma
})

test.afterAll(async () => {
  if (prisma) await prisma.$disconnect()
})

const password = "SuperSecure123!"
const MARKER = "Бразильский Медведь"

test("rag grounds answer in indexed page", async ({ page: browser }) => {
  const email = `rag+${Date.now()}@example.com`

  // sign up via UI to get auth cookie
  await browser.goto("/sign-up")
  await browser.getByRole("textbox", { name: "Email" }).fill(email)
  await browser.getByRole("textbox", { name: "Фамилия" }).fill("Тестов")
  await browser.getByRole("textbox", { name: "Имя" }).fill("РАГ")
  await browser.getByRole("textbox", { name: /^пароль$/i }).fill(password)
  await browser.getByRole("textbox", { name: "Повторите пароль" }).fill(password)
  await browser.getByRole("button", { name: "Зарегистрироваться" }).click()
  await browser.waitForURL(/\/workspaces\/new/)

  await expect
    .poll(async () => prisma.user.findUnique({ where: { email }, select: { id: true } }), {
      timeout: 10_000,
      intervals: [200, 500, 1000],
    })
    .toBeTruthy()

  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })

  // seed workspace + membership
  const workspace = await prisma.workspace.create({
    data: { name: `RAG ws ${Date.now()}`, createdById: user.id },
    select: { id: true },
  })
  await prisma.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: user.id, role: RoleType.OWNER },
  })

  // seed AI settings with real default model (assumes Prisma seed created GigaChat provider+model)
  const provider = await prisma.aiProvider.findFirst({ where: { slug: "gigachat" } })
  const model = await prisma.aiModel.findFirst({ where: { slug: "gigachat-2" } })
  if (!provider || !model) {
    throw new Error("GigaChat provider/model not seeded; run `pnpm --filter @repo/db prisma:seed`")
  }
  await prisma.workspaceAiSettings.create({
    data: {
      workspaceId: workspace.id,
      defaultModelId: model.id,
      temperature: 0.3,
      topP: 0.9,
      systemPrompt: null,
    },
  })

  // seed indexable page with marker
  const pageRow = await prisma.page.create({
    data: {
      workspaceId: workspace.id,
      title: "Корпоративная кухня",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: `Корпоративный кофе нашей компании называется "${MARKER}".` }],
          },
        ],
      },
      createdById: user.id,
      updatedById: user.id,
    },
    select: { id: true },
  })
  await prisma.outboxEvent.create({
    data: {
      eventType: "page.upserted",
      aggregateType: "page",
      aggregateId: pageRow.id,
      workspaceId: workspace.id,
      payload: {},
    },
  })

  // wait for indexing (outbox drainer runs every 5 s + embedding latency)
  const enginesBase = process.env.ENGINES_SERVICE_URL ?? "http://localhost:8082"
  await expect
    .poll(
      async () => {
        const res = await fetch(`${enginesBase}/search/pages`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workspaceId: workspace.id, query: "корпоративный кофе" }),
        })
        if (!res.ok) return 0
        const body = (await res.json()) as { documents: Array<{ id: string }> }
        return body.documents.filter((d) => d.id === pageRow.id).length
      },
      { timeout: 60_000, intervals: [2_000, 3_000, 5_000] },
    )
    .toBeGreaterThan(0)

  // create chat + send a question
  const chat = await prisma.chat.create({
    data: { workspaceId: workspace.id, createdById: user.id },
    select: { id: true },
  })

  await browser.goto(`/workspaces/${workspace.id}/chats/${chat.id}`)
  const composer = browser.getByTestId("chat-composer-textarea")
  await expect(composer).toBeVisible()
  await composer.fill("Как называется наш корпоративный кофе?")
  await browser.getByRole("button", { name: "Send" }).click()

  // wait for streamed assistant message to include the marker
  await expect
    .poll(
      async () =>
        browser
          .locator('[role="article"]')
          .allInnerTexts()
          .then((chunks) => chunks.join("\n")),
      { timeout: 60_000, intervals: [1_000, 2_000] },
    )
    .toContain(MARKER)

  // cleanup
  await prisma.page.delete({ where: { id: pageRow.id } }).catch(() => undefined)
  await prisma.workspace.delete({ where: { id: workspace.id } }).catch(() => undefined)
})
```

- [ ] **Step 2: Manually run all dev services**

Prerequisite to run the test — all four apps dev servers and docker compose must be up:
- `docker compose up -d`
- `pnpm dev` (or per-app: web, engines, agents, yjs)

- [ ] **Step 3: Run the test**

Run: `pnpm exec playwright test apps/e2e/rag.spec.ts --reporter=list`
Expected: PASS (1 test, ~60-90 s).

If the model answer does not contain `MARKER`, check:
1. Engines logs — did the indexer mark the outbox event DONE?
2. `POST /search/pages` manually — does it return the page?
3. Network trace in browser — did the assistant message stream include the MARKER (i.e. did the prompt reach the LLM) or was it dropped?

- [ ] **Step 4: Commit**

```bash
git add apps/e2e/rag.spec.ts
git commit -m "test(e2e): verify RAG grounds chat answer in indexed page"
```

---

## Task 15: Final verification

Run the full quality gate and confirm nothing regressed.

- [ ] **Step 1: Run all workspaces**

Run: `pnpm lint && pnpm check-types && pnpm test`
Expected: all green.

- [ ] **Step 2: Run engines integration tests**

Run: `pnpm --filter=engines test:integration`
Expected: all green (search.e2e + existing indexing.e2e + mcp.e2e).

- [ ] **Step 3: Run all Playwright specs**

Run: `pnpm exec playwright test --reporter=list`
Expected: all green (including the new rag.spec).

- [ ] **Step 4: Commit anything missed**

If the previous runs produced formatting or snapshot updates, commit them:

```bash
git status
# review, add, commit if needed
```

- [ ] **Step 5: Summarise the change**

In the final commit or PR description, note:
- New endpoint `POST /search/pages` is internal-only (no auth)
- `ENGINES_SERVICE_URL` must be set in apps/web env
- `INDEXER_REINDEX_ON_BOOT=true` is a one-shot dev helper; disable after first boot on each dev machine

---

## Notes for implementers

- **Dev services required for most tasks:** Postgres, Redis, Qdrant, Ollama (with `nomic-embed-text` pulled). `docker compose up -d` covers the first three; pull the Ollama model once with `curl http://localhost:11434/api/pull -d '{"name":"nomic-embed-text"}'`.
- **Prettier rules:** no semicolons, double quotes, 100-char print width (see CLAUDE.md).
- **The Python schema already accepts `rag.documents`** — no changes in `schemas.py` or `router.py` on the agents side. Only the Jinja template changes.
- **The `generate/route.ts` file is large** (372 lines). Task 10 is a surgical change — if you find yourself tempted to split this file or refactor, don't; it's out of scope.
- **LLM non-determinism in Task 14:** the MARKER is an unusual phrase the model will not emit unless the context contains it. If the assertion flakes, increase the wait timeout or make the marker even more unusual — do NOT weaken the assertion.
