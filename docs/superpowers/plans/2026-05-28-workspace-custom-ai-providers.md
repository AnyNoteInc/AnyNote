# Workspace Custom LLM / Embeddings / MCP Providers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a workspace OWNER register their own LLM/embedding providers (ollama, openai, gigachat, yandexgpt, anthropic, deepseek) with encrypted credentials and their own MCP servers, validated by a live "ping-pong" before saving, alongside the existing shared catalog.

**Architecture:** Extend the existing `AiProvider`/`AiModel` tables with a nullable `workspaceId` scope (`NULL` = shared) and an encrypted `connectionEnc` column. Credential validation runs in `apps/agents` via three new **unauthenticated** `/validation/*` endpoints (mirroring the existing unauthenticated `/vectorization/*` route that tRPC already calls via `AGENTS_SERVICE_URL`) that reuse the existing LangChain factories and `McpClient`. tRPC mutations (OWNER-only, plan-gated) call those endpoints first and only persist on success.

**Tech Stack:** Prisma 7 / Postgres, NestJS-independent `packages/trpc` (tRPC v11 + zod + vitest), `apps/agents` (Python 3.13 / FastAPI / Dishka / LangChain / pytest), `apps/web` (Next.js 16 App Router / React 19 / MUI v6 via `@repo/ui`). Encryption via `@repo/auth` `encryptSecret`/`decryptSecret` (AES-256-GCM, `SECRETS_ENCRYPTION_KEY`).

**Spec:** `docs/superpowers/specs/2026-05-28-workspace-custom-ai-providers-design.md`

**Refinement vs spec:** The spec proposed extracting `signAgentsJwt` so tRPC could authenticate validation calls. Investigation showed `apps/agents`' `/vectorization/*` endpoints take **no** auth and tRPC already calls them directly via `AGENTS_SERVICE_URL` (`apps/agents` is internal-only, not exposed through Traefik). The `/validation/*` endpoints follow that same pattern, so **no JWT extraction is needed**. `apps/web`'s chat route keeps using `signAgentsJwt` unchanged.

---

## Conventions for every task

- Prettier: `semi: false`, single quotes, 100-char width. Run `pnpm format` if unsure.
- TS gates from repo root: `pnpm --filter <pkg> test`, `pnpm --filter <pkg> check-types`, `pnpm --filter <pkg> lint`.
- Python from `apps/agents`: `pnpm --filter agents test` (pytest) or `uv run pytest <path> -v`.
- Commit after each task with the shown message. Never `--no-verify`.

---

## File Structure

**`packages/db`**
- Modify: `prisma/schema.prisma` (enum `AiProviderKind`; `AiProvider` fields + relations; `Plan.customAiProvidersEnabled`; drop two `WorkspaceAiSettings` columns; back-relations on `Workspace`/`User`).
- Create: `prisma/migrations/<ts>_workspace_custom_ai_providers/migration.sql`.
- Modify: `prisma/seed.ts` (provider `kind`, plan flag).
- Modify: `src/ai-provider-connection.ts` (new provider connection schemas + `folderId`).
- Create: `src/ai-provider-connection.test.ts`.

**`apps/agents`**
- Modify: `pyproject.toml` (`langchain-anthropic`, `langchain-community`).
- Modify: `agents/apps/agent/enums_shared.py` (3 new enum members).
- Modify: `agents/apps/processing/schemas.py` (`folder_id`; validation request/response schemas).
- Modify: `agents/apps/agent/schemas.py` (LLM/MCP validation request/response schemas).
- Modify: `agents/apps/agent/repositories/model_factory.py` (anthropic, deepseek, yandexgpt).
- Modify: `agents/apps/processing/repositories/embedding_factory.py` (yandexgpt).
- Create: `agents/apps/agent/use_cases/validate_provider.py` (ValidateLlmUseCase, ValidateMcpUseCase).
- Create: `agents/apps/processing/use_cases/validate_embedding.py` (ValidateEmbeddingUseCase).
- Create: `agents/apps/validation/router.py` + `agents/apps/validation/__init__.py` (3 endpoints).
- Modify: `agents/apps/agent/depends.py` (provide 2 use-cases), `agents/apps/processing/depends.py` (provide 1), `agents/router.py` (include validation router).
- Create tests: `tests/apps/agent/test_model_factory.py`, `tests/apps/processing/test_embedding_factory.py` (extend), `tests/apps/agent/test_validate_provider.py`, `tests/apps/processing/test_validate_embedding.py`, `tests/apps/validation/test_validation_routes.py`.

**`packages/trpc`**
- Create: `src/helpers/agents-validate.ts` + `src/helpers/agents-validate.test.ts`.
- Create: `src/routers/ai-provider.ts` + `src/routers/ai-provider.test.ts`.
- Modify: `src/routers/ai-settings.ts` (OWNER gate on `update`).
- Modify: `src/routers/mcp-server.ts` (ping + plan gate) + `src/routers/mcp-server.test.ts`.
- Modify: `src/helpers/plan.ts` (`customAiProvidersEnabled`; workspace-scope in model queries).
- Modify: `src/index.ts` (register `aiProvider`).

**`apps/web`**
- Create: `src/lib/chat/provider-connection.ts` + test.
- Modify: `src/lib/chat/agents-payload.ts` (`kind` + connection), `src/app/api/agents/generate/route.ts` (resolve connection), legacy `src/app/api/agent/generate/route.ts` if present.
- Modify: `src/components/workspace/settings/ai-section.tsx` (custom-providers block) + create `src/components/workspace/settings/ai-providers-manager.tsx`.
- Create: `src/app/(protected)/workspaces/[workspaceId]/settings/mcp/page.tsx` + `src/components/workspace/settings/mcp-section.tsx`.
- Modify: `src/components/workspace/workspace-settings-nav.tsx` (add MCP entry).
- Modify/redirect: `src/app/(protected)/settings/integrations/mcp/page.tsx`.

**`apps/e2e`**
- Create: `apps/e2e/workspace-ai-providers.spec.ts`.

---

# Phase 1 — Data model, seed, connection schema (`packages/db`)

### Task 1: Schema + migration for workspace-scoped providers

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<ts>_workspace_custom_ai_providers/migration.sql`

- [ ] **Step 1: Add the enum and edit `AiProvider`**

In `packages/db/prisma/schema.prisma`, add the enum near the other enums (e.g. after `McpTransport`):

```prisma
enum AiProviderKind {
  OLLAMA
  OPENAI
  GIGACHAT
  YANDEXGPT
  ANTHROPIC
  DEEPSEEK
}
```

Replace the `AiProvider` model with (adds `kind`, `workspaceId`, `connectionEnc`, `createdById`, relations; changes `slug @unique` → `@@unique([workspaceId, slug])`):

```prisma
model AiProvider {
  id            String         @id @default(uuid(7)) @db.Uuid
  kind          AiProviderKind
  slug          String         @db.VarChar(50)
  name          String         @db.VarChar(100)
  connection    Json           @default("{}") @map("connection")
  connectionEnc Json?          @map("connection_enc")
  workspaceId   String?        @map("workspace_id") @db.Uuid
  createdById   String?        @map("created_by_id") @db.Uuid
  isActive      Boolean        @default(true) @map("is_active")
  createdAt     DateTime       @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt     DateTime       @updatedAt @map("updated_at") @db.Timestamptz(6)
  models        AiModel[]
  workspace     Workspace?     @relation("WorkspaceAiProviders", fields: [workspaceId], references: [id], onDelete: Cascade)
  createdBy     User?          @relation("AiProviderCreatedBy", fields: [createdById], references: [id], onDelete: SetNull)

  @@unique([workspaceId, slug])
  @@index([workspaceId])
  @@map("ai_providers")
}
```

- [ ] **Step 2: Add back-relations + plan flag + drop unused columns**

In the `Workspace` model, add to its relation list:

```prisma
  aiProviders AiProvider[] @relation("WorkspaceAiProviders")
```

In the `User` model, add alongside its other `@relation` fields:

```prisma
  aiProvidersCreated AiProvider[] @relation("AiProviderCreatedBy")
```

In the `Plan` model, add after `customMcpEnabled`:

```prisma
  customAiProvidersEnabled Boolean @default(false) @map("custom_ai_providers_enabled")
```

In `WorkspaceAiSettings`, **delete** these two now-unused lines:

```prisma
  chatModelConnection      Json?    @map("chat_model_connection")
  embeddingModelConnection Json?    @map("embedding_model_connection")
```

- [ ] **Step 3: Generate the migration without applying**

Run: `pnpm --filter @repo/db exec prisma migrate dev --create-only --name workspace_custom_ai_providers`
Expected: a new folder `prisma/migrations/<ts>_workspace_custom_ai_providers/migration.sql` is created, not yet applied.

- [ ] **Step 4: Hand-edit the generated `migration.sql`**

Open the generated `migration.sql`. Prisma will emit `ALTER TABLE "ai_providers" ADD COLUMN "kind" "AiProviderKind" NOT NULL;` — that fails on existing rows. **Replace that single line** with the 3-step backfill:

```sql
ALTER TABLE "ai_providers" ADD COLUMN "kind" "AiProviderKind";
UPDATE "ai_providers" SET "kind" = UPPER("slug")::"AiProviderKind";
ALTER TABLE "ai_providers" ALTER COLUMN "kind" SET NOT NULL;
```

Then append at the **end** of the file (restores global-slug uniqueness that the dropped `ai_providers_slug_key` provided; `@@unique([workspaceId, slug])` does not constrain rows where `workspace_id IS NULL` because NULLs are distinct):

```sql
-- Shared providers (workspace_id IS NULL) keep globally-unique slugs
CREATE UNIQUE INDEX "ai_providers_global_slug_key" ON "ai_providers" ("slug") WHERE "workspace_id" IS NULL;
```

Verify the file also contains (auto-generated — do not duplicate): `CREATE TYPE "AiProviderKind"`, `DROP INDEX "ai_providers_slug_key"`, `CREATE UNIQUE INDEX "ai_providers_workspace_id_slug_key"`, the `connection_enc`/`workspace_id`/`created_by_id` columns + their FKs, `ALTER TABLE "plans" ADD COLUMN "custom_ai_providers_enabled"`, and `ALTER TABLE "workspace_ai_settings" DROP COLUMN "chat_model_connection"`/`"embedding_model_connection"`.

- [ ] **Step 5: Apply migration + regenerate client**

Run: `pnpm --filter @repo/db exec prisma migrate dev` then `pnpm --filter @repo/db prisma:generate`
Expected: migration applies cleanly; client regenerates. (`docker compose up -d` must be running.)

- [ ] **Step 6: Verify backfill in DB**

Run: `pnpm --filter @repo/db exec prisma db execute --stdin <<< 'SELECT slug, kind, workspace_id FROM ai_providers ORDER BY slug;'`
Expected: rows `gigachat|GIGACHAT|<null>`, `ollama|OLLAMA|<null>`, `openai|OPENAI|<null>`.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): scope AiProvider to workspace + AiProviderKind, customAiProvidersEnabled plan flag"
```

---

### Task 2: Seed `kind` + plan flag

**Files:**
- Modify: `packages/db/prisma/seed.ts`

- [ ] **Step 1: Add `kind` to each seeded provider**

In `seed.ts`, the `aiProviders` array (slugs `gigachat`, `ollama`, `openai`) — add a `kind` to each entry and use it on upsert. For the array entries add: `kind: 'GIGACHAT'`, `kind: 'OLLAMA'`, `kind: 'OPENAI'` respectively. Find where these are written (`prisma.aiProvider.upsert`/`create`) and include `kind` in both `create` and `update` payloads, e.g.:

```ts
await prisma.aiProvider.upsert({
  where: { workspaceId_slug: { workspaceId: null, slug: p.slug } },
  create: { slug: p.slug, name: p.name, kind: p.kind, connection: p.connection },
  update: { name: p.name, kind: p.kind, connection: p.connection },
})
```

> Note: the unique selector is now the compound `workspaceId_slug`. If the existing seed used `where: { slug: p.slug }`, change it to the compound form above (with `workspaceId: null`).

- [ ] **Step 2: Set the plan flag on `max`**

In the plans seed, add `customAiProvidersEnabled: true` to the `max` plan object and `customAiProvidersEnabled: false` to `personal` and `pro` (mirroring `customMcpEnabled`).

- [ ] **Step 3: Run seed + verify**

Run: `pnpm --filter @repo/db exec prisma db seed`
Then: `pnpm --filter @repo/db exec prisma db execute --stdin <<< "SELECT slug, custom_ai_providers_enabled FROM plans ORDER BY sort_order;"`
Expected: `personal|f`, `pro|f`, `max|t`.

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/seed.ts
git commit -m "feat(db): seed AiProvider.kind and customAiProvidersEnabled flag"
```

---

### Task 3: Extend `ai-provider-connection.ts` for new providers

**Files:**
- Modify: `packages/db/src/ai-provider-connection.ts`
- Create: `packages/db/src/ai-provider-connection.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/ai-provider-connection.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { parseAiProviderConnection } from './ai-provider-connection'

describe('parseAiProviderConnection', () => {
  it('parses an anthropic apiKey connection', () => {
    const c = parseAiProviderConnection('anthropic', { apiKey: 'sk-ant' })
    expect(c).toEqual({ provider: 'anthropic', apiKey: 'sk-ant' })
  })

  it('requires folderId for yandexgpt', () => {
    expect(() => parseAiProviderConnection('yandexgpt', { apiKey: 'k' })).toThrow()
  })

  it('parses a yandexgpt apiKey+folderId connection', () => {
    const c = parseAiProviderConnection('yandexgpt', { apiKey: 'k', folderId: 'b1g' })
    expect(c).toEqual({ provider: 'yandexgpt', apiKey: 'k', folderId: 'b1g' })
  })

  it('parses deepseek with optional baseUrl', () => {
    const c = parseAiProviderConnection('deepseek', { apiKey: 'sk-ds' })
    expect(c).toEqual({ provider: 'deepseek', apiKey: 'sk-ds' })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @repo/db test -- ai-provider-connection`
Expected: FAIL — `unknown provider: anthropic`.

- [ ] **Step 3: Implement**

Replace `packages/db/src/ai-provider-connection.ts` body with:

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
  z.object({
    provider: z.literal('anthropic'),
    apiKey: z.string().min(1),
    baseUrl: z.string().url().optional(),
  }),
  z.object({
    provider: z.literal('deepseek'),
    apiKey: z.string().min(1),
    baseUrl: z.string().url().optional(),
  }),
  z.object({
    provider: z.literal('yandexgpt'),
    apiKey: z.string().min(1),
    folderId: z.string().min(1),
    baseUrl: z.string().url().optional(),
  }),
])

export type AiProviderConnection = z.infer<typeof AiProviderConnectionSchema>

const KNOWN_PROVIDERS = [
  'ollama',
  'openai',
  'gigachat',
  'anthropic',
  'deepseek',
  'yandexgpt',
] as const

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

> The discriminator value here is the provider **kind** (lowercase). The tRPC router (Task 13) lowercases the `AiProviderKind` to call this.

- [ ] **Step 4: Run tests + check-types**

Run: `pnpm --filter @repo/db test -- ai-provider-connection && pnpm --filter @repo/db check-types`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/ai-provider-connection.ts packages/db/src/ai-provider-connection.test.ts
git commit -m "feat(db): connection schemas for anthropic, deepseek, yandexgpt"
```

---

# Phase 2 — apps/agents: providers + validation

### Task 4: Add provider dependencies

**Files:**
- Modify: `apps/agents/pyproject.toml`

- [ ] **Step 1: Add deps**

In `apps/agents/pyproject.toml`, add to `[project] dependencies`:

```toml
    "langchain-anthropic>=0.3",
    "langchain-community>=0.3",
```

- [ ] **Step 2: Lock + install**

Run (from `apps/agents`): `uv lock && uv sync`
Expected: lockfile updates; both packages install.

- [ ] **Step 3: Verify importability + capture real constructor signatures**

Run (from `apps/agents`):
```bash
uv run python -c "from langchain_anthropic import ChatAnthropic; import inspect; print('anthropic', inspect.signature(ChatAnthropic.__init__))"
uv run python -c "from langchain_community.chat_models import ChatYandexGPT; import inspect; print('yandex-chat ok')"
uv run python -c "from langchain_community.embeddings import YandexGPTEmbeddings; import inspect; print('yandex-emb ok')"
```
Expected: all import without error. **Record the exact YandexGPT kwargs** (e.g. `api_key`/`folder_id`/`model_name` vs `model_uri`) — Tasks 8 & 9 assert these; align the implementation to what the installed version actually accepts.

- [ ] **Step 4: Commit**

```bash
git add apps/agents/pyproject.toml apps/agents/uv.lock
git commit -m "build(agents): add langchain-anthropic and langchain-community"
```

---

### Task 5: Extend provider enum + connection schema

**Files:**
- Modify: `apps/agents/agents/apps/agent/enums_shared.py`
- Modify: `apps/agents/agents/apps/processing/schemas.py`

- [ ] **Step 1: Add enum members**

In `enums_shared.py`, extend `ModelProviderEnum`:

```python
class ModelProviderEnum(StrEnum):
    OLLAMA = auto()
    OPENAI = auto()
    GIGACHAT = auto()
    YANDEXGPT = auto()
    ANTHROPIC = auto()
    DEEPSEEK = auto()
```

- [ ] **Step 2: Add `folder_id` to the connection schema**

In `processing/schemas.py`, add to `ModelConnectionSchema` (after `scope`):

```python
    folder_id: str | None = None
```

- [ ] **Step 3: Verify**

Run (from `apps/agents`): `uv run python -c "from agents.apps.agent.enums_shared import ModelProviderEnum as E; print([e.value for e in E])"`
Expected: `['ollama', 'openai', 'gigachat', 'yandexgpt', 'anthropic', 'deepseek']`.

- [ ] **Step 4: Commit**

```bash
git add apps/agents/agents/apps/agent/enums_shared.py apps/agents/agents/apps/processing/schemas.py
git commit -m "feat(agents): add yandexgpt/anthropic/deepseek enum + folder_id connection field"
```

---

### Task 6: model_factory — Anthropic

**Files:**
- Modify: `apps/agents/agents/apps/agent/repositories/model_factory.py`
- Create: `apps/agents/tests/apps/agent/test_model_factory.py`

- [ ] **Step 1: Write the failing test**

Create `apps/agents/tests/apps/agent/test_model_factory.py`:

```python
from typing import cast
from unittest.mock import MagicMock, patch

import pytest
from agents.apps.agent.enums_shared import ModelProviderEnum
from agents.apps.agent.errors_shared import InvalidPayloadError
from agents.apps.agent.repositories.model_factory import ModelFactoryRepository
from agents.apps.agent.schemas import ModelConfigSchema, ModelConnectionSchema
from pydantic import SecretStr


def _config(provider: ModelProviderEnum, connection: dict[str, object] | None = None) -> ModelConfigSchema:
    return ModelConfigSchema(**{'provider': provider, 'name': 'm', 'connection': connection or {}})


def test_make_anthropic_requires_api_key() -> None:
    with pytest.raises(InvalidPayloadError, match='Anthropic'):
        ModelFactoryRepository.make(_config(ModelProviderEnum.ANTHROPIC))


def test_make_anthropic_passes_api_key() -> None:
    with patch('agents.apps.agent.repositories.model_factory.ChatAnthropic') as mock_cls:
        mock_cls.return_value = MagicMock()
        ModelFactoryRepository.make(_config(ModelProviderEnum.ANTHROPIC, {'apiKey': 'sk-ant'}))
        kwargs = mock_cls.call_args.kwargs
        assert kwargs['model'] == 'm'
        assert isinstance(kwargs['api_key'], SecretStr)
        assert kwargs['api_key'].get_secret_value() == 'sk-ant'
```

- [ ] **Step 2: Run to verify it fails**

Run (from `apps/agents`): `uv run pytest tests/apps/agent/test_model_factory.py -v`
Expected: FAIL — `ImportError`/`AttributeError` on `ChatAnthropic` (not yet imported) or unknown-provider error.

- [ ] **Step 3: Implement**

In `model_factory.py`, add the import near the others:

```python
from langchain_anthropic import ChatAnthropic
```

Add a `case` arm **before** the `case _:` fallthrough:

```python
            case ModelProviderEnum.ANTHROPIC:
                if config.connection.api_key is None:
                    raise InvalidPayloadError('Anthropic provider requires an api_key in the connection config')
                return ChatAnthropic(
                    model=config.name,
                    api_key=SecretStr(config.connection.api_key),
                    base_url=config.connection.base_url,
                    temperature=temperature,
                )
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/apps/agent/test_model_factory.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/agents/agents/apps/agent/repositories/model_factory.py apps/agents/tests/apps/agent/test_model_factory.py
git commit -m "feat(agents): anthropic chat model in model_factory"
```

---

### Task 7: model_factory — DeepSeek (OpenAI-compatible)

**Files:**
- Modify: `apps/agents/agents/apps/agent/repositories/model_factory.py`
- Modify: `apps/agents/tests/apps/agent/test_model_factory.py`

- [ ] **Step 1: Add failing tests**

Append to `test_model_factory.py`:

```python
def test_make_deepseek_requires_api_key() -> None:
    with pytest.raises(InvalidPayloadError, match='DeepSeek'):
        ModelFactoryRepository.make(_config(ModelProviderEnum.DEEPSEEK))


def test_make_deepseek_uses_openai_compatible_client() -> None:
    with patch('agents.apps.agent.repositories.model_factory.ChatOpenAI') as mock_cls:
        mock_cls.return_value = MagicMock()
        ModelFactoryRepository.make(_config(ModelProviderEnum.DEEPSEEK, {'apiKey': 'sk-ds'}))
        kwargs = mock_cls.call_args.kwargs
        assert kwargs['model'] == 'm'
        assert kwargs['base_url'] == 'https://api.deepseek.com'
        assert kwargs['api_key'].get_secret_value() == 'sk-ds'
```

- [ ] **Step 2: Run to verify fail**

Run: `uv run pytest tests/apps/agent/test_model_factory.py -k deepseek -v`
Expected: FAIL — unknown provider.

- [ ] **Step 3: Implement**

In `model_factory.py` (reuses already-imported `ChatOpenAI`), add before `case _:`:

```python
            case ModelProviderEnum.DEEPSEEK:
                if config.connection.api_key is None:
                    raise InvalidPayloadError('DeepSeek provider requires an api_key in the connection config')
                return ChatOpenAI(
                    model=config.name,
                    api_key=SecretStr(config.connection.api_key),
                    base_url=config.connection.base_url or 'https://api.deepseek.com',
                    temperature=temperature,
                )
```

- [ ] **Step 4: Run to verify pass**

Run: `uv run pytest tests/apps/agent/test_model_factory.py -k deepseek -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/agents/apps/agent/repositories/model_factory.py apps/agents/tests/apps/agent/test_model_factory.py
git commit -m "feat(agents): deepseek (openai-compatible) chat model"
```

---

### Task 8: model_factory — YandexGPT

**Files:**
- Modify: `apps/agents/agents/apps/agent/repositories/model_factory.py`
- Modify: `apps/agents/tests/apps/agent/test_model_factory.py`

- [ ] **Step 1: Add failing tests**

Append to `test_model_factory.py` (align kwargs to the signature captured in Task 4 Step 3 if it differs):

```python
def test_make_yandexgpt_requires_api_key_and_folder() -> None:
    with pytest.raises(InvalidPayloadError, match='YandexGPT'):
        ModelFactoryRepository.make(_config(ModelProviderEnum.YANDEXGPT, {'apiKey': 'k'}))


def test_make_yandexgpt_passes_credentials() -> None:
    with patch('agents.apps.agent.repositories.model_factory.ChatYandexGPT') as mock_cls:
        mock_cls.return_value = MagicMock()
        ModelFactoryRepository.make(
            _config(ModelProviderEnum.YANDEXGPT, {'apiKey': 'k', 'folderId': 'b1g'})
        )
        kwargs = mock_cls.call_args.kwargs
        assert kwargs['folder_id'] == 'b1g'
        assert kwargs['model_name'] == 'm'
```

- [ ] **Step 2: Run to verify fail**

Run: `uv run pytest tests/apps/agent/test_model_factory.py -k yandex -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add import:

```python
from langchain_community.chat_models import ChatYandexGPT
```

Add before `case _:` (adjust kwargs to the captured real signature; `model_name`/`folder_id`/`api_key` is correct for current `langchain-community`):

```python
            case ModelProviderEnum.YANDEXGPT:
                if config.connection.api_key is None or config.connection.folder_id is None:
                    raise InvalidPayloadError('YandexGPT provider requires api_key and folder_id')
                return ChatYandexGPT(
                    api_key=SecretStr(config.connection.api_key),
                    folder_id=config.connection.folder_id,
                    model_name=config.name,
                    temperature=temperature,
                )
```

- [ ] **Step 4: Run to verify pass + full factory suite**

Run: `uv run pytest tests/apps/agent/test_model_factory.py -v`
Expected: PASS (all arms).

- [ ] **Step 5: Commit**

```bash
git add apps/agents/agents/apps/agent/repositories/model_factory.py apps/agents/tests/apps/agent/test_model_factory.py
git commit -m "feat(agents): yandexgpt chat model"
```

---

### Task 9: embedding_factory — YandexGPT

**Files:**
- Modify: `apps/agents/agents/apps/processing/repositories/embedding_factory.py`
- Modify: `apps/agents/tests/apps/processing/test_embedding_factory.py`

- [ ] **Step 1: Add failing tests**

Append to `tests/apps/processing/test_embedding_factory.py`:

```python
def test_make_yandexgpt_requires_api_key_and_folder() -> None:
    factory = EmbeddingFactoryRepository()
    with pytest.raises(InvalidPayloadError, match='YandexGPT'):
        factory.make(_config(ModelProviderEnum.YANDEXGPT, {'apiKey': 'k'}))


def test_make_yandexgpt_passes_credentials() -> None:
    factory = EmbeddingFactoryRepository()
    with patch('agents.apps.processing.repositories.embedding_factory.YandexGPTEmbeddings') as mock_emb:
        mock_emb.return_value = MagicMock()
        factory.make(_config(ModelProviderEnum.YANDEXGPT, {'apiKey': 'k', 'folderId': 'b1g'}))
        kwargs = mock_emb.call_args.kwargs
        assert kwargs['folder_id'] == 'b1g'
        assert kwargs['model_name'] == 'm'
```

- [ ] **Step 2: Run to verify fail**

Run: `uv run pytest tests/apps/processing/test_embedding_factory.py -k yandex -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add import in `embedding_factory.py`:

```python
from langchain_community.embeddings import YandexGPTEmbeddings
```

Add before `case _:`:

```python
            case ModelProviderEnum.YANDEXGPT:
                if config.connection.api_key is None or config.connection.folder_id is None:
                    raise InvalidPayloadError('YandexGPT provider requires api_key and folder_id')
                return YandexGPTEmbeddings(
                    api_key=SecretStr(config.connection.api_key),
                    folder_id=config.connection.folder_id,
                    model_name=config.model_slug,
                )
```

- [ ] **Step 4: Run to verify pass**

Run: `uv run pytest tests/apps/processing/test_embedding_factory.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/agents/apps/processing/repositories/embedding_factory.py apps/agents/tests/apps/processing/test_embedding_factory.py
git commit -m "feat(agents): yandexgpt embeddings"
```

---

### Task 10: Validation schemas + use-cases

**Files:**
- Modify: `apps/agents/agents/apps/agent/schemas.py` (LLM + MCP validation schemas)
- Modify: `apps/agents/agents/apps/processing/schemas.py` (embedding validation schemas)
- Create: `apps/agents/agents/apps/agent/use_cases/validate_provider.py`
- Create: `apps/agents/agents/apps/processing/use_cases/validate_embedding.py`
- Create: `apps/agents/tests/apps/agent/test_validate_provider.py`
- Create: `apps/agents/tests/apps/processing/test_validate_embedding.py`

- [ ] **Step 1: Add request/response schemas**

In `agent/schemas.py` add (reuses `ModelConfigSchema`, `McpServerSchema` already defined here):

```python
class LlmValidationResponse(RequestResponseSchema):
    ok: bool
    error: str | None = None


class McpValidationResponse(RequestResponseSchema):
    ok: bool
    tools: list[str] = Field(default_factory=list)
    error: str | None = None
```

In `processing/schemas.py` add:

```python
class EmbeddingValidationRequest(RequestResponseSchema):
    model_config = ConfigDict(populate_by_name=True)

    provider: ModelProviderEnum
    model_slug: str = Field(alias='modelSlug', min_length=1)
    connection: ModelConnectionSchema


class EmbeddingValidationResponse(RequestResponseSchema):
    ok: bool
    vector_size: int | None = Field(default=None, alias='vectorSize')
    error: str | None = None
```

- [ ] **Step 2: Write failing use-case tests**

Create `tests/apps/agent/test_validate_provider.py`:

```python
from unittest.mock import AsyncMock, MagicMock

import pytest
from agents.apps.agent.repositories.model_factory import ModelFactoryRepository
from agents.apps.agent.schemas import McpServerSchema, ModelConfigSchema
from agents.apps.agent.use_cases.validate_provider import ValidateLlmUseCase, ValidateMcpUseCase


async def test_validate_llm_ok() -> None:
    factory = MagicMock(spec=ModelFactoryRepository)
    llm = MagicMock()
    llm.ainvoke = AsyncMock(return_value=MagicMock())
    factory.make.return_value = llm
    uc = ValidateLlmUseCase(model_factory=factory)
    res = await uc(ModelConfigSchema(provider='openai', name='gpt', connection={'apiKey': 'k'}))
    assert res.ok is True
    assert res.error is None


async def test_validate_llm_failure_is_caught() -> None:
    factory = MagicMock(spec=ModelFactoryRepository)
    factory.make.side_effect = RuntimeError('bad key')
    uc = ValidateLlmUseCase(model_factory=factory)
    res = await uc(ModelConfigSchema(provider='openai', name='gpt', connection={'apiKey': 'k'}))
    assert res.ok is False
    assert 'bad key' in (res.error or '')


async def test_validate_mcp_returns_tool_names() -> None:
    client = MagicMock()
    client.list_tools = AsyncMock(return_value=[MagicMock(name='t', **{'name': 'search'})])
    uc = ValidateMcpUseCase(mcp_client=client)
    res = await uc(McpServerSchema(name='probe', url='http://x/mcp'))
    assert res.ok is True
    assert res.tools == ['search']
```

Create `tests/apps/processing/test_validate_embedding.py`:

```python
from unittest.mock import AsyncMock, MagicMock

from agents.apps.processing.repositories.embedding_factory import EmbeddingFactoryRepository
from agents.apps.processing.schemas import EmbeddingValidationRequest
from agents.apps.processing.use_cases.validate_embedding import ValidateEmbeddingUseCase


async def test_validate_embedding_detects_vector_size() -> None:
    factory = MagicMock(spec=EmbeddingFactoryRepository)
    emb = MagicMock()
    emb.aembed_query = AsyncMock(return_value=[0.0] * 768)
    factory.make.return_value = emb
    uc = ValidateEmbeddingUseCase(embedding_factory=factory)
    res = await uc(EmbeddingValidationRequest(provider='ollama', modelSlug='nomic', connection={'baseUrl': 'http://o:1'}))
    assert res.ok is True
    assert res.vector_size == 768


async def test_validate_embedding_failure_is_caught() -> None:
    factory = MagicMock(spec=EmbeddingFactoryRepository)
    factory.make.side_effect = RuntimeError('no server')
    uc = ValidateEmbeddingUseCase(embedding_factory=factory)
    res = await uc(EmbeddingValidationRequest(provider='ollama', modelSlug='x', connection={}))
    assert res.ok is False
    assert 'no server' in (res.error or '')
```

- [ ] **Step 3: Run to verify fail**

Run: `uv run pytest tests/apps/agent/test_validate_provider.py tests/apps/processing/test_validate_embedding.py -v`
Expected: FAIL — modules `validate_provider` / `validate_embedding` not found.

- [ ] **Step 4: Implement the use-cases**

Create `agents/apps/agent/use_cases/validate_provider.py`:

```python
from __future__ import annotations

import asyncio
from dataclasses import dataclass

from agents.apps.agent.repositories.mcp_client import McpClient
from agents.apps.agent.repositories.model_factory import ModelFactoryRepository
from agents.apps.agent.schemas import (
    LlmValidationResponse,
    McpServerSchema,
    McpValidationResponse,
    ModelConfigSchema,
)

_LLM_TIMEOUT = 10.0
_MCP_TIMEOUT = 8.0


@dataclass
class ValidateLlmUseCase:
    model_factory: ModelFactoryRepository

    async def __call__(self, config: ModelConfigSchema) -> LlmValidationResponse:
        try:
            llm = self.model_factory.make(config)
            async with asyncio.timeout(_LLM_TIMEOUT):
                await llm.ainvoke('ping')
            return LlmValidationResponse(ok=True)
        except Exception as exc:  # noqa: BLE001 — surface provider error to the user
            return LlmValidationResponse(ok=False, error=str(exc)[:500])


@dataclass
class ValidateMcpUseCase:
    mcp_client: McpClient

    async def __call__(self, server: McpServerSchema) -> McpValidationResponse:
        try:
            async with asyncio.timeout(_MCP_TIMEOUT):
                tools = await self.mcp_client.list_tools(server)
            return McpValidationResponse(ok=True, tools=[t.name for t in tools])
        except Exception as exc:  # noqa: BLE001
            return McpValidationResponse(ok=False, error=str(exc)[:500])
```

Create `agents/apps/processing/use_cases/validate_embedding.py`:

```python
from __future__ import annotations

import asyncio
from dataclasses import dataclass

from ..repositories import EmbeddingFactoryRepository
from ..schemas import EmbeddingProviderConfigSchema, EmbeddingValidationRequest, EmbeddingValidationResponse

_EMB_TIMEOUT = 10.0


@dataclass
class ValidateEmbeddingUseCase:
    embedding_factory: EmbeddingFactoryRepository

    async def __call__(self, req: EmbeddingValidationRequest) -> EmbeddingValidationResponse:
        try:
            config = EmbeddingProviderConfigSchema(
                provider=req.provider,
                modelSlug=req.model_slug,
                vectorSize=1,  # placeholder; not used by .make(), real size detected below
                connection=req.connection,
            )
            embedder = self.embedding_factory.make(config)
            async with asyncio.timeout(_EMB_TIMEOUT):
                vector = await embedder.aembed_query('ping')
            return EmbeddingValidationResponse(ok=True, vectorSize=len(vector))
        except Exception as exc:  # noqa: BLE001
            return EmbeddingValidationResponse(ok=False, error=str(exc)[:500])
```

> Check that `agents/apps/processing/use_cases/__init__.py` and `agents/apps/processing/repositories/__init__.py` export the symbols used (`EmbeddingFactoryRepository` is already exported per the existing `from .repositories import EmbeddingFactoryRepository, VectorStoreRepository` in `depends.py`). Add `ValidateEmbeddingUseCase` to `use_cases/__init__.py` if that package uses an `__all__`/re-export pattern (mirror how `VectorizePageUseCase` is exported).

- [ ] **Step 5: Run to verify pass**

Run: `uv run pytest tests/apps/agent/test_validate_provider.py tests/apps/processing/test_validate_embedding.py -v`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/agents/agents/apps/agent/schemas.py apps/agents/agents/apps/processing/schemas.py apps/agents/agents/apps/agent/use_cases/validate_provider.py apps/agents/agents/apps/processing/use_cases/validate_embedding.py apps/agents/tests/apps/agent/test_validate_provider.py apps/agents/tests/apps/processing/test_validate_embedding.py
git commit -m "feat(agents): provider/embedding/mcp validation use-cases"
```

---

### Task 11: Validation router + DI wiring

**Files:**
- Create: `apps/agents/agents/apps/validation/__init__.py`
- Create: `apps/agents/agents/apps/validation/router.py`
- Modify: `apps/agents/agents/apps/agent/depends.py` (provide 2 use-cases)
- Modify: `apps/agents/agents/apps/processing/depends.py` (provide 1 use-case)
- Modify: `apps/agents/agents/router.py` (include router)
- Create: `apps/agents/tests/apps/validation/__init__.py`, `apps/agents/tests/apps/validation/test_validation_routes.py`

- [ ] **Step 1: Write failing route-registration test**

Create `apps/agents/tests/apps/validation/test_validation_routes.py`:

```python
from agents.cmd.rest import app


def test_validation_routes_registered() -> None:
    paths = {getattr(r, 'path', None) for r in app.routes}
    assert '/validation/llm' in paths
    assert '/validation/embedding' in paths
    assert '/validation/mcp' in paths
```

- [ ] **Step 2: Run to verify fail**

Run: `uv run pytest tests/apps/validation/test_validation_routes.py -v`
Expected: FAIL — paths missing.

- [ ] **Step 3: Create the router**

Create `agents/apps/validation/__init__.py` (empty). Create `agents/apps/validation/router.py`:

```python
"""Unauthenticated provider/MCP validation routes (internal network only)."""

from __future__ import annotations

from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter

from agents.apps.agent.schemas import (
    LlmValidationResponse,
    McpServerSchema,
    McpValidationResponse,
    ModelConfigSchema,
)
from agents.apps.agent.use_cases.validate_provider import ValidateLlmUseCase, ValidateMcpUseCase
from agents.apps.processing.schemas import EmbeddingValidationRequest, EmbeddingValidationResponse
from agents.apps.processing.use_cases.validate_embedding import ValidateEmbeddingUseCase

router = APIRouter(prefix='/validation', tags=['Validation'])


@router.post('/llm', response_model=LlmValidationResponse)
@inject
async def validate_llm(
    payload: ModelConfigSchema,
    use_case: FromDishka[ValidateLlmUseCase],
) -> LlmValidationResponse:
    return await use_case(payload)


@router.post('/embedding', response_model=EmbeddingValidationResponse)
@inject
async def validate_embedding(
    payload: EmbeddingValidationRequest,
    use_case: FromDishka[ValidateEmbeddingUseCase],
) -> EmbeddingValidationResponse:
    return await use_case(payload)


@router.post('/mcp', response_model=McpValidationResponse)
@inject
async def validate_mcp(
    payload: McpServerSchema,
    use_case: FromDishka[ValidateMcpUseCase],
) -> McpValidationResponse:
    return await use_case(payload)
```

- [ ] **Step 4: Provide the use-cases in existing providers**

In `agent/depends.py`, inside `AgentProvider`, add (after `rag_retrieval_service = provide(RagRetrievalService)`):

```python
    validate_llm_use_case = provide(ValidateLlmUseCase)
    validate_mcp_use_case = provide(ValidateMcpUseCase)
```

and add the import at the top of `agent/depends.py`:

```python
from agents.apps.agent.use_cases.validate_provider import ValidateLlmUseCase, ValidateMcpUseCase
```

In `processing/depends.py`, inside `ProcessingProvider`, add (after the other `provide(...)` lines):

```python
    validate_embedding_use_case = provide(ValidateEmbeddingUseCase)
```

and import:

```python
from .use_cases import DeletePageVectorsUseCase, DeleteWorkspaceVectorsUseCase, VectorizePageUseCase, ValidateEmbeddingUseCase
```

> Dishka auto-wires each use-case's dataclass field (`model_factory` / `mcp_client` / `embedding_factory`) from the already-registered app-singleton factory providers. All providers share one container (`ContainerManager.init_for_fastapi`), so the validation router resolves `ValidateEmbeddingUseCase` even though it's defined by `ProcessingProvider`.

- [ ] **Step 5: Include the router**

In `agents/router.py`, add import and `include_router`:

```python
from agents.apps.validation.router import router as validation_router
```

```python
    app.include_router(validation_router)
```

- [ ] **Step 6: Run to verify pass**

Run: `uv run pytest tests/apps/validation/test_validation_routes.py -v`
Expected: PASS.

- [ ] **Step 7: Smoke-test live (optional but recommended)**

Start agents (`pnpm --filter agents dev`), then:
```bash
curl -s localhost:8080/validation/embedding -H 'content-type: application/json' \
  -d '{"provider":"ollama","modelSlug":"nomic-embed-text","connection":{"baseUrl":"http://localhost:11434"}}'
```
Expected: JSON `{"ok": false, "error": "..."}` (no Ollama in dev) or `{"ok": true, "vectorSize": <n>}` — proves the route + DI + error handling work.

- [ ] **Step 8: Commit**

```bash
git add apps/agents/agents/apps/validation apps/agents/agents/apps/agent/depends.py apps/agents/agents/apps/processing/depends.py apps/agents/agents/router.py apps/agents/tests/apps/validation
git commit -m "feat(agents): /validation/{llm,embedding,mcp} endpoints + DI"
```

---

# Phase 3 — tRPC API + payload (`packages/trpc`, `apps/web`)

### Task 12: agents-validate helper

**Files:**
- Create: `packages/trpc/src/helpers/agents-validate.ts`
- Create: `packages/trpc/src/helpers/agents-validate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/trpc/src/helpers/agents-validate.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'

import { validateEmbedding, validateLlm, validateMcp } from './agents-validate'

afterEach(() => vi.restoreAllMocks())

function mockFetch(body: unknown, ok = true) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response)
}

describe('agents-validate', () => {
  it('validateLlm posts to /validation/llm and returns ok', async () => {
    const f = mockFetch({ ok: true, error: null })
    const res = await validateLlm({ provider: 'openai', name: 'gpt', connection: { apiKey: 'k' } })
    expect(res).toEqual({ ok: true, error: null })
    expect(f.mock.calls[0][0]).toContain('/validation/llm')
  })

  it('validateEmbedding returns vectorSize', async () => {
    mockFetch({ ok: true, vectorSize: 768, error: null })
    const res = await validateEmbedding({ provider: 'ollama', modelSlug: 'm', connection: { baseUrl: 'http://o:1' } })
    expect(res.ok).toBe(true)
    expect(res.vectorSize).toBe(768)
  })

  it('validateMcp returns tools', async () => {
    mockFetch({ ok: true, tools: ['search'], error: null })
    const res = await validateMcp({ url: 'http://x/mcp', transport: 'HTTP_JSONRPC', headers: {}, verify: true })
    expect(res.tools).toEqual(['search'])
  })

  it('treats a non-200 agents response as a failed validation', async () => {
    mockFetch({}, false)
    const res = await validateLlm({ provider: 'openai', name: 'gpt', connection: { apiKey: 'k' } })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/validation service/i)
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @repo/trpc test -- agents-validate`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/trpc/src/helpers/agents-validate.ts`:

```ts
export type ProviderConnectionInput = Record<string, string>

export type LlmValidationResult = { ok: boolean; error: string | null }
export type EmbeddingValidationResult = { ok: boolean; vectorSize: number | null; error: string | null }
export type McpValidationResult = { ok: boolean; tools: string[]; error: string | null }

function agentsBaseUrl(): string {
  return process.env.AGENTS_SERVICE_URL ?? 'http://localhost:8080'
}

async function postValidate<T extends { ok: boolean }>(
  path: string,
  body: unknown,
  onUnreachable: T,
): Promise<T> {
  const ctl = new AbortController()
  const timeout = setTimeout(() => ctl.abort(), 15_000)
  try {
    const res = await fetch(`${agentsBaseUrl()}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    })
    if (!res.ok) return onUnreachable
    return (await res.json()) as T
  } catch {
    return onUnreachable
  } finally {
    clearTimeout(timeout)
  }
}

export function validateLlm(input: {
  provider: string
  name: string
  connection: ProviderConnectionInput
}): Promise<LlmValidationResult> {
  return postValidate<LlmValidationResult>('/validation/llm', input, {
    ok: false,
    error: 'Validation service unavailable',
  })
}

export function validateEmbedding(input: {
  provider: string
  modelSlug: string
  connection: ProviderConnectionInput
}): Promise<EmbeddingValidationResult> {
  return postValidate<EmbeddingValidationResult>('/validation/embedding', input, {
    ok: false,
    vectorSize: null,
    error: 'Validation service unavailable',
  })
}

export function validateMcp(input: {
  url: string
  transport: 'HTTP_JSONRPC' | 'SSE'
  headers: ProviderConnectionInput
  verify: boolean
}): Promise<McpValidationResult> {
  return postValidate<McpValidationResult>(
    '/validation/mcp',
    { name: 'probe', ...input, tools: [] },
    { ok: false, tools: [], error: 'Validation service unavailable' },
  )
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @repo/trpc test -- agents-validate`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/helpers/agents-validate.ts packages/trpc/src/helpers/agents-validate.test.ts
git commit -m "feat(trpc): agents provider/embedding/mcp validation client"
```

---

### Task 13: `customAiProvidersEnabled` in plan helpers + workspace-scoped model queries

**Files:**
- Modify: `packages/trpc/src/helpers/plan.ts`
- Create: `packages/trpc/src/helpers/plan.test.ts` (if absent; otherwise extend)

- [ ] **Step 1: Add the flag to `PlanFeatures` + `planToFeatures`**

In `plan.ts`, add to the `PlanFeatures` type after `customMcpEnabled: boolean`:

```ts
  customAiProvidersEnabled: boolean
```

and in `planToFeatures` after `customMcpEnabled: plan.customMcpEnabled,`:

```ts
    customAiProvidersEnabled: plan.customAiProvidersEnabled,
```

- [ ] **Step 2: Scope model queries to shared + this workspace's providers**

In `getAvailableAiModels`, change the `where` to add a provider scope filter:

```ts
  return prisma.aiModel.findMany({
    where: {
      isActive: true,
      supportsEmbeddings: false,
      OR: [{ minPlanSlug: null }, { minPlanSlug: { in: allowedSlugs } }],
      provider: { isActive: true, OR: [{ workspaceId: null }, { workspaceId }] },
    },
    include: { provider: true },
    orderBy: { displayName: 'asc' },
  })
```

In `getAvailableEmbeddingModels`, add the same `provider:` filter (keep its existing `supportsEmbeddings: true, vectorSize: { not: null }`).

- [ ] **Step 3: Verify types**

Run: `pnpm --filter @repo/trpc check-types`
Expected: PASS (the new `PlanFeatures` field is now consumed; no other consumer breaks because it's additive).

- [ ] **Step 4: Commit**

```bash
git add packages/trpc/src/helpers/plan.ts
git commit -m "feat(trpc): plan flag customAiProvidersEnabled + workspace-scoped model listing"
```

---

### Task 14: `aiProvider` router

**Files:**
- Create: `packages/trpc/src/routers/ai-provider.ts`
- Create: `packages/trpc/src/routers/ai-provider.test.ts`
- Modify: `packages/trpc/src/index.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/trpc/src/routers/ai-provider.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../helpers/agents-validate', () => ({
  validateLlm: vi.fn(),
  validateEmbedding: vi.fn(),
  validateMcp: vi.fn(),
}))
vi.mock('../helpers/plan', async (orig) => ({
  ...(await orig<typeof import('../helpers/plan')>()),
  getWorkspaceFeatures: vi.fn(),
}))

import { validateEmbedding, validateLlm } from '../helpers/agents-validate'
import { getWorkspaceFeatures } from '../helpers/plan'
import { createCaller } from '../index'
import type { Context } from '../trpc'

const WS = '00000000-0000-0000-0000-000000000001'
const USER = '00000000-0000-0000-0000-0000000000aa'

function makeCtx(over: Partial<Record<string, unknown>> = {}): Context {
  const prisma = {
    workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER' }) },
    aiProvider: {
      create: vi.fn().mockResolvedValue({ id: 'p1', kind: 'OPENAI', name: 'My OpenAI', slug: 'p1', models: [] }),
      findFirst: vi.fn().mockResolvedValue({ id: 'p1', workspaceId: WS, connectionEnc: null }),
      findMany: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue({}),
    },
    aiModel: { create: vi.fn().mockResolvedValue({ id: 'm1' }) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    ...over,
  }
  return { prisma, user: { id: USER }, headers: new Headers(), resHeaders: new Headers() } as unknown as Context
}

beforeEach(() => {
  vi.mocked(getWorkspaceFeatures).mockResolvedValue({ customAiProvidersEnabled: true } as never)
  vi.mocked(validateLlm).mockResolvedValue({ ok: true, error: null })
  vi.mocked(validateEmbedding).mockResolvedValue({ ok: true, vectorSize: 768, error: null })
})

describe('aiProvider.create', () => {
  it('blocks save when the ping fails (nothing persisted)', async () => {
    vi.mocked(validateLlm).mockResolvedValue({ ok: false, error: 'bad key' })
    const ctx = makeCtx()
    const caller = createCaller(ctx)
    await expect(
      caller.aiProvider.create({
        workspaceId: WS,
        kind: 'OPENAI',
        name: 'My OpenAI',
        connection: { apiKey: 'bad' },
        model: { slug: 'gpt-4o', displayName: 'GPT-4o', contextTokens: 128000, supportsEmbeddings: false },
      }),
    ).rejects.toThrow(/bad key/)
    expect((ctx.prisma as never as { aiProvider: { create: ReturnType<typeof vi.fn> } }).aiProvider.create).not.toHaveBeenCalled()
  })

  it('persists with encrypted creds when the ping passes', async () => {
    const ctx = makeCtx()
    const caller = createCaller(ctx)
    const out = await caller.aiProvider.create({
      workspaceId: WS,
      kind: 'OPENAI',
      name: 'My OpenAI',
      connection: { apiKey: 'sk-good' },
      model: { slug: 'gpt-4o', displayName: 'GPT-4o', contextTokens: 128000, supportsEmbeddings: false },
    })
    expect(out.id).toBe('p1')
    const createArg = vi.mocked((ctx.prisma as never as { aiProvider: { create: ReturnType<typeof vi.fn> } }).aiProvider.create).mock.calls[0][0]
    // creds are encrypted (object payload), never the raw apiKey
    expect(JSON.stringify(createArg)).not.toContain('sk-good')
    expect(createArg.data.connectionEnc).toBeDefined()
  })

  it('forbids non-owners', async () => {
    const ctx = makeCtx({ workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role: 'EDITOR' }) } })
    const caller = createCaller(ctx)
    await expect(
      caller.aiProvider.create({
        workspaceId: WS,
        kind: 'OPENAI',
        name: 'X',
        connection: { apiKey: 'k' },
        model: { slug: 'm', displayName: 'M', contextTokens: 1000, supportsEmbeddings: false },
      }),
    ).rejects.toThrow(/прав/)
  })

  it('gates behind the plan flag', async () => {
    vi.mocked(getWorkspaceFeatures).mockResolvedValue({ customAiProvidersEnabled: false } as never)
    const ctx = makeCtx()
    const caller = createCaller(ctx)
    await expect(
      caller.aiProvider.create({
        workspaceId: WS,
        kind: 'OPENAI',
        name: 'X',
        connection: { apiKey: 'k' },
        model: { slug: 'm', displayName: 'M', contextTokens: 1000, supportsEmbeddings: false },
      }),
    ).rejects.toThrow()
  })
})
```

Set `SECRETS_ENCRYPTION_KEY` for the test run. Add to the top of the test file:

```ts
process.env.SECRETS_ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString('base64')
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @repo/trpc test -- ai-provider`
Expected: FAIL — `caller.aiProvider` is undefined.

- [ ] **Step 3: Implement the router**

Create `packages/trpc/src/routers/ai-provider.ts`:

```ts
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { randomUUID } from 'node:crypto'
import type { PrismaClient } from '@repo/db'
import { parseAiProviderConnection } from '@repo/db'
import { encryptSecret, decryptSecret, type EncryptedPayload } from '@repo/auth'

import { router, protectedProcedure } from '../trpc'
import { getWorkspaceFeatures } from '../helpers/plan'
import { validateEmbedding, validateLlm, type ProviderConnectionInput } from '../helpers/agents-validate'

const kindSchema = z.enum(['OLLAMA', 'OPENAI', 'GIGACHAT', 'YANDEXGPT', 'ANTHROPIC', 'DEEPSEEK'])

const connectionSchema = z.object({
  baseUrl: z.string().url().optional(),
  apiKey: z.string().min(1).optional(),
  organization: z.string().optional(),
  scope: z.string().optional(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  folderId: z.string().optional(),
})

const modelInput = z.object({
  slug: z.string().min(1).max(100),
  displayName: z.string().min(1).max(150),
  contextTokens: z.number().int().positive(),
  supportsVision: z.boolean().default(false),
  supportsEmbeddings: z.boolean().default(false),
})

async function assertOwner(ctx: { prisma: PrismaClient; user: { id: string } }, workspaceId: string) {
  const member = await ctx.prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: ctx.user.id } },
  })
  if (!member || member.role !== 'OWNER') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав' })
  }
}

async function assertPlan(workspaceId: string) {
  const features = await getWorkspaceFeatures(workspaceId)
  if (!features.customAiProvidersEnabled) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'CUSTOM_AI_PROVIDERS_NOT_IN_PLAN' })
  }
}

function decryptConnection(connectionEnc: unknown): ProviderConnectionInput {
  if (!connectionEnc) return {}
  return JSON.parse(decryptSecret(connectionEnc as EncryptedPayload)) as ProviderConnectionInput
}

// Validate a model against a connection; throws TRPCError on failure. Returns vectorSize for embeddings.
async function pingModel(args: {
  kind: z.infer<typeof kindSchema>
  modelSlug: string
  supportsEmbeddings: boolean
  connection: ProviderConnectionInput
}): Promise<number | null> {
  const provider = args.kind.toLowerCase()
  if (args.supportsEmbeddings) {
    const res = await validateEmbedding({ provider, modelSlug: args.modelSlug, connection: args.connection })
    if (!res.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: `Не удалось подключиться: ${res.error}` })
    return res.vectorSize
  }
  const res = await validateLlm({ provider, name: args.modelSlug, connection: args.connection })
  if (!res.ok) throw new TRPCError({ code: 'BAD_REQUEST', message: `Не удалось подключиться: ${res.error}` })
  return null
}

function normalizeConnection(kind: z.infer<typeof kindSchema>, raw: z.infer<typeof connectionSchema>): ProviderConnectionInput {
  // parseAiProviderConnection validates required fields per provider kind and drops the discriminator.
  const parsed = parseAiProviderConnection(kind.toLowerCase(), raw) as Record<string, unknown>
  const out: ProviderConnectionInput = {}
  for (const [k, v] of Object.entries(parsed)) {
    if (k !== 'provider' && typeof v === 'string') out[k] = v
  }
  return out
}

export const aiProviderRouter = router({
  list: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertOwner(ctx, input.workspaceId)
      const rows = await ctx.prisma.aiProvider.findMany({
        where: { workspaceId: input.workspaceId },
        orderBy: { createdAt: 'asc' },
        include: { models: { orderBy: { displayName: 'asc' } } },
      })
      // never expose creds
      return rows.map(({ connection, connectionEnc, ...rest }) => rest)
    }),

  create: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        kind: kindSchema,
        name: z.string().min(1).max(100),
        connection: connectionSchema,
        model: modelInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertOwner(ctx, input.workspaceId)
      await assertPlan(input.workspaceId)
      const connection = normalizeConnection(input.kind, input.connection)
      const vectorSize = await pingModel({
        kind: input.kind,
        modelSlug: input.model.slug,
        supportsEmbeddings: input.model.supportsEmbeddings,
        connection,
      })
      const encrypted = encryptSecret(JSON.stringify(connection))
      const provider = await ctx.prisma.$transaction(async (tx) => {
        return tx.aiProvider.create({
          data: {
            workspaceId: input.workspaceId,
            kind: input.kind,
            slug: randomUUID(),
            name: input.name,
            connection: {},
            connectionEnc: encrypted as unknown as object,
            createdById: ctx.user.id,
            models: {
              create: {
                slug: input.model.slug,
                displayName: input.model.displayName,
                contextTokens: input.model.contextTokens,
                supportsVision: input.model.supportsVision,
                supportsEmbeddings: input.model.supportsEmbeddings,
                vectorSize,
              },
            },
          },
          include: { models: true },
        })
      })
      const { connection: _c, connectionEnc: _e, ...rest } = provider
      return rest
    }),

  addModel: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid(), providerId: z.string().uuid(), model: modelInput }))
    .mutation(async ({ ctx, input }) => {
      await assertOwner(ctx, input.workspaceId)
      await assertPlan(input.workspaceId)
      const provider = await ctx.prisma.aiProvider.findFirst({
        where: { id: input.providerId, workspaceId: input.workspaceId },
      })
      if (!provider) throw new TRPCError({ code: 'NOT_FOUND' })
      const connection = decryptConnection(provider.connectionEnc)
      const vectorSize = await pingModel({
        kind: provider.kind,
        modelSlug: input.model.slug,
        supportsEmbeddings: input.model.supportsEmbeddings,
        connection,
      })
      return ctx.prisma.aiModel.create({
        data: {
          providerId: provider.id,
          slug: input.model.slug,
          displayName: input.model.displayName,
          contextTokens: input.model.contextTokens,
          supportsVision: input.model.supportsVision,
          supportsEmbeddings: input.model.supportsEmbeddings,
          vectorSize,
        },
      })
    }),

  deleteModel: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid(), modelId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertOwner(ctx, input.workspaceId)
      const model = await ctx.prisma.aiModel.findFirst({
        where: { id: input.modelId, provider: { workspaceId: input.workspaceId } },
      })
      if (!model) throw new TRPCError({ code: 'NOT_FOUND' })
      await ctx.prisma.aiModel.delete({ where: { id: input.modelId } })
      return { ok: true as const }
    }),

  delete: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid(), providerId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertOwner(ctx, input.workspaceId)
      const provider = await ctx.prisma.aiProvider.findFirst({
        where: { id: input.providerId, workspaceId: input.workspaceId },
      })
      if (!provider) throw new TRPCError({ code: 'NOT_FOUND' })
      await ctx.prisma.aiProvider.delete({ where: { id: input.providerId } })
      return { ok: true as const }
    }),
})
```

> `connection: {}` is stored as the plaintext column (empty) for workspace providers; the real creds live encrypted in `connectionEnc`. Deleting a provider cascades to its `AiModel` rows (FK), and any `WorkspaceAiSettings.defaultModelId`/`embeddingsModelId` referencing a deleted model is set to NULL (existing `onDelete: SetNull`).

- [ ] **Step 4: Register in `appRouter`**

In `packages/trpc/src/index.ts`, add the import and entry:

```ts
import { aiProviderRouter } from './routers/ai-provider'
```

and inside `router({ ... })` add:

```ts
  aiProvider: aiProviderRouter,
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @repo/trpc test -- ai-provider`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/trpc/src/routers/ai-provider.ts packages/trpc/src/routers/ai-provider.test.ts packages/trpc/src/index.ts
git commit -m "feat(trpc): aiProvider router with ping-on-save + encrypted creds (owner-only, plan-gated)"
```

---

### Task 15: Owner-gate `aiSettings.update`

**Files:**
- Modify: `packages/trpc/src/routers/ai-settings.ts`
- Create: `packages/trpc/src/routers/ai-settings.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/trpc/src/routers/ai-settings.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('../helpers/plan', async (orig) => ({
  ...(await orig<typeof import('../helpers/plan')>()),
  requireWritableWorkspace: vi.fn().mockResolvedValue(undefined),
  getAvailableAiModels: vi.fn().mockResolvedValue([]),
  getAvailableEmbeddingModels: vi.fn().mockResolvedValue([]),
}))

import { createCaller } from '../index'
import type { Context } from '../trpc'

const WS = '00000000-0000-0000-0000-000000000001'

function makeCtx(role: string | null): Context {
  const prisma = {
    workspaceMember: { findUnique: vi.fn().mockResolvedValue(role ? { role } : null) },
    workspaceAiSettings: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  }
  return { prisma, user: { id: 'u1' }, headers: new Headers(), resHeaders: new Headers() } as unknown as Context
}

describe('aiSettings.update owner gate', () => {
  it('forbids a non-owner member', async () => {
    const caller = createCaller(makeCtx('EDITOR'))
    await expect(caller.aiSettings.update({ workspaceId: WS, systemPrompt: 'x' })).rejects.toThrow(/прав/)
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @repo/trpc test -- ai-settings`
Expected: FAIL — currently an EDITOR is allowed (no throw).

- [ ] **Step 3: Implement**

In `ai-settings.ts`, add an owner assertion and call it from `update`. Add after the existing `assertWorkspaceMember`:

```ts
async function assertWorkspaceOwner(
  ctx: { prisma: Prisma.TransactionClient | typeof import('@repo/db').prisma; user: { id: string } },
  workspaceId: string,
) {
  const member = await ctx.prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: ctx.user.id } },
  })
  if (!member || member.role !== 'OWNER') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав' })
  }
  return member
}
```

In the `update` mutation, replace the first line `await assertWorkspaceMember(ctx, input.workspaceId)` with:

```ts
      await assertWorkspaceOwner(ctx, input.workspaceId)
```

(Leave `get`, `listAvailableModels`, `listAvailableEmbeddingModels` using `assertWorkspaceMember`.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @repo/trpc test -- ai-settings`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/routers/ai-settings.ts packages/trpc/src/routers/ai-settings.test.ts
git commit -m "feat(trpc): restrict aiSettings.update to workspace owner"
```

---

### Task 16: MCP ping + plan gate on `mcpServer.create`/`update`

**Files:**
- Modify: `packages/trpc/src/routers/mcp-server.ts`
- Create: `packages/trpc/src/routers/mcp-server.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/trpc/src/routers/mcp-server.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

process.env.SECRETS_ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString('base64')

vi.mock('../helpers/agents-validate', () => ({ validateMcp: vi.fn() }))
vi.mock('../helpers/plan', async (orig) => ({
  ...(await orig<typeof import('../helpers/plan')>()),
  getWorkspaceFeatures: vi.fn(),
}))

import { validateMcp } from '../helpers/agents-validate'
import { getWorkspaceFeatures } from '../helpers/plan'
import { createCaller } from '../index'
import type { Context } from '../trpc'

const WS = '00000000-0000-0000-0000-000000000001'

function makeCtx(role = 'OWNER') {
  const prisma = {
    workspaceMember: { findUnique: vi.fn().mockResolvedValue({ role }) },
    workspaceMcpServer: { create: vi.fn().mockResolvedValue({ id: 's1', workspaceId: WS }) },
  }
  return { prisma, user: { id: 'u1' }, headers: new Headers(), resHeaders: new Headers() } as unknown as Context
}

beforeEach(() => {
  vi.mocked(getWorkspaceFeatures).mockResolvedValue({ customMcpEnabled: true } as never)
  vi.mocked(validateMcp).mockResolvedValue({ ok: true, tools: ['search'], error: null })
})

describe('mcpServer.create', () => {
  it('blocks when ping fails', async () => {
    vi.mocked(validateMcp).mockResolvedValue({ ok: false, tools: [], error: 'unreachable' })
    const ctx = makeCtx()
    const caller = createCaller(ctx)
    await expect(
      caller.mcpServer.create({ workspaceId: WS, name: 'x', url: 'http://x/mcp', transport: 'HTTP_JSONRPC', headers: {}, toolsAllowlist: [], verifyTls: true }),
    ).rejects.toThrow(/unreachable/)
    expect(vi.mocked((ctx.prisma as never as { workspaceMcpServer: { create: ReturnType<typeof vi.fn> } }).workspaceMcpServer.create)).not.toHaveBeenCalled()
  })

  it('persists when ping passes', async () => {
    const caller = createCaller(makeCtx())
    const out = await caller.mcpServer.create({ workspaceId: WS, name: 'x', url: 'http://x/mcp', transport: 'HTTP_JSONRPC', headers: {}, toolsAllowlist: [], verifyTls: true })
    expect(out.id).toBe('s1')
  })

  it('gates behind customMcpEnabled', async () => {
    vi.mocked(getWorkspaceFeatures).mockResolvedValue({ customMcpEnabled: false } as never)
    const caller = createCaller(makeCtx())
    await expect(
      caller.mcpServer.create({ workspaceId: WS, name: 'x', url: 'http://x/mcp', transport: 'HTTP_JSONRPC', headers: {}, toolsAllowlist: [], verifyTls: true }),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @repo/trpc test -- mcp-server`
Expected: FAIL — create currently neither pings nor gates.

- [ ] **Step 3: Implement**

In `mcp-server.ts`, add imports:

```ts
import { getWorkspaceFeatures } from '../helpers/plan'
import { validateMcp } from '../helpers/agents-validate'
```

In `create`, after `await assertRole(ctx, input.workspaceId, OWNERS)` add:

```ts
      const features = await getWorkspaceFeatures(input.workspaceId)
      if (!features.customMcpEnabled) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'CUSTOM_MCP_NOT_IN_PLAN' })
      }
      const ping = await validateMcp({
        url: input.url,
        transport: input.transport,
        headers: input.headers,
        verify: input.verifyTls,
      })
      if (!ping.ok) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Не удалось подключиться к MCP: ${ping.error}` })
      }
```

In `update`, after `await assertRole(ctx, input.workspaceId, OWNERS)` add a re-ping **only when** url/transport/headers/verifyTls change. Insert:

```ts
      if (
        input.url !== undefined ||
        input.transport !== undefined ||
        input.headers !== undefined ||
        input.verifyTls !== undefined
      ) {
        const existing = await ctx.prisma.workspaceMcpServer.findUniqueOrThrow({ where: { id: input.id } })
        const ping = await validateMcp({
          url: input.url ?? existing.url,
          transport: (input.transport ?? existing.transport) as 'HTTP_JSONRPC' | 'SSE',
          headers: input.headers ?? decryptMcpHeaders(existing.headers),
          verify: input.verifyTls ?? existing.verifyTls,
        })
        if (!ping.ok) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: `Не удалось подключиться к MCP: ${ping.error}` })
        }
      }
```

(`decryptMcpHeaders` is already defined/exported at the bottom of this file.)

- [ ] **Step 4: Run to verify pass + full router suite**

Run: `pnpm --filter @repo/trpc test -- mcp-server`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/routers/mcp-server.ts packages/trpc/src/routers/mcp-server.test.ts
git commit -m "feat(trpc): ping MCP servers before save + plan gate"
```

---

### Task 17: Payload — send `kind` + resolve (decrypt) connection

**Files:**
- Create: `apps/web/src/lib/chat/provider-connection.ts`
- Create: `apps/web/src/lib/chat/provider-connection.test.ts`
- Modify: `apps/web/src/lib/chat/agents-payload.ts`
- Modify: `apps/web/src/app/api/agents/generate/route.ts`
- Modify (if present): `apps/web/src/app/api/agent/generate/route.ts`

- [ ] **Step 1: Write the failing test for the resolver**

Create `apps/web/src/lib/chat/provider-connection.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { encryptSecret } from '@repo/auth'

process.env.SECRETS_ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString('base64')

import { resolveProviderConnection } from './provider-connection'

describe('resolveProviderConnection', () => {
  it('returns plaintext connection for shared providers (workspaceId null)', () => {
    const c = resolveProviderConnection({ workspaceId: null, connection: { baseUrl: 'http://o:1' }, connectionEnc: null })
    expect(c).toEqual({ baseUrl: 'http://o:1' })
  })

  it('decrypts connectionEnc for workspace providers', () => {
    const enc = encryptSecret(JSON.stringify({ apiKey: 'sk-secret' }))
    const c = resolveProviderConnection({ workspaceId: 'ws', connection: {}, connectionEnc: enc })
    expect(c).toEqual({ apiKey: 'sk-secret' })
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter web test -- provider-connection`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the resolver**

Create `apps/web/src/lib/chat/provider-connection.ts`:

```ts
import { decryptSecret, type EncryptedPayload } from '@repo/auth'

export function resolveProviderConnection(provider: {
  workspaceId: string | null
  connection: unknown
  connectionEnc: unknown
}): Record<string, string> {
  const raw = provider.workspaceId && provider.connectionEnc
    ? (JSON.parse(decryptSecret(provider.connectionEnc as EncryptedPayload)) as unknown)
    : provider.connection
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}
```

- [ ] **Step 4: Update the payload builder to send `kind` + pre-resolved connection**

In `apps/web/src/lib/chat/agents-payload.ts`:

Change `WorkspaceSettingsSnapshot` so each provider carries `kind` + a resolved connection object:

```ts
export type WorkspaceSettingsSnapshot = {
  temperature: number | null
  topP: number | null
  systemPrompt: string | null
  defaultModel: {
    slug: string
    provider: { kind: string; connection: Record<string, string> }
  }
  embeddingsModel: {
    slug: string
    vectorSize: number
    provider: { kind: string; connection: Record<string, string> }
  } | null
}
```

Remove the `import { parseAiProviderConnection } from '@repo/db'` line. In `buildAgentRunPayload`, replace the `embeddingConfig` and `model` blocks so they use `kind` + `normalizeConnection(provider.connection)`:

```ts
  const embeddingConfig = args.settings.embeddingsModel
    ? {
        provider: args.settings.embeddingsModel.provider.kind,
        modelSlug: args.settings.embeddingsModel.slug,
        vectorSize: args.settings.embeddingsModel.vectorSize,
        connection: normalizeConnection(args.settings.embeddingsModel.provider.connection),
      }
    : null
```

```ts
    model: {
      provider: args.settings.defaultModel.provider.kind,
      name: args.settings.defaultModel.slug,
      connection: normalizeConnection(args.settings.defaultModel.provider.connection),
      settings: { temperature: args.settings.temperature, topP: args.settings.topP },
    },
```

(`provider` field on the wire payload becomes the lowercase enum value — see Step 5; `normalizeConnection` already lowercases nothing, so lowercase the kind in the route.)

- [ ] **Step 5: Build the snapshot from resolved connections in the route**

In `apps/web/src/app/api/agents/generate/route.ts`, add the import:

```ts
import { resolveProviderConnection } from '@/lib/chat/provider-connection'
```

Replace the `settingsSnapshot` object (currently at ~line 161) with:

```ts
  const settingsSnapshot = {
    defaultModel: {
      slug: settings.defaultModel.slug,
      provider: {
        kind: settings.defaultModel.provider.kind.toLowerCase(),
        connection: resolveProviderConnection(settings.defaultModel.provider),
      },
    },
    embeddingsModel:
      settings.embeddingsModel && settings.embeddingsModel.vectorSize !== null
        ? {
            slug: settings.embeddingsModel.slug,
            vectorSize: settings.embeddingsModel.vectorSize,
            provider: {
              kind: settings.embeddingsModel.provider.kind.toLowerCase(),
              connection: resolveProviderConnection(settings.embeddingsModel.provider),
            },
          }
        : null,
    systemPrompt: settings.systemPrompt,
    temperature: settings.temperature,
    topP: settings.topP,
  }
```

> The existing `include: { defaultModel: { include: { provider: true } }, embeddingsModel: { include: { provider: true } } }` already loads `provider.kind`, `provider.connection`, `provider.connectionEnc`, `provider.workspaceId`, so no query change is needed.

- [ ] **Step 6: Update the legacy route if it exists**

Run: `grep -n "provider.slug\|settingsSnapshot\|buildAgentRunPayload" apps/web/src/app/api/agent/generate/route.ts`. If it builds the same snapshot, apply the identical `kind` + `resolveProviderConnection` change there. If the file does not exist or doesn't build this snapshot, skip.

- [ ] **Step 7: Run tests + check-types**

Run: `pnpm --filter web test -- provider-connection && pnpm --filter web check-types`
Expected: PASS. (check-types catches any remaining `provider.slug` references in the payload path.)

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/chat/provider-connection.ts apps/web/src/lib/chat/provider-connection.test.ts apps/web/src/lib/chat/agents-payload.ts apps/web/src/app/api/agents/generate/route.ts apps/web/src/app/api/agent/generate/route.ts
git commit -m "feat(web): send provider.kind + decrypt workspace provider creds in agent payload"
```

---

# Phase 4 — Web UI

### Task 18: Custom-providers manager in AI settings

**Files:**
- Create: `apps/web/src/components/workspace/settings/ai-providers-manager.tsx`
- Modify: `apps/web/src/components/workspace/settings/ai-section.tsx`
- Modify: `apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/ai/page.tsx`

- [ ] **Step 1: Add `isOwner` + `customProvidersEnabled` to the page → section**

In `ai/page.tsx`, fetch role + features and pass down. Replace the page body with:

```tsx
import { notFound } from 'next/navigation'

import { getAvailableAiModels, getAvailableEmbeddingModels, getWorkspaceFeatures } from '@repo/trpc'
import { WorkspaceAiSection } from '@/components/workspace/settings/ai-section'
import { getServerTRPC } from '@/trpc/server'

type Props = { params: Promise<{ workspaceId: string }> }

export default async function WorkspaceSettingsAiPage({ params }: Props) {
  const { workspaceId } = await params
  const features = await getWorkspaceFeatures(workspaceId)
  if (!features.aiSettingsEnabled) notFound()
  const trpc = await getServerTRPC()
  const [workspace, myRole, models, embeddingModels] = await Promise.all([
    trpc.workspace.getById({ id: workspaceId }),
    trpc.workspace.getMyRole({ workspaceId }),
    getAvailableAiModels(workspaceId),
    getAvailableEmbeddingModels(workspaceId),
  ])
  if (!workspace) notFound()

  return (
    <WorkspaceAiSection
      workspaceId={workspaceId}
      initialModels={models}
      initialEmbeddingModels={embeddingModels}
      isOwner={myRole === 'OWNER'}
      customProvidersEnabled={features.customAiProvidersEnabled}
    />
  )
}
```

- [ ] **Step 2: Accept the new props in `ai-section.tsx` and render the manager**

In `ai-section.tsx`, extend `Props`:

```tsx
type Props = {
  workspaceId: string
  initialModels?: InitialModel[]
  initialEmbeddingModels?: InitialEmbeddingModel[]
  isOwner?: boolean
  customProvidersEnabled?: boolean
}
```

Destructure them in the component signature: `({ workspaceId, initialModels, initialEmbeddingModels, isOwner = false, customProvidersEnabled = false }: Props)`.

Add the import near the `SettingsCard` import:

```tsx
import { AiProvidersManager } from './ai-providers-manager'
```

Render the manager at the end of the returned `<Stack>` (after the "Векторизация" `SettingsCard`, before the Save row) only when allowed:

```tsx
        {isOwner && customProvidersEnabled ? (
          <AiProvidersManager workspaceId={workspaceId} />
        ) : null}
```

- [ ] **Step 3: Implement the manager component**

Create `apps/web/src/components/workspace/settings/ai-providers-manager.tsx`:

```tsx
'use client'

import { useState } from 'react'

import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  DeleteIcon,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { SettingsCard } from './settings-card'

const KINDS = ['OPENAI', 'ANTHROPIC', 'DEEPSEEK', 'GIGACHAT', 'YANDEXGPT', 'OLLAMA'] as const
type Kind = (typeof KINDS)[number]

// Which connection fields each provider kind needs.
const FIELDS: Record<Kind, Array<{ key: string; label: string; required?: boolean }>> = {
  OPENAI: [
    { key: 'apiKey', label: 'API ключ', required: true },
    { key: 'organization', label: 'Organization' },
    { key: 'baseUrl', label: 'Base URL' },
  ],
  ANTHROPIC: [{ key: 'apiKey', label: 'API ключ', required: true }, { key: 'baseUrl', label: 'Base URL' }],
  DEEPSEEK: [{ key: 'apiKey', label: 'API ключ', required: true }, { key: 'baseUrl', label: 'Base URL' }],
  GIGACHAT: [
    { key: 'clientId', label: 'Client ID', required: true },
    { key: 'clientSecret', label: 'Client Secret', required: true },
    { key: 'scope', label: 'Scope' },
  ],
  YANDEXGPT: [
    { key: 'apiKey', label: 'API ключ', required: true },
    { key: 'folderId', label: 'Folder ID', required: true },
  ],
  OLLAMA: [{ key: 'baseUrl', label: 'Base URL', required: true }],
}

export function AiProvidersManager({ workspaceId }: { workspaceId: string }) {
  const utils = trpc.useUtils()
  const list = trpc.aiProvider.list.useQuery({ workspaceId })
  const invalidate = () => {
    utils.aiProvider.list.invalidate({ workspaceId })
    utils.aiSettings.listAvailableModels.invalidate({ workspaceId })
    utils.aiSettings.listAvailableEmbeddingModels.invalidate({ workspaceId })
  }
  const create = trpc.aiProvider.create.useMutation({ onSuccess: () => { invalidate(); setOpen(false) } })
  const del = trpc.aiProvider.delete.useMutation({ onSuccess: invalidate })

  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<Kind>('OPENAI')
  const [name, setName] = useState('')
  const [connection, setConnection] = useState<Record<string, string>>({})
  const [modelSlug, setModelSlug] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [contextTokens, setContextTokens] = useState('128000')
  const [supportsEmbeddings, setSupportsEmbeddings] = useState(false)

  const reset = () => {
    setKind('OPENAI'); setName(''); setConnection({}); setModelSlug(''); setDisplayName(''); setContextTokens('128000'); setSupportsEmbeddings(false)
  }

  const submit = () => {
    const conn: Record<string, string> = {}
    for (const f of FIELDS[kind]) {
      const v = connection[f.key]?.trim()
      if (v) conn[f.key] = v
    }
    create.mutate({
      workspaceId,
      kind,
      name: name.trim(),
      connection: conn,
      model: {
        slug: modelSlug.trim(),
        displayName: displayName.trim() || modelSlug.trim(),
        contextTokens: Number(contextTokens) || 4096,
        supportsEmbeddings,
      },
    })
  }

  return (
    <SettingsCard
      title="Свои провайдеры"
      description="Подключите собственные LLM/embedding провайдеры с вашими ключами. Перед сохранением выполняется проверка соединения."
    >
      {list.data?.length ? (
        <Stack spacing={1}>
          {list.data.map((p) => (
            <Box key={p.id} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
              <Box>
                <Typography variant="subtitle2">{p.name} <Chip size="small" label={p.kind} sx={{ ml: 1 }} /></Typography>
                <Typography variant="caption" color="text.secondary">
                  {p.models.map((m) => m.displayName).join(', ') || 'нет моделей'}
                </Typography>
              </Box>
              <IconButton onClick={() => del.mutate({ workspaceId, providerId: p.id })} aria-label="Удалить провайдера">
                <DeleteIcon />
              </IconButton>
            </Box>
          ))}
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary">Пока нет своих провайдеров.</Typography>
      )}

      <Button variant="outlined" onClick={() => { reset(); setOpen(true) }} sx={{ alignSelf: 'flex-start' }}>
        Добавить провайдера
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Новый провайдер</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {create.error ? <Alert severity="error">{create.error.message}</Alert> : null}
            <TextField label="Тип" select value={kind} onChange={(e) => { setKind(e.target.value as Kind); setConnection({}) }}>
              {KINDS.map((k) => <MenuItem key={k} value={k}>{k}</MenuItem>)}
            </TextField>
            <TextField label="Название" value={name} onChange={(e) => setName(e.target.value)} />
            {FIELDS[kind].map((f) => (
              <TextField
                key={f.key}
                label={f.label + (f.required ? ' *' : '')}
                value={connection[f.key] ?? ''}
                onChange={(e) => setConnection((c) => ({ ...c, [f.key]: e.target.value }))}
              />
            ))}
            <Typography variant="subtitle2">Первая модель</Typography>
            <TextField label="Идентификатор модели (slug)" value={modelSlug} onChange={(e) => setModelSlug(e.target.value)} />
            <TextField label="Отображаемое имя" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            <TextField label="Контекст (токены)" value={contextTokens} onChange={(e) => setContextTokens(e.target.value)} />
            <TextField label="Тип модели" select value={supportsEmbeddings ? 'emb' : 'chat'} onChange={(e) => setSupportsEmbeddings(e.target.value === 'emb')}>
              <MenuItem value="chat">Чат (LLM)</MenuItem>
              <MenuItem value="emb">Векторизация (embeddings)</MenuItem>
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Отмена</Button>
          <Button variant="contained" onClick={submit} loading={create.isPending} disabled={!name.trim() || !modelSlug.trim()}>
            {create.isPending ? 'Проверка соединения…' : 'Сохранить'}
          </Button>
        </DialogActions>
      </Dialog>
    </SettingsCard>
  )
}
```

- [ ] **Step 4: Verify build/types + manual smoke**

Run: `pnpm --filter web check-types && pnpm --filter web lint`
Then run the app (`pnpm dev`), open `/workspaces/<id>/settings/ai` as the workspace owner on the `max` plan. Confirm: "Свои провайдеры" card shows; "Добавить провайдера" opens the dialog; saving with a bad key shows the red "Не удалось подключиться" alert and does NOT add a row; a valid provider appears and its model shows up in the "Модель по умолчанию" select. Non-owner / non-`max` should not see the card.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/workspace/settings/ai-providers-manager.tsx apps/web/src/components/workspace/settings/ai-section.tsx "apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/ai/page.tsx"
git commit -m "feat(web): custom AI providers manager in workspace AI settings (owner + plan gated)"
```

---

### Task 19: Workspace MCP settings section

**Files:**
- Create: `apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/mcp/page.tsx`
- Create: `apps/web/src/components/workspace/settings/mcp-section.tsx`

- [ ] **Step 1: Create the RSC page (owner + plan gate)**

Create `apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/mcp/page.tsx`:

```tsx
import { notFound } from 'next/navigation'

import { getWorkspaceFeatures } from '@repo/trpc'
import { WorkspaceMcpSection } from '@/components/workspace/settings/mcp-section'
import { getServerTRPC } from '@/trpc/server'

type Props = { params: Promise<{ workspaceId: string }> }

export default async function WorkspaceSettingsMcpPage({ params }: Props) {
  const { workspaceId } = await params
  const features = await getWorkspaceFeatures(workspaceId)
  if (!features.aiSettingsEnabled) notFound()
  const trpc = await getServerTRPC()
  const [workspace, myRole] = await Promise.all([
    trpc.workspace.getById({ id: workspaceId }),
    trpc.workspace.getMyRole({ workspaceId }),
  ])
  if (!workspace) notFound()

  return (
    <WorkspaceMcpSection
      workspaceId={workspaceId}
      isOwner={myRole === 'OWNER'}
      customMcpEnabled={features.customMcpEnabled}
    />
  )
}
```

- [ ] **Step 2: Create the section component (default anynote read-only row + add dialog with ping feedback)**

Create `apps/web/src/components/workspace/settings/mcp-section.tsx`:

```tsx
'use client'

import { useState } from 'react'

import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  DeleteIcon,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { SettingsCard } from './settings-card'

export function WorkspaceMcpSection({
  workspaceId,
  isOwner,
  customMcpEnabled,
}: {
  workspaceId: string
  isOwner: boolean
  customMcpEnabled: boolean
}) {
  const utils = trpc.useUtils()
  const list = trpc.mcpServer.list.useQuery({ workspaceId })
  const invalidate = () => utils.mcpServer.list.invalidate({ workspaceId })
  const update = trpc.mcpServer.update.useMutation({ onSuccess: invalidate })
  const del = trpc.mcpServer.delete.useMutation({ onSuccess: invalidate })
  const create = trpc.mcpServer.create.useMutation({ onSuccess: () => { invalidate(); setOpen(false) } })

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', url: '', transport: 'HTTP_JSONRPC' as 'HTTP_JSONRPC' | 'SSE', headersJson: '{}' })

  const submit = () => {
    let headers: Record<string, string> = {}
    try {
      headers = JSON.parse(form.headersJson || '{}') as Record<string, string>
    } catch {
      headers = {}
    }
    create.mutate({ workspaceId, name: form.name.trim(), url: form.url.trim(), transport: form.transport, headers })
  }

  return (
    <SettingsCard
      title="MCP серверы"
      description="Дополнительные инструменты для AI-агента. Сервер anynote подключён всегда. Перед добавлением выполняется проверка соединения."
    >
      {!isOwner ? <Alert severity="info">Только владелец пространства может изменять MCP серверы.</Alert> : null}

      {/* Default, always-on, read-only server */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
        <Box>
          <Typography variant="subtitle2">anynote <Chip size="small" label="по умолчанию" sx={{ ml: 1 }} /></Typography>
          <Typography variant="caption" color="text.secondary">Встроенные инструменты рабочего пространства</Typography>
        </Box>
        <Switch checked disabled />
      </Box>

      {list.data?.map((s) => (
        <Box key={s.id} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
          <Box>
            <Typography variant="subtitle2">{s.name}</Typography>
            <Typography variant="caption" color="text.secondary">{s.url} · {s.transport}</Typography>
          </Box>
          <Stack direction="row" alignItems="center">
            <Switch
              checked={s.enabled}
              disabled={!isOwner}
              onChange={(_, v) => update.mutate({ id: s.id, workspaceId, enabled: v })}
            />
            <IconButton disabled={!isOwner} onClick={() => del.mutate({ id: s.id, workspaceId })} aria-label="Удалить сервер">
              <DeleteIcon />
            </IconButton>
          </Stack>
        </Box>
      ))}

      {isOwner ? (
        <Button
          variant="outlined"
          onClick={() => { setForm({ name: '', url: '', transport: 'HTTP_JSONRPC', headersJson: '{}' }); setOpen(true) }}
          disabled={!customMcpEnabled}
          sx={{ alignSelf: 'flex-start' }}
        >
          Добавить сервер
        </Button>
      ) : null}
      {isOwner && !customMcpEnabled ? (
        <Typography variant="caption" color="text.secondary">Свои MCP серверы доступны на тарифе МАКС.</Typography>
      ) : null}

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Добавить MCP сервер</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {create.error ? <Alert severity="error">{create.error.message}</Alert> : null}
            <TextField label="Имя" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            <TextField label="URL" value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} />
            <TextField label="Транспорт" select value={form.transport} onChange={(e) => setForm((f) => ({ ...f, transport: e.target.value as 'HTTP_JSONRPC' | 'SSE' }))}>
              <MenuItem value="HTTP_JSONRPC">HTTP JSON-RPC</MenuItem>
              <MenuItem value="SSE">SSE</MenuItem>
            </TextField>
            <TextField label="Headers (JSON)" multiline minRows={3} value={form.headersJson} onChange={(e) => setForm((f) => ({ ...f, headersJson: e.target.value }))} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Отмена</Button>
          <Button variant="contained" onClick={submit} loading={create.isPending} disabled={!form.name.trim() || !form.url.trim()}>
            {create.isPending ? 'Проверка соединения…' : 'Сохранить'}
          </Button>
        </DialogActions>
      </Dialog>
    </SettingsCard>
  )
}
```

- [ ] **Step 3: Verify types/lint + manual smoke**

Run: `pnpm --filter web check-types && pnpm --filter web lint`
Then as owner open `/workspaces/<id>/settings/mcp`: the `anynote` default row shows (toggle disabled); adding a bad URL shows the error and adds nothing; a reachable MCP server is added. Non-owner sees the info alert and disabled controls.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/mcp/page.tsx" apps/web/src/components/workspace/settings/mcp-section.tsx
git commit -m "feat(web): per-workspace MCP servers settings section"
```

---

### Task 20: Nav entry + retire the global MCP page

**Files:**
- Modify: `apps/web/src/components/workspace/workspace-settings-nav.tsx`
- Modify: `apps/web/src/app/(protected)/settings/integrations/mcp/page.tsx`
- Modify (if it lists MCP): `apps/web/src/app/(protected)/settings/integrations/page.tsx`

- [ ] **Step 1: Add the workspace nav item**

In `workspace-settings-nav.tsx`, add to the `items` array after the `ai` entry:

```tsx
    { label: 'MCP серверы', slug: 'mcp', show: true },
```

- [ ] **Step 2: Redirect the old global MCP page**

Replace the contents of `apps/web/src/app/(protected)/settings/integrations/mcp/page.tsx` with a redirect to the default workspace's new section:

```tsx
import { redirect } from 'next/navigation'

import { getServerTRPC } from '@/trpc/server'

export default async function LegacyMcpRedirect() {
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getDefault()
  redirect(workspace ? `/workspaces/${workspace.id}/settings/mcp` : '/workspaces')
}
```

Delete `apps/web/src/app/(protected)/settings/integrations/mcp/AddServerDialog.tsx` (logic now lives in `mcp-section.tsx`).

- [ ] **Step 3: Remove the MCP entry from the integrations index if present**

Run: `grep -n "mcp\|MCP" "apps/web/src/app/(protected)/settings/integrations/page.tsx"`. If it renders a link/card to `integrations/mcp`, remove that entry (the feature moved to workspace settings). If nothing references it, skip.

- [ ] **Step 4: Verify + manual smoke**

Run: `pnpm --filter web check-types && pnpm --filter web lint`
Confirm the workspace settings sidebar now lists "MCP серверы" and routes to the new page; visiting `/settings/integrations/mcp` redirects to the workspace section.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/workspace/workspace-settings-nav.tsx "apps/web/src/app/(protected)/settings/integrations"
git commit -m "feat(web): workspace MCP nav entry; redirect legacy integrations/mcp page"
```

---

# Phase 5 — E2E + gates

### Task 21: E2E spec

**Files:**
- Create: `apps/e2e/workspace-ai-providers.spec.ts`

- [ ] **Step 1: Write the spec**

Create `apps/e2e/workspace-ai-providers.spec.ts`. It mocks the agents `/validation/*` calls at the network layer (agents isn't running under Playwright) so the ping succeeds deterministically, then asserts the custom provider's model appears in the default-model select. Use the `signUpAndAuthAs` helper (signs up + marks verified + signs in); the signed-up user is OWNER of their default workspace, but custom providers are plan-gated to `max` — so also flip the owner's plan/feature for the test (mirror how other plan-gated specs set up state; if a seed/helper exists for upgrading a user to `max`, use it, otherwise insert an ACTIVE subscription to the `max` plan via Prisma in the spec setup).

```ts
import { test, expect } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

test('owner adds a custom LLM provider and its model appears in the picker', async ({ page }) => {
  const { workspaceId } = await signUpAndAuthAs(page)
  // TODO(setup): ensure the owner is on a plan with customAiProvidersEnabled (max).
  // Mirror the plan-upgrade pattern used by other plan-gated e2e specs.

  // Make the agents LLM validation deterministically succeed.
  await page.route('**/validation/llm', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, error: null }) }),
  )

  await page.goto(`/workspaces/${workspaceId}/settings/ai`)
  await page.getByRole('button', { name: 'Добавить провайдера' }).click()
  await page.getByLabel('Название').fill('My OpenAI')
  await page.getByLabel('API ключ *').fill('sk-test')
  await page.getByLabel('Идентификатор модели (slug)').fill('gpt-4o')
  await page.getByLabel('Отображаемое имя').fill('My GPT-4o')
  await page.getByRole('button', { name: 'Сохранить' }).click()

  // Provider row appears
  await expect(page.getByText('My OpenAI')).toBeVisible()
  // Model is now selectable as default
  await page.getByLabel('Модель по умолчанию').click()
  await expect(page.getByRole('option', { name: /My GPT-4o/ })).toBeVisible()
})
```

> If the agents-validation route pattern (`**/validation/llm`) isn't intercepted because the call is server-side (tRPC → agents happens in the Next server, not the browser), the `page.route` mock will NOT catch it. In that case, drive validation success by pointing `AGENTS_SERVICE_URL` (in the Playwright `webServer.env` in `playwright.config.ts`) at a tiny stub, OR assert the negative path instead (bad key → error alert, no row) which needs no live agents. Pick whichever the existing e2e infra supports; document the choice in the spec.

- [ ] **Step 2: Run the spec**

Run: `pnpm exec playwright test apps/e2e/workspace-ai-providers.spec.ts`
Expected: PASS (`docker compose up -d` must be running).

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/workspace-ai-providers.spec.ts
git commit -m "test(e2e): owner adds custom AI provider; model appears in picker"
```

---

### Task 22: Full gates

- [ ] **Step 1: Run agents tests**

Run: `pnpm --filter agents test`
Expected: all pytest green (factories + validation use-cases + route registration).

- [ ] **Step 2: Run TS gates**

Run: `pnpm gates`
Expected: check-types + lint + build + test all pass across `@repo/db`, `@repo/trpc`, `web`.

- [ ] **Step 3: Fix any failures, then final commit (if gate fixes were needed)**

```bash
git add -A
git commit -m "chore: satisfy gates for workspace custom AI providers"
```

---

## Self-Review

**Spec coverage:**
- Shared models from a list — preserved (`listAvailable*` still returns shared providers). ✓
- Add own LLM with encrypted creds — Tasks 1, 3, 14, 18 (managed library, `connectionEnc`). ✓
- Same for embeddings — `supportsEmbeddings` model path + `validateEmbedding` (Tasks 9, 10, 14, 18). ✓
- 6 providers — Tasks 5–9 (ollama/openai/gigachat exist; +anthropic/deepseek/yandexgpt). ✓
- Own MCP servers by URL; default `anynote` always present; others addable — Tasks 16, 19 (default read-only row + create with ping). ✓
- Shared vs workspace scope — Task 1 (`workspaceId` nullable) + Task 13 (scoped queries). ✓
- Only owner can change LLM/embeddings/MCP — Tasks 14 (OWNER), 15 (`aiSettings.update` OWNER), 16 (already OWNER) + UI gates (Tasks 18, 19). ✓
- Ping-pong before adding (block-on-fail, transactional) — Tasks 10–12, 14, 16 (validate → on success persist in `$transaction`; throw otherwise). ✓
- Encrypted creds — reuse `encryptSecret` (Tasks 14, 17). ✓

**Placeholder scan:** YandexGPT constructor kwargs are flagged for verification against the installed package (Task 4 Step 3; Tasks 8/9 assert them) — this is an explicit verify step, not an unfilled placeholder. The E2E mock approach has a documented fallback. No `TBD`/`implement later`.

**Type consistency:** `validateLlm`/`validateEmbedding`/`validateMcp` signatures (Task 12) match their call sites (Tasks 14, 16). `resolveProviderConnection` shape (Task 17) matches the `provider` row fields added in Task 1 (`workspaceId`, `connection`, `connectionEnc`). `WorkspaceSettingsSnapshot.provider.kind` (Task 17) matches the wire field `provider` consumed by `apps/agents` `ModelProviderEnum` (lowercased in the route). `customAiProvidersEnabled` is added to the Prisma `Plan` (Task 1), `PlanFeatures` (Task 13), seed (Task 2), and consumed in Tasks 14/18. `AiProviderKind` enum values match `kindSchema` (Task 14) and `KINDS` (Task 18).
