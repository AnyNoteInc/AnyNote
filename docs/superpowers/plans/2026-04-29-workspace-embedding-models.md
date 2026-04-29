# Workspace Embedding Model Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit per-workspace embedding model selection so indexing and RAG use the workspace's chosen model, and skip cleanly when no vectorizer is selected.

**Architecture:** Prisma stores embedding capability on `AiModel` and the selected vectorizer on `WorkspaceAiSettings`. `apps/engines` late-binds the current workspace vectorizer before calling `apps/agents`, while `apps/agents` owns embedding creation, per-model Qdrant collection lifecycle, vector writes, deletion, and RAG retrieval. `apps/web` and `packages/trpc` expose the setting and pass the selected model through generation and cleanup flows.

**Tech Stack:** Prisma 7, pnpm/Turbo, tRPC 11, Next.js 16, NestJS/Jest, FastAPI/Dishka, LangChain embeddings, Qdrant, Vitest, Pytest.

---

## Source Of Truth

Use `docs/superpowers/specs/2026-04-29-workspace-embedding-models-design.md`.

Do not follow the older `docs/superpowers/specs/2026-04-29-per-workspace-embeddings-design.md` for field names or seed scope. It uses a superseded naming scheme and seeds OpenAI; the approved spec uses `embeddings` and `embeddingDimensions`, and does not seed OpenAI in this pass.

## File Map

- `packages/db/prisma/schema.prisma` — add embedding capability fields and named `AiModel` relations.
- `packages/db/prisma/seed.ts` — seed `nomic-embed-text` and mark GigaChat rows embedding-capable.
- `packages/trpc/src/helpers/plan.ts` — add model capability filtering.
- `packages/trpc/src/helpers/embedding-reindex.ts` — build embedding configs, call agents cleanup, enqueue workspace reindex rows.
- `packages/trpc/src/routers/ai-settings.ts` — validate, persist, cleanup, and reindex `embeddingsModelId`.
- `packages/trpc/test/plan.test.ts` and `packages/trpc/test/ai-settings-router.test.ts` — cover filters and mutation behavior.
- `apps/web/src/lib/chat/agents-payload.ts` — include nullable `embeddingModel` in agents payload.
- `apps/web/src/app/api/agents/generate/route.ts` — load and pass `embeddingsModel`.
- `apps/web/src/components/workspace/settings/ai-section.tsx` — render vectorization selector.
- `apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/ai/page.tsx` — pass initial embedding models.
- `apps/web/test/agents-payload.test.ts`, `apps/web/test/api-agents-generate.test.ts`, `apps/web/test/ai-section.test.tsx` — cover payload, route, and UI.
- `apps/engines/src/apps/indexer/services/agents-client.service.ts` — send embedding model config and cleanup endpoint calls.
- `apps/engines/src/apps/indexer/cron/vectorization-cron.service.ts` — skip null vectorizers and send configured vectorizer.
- `apps/engines/src/apps/indexer/cron/vectorization-cron.service.spec.ts` and `apps/engines/src/apps/indexer/services/agents-client.service.spec.ts` — cover indexer behavior.
- `apps/agents/agents/apps/common/embedding_config.py` — shared embedding payload schema and collection-name helper.
- `apps/agents/agents/apps/processing/repositories/embedding_factory.py` — provider-to-LangChain embedding factory.
- `apps/agents/agents/apps/processing/repositories/vectorization_repository.py` — embed documents/queries from dynamic configs.
- `apps/agents/agents/apps/processing/repositories/vector_store_repository.py` — stateless Qdrant collection operations.
- `apps/agents/agents/apps/processing/schemas.py` — require `embeddingModel` on vectorization and cleanup requests.
- `apps/agents/agents/apps/processing/router.py` and `apps/agents/agents/apps/processing/use_cases/vectorize_page.py` — dynamic vectorization and delete-workspace endpoint.
- `apps/agents/agents/apps/chat/schemas.py`, `apps/agents/agents/apps/chat/services/rag_retrieval.py`, `apps/agents/agents/apps/chat/services/graph.py` — nullable RAG config and skip/search behavior.
- `apps/agents/tests/apps/processing/*` and `apps/agents/tests/apps/chat/*` — cover collection naming, factories, vectorization, deletion, RAG skip/search.
- `apps/agents/agents/bootstrap.py` — remove boot-time creation of the old global `pages` collection.

### Task 1: Prisma Schema, Seed, And Model Capability Filters

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Modify: `packages/db/prisma/seed.ts`
- Modify: `packages/trpc/src/helpers/plan.ts`
- Test: `packages/trpc/test/plan.test.ts`

- [ ] **Step 1: Write failing capability filter tests**

Add these tests inside `describe('getAvailableAiModels')` in `packages/trpc/test/plan.test.ts`:

```ts
it('returns embedding-capable Pro models separately from chat models', async () => {
  const pro = await prisma.plan.findUniqueOrThrow({ where: { slug: 'pro' } })
  await prisma.subscription.create({
    data: {
      userId: ownerId,
      planId: pro.id,
      status: 'ACTIVE',
      billingPeriod: 'MONTHLY',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 86400_000),
    },
  })

  const embeddingModels = await getAvailableAiModels(workspaceId, { capability: 'embeddings' })
  const embeddingSlugs = embeddingModels.map((m) => m.slug).sort()
  expect(embeddingSlugs).toContain('nomic-embed-text')
  expect(embeddingSlugs).toContain('gigachat-2')
  expect(embeddingSlugs).toContain('gigachat-2-pro')
  expect(embeddingSlugs).not.toContain('gemma4')
  expect(embeddingSlugs).not.toContain('gigachat-2-max')
  expect(embeddingModels.every((m) => m.embeddings)).toBe(true)
  expect(embeddingModels.every((m) => typeof m.embeddingDimensions === 'number')).toBe(true)

  const chatModels = await getAvailableAiModels(workspaceId, { capability: 'chat' })
  const chatSlugs = chatModels.map((m) => m.slug).sort()
  expect(chatSlugs).toContain('gigachat-2')
  expect(chatSlugs).toContain('gigachat-2-pro')
  expect(chatSlugs).toContain('gemma4')
  expect(chatSlugs).not.toContain('nomic-embed-text')
})
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
pnpm --filter @repo/trpc test -- test/plan.test.ts
```

Expected: TypeScript or Vitest fails because `getAvailableAiModels` does not accept a `capability` option and `AiModel` has no `embeddings` fields.

- [ ] **Step 3: Update Prisma schema**

In `packages/db/prisma/schema.prisma`, replace the `workspaceSettings WorkspaceAiSettings[]` relation on `AiModel` and add the new fields:

```prisma
model AiModel {
  id                         String                @id @default(uuid(7)) @db.Uuid
  providerId                 String                @map("provider_id") @db.Uuid
  slug                       String                @db.VarChar(100)
  displayName                String                @map("display_name") @db.VarChar(150)
  contextTokens              Int                   @map("context_tokens")
  supportsVision             Boolean               @default(false) @map("supports_vision")
  embeddings                 Boolean               @default(false)
  embeddingDimensions        Int?                  @map("embedding_dimensions")
  minPlanSlug                String?               @map("min_plan_slug")
  isActive                   Boolean               @default(true) @map("is_active")
  deprecatedAt               DateTime?             @map("deprecated_at") @db.Timestamptz(6)
  createdAt                  DateTime              @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt                  DateTime              @updatedAt @map("updated_at") @db.Timestamptz(6)
  provider                   AiProvider            @relation(fields: [providerId], references: [id], onDelete: Cascade)
  defaultWorkspaceSettings   WorkspaceAiSettings[] @relation("WorkspaceDefaultAiModel")
  embeddingWorkspaceSettings WorkspaceAiSettings[] @relation("WorkspaceEmbeddingAiModel")

  @@unique([providerId, slug])
  @@index([embeddings])
  @@map("ai_models")
}
```

In `WorkspaceAiSettings`, add `embeddingsModelId`, named relations, and the new index:

```prisma
model WorkspaceAiSettings {
  workspaceId       String   @id @map("workspace_id") @db.Uuid
  defaultModelId    String?  @map("default_model_id") @db.Uuid
  embeddingsModelId String?  @map("embeddings_model_id") @db.Uuid
  systemPrompt      String?  @map("system_prompt") @db.Text
  temperature       Float    @default(0.2)
  topP              Float    @default(0.5) @map("top_p")
  createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  workspace       Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  defaultModel    AiModel?  @relation("WorkspaceDefaultAiModel", fields: [defaultModelId], references: [id], onDelete: SetNull)
  embeddingsModel AiModel?  @relation("WorkspaceEmbeddingAiModel", fields: [embeddingsModelId], references: [id], onDelete: SetNull)

  @@index([defaultModelId])
  @@index([embeddingsModelId])
  @@map("workspace_ai_settings")
}
```

- [ ] **Step 4: Update seed rows**

In `packages/db/prisma/seed.ts`, update the `aiModels` array so every object includes `embeddings` and `embeddingDimensions`. Use these values:

```ts
const aiModels = [
  {
    providerSlug: 'gigachat',
    slug: 'gigachat-2',
    displayName: 'GigaChat-2',
    contextTokens: 32000,
    supportsVision: false,
    embeddings: true,
    embeddingDimensions: 1024,
    minPlanSlug: 'pro',
  },
  {
    providerSlug: 'gigachat',
    slug: 'gigachat-2-pro',
    displayName: 'GigaChat-2 Pro',
    contextTokens: 32000,
    supportsVision: false,
    embeddings: true,
    embeddingDimensions: 1024,
    minPlanSlug: 'pro',
  },
  {
    providerSlug: 'gigachat',
    slug: 'gigachat-2-max',
    displayName: 'GigaChat-2 Max',
    contextTokens: 64000,
    supportsVision: false,
    embeddings: true,
    embeddingDimensions: 1024,
    minPlanSlug: 'max',
  },
  {
    providerSlug: 'ollama',
    slug: 'gemma4',
    displayName: 'Gemma 4 (Ollama)',
    contextTokens: 8192,
    supportsVision: false,
    embeddings: false,
    embeddingDimensions: null,
    minPlanSlug: null,
  },
  {
    providerSlug: 'ollama',
    slug: 'nomic-embed-text',
    displayName: 'Nomic Embed Text (Ollama)',
    contextTokens: 0,
    supportsVision: false,
    embeddings: true,
    embeddingDimensions: 768,
    minPlanSlug: null,
  },
] as const
```

Update both `upsert.update` and `upsert.create` to write `embeddings` and `embeddingDimensions`. Update the final log line to say `5 AI models`.

- [ ] **Step 5: Implement capability filtering**

In `packages/trpc/src/helpers/plan.ts`, add:

```ts
import type { AiModel, AiProvider, Plan, Prisma, PrismaClient } from '@repo/db'

export type AiModelCapability = 'chat' | 'embeddings'

export async function getAvailableAiModels(
  workspaceId: string,
  options: { capability?: AiModelCapability } = {},
): Promise<(AiModel & { provider: AiProvider })[]> {
  const features = await getWorkspaceFeatures(workspaceId)
  const allowed = await prisma.plan.findMany({
    where: { sortOrder: { lte: features.sortOrder } },
    select: { slug: true },
  })
  const allowedSlugs = allowed.map((r) => r.slug)
  const capabilityWhere =
    options.capability === 'embeddings'
      ? { embeddings: true, embeddingDimensions: { not: null } }
      : { contextTokens: { gt: 0 } }
  const where: Prisma.AiModelWhereInput = Object.assign(
    {
      isActive: true,
      OR: [{ minPlanSlug: null }, { minPlanSlug: { in: allowedSlugs } }],
    },
    capabilityWhere,
  )

  return prisma.aiModel.findMany({
    where,
    include: { provider: true },
    orderBy: { displayName: 'asc' },
  })
}
```

- [ ] **Step 6: Generate Prisma client and run tests**

Run:

```bash
pnpm --filter @repo/db prisma:generate
pnpm --filter @repo/trpc test -- test/plan.test.ts
```

Expected: Prisma generate succeeds and `plan.test.ts` passes.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/seed.ts packages/trpc/src/helpers/plan.ts packages/trpc/test/plan.test.ts
git commit -m "feat(db,trpc): model workspace embedding capabilities"
```

### Task 2: tRPC Settings Mutation, Cleanup, And Reindex Enqueue

**Files:**
- Create: `packages/trpc/src/helpers/embedding-reindex.ts`
- Modify: `packages/trpc/src/routers/ai-settings.ts`
- Test: `packages/trpc/test/ai-settings-router.test.ts`

- [ ] **Step 1: Write failing router tests**

Create `packages/trpc/test/ai-settings-router.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@repo/db'

vi.mock('@repo/auth', () => ({
  getUserFromRequest: vi.fn(),
}))

const helperMocks = vi.hoisted(() => ({
  getAvailableAiModels: vi.fn(),
  requireWritableWorkspace: vi.fn(async () => undefined),
  deleteWorkspaceVectors: vi.fn(async () => undefined),
  enqueueWorkspaceTextPagesForReindex: vi.fn(async () => undefined),
}))

vi.mock('../src/helpers/plan', () => ({
  getAvailableAiModels: helperMocks.getAvailableAiModels,
  requireWritableWorkspace: helperMocks.requireWritableWorkspace,
}))

vi.mock('../src/helpers/embedding-reindex', () => ({
  deleteWorkspaceVectors: helperMocks.deleteWorkspaceVectors,
  enqueueWorkspaceTextPagesForReindex: helperMocks.enqueueWorkspaceTextPagesForReindex,
  toEmbeddingModelConfig: (model: {
    slug: string
    embeddingDimensions: number
    provider: { slug: string; connection: unknown }
  }) => ({
    provider: model.provider.slug,
    name: model.slug,
    dimensions: model.embeddingDimensions,
    connection: model.provider.connection,
  }),
}))

import { aiSettingsRouter } from '../src/routers/ai-settings'
import { createCallerFactory } from '../src/trpc'

const WORKSPACE_ID = '11111111-1111-1111-1111-111111111111'
const USER_ID = '22222222-2222-2222-2222-222222222222'
const OLD_MODEL_ID = '33333333-3333-3333-3333-333333333333'
const NEW_MODEL_ID = '44444444-4444-4444-4444-444444444444'

function context(prisma: PrismaClient) {
  return {
    prisma,
    user: { id: USER_ID },
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {},
    returnUrlBase: 'http://localhost:3000',
  }
}

function model(id: string, slug: string) {
  return {
    id,
    slug,
    displayName: slug,
    contextTokens: 32000,
    supportsVision: false,
    embeddings: true,
    embeddingDimensions: 1024,
    minPlanSlug: 'pro',
    deprecatedAt: null,
    provider: {
      id: 'provider-id',
      slug: 'gigachat',
      name: 'GigaChat',
      connection: { scope: 'GIGACHAT_API_PERS' },
    },
  }
}

describe('aiSettingsRouter embeddingsModelId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    helperMocks.requireWritableWorkspace.mockResolvedValue(undefined)
    helperMocks.deleteWorkspaceVectors.mockResolvedValue(undefined)
    helperMocks.enqueueWorkspaceTextPagesForReindex.mockResolvedValue(undefined)
  })

  it('rejects unavailable embedding models', async () => {
    helperMocks.getAvailableAiModels.mockResolvedValueOnce([])
    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => ({ role: 'OWNER' })) },
      workspaceAiSettings: { findUnique: vi.fn(async () => null) },
    } as unknown as PrismaClient

    const caller = createCallerFactory(aiSettingsRouter)(context(prisma))

    await expect(
      caller.update({ workspaceId: WORKSPACE_ID, embeddingsModelId: NEW_MODEL_ID }),
    ).rejects.toThrow(/Недоступная модель векторизации/)
  })

  it('cleans old vectors, saves new model, and enqueues reindex in one transaction', async () => {
    const oldModel = model(OLD_MODEL_ID, 'gigachat-2')
    const newModel = model(NEW_MODEL_ID, 'gigachat-2-pro')
    helperMocks.getAvailableAiModels.mockResolvedValueOnce([newModel])

    const tx = {
      workspaceAiSettings: {
        upsert: vi.fn(async () => ({
          workspaceId: WORKSPACE_ID,
          defaultModelId: null,
          embeddingsModelId: NEW_MODEL_ID,
          systemPrompt: null,
          temperature: 0.2,
          topP: 0.5,
        })),
      },
    }
    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => ({ role: 'OWNER' })) },
      workspaceAiSettings: {
        findUnique: vi.fn(async () => ({ embeddingsModel: oldModel })),
      },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    } as unknown as PrismaClient

    const caller = createCallerFactory(aiSettingsRouter)(context(prisma))
    const result = await caller.update({ workspaceId: WORKSPACE_ID, embeddingsModelId: NEW_MODEL_ID })

    expect(helperMocks.deleteWorkspaceVectors).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      embeddingModel: {
        provider: 'gigachat',
        name: 'gigachat-2',
        dimensions: 1024,
        connection: { scope: 'GIGACHAT_API_PERS' },
      },
    })
    expect(tx.workspaceAiSettings.upsert).toHaveBeenCalled()
    expect(helperMocks.enqueueWorkspaceTextPagesForReindex).toHaveBeenCalledWith(tx, WORKSPACE_ID)
    expect(result.embeddingsModelId).toBe(NEW_MODEL_ID)
  })

  it('does not save settings when cleanup fails', async () => {
    const oldModel = model(OLD_MODEL_ID, 'gigachat-2')
    const newModel = model(NEW_MODEL_ID, 'gigachat-2-pro')
    helperMocks.getAvailableAiModels.mockResolvedValueOnce([newModel])
    helperMocks.deleteWorkspaceVectors.mockRejectedValueOnce(new Error('agents unavailable'))

    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => ({ role: 'OWNER' })) },
      workspaceAiSettings: {
        findUnique: vi.fn(async () => ({ embeddingsModel: oldModel })),
        upsert: vi.fn(),
      },
      $transaction: vi.fn(),
    } as unknown as PrismaClient

    const caller = createCallerFactory(aiSettingsRouter)(context(prisma))

    await expect(
      caller.update({ workspaceId: WORKSPACE_ID, embeddingsModelId: NEW_MODEL_ID }),
    ).rejects.toThrow(/agents unavailable/)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the failing router test**

Run:

```bash
pnpm --filter @repo/trpc test -- test/ai-settings-router.test.ts
```

Expected: fails because router result and input do not include `embeddingsModelId` and helper file is missing.

- [ ] **Step 3: Add embedding reindex helpers**

Create `packages/trpc/src/helpers/embedding-reindex.ts`:

```ts
import { enqueueOutboxEventIgnoreConflict, type AiModel, type AiProvider, type Prisma } from '@repo/db'

export type EmbeddingModelConfig = {
  provider: string
  name: string
  dimensions: number
  connection: unknown
}

export function toEmbeddingModelConfig(
  model: Pick<AiModel, 'slug' | 'embeddingDimensions'> & {
    provider: Pick<AiProvider, 'slug' | 'connection'>
  },
): EmbeddingModelConfig {
  if (!model.embeddingDimensions || model.embeddingDimensions <= 0) {
    throw new Error(`Embedding model ${model.slug} has invalid dimensions`)
  }
  return {
    provider: model.provider.slug,
    name: model.slug,
    dimensions: model.embeddingDimensions,
    connection: model.provider.connection,
  }
}

export async function deleteWorkspaceVectors(args: {
  workspaceId: string
  embeddingModel: EmbeddingModelConfig
  fetchImpl?: typeof fetch
}): Promise<void> {
  const fetcher = args.fetchImpl ?? fetch
  const baseUrl = process.env.AGENTS_SERVICE_URL ?? 'http://localhost:8080'
  const res = await fetcher(`${baseUrl}/vectorization/delete-workspace`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workspaceId: args.workspaceId,
      embeddingModel: args.embeddingModel,
    }),
  })
  if (!res.ok) {
    throw new Error(`agents /vectorization/delete-workspace ${res.status}: ${await res.text()}`)
  }
}

export async function enqueueWorkspaceTextPagesForReindex(
  tx: Prisma.TransactionClient,
  workspaceId: string,
): Promise<void> {
  const pages = await tx.page.findMany({
    where: { workspaceId, type: 'TEXT', deletedAt: null },
    select: { id: true, workspaceId: true },
  })
  for (const page of pages) {
    await enqueueOutboxEventIgnoreConflict(tx, {
      eventType: 'page.upserted',
      aggregateType: 'page',
      aggregateId: page.id,
      workspaceId: page.workspaceId,
    })
  }
}
```

- [ ] **Step 4: Expand aiSettings router contract**

In `packages/trpc/src/routers/ai-settings.ts`:

1. Import `deleteWorkspaceVectors`, `enqueueWorkspaceTextPagesForReindex`, and `toEmbeddingModelConfig`.
2. Add `embeddingsModelId: string | null` to `AiSettingsResult`.
3. Return `settings?.embeddingsModelId ?? null` from `get`.
4. Add `embeddingsModelId: z.string().uuid().nullable().optional()` to `update` input.
5. Validate with `getAvailableAiModels(input.workspaceId, { capability: 'embeddings' })`.
6. Expand `listAvailableModels` input to `z.object({ workspaceId: z.string().uuid(), capability: z.enum(['chat', 'embeddings']).default('chat') })`, call `getAvailableAiModels(input.workspaceId, { capability: input.capability })`, and include `embeddings` plus `embeddingDimensions` in returned model objects.
7. Load previous settings with:

```ts
const previousSettings = await ctx.prisma.workspaceAiSettings.findUnique({
  where: { workspaceId: input.workspaceId },
  include: {
    embeddingsModel: { include: { provider: true } },
  },
})
```

8. Before the transaction, if `input.embeddingsModelId !== undefined` and the value changed and `previousSettings?.embeddingsModel` exists, call:

```ts
await deleteWorkspaceVectors({
  workspaceId: input.workspaceId,
  embeddingModel: toEmbeddingModelConfig(previousSettings.embeddingsModel),
})
```

9. In the upsert data, connect or disconnect `embeddingsModel`.
10. Wrap the upsert and reindex enqueue in `ctx.prisma.$transaction`. Call `enqueueWorkspaceTextPagesForReindex(tx, input.workspaceId)` only when the new `embeddingsModelId` is a non-empty string.

- [ ] **Step 5: Run router tests**

Run:

```bash
pnpm --filter @repo/trpc test -- test/ai-settings-router.test.ts
pnpm --filter @repo/trpc test -- test/plan.test.ts
```

Expected: both test files pass.

- [ ] **Step 6: Commit**

```bash
git add packages/trpc/src/helpers/embedding-reindex.ts packages/trpc/src/routers/ai-settings.ts packages/trpc/test/ai-settings-router.test.ts
git commit -m "feat(trpc): persist workspace embedding model settings"
```

### Task 3: Agents Dynamic Embedding And Qdrant Operations

**Files:**
- Create: `apps/agents/agents/apps/common/__init__.py`
- Create: `apps/agents/agents/apps/common/embedding_config.py`
- Create: `apps/agents/agents/apps/processing/repositories/embedding_factory.py`
- Modify: `apps/agents/agents/apps/processing/repositories/__init__.py`
- Modify: `apps/agents/agents/apps/processing/repositories/vectorization_repository.py`
- Modify: `apps/agents/agents/apps/processing/repositories/vector_store_repository.py`
- Modify: `apps/agents/agents/apps/processing/schemas.py`
- Modify: `apps/agents/agents/apps/processing/use_cases/vectorize_page.py`
- Modify: `apps/agents/agents/apps/processing/router.py`
- Modify: `apps/agents/agents/apps/processing/depends.py`
- Modify: `apps/agents/agents/bootstrap.py`
- Test: `apps/agents/tests/apps/processing/test_embedding_config.py`
- Test: `apps/agents/tests/apps/processing/test_vector_store_repository.py`
- Test: `apps/agents/tests/apps/processing/test_vectorize_page.py`

- [ ] **Step 1: Add failing collection-name and vectorization tests**

Create `apps/agents/tests/apps/processing/test_embedding_config.py`:

```python
from agents.apps.common.embedding_config import collection_name_for


def test_collection_name_uses_provider_and_model_slug() -> None:
    assert collection_name_for('GigaChat', 'GigaChat-2 Pro') == 'pages__gigachat__gigachat-2_pro'
    assert collection_name_for('ollama', 'nomic-embed-text') == 'pages__ollama__nomic-embed-text'
```

Update `apps/agents/tests/apps/processing/test_vectorize_page.py` helper payload:

```python
def _payload(contents: list[ContentBlockSchema]) -> VectorizationRequestSchema:
    return VectorizationRequestSchema.model_validate({
        'pageId': str(PAGE_ID),
        'workspaceId': str(WS_ID),
        'title': 'T',
        'pageType': 'TEXT',
        'embeddingModel': {
            'provider': 'gigachat',
            'name': 'gigachat-2-pro',
            'dimensions': 1024,
            'connection': {'scope': 'GIGACHAT_API_PERS'},
        },
        'contents': [block.model_dump(by_alias=True) for block in contents],
    })
```

In `apps/agents/tests/apps/processing/test_vector_store_repository.py`, update `_make_repo` for the new constructor and add:

```python
@pytest.mark.asyncio
async def test_delete_by_workspace_calls_client_delete_with_filter() -> None:
    client = AsyncMock()
    repo = _make_repo(client=client)

    await repo.delete_by_workspace('pages__ollama__nomic-embed-text', 'ws-1')

    client.delete.assert_awaited_once()
    args, kwargs = client.delete.call_args
    assert args[0] == 'pages__ollama__nomic-embed-text'
    filt = kwargs['points_selector']
    assert filt.must[0].key == 'workspaceId'
    assert filt.must[0].match.value == 'ws-1'
```

Change the use-case mock to provide `vectorization_repository.embed_batch = AsyncMock(return_value=[[0.1, 0.2]])` and assert calls include the config:

```python
vec_repo.embed_batch.assert_awaited_once_with(
    _payload([ContentBlockSchema(blockNumber=5, content='ignored')]).embedding_model,
    ['norm text'],
)
store.ensure_collection.assert_awaited_once_with('pages__gigachat__gigachat-2-pro', 1024)
store.delete_by_page.assert_awaited_once_with('pages__gigachat__gigachat-2-pro', str(PAGE_ID))
```

- [ ] **Step 2: Run failing agents processing tests**

Run:

```bash
cd apps/agents && uv run pytest tests/apps/processing/test_embedding_config.py tests/apps/processing/test_vectorize_page.py -q
```

Expected: fails because common config and dynamic collection calls do not exist.

- [ ] **Step 3: Add shared embedding config**

Create `apps/agents/agents/apps/common/__init__.py`:

```python
"""Shared application helpers."""
```

Create `apps/agents/agents/apps/common/embedding_config.py`:

```python
from __future__ import annotations

import re

from pydantic import BaseModel, ConfigDict, Field, field_validator


class EmbeddingConnectionSchema(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    base_url: str | None = Field(default=None, alias='baseUrl')
    api_key: str | None = Field(default=None, alias='apiKey')
    organization: str | None = None
    client_id: str | None = Field(default=None, alias='clientId')
    client_secret: str | None = Field(default=None, alias='clientSecret')
    scope: str | None = None


class EmbeddingModelConfigSchema(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    provider: str
    name: str
    dimensions: int = Field(gt=0)
    connection: EmbeddingConnectionSchema = Field(default_factory=EmbeddingConnectionSchema)

    @field_validator('provider')
    @classmethod
    def normalize_provider(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in {'ollama', 'openai', 'gigachat'}:
            raise ValueError(f'unsupported embedding provider: {value}')
        return normalized


def _safe_slug(value: str) -> str:
    return re.sub(r'[^a-z0-9_-]+', '_', value.strip().lower()).strip('_')


def collection_name_for(provider_slug: str, model_slug: str) -> str:
    return f'pages__{_safe_slug(provider_slug)}__{_safe_slug(model_slug)}'
```

- [ ] **Step 4: Add dynamic embedding factory**

Create `apps/agents/agents/apps/processing/repositories/embedding_factory.py`:

```python
from __future__ import annotations

from base64 import b64encode
from dataclasses import dataclass

from langchain_core.embeddings import Embeddings
from langchain_gigachat.embeddings import GigaChatEmbeddings
from langchain_ollama import OllamaEmbeddings
from langchain_openai import OpenAIEmbeddings
from pydantic import SecretStr

from agents.apps.common.embedding_config import EmbeddingModelConfigSchema


@dataclass
class EmbeddingFactoryRepository:
    def make(self, config: EmbeddingModelConfigSchema) -> Embeddings:
        if config.provider == 'ollama':
            return OllamaEmbeddings(
                model=config.name,
                base_url=config.connection.base_url,
            )
        if config.provider == 'openai':
            if not config.connection.api_key:
                raise ValueError('OpenAI embeddings require apiKey')
            return OpenAIEmbeddings(
                model=config.name,
                api_key=SecretStr(config.connection.api_key),
                organization=config.connection.organization,
                base_url=config.connection.base_url,
            )
        if config.provider == 'gigachat':
            if not config.connection.client_id or not config.connection.client_secret:
                raise ValueError('GigaChat embeddings require clientId and clientSecret')
            credentials = b64encode(
                f'{config.connection.client_id}:{config.connection.client_secret}'.encode(),
            ).decode()
            return GigaChatEmbeddings(
                credentials=credentials,
                scope=config.connection.scope or 'GIGACHAT_API_PERS',
                model=config.name,
                verify_ssl_certs=False,
            )
        raise ValueError(f'Unknown embedding provider: {config.provider}')
```

- [ ] **Step 5: Make vectorization repository dynamic**

Replace `apps/agents/agents/apps/processing/repositories/vectorization_repository.py` with:

```python
from dataclasses import dataclass

from agents.apps.common.embedding_config import EmbeddingModelConfigSchema

from .embedding_factory import EmbeddingFactoryRepository


@dataclass
class VectorizationRepository:
    """Creates per-request embedding clients and embeds text."""

    embedding_factory: EmbeddingFactoryRepository

    async def embed(self, config: EmbeddingModelConfigSchema, text: str) -> list[float]:
        return (await self.embedding_factory.make(config).aembed_documents([text]))[0]

    async def embed_batch(
        self,
        config: EmbeddingModelConfigSchema,
        texts: list[str],
    ) -> list[list[float]]:
        return await self.embedding_factory.make(config).aembed_documents(texts)

    async def embed_query(self, config: EmbeddingModelConfigSchema, query: str) -> list[float]:
        return await self.embedding_factory.make(config).aembed_query(query)
```

Update `apps/agents/agents/apps/processing/repositories/__init__.py`:

```python
from .embedding_factory import EmbeddingFactoryRepository as EmbeddingFactoryRepository
from .vector_store_repository import VectorStoreRepository as VectorStoreRepository
from .vectorization_repository import VectorizationRepository as VectorizationRepository
```

- [ ] **Step 6: Make Qdrant repository stateless per collection**

Update `apps/agents/agents/apps/processing/repositories/vector_store_repository.py` so the dataclass fields are:

```python
@dataclass
class VectorStoreRepository:
    client: AsyncQdrantClient
```

Use these method signatures:

```python
async def ensure_collection(self, collection_name: str, vector_size: int) -> None
async def delete_by_page(self, collection_name: str, page_id: str) -> None
async def delete_by_workspace(self, collection_name: str, workspace_id: str) -> None
async def upsert_chunks(self, collection_name: str, points: list[tuple[str, list[float], dict[str, Any]]]) -> None
async def similarity_search(self, collection_name: str, workspace_id: str, vector: list[float], k: int = 5) -> list[Document]
```

`similarity_search` must not embed the query. It receives the vector from `VectorizationRepository.embed_query`.

- [ ] **Step 7: Update processing schemas**

In `apps/agents/agents/apps/processing/schemas.py`, import `EmbeddingModelConfigSchema` and add:

```python
class VectorizationRequestSchema(BaseModel):
    pageId: UUID
    workspaceId: UUID
    title: str
    pageType: str
    embeddingModel: EmbeddingModelConfigSchema
    contents: list[ContentBlockSchema]


class DeleteWorkspaceVectorsRequestSchema(BaseModel):
    workspaceId: UUID
    embeddingModel: EmbeddingModelConfigSchema


class DeleteWorkspaceVectorsResponseSchema(BaseModel):
    deleted: bool
```

- [ ] **Step 8: Update vectorize use case and router**

In `apps/agents/agents/apps/processing/use_cases/vectorize_page.py`, compute collection once:

```python
collection_name = collection_name_for(
    payload.embeddingModel.provider,
    payload.embeddingModel.name,
)
await self.vector_store_repository.ensure_collection(
    collection_name,
    payload.embeddingModel.dimensions,
)
await self.vector_store_repository.delete_by_page(collection_name, str(payload.pageId))
```

Call:

```python
vectors = await self.vectorization_repository.embed_batch(
    payload.embeddingModel,
    [normalized for _, normalized, _, _ in pending],
)
await self.vector_store_repository.upsert_chunks(collection_name, points)
```

In `apps/agents/agents/apps/processing/router.py`, add:

```python
@router.post('/delete-workspace', response_model=DeleteWorkspaceVectorsResponseSchema)
@inject
async def delete_workspace_vectors(
    payload: DeleteWorkspaceVectorsRequestSchema,
    vector_store_repository: FromDishka[VectorStoreRepository],
) -> DeleteWorkspaceVectorsResponseSchema:
    collection_name = collection_name_for(payload.embeddingModel.provider, payload.embeddingModel.name)
    await vector_store_repository.delete_by_workspace(collection_name, str(payload.workspaceId))
    return DeleteWorkspaceVectorsResponseSchema(deleted=True)
```

- [ ] **Step 9: Update providers and bootstrap**

In `apps/agents/agents/apps/processing/depends.py`:

- Remove `OllamaEmbeddings` from imports and provider method arguments.
- Provide `VectorStoreRepository(client=client)`.
- Provide `EmbeddingFactoryRepository` at app scope.
- Keep `VectorizationRepository` as a provided class.

In `apps/agents/agents/bootstrap.py`, remove the lifespan block that imports `VectorStoreRepository` and calls `ensure_collection()`. Keep the rest of the lifespan and `yield` unchanged.

- [ ] **Step 10: Run processing tests**

Run:

```bash
cd apps/agents && uv run pytest tests/apps/processing -q
```

Expected: processing tests pass.

- [ ] **Step 11: Commit**

```bash
git add apps/agents/agents/apps/common apps/agents/agents/apps/processing apps/agents/agents/bootstrap.py apps/agents/tests/apps/processing
git commit -m "feat(agents): vectorize with selected embedding model"
```

### Task 4: Agents RAG Skip And Dynamic Search

**Files:**
- Modify: `apps/agents/agents/apps/chat/schemas.py`
- Modify: `apps/agents/agents/apps/chat/services/rag_retrieval.py`
- Modify: `apps/agents/agents/apps/chat/services/graph.py`
- Test: `apps/agents/tests/apps/chat/services/test_rag_retrieval.py`
- Test: `apps/agents/tests/apps/chat/test_graph_service.py`

- [ ] **Step 1: Add failing RAG skip/search tests**

In `apps/agents/tests/apps/chat/test_graph_service.py`, add a stub that records calls:

```python
from agents.apps.common.embedding_config import EmbeddingModelConfigSchema


class RecordingRagRetrievalService:
    def __init__(self) -> None:
        self.calls: list[tuple[object, str, object, int]] = []

    async def retrieve(
        self,
        workspace_id: object,
        query: str,
        embedding_model: object,
        k: int = 5,
    ) -> list[object]:
        self.calls.append((workspace_id, query, embedding_model, k))
        return []
```

Add tests:

```python
@pytest.mark.asyncio
async def test_prepare_prompt_skips_rag_when_embedding_model_is_missing() -> None:
    renderer = StubJinjaRendererRepository()
    rag = RecordingRagRetrievalService()
    service = GraphService(
        jinja_repository=cast(JinjaRendererRepository, renderer),
        mcp_tools_repository=cast(McpToolsRepository, StubMcpToolsRepository()),
        model_factory_repository=cast(ModelFactoryRepository, object()),
        rag_retrieval_service=cast(RagRetrievalService, rag),
        checkpointer=cast(AsyncPostgresSaver, object()),
    )
    state = make_state(mcp=None)
    state.payload.embedding_model = None

    await service.prepare_prompt(RuntimeContext(), state)

    assert rag.calls == []
    assert renderer.user_calls[0][2] == []


@pytest.mark.asyncio
async def test_prepare_prompt_passes_embedding_model_to_rag() -> None:
    renderer = StubJinjaRendererRepository()
    rag = RecordingRagRetrievalService()
    service = GraphService(
        jinja_repository=cast(JinjaRendererRepository, renderer),
        mcp_tools_repository=cast(McpToolsRepository, StubMcpToolsRepository()),
        model_factory_repository=cast(ModelFactoryRepository, object()),
        rag_retrieval_service=cast(RagRetrievalService, rag),
        checkpointer=cast(AsyncPostgresSaver, object()),
    )
    state = make_state(mcp=None)
    state.payload.embedding_model = EmbeddingModelConfigSchema.model_validate({
        'provider': 'ollama',
        'name': 'nomic-embed-text',
        'dimensions': 768,
        'connection': {'baseUrl': 'http://localhost:11434'},
    })

    await service.prepare_prompt(RuntimeContext(), state)

    assert len(rag.calls) == 1
    assert rag.calls[0][1] == 'Latest question'
```

- [ ] **Step 2: Run failing chat tests**

Run:

```bash
cd apps/agents && uv run pytest tests/apps/chat/services/test_rag_retrieval.py tests/apps/chat/test_graph_service.py -q
```

Expected: fails because `QueryRequestSchema` and `RagRetrievalService.retrieve` do not accept `embeddingModel`.

- [ ] **Step 3: Add nullable embedding model to chat schema**

In `apps/agents/agents/apps/chat/schemas.py`, import `EmbeddingModelConfigSchema` and add this field to `QueryRequestSchema`:

```python
embedding_model: EmbeddingModelConfigSchema | None = None
"""
Embedding model config for Qdrant RAG retrieval. If absent, retrieval is skipped.
"""
```

- [ ] **Step 4: Update RAG retrieval service**

In `apps/agents/agents/apps/chat/services/rag_retrieval.py`, inject `VectorizationRepository` and use dynamic collection:

```python
@dataclass
class RagRetrievalService:
    vector_store_repository: VectorStoreRepository
    vectorization_repository: VectorizationRepository

    async def retrieve(
        self,
        workspace_id: UUID,
        query: str,
        embedding_model: EmbeddingModelConfigSchema,
        k: int = 5,
    ) -> list[RagDocumentSchema]:
        if not query.strip():
            return []
        collection_name = collection_name_for(embedding_model.provider, embedding_model.name)
        vector = await self.vectorization_repository.embed_query(embedding_model, query)
        docs = await self.vector_store_repository.similarity_search(
            collection_name=collection_name,
            workspace_id=str(workspace_id),
            vector=vector,
            k=k * 3,
        )
        return self._dedupe(docs, k)
```

- [ ] **Step 5: Update GraphService**

At the top of `apps/agents/agents/apps/chat/services/graph.py`, add:

```python
import logging

logger = logging.getLogger(__name__)
```

In `GraphService.prepare_prompt`, replace the unconditional retrieval with:

```python
rag_documents = []
if payload.embedding_model is not None:
    try:
        rag_documents = await self.rag_retrieval_service.retrieve(
            workspace_id=state.user_context.x_workspace_id,
            query=payload.query,
            embedding_model=payload.embedding_model,
            k=5,
        )
    except Exception as exc:
        logger.warning('rag retrieval failed, continuing without retrieved context: %s', exc)
        rag_documents = []
```

- [ ] **Step 6: Run agents chat tests**

Run:

```bash
cd apps/agents && uv run pytest tests/apps/chat -q
```

Expected: chat tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/agents/agents/apps/chat apps/agents/tests/apps/chat
git commit -m "feat(agents): skip rag without workspace embedding model"
```

### Task 5: Engines Indexer Late-Binds Workspace Embedding Model

**Files:**
- Modify: `apps/engines/src/apps/indexer/services/agents-client.service.ts`
- Modify: `apps/engines/src/apps/indexer/services/agents-client.service.spec.ts`
- Modify: `apps/engines/src/apps/indexer/cron/vectorization-cron.service.ts`
- Modify: `apps/engines/src/apps/indexer/cron/vectorization-cron.service.spec.ts`

- [ ] **Step 1: Add failing AgentsClient payload test**

In `apps/engines/src/apps/indexer/services/agents-client.service.spec.ts`, update the first test payload to include:

```ts
embeddingModel: {
  provider: 'ollama',
  name: 'nomic-embed-text',
  dimensions: 768,
  connection: { baseUrl: 'http://localhost:11434' },
},
```

After parsing `init.body`, assert:

```ts
const body = JSON.parse(String(init.body))
expect(body.embeddingModel).toEqual({
  provider: 'ollama',
  name: 'nomic-embed-text',
  dimensions: 768,
  connection: { baseUrl: 'http://localhost:11434' },
})
```

- [ ] **Step 2: Add failing cron tests**

Extend `makePrismaMock` in `vectorization-cron.service.spec.ts` with a `settings` option and `workspaceAiSettings.findUnique`.

Add test:

```ts
it('skips vectorization when workspace has no embeddings model', async () => {
  const rows = [{ id: BigInt(6), page_id: 'p6', workspace_id: 'w6', event_type: 'page.upserted' }]
  const prisma = makePrismaMock({ rows, page: null, settings: null })
  const vectorize = jest.fn(async () => undefined)
  const agents = { vectorize } as unknown as AgentsClient
  const svc = new VectorizationCronService(
    prisma as never,
    new PageContentReader(),
    agents,
    makePlanFeaturesMock(true),
  )

  await svc.tick()

  expect(vectorize).not.toHaveBeenCalled()
  expect(prisma.__mocks.executeRaw).toHaveBeenCalledTimes(3)
})
```

Add test:

```ts
it('passes the selected embeddings model to agents', async () => {
  const rows = [{ id: BigInt(7), page_id: 'p7', workspace_id: 'w7', event_type: 'page.upserted' }]
  const page = {
    id: 'p7',
    type: 'TEXT',
    deletedAt: null,
    title: 'T',
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] },
    workspaceId: 'w7',
  }
  const settings = {
    embeddingsModel: {
      slug: 'nomic-embed-text',
      embeddingDimensions: 768,
      provider: { slug: 'ollama', connection: { baseUrl: 'http://localhost:11434' } },
    },
  }
  const prisma = makePrismaMock({ rows, page, settings })
  const vectorize = jest.fn(async () => undefined)
  const agents = { vectorize } as unknown as AgentsClient
  const svc = new VectorizationCronService(
    prisma as never,
    new PageContentReader(),
    agents,
    makePlanFeaturesMock(true),
  )

  await svc.tick()

  expect(vectorize).toHaveBeenCalledWith(expect.objectContaining({
    embeddingModel: {
      provider: 'ollama',
      name: 'nomic-embed-text',
      dimensions: 768,
      connection: { baseUrl: 'http://localhost:11434' },
    },
  }))
})
```

- [ ] **Step 3: Run failing engines tests**

Run:

```bash
pnpm --filter engines test -- agents-client.service vectorization-cron.service
```

Expected: fails because payload type and cron do not handle `embeddingModel`.

- [ ] **Step 4: Update AgentsClient**

In `agents-client.service.ts`, add:

```ts
export type EmbeddingModelPayload = {
  provider: string
  name: string
  dimensions: number
  connection: unknown
}
```

Add `embeddingModel: EmbeddingModelPayload` to `VectorizationPayload`.

- [ ] **Step 5: Update VectorizationCronService**

Add a private helper:

```ts
private async getEmbeddingModel(workspaceId: string): Promise<EmbeddingModelPayload | null> {
  const settings = await this.prisma.workspaceAiSettings.findUnique({
    where: { workspaceId },
    include: {
      embeddingsModel: { include: { provider: true } },
    },
  })
  const model = settings?.embeddingsModel
  if (!model?.embeddingDimensions || model.embeddingDimensions <= 0) {
    return null
  }
  return {
    provider: model.provider.slug,
    name: model.slug,
    dimensions: model.embeddingDimensions,
    connection: model.provider.connection,
  }
}
```

At the start of `processRow`, after the existing plan check, call `getEmbeddingModel(row.workspace_id)`. If it returns `null`, call `markDone(row.id)` and return. Include `embeddingModel` in both `page.deleted` and `page.upserted` vectorize calls.

- [ ] **Step 6: Run engines tests**

Run:

```bash
pnpm --filter engines test -- agents-client.service vectorization-cron.service
```

Expected: both suites pass.

- [ ] **Step 7: Commit**

```bash
git add apps/engines/src/apps/indexer/services/agents-client.service.ts apps/engines/src/apps/indexer/services/agents-client.service.spec.ts apps/engines/src/apps/indexer/cron/vectorization-cron.service.ts apps/engines/src/apps/indexer/cron/vectorization-cron.service.spec.ts
git commit -m "feat(engines): index pages with workspace embedding model"
```

### Task 6: Web Payload, Generate Route, And AI Settings UI

**Files:**
- Modify: `apps/web/src/lib/chat/agents-payload.ts`
- Modify: `apps/web/test/agents-payload.test.ts`
- Modify: `apps/web/src/app/api/agents/generate/route.ts`
- Modify: `apps/web/test/api-agents-generate.test.ts`
- Modify: `apps/web/src/components/workspace/settings/ai-section.tsx`
- Modify: `apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/ai/page.tsx`
- Create: `apps/web/test/ai-section.test.tsx`

- [ ] **Step 1: Add failing agents payload tests**

In `apps/web/test/agents-payload.test.ts`, add:

```ts
it('includes a nullable embedding model in the payload', () => {
  const payload = buildAgentsPayload({
    chatId: '11111111-1111-1111-1111-111111111111',
    workspaceId: '22222222-2222-2222-2222-222222222222',
    userId: '33333333-3333-3333-3333-333333333333',
    text: 'hello',
    settings: {
      temperature: 0,
      topP: 0,
      systemPrompt: 'sys',
      defaultModel: {
        slug: 'model',
        provider: { slug: 'provider', connection: {} },
      },
      embeddingsModel: null,
    },
  })

  expect(payload.embeddingModel).toBeNull()
})

it('serializes the configured embedding model', () => {
  const payload = buildAgentsPayload({
    chatId: '11111111-1111-1111-1111-111111111111',
    workspaceId: '22222222-2222-2222-2222-222222222222',
    userId: '33333333-3333-3333-3333-333333333333',
    text: 'hello',
    settings: {
      temperature: 0,
      topP: 0,
      systemPrompt: 'sys',
      defaultModel: {
        slug: 'model',
        provider: { slug: 'provider', connection: {} },
      },
      embeddingsModel: {
        slug: 'nomic-embed-text',
        embeddingDimensions: 768,
        provider: { slug: 'ollama', connection: { baseUrl: 'http://localhost:11434' } },
      },
    },
  })

  expect(payload.embeddingModel).toEqual({
    provider: 'ollama',
    name: 'nomic-embed-text',
    dimensions: 768,
    connection: { baseUrl: 'http://localhost:11434' },
  })
})
```

- [ ] **Step 2: Run failing web payload tests**

Run:

```bash
pnpm --filter web test -- agents-payload.test.ts
```

Expected: fails because `WorkspaceSettingsSnapshot` has no `embeddingsModel`.

- [ ] **Step 3: Update agents payload builder**

In `apps/web/src/lib/chat/agents-payload.ts`, add:

```ts
export type WorkspaceEmbeddingModelSnapshot = {
  slug: string
  embeddingDimensions: number | null
  provider: {
    slug: string
    connection: unknown
  }
}
```

Add `embeddingsModel: WorkspaceEmbeddingModelSnapshot | null` to `WorkspaceSettingsSnapshot`.

Add to `buildAgentsPayload` return:

```ts
embeddingModel: args.settings.embeddingsModel?.embeddingDimensions
  ? {
      provider: args.settings.embeddingsModel.provider.slug,
      name: args.settings.embeddingsModel.slug,
      dimensions: args.settings.embeddingsModel.embeddingDimensions,
      connection: normalizeConnection(args.settings.embeddingsModel.provider.connection),
    }
  : null,
```

- [ ] **Step 4: Update generate route and tests**

In `apps/web/test/api-agents-generate.test.ts`, update the mocked settings row:

```ts
embeddingsModel: null,
```

Add an assertion after `await upstreamTask`:

```ts
const [, upstreamInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
const upstreamBody = JSON.parse(String(upstreamInit.body))
expect(upstreamBody.embeddingModel).toBeNull()
```

Add a second route test where `workspaceAiSettings.findUnique` returns:

```ts
embeddingsModel: {
  slug: 'nomic-embed-text',
  embeddingDimensions: 768,
  provider: { slug: 'ollama', connection: { baseUrl: 'http://localhost:11434' } },
},
```

Assert `upstreamBody.embeddingModel.provider === 'ollama'`.

In `apps/web/src/app/api/agents/generate/route.ts`, include `embeddingsModel: { include: { provider: true } }` in the Prisma settings include and add `embeddingsModel` to `settingsSnapshot`.

- [ ] **Step 5: Update AI settings UI**

In `ai-section.tsx`:

1. Extend `InitialModel` with `embeddings?: boolean` and `embeddingDimensions?: number | null`.
2. Add prop `initialEmbeddingModels?: InitialModel[]`.
3. Add state:

```ts
const [embeddingsModelId, setEmbeddingsModelId] = useState<string>('')
```

4. In the `useEffect`, set `settingsQuery.data.embeddingsModelId ?? ''`.
5. Query embedding models through `trpc.aiSettings.listAvailableModels.useQuery({ workspaceId, capability: 'embeddings' })`.
6. Add a second `FormControl`:

```tsx
<FormControl fullWidth>
  <InputLabel id="ai-embeddings-model">Модель векторизации</InputLabel>
  <Select
    labelId="ai-embeddings-model"
    label="Модель векторизации"
    value={embeddingsModelId}
    onChange={(e) => setEmbeddingsModelId(String(e.target.value))}
    disabled={disabled}
  >
    <MenuItem value="">
      <em>Не выбрано</em>
    </MenuItem>
    {flatEmbeddingModels.map((m) => (
      <MenuItem key={m.id} value={m.id}>
        {m.label}
      </MenuItem>
    ))}
  </Select>
  <FormHelperText>
    Если модель не выбрана, страницы не индексируются, а AI отвечает без поиска по базе workspace.
  </FormHelperText>
</FormControl>
```

7. In `onSave`, send:

```ts
embeddingsModelId: embeddingsModelId === '' ? null : embeddingsModelId,
```

In the settings page, pass `initialModels={models}` and `initialEmbeddingModels={embeddingModels}` using `getAvailableAiModels(workspaceId, { capability: 'chat' })` and `{ capability: 'embeddings' }`.

- [ ] **Step 6: Add UI smoke test**

Create `apps/web/test/ai-section.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      aiSettings: {
        get: { invalidate: vi.fn() },
      },
    }),
    aiSettings: {
      get: {
        useQuery: () => ({
          data: {
            workspaceId: '11111111-1111-1111-1111-111111111111',
            defaultModelId: null,
            embeddingsModelId: null,
            systemPrompt: null,
            temperature: 0.2,
            topP: 0.5,
          },
          isLoading: false,
        }),
      },
      listAvailableModels: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
      update: {
        useMutation: () => ({
          mutate: vi.fn(),
          isPending: false,
          error: null,
        }),
      },
    },
  },
}))

import { WorkspaceAiSection } from '../src/components/workspace/settings/ai-section'

describe('WorkspaceAiSection vectorization settings', () => {
  it('renders vectorization selector and disabled-indexing helper text', () => {
    render(
      <WorkspaceAiSection
        workspaceId="11111111-1111-1111-1111-111111111111"
        initialModels={[]}
        initialEmbeddingModels={[
          {
            id: '22222222-2222-2222-2222-222222222222',
            displayName: 'Nomic Embed Text',
            provider: { name: 'Ollama', slug: 'ollama' },
            embeddings: true,
            embeddingDimensions: 768,
          },
        ]}
      />,
    )

    expect(screen.getByText('Модель векторизации')).toBeTruthy()
    expect(screen.getByText(/страницы не индексируются/)).toBeTruthy()
  })
})
```

- [ ] **Step 7: Run web tests**

Run:

```bash
pnpm --filter web test -- agents-payload.test.ts api-agents-generate.test.ts ai-section.test.tsx
```

Expected: selected web tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/chat/agents-payload.ts apps/web/test/agents-payload.test.ts apps/web/src/app/api/agents/generate/route.ts apps/web/test/api-agents-generate.test.ts apps/web/src/components/workspace/settings/ai-section.tsx "apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/ai/page.tsx" apps/web/test/ai-section.test.tsx
git commit -m "feat(web): configure workspace vectorization model"
```

### Task 7: End-To-End Type Checks And Full Gates

**Files:**
- Modify only files needed for compilation fallout discovered by the commands below.

- [ ] **Step 1: Run package type checks**

Run:

```bash
pnpm --filter @repo/db check-types
pnpm --filter @repo/trpc check-types
pnpm --filter web check-types
pnpm --filter engines check-types
cd apps/agents && uv run mypy agents tests
```

Expected: all pass. If any command fails, fix only errors caused by this feature.

- [ ] **Step 2: Run focused test suites**

Run:

```bash
pnpm --filter @repo/trpc test -- test/plan.test.ts test/ai-settings-router.test.ts
pnpm --filter web test -- agents-payload.test.ts api-agents-generate.test.ts ai-section.test.tsx
pnpm --filter engines test -- agents-client.service vectorization-cron.service
cd apps/agents && uv run pytest tests/apps/processing tests/apps/chat -q
```

Expected: all focused suites pass.

- [ ] **Step 3: Run full monorepo gates**

Run from repo root:

```bash
pnpm gates
```

Expected: Turbo reports all check-types, lint, build, and test tasks successful.

- [ ] **Step 4: Commit verification fixes**

If Step 1, Step 2, or Step 3 required compile or test fixes, commit them:

```bash
git add packages apps
git commit -m "fix: complete workspace embedding model integration"
```

If no fixes were required, do not create an empty commit.

## Implementation Notes

- Keep existing unrelated dirty files untouched.
- Do not introduce a new indexing feature flag.
- Do not seed OpenAI models in this pass.
- Existing workspaces must keep `embeddingsModelId = null`.
- `nomic-embed-text` is embedding-only because `contextTokens` is `0`.
- GigaChat rows are both chat-capable and embedding-capable because they keep positive `contextTokens` and set `embeddings = true`.
- The plan uses `1024` dimensions for the approved GigaChat seed rows and `768` for `nomic-embed-text`.
- `RagRetrievalService` must treat retrieval errors as best-effort and return no retrieved documents rather than failing the LLM response.
