# Per-Workspace Embeddings Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the page-vectorization model selectable per workspace, with three concrete providers (Ollama, OpenAI, GigaChat). When no model is selected, indexing and RAG retrieval are silently skipped. Switching models wipes the workspace's existing vectors and re-enqueues every page.

**Architecture:** Single Qdrant collection per (provider, model) named `pages_{provider}_{modelSlug}`. Workspace isolation via `workspaceId` filter in payload (already in place). Indexer cron does late-binding lookup of the workspace's current embeddings model when claiming an outbox event. tRPC `aiSettings.update` wraps the wipe+reindex flow: in-DB transaction (cancel PENDING + enqueue fresh `page.upserted`), then HTTP `DELETE /vectorization/workspaces/{id}` to `apps/agents`. RAG retrieval becomes conditional on the chat-side payload — if `embedding` is null, the graph is built without the retrieval node.

**Tech Stack:** Prisma 7, tRPC v11, Zod, NestJS 11, Python 3.13 (FastAPI + LangChain + Dishka), LangGraph, Qdrant, MUI v6.

**Spec:** [docs/superpowers/specs/2026-04-29-per-workspace-embeddings-design.md](../specs/2026-04-29-per-workspace-embeddings-design.md)

---

## Phase 0 — Foundation: schema, types, seed

### Task 1: Prisma schema — add embeddings columns and relation

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_add_workspace_embeddings_model/migration.sql` (auto-generated)

- [ ] **Step 1: Edit `AiModel` to add `supportsEmbeddings` and `vectorSize`**

In `packages/db/prisma/schema.prisma`, find the `AiModel` model (around line 356) and add the two fields right after `supportsVision`:

```prisma
model AiModel {
  id                String                @id @default(uuid(7)) @db.Uuid
  providerId        String                @map("provider_id") @db.Uuid
  slug              String                @db.VarChar(100)
  displayName       String                @map("display_name") @db.VarChar(150)
  contextTokens     Int                   @map("context_tokens")
  supportsVision    Boolean               @default(false) @map("supports_vision")
  supportsEmbeddings Boolean              @default(false) @map("supports_embeddings")
  vectorSize        Int?                  @map("vector_size")
  minPlanSlug       String?               @map("min_plan_slug")
  isActive          Boolean               @default(true) @map("is_active")
  deprecatedAt      DateTime?             @map("deprecated_at") @db.Timestamptz(6)
  createdAt         DateTime              @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime              @updatedAt @map("updated_at") @db.Timestamptz(6)
  provider          AiProvider            @relation(fields: [providerId], references: [id], onDelete: Cascade)
  workspaceSettings        WorkspaceAiSettings[] @relation("WorkspaceAiSettings_default")
  workspaceEmbeddingsSettings WorkspaceAiSettings[] @relation("WorkspaceAiSettings_embeddings")

  @@unique([providerId, slug])
  @@map("ai_models")
}
```

Note: the existing `workspaceSettings` back-relation needs the named relation `"WorkspaceAiSettings_default"` because we're introducing a second relation pointing to the same model.

- [ ] **Step 2: Edit `WorkspaceAiSettings` to add the embeddings model relation**

Replace the existing `defaultModel` relation with two named relations:

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
  defaultModel    AiModel?  @relation("WorkspaceAiSettings_default",    fields: [defaultModelId],    references: [id], onDelete: SetNull)
  embeddingsModel AiModel?  @relation("WorkspaceAiSettings_embeddings", fields: [embeddingsModelId], references: [id], onDelete: SetNull)

  @@index([defaultModelId])
  @@index([embeddingsModelId])
  @@map("workspace_ai_settings")
}
```

- [ ] **Step 3: Generate the migration**

Run from repo root:
```bash
pnpm --filter @repo/db exec prisma migrate dev --name add_workspace_embeddings_model
```

Expected: a new directory under `packages/db/prisma/migrations/`, auto-generated SQL adds three columns and the new index. Prisma client regenerates.

- [ ] **Step 4: Verify the generated SQL**

Open the generated `migration.sql`. It should contain (at minimum):
- `ALTER TABLE "ai_models" ADD COLUMN "supports_embeddings" BOOLEAN NOT NULL DEFAULT false`
- `ALTER TABLE "ai_models" ADD COLUMN "vector_size" INTEGER`
- `ALTER TABLE "workspace_ai_settings" ADD COLUMN "embeddings_model_id" UUID`
- `ALTER TABLE "workspace_ai_settings" ADD CONSTRAINT "workspace_ai_settings_embeddings_model_id_fkey" FOREIGN KEY ("embeddings_model_id") REFERENCES "ai_models"("id") ON DELETE SET NULL ON UPDATE CASCADE`
- `CREATE INDEX "workspace_ai_settings_embeddings_model_id_idx" ON "workspace_ai_settings"("embeddings_model_id")`

- [ ] **Step 5: Run check-types from repo root to confirm Prisma client regenerated**

```bash
pnpm check-types
```

Expected: PASS. The new fields `supportsEmbeddings`, `vectorSize`, `embeddingsModelId`, `embeddingsModel` are recognized in any consumer that already imports the types.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): add embeddings model fields to AiModel and WorkspaceAiSettings"
```

---

### Task 2: Typed `AiProviderConnection` Zod schema in `@repo/db`

**Files:**
- Create: `packages/db/src/ai-provider-connection.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/ai-provider-connection.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseAiProviderConnection } from './ai-provider-connection'

describe('parseAiProviderConnection', () => {
  it('parses Ollama with explicit provider key', () => {
    expect(parseAiProviderConnection('ollama', { provider: 'ollama', baseUrl: 'http://x:11434' })).toEqual({
      provider: 'ollama',
      baseUrl: 'http://x:11434',
    })
  })

  it('parses Ollama when provider key is missing (uses providerSlug)', () => {
    expect(parseAiProviderConnection('ollama', { baseUrl: 'http://x:11434' })).toEqual({
      provider: 'ollama',
      baseUrl: 'http://x:11434',
    })
  })

  it('parses OpenAI', () => {
    expect(parseAiProviderConnection('openai', { apiKey: 'sk-x', organization: 'org' })).toEqual({
      provider: 'openai',
      apiKey: 'sk-x',
      organization: 'org',
    })
  })

  it('parses GigaChat', () => {
    expect(
      parseAiProviderConnection('gigachat', {
        clientId: 'a', clientSecret: 'b', scope: 'GIGACHAT_API_PERS',
      }),
    ).toEqual({
      provider: 'gigachat',
      clientId: 'a',
      clientSecret: 'b',
      scope: 'GIGACHAT_API_PERS',
    })
  })

  it('throws on unknown provider', () => {
    expect(() => parseAiProviderConnection('mystery', {})).toThrow(/unknown provider/i)
  })

  it('throws on invalid Ollama (missing baseUrl)', () => {
    expect(() => parseAiProviderConnection('ollama', {})).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @repo/db test
```

Expected: FAIL with module not found for `./ai-provider-connection`.

- [ ] **Step 3: Implement the schema and parser**

Create `packages/db/src/ai-provider-connection.ts`:

```ts
import { z } from 'zod'

export const AiProviderConnectionSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('ollama'),
    baseUrl: z.string().url(),
  }),
  z.object({
    provider: z.literal('openai'),
    apiKey: z.string().min(1),
    organization: z.string().optional(),
    baseUrl: z.string().url().optional(),
  }),
  z.object({
    provider: z.literal('gigachat'),
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
    scope: z.string().optional(),
  }),
])

export type AiProviderConnection = z.infer<typeof AiProviderConnectionSchema>

const KNOWN_PROVIDERS = ['ollama', 'openai', 'gigachat'] as const

export function parseAiProviderConnection(
  providerSlug: string,
  raw: unknown,
): AiProviderConnection {
  if (!KNOWN_PROVIDERS.includes(providerSlug as (typeof KNOWN_PROVIDERS)[number])) {
    throw new Error(`unknown provider: ${providerSlug}`)
  }
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const merged = { ...obj, provider: providerSlug }
  return AiProviderConnectionSchema.parse(merged)
}
```

- [ ] **Step 4: Re-export from package root**

In `packages/db/src/index.ts`, add at the end of the file:

```ts
export {
  AiProviderConnectionSchema,
  parseAiProviderConnection,
  type AiProviderConnection,
} from './ai-provider-connection'
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm --filter @repo/db test
```

Expected: PASS for all 6 cases.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/ai-provider-connection.ts packages/db/src/ai-provider-connection.test.ts packages/db/src/index.ts
git commit -m "feat(db): add AiProviderConnection Zod schema and parser"
```

---

### Task 3: Seed — embeddings models + OpenAI provider

**Files:**
- Modify: `packages/db/prisma/seed.ts`

- [ ] **Step 1: Add OpenAI to the providers block**

In `packages/db/prisma/seed.ts`, find the `aiProviders` array (around line 137). Replace with:

```ts
const aiProviders = [
  {
    slug: 'gigachat',
    name: 'GigaChat',
    connection: {
      clientId: '019da3de-19e1-7f92-a0e1-5b90595c8e6c',
      clientSecret: 'e0762394-8b7c-48d4-84ea-dd3e4e57420b',
      scope: 'GIGACHAT_API_PERS',
    } satisfies Prisma.InputJsonValue,
  },
  {
    slug: 'ollama',
    name: 'Ollama',
    connection: {
      baseUrl: 'http://localhost:11434',
    } satisfies Prisma.InputJsonValue,
  },
  {
    slug: 'openai',
    name: 'OpenAI',
    connection: {
      apiKey: process.env.OPENAI_API_KEY ?? '',
    } satisfies Prisma.InputJsonValue,
  },
] as const
```

`OPENAI_API_KEY` is read from env at seed time. In dev, the value can stay empty — embedding selection of OpenAI models will fail at runtime with a clear error until a real key is provided.

- [ ] **Step 2: Add `vectorSize` and `supportsEmbeddings` to existing model entries (LLMs get explicit `false`)**

Find the `aiModels` array (around line 178). For every existing entry add `supportsEmbeddings: false`. Example for one entry — repeat for all five existing rows (`gigachat-2`, `gigachat-2-pro`, `gigachat-2-max`, `gemma4`, etc.):

```ts
{
  providerSlug: 'gigachat',
  slug: 'gigachat-2',
  displayName: 'GigaChat-2',
  contextTokens: 32000,
  supportsVision: false,
  supportsEmbeddings: false,
  vectorSize: null,
  minPlanSlug: 'pro',
},
```

- [ ] **Step 3: Append new embeddings-capable models**

At the end of the `aiModels` array (just before the closing `] as const`), insert:

```ts
{
  providerSlug: 'ollama',
  slug: 'nomic-embed-text',
  displayName: 'Nomic Embed Text (Ollama)',
  contextTokens: 0,
  supportsVision: false,
  supportsEmbeddings: true,
  vectorSize: 768,
  minPlanSlug: null,
},
{
  providerSlug: 'ollama',
  slug: 'bge-m3',
  displayName: 'BGE-M3 (Ollama)',
  contextTokens: 0,
  supportsVision: false,
  supportsEmbeddings: true,
  vectorSize: 1024,
  minPlanSlug: null,
},
{
  providerSlug: 'openai',
  slug: 'text-embedding-3-small',
  displayName: 'OpenAI Embeddings 3 Small',
  contextTokens: 0,
  supportsVision: false,
  supportsEmbeddings: true,
  vectorSize: 1536,
  minPlanSlug: 'pro',
},
{
  providerSlug: 'openai',
  slug: 'text-embedding-3-large',
  displayName: 'OpenAI Embeddings 3 Large',
  contextTokens: 0,
  supportsVision: false,
  supportsEmbeddings: true,
  vectorSize: 3072,
  minPlanSlug: 'max',
},
{
  providerSlug: 'gigachat',
  slug: 'embeddings',
  displayName: 'GigaChat Embeddings',
  contextTokens: 0,
  supportsVision: false,
  supportsEmbeddings: true,
  vectorSize: 1024,
  minPlanSlug: 'pro',
},
```

Note: `contextTokens` is 0 for embeddings models (the field is required by the schema and not meaningful for embeddings). The GigaChat slug `embeddings` matches the GigaChat REST API model id; verify against current GigaChat docs if API rejects it.

- [ ] **Step 4: Update the `aiModel.upsert` block to write the new columns**

Find the `prisma.aiModel.upsert` call (around line 232). Replace its body so both `update` and `create` propagate the new fields:

```ts
await prisma.aiModel.upsert({
  where: { providerId_slug: { providerId: provider.id, slug: m.slug } },
  update: {
    displayName: m.displayName,
    contextTokens: m.contextTokens,
    supportsVision: m.supportsVision,
    supportsEmbeddings: m.supportsEmbeddings,
    vectorSize: m.vectorSize,
    minPlanSlug: m.minPlanSlug,
    isActive: true,
  },
  create: {
    providerId: provider.id,
    slug: m.slug,
    displayName: m.displayName,
    contextTokens: m.contextTokens,
    supportsVision: m.supportsVision,
    supportsEmbeddings: m.supportsEmbeddings,
    vectorSize: m.vectorSize,
    minPlanSlug: m.minPlanSlug,
    isActive: true,
  },
})
```

- [ ] **Step 5: Update the GigaChat-active-models filter to allow new embeddings slug**

Around line 196, find `const gigachatModelSlugs = ['gigachat-2', 'gigachat-2-pro', 'gigachat-2-max'] as const`. Append `'embeddings'`:

```ts
const gigachatModelSlugs = ['gigachat-2', 'gigachat-2-pro', 'gigachat-2-max', 'embeddings'] as const
```

- [ ] **Step 6: Update the trailing log line to reflect new counts**

Replace the `console.info` at the end of `main()`:

```ts
console.info('Seed complete: 5 providers, 3 active plans, 3 AI providers, 9 AI models')
```

- [ ] **Step 7: Run the seed against the local DB**

Make sure docker compose is up:
```bash
docker compose up -d
pnpm --filter @repo/db exec prisma db seed
```

Expected: success, including the trailing `console.info` line. No constraint violations.

- [ ] **Step 8: Verify embeddings models are present**

```bash
psql $DATABASE_URL -c "SELECT slug, supports_embeddings, vector_size FROM ai_models WHERE supports_embeddings = true ORDER BY slug"
```

Expected: 5 rows — `bge-m3` (1024), `embeddings` (1024), `nomic-embed-text` (768), `text-embedding-3-large` (3072), `text-embedding-3-small` (1536).

- [ ] **Step 9: Commit**

```bash
git add packages/db/prisma/seed.ts
git commit -m "feat(db): seed embeddings models and OpenAI provider"
```

---

## Phase 1 — apps/agents: vectorization core

### Task 4: New schemas — `EmbeddingProviderConfigSchema` and extended `VectorizationRequestSchema`

**Files:**
- Modify: `apps/agents/agents/apps/processing/schemas.py`

- [ ] **Step 1: Read the current schema file to identify the exact existing shape**

Read `apps/agents/agents/apps/processing/schemas.py` to confirm structure before editing.

- [ ] **Step 2: Replace the existing schemas file with the extended version**

Replace `apps/agents/agents/apps/processing/schemas.py` with:

```python
from typing import Annotated, Literal

from fast_clean.schemas.request_response import RequestResponseSchema
from pydantic import BaseModel, ConfigDict, Field

from agents.apps.chat.enums import ModelProviderEnum
from agents.apps.chat.schemas import ModelConnectionSchema


class BlockContentSchema(RequestResponseSchema):
    block_number: int = Field(alias='blockNumber')
    content: str


class EmbeddingProviderConfigSchema(RequestResponseSchema):
    model_config = ConfigDict(populate_by_name=True)

    provider: ModelProviderEnum
    model_slug: str = Field(alias='modelSlug')
    vector_size: int = Field(alias='vectorSize')
    connection: ModelConnectionSchema


class VectorizationRequestSchema(RequestResponseSchema):
    model_config = ConfigDict(populate_by_name=True)

    page_id: str = Field(alias='pageId')
    workspace_id: str = Field(alias='workspaceId')
    title: str
    page_type: str = Field(alias='pageType')
    contents: Annotated[list[BlockContentSchema], Field(default_factory=list)]
    embedding: EmbeddingProviderConfigSchema


class VectorizationResponseSchema(RequestResponseSchema):
    status: Literal['ok']
    chunks_indexed: int = Field(alias='chunksIndexed')


class WorkspaceWipeResponseSchema(RequestResponseSchema):
    deleted_collections: list[str] = Field(default_factory=list, alias='deletedCollections')


class PageWipeResponseSchema(RequestResponseSchema):
    deleted_collections: list[str] = Field(default_factory=list, alias='deletedCollections')
```

If `BlockContentSchema` already exists in this file, keep the existing definition. Reuse `ModelConnectionSchema` (defined in `apps/agents/agents/apps/chat/schemas.py:77-83`) — it already has the union of all needed connection fields (`base_url`, `api_key`, `organization`, `client_id`, `client_secret`, `scope`).

- [ ] **Step 3: Run `apps/agents` tests to confirm nothing else broke**

```bash
pnpm --filter agents test 2>/dev/null || (cd apps/agents && uv run pytest -q)
```

Expected: existing tests still pass; any test that constructs `VectorizationRequestSchema` will now require an `embedding` field — that's caught and fixed in the next task.

- [ ] **Step 4: Commit**

```bash
git add apps/agents/agents/apps/processing/schemas.py
git commit -m "feat(agents): add EmbeddingProviderConfigSchema and require embedding in vectorization request"
```

---

### Task 5: `EmbeddingFactoryRepository`

**Files:**
- Create: `apps/agents/agents/apps/processing/repositories/embedding_factory.py`
- Create: `apps/agents/tests/processing/test_embedding_factory.py`
- Modify: `apps/agents/agents/apps/processing/repositories/__init__.py`

- [ ] **Step 1: Write the failing test**

Create `apps/agents/tests/processing/test_embedding_factory.py`:

```python
from base64 import b64encode
from unittest.mock import MagicMock, patch

import pytest

from agents.apps.chat.enums import ModelProviderEnum
from agents.apps.chat.schemas import ModelConnectionSchema
from agents.apps.chat.errors import InvalidPayloadError
from agents.apps.processing.repositories.embedding_factory import EmbeddingFactoryRepository
from agents.apps.processing.schemas import EmbeddingProviderConfigSchema


def _config(provider: ModelProviderEnum, **conn: object) -> EmbeddingProviderConfigSchema:
    return EmbeddingProviderConfigSchema(
        provider=provider,
        modelSlug='m',
        vectorSize=768,
        connection=ModelConnectionSchema(**conn),
    )


def test_make_ollama() -> None:
    factory = EmbeddingFactoryRepository()
    with patch('agents.apps.processing.repositories.embedding_factory.OllamaEmbeddings') as MockEmb:
        MockEmb.return_value = MagicMock()
        factory.make(_config(ModelProviderEnum.OLLAMA, base_url='http://o:1'))
        MockEmb.assert_called_once_with(model='m', base_url='http://o:1')


def test_make_openai_requires_api_key() -> None:
    factory = EmbeddingFactoryRepository()
    with pytest.raises(InvalidPayloadError, match='OpenAI'):
        factory.make(_config(ModelProviderEnum.OPENAI))


def test_make_openai_passes_api_key() -> None:
    factory = EmbeddingFactoryRepository()
    with patch('agents.apps.processing.repositories.embedding_factory.OpenAIEmbeddings') as MockEmb:
        MockEmb.return_value = MagicMock()
        factory.make(_config(ModelProviderEnum.OPENAI, api_key='sk-x', organization='org'))
        kwargs = MockEmb.call_args.kwargs
        assert kwargs['model'] == 'm'
        assert kwargs['organization'] == 'org'


def test_make_gigachat_b64_credentials() -> None:
    factory = EmbeddingFactoryRepository()
    with patch('agents.apps.processing.repositories.embedding_factory.GigaChatEmbeddings') as MockEmb:
        MockEmb.return_value = MagicMock()
        factory.make(_config(
            ModelProviderEnum.GIGACHAT,
            client_id='cid', client_secret='csec', scope='GIGACHAT_API_PERS',
        ))
        kwargs = MockEmb.call_args.kwargs
        assert kwargs['credentials'] == b64encode(b'cid:csec').decode()
        assert kwargs['scope'] == 'GIGACHAT_API_PERS'
        assert kwargs['model'] == 'm'


def test_make_unknown_provider_raises() -> None:
    factory = EmbeddingFactoryRepository()
    with pytest.raises(InvalidPayloadError, match='Unknown'):
        factory.make(EmbeddingProviderConfigSchema.model_construct(
            provider='unknown', model_slug='x', vector_size=1, connection=ModelConnectionSchema(),
        ))
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/agents && uv run pytest tests/processing/test_embedding_factory.py -v
```

Expected: FAIL with `ModuleNotFoundError: No module named '...embedding_factory'`.

- [ ] **Step 3: Implement the factory**

Create `apps/agents/agents/apps/processing/repositories/embedding_factory.py`:

```python
from base64 import b64encode
from dataclasses import dataclass

from langchain_core.embeddings import Embeddings
from langchain_gigachat.embeddings import GigaChatEmbeddings
from langchain_ollama import OllamaEmbeddings
from langchain_openai import OpenAIEmbeddings
from pydantic import SecretStr

from agents.apps.chat.enums import ModelProviderEnum
from agents.apps.chat.errors import InvalidPayloadError

from ..schemas import EmbeddingProviderConfigSchema


@dataclass
class EmbeddingFactoryRepository:

    @staticmethod
    def make(config: EmbeddingProviderConfigSchema) -> Embeddings:
        provider = str(config.provider)

        match provider:
            case ModelProviderEnum.OLLAMA:
                if config.connection.base_url is None:
                    raise InvalidPayloadError('Ollama provider requires base_url')
                return OllamaEmbeddings(model=config.model_slug, base_url=config.connection.base_url)

            case ModelProviderEnum.OPENAI:
                if config.connection.api_key is None:
                    raise InvalidPayloadError('OpenAI provider requires an api_key in the connection config')
                return OpenAIEmbeddings(
                    model=config.model_slug,
                    api_key=SecretStr(config.connection.api_key),
                    organization=config.connection.organization,
                    base_url=config.connection.base_url,
                )

            case ModelProviderEnum.GIGACHAT:
                if config.connection.client_id is None or config.connection.client_secret is None:
                    raise InvalidPayloadError('GigaChat provider requires client_id and client_secret')
                credentials = b64encode(
                    f"{config.connection.client_id}:{config.connection.client_secret}".encode()
                ).decode()
                return GigaChatEmbeddings(
                    credentials=credentials,
                    scope=config.connection.scope or 'GIGACHAT_API_PERS',
                    model=config.model_slug,
                    verify_ssl_certs=False,
                )
            case _:
                raise InvalidPayloadError(f"Unknown embedding provider: {provider!r}")
```

- [ ] **Step 4: Re-export from package**

Edit `apps/agents/agents/apps/processing/repositories/__init__.py` and append:

```python
from .embedding_factory import EmbeddingFactoryRepository

__all__ = [..., 'EmbeddingFactoryRepository']
```

(Preserve existing exports; add `EmbeddingFactoryRepository` to `__all__`.)

- [ ] **Step 5: Run test to verify it passes**

```bash
cd apps/agents && uv run pytest tests/processing/test_embedding_factory.py -v
```

Expected: PASS for all 5 cases.

- [ ] **Step 6: Commit**

```bash
git add apps/agents/agents/apps/processing/repositories/embedding_factory.py apps/agents/agents/apps/processing/repositories/__init__.py apps/agents/tests/processing/test_embedding_factory.py
git commit -m "feat(agents): add EmbeddingFactoryRepository for ollama/openai/gigachat"
```

---

### Task 6: `collection_name_for` helper + `VectorStoreRepository` parameterization

**Files:**
- Create: `apps/agents/agents/apps/processing/utils.py`
- Modify: `apps/agents/agents/apps/processing/repositories/vector_store_repository.py`
- Create: `apps/agents/tests/processing/test_collection_name.py`

- [ ] **Step 1: Write the failing test for `collection_name_for`**

Create `apps/agents/tests/processing/test_collection_name.py`:

```python
from agents.apps.processing.utils import collection_name_for


def test_simple_slug() -> None:
    assert collection_name_for('ollama', 'nomic-embed-text') == 'pages_ollama_nomic-embed-text'


def test_normalizes_dots_and_underscores() -> None:
    assert collection_name_for('openai', 'text.embedding_3.small') == 'pages_openai_text-embedding-3-small'


def test_lowercases() -> None:
    assert collection_name_for('GigaChat', 'Embeddings') == 'pages_gigachat_embeddings'


def test_strips_leading_trailing_dashes() -> None:
    assert collection_name_for('ollama', '__bge.m3__') == 'pages_ollama_bge-m3'
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/agents && uv run pytest tests/processing/test_collection_name.py -v
```

Expected: FAIL.

- [ ] **Step 3: Implement the helper**

Create `apps/agents/agents/apps/processing/utils.py`:

```python
import re


def collection_name_for(provider_slug: str, model_slug: str) -> str:
    def _safe(s: str) -> str:
        return re.sub(r'[^a-z0-9-]+', '-', s.lower()).strip('-')

    return f'pages_{_safe(provider_slug)}_{_safe(model_slug)}'
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/agents && uv run pytest tests/processing/test_collection_name.py -v
```

Expected: PASS for all 4 cases.

- [ ] **Step 5: Refactor `VectorStoreRepository` to be stateless**

Replace `apps/agents/agents/apps/processing/repositories/vector_store_repository.py` with:

```python
from dataclasses import dataclass
from typing import Any

from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings
from qdrant_client import AsyncQdrantClient
from qdrant_client.http.exceptions import UnexpectedResponse
from qdrant_client.http.models import (
    Distance, FieldCondition, Filter, MatchValue, PointStruct, VectorParams,
)


@dataclass
class VectorStoreRepository:
    client: AsyncQdrantClient

    async def list_collections(self) -> list[str]:
        res = await self.client.get_collections()
        return [c.name for c in res.collections]

    async def collection_exists(self, name: str) -> bool:
        try:
            await self.client.get_collection(name)
            return True
        except UnexpectedResponse as e:
            if e.status_code == 404:
                return False
            raise

    async def ensure_collection(self, name: str, vector_size: int) -> None:
        try:
            await self.client.create_collection(
                name,
                vectors_config=VectorParams(size=vector_size, distance=Distance.COSINE),
            )
        except UnexpectedResponse as e:
            if e.status_code != 409:
                raise

    async def delete_by_page(self, collection_name: str, page_id: str) -> None:
        if not await self.collection_exists(collection_name):
            return
        await self.client.delete(
            collection_name,
            points_selector=Filter(
                must=[FieldCondition(key='pageId', match=MatchValue(value=page_id))],
            ),
        )

    async def delete_by_workspace(self, collection_name: str, workspace_id: str) -> None:
        if not await self.collection_exists(collection_name):
            return
        await self.client.delete(
            collection_name,
            points_selector=Filter(
                must=[FieldCondition(key='workspaceId', match=MatchValue(value=workspace_id))],
            ),
        )

    async def upsert_chunks(
        self,
        collection_name: str,
        points: list[tuple[str, list[float], dict[str, Any]]],
    ) -> None:
        if not points:
            return
        await self.client.upsert(
            collection_name,
            points=[
                PointStruct(id=pid, vector=vec, payload=pl)
                for (pid, vec, pl) in points
            ],
        )

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
        if not await self.collection_exists(collection_name):
            return []
        vector = await embeddings.aembed_query(query)
        res = await self.client.query_points(
            collection_name=collection_name,
            query=vector,
            limit=k,
            query_filter=Filter(
                must=[FieldCondition(key='workspaceId', match=MatchValue(value=workspace_id))],
            ),
            with_payload=True,
            with_vectors=False,
        )
        return [
            Document(page_content=str(p.payload.get('content', '')), metadata=dict(p.payload))
            for p in res.points
            if p.payload
        ]
```

- [ ] **Step 6: Run all `apps/agents` tests**

```bash
cd apps/agents && uv run pytest -q
```

Expected: tests for `embedding_factory` and `collection_name` pass; `vectorize_page` tests will fail next task (we'll fix in Task 7); `rag_retrieval` tests will fail because the signature changed (fix in Task 11).

- [ ] **Step 7: Commit**

```bash
git add apps/agents/agents/apps/processing/utils.py apps/agents/agents/apps/processing/repositories/vector_store_repository.py apps/agents/tests/processing/test_collection_name.py
git commit -m "refactor(agents): make VectorStoreRepository stateless, add collection_name_for"
```

---

### Task 7: `VectorizePageUseCase` rewrite + Dishka rewiring + bootstrap cleanup + settings cleanup

**Files:**
- Modify: `apps/agents/agents/apps/processing/use_cases/vectorize_page.py`
- Modify: `apps/agents/agents/apps/processing/depends.py`
- Modify: `apps/agents/agents/bootstrap.py`
- Modify: `apps/agents/agents/settings.py`
- Modify: `apps/agents/agents/apps/processing/repositories/vectorization_repository.py` (delete or repurpose)

- [ ] **Step 1: Read current `vectorize_page.py` to identify the chunking logic to preserve**

Read `apps/agents/agents/apps/processing/use_cases/vectorize_page.py`. Note: the chunking + normalization + UUID-stable-id logic must be preserved exactly. Only the embedder source and collection name change.

- [ ] **Step 2: Rewrite `vectorize_page.py`**

Replace the file with:

```python
import hashlib
from dataclasses import dataclass
from uuid import UUID

from agents.apps.processing.repositories import EmbeddingFactoryRepository, VectorStoreRepository
from agents.apps.processing.schemas import VectorizationRequestSchema, VectorizationResponseSchema
from agents.apps.processing.services import ChunkerService, NormalizerService
from agents.apps.processing.utils import collection_name_for


@dataclass
class VectorizePageUseCase:
    chunker: ChunkerService
    normalizer: NormalizerService
    vector_store: VectorStoreRepository
    embedding_factory: EmbeddingFactoryRepository

    async def __call__(self, payload: VectorizationRequestSchema) -> VectorizationResponseSchema:
        embedder = self.embedding_factory.make(payload.embedding)
        collection = collection_name_for(payload.embedding.provider, payload.embedding.model_slug)

        await self.vector_store.ensure_collection(collection, payload.embedding.vector_size)
        await self.vector_store.delete_by_page(collection, payload.page_id)

        rows: list[tuple[str, str, int, int]] = []  # (raw, normalized, blockNumber, chunkIdx)
        for block in payload.contents:
            chunks = self.chunker.split(block.content)
            for idx, raw in enumerate(chunks):
                normalized = self.normalizer.normalize(raw)
                if not normalized:
                    continue
                rows.append((raw, normalized, block.block_number, idx))

        if not rows:
            return VectorizationResponseSchema(status='ok', chunksIndexed=0)

        normalized_texts = [r[1] for r in rows]
        vectors = await embedder.aembed_documents(normalized_texts)

        points: list[tuple[str, list[float], dict[str, object]]] = []
        for (raw, _, block_number, chunk_idx), vec in zip(rows, vectors, strict=True):
            digest = hashlib.sha256(
                f'{payload.page_id}:{block_number}:{chunk_idx}'.encode(),
            ).digest()[:16]
            stable_id = str(UUID(bytes=digest))
            points.append((stable_id, vec, {
                'pageId': payload.page_id,
                'workspaceId': payload.workspace_id,
                'title': payload.title,
                'pageType': payload.page_type,
                'blockNumber': block_number,
                'content': raw,
            }))

        await self.vector_store.upsert_chunks(collection, points)
        return VectorizationResponseSchema(status='ok', chunksIndexed=len(points))
```

- [ ] **Step 3: Rewrite `processing/depends.py` (Dishka)**

Replace `apps/agents/agents/apps/processing/depends.py` with:

```python
"""Dishka providers for the processing (vectorization) application."""

from __future__ import annotations

from dishka import Provider, Scope, provide
from qdrant_client import AsyncQdrantClient

from .repositories import EmbeddingFactoryRepository, VectorStoreRepository
from .services import ChunkerService, LanguageDetectorService, NormalizerService
from .use_cases import VectorizePageUseCase, DeletePageVectorsUseCase, DeleteWorkspaceVectorsUseCase


class ProcessingProvider(Provider):
    scope = Scope.REQUEST

    chunker_service = provide(ChunkerService, scope=Scope.APP)
    language_detector_service = provide(LanguageDetectorService, scope=Scope.APP)
    normalizer_service = provide(NormalizerService, scope=Scope.APP)

    embedding_factory_repository = provide(EmbeddingFactoryRepository, scope=Scope.APP)

    @provide(scope=Scope.APP)
    async def vector_store_repository(self, client: AsyncQdrantClient) -> VectorStoreRepository:
        return VectorStoreRepository(client=client)

    vectorize_page_use_case = provide(VectorizePageUseCase)
    delete_page_vectors_use_case = provide(DeletePageVectorsUseCase)
    delete_workspace_vectors_use_case = provide(DeleteWorkspaceVectorsUseCase)


provider = ProcessingProvider()
```

The `DeletePageVectorsUseCase` and `DeleteWorkspaceVectorsUseCase` are referenced here for Tasks 8 and 9; create stubs now (one-line classes that raise `NotImplementedError`) so the import resolves:

In `apps/agents/agents/apps/processing/use_cases/__init__.py`, add stubs:

```python
from dataclasses import dataclass


@dataclass
class DeletePageVectorsUseCase:
    async def __call__(self, page_id: str) -> object:
        raise NotImplementedError


@dataclass
class DeleteWorkspaceVectorsUseCase:
    async def __call__(self, workspace_id: str) -> object:
        raise NotImplementedError
```

These will be replaced with real implementations in Tasks 8 and 9.

- [ ] **Step 4: Remove `OllamaEmbeddings` provider from `core/depends.py`**

Open `apps/agents/agents/core/depends.py`. Delete the entire `ollama_embeddings` provider block (around lines 36-43). Also remove the `OllamaEmbeddings` import at the top of that file.

- [ ] **Step 5: Strip `embedding_model` and Qdrant collection settings from `settings.py`**

Edit `apps/agents/agents/settings.py`:
- In `OllamaSettingsSchema`, remove the `embedding_model: str = 'nomic-embed-text'` field.
- In `QdrantSettingsSchema`, remove the `collection_name: str = 'pages'` and `vector_size: int = 768` fields.

- [ ] **Step 6: Strip the `ensure_collection('pages')` call from `bootstrap.py`**

Edit `apps/agents/agents/bootstrap.py`. Replace lines 17-43 (the `lifespan` function body) with:

```python
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """
    Предварительная инициализация приложения.

    Коллекции в Qdrant создаются лениво при первом обращении —
    каждая под свой embeddings-провайдер и модель.
    """
    yield

    await ContainerManager.close()
```

Remove the `from agents.apps.processing.repositories import VectorStoreRepository` import inside the function and the bare-except handler.

- [ ] **Step 7: Delete `vectorization_repository.py`**

The file `apps/agents/agents/apps/processing/repositories/vectorization_repository.py` is no longer used (its responsibility has moved into `EmbeddingFactoryRepository` + `VectorizePageUseCase`):

```bash
git rm apps/agents/agents/apps/processing/repositories/vectorization_repository.py
```

Update `apps/agents/agents/apps/processing/repositories/__init__.py` to drop the `VectorizationRepository` export.

- [ ] **Step 8: Run agents tests**

```bash
cd apps/agents && uv run pytest -q
```

Expected: passes for processing/test_embedding_factory.py and test_collection_name.py. The existing vectorize_page integration test is expected to fail until we extend it with `embedding` payload — fix that here:

In whatever test creates a `VectorizationRequestSchema`, add an `embedding` field with the local Ollama dev defaults:

```python
embedding=EmbeddingProviderConfigSchema(
    provider=ModelProviderEnum.OLLAMA,
    modelSlug='nomic-embed-text',
    vectorSize=768,
    connection=ModelConnectionSchema(base_url='http://localhost:11434'),
),
```

Run the integration test (`pnpm --filter agents test:integration` or `cd apps/agents && uv run pytest -m integration`) and confirm green.

- [ ] **Step 9: Commit**

```bash
git add -A apps/agents/
git commit -m "refactor(agents): per-request embedder and collection in vectorize use case"
```

---

### Task 8: `DELETE /vectorization/pages/{page_id}` endpoint

**Files:**
- Modify: `apps/agents/agents/apps/processing/router.py`
- Create: `apps/agents/agents/apps/processing/use_cases/delete_page_vectors.py`
- Modify: `apps/agents/agents/apps/processing/use_cases/__init__.py`

- [ ] **Step 1: Replace the stub with a real use case**

Create `apps/agents/agents/apps/processing/use_cases/delete_page_vectors.py`:

```python
from dataclasses import dataclass

from ..repositories import VectorStoreRepository
from ..schemas import PageWipeResponseSchema


@dataclass
class DeletePageVectorsUseCase:
    vector_store: VectorStoreRepository

    async def __call__(self, page_id: str) -> PageWipeResponseSchema:
        deleted: list[str] = []
        for name in await self.vector_store.list_collections():
            if not name.startswith('pages_'):
                continue
            await self.vector_store.delete_by_page(name, page_id)
            deleted.append(name)
        return PageWipeResponseSchema(deletedCollections=deleted)
```

Replace the stub in `apps/agents/agents/apps/processing/use_cases/__init__.py`:

```python
from .vectorize_page import VectorizePageUseCase
from .delete_page_vectors import DeletePageVectorsUseCase
from .delete_workspace_vectors import DeleteWorkspaceVectorsUseCase

__all__ = ['VectorizePageUseCase', 'DeletePageVectorsUseCase', 'DeleteWorkspaceVectorsUseCase']
```

- [ ] **Step 2: Add the route handler**

Edit `apps/agents/agents/apps/processing/router.py`:

```python
from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter

from .schemas import (
    VectorizationRequestSchema,
    VectorizationResponseSchema,
    PageWipeResponseSchema,
    WorkspaceWipeResponseSchema,
)
from .use_cases import (
    VectorizePageUseCase,
    DeletePageVectorsUseCase,
    DeleteWorkspaceVectorsUseCase,
)

router = APIRouter(prefix='/vectorization', tags=['vectorization'])


@router.post('', response_model=VectorizationResponseSchema)
@inject
async def vectorize(
    payload: VectorizationRequestSchema,
    use_case: FromDishka[VectorizePageUseCase],
) -> VectorizationResponseSchema:
    return await use_case(payload)


@router.delete('/pages/{page_id}', response_model=PageWipeResponseSchema)
@inject
async def delete_page_vectors(
    page_id: str,
    use_case: FromDishka[DeletePageVectorsUseCase],
) -> PageWipeResponseSchema:
    return await use_case(page_id)
```

(The workspace endpoint is added in Task 9; keep its imports stubbed in Dishka for now.)

- [ ] **Step 3: Integration test**

Add to `apps/agents/tests/processing/test_delete_endpoints.py`:

```python
import pytest
from fastapi.testclient import TestClient

@pytest.mark.integration
def test_delete_page_vectors_idempotent(client: TestClient) -> None:
    # Calling on a page that has no vectors should still 200.
    response = client.delete('/vectorization/pages/00000000-0000-0000-0000-000000000000')
    assert response.status_code == 200
    body = response.json()
    assert 'deletedCollections' in body
```

Refer to existing fixtures (`tests/processing/conftest.py`) for the `client` fixture pattern.

- [ ] **Step 4: Run integration test**

```bash
cd apps/agents && uv run pytest tests/processing/test_delete_endpoints.py -v -m integration
```

Expected: PASS (200 with empty `deletedCollections`).

- [ ] **Step 5: Commit**

```bash
git add apps/agents/agents/apps/processing/use_cases/delete_page_vectors.py apps/agents/agents/apps/processing/use_cases/__init__.py apps/agents/agents/apps/processing/router.py apps/agents/tests/processing/test_delete_endpoints.py
git commit -m "feat(agents): DELETE /vectorization/pages/{id} endpoint"
```

---

### Task 9: `DELETE /vectorization/workspaces/{workspace_id}` endpoint

**Files:**
- Create: `apps/agents/agents/apps/processing/use_cases/delete_workspace_vectors.py`
- Modify: `apps/agents/agents/apps/processing/router.py`

- [ ] **Step 1: Replace the stub with a real use case**

Create `apps/agents/agents/apps/processing/use_cases/delete_workspace_vectors.py`:

```python
from dataclasses import dataclass

from ..repositories import VectorStoreRepository
from ..schemas import WorkspaceWipeResponseSchema


@dataclass
class DeleteWorkspaceVectorsUseCase:
    vector_store: VectorStoreRepository

    async def __call__(self, workspace_id: str) -> WorkspaceWipeResponseSchema:
        deleted: list[str] = []
        for name in await self.vector_store.list_collections():
            if not name.startswith('pages_'):
                continue
            await self.vector_store.delete_by_workspace(name, workspace_id)
            deleted.append(name)
        return WorkspaceWipeResponseSchema(deletedCollections=deleted)
```

- [ ] **Step 2: Register the route**

Edit `apps/agents/agents/apps/processing/router.py`, add at the end:

```python
@router.delete('/workspaces/{workspace_id}', response_model=WorkspaceWipeResponseSchema)
@inject
async def delete_workspace_vectors(
    workspace_id: str,
    use_case: FromDishka[DeleteWorkspaceVectorsUseCase],
) -> WorkspaceWipeResponseSchema:
    return await use_case(workspace_id)
```

- [ ] **Step 3: Integration test**

Append to `apps/agents/tests/processing/test_delete_endpoints.py`:

```python
@pytest.mark.integration
def test_delete_workspace_vectors_idempotent(client: TestClient) -> None:
    response = client.delete('/vectorization/workspaces/00000000-0000-0000-0000-000000000000')
    assert response.status_code == 200
    body = response.json()
    assert 'deletedCollections' in body


@pytest.mark.integration
def test_delete_workspace_vectors_isolates_other_workspaces(client: TestClient, qdrant_seed) -> None:
    """
    Insert two points for workspace A and one for workspace B in the same collection.
    Wipe workspace A. Verify B's point is still there.
    """
    # qdrant_seed fixture inserts canned points; implement once when running this test.
    pass
```

The second test uses a fixture `qdrant_seed` that does not yet exist. Either implement it (recommended) using direct `AsyncQdrantClient.upsert` calls in the fixture, or skip-mark it for follow-up. The first test (idempotent empty case) is mandatory.

- [ ] **Step 4: Run integration test**

```bash
cd apps/agents && uv run pytest tests/processing/test_delete_endpoints.py -v -m integration
```

Expected: PASS for the idempotent test.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/agents/apps/processing/use_cases/delete_workspace_vectors.py apps/agents/agents/apps/processing/router.py apps/agents/tests/processing/test_delete_endpoints.py
git commit -m "feat(agents): DELETE /vectorization/workspaces/{id} endpoint"
```

---

## Phase 2 — apps/agents: chat / RAG

### Task 10: Chat schema accepts optional `embedding` field

**Files:**
- Modify: `apps/agents/agents/apps/chat/schemas.py`

- [ ] **Step 1: Edit `QueryRequestSchema` to include optional embedding**

Open `apps/agents/agents/apps/chat/schemas.py`. Add an import at the top:

```python
from agents.apps.processing.schemas import EmbeddingProviderConfigSchema
```

In `QueryRequestSchema` (line 159-188), add a new field after `mcp`:

```python
embedding: EmbeddingProviderConfigSchema | None = None
"""
Конфигурация модели для векторного поиска. Если не указана — RAG-фаза пропускается.
"""
```

(Place it right before `query: str` to keep the schema layout coherent.)

- [ ] **Step 2: Run `apps/agents` tests**

```bash
cd apps/agents && uv run pytest -q
```

Expected: existing chat tests pass; the new field defaults to `None` so backward compatible.

- [ ] **Step 3: Commit**

```bash
git add apps/agents/agents/apps/chat/schemas.py
git commit -m "feat(agents): chat payload accepts optional embedding config"
```

---

### Task 11: `RagRetrievalService` rewrite (stateless w.r.t. embedder)

**Files:**
- Modify: `apps/agents/agents/apps/chat/services/rag_retrieval.py`
- Modify: `apps/agents/agents/apps/chat/depends.py`

- [ ] **Step 1: Rewrite the service to take the embedder and collection at call time**

Replace `apps/agents/agents/apps/chat/services/rag_retrieval.py` with:

```python
from dataclasses import dataclass
from uuid import UUID

from langchain_core.documents import Document

from agents.apps.processing.repositories import EmbeddingFactoryRepository, VectorStoreRepository
from agents.apps.processing.schemas import EmbeddingProviderConfigSchema
from agents.apps.processing.utils import collection_name_for

from ..schemas import RagDocumentSchema


@dataclass
class RagRetrievalService:
    """Поиск top-K релевантных чанков из Qdrant с dedup по (pageId, blockNumber)."""

    vector_store_repository: VectorStoreRepository
    embedding_factory_repository: EmbeddingFactoryRepository

    async def retrieve(
        self,
        *,
        embedding: EmbeddingProviderConfigSchema,
        workspace_id: UUID,
        query: str,
        k: int = 5,
    ) -> list[RagDocumentSchema]:
        embedder = self.embedding_factory_repository.make(embedding)
        collection = collection_name_for(embedding.provider, embedding.model_slug)
        docs = await self.vector_store_repository.similarity_search(
            collection_name=collection,
            embeddings=embedder,
            workspace_id=str(workspace_id),
            query=query,
            k=k * 3,
        )
        return self._dedupe(docs, k)

    @staticmethod
    def _dedupe(docs: list[Document], k: int) -> list[RagDocumentSchema]:
        seen: set[tuple[str, int]] = set()
        result: list[RagDocumentSchema] = []
        for d in docs:
            key = (d.metadata['pageId'], d.metadata['blockNumber'])
            if key in seen:
                continue
            seen.add(key)
            result.append(RagDocumentSchema(
                page_id=UUID(d.metadata['pageId']),
                workspace_id=UUID(d.metadata['workspaceId']),
                title=d.metadata['title'],
                page_type=d.metadata['pageType'],
                block_number=d.metadata['blockNumber'],
                content=d.metadata['content'],
            ))
            if len(result) >= k:
                break
        return result
```

- [ ] **Step 2: Wire the embedding factory into chat Dishka**

Edit `apps/agents/agents/apps/chat/depends.py`. The chat provider currently doesn't expose `EmbeddingFactoryRepository` and `VectorStoreRepository` — they live in the processing provider. Either reuse processing's bindings (recommended) by adding them as dependencies, or add explicit bindings here. The simplest path: in `apps/agents/agents/main.py` or wherever app providers are composed, ensure `ProcessingProvider` is registered alongside `ChatProvider` and the chat-side `RagRetrievalService` will receive the cross-app dependencies.

If `ProcessingProvider` is already registered globally (verify by reading `apps/agents/agents/main.py`), no chat-side changes are needed for this. Otherwise, add to `ChatProvider`:

```python
from agents.apps.processing.repositories import EmbeddingFactoryRepository, VectorStoreRepository

class ChatProvider(Provider):
    # ... existing scopes ...
    embedding_factory_repository = provide(EmbeddingFactoryRepository, scope=Scope.APP)
    # vector_store_repository should already be exposed from ProcessingProvider
```

- [ ] **Step 3: Run agents tests**

```bash
cd apps/agents && uv run pytest -q
```

Expected: rag_retrieval test (if any) needs updating to pass `embedding=...`. Update it inline: construct an `EmbeddingProviderConfigSchema` with `OLLAMA / nomic-embed-text / 768 / base_url=http://localhost:11434`.

- [ ] **Step 4: Commit**

```bash
git add apps/agents/agents/apps/chat/services/rag_retrieval.py apps/agents/agents/apps/chat/depends.py apps/agents/tests/
git commit -m "refactor(agents): RagRetrievalService takes embedder per call"
```

---

### Task 12: `GraphService.make_graph` — conditional RAG retrieval

**Files:**
- Modify: `apps/agents/agents/apps/chat/services/graph.py`

- [ ] **Step 1: Replace `prepare_prompt` to skip retrieval when embedding is null**

Edit `apps/agents/agents/apps/chat/services/graph.py`. In `prepare_prompt` (line 42-80), replace the RAG retrieval call:

```python
async def prepare_prompt(self, context: RuntimeContext, state: GraphStateSchema) -> GraphStateSchema:
    payload = state.payload

    servers = payload.mcp.servers if payload.mcp else []
    mcp_server_tools: list[McpServerToolsSchema] = []
    context.tools = []
    if servers:
        context.tools, mcp_server_tools = await self.mcp_tools_repository.fetch_mcp_tools(servers)

    rag_documents: list[RagDocumentSchema] = []
    if payload.embedding is not None:
        rag_documents = await self.rag_retrieval_service.retrieve(
            embedding=payload.embedding,
            workspace_id=state.user_context.x_workspace_id,
            query=payload.query,
            k=5,
        )

    messages: list[BaseMessage] = [SystemMessage(content=state.system_prompt)]
    messages += [
        HumanMessage(content=msg.content) if msg.role == RoleEnum.USER else AIMessage(content=msg.content)
        for msg in payload.messages
    ]

    user_query = self.jinja_repository.user_render(state.payload, mcp_server_tools, rag_documents)
    messages.append(HumanMessage(content=user_query))

    system_prompt = self.jinja_repository.system_render(state.payload, mcp_server_tools, rag_documents)

    return GraphStateSchema(
        payload=payload,
        user_context=state.user_context,
        system_prompt=system_prompt,
        tools=mcp_server_tools,
        messages=messages,
        response_text='',
    )
```

Make sure `RagDocumentSchema` is imported at the top of the file:

```python
from ..schemas import GraphStateSchema, McpServerToolsSchema, RagDocumentSchema, RuntimeContext
```

- [ ] **Step 2: Run agents tests**

```bash
cd apps/agents && uv run pytest -q
```

Expected: green. If a chat-graph test exists that exercised the retrieval path, it now needs `embedding=...` in its query payload — update accordingly.

- [ ] **Step 3: Commit**

```bash
git add apps/agents/agents/apps/chat/services/graph.py
git commit -m "feat(agents): skip RAG retrieval when embedding payload is null"
```

---

## Phase 3 — apps/engines: indexer

### Task 13: Extend `agents-client.service.ts` with embedding payload + delete methods

**Files:**
- Modify: `apps/engines/src/apps/indexer/services/agents-client.service.ts`

- [ ] **Step 1: Replace the file with the extended client**

Replace `apps/engines/src/apps/indexer/services/agents-client.service.ts` with:

```ts
import { Injectable } from '@nestjs/common'
import type { AiProviderConnection } from '@repo/db'

export type EmbeddingPayload = {
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
  private readonly baseUrl: string
  private readonly timeoutMs = 30_000

  constructor() {
    this.baseUrl = process.env.AGENTS_SERVICE_URL ?? 'http://localhost:8080'
  }

  async vectorize(payload: VectorizationPayload): Promise<void> {
    await this._request('POST', '/vectorization', payload)
  }

  async deletePageVectors(pageId: string): Promise<void> {
    await this._request('DELETE', `/vectorization/pages/${pageId}`)
  }

  async deleteWorkspaceVectors(workspaceId: string): Promise<void> {
    await this._request('DELETE', `/vectorization/workspaces/${workspaceId}`)
  }

  private async _request(method: string, path: string, body?: unknown): Promise<void> {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), this.timeoutMs)
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctl.signal,
      })
      if (!res.ok) {
        throw new Error(`agents ${method} ${path} ${res.status}: ${await res.text()}`)
      }
    } finally {
      clearTimeout(t)
    }
  }
}
```

- [ ] **Step 2: Run engines tests**

```bash
pnpm --filter engines test
```

Expected: passes; the existing `vectorize` callers will now fail typecheck because `embedding` is required — fixed in Task 14.

- [ ] **Step 3: Commit**

```bash
git add apps/engines/src/apps/indexer/services/agents-client.service.ts
git commit -m "feat(engines): agents-client adds embedding payload and delete methods"
```

---

### Task 14: `vectorization-cron.service.ts` — late-binding model lookup + page.deleted handling

**Files:**
- Modify: `apps/engines/src/apps/indexer/cron/vectorization-cron.service.ts`

- [ ] **Step 1: Update `processRow` to handle deletes via `deletePageVectors`**

Open `apps/engines/src/apps/indexer/cron/vectorization-cron.service.ts`. Find `processRow` (around line 99). Replace its body up to the agents call:

```ts
private async processRow(row: Row): Promise<void> {
  const allowed = await this.planFeatures.isPageIndexingEnabled(row.workspace_id)
  if (!allowed) {
    await this.markDone(row.id)
    return
  }

  if (row.event_type === 'page.deleted') {
    try {
      await this.agents.deletePageVectors(row.page_id)
      await this.markDone(row.id)
    } catch (err) {
      await this.markFailedOrRetry(row.id, err)
    }
    return
  }

  // page.upserted from here on — needs an active embeddings model.
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

  const page = await this.prisma.page.findUnique({
    where: { id: row.page_id },
    select: { id: true, type: true, deletedAt: true, title: true, content: true, workspaceId: true },
  })
  if (!page || page.deletedAt || page.type !== 'TEXT') {
    await this.markDone(row.id)
    return
  }

  const blocks = PageContentReader.blocksFromDoc(page.content)
  const contents = blocks.map((b, i) => ({ blockNumber: i, content: b.text }))

  let connection: AiProviderConnection
  try {
    connection = parseAiProviderConnection(model.provider.slug, model.provider.connection)
  } catch (err) {
    await this.markFailedOrRetry(row.id, err)
    return
  }

  try {
    await this.agents.vectorize({
      pageId: row.page_id,
      workspaceId: row.workspace_id,
      title: page.title ?? '',
      pageType: 'TEXT',
      contents,
      embedding: {
        provider: model.provider.slug as EmbeddingPayload['provider'],
        modelSlug: model.slug,
        vectorSize: model.vectorSize,
        connection,
      },
    })
    await this.markDone(row.id)
  } catch (err) {
    await this.markFailedOrRetry(row.id, err)
  }
}
```

Add the imports at the top:

```ts
import { parseAiProviderConnection, type AiProviderConnection } from '@repo/db'
import type { EmbeddingPayload } from '../services/agents-client.service'
```

(Verify `PageContentReader.blocksFromDoc` is the existing API; if it differs, mirror what's currently in the file.)

- [ ] **Step 2: Add a unit test for the skip path**

Create `apps/engines/src/apps/indexer/cron/vectorization-cron.service.spec.ts` (if it doesn't exist):

```ts
// Skeleton — adjust to existing test patterns in apps/engines.
import { Test } from '@nestjs/testing'
import { VectorizationCronService } from './vectorization-cron.service'

describe('VectorizationCronService.processRow', () => {
  it('skips page.upserted when no embeddings model selected', async () => {
    // Mock prisma.workspaceAiSettings.findUnique to return { embeddingsModel: null }.
    // Mock agents.vectorize to track calls.
    // Call processRow with a page.upserted row.
    // Assert markDone was called and agents.vectorize was NOT called.
  })

  it('routes page.deleted to deletePageVectors regardless of embeddings model', async () => {
    // Mock prisma.workspaceAiSettings to return null.
    // Mock agents.deletePageVectors.
    // Call processRow with a page.deleted row.
    // Assert agents.deletePageVectors was called with the page id.
  })
})
```

Implement against the existing test patterns in `apps/engines/src/`. If no equivalent unit test pattern exists, leave this as a TODO marker and rely on integration testing.

- [ ] **Step 3: Run engines tests + check-types**

```bash
pnpm --filter engines test
pnpm --filter engines check-types
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/engines/src/apps/indexer/cron/vectorization-cron.service.ts apps/engines/src/apps/indexer/cron/vectorization-cron.service.spec.ts
git commit -m "feat(engines): late-binding embeddings model + page.deleted via dedicated endpoint"
```

---

## Phase 4 — tRPC

### Task 15: Add `getAvailableEmbeddingModels` helper

**Files:**
- Modify: `packages/trpc/src/helpers/plan.ts`

- [ ] **Step 1: Add a helper that filters by `supportsEmbeddings`**

In `packages/trpc/src/helpers/plan.ts`, after `getAvailableAiModels` (around line 75), add:

```ts
export async function getAvailableEmbeddingModels(
  workspaceId: string,
): Promise<(AiModel & { provider: AiProvider })[]> {
  const features = await getWorkspaceFeatures(workspaceId)
  const allowed = await prisma.plan.findMany({
    where: { sortOrder: { lte: features.sortOrder } },
    select: { slug: true },
  })
  const allowedSlugs = allowed.map((r) => r.slug)
  return prisma.aiModel.findMany({
    where: {
      isActive: true,
      supportsEmbeddings: true,
      vectorSize: { not: null },
      OR: [{ minPlanSlug: null }, { minPlanSlug: { in: allowedSlugs } }],
    },
    include: { provider: true },
    orderBy: { displayName: 'asc' },
  })
}
```

- [ ] **Step 2: Adjust `getAvailableAiModels` to exclude embedding-only models**

Modify the existing helper so that LLM dropdowns don't show embeddings models:

```ts
export async function getAvailableAiModels(
  workspaceId: string,
): Promise<(AiModel & { provider: AiProvider })[]> {
  const features = await getWorkspaceFeatures(workspaceId)
  const allowed = await prisma.plan.findMany({
    where: { sortOrder: { lte: features.sortOrder } },
    select: { slug: true },
  })
  const allowedSlugs = allowed.map((r) => r.slug)
  return prisma.aiModel.findMany({
    where: {
      isActive: true,
      supportsEmbeddings: false,    // <-- new filter
      OR: [{ minPlanSlug: null }, { minPlanSlug: { in: allowedSlugs } }],
    },
    include: { provider: true },
    orderBy: { displayName: 'asc' },
  })
}
```

- [ ] **Step 3: Run trpc tests**

```bash
pnpm --filter @repo/trpc test
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/trpc/src/helpers/plan.ts
git commit -m "feat(trpc): add getAvailableEmbeddingModels helper, exclude embeddings from LLM list"
```

---

### Task 16: tRPC `aiSettings.listAvailableEmbeddingModels`

**Files:**
- Modify: `packages/trpc/src/routers/ai-settings.ts`

- [ ] **Step 1: Add the procedure**

In `packages/trpc/src/routers/ai-settings.ts`, after `listAvailableModels` (line 93), add:

```ts
listAvailableEmbeddingModels: protectedProcedure.input(z.object({ workspaceId: z.string().uuid() })).query(
  async ({
    ctx,
    input,
  }): Promise<
    Array<
      Pick<AiProvider, 'id' | 'slug' | 'name'> & {
        models: Array<
          Pick<AiModel, 'id' | 'slug' | 'displayName' | 'vectorSize' | 'minPlanSlug'>
        >
      }
    >
  > => {
    await assertWorkspaceMember(ctx, input.workspaceId)
    const models = await getAvailableEmbeddingModels(input.workspaceId)
    const byProvider = new Map<
      string,
      Pick<AiProvider, 'id' | 'slug' | 'name'> & {
        models: Array<
          Pick<AiModel, 'id' | 'slug' | 'displayName' | 'vectorSize' | 'minPlanSlug'>
        >
      }
    >()

    for (const model of models.filter((m) => m.deprecatedAt === null)) {
      const provider =
        byProvider.get(model.provider.id) ??
        ({
          id: model.provider.id,
          slug: model.provider.slug,
          name: model.provider.name,
          models: [],
        })
      provider.models.push({
        id: model.id,
        slug: model.slug,
        displayName: model.displayName,
        vectorSize: model.vectorSize,
        minPlanSlug: model.minPlanSlug,
      })
      byProvider.set(provider.id, provider)
    }

    return [...byProvider.values()].sort((a, b) => a.name.localeCompare(b.name))
  },
),
```

Add the import at the top (line 6):

```ts
import { getAvailableAiModels, getAvailableEmbeddingModels, requireWritableWorkspace } from '../helpers/plan'
```

- [ ] **Step 2: Run trpc tests + check-types**

```bash
pnpm --filter @repo/trpc test
pnpm --filter @repo/trpc check-types
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/trpc/src/routers/ai-settings.ts
git commit -m "feat(trpc): listAvailableEmbeddingModels procedure"
```

---

### Task 17: `aiSettings.get` — include `embeddingsModelId` in result

**Files:**
- Modify: `packages/trpc/src/routers/ai-settings.ts`

- [ ] **Step 1: Extend the result interface**

Edit `packages/trpc/src/routers/ai-settings.ts`, around line 24:

```ts
export interface AiSettingsResult {
  workspaceId: string
  defaultModelId: string | null
  embeddingsModelId: string | null
  systemPrompt: string | null
  temperature: number
  topP: number
}
```

- [ ] **Step 2: Update the `get` procedure to populate it**

Replace the `get` procedure body:

```ts
get: protectedProcedure
  .input(z.object({ workspaceId: z.string().uuid() }))
  .query(async ({ ctx, input }): Promise<AiSettingsResult> => {
    await assertWorkspaceMember(ctx, input.workspaceId)
    const settings = await ctx.prisma.workspaceAiSettings.findUnique({
      where: { workspaceId: input.workspaceId },
    })
    return {
      workspaceId: input.workspaceId,
      defaultModelId: settings?.defaultModelId ?? null,
      embeddingsModelId: settings?.embeddingsModelId ?? null,
      systemPrompt: settings?.systemPrompt ?? null,
      temperature: settings?.temperature ?? 0.2,
      topP: settings?.topP ?? 0.5,
    }
  }),
```

- [ ] **Step 3: Run trpc tests + check-types**

```bash
pnpm --filter @repo/trpc test
pnpm --filter @repo/trpc check-types
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/trpc/src/routers/ai-settings.ts
git commit -m "feat(trpc): aiSettings.get returns embeddingsModelId"
```

---

### Task 18: `aiSettings.update` — wipe-and-reindex on embeddings model change

**Files:**
- Modify: `packages/trpc/src/routers/ai-settings.ts`

- [ ] **Step 1: Add helper for HTTP DELETE to apps/agents**

At the top of `packages/trpc/src/routers/ai-settings.ts`, after the imports, add:

```ts
async function wipeAgentsWorkspaceVectors(workspaceId: string): Promise<void> {
  const baseUrl = process.env.AGENTS_SERVICE_URL ?? 'http://localhost:8080'
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 30_000)
  try {
    const res = await fetch(`${baseUrl}/vectorization/workspaces/${workspaceId}`, {
      method: 'DELETE',
      signal: ctl.signal,
    })
    if (!res.ok) {
      throw new Error(`agents DELETE workspace ${res.status}: ${await res.text()}`)
    }
  } finally {
    clearTimeout(t)
  }
}
```

- [ ] **Step 2: Replace the `update` procedure**

Replace the existing `update` procedure (lines 111-156) with:

```ts
update: protectedProcedure
  .input(
    z.object({
      workspaceId: z.string().uuid(),
      defaultModelId: z.string().uuid().nullable().optional(),
      embeddingsModelId: z.string().uuid().nullable().optional(),
      systemPrompt: z.string().nullable().optional(),
    }),
  )
  .mutation(async ({ ctx, input }): Promise<AiSettingsResult> => {
    await assertWorkspaceMember(ctx, input.workspaceId)
    await requireWritableWorkspace(input.workspaceId)

    if (input.defaultModelId) {
      const llmModels = await getAvailableAiModels(input.workspaceId)
      const m = llmModels.find((mm) => mm.id === input.defaultModelId)
      if (!m || m.deprecatedAt !== null) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Недоступная модель' })
      }
    }

    if (input.embeddingsModelId) {
      const embModels = await getAvailableEmbeddingModels(input.workspaceId)
      const m = embModels.find((mm) => mm.id === input.embeddingsModelId)
      if (!m || m.deprecatedAt !== null || !m.supportsEmbeddings || m.vectorSize == null) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Недоступная модель векторизации' })
      }
    }

    const before = await ctx.prisma.workspaceAiSettings.findUnique({
      where: { workspaceId: input.workspaceId },
    })
    const oldEmbeddingsModelId = before?.embeddingsModelId ?? null
    const newEmbeddingsModelId =
      input.embeddingsModelId === undefined ? oldEmbeddingsModelId : input.embeddingsModelId
    const embeddingsModelChanged = oldEmbeddingsModelId !== newEmbeddingsModelId

    const upserted = await ctx.prisma.$transaction(async (tx) => {
      const data: Prisma.WorkspaceAiSettingsUpdateInput = {}

      if (input.defaultModelId !== undefined) {
        data.defaultModel = input.defaultModelId
          ? { connect: { id: input.defaultModelId } }
          : { disconnect: true }
      }
      if (input.embeddingsModelId !== undefined) {
        data.embeddingsModel = input.embeddingsModelId
          ? { connect: { id: input.embeddingsModelId } }
          : { disconnect: true }
      }
      if (input.systemPrompt !== undefined) {
        data.systemPrompt = input.systemPrompt === null ? null : input.systemPrompt.trim() || null
      }

      const createData: Prisma.WorkspaceAiSettingsCreateInput = {
        workspace: { connect: { id: input.workspaceId } },
        ...(data as Omit<Prisma.WorkspaceAiSettingsCreateInput, 'workspace'>),
      }
      const result = await tx.workspaceAiSettings.upsert({
        where: { workspaceId: input.workspaceId },
        create: createData,
        update: data,
      })

      if (embeddingsModelChanged) {
        await tx.outboxEvent.updateMany({
          where: {
            aggregateType: 'page',
            workspaceId: input.workspaceId,
            status: 'PENDING',
          },
          data: { status: 'DONE', processedAt: new Date() },
        })

        if (newEmbeddingsModelId !== null) {
          const pages = await tx.page.findMany({
            where: { workspaceId: input.workspaceId, deletedAt: null, type: 'TEXT' },
            select: { id: true },
          })
          const BATCH = 5_000
          for (let i = 0; i < pages.length; i += BATCH) {
            const slice = pages.slice(i, i + BATCH)
            await tx.outboxEvent.createMany({
              data: slice.map((p) => ({
                eventType: 'page.upserted',
                aggregateType: 'page',
                aggregateId: p.id,
                workspaceId: input.workspaceId,
              })),
            })
          }
        }
      }

      return result
    })

    if (embeddingsModelChanged) {
      try {
        await wipeAgentsWorkspaceVectors(input.workspaceId)
      } catch (err) {
        console.error('wipe workspace vectors failed', { err, workspaceId: input.workspaceId })
      }
    }

    return {
      workspaceId: upserted.workspaceId,
      defaultModelId: upserted.defaultModelId,
      embeddingsModelId: upserted.embeddingsModelId,
      systemPrompt: upserted.systemPrompt,
      temperature: upserted.temperature,
      topP: upserted.topP,
    }
  }),
```

- [ ] **Step 3: Add a unit test for the change-detection logic**

Add to `packages/trpc/src/routers/ai-settings.test.ts` (create if missing, follow existing test patterns in the package):

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
// Pseudo-test — adjust to actual tRPC test infrastructure in this package.

describe('aiSettings.update embeddings model change', () => {
  it('does not enqueue events when embeddingsModelId is unchanged', async () => {
    // Setup: existing settings with embeddingsModelId = X.
    // Call update with embeddingsModelId = X.
    // Expect: no outboxEvent.createMany call, no wipe call.
  })

  it('cancels PENDING and enqueues all pages on change A → B', async () => {
    // Setup: 3 TEXT pages in workspace, settings.embeddingsModelId = A.
    // Call update with embeddingsModelId = B.
    // Expect: outboxEvent.updateMany cancels PENDING; outboxEvent.createMany inserts 3 rows; wipe called once.
  })

  it('cancels PENDING and does NOT enqueue on change A → null', async () => {
    // Expect: outboxEvent.updateMany called; createMany NOT called; wipe called.
  })
})
```

If the tRPC package doesn't have an established testing harness for procedures that mock prisma, mark this test file with TODO comments and rely on E2E coverage in Task 21+.

- [ ] **Step 4: Run tests + check-types**

```bash
pnpm --filter @repo/trpc test
pnpm --filter @repo/trpc check-types
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/routers/ai-settings.ts packages/trpc/src/routers/ai-settings.test.ts
git commit -m "feat(trpc): aiSettings.update wipes and re-enqueues on embeddings model change"
```

---

## Phase 5 — apps/web (UI + chat payload)

### Task 19: AI settings page — pre-fetch embedding models for RSC

**Files:**
- Modify: `apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/ai/page.tsx`

- [ ] **Step 1: Read the current page to identify the existing pre-fetch pattern**

Read the page; the existing code calls `getAvailableAiModels(workspaceId)` and passes `initialModels`. Mirror that for embeddings.

- [ ] **Step 2: Add a parallel pre-fetch and pass through**

Edit the page. Where `getAvailableAiModels` is called, add a second call:

```ts
import { getAvailableAiModels, getAvailableEmbeddingModels } from '@repo/trpc/helpers/plan'
// (verify exact import path — it might be re-exported via packages/trpc/src/index.ts)

// inside the RSC body:
const [llmModels, embeddingModels] = await Promise.all([
  getAvailableAiModels(workspaceId),
  getAvailableEmbeddingModels(workspaceId),
])

// pass to the section:
return <WorkspaceAiSection
  workspaceId={workspaceId}
  initialModels={llmModels.map((m) => ({
    id: m.id, displayName: m.displayName, provider: { name: m.provider.name, slug: m.provider.slug },
  }))}
  initialEmbeddingModels={embeddingModels.map((m) => ({
    id: m.id, displayName: m.displayName, vectorSize: m.vectorSize, minPlanSlug: m.minPlanSlug,
    provider: { name: m.provider.name, slug: m.provider.slug },
  }))}
/>
```

- [ ] **Step 3: Run web check-types**

```bash
pnpm --filter web check-types
```

Expected: FAIL until Task 20 (`WorkspaceAiSection` doesn't yet accept `initialEmbeddingModels`). That's OK — fix in next task and run again.

- [ ] **Step 4: Commit (deferred until Task 20 completes)**

Commit together with Task 20 since types depend.

---

### Task 20: `WorkspaceAiSection` — Векторизация section + confirm dialog

**Files:**
- Modify: `apps/web/src/components/workspace/settings/ai-section.tsx`

- [ ] **Step 1: Replace the component with the extended version**

Replace the entire file:

```tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  FormHelperText,
  InputLabel,
  ListSubheader,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'
import { trpc } from '@/trpc/client'

type InitialModel = { id: string; displayName: string; provider: { name: string; slug: string } }
type InitialEmbeddingModel = {
  id: string
  displayName: string
  vectorSize: number | null
  minPlanSlug: string | null
  provider: { name: string; slug: string }
}

type Props = {
  workspaceId: string
  initialModels?: InitialModel[]
  initialEmbeddingModels?: InitialEmbeddingModel[]
}

export function WorkspaceAiSection({
  workspaceId,
  initialModels,
  initialEmbeddingModels,
}: Props) {
  const utils = trpc.useUtils()
  const settingsQuery = trpc.aiSettings.get.useQuery({ workspaceId })
  const modelsQuery = trpc.aiSettings.listAvailableModels.useQuery(
    { workspaceId },
    { enabled: initialModels === undefined },
  )
  const embeddingModelsQuery = trpc.aiSettings.listAvailableEmbeddingModels.useQuery(
    { workspaceId },
    { enabled: initialEmbeddingModels === undefined },
  )
  const [successShown, setSuccessShown] = useState(false)
  const update = trpc.aiSettings.update.useMutation({
    onSuccess: () => {
      utils.aiSettings.get.invalidate({ workspaceId })
      setSuccessShown(true)
      setTimeout(() => setSuccessShown(false), 3000)
    },
  })

  const [defaultModelId, setDefaultModelId] = useState<string>('')
  const [embeddingsModelId, setEmbeddingsModelId] = useState<string>('')
  const [systemPrompt, setSystemPrompt] = useState<string>('')
  const [confirmOpen, setConfirmOpen] = useState(false)

  useEffect(() => {
    if (!settingsQuery.data) return
    setDefaultModelId(settingsQuery.data.defaultModelId ?? '')
    setEmbeddingsModelId(settingsQuery.data.embeddingsModelId ?? '')
    setSystemPrompt(settingsQuery.data.systemPrompt ?? '')
  }, [settingsQuery.data])

  const flatLlmModels = useMemo(() => {
    if (initialModels !== undefined) {
      return initialModels.map((m) => ({
        id: m.id,
        label: `${m.provider.name} · ${m.displayName}`,
      }))
    }
    if (!modelsQuery.data) return []
    return modelsQuery.data.flatMap((p) =>
      p.models.map((m) => ({ id: m.id, label: `${p.name} · ${m.displayName}` })),
    )
  }, [initialModels, modelsQuery.data])

  const groupedEmbeddingModels = useMemo(() => {
    if (initialEmbeddingModels !== undefined) {
      const groups = new Map<string, { providerName: string; models: InitialEmbeddingModel[] }>()
      for (const m of initialEmbeddingModels) {
        const cur = groups.get(m.provider.slug) ?? { providerName: m.provider.name, models: [] }
        cur.models.push(m)
        groups.set(m.provider.slug, cur)
      }
      return [...groups.values()]
    }
    if (!embeddingModelsQuery.data) return []
    return embeddingModelsQuery.data.map((p) => ({
      providerName: p.name,
      models: p.models.map((m) => ({
        id: m.id,
        displayName: m.displayName,
        vectorSize: m.vectorSize,
        minPlanSlug: m.minPlanSlug,
        provider: { name: p.name, slug: p.slug },
      })),
    }))
  }, [initialEmbeddingModels, embeddingModelsQuery.data])

  const loadedEmbeddingsModelId = settingsQuery.data?.embeddingsModelId ?? ''
  const embeddingsChanged = embeddingsModelId !== loadedEmbeddingsModelId

  const submit = () => {
    update.mutate({
      workspaceId,
      defaultModelId: defaultModelId === '' ? null : defaultModelId,
      embeddingsModelId: embeddingsModelId === '' ? null : embeddingsModelId,
      systemPrompt: systemPrompt.trim() === '' ? null : systemPrompt,
    })
  }

  const onSave = () => {
    if (embeddingsChanged) {
      setConfirmOpen(true)
      return
    }
    submit()
  }

  const onConfirm = () => {
    setConfirmOpen(false)
    submit()
  }

  const disabled =
    settingsQuery.isLoading ||
    (initialModels === undefined && modelsQuery.isLoading) ||
    (initialEmbeddingModels === undefined && embeddingModelsQuery.isLoading)

  return (
    <Stack spacing={3}>
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack spacing={2}>
          <Typography variant="h6">Настройки LLM</Typography>
          <Typography variant="body2" color="text.secondary">
            Эти параметры применяются к чату AnyNote AI в этом workspace.
          </Typography>
          {update.error ? <Alert severity="error">{update.error.message}</Alert> : null}
          {successShown ? <Alert severity="success">Сохранено</Alert> : null}
          <FormControl fullWidth>
            <InputLabel id="ai-default-model">Модель по умолчанию</InputLabel>
            <Select
              labelId="ai-default-model"
              label="Модель по умолчанию"
              value={defaultModelId}
              onChange={(e) => setDefaultModelId(String(e.target.value))}
              disabled={disabled}
            >
              <MenuItem value="">
                <em>Не выбрано</em>
              </MenuItem>
              {flatLlmModels.map((m) => (
                <MenuItem key={m.id} value={m.id}>
                  {m.label}
                </MenuItem>
              ))}
            </Select>
            <FormHelperText>Выбирается из доступных моделей по тарифу workspace.</FormHelperText>
          </FormControl>
          <TextField
            label="Системный промпт"
            placeholder="Инструкции, которые подмешиваются в начало каждого запроса к модели."
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            disabled={disabled}
            multiline
            minRows={4}
            fullWidth
          />
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack spacing={2}>
          <Typography variant="h6">Векторизация</Typography>
          <Typography variant="body2" color="text.secondary">
            Модель для индексации страниц и поиска по контексту в чатах. Без выбранной модели
            страницы не индексируются и поиск по содержимому не работает.
          </Typography>
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
              {groupedEmbeddingModels.flatMap((group) => [
                <ListSubheader key={`group-${group.providerName}`}>
                  {group.providerName}
                </ListSubheader>,
                ...group.models.map((m) => (
                  <MenuItem key={m.id} value={m.id}>
                    {m.displayName}
                    {m.vectorSize != null ? ` · ${m.vectorSize}` : ''}
                  </MenuItem>
                )),
              ])}
            </Select>
            <FormHelperText>
              При смене или сбросе модели все векторы будут удалены и страницы будут
              проиндексированы заново. Это может занять время для больших пространств.
            </FormHelperText>
          </FormControl>
        </Stack>
      </Paper>

      <Stack direction="row">
        <Button
          variant="contained"
          onClick={onSave}
          loading={update.isPending}
          disabled={disabled}
        >
          Сохранить
        </Button>
      </Stack>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Сменить модель векторизации?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Все ранее проиндексированные данные будут удалены, и страницы начнут векторизироваться
            заново. На больших пространствах это может занять время.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Отмена</Button>
          <Button onClick={onConfirm} variant="contained">Подтвердить</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
```

- [ ] **Step 2: Verify required MUI components are re-exported**

Check that `Dialog`, `DialogActions`, `DialogContent`, `DialogContentText`, `DialogTitle`, `ListSubheader` are exported from `@repo/ui/components`. If any aren't, add re-exports to `packages/ui/src/components/index.ts`:

```ts
export {
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  ListSubheader,
} from '@mui/material'
```

- [ ] **Step 3: Run web check-types + a manual smoke**

```bash
pnpm --filter web check-types
pnpm --filter web dev   # in another terminal
```

Open `http://localhost:3000/workspaces/<id>/settings/ai`. Verify the new "Векторизация" Paper renders, the dropdown lists all 5 embeddings models grouped by provider, and selecting + saving + confirming triggers the mutation. Check Network tab — `aiSettings.update` request body includes `embeddingsModelId`.

- [ ] **Step 4: Commit (with Task 19 changes)**

```bash
git add apps/web/src/components/workspace/settings/ai-section.tsx apps/web/src/app/\(protected\)/workspaces/\[workspaceId\]/settings/ai/page.tsx packages/ui/src/components/index.ts
git commit -m "feat(web): Векторизация section in AI settings with confirm dialog"
```

---

### Task 21: Chat `/api/agents/generate` payload includes `embedding`

**Files:**
- Modify: `apps/web/src/app/api/agents/generate/route.ts`
- Modify: `apps/web/src/lib/chat/agents-payload.ts`

- [ ] **Step 1: Extend the workspace settings snapshot to include the embeddings model**

Open `apps/web/src/lib/chat/agents-payload.ts` (the helper that builds the agents payload). Read the `WorkspaceSettingsSnapshot` type. Extend it:

```ts
export type WorkspaceSettingsSnapshot = {
  defaultModel: { /* unchanged */ }
  embeddingsModel: {
    slug: string
    vectorSize: number
    provider: { slug: string; connection: unknown }
  } | null
  systemPrompt: string | null
  temperature: number
  topP: number
}
```

In `buildAgentsPayload`, add the `embedding` field to the result (mirror how `model` is built):

```ts
import { parseAiProviderConnection } from '@repo/db'

// inside the payload construction:
const embedding = settings.embeddingsModel
  ? {
      provider: settings.embeddingsModel.provider.slug,
      modelSlug: settings.embeddingsModel.slug,
      vectorSize: settings.embeddingsModel.vectorSize,
      connection: parseAiProviderConnection(
        settings.embeddingsModel.provider.slug,
        settings.embeddingsModel.provider.connection,
      ),
    }
  : null

return {
  // ... existing fields
  embedding,
}
```

- [ ] **Step 2: Update the route to fetch the embedding model**

In `apps/web/src/app/api/agents/generate/route.ts` (line 310), extend the `prisma.workspaceAiSettings.findUnique` `include`:

```ts
prisma.workspaceAiSettings.findUnique({
  where: { workspaceId: chat.workspaceId },
  include: {
    defaultModel: { include: { provider: true } },
    embeddingsModel: { include: { provider: true } },
  },
}),
```

Then construct the snapshot (around line 337):

```ts
const settingsSnapshot: WorkspaceSettingsSnapshot = {
  defaultModel: {
    slug: settings.defaultModel.slug,
    provider: {
      slug: settings.defaultModel.provider.slug,
      connection: settings.defaultModel.provider.connection,
    },
  },
  embeddingsModel: settings.embeddingsModel && settings.embeddingsModel.vectorSize !== null
    ? {
        slug: settings.embeddingsModel.slug,
        vectorSize: settings.embeddingsModel.vectorSize,
        provider: {
          slug: settings.embeddingsModel.provider.slug,
          connection: settings.embeddingsModel.provider.connection,
        },
      }
    : null,
  systemPrompt: settings.systemPrompt,
  temperature: settings.temperature,
  topP: settings.topP,
}
```

- [ ] **Step 3: Run web check-types + smoke**

```bash
pnpm --filter web check-types
pnpm --filter web dev
```

Open `/app` → start a chat → send a message. Verify in Network tab the request body to `apps/agents` (intercepted via `streamAgentsToRegistry`) now includes `embedding: { provider: 'ollama', modelSlug: 'nomic-embed-text', ... }` when an embeddings model is configured, or `embedding: null` otherwise.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api/agents/generate/route.ts apps/web/src/lib/chat/agents-payload.ts
git commit -m "feat(web): include embedding config in agents chat payload"
```

---

## Phase 6 — Cleanup

### Task 22: Drop deprecated env vars

**Files:**
- Modify: `.env.example`
- Modify: `turbo.json`

- [ ] **Step 1: Remove `OLLAMA_EMBEDDING_MODEL`, `QDRANT_COLLECTION_NAME`, `QDRANT_VECTOR_SIZE` from `.env.example`**

Open `.env.example` and delete those three lines (and any associated comments).

- [ ] **Step 2: Remove the same keys from `turbo.json` `globalEnv`**

In `turbo.json`, find the `globalEnv` array and remove the three entries.

- [ ] **Step 3: Run from repo root**

```bash
pnpm gates
```

Expected: PASS. (No code references these env vars after Task 7.)

- [ ] **Step 4: Commit**

```bash
git add .env.example turbo.json
git commit -m "chore: drop deprecated embedding-model env vars"
```

---

### Task 23: Manual rollout note — drop the legacy `pages` Qdrant collection

**Files:**
- Modify: `docs/superpowers/specs/2026-04-29-per-workspace-embeddings-design.md` (already exists; update Roll-out section)

- [ ] **Step 1: Verify the spec's Roll-out section already covers this**

Re-read the spec's "Roll-out" section. It already states the legacy collection is left untouched but unused, with a manual cleanup command suggested. No changes required.

- [ ] **Step 2: Communicate to the deploy operator**

When merging to `main` and deploying:
1. Run `pnpm --filter @repo/db exec prisma migrate deploy` to apply the schema migration.
2. Run `pnpm --filter @repo/db exec prisma db seed` to upsert the new providers/models.
3. (Optional, in production) Connect to Qdrant and run `delete_collection('pages')` to free space. Skip in staging if you want to preserve test data.
4. Workspaces will see "Векторизация → Не выбрано" by default. Inform users via release notes: indexing and RAG are off until they pick a model.

No commit required — this task is documentation/communication only.

---

## Self-review (executed before finalization)

This section was filled during plan authoring. Confirms spec coverage:

| Spec section | Plan task(s) |
|---|---|
| 1.1 AiModel schema | Task 1 |
| 1.2 WorkspaceAiSettings schema | Task 1 |
| 1.3 Typed connection schema | Task 2 |
| 1.4 Seed additions | Task 3 |
| 2.1 EmbeddingFactoryRepository | Task 5 |
| 2.2 Schema additions | Task 4 |
| 2.3 Collection naming | Task 6 |
| 2.4 VectorizePageUseCase rewrite | Task 7 |
| 2.5.1 DELETE /vectorization/workspaces | Task 9 |
| 2.5.2 DELETE /vectorization/pages | Task 8 |
| 2.6 Dishka changes | Task 7 |
| 2.7 Settings cleanup | Task 7 (settings.py + bootstrap.py) + Task 22 (env) |
| 3.1 Indexer late-binding lookup + page.deleted | Task 14 |
| 3.2 agents-client.service.ts | Task 13 |
| 3.3 Plan-features unchanged | (no task — confirmed unchanged) |
| 4.1 listAvailableEmbeddingModels | Task 16 |
| 4.2 get extension | Task 17 |
| 4.3 update extension | Task 18 |
| 4.4 agentsClient injection | Task 18 (via inline helper, not full context plumbing) |
| 5.1 UI visual layout | Task 20 |
| 5.2 Confirmation gate | Task 20 |
| 5.3 Success messaging | Task 20 |
| 5.4 Initial render | Task 19 |
| 6.1 Chat payload extension | Task 21 |
| 6.2 GraphService conditional | Task 12 |
| 6.3 Prompt rendering (no change needed) | (no task — confirmed unchanged) |
| 6.4 MCP tools unaffected | (no task — confirmed unchanged) |

All spec sections mapped. Concurrency notes are realized in Task 14 (late-binding) + Task 18 (transaction ordering). Roll-out is Task 23.
