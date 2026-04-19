# Pillar A — DB Foundation Design

**Date:** 2026-04-19
**Author:** brainstormed with Claude
**Status:** Draft → pending user review

## Context

AnyNote is pivoting from a markdown workspace with a rudimentary "поиск" (search-chat)
surface into a full AI knowledge workspace. The bigger roadmap has 8 subsystems (see
`агент.md` / session context). This spec scopes only **Pillar A — the DB Foundation**
that every downstream pillar (apps/agents, apps/engines, packages/chat, workspace AI
settings UI, indexing pipeline) will depend on.

Pillar A is intentionally DB-only. No Python, no Next.js UI, no MCP server, no
workers — just a Prisma schema change, a seed update, and the fixups required to
keep the existing monorepo green.

## Goals

1. Rename `SearchChat`/`SearchMessage` to `Chat`/`ChatMessage` (model + table + relations
   + enum) so the domain language matches the new "AI chat" product.
2. Introduce `ChatMessageFile` join table so chat messages can carry attachments,
   reusing the existing `PageFile` pattern.
3. Introduce a pre-seeded catalog of AI providers and models (`AiProvider`,
   `AiModel`) — extensible without further migrations.
4. Introduce `Page.ownership` classification (`TEXT`/`SKILL`/`AGENT`) so downstream
   pillars can tell ordinary pages apart from AI skill/agent pages.
5. Keep the repo green: `check-types`, `lint`, `build`, Playwright e2e — all pass
   after the change.

## Non-Goals

- `WorkspaceAiSettings` (per-workspace chosen model, credentials, temperature,
  system-prompt page) — belongs to **Pillar F** (workspace AI settings UI).
- Indexing metadata on `Page` (`lastContentEditedAt`, `indexVersion`,
  `lastIndexedAt`, `lastIndexError`, `indexStatus`) — belongs to **Pillar D**
  (indexing + transactional outbox).
- `transactional_outbox` table and the 10-minute debounce worker — **Pillar D**.
- AI usage/quota tracking and per-token pricing fields — separate future pillar.
- No UI work of any kind. The workspace settings page remains unchanged.
- No new apps (`apps/agents`, `apps/engines`) and no new packages
  (`packages/chat`).
- No removal of `@@map("chats")` / `@@map("chat_messages")` once set — renaming
  back would break migrations.

## Data State Assumptions

- The repo has **no remote** (`git remote` is empty) and the database is
  strictly local development. No production data to preserve.
- Existing `search_chats` / `search_messages` data is disposable — we will run
  `prisma db push --force-reset` + reseed as the "migration".
- `Plan` rows (`free` / `personal` / `corporate`) are created by
  `packages/db/prisma/seed.ts` and are authoritative references for
  `AiModel.minPlanSlug`.

## Schema Changes

### 1. Renames

| Before              | After                  |
|---------------------|------------------------|
| `model SearchChat`  | `model Chat`           |
| `@@map("search_chats")`   | `@@map("chats")`           |
| `model SearchMessage` | `model ChatMessage`   |
| `@@map("search_messages")` | `@@map("chat_messages")` |
| `enum SearchMessageRole` | `enum ChatMessageRole` (values `USER`, `ASSISTANT` unchanged) |
| `User.searchChats`  | `User.chats`           |
| `Workspace.searchChats` | `Workspace.chats`  |
| relation `"SearchChatCreator"` | relation `"ChatCreator"` |
| relation `"ChatTree"` (self-ref) | preserved as-is |
| `SearchChat.title` default `"Новый поиск"` | `Chat.title` default `"Новый чат"` |
| `SearchMessage.sources Json @default("[]")` | `ChatMessage.sources Json @default("[]")` (preserved) |

All other fields (`id`, `workspaceId`, `parentId`, `createdById`, timestamps) are
preserved 1:1.

### 2. `ChatMessageFile` (new)

```prisma
model ChatMessageFile {
  messageId String      @db.Uuid
  fileId    String      @db.Uuid
  createdAt DateTime    @default(now())
  message   ChatMessage @relation(fields: [messageId], references: [id], onDelete: Cascade)
  file      File        @relation(fields: [fileId], references: [id], onDelete: Cascade)

  @@id([messageId, fileId])
  @@map("chat_message_files")
}
```

- Follows the `PageFile` shape exactly (composite PK, cascade on parent delete).
- `createdAt` is included so the UI can render attachments in insertion order
  if a message has several files.
- `ChatMessage` gets `files ChatMessageFile[]`; `File` gets
  `chatMessageFiles ChatMessageFile[]`.

### 3. AI catalog — `AiProvider` and `AiModel` (new)

```prisma
model AiProvider {
  id                 String     @id @default(dbgenerated("uuidv7()")) @db.Uuid
  slug               String     @unique            // "ollama" | "openai" | "gigachat" | future slugs
  name               String
  defaultBaseUrl     String?
  credentialsSchema  Json       @default("{}")
  docsUrl            String?
  supportsStreaming  Boolean    @default(true)
  supportsTools      Boolean    @default(false)
  isActive           Boolean    @default(true)
  createdAt          DateTime   @default(now())
  updatedAt          DateTime   @updatedAt
  models             AiModel[]

  @@map("ai_providers")
}

model AiModel {
  id                      String      @id @default(dbgenerated("uuidv7()")) @db.Uuid
  providerId              String      @db.Uuid
  slug                    String                             // "gpt-4o" | "gemma4" | "GigaChat-Pro"
  displayName             String
  contextTokens           Int                                // capability, not quota
  maxOutputTokens         Int
  supportsVision          Boolean     @default(false)
  supportsFunctionCalling Boolean     @default(false)
  minPlanSlug             String?                            // soft FK → Plan.slug; null = any plan
  defaultTemperature      Float?
  isActive                Boolean     @default(true)
  deprecatedAt            DateTime?
  createdAt               DateTime    @default(now())
  updatedAt               DateTime    @updatedAt
  provider                AiProvider  @relation(fields: [providerId], references: [id], onDelete: Cascade)

  @@unique([providerId, slug])
  @@map("ai_models")
}
```

**Why no `enum AiProviderSlug`:** enums lock the catalog. Keeping `slug` as a unique
string lets admins add new LangChain-compatible providers (Anthropic, Mistral,
custom OpenAI-compatible endpoints) by inserting rows — no migration needed.

**Why `minPlanSlug` is a soft FK (string) and not a real FK to `Plan`:** the `Plan`
table is seeded separately and the admin may want to reference a future plan slug
that does not yet exist at the time a model is inserted. A string column keeps the
catalog flexible and matches the existing "soft plan gating" pattern elsewhere in
the app.

**Credential shape expressed in `credentialsSchema`:** JSON-schema-ish description
of which fields a workspace must provide (consumed by Pillar F UI later). E.g.:

```json
// openai
{
  "fields": [
    { "key": "api_key", "label": "API key", "type": "secret", "required": true },
    { "key": "organization", "label": "Organization", "type": "string", "required": false }
  ]
}

// gigachat — shape to be verified against GigaChat docs via context7 MCP at implementation time
{
  "fields": [
    { "key": "client_id", "label": "Client ID", "type": "string", "required": true },
    { "key": "client_secret", "label": "Client Secret", "type": "secret", "required": true },
    { "key": "scope", "label": "Scope", "type": "string", "required": true, "default": "GIGACHAT_API_PERS" }
  ]
}

// ollama — no secret needed; workspace may override base_url
{
  "fields": [
    { "key": "base_url", "label": "Base URL", "type": "string", "required": false }
  ]
}
```

The exact shape of `credentialsSchema` is consumed only by the future settings UI;
Pillar A just stores and seeds it. It does NOT need to be validated against a
formal schema in this pillar.

### 4. `Page.ownership`

```prisma
enum PageOwnership {
  TEXT
  SKILL
  AGENT
}

model Page {
  // ...existing fields preserved...
  ownership  PageOwnership  @default(TEXT)

  @@index([workspaceId, ownership])
}
```

- `TEXT` — default, the page is a regular document.
- `SKILL` — page body is an AI skill definition (markdown becomes skill prompt).
- `AGENT` — page body is an AI agent definition.

The classification is orthogonal to `PageType` (which controls the rendering
canvas: `TEXT` / `EXCALIDRAW` / `DATABASE` / `KANBAN` / `FORM`). Pairing
`PageType=TEXT` with `PageOwnership=SKILL` is valid and expected.

The `@@index([workspaceId, ownership])` makes "list all skill pages in workspace"
queries cheap — Pillar F and Pillar E rely on that pattern.

## Seed Data

### `AiProvider` — 3 rows

| slug       | name            | defaultBaseUrl                                    | supportsStreaming | supportsTools | docsUrl                                   |
|------------|-----------------|---------------------------------------------------|-------------------|---------------|-------------------------------------------|
| `ollama`   | Ollama          | value of `process.env.OLLAMA_BASE_URL`            | true              | true          | `https://github.com/ollama/ollama`        |
| `openai`   | OpenAI ChatGPT  | `https://api.openai.com/v1`                       | true              | true          | `https://platform.openai.com/docs`        |
| `gigachat` | GigaChat        | `https://gigachat.devices.sberbank.ru/api/v1`     | true              | true          | resolved via context7 MCP at impl time    |

`credentialsSchema` per provider per the shapes above.

### `AiModel` — stable starter catalog

| provider  | slug           | displayName         | contextTokens | maxOutputTokens | supportsVision | supportsFunctionCalling | minPlanSlug  |
|-----------|----------------|---------------------|--------------:|----------------:|---------------:|------------------------:|--------------|
| ollama    | `gemma4`       | Gemma 4 (Ollama)    | 8192          | 4096            | false          | false                   | `null`       |
| openai    | `gpt-4o-mini`  | GPT-4o mini         | 128000        | 16384           | true           | true                    | `personal`   |
| openai    | `gpt-4o`       | GPT-4o              | 128000        | 16384           | true           | true                    | `personal`   |
| gigachat  | `GigaChat`     | GigaChat            | 32000         | 8000            | false          | true                    | `personal`   |
| gigachat  | `GigaChat-Pro` | GigaChat Pro        | 32000         | 8000            | false          | true                    | `personal`   |
| gigachat  | `GigaChat-Max` | GigaChat Max        | 131072        | 8000            | true           | true                    | `corporate`  |

Exact GigaChat context/output numbers are subject to current GigaChat docs
(resolved via context7 MCP at implementation). The values above are the
**fallback** if docs are unreachable.

The seed is **idempotent via `prisma.aiProvider.upsert(...)` on slug and
`prisma.aiModel.upsert(...)` on `(providerId, slug)` compound key**, matching
the existing `IntegrationProvider` seed pattern.

## Downstream Code Impact

All identifiers renamed in schema must be renamed in callers. Expected touch
points (to be confirmed by `rg`-pass at implementation time):

- `packages/trpc/src/**` — any procedure referencing `prisma.searchChat` /
  `prisma.searchMessage` / the `SearchMessageRole` type.
- `apps/web/src/**` — UI components and hooks that type against
  `SearchMessageRole` or call `trpc.searchChat.*`.
- `packages/db/src/index.ts` — client export, unchanged identifier (`prisma`).
- `packages/db/prisma/seed.ts` — extended with `AiProvider` + `AiModel` seeds.
- `apps/e2e/**` — any spec referencing "поиск" / "search-chat" in copy or data
  attributes; rename in lock-step.

If any of these callers are not found, the rename is considered complete.

## Migration / Reset Procedure

Pillar A uses `prisma db push --force-reset` rather than a migration history,
because:

1. Prisma does not auto-detect model/table renames — it generates a DROP+CREATE.
2. We have no production data to preserve (no remote, dev-only).
3. The repo already uses `pnpm --filter @repo/db prisma:db-push` as the dev
   flow per `CLAUDE.md`.

Sequence:

```bash
docker compose up -d                                    # ensure postgres is up
pnpm --filter @repo/db exec prisma db push --force-reset
pnpm --filter @repo/db exec prisma db seed
```

## Verification Plan

1. `pnpm --filter @repo/db prisma:generate` — Prisma client compiles.
2. `pnpm --filter @repo/db exec prisma db push --force-reset` — schema applies cleanly.
3. `pnpm --filter @repo/db exec prisma db seed` — inserts 3 `AiProvider` rows and
   6 `AiModel` rows; no conflicts on re-run.
4. Manual verify (via `psql`) — tables `chats`, `chat_messages`,
   `chat_message_files`, `ai_providers`, `ai_models` exist; column
   `pages.ownership` exists with default `TEXT`.
5. `pnpm check-types` — zero errors across workspace.
6. `pnpm lint` — zero warnings (`--max-warnings 0`).
7. `pnpm build` — Next.js production build succeeds.
8. `pnpm exec playwright test` — existing e2e suite green (assumes yjs server
   is up per CLAUDE.md).
9. Spot-check via a throwaway tRPC query that `prisma.chat.findMany`,
   `prisma.chatMessage.findMany`, `prisma.aiModel.findMany` return the expected
   shapes.

## Risks

- **Renamed relation names are hard to notice when missed.** If `@relation("SearchChatCreator")` is left dangling on `User` after the rename,
  Prisma's diagnostic is unhelpful ("Relation field ... has no opposite"). Mitigation:
  `prisma validate` + `pnpm check-types` in CI-like local loop before committing.
- **`sources Json @default("[]")`** — Prisma v7 enforces the adapter-pg codec. Keep the default as a string literal `"[]"` (not `'[]'::jsonb`) — the client renders it correctly.
- **GigaChat credential schema drift** — GigaChat has evolved its auth flow multiple
  times. `credentialsSchema` is JSON, so correcting it later is an in-place
  update in the seed; no migration needed.
- **Downstream consumers missed at rename.** Mitigated by `check-types` running
  across all workspace packages via Turbo (`pnpm check-types`).

## Out-of-scope Follow-ups

These are consequences of Pillar A decisions that become relevant in later
pillars — recorded here so they are not forgotten:

- Pillar F must build UI against `AiProvider.credentialsSchema` (JSON-schema-ish
  renderer).
- Pillar F's `WorkspaceAiSettings` table will have an FK to `AiModel` and JSON
  credentials scoped to the workspace.
- Pillar D must add `Page.indexStatus` / `lastContentEditedAt` /
  `lastIndexedAt` / `indexVersion` / `lastIndexError` + a `transactional_outbox`
  table.
- Pillar E (`apps/engines` MCP) will rely on `Page.ownership` to return
  filtered lists of skills / agents per workspace.
