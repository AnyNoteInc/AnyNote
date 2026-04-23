---
status: approved
date: 2026-04-22
topic: RAG retrieval end-to-end
---

# RAG Retrieval — Design

## Goal

Enable the workspace chat to ground answers in the user's indexed pages. Given a user message, the system must:

1. Find the most relevant page chunks in Qdrant (workspace-scoped)
2. Attach the top-K pages as `rag.documents` to the agents payload
3. Render them in the LLM prompt so the model can cite and/or fetch full text via the `getPageMarkdown` MCP tool

Indexing already runs end-to-end. What's missing is the retrieval layer and prompt-side integration.

## Current state (summary)

- Indexing pipeline writes 768-dim embeddings to the active Qdrant collection (`QDRANT_COLLECTION`, default `page_chunks`) with payload `{pageId, workspaceId, chunkIndex}`.
- Python agent schema (`QueryRequestSchema.rag: RagDocumentsSchema`) and the Jinja2 template (`default.j2`) already accept `rag.documents[]` — the agents service needs no transport changes, only prompt polish.
- No search endpoint exists. apps/web has no Qdrant/Ollama client.
- MCP tool `getPageMarkdown(pageId)` exists and is the natural way for the LLM to pull full page text when a chunk is insufficient.

## Non-goals

- Hybrid BM25 + vector search
- Cross-encoder reranking
- Caching of embeddings for repeat queries
- RAG over files / other page types (only TEXT pages are indexed today)
- Exposing a public search API (the endpoint is an internal service)

## Architecture

```
User sends message
       │
       ▼
apps/web POST /api/agents/generate
       │
       ├──► apps/engines  POST /search/pages   (NEW)
       │       { workspaceId, query, topK=5 }
       │            │
       │            ├── embed(query) via Ollama
       │            ├── Qdrant search (filter workspaceId, threshold 0.35)
       │            ├── dedupe by pageId → keep best-scoring chunk per page
       │            └── return [{ id, title, content, score, updatedAt, pageType }]
       │
       ├── Map to rag.documents[] (strip score/updatedAt/pageType before sending)
       │
       └──► apps/agents POST /chat/generate
             body: { ..., rag: { documents: [...] } }
                   │
                   └── default.j2 renders Retrieved-context block → LLM
```

RAG retrieval is best-effort. If engines is unavailable the chat still works — we log a warning and pass `rag: { documents: [] }`.

## Section 1: Extended chunk metadata (apps/engines)

### Files changed
- `apps/engines/src/apps/indexer/services/qdrant-writer.service.ts` — widen `QdrantPoint.payload` type
- `apps/engines/src/apps/indexer/queue/indexing.processor.ts` — populate new fields from the Prisma `page` record

### New payload shape
```ts
type QdrantPoint = {
  id: string
  vector: number[]
  payload: {
    pageId: string           // existing
    workspaceId: string      // existing
    chunkIndex: number       // existing
    title: string            // NEW — page.title
    content: string          // NEW — normalized chunk text
    pageType: string         // NEW — "TEXT" | "GENOGRAM" | "EXCALIDRAW"
    createdById: string      // NEW — page.createdById
    createdAt: string        // NEW — ISO-8601 (page.createdAt)
    updatedAt: string        // NEW — ISO-8601 (page.updatedAt)
  }
}
```

### IndexingProcessor changes
Extend the Prisma `select` to include `title`, `createdById`, `createdAt`, `updatedAt` (type/ownership already present). Propagate these fields (plus the normalized chunk text) into every `QdrantPoint.payload`.

### Backfill strategy
Existing points lack the new fields. For dev we clear and reindex:
1. Add an env switch `INDEXER_REINDEX_ON_BOOT=true`
2. On `onApplicationBootstrap`, if the switch is true, delete all points from the collection and enqueue a `page.upserted` outbox event for every non-deleted TEXT page.
3. The normal worker consumes these events and re-embeds with the new payload.

If the switch is absent or `false`, nothing happens (safe default for prod).

### Tests
- `qdrant-writer.service.spec.ts` — update expected payload shape
- `indexing.processor.spec.ts` — assert every upserted point carries the six new fields

## Section 2: Search endpoint (apps/engines)

### New module layout
```
apps/engines/src/apps/search/
  search.module.ts
  search.controller.ts
  services/
    page-search.service.ts
    page-search.service.spec.ts
  dto/
    search.schema.ts
```

Wired into `AppModule` alongside `IndexerModule` and `McpModule`.

### HTTP contract

`POST /search/pages`

Request:
```ts
{
  workspaceId: string      // UUID
  query: string            // trimmed, non-empty
  topK?: number            // default 5, max 20
  scoreThreshold?: number  // default 0.35, range 0..1
}
```

Response:
```ts
{
  documents: Array<{
    id: string             // pageId (UUID)
    title: string
    content: string        // best-matching chunk text
    score: number          // cosine similarity, 0..1
    updatedAt: string      // ISO-8601
    pageType: string
  }>
}
```

### `PageSearchService.search` algorithm
1. `vector = await embedding.embed(query)` — reuses existing `EmbeddingClient` / `OllamaService`
2. `hits = await qdrant.client.search(collection, { vector, filter: { must: [{ key: "workspaceId", match: { value: workspaceId } }] }, limit: topK * 3, score_threshold, with_payload: true })`
3. Dedupe hits: `Map<pageId, bestHit>`, keeping the max-score entry per pageId
4. Sort by score desc, slice to `topK`
5. Map to `RagDocument` shape

### Validation
Use a small `zod` schema (`search.schema.ts`) at the controller boundary: `workspaceId` UUID, `query` non-empty, `topK` integer 1..20, `scoreThreshold` float 0..1. This matches the lightweight validation pattern already used in the repo better than introducing Nest/class-validator DTOs just for this endpoint.

### Security
The endpoint has no auth middleware — engines is an internal service bound to the docker/VPC network. Never expose on the public ingress. Document this in `search.controller.ts` header comment.

### Tests
- `page-search.service.spec.ts` (unit, mocked Ollama + Qdrant): dedupe, threshold filtering, topK cap, empty-workspace returns `[]`
- `apps/engines/test/integration/search.e2e.spec.ts` (integration, real Qdrant): index a page via outbox, poll until available, call `/search/pages`, assert the page is found with correct title + content snippet

## Section 3: apps/web integration

### New file
`apps/web/src/lib/chat/rag-search.ts`

```ts
export type RagDocument = { id: string; title: string; content: string }

export async function searchRagDocuments(args: {
  workspaceId: string
  query: string
  topK?: number
  signal?: AbortSignal
}): Promise<RagDocument[]>
```

Behaviour:
- POSTs to `${ENGINES_SERVICE_URL}/search/pages` (default `http://localhost:8082`)
- 5 s timeout
- Returns `[]` on any failure (network, non-2xx, parse error). Logs a warning; never throws.
- Maps response `documents[]` to `RagDocument[]` — drops `score`, `updatedAt`, `pageType` (Python schema does not accept them)

### Files modified
- `apps/web/src/lib/chat/agents-payload.ts` — add `rag` to `buildAgentsPayload` output and to the arg type
- `apps/web/src/app/api/agents/generate/route.ts` — call `searchRagDocuments` after settings load, before `streamAgentsToRegistry`. Pass result into `buildAgentsPayload`.

### agents-payload.ts additions
```ts
export type RagDocument = { id: string; title: string; content: string }

export function buildAgentsPayload(args: {
  ...
  rag: RagDocument[]     // always present, empty array if no hits
}) {
  return {
    ...,
    rag: { documents: args.rag },
    ...
  }
}
```

### Tests
- `apps/web/src/lib/chat/rag-search.test.ts` — happy path, 5xx → `[]`, timeout → `[]`, malformed JSON → `[]`
- `apps/web/src/lib/chat/agents-payload.test.ts` (extend) — rag field serialized correctly

## Section 4: Prompt template improvements (apps/agents)

### File modified
`apps/agents/agents/apps/chat/templates/default.j2`

### Changes to the `## Retrieved context` block
Replace the current bullet list with a structured per-document block that exposes `id`, `title`, and properly-indented content:

```jinja
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
- Ссылайся на страницы в формате [{{ '{title}' }}](page:{{ '{pageId}' }})
- Не придумывай pageId — используй только те, что приведены выше
- Если нужного факта нет в найденных фрагментах — явно скажи «в базе знаний не найдено»
{% endif -%}
```

### Changes to the `# TOOLS` block
Add a knowledge-base sub-section listing the most relevant MCP tools:

```jinja
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
```

The existing `{% if mcp_servers %}` loop stays untouched below.

### Tests
- `apps/agents/tests/apps/chat/repositories/test_jinja_renderer.py` — render with two rag documents, assert: `pageId` string appears, `title` appears, content is indented two spaces under `content:`, citation-format instruction appears, `getPageMarkdown` is mentioned in TOOLS.
- Negative test — render without `rag` (None) produces no Retrieved-context section.

## Section 5: E2E verification

### Playwright spec
`apps/e2e/rag.spec.ts`

**Setup (via Prisma seed helper)**:
- Test user + workspace
- Workspace AI settings with a real default model (GigaChat, same as existing chat-streaming tests)
- One TEXT page containing a distinctive, LLM-unknowable fact. Default marker: `Корпоративный кофе называется "Бразильский Медведь"`.

Mirror the approach used by the existing chat-streaming E2E: direct Prisma calls from the test file (`apps/e2e/rag.spec.ts`) create/cleanup fixtures, no HTTP seed endpoint. Trigger indexing by inserting the outbox event in the same transaction as the page (matches how the indexer runs in production).

**Test steps**:
1. Prisma seed helper inserts user, workspace, AI settings, page, outbox event.
2. Poll `POST /search/pages` with query containing the marker ("корпоративный кофе") until `documents.length > 0` or 10 s timeout. This confirms indexing ran before we query the chat.
3. UI login, open/create a chat in the test workspace, type "Как называется наш корпоративный кофе?", submit.
4. Wait for SSE stream to complete (`message.done`).
5. Read the assistant message text from the DOM.

**Assertions**:
- Assistant response contains the substring `Бразильский Медведь` (proves RAG made the difference — the model could not produce this without retrieved context).
- Final `ChatMessage.status = "DONE"` in DB for both user and assistant.
- Zero console errors.

**Timeouts**: 60 s test-wide (streaming + LLM latency).

**LLM non-determinism**: we assert substring presence only, not exact wording. The marker is designed to be unusual enough that a GigaChat hallucination would not emit it unless the context supplied it.

### Cross-cutting QA
All existing tests in `apps/engines`, `apps/web`, `apps/agents`, `@repo/ui` must stay green. Add the new tests to `turbo.json` inputs where relevant (tests typically auto-discovered).

## Environment variables

Add to repo root `.env` and `turbo.json` globalEnv:

- `ENGINES_SERVICE_URL` — new, e.g. `http://localhost:8082` (read by apps/web). Not currently declared.
- `INDEXER_REINDEX_ON_BOOT` — new, optional `true/false`, default unset. Only honoured in dev to force full reindex after payload shape changes.

Existing used: `QDRANT_URL`, `QDRANT_API_KEY`, `QDRANT_COLLECTION`, `OLLAMA_BASE_URL`, `EMBEDDING_MODEL`, `AGENTS_SERVICE_URL`.

## Observability

- apps/engines: `search.controller.ts` logs every query (redact content, log `{ workspaceId, query.length, topK, hits, durationMs }`)
- apps/web: `rag-search.ts` logs warnings on failure (`Nest RAG unavailable: <reason>`)
- No metrics counters added in this cut — surface later if needed.

## Error handling summary

| Failure | Behaviour |
|---|---|
| Ollama down during indexing | Existing retry logic in IndexingProcessor |
| Ollama down during search | `/search/pages` returns 503; apps/web treats as `[]` |
| Qdrant down during search | `/search/pages` returns 503; apps/web treats as `[]` |
| Engines HTTP down during search | apps/web timeout → `[]` |
| No hits above threshold | 200 OK with `documents: []` |
| Workspace has zero indexed pages | 200 OK with `documents: []` |
| Payload missing new fields (pre-reindex) | Search still works; `title`/`content` default to `""`. Triggers a log warning. |

## Decisions (for future readers)

1. **Where does search live?** apps/engines — because Qdrant + Ollama clients already exist there, avoiding cross-package drift of the embedding model and vector dimension.
2. **Chunk-level or page-level results?** Page-level with dedupe — cleaner semantics for citation (`id = pageId`), and the LLM can pull full text via `getPageMarkdown`.
3. **Top-K?** 5 pages, score threshold 0.35. Small enough to keep the prompt tight, large enough for recall.
4. **Store normalized chunk text in Qdrant payload?** Yes — avoids a round-trip to Postgres when building `rag.documents`. Cost is payload size, acceptable at our scale.
5. **Auth on the search endpoint?** None — internal service, network-scoped. Document this in the controller.
