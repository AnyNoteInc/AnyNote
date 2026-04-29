---
status: approved
date: 2026-04-29
topic: per-workspace embeddings model selection
---

# Per-Workspace Embeddings Model — Design

## Goal

Make the vectorization model (currently a single hardcoded Ollama embedder) selectable per workspace, with three concrete providers supported on day one — Ollama, OpenAI, GigaChat. A workspace without a chosen embeddings model is silently skipped during indexing and during the RAG retrieval phase of chat answer generation.

When a workspace switches embeddings models, all existing vectors for that workspace are wiped from Qdrant and the workspace's pages are re-enqueued for fresh vectorization under the new model.

## Current state

- `AiModel` and `WorkspaceAiSettings` exist and already model the LLM-side choice ([packages/db/prisma/schema.prisma:343-389](packages/db/prisma/schema.prisma#L343-L389)).
- Vectorization in `apps/agents` is hardcoded to a single `OllamaEmbeddings` instance provisioned at app scope ([apps/agents/agents/apps/processing/depends.py:24-37](apps/agents/agents/apps/processing/depends.py#L24-L37)).
- A single Qdrant collection named `pages` is used globally with a fixed `vector_size=768`.
- The chat side already has a multi-provider model factory for LLMs ([apps/agents/agents/apps/chat/repositories/model_factory.py:16-52](apps/agents/agents/apps/chat/repositories/model_factory.py#L16-L52)) — we mirror its shape for embeddings.
- The indexer cron drains `outbox_events` and POSTs to `apps/agents /vectorization` ([apps/engines/src/apps/indexer/cron/vectorization-cron.service.ts](apps/engines/src/apps/indexer/cron/vectorization-cron.service.ts)). Workspace plan-feature gating already short-circuits indexing when disabled.
- The AI settings page renders only the LLM section ([apps/web/src/components/workspace/settings/ai-section.tsx](apps/web/src/components/workspace/settings/ai-section.tsx)).

## Non-goals

- Migrating data from the existing `pages` Qdrant collection. On rollout the collection is dropped; every workspace's `embeddingsModelId` defaults to `null` and re-indexing happens once a user explicitly picks a model.
- Background-job UI showing reindex progress per workspace.
- A "Reindex now" button that does not change the model.
- Multi-collection retrieval (combining vectors from several models).
- A garbage-collector for orphan vectors left behind by in-flight cron jobs that finished after a model switch (acknowledged in concurrency notes; out of scope for the first cut).
- Custom chunking/normalization knobs per workspace.
- Per-workspace storage of provider credentials. Credentials live on the seeded `AiProvider.connection` row and are passed through the agents payload.

## Architecture

```
Workspace settings UI (apps/web)
       │ (mutation: aiSettings.update with embeddingsModelId)
       ▼
tRPC aiSettings.update                                          ──► AgentsClient.deleteWorkspaceVectors(workspaceId)
       │ (transaction)                                                          │
       ├─ upsert WorkspaceAiSettings.embeddingsModelId                          ▼
       ├─ cancel PENDING outbox events for workspace                  apps/agents
       └─ enqueue page.upserted for every TEXT page in workspace      DELETE /vectorization/workspaces/{workspaceId}
                                                                          │ (iterate pages_* collections, delete by workspaceId filter)
                                                                          ▼
indexer cron (apps/engines)                                            Qdrant
       │ tick → claim outbox events
       ▼
processRow:
   ├─ load WorkspaceAiSettings JOIN AiModel JOIN AiProvider          (late binding — current model wins)
   │   if embeddingsModel is null OR vectorSize is null → DONE, skip
   │
   └─ POST /vectorization to apps/agents
        body now includes: embedding { provider, modelSlug, vectorSize, connection }
                                                                       │
                                                                       ▼
                                                            apps/agents VectorizePageUseCase
                                                                ├─ EmbeddingFactory.make(payload.embedding) → Embeddings
                                                                ├─ collection name = pages_{provider}_{modelSlug}
                                                                ├─ ensure_collection(name, size=vectorSize)
                                                                ├─ embed_batch + upsert
                                                                
chat generate (apps/web → apps/agents)
   apps/web fetches workspace's embeddings model in the same join shape
   payload now includes: embedding | null
   apps/agents GraphService:
       if embedding is null → RAG node not built → no retrieval, no <context> block
       else → similarity_search(collection_name, embeddings, workspace_id, query, k)
```

## Section 1: Schema changes (packages/db)

### 1.1 `AiModel`

Add two fields:

```prisma
model AiModel {
  // ... existing fields
  supportsVision     Boolean @default(false) @map("supports_vision")
  supportsEmbeddings Boolean @default(false) @map("supports_embeddings")
  vectorSize         Int?    @map("vector_size")
  // ...
}
```

- `supportsEmbeddings` — boolean capability flag, parallels existing `supportsVision`.
- `vectorSize Int?` — required for any model with `supportsEmbeddings = true`, otherwise null. Used by `apps/agents` to call `ensure_collection(size=...)`. Storing in DB (rather than hardcoding in agents) keeps embeddings model registration data-driven.
- App-level invariant (enforced in tRPC validation, not in DB constraint to avoid migrations on existing rows): `supportsEmbeddings = true ⇒ vectorSize != null`.

### 1.2 `WorkspaceAiSettings`

Add one field with a named relation, alongside the existing `defaultModelId` relation:

```prisma
model WorkspaceAiSettings {
  // ... existing fields
  defaultModelId    String? @map("default_model_id") @db.Uuid
  embeddingsModelId String? @map("embeddings_model_id") @db.Uuid
  // ...

  defaultModel    AiModel? @relation("WorkspaceAiSettings_default",    fields: [defaultModelId],    references: [id], onDelete: SetNull)
  embeddingsModel AiModel? @relation("WorkspaceAiSettings_embeddings", fields: [embeddingsModelId], references: [id], onDelete: SetNull)

  @@index([defaultModelId])
  @@index([embeddingsModelId])
}
```

- `onDelete: SetNull` — when an embeddings model is deactivated or deleted, the workspace setting clears. Indexer will then skip; UI shows "Не выбрано".
- `defaultModelId` and `embeddingsModelId` are independent — the same row in `AiModel` cannot satisfy both meaningfully (LLM vs embeddings models are distinct). Application-side validation enforces:
  - `defaultModelId` → `supportsEmbeddings = false` (or simply: cannot point to an embeddings-only model — the existing `listAvailableModels` already filters that effectively).
  - `embeddingsModelId` → `supportsEmbeddings = true AND vectorSize != null`.

### 1.3 Typed connection schema

`AiProvider.connection` is currently `Json` ([packages/db/prisma/schema.prisma:347](packages/db/prisma/schema.prisma#L347)). Add a Zod schema in `packages/db/src` (or a shared location consumed by both `packages/trpc` and `apps/engines`):

```ts
export const AiProviderConnectionSchema = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('ollama'),   baseUrl: z.string().url() }),
  z.object({ provider: z.literal('openai'),   apiKey: z.string().min(1), organization: z.string().optional(), baseUrl: z.string().url().optional() }),
  z.object({ provider: z.literal('gigachat'), clientId: z.string().min(1), clientSecret: z.string().min(1), scope: z.string().optional() }),
])
export type AiProviderConnection = z.infer<typeof AiProviderConnectionSchema>
```

Note: existing `AiProvider` seed rows store the connection JSON without a `provider` key (for example `{ baseUrl: '...' }` for Ollama). As part of this change the seed adds the `provider` discriminator field and a normalization function reads `AiProvider.connection` and merges in `{ provider: row.slug }` when missing, so both shapes parse cleanly.

### 1.4 Seed additions (`packages/db/prisma/seed.ts`)

Extend the AI providers / models seed block:

- `AiProvider` rows for `ollama`, `openai` (new), `gigachat` already cover the three providers we need. Update existing connection JSON to include `provider: <slug>` discriminator.
- New `AiModel` rows with `supportsEmbeddings = true`:
  - Ollama: `nomic-embed-text` (vectorSize 768), `bge-m3` (vectorSize 1024)
  - OpenAI: `text-embedding-3-small` (vectorSize 1536, `minPlanSlug: 'pro'`), `text-embedding-3-large` (vectorSize 3072, `minPlanSlug: 'max'`)
  - GigaChat: `embeddings-2` (vectorSize 1024) — confirm exact model slug against the GigaChat docs during implementation
- `displayName` is human-readable for the dropdown; `slug` is what `apps/agents` receives.

## Section 2: `apps/agents` — embedding factory, collection naming, delete endpoint

### 2.1 New `EmbeddingFactoryRepository`

New file `apps/agents/agents/apps/processing/repositories/embedding_factory.py`, modeled after [model_factory.py:16-52](apps/agents/agents/apps/chat/repositories/model_factory.py#L16-L52):

```python
@dataclass
class EmbeddingFactoryRepository:
    @staticmethod
    def make(config: EmbeddingProviderConfigSchema) -> Embeddings:
        match config.provider:
            case ModelProviderEnum.OLLAMA:
                return OllamaEmbeddings(model=config.model_slug, base_url=config.connection.base_url)
            case ModelProviderEnum.OPENAI:
                return OpenAIEmbeddings(
                    model=config.model_slug,
                    api_key=SecretStr(config.connection.api_key),
                    organization=config.connection.organization,
                    base_url=config.connection.base_url,
                )
            case ModelProviderEnum.GIGACHAT:
                credentials = b64encode(f"{config.connection.client_id}:{config.connection.client_secret}".encode()).decode()
                return GigaChatEmbeddings(
                    credentials=credentials,
                    scope=config.connection.scope or "GIGACHAT_API_PERS",
                    model=config.model_slug,
                    verify_ssl_certs=False,
                )
            case _:
                raise InvalidPayloadError(f"Unknown embedding provider: {config.provider!r}")
```

Existing dependencies in `apps/agents/pyproject.toml` already include `langchain-ollama`, `langchain-openai`, `langchain-gigachat` for the chat factory — no new packages required.

### 2.2 Schema additions

`apps/agents/agents/apps/processing/schemas.py` adds:

```python
class EmbeddingProviderConfigSchema(BaseModel):
    provider: ModelProviderEnum
    model_slug: str = Field(alias='modelSlug')
    vector_size: int = Field(alias='vectorSize')
    connection: ConnectionConfigSchema  # the same union already used by chat ModelConfigSchema

class VectorizationRequestSchema(BaseModel):
    page_id: str = Field(alias='pageId')
    workspace_id: str = Field(alias='workspaceId')
    title: str
    page_type: str = Field(alias='pageType')
    contents: list[BlockContentSchema]
    embedding: EmbeddingProviderConfigSchema   # required
```

If `embedding` is missing → 400 (the indexer never sends a request without an embedding model — it short-circuits earlier).

### 2.3 Collection naming & lifecycle

Collection name function (in `vector_store_repository.py` or a small helper):

```python
def collection_name_for(provider_slug: str, model_slug: str) -> str:
    safe = lambda s: re.sub(r'[^a-z0-9-]+', '-', s.lower()).strip('-')
    return f"pages_{safe(provider_slug)}_{safe(model_slug)}"
```

Examples: `pages_ollama_nomic-embed-text`, `pages_openai_text-embedding-3-small`, `pages_gigachat_embeddings-2`.

`VectorStoreRepository.ensure_collection(name, vector_size)` becomes parameterized (currently uses `self.collection_name` and `self.vector_size`). It is now called per-request from `VectorizePageUseCase`. The bootstrap-time `ensure_collection('pages')` call in [bootstrap.py:32-35](apps/agents/agents/bootstrap.py#L32-L35) is removed.

### 2.4 `VectorizePageUseCase` rewrite

Behaviour per request:

```python
async def __call__(self, payload: VectorizationRequestSchema) -> VectorizationResponseSchema:
    embedder    = self._embedding_factory.make(payload.embedding)
    collection  = collection_name_for(payload.embedding.provider, payload.embedding.model_slug)
    
    await self._vector_store.ensure_collection(collection, payload.embedding.vector_size)
    await self._vector_store.delete_by_page(collection, payload.page_id)
    
    # ... existing chunk + normalize logic unchanged ...
    
    vectors = await embedder.aembed_documents(normalized_texts)
    points  = [...]  # existing assembly
    await self._vector_store.upsert_chunks(collection, points)
    return VectorizationResponseSchema(...)
```

Note that `delete_by_page` and `upsert_chunks` also gain a `collection_name` parameter (or `VectorStoreRepository` is reshaped to be stateless; see 2.6).

### 2.5 New deletion endpoints

Two new `DELETE` handlers in the processing router. Both are idempotent — empty collection list, zero points, or missing collection all return success.

#### 2.5.1 `DELETE /vectorization/workspaces/{workspace_id}` — wipe a workspace

```python
@router.delete('/workspaces/{workspace_id}', response_model=WorkspaceWipeResponseSchema)
async def delete_workspace_vectors(workspace_id: str, use_case: FromDishka[DeleteWorkspaceVectorsUseCase]) -> WorkspaceWipeResponseSchema:
    return await use_case(workspace_id)
```

```python
async def __call__(self, workspace_id: str) -> WorkspaceWipeResponseSchema:
    collections = await self._vector_store.list_collections()  # client.get_collections()
    deleted_collections: list[str] = []
    for coll in collections:
        if not coll.startswith('pages_'):
            continue
        await self._vector_store.delete_by_workspace(coll, workspace_id)
        deleted_collections.append(coll)
    return WorkspaceWipeResponseSchema(deleted_collections=deleted_collections)
```

`delete_by_workspace(collection, workspace_id)` is a thin wrapper around `client.delete(collection, points_selector=Filter(must=[FieldCondition(key='workspaceId', match=MatchValue(value=workspace_id))]))`.

Used by tRPC `aiSettings.update` after a model change.

#### 2.5.2 `DELETE /vectorization/pages/{page_id}` — wipe a single page

```python
@router.delete('/pages/{page_id}', response_model=PageWipeResponseSchema)
async def delete_page_vectors(page_id: str, use_case: FromDishka[DeletePageVectorsUseCase]) -> PageWipeResponseSchema:
    return await use_case(page_id)
```

The use case iterates `pages_*` collections and calls `delete_by_page(collection, page_id)` (the existing `delete_by_page` from `vector_store_repository.py` extended to take a `collection_name` argument).

Used by the indexer cron to handle `page.deleted` events without depending on the workspace's current embeddings model — see Section 3.1.

### 2.6 Dishka changes

`apps/agents/agents/apps/processing/depends.py`:

- Remove the `OllamaEmbeddings` provider entirely.
- `EmbeddingFactoryRepository` — `Scope.APP`.
- `VectorStoreRepository` becomes stateless (no `embeddings`, no `collection_name`, no `vector_size` in constructor; just `client`). `Scope.APP`.
- New `DeleteWorkspaceVectorsUseCase` — `Scope.REQUEST`.

### 2.7 Settings cleanup

`apps/agents/agents/settings.py`:
- Remove `OllamaSettingsSchema.embedding_model` (no longer used; only the chat side still relies on `OllamaSettingsSchema.host`).
- Remove `QdrantSettingsSchema.collection_name` and `QdrantSettingsSchema.vector_size`.

Env vars `OLLAMA_EMBEDDING_MODEL`, `QDRANT_COLLECTION_NAME`, `QDRANT_VECTOR_SIZE` are dropped from `.env.example` and `turbo.json` `globalEnv`.

## Section 3: `apps/engines` — indexer cron

### 3.1 Late-binding workspace embedding model lookup

In `vectorization-cron.service.ts processRow(row)`, between the existing `pageIndexingEnabled` feature check and the call to `agents.vectorize(...)`:

```ts
const aiSettings = await this.prisma.workspaceAiSettings.findUnique({
  where: { workspaceId: row.workspace_id },
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

const model = aiSettings?.embeddingsModel
if (!model || model.vectorSize == null) {
  await this.markDone(row.id)
  return
}

const connection = AiProviderConnectionSchema.parse({
  provider: model.provider.slug,
  ...(model.provider.connection as Record<string, unknown>),
})
```

**Handling `page.deleted` events:** the new `POST /vectorization` requires an `embedding` field, so we cannot use it to clear a deleted page when the workspace has no embeddings model selected. Instead, deletes use the dedicated `DELETE /vectorization/pages/{pageId}` endpoint (Section 2.5.2), which needs no embedding model. The cron's flow for delete events:

```ts
if (row.event_type === 'page.deleted') {
  await this.agents.deletePageVectors(row.page_id)
  await this.markDone(row.id)
  return
}
```

This runs regardless of whether the workspace has an embeddings model. A deleted page may have leftover vectors from a previously-selected model that's since been cleared — the per-page wipe cleans those up too.

The "no model selected → skip" check above only applies to `page.upserted` events.

### 3.2 `agents-client.service.ts` extensions

```ts
type EmbeddingPayload = {
  provider: 'ollama' | 'openai' | 'gigachat'
  modelSlug: string
  vectorSize: number
  connection: AiProviderConnection
}

export type VectorizationPayload = {
  pageId: string
  workspaceId: string
  title: string
  pageType: string
  contents: Array<{ blockNumber: number; content: string }>
  embedding: EmbeddingPayload
}

@Injectable()
export class AgentsClient {
  // ... existing constructor + vectorize ...

  async deleteWorkspaceVectors(workspaceId: string): Promise<void> { /* DELETE /vectorization/workspaces/:id */ }
  async deletePageVectors(pageId: string): Promise<void>           { /* DELETE /vectorization/pages/:id */ }
}
```

Both delete methods use `AbortController` with the same `30_000` timeout.

### 3.3 Plan-features module

No changes to `PlanFeaturesService.isPageIndexingEnabled` itself. The "no model selected → skip" check is layered on top, in `processRow`. Composition: a workspace with `pageIndexingEnabled = true` plan AND `embeddingsModelId != null` is the one that gets indexed.

## Section 4: tRPC `aiSettings` router

### 4.1 New procedure: `listAvailableEmbeddingModels`

Mirror of `listAvailableModels` but with the embeddings filter:

```ts
listAvailableEmbeddingModels: protectedProcedure
  .input(z.object({ workspaceId: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    await assertWorkspaceMember(ctx, input.workspaceId)
    const models = await getAvailableAiModels(input.workspaceId)
    // filter: supportsEmbeddings === true AND vectorSize != null AND not deprecated
    // group by provider, sort, project to safe shape including vectorSize
    return /* same provider-grouped shape as listAvailableModels, with vectorSize added */
  })
```

### 4.2 `get` extension

`AiSettingsResult` gains `embeddingsModelId: string | null`. The `get` procedure reads it from `WorkspaceAiSettings`.

### 4.3 `update` extension

Input adds `embeddingsModelId: z.string().uuid().nullable().optional()`.

Validation:
- If `embeddingsModelId !== undefined`, validate the model exists, is not deprecated, has `supportsEmbeddings = true`, has a non-null `vectorSize`, and meets the workspace's `minPlanSlug` gate.
- If `null`, no model lookup needed.

Procedure body (high level):

```ts
const before = await ctx.prisma.workspaceAiSettings.findUnique({ where: { workspaceId } })
const oldId = before?.embeddingsModelId ?? null
const newId = input.embeddingsModelId === undefined ? oldId : input.embeddingsModelId
const changed = oldId !== newId

await ctx.prisma.$transaction(async (tx) => {
  await tx.workspaceAiSettings.upsert({
    where: { workspaceId },
    create: { workspaceId, defaultModelId: ..., systemPrompt: ..., embeddingsModelId: newId },
    update: { ..., embeddingsModelId: newId },
  })

  if (changed) {
    await tx.outboxEvent.updateMany({
      where: { aggregateType: 'page', workspaceId, status: 'PENDING' },
      data:  { status: 'DONE', processedAt: new Date() },
    })

    if (newId !== null) {
      const pages = await tx.page.findMany({
        where: { workspaceId, deletedAt: null, type: 'TEXT' },
        select: { id: true },
      })
      // batch into chunks of 5_000 if pages.length > 5_000
      for (const chunk of chunkBy(pages, 5_000)) {
        await tx.outboxEvent.createMany({
          data: chunk.map((p) => ({
            eventType: 'page.upserted',
            aggregateType: 'page',
            aggregateId:   p.id,
            workspaceId,
          })),
        })
      }
    }
  }
})

if (changed) {
  // best effort — failure logged but not fatal; user may retry by saving again
  await ctx.agentsClient.deleteWorkspaceVectors(workspaceId).catch((err) => {
    ctx.logger.error({ err, workspaceId }, 'wipe workspace vectors failed')
  })
}
```

Returns the same `AiSettingsResult` shape (including `embeddingsModelId`). Optionally returns `pagesEnqueued: number` so the UI can show a friendlier success message — included in the spec; the plan can mark it as nice-to-have if it bloats the change.

### 4.4 Where does `agentsClient` come from in tRPC context

The tRPC context is built per request; `apps/web` already proxies to `apps/agents` for chat. We need a thin Node client for the new DELETE endpoint, instantiated once and exposed via `ctx`. Implementation note: place it as a small helper in `apps/web/src/lib/agents-client.ts` (server-only) and add to the tRPC context factory. This is not a new architectural component — it parallels the existing `apps/web → apps/agents` HTTP boundary used for chat.

## Section 5: UI — `WorkspaceAiSection` "Векторизация" block

Extend [apps/web/src/components/workspace/settings/ai-section.tsx](apps/web/src/components/workspace/settings/ai-section.tsx) with a second `Paper` block below the existing LLM block. Same one-form / one-mutation / one-dirty-flag pattern.

### 5.1 Visual layout

```
Paper: "Векторизация"
   Description: "Модель для индексации страниц и поиска по контексту в чатах.
                 Без выбранной модели страницы не индексируются и поиск не работает."

   Select: "Модель векторизации"
     Option (top): "Не выбрано"
     Group: Ollama
        nomic-embed-text (768)
        bge-m3 (1024)
     Group: OpenAI
        text-embedding-3-small (1536) — план ПРО
        text-embedding-3-large (3072) — план МАКС
     Group: GigaChat
        embeddings-2 (1024)

   Helper text (always visible): "⚠ При смене или сбросе модели все векторы
                                  будут удалены и страницы будут проиндексированы
                                  заново. Это может занять время для больших пространств."

   [ Сохранить ]   ← shared with the LLM block above
```

`vectorSize` is shown in parentheses for transparency. Plan-gating dims out-of-plan options with a small label (same pattern as LLM section).

### 5.2 Confirmation gate

If, on save, the chosen `embeddingsModelId` differs from the loaded value, intercept the submit and show a confirm dialog:

> **Сменить модель векторизации?**
> Все ранее проиндексированные данные будут удалены, и страницы начнут векторизироваться заново. На больших пространствах это может занять время.
> 
> [ Отмена ] [ Подтвердить ]

If confirmed → proceed with the existing `aiSettings.update` mutation. The LLM model and system prompt fields are sent in the same call; that's already atomic by virtue of `update` writing all three.

### 5.3 Success / error messaging

Reuse the existing `setMessage`/`setError` `Alert`s. On success after a model change, the success message reads: "Настройки сохранены. Запущена переиндексация N страниц." (using `pagesEnqueued` if returned, otherwise just "Настройки сохранены.").

### 5.4 Initial render

The page-level RSC for `/workspaces/{id}/settings/ai` already pre-fetches available models. Add a parallel pre-fetch for `listAvailableEmbeddingModels` and pass it as `initialEmbeddingModels`, mirroring `initialModels`.

## Section 6: RAG retrieval skip in chat generation

### 6.1 Payload extension

`apps/web /api/agents/generate` route currently constructs the agents payload with the LLM `model` block. Add a sibling:

```ts
embedding: workspaceAiSettings.embeddingsModel
  ? {
      provider:    workspaceAiSettings.embeddingsModel.provider.slug,
      modelSlug:   workspaceAiSettings.embeddingsModel.slug,
      vectorSize:  workspaceAiSettings.embeddingsModel.vectorSize,
      connection:  AiProviderConnectionSchema.parse({
        provider: workspaceAiSettings.embeddingsModel.provider.slug,
        ...(workspaceAiSettings.embeddingsModel.provider.connection as Record<string, unknown>),
      }),
    }
  : null,
```

The same join shape as the indexer.

### 6.2 `apps/agents` graph build

Inside `apps/agents/agents/apps/chat/services/graph.py` (and the use-case that builds the graph): the conditional construction reads `payload.embedding`. If `None` → the RAG-retrieval node is **not added to the graph**. Cleaner than a no-op stub because graph topology is small and explicit construction reads better.

`apps/agents/agents/apps/chat/services/rag_retrieval_service.py` (`RagRetrievalService`) is rewritten to be stateless w.r.t. the embedder:

```python
async def retrieve(
    self,
    *,
    embedding: EmbeddingProviderConfigSchema,
    workspace_id: str,
    query: str,
    k: int = 5,
) -> list[Document]:
    embedder = self._embedding_factory.make(embedding)
    collection = collection_name_for(embedding.provider, embedding.model_slug)
    return await self._vector_store.similarity_search(
        collection_name=collection,
        embeddings=embedder,
        workspace_id=workspace_id,
        query=query,
        k=k,
    )
```

`VectorStoreRepository.similarity_search` becomes:

```python
async def similarity_search(
    self,
    *,
    collection_name: str,
    embeddings: Embeddings,
    workspace_id: str,
    query: str,
    k: int = 5,
) -> list[Document]:
    if not query.strip():
        return []
    if not await self._collection_exists(collection_name):
        return []   # collection not yet created — workspace just picked a model, nothing indexed
    vector = await embeddings.aembed_query(query)
    res = await self._client.query_points(
        collection_name=collection_name,
        query=vector,
        limit=k,
        query_filter=Filter(must=[FieldCondition(key='workspaceId', match=MatchValue(value=workspace_id))]),
        with_payload=True, with_vectors=False,
    )
    return [Document(page_content=str(p.payload.get('content', '')), metadata=dict(p.payload)) for p in res.points if p.payload]
```

### 6.3 Prompt rendering

The Jinja prompt template currently includes a "Retrieved-context" block (per the 2026-04-22 RAG retrieval spec). When the RAG node is omitted from the graph, the renderer receives no `rag.documents` (or an empty list) — the existing `{% if rag.documents %}…{% endif %}` guard already handles that path. No template changes required.

### 6.4 MCP tools unaffected

The MCP tools `search_workspace_pages`, `get_page`, `list_workspace_pages` exposed by `apps/engines` operate on Postgres, not Qdrant. They remain fully functional regardless of embeddings model selection. A workspace without an embeddings model still gets useful answers — just without vector-grounded context.

## Concurrency notes (recap)

When a workspace switches embeddings model from A to B (or to/from null):

1. The transaction inside `aiSettings.update` (a) writes the new setting, (b) cancels all `PENDING` outbox events for the workspace, (c) enqueues fresh `page.upserted` events for every TEXT page.
2. After the transaction, `DELETE /vectorization/workspaces/{id}` is called. Best effort — if it fails, logged and not retried automatically; settings are already saved and reindex is already enqueued.
3. **Race window:** a cron worker that already claimed an outbox event under model A may complete its `agents.vectorize(...)` call **after** the wipe. Since model A and model B write to **different collections**, the late write lands in collection A (which is no longer queried for this workspace). The orphan points sit harmlessly until manual cleanup. Acknowledged trade-off — if it becomes a real problem we add a periodic janitor pass.
4. Cron's late-binding lookup of `WorkspaceAiSettings.embeddingsModel` at `processRow` time means freshly-claimed events always use the current model, so the race only affects events that had already cleared the JOIN read before the model change committed.

## Roll-out

1. Schema migration adds `supports_embeddings`, `vector_size`, `embeddings_model_id` columns. Existing rows get defaults (`false`, `null`, `null`). No data migration needed.
2. Seed update adds OpenAI provider row + four embeddings model rows. Existing `AiProvider.connection` rows get the `provider` discriminator field added.
3. Existing Qdrant `pages` collection is left untouched but unused. A one-time manual `qdrant_client.delete_collection('pages')` cleans it up. No automated drop in deploy scripts to avoid accidental data loss in staging.
4. After deploy, every workspace defaults to `embeddingsModelId = null` → indexing skipped, RAG skipped. Users opt in via Settings → AI → Векторизация. Their first selection triggers a full vectorization of the workspace.

## Testing

- **Unit (Python):** `EmbeddingFactoryRepository.make` — one test per provider (mock the provider client constructor); rejects unknown provider.
- **Unit (Python):** `collection_name_for` — happy path + dot/underscore normalization + idempotence.
- **Integration (Python, `apps/agents`):** `VectorizePageUseCase` against a real Qdrant test container with each of two distinct vector sizes (768 and 1536) — same workspace, different collections, no cross-contamination on similarity search.
- **Integration (Python, `apps/agents`):** `DELETE /vectorization/workspaces/{id}` removes only the targeted workspace's points across multiple collections.
- **Unit (TS, `packages/trpc`):** `aiSettings.update` validates `embeddingsModelId` (allowed model, plan-gated, supportsEmbeddings/vectorSize); transaction cancels PENDING + enqueues new events; HTTP delete called only when changed; no-op when unchanged.
- **Unit (TS, `apps/engines`):** `processRow` path — workspace with no model → DONE+skip; workspace with model → call agents with the right `embedding` payload.
- **E2E (Playwright):** select a model in Settings → AI → Векторизация → confirm dialog → success message → outbox events appear in DB. Then change model → wipe + re-enqueue happens. Then clear model → wipe + no enqueue.

## Open items deliberately left to the implementation plan

- Exact GigaChat embeddings model slug and `vectorSize`. The spec uses `embeddings-2` / 1024 as a placeholder; verify against current GigaChat API docs while seeding.
- Whether to split `RagRetrievalService` graph node insertion at `GraphService` build time or at use-case run time (depends on existing graph builder structure not fully read in brainstorm). The behavior is unambiguous either way.
- The `agentsClient` injection pattern into the tRPC context (where exactly to instantiate it; whether to share a single fetch wrapper between LLM proxy and embeddings DELETE).
