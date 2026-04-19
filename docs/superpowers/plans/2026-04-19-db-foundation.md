# DB Foundation (Pillar A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename `SearchChat`/`SearchMessage` → `Chat`/`ChatMessage`, add `ChatMessageFile`, introduce the `AiProvider` + `AiModel` catalog with seed data, and add `Page.ownership` — with call-site updates and a green `check-types` / `lint` / `build` / Playwright e2e.

**Architecture:** One monolithic Prisma schema edit (renames + new models + `Page.ownership`) followed by four narrow call-site commits: `@repo/db` re-exports, tRPC router rename, `apps/web` consumers, and the seed extension. Database state is reset via `prisma db push --force-reset` + `prisma db seed` — no migration history carried forward. We intentionally approximate TDD with `pnpm check-types` (the compiler is our test oracle for rename correctness) + `prisma validate` + seed verification queries — `packages/db` has no vitest harness and adding one is out of scope.

**Tech Stack:** Prisma v7 + `@prisma/adapter-pg`, TypeScript 5.9, Turborepo 2, pnpm 9, Next.js 16, tRPC 11, PostgreSQL (via docker compose).

**Reference spec:** [`docs/superpowers/specs/2026-04-19-db-foundation-design.md`](../specs/2026-04-19-db-foundation-design.md)

---

## File Structure

**Modified files (in task order):**

| Path | Responsibility | Touched by |
|------|----------------|-----------|
| `packages/db/prisma/schema.prisma` | Source of truth for models, enums, relations, `@@map` | Task 1 |
| `packages/db/src/index.ts` | Explicit re-exports of Prisma client symbols consumed by the rest of the workspace | Task 2 |
| `packages/trpc/src/routers/search.ts` → `chat.ts` | tRPC procedures formerly operating on `SearchChat`/`SearchMessage` | Task 3 |
| `packages/trpc/src/index.ts` | Root router registration | Task 3 |
| `apps/web/src/app/(protected)/workspaces/[workspaceId]/search/[chatId]/page.tsx` | Server component calling `trpc.search.getChat` | Task 4 |
| `apps/web/src/components/workspace/search/search-chat-view.tsx` | Client view using `trpc.search.*` and `SearchMessageRole` | Task 4 |
| `apps/web/src/components/workspace/search/search-chat-input.tsx` | Client input using `trpc.search.*` | Task 4 |
| `packages/db/prisma/seed.ts` | Seed `AiProvider` + `AiModel` rows | Task 5 |

**Intentionally NOT touched (scope):**

- `apps/web/src/app/(protected)/workspaces/[workspaceId]/search/**` folder name and URL — Pillar F will re-architect the UI around a new chat surface.
- Component file names (`search-chat-view.tsx`) and React identifiers (`SearchChatView`, `SearchChatInput`) — cosmetic, high-churn, Pillar F.
- `packages/db/prisma/migrations/20260411211823_*/migration.sql` — legacy, unused by `db push`. Do not delete.
- `compose.yml`, `.env`, `turbo.json` — already at their target state per prior session.

---

## Task 0: Baseline checkpoint

Verify the repo is green BEFORE any changes so later failures are clearly caused by the plan.

**Files:** none modified.

- [ ] **Step 0.1: Ensure docker compose services are healthy**

```bash
docker compose ps
```

Expected: `postgres`, `minio`, `minio-init`, `qdrant`, `ollama`, `redis` are all `running` / `healthy`. If any are missing:

```bash
docker compose up -d
docker compose ps
```

If the `postgres-init` script does not exist yet (per prior session memory), postgres may fail to create the `agents` database — Pillar A doesn't need that DB, but verify the main `anynote` DB is reachable:

```bash
docker compose exec -T postgres psql -U user -d anynote -c "select 1;"
```

Expected: `(1 row)` output.

- [ ] **Step 0.2: Install + generate**

```bash
pnpm install --frozen-lockfile
pnpm --filter @repo/db prisma:generate
```

Expected: both succeed.

- [ ] **Step 0.3: Baseline `check-types`, `lint`, `build`**

```bash
pnpm check-types
pnpm lint
pnpm build
```

Expected: all green. If any fails on `main`, STOP — that is a pre-existing regression, not a pillar A concern. Escalate to the user.

- [ ] **Step 0.4: No commit in this task.**

---

## Task 1: Schema edit — renames + new models + Page.ownership

Apply every schema change in one edit. After this step the workspace will NOT type-check until Tasks 2–4 update the callers — that is expected.

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1.1: Rename `SearchChat` model**

Open `packages/db/prisma/schema.prisma`. Find the `model SearchChat { ... }` block.

Change the declaration line:
```prisma
model SearchChat {
```
to:
```prisma
model Chat {
```

Change inside the same block:
- `@@map("search_chats")` → `@@map("chats")`
- `title String @default("Новый поиск")` → `title String @default("Новый чат")`
- `createdBy User @relation("SearchChatCreator", fields: [createdById], references: [id], onDelete: Restrict)` → `createdBy User @relation("ChatCreator", fields: [createdById], references: [id], onDelete: Restrict)`
- `messages SearchMessage[]` → `messages ChatMessage[]`
- `parent SearchChat? @relation("ChatTree", fields: [parentId], references: [id], onDelete: Cascade)` → `parent Chat? @relation("ChatTree", fields: [parentId], references: [id], onDelete: Cascade)`
- `children SearchChat[] @relation("ChatTree")` → `children Chat[] @relation("ChatTree")`

Leave every other field (`id`, `workspaceId`, `parentId`, `createdById`, timestamps) unchanged.

- [ ] **Step 1.2: Rename `SearchMessage` model and `SearchMessageRole` enum**

In the same file:
- `enum SearchMessageRole {` → `enum ChatMessageRole {` (values `USER`, `ASSISTANT` remain unchanged)
- `model SearchMessage {` → `model ChatMessage {`
- `@@map("search_messages")` → `@@map("chat_messages")`
- `role SearchMessageRole` → `role ChatMessageRole`
- `chat SearchChat @relation(fields: [chatId], references: [id], onDelete: Cascade)` → `chat Chat @relation(fields: [chatId], references: [id], onDelete: Cascade)`

Preserve `sources Json @default("[]")` exactly as-is.

- [ ] **Step 1.3: Update `User` model relation**

In `model User { ... }`, find:
```prisma
searchChats SearchChat[] @relation("SearchChatCreator")
```

Replace with:
```prisma
chats Chat[] @relation("ChatCreator")
```

- [ ] **Step 1.4: Update `Workspace` model relation**

In `model Workspace { ... }`, find:
```prisma
searchChats SearchChat[]
```

Replace with:
```prisma
chats Chat[]
```

- [ ] **Step 1.5: Add `ChatMessageFile` join model**

Append immediately after the `ChatMessage` model (the one you just renamed):

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

- [ ] **Step 1.6: Add reverse relations**

Inside `model ChatMessage { ... }`, append (next to `chat` relation):
```prisma
files ChatMessageFile[]
```

Inside `model File { ... }` (find the block with `pageFiles PageFile[]`), add:
```prisma
chatMessageFiles ChatMessageFile[]
```

- [ ] **Step 1.7: Add `PageOwnership` enum**

Near the other enums (close to `PageType`), add:

```prisma
enum PageOwnership {
  TEXT
  SKILL
  AGENT
}
```

- [ ] **Step 1.8: Add `Page.ownership` field and index**

Inside `model Page { ... }`, add this field (place it next to `type PageType`):

```prisma
ownership PageOwnership @default(TEXT)
```

And add an index line near existing `@@index(...)` declarations in the same model:

```prisma
@@index([workspaceId, ownership])
```

- [ ] **Step 1.9: Add `AiProvider` model**

Append after the existing `IntegrationProvider` / `Integration` block (they are structural siblings — providers + configured instances):

```prisma
model AiProvider {
  id                String    @id @default(dbgenerated("uuidv7()")) @db.Uuid
  slug              String    @unique
  name              String
  defaultBaseUrl    String?
  credentialsSchema Json      @default("{}")
  docsUrl           String?
  supportsStreaming Boolean   @default(true)
  supportsTools     Boolean   @default(false)
  isActive          Boolean   @default(true)
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  models            AiModel[]

  @@map("ai_providers")
}
```

- [ ] **Step 1.10: Add `AiModel` model**

Append directly after `AiProvider`:

```prisma
model AiModel {
  id                      String     @id @default(dbgenerated("uuidv7()")) @db.Uuid
  providerId              String     @db.Uuid
  slug                    String
  displayName             String
  contextTokens           Int
  maxOutputTokens         Int
  supportsVision          Boolean    @default(false)
  supportsFunctionCalling Boolean    @default(false)
  minPlanSlug             String?
  defaultTemperature      Float?
  isActive                Boolean    @default(true)
  deprecatedAt            DateTime?
  createdAt               DateTime   @default(now())
  updatedAt               DateTime   @updatedAt
  provider                AiProvider @relation(fields: [providerId], references: [id], onDelete: Cascade)

  @@unique([providerId, slug])
  @@map("ai_models")
}
```

- [ ] **Step 1.11: Format and validate**

```bash
pnpm --filter @repo/db exec prisma format
pnpm --filter @repo/db exec prisma validate
```

Expected: `prisma format` writes the file, `prisma validate` prints "The schema is valid" with no errors.

Common failure mode: if you mis-paired a relation rename (e.g., renamed `SearchChatCreator` on `Chat` but forgot on `User.chats`), `validate` will say *Relation field `chats` references `ChatCreator` which is not defined*. Re-check Steps 1.1 and 1.3.

- [ ] **Step 1.12: Generate client**

```bash
pnpm --filter @repo/db prisma:generate
```

Expected: Prisma client regenerates. `node_modules/@prisma/client` now exposes `Chat`, `ChatMessage`, `ChatMessageFile`, `ChatMessageRole`, `AiProvider`, `AiModel`, `PageOwnership`.

- [ ] **Step 1.13: Reset and push**

```bash
pnpm --filter @repo/db exec prisma db push --force-reset --accept-data-loss
```

Expected: "The database is now in sync with your Prisma schema." All legacy `search_chats` / `search_messages` data is gone; new `chats`, `chat_messages`, `chat_message_files`, `ai_providers`, `ai_models` tables are empty; `pages.ownership` column exists with default `TEXT`.

- [ ] **Step 1.14: Do NOT commit yet.**

`pnpm check-types` will fail because `@repo/db` re-exports still name `SearchChat`/`SearchMessage`/`SearchMessageRole`, and downstream packages import those. Fixed in Tasks 2–4.

---

## Task 2: Update `@repo/db` re-exports

**Files:**
- Modify: `packages/db/src/index.ts`

- [ ] **Step 2.1: Swap enum re-export**

Open `packages/db/src/index.ts`. Replace the enum re-export block:

```ts
export {
  RoleType,
  PageType,
  IntegrationScope,
  IntegrationStatus,
  SubscriptionStatus,
  SearchMessageRole,
  FileStatus,
} from "@prisma/client"
```

with:

```ts
export {
  RoleType,
  PageType,
  PageOwnership,
  IntegrationScope,
  IntegrationStatus,
  SubscriptionStatus,
  ChatMessageRole,
  FileStatus,
} from "@prisma/client"
```

- [ ] **Step 2.2: Swap type re-export**

In the `export type { ... } from "@prisma/client"` block:
- Remove `SearchChat,`
- Remove `SearchMessage,`
- Add `Chat,`
- Add `ChatMessage,`
- Add `ChatMessageFile,`
- Add `AiProvider,`
- Add `AiModel,`

Keep every other type in that block as-is (`User`, `Account`, `Session`, `Verification`, `Jwks`, `Workspace`, `WorkspaceMember`, `Page`, `UserPreference`, `IntegrationProvider`, `Integration`, `Plan`, `Subscription`, `FavoritePage`, `File`, `PageFile`).

Final block should include (alphabetical sort optional, keep author's style):

```ts
export type {
  User,
  Account,
  Session,
  Verification,
  Jwks,
  Workspace,
  WorkspaceMember,
  Page,
  UserPreference,
  IntegrationProvider,
  Integration,
  Plan,
  Subscription,
  Chat,
  ChatMessage,
  ChatMessageFile,
  AiProvider,
  AiModel,
  FavoritePage,
  File,
  PageFile,
} from "@prisma/client"
```

- [ ] **Step 2.3: Type-check the package**

```bash
pnpm --filter @repo/db check-types
```

Expected: 0 errors.

- [ ] **Step 2.4: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/src/index.ts
git commit -m "$(cat <<'EOF'
feat(db): rename SearchChat→Chat, SearchMessage→ChatMessage

Schema-only Pillar A step: rename models/tables/relations/enum; add
ChatMessageFile join; add PageOwnership enum + Page.ownership; add
AiProvider + AiModel catalog. Re-exports in @repo/db swapped.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

(The schema and the re-export ride together so the next task sees a consistent `@repo/db` public surface.)

---

## Task 3: Rename tRPC router `search` → `chat`

**Files:**
- Rename: `packages/trpc/src/routers/search.ts` → `packages/trpc/src/routers/chat.ts`
- Modify: `packages/trpc/src/index.ts`

- [ ] **Step 3.1: Rename the file**

```bash
git mv packages/trpc/src/routers/search.ts packages/trpc/src/routers/chat.ts
```

- [ ] **Step 3.2: Rename identifiers inside `chat.ts`**

Open `packages/trpc/src/routers/chat.ts` and apply these find-and-replace operations to the whole file:

| Find | Replace |
|------|---------|
| `searchRouter` | `chatRouter` |
| `prisma.searchChat.` | `prisma.chat.` |
| `prisma.searchMessage.` | `prisma.chatMessage.` |
| `SearchMessageRole` | `ChatMessageRole` |
| `SearchChat` (type reference, if any) | `Chat` |
| `SearchMessage` (type reference, if any) | `ChatMessage` |

The `renameChat` mutation that was added to this router (per session memory) stays by the same name — it was already called `renameChat`, the rename of the surrounding model does not affect its procedure name.

- [ ] **Step 3.3: Verify no old identifiers remain**

```bash
grep -E "searchChat|searchMessage|SearchMessageRole|SearchChat|SearchMessage" packages/trpc/src/routers/chat.ts
```

Expected: no output (exit code 1).

- [ ] **Step 3.4: Update root router registration**

Open `packages/trpc/src/index.ts`. Apply these changes:

```ts
import { searchRouter } from "./routers/search"
```
→
```ts
import { chatRouter } from "./routers/chat"
```

And in the `appRouter` literal:
```ts
search: searchRouter,
```
→
```ts
chat: chatRouter,
```

Leave every other import and every other router registration untouched.

- [ ] **Step 3.5: Type-check the package**

```bash
pnpm --filter @repo/trpc check-types
```

Expected: 0 errors.

- [ ] **Step 3.6: Commit**

```bash
git add packages/trpc/src/routers/chat.ts packages/trpc/src/index.ts
git commit -m "$(cat <<'EOF'
refactor(trpc): rename searchRouter → chatRouter

File moved routers/search.ts → routers/chat.ts. prisma.searchChat →
prisma.chat, prisma.searchMessage → prisma.chatMessage. appRouter key
search → chat. SearchMessageRole → ChatMessageRole imports updated.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Update `apps/web` callers

**Files:**
- Modify: `apps/web/src/app/(protected)/workspaces/[workspaceId]/search/[chatId]/page.tsx`
- Modify: `apps/web/src/components/workspace/search/search-chat-view.tsx`
- Modify: `apps/web/src/components/workspace/search/search-chat-input.tsx`

Component identifiers (`SearchChatView`, `SearchChatInput`), file names, and the `search/` URL folder STAY — renaming them is out of scope for Pillar A.

- [ ] **Step 4.1: Find all callers**

```bash
grep -rn "trpc\.search\|searchRouter\|SearchMessageRole\|SearchChat[^a-zA-Z]\|SearchMessage[^a-zA-Z]" apps/web/src
```

Expected: the three target files above. If additional files appear (sidebar entries, menu items), add them to this task and apply the same transforms — do NOT skip any.

- [ ] **Step 4.2: Fix the route page**

In `apps/web/src/app/(protected)/workspaces/[workspaceId]/search/[chatId]/page.tsx`, replace the single occurrence:

```ts
await trpc.search.getChat({ chatId })
```
→
```ts
await trpc.chat.getChat({ chatId })
```

- [ ] **Step 4.3: Fix `search-chat-view.tsx`**

In `apps/web/src/components/workspace/search/search-chat-view.tsx`, apply to the whole file:

| Find | Replace |
|------|---------|
| `trpc.search.` | `trpc.chat.` |
| `SearchMessageRole` | `ChatMessageRole` |
| `SearchMessage` (type ref, if present) | `ChatMessage` |
| `SearchChat` (type ref, if present) | `Chat` |

Import lines update automatically when `SearchMessageRole` is renamed to `ChatMessageRole` (since both re-export from `@repo/db`).

Component identifier `SearchChatView` stays.

- [ ] **Step 4.4: Fix `search-chat-input.tsx`**

Apply the same four find-and-replace transforms as Step 4.3 to `apps/web/src/components/workspace/search/search-chat-input.tsx`. Component identifier `SearchChatInput` stays.

- [ ] **Step 4.5: Type-check the app**

```bash
pnpm --filter web check-types
```

Expected: 0 errors. If an error surfaces in a file NOT listed above, return to Step 4.1, widen the grep (e.g. remove the `[^a-zA-Z]` guards), and fix those files with the same transforms.

- [ ] **Step 4.6: Type-check the whole workspace**

```bash
pnpm check-types
```

Expected: 0 errors across all Turbo tasks.

- [ ] **Step 4.7: Commit**

```bash
git add apps/web/src
git commit -m "$(cat <<'EOF'
refactor(web): switch search chat callers to trpc.chat.*

Route page, SearchChatView, and SearchChatInput now import
ChatMessageRole and call trpc.chat.* instead of trpc.search.*. File
and folder names stay (Pillar F will rename the UI surface).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Seed — AI providers and models

**Files:**
- Modify: `packages/db/prisma/seed.ts`

- [ ] **Step 5.1: Inspect existing seed structure**

```bash
head -80 packages/db/prisma/seed.ts
```

Confirm the file already uses `prisma.integrationProvider.upsert({ where: { slug: ... } })` and `prisma.plan.upsert(...)`. The new AI seed blocks follow the same idempotent upsert pattern.

- [ ] **Step 5.2: Ensure `Prisma` namespace is imported**

Open `packages/db/prisma/seed.ts`. If the existing import line is:

```ts
import { PrismaClient } from "@prisma/client"
```

change it to:

```ts
import { PrismaClient, Prisma } from "@prisma/client"
```

If `Prisma` is already imported, skip this step.

- [ ] **Step 5.3: Append AI provider seed block**

After the existing `plans` upsert loop and before any final `await prisma.$disconnect()` call, insert:

```ts
const aiProviders = [
  {
    slug: "ollama",
    name: "Ollama",
    defaultBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
    credentialsSchema: {
      fields: [
        { key: "base_url", label: "Base URL", type: "string", required: false },
      ],
    } satisfies Prisma.InputJsonValue,
    docsUrl: "https://github.com/ollama/ollama",
    supportsStreaming: true,
    supportsTools: true,
  },
  {
    slug: "openai",
    name: "OpenAI ChatGPT",
    defaultBaseUrl: "https://api.openai.com/v1",
    credentialsSchema: {
      fields: [
        { key: "api_key", label: "API key", type: "secret", required: true },
        { key: "organization", label: "Organization", type: "string", required: false },
      ],
    } satisfies Prisma.InputJsonValue,
    docsUrl: "https://platform.openai.com/docs",
    supportsStreaming: true,
    supportsTools: true,
  },
  {
    slug: "gigachat",
    name: "GigaChat",
    defaultBaseUrl: "https://gigachat.devices.sberbank.ru/api/v1",
    credentialsSchema: {
      fields: [
        { key: "client_id", label: "Client ID", type: "string", required: true },
        { key: "client_secret", label: "Client Secret", type: "secret", required: true },
        { key: "scope", label: "Scope", type: "string", required: true, default: "GIGACHAT_API_PERS" },
      ],
    } satisfies Prisma.InputJsonValue,
    docsUrl: "https://developers.sber.ru/docs/ru/gigachat/api/overview",
    supportsStreaming: true,
    supportsTools: true,
  },
] as const

const providerRows = await Promise.all(
  aiProviders.map((p) =>
    prisma.aiProvider.upsert({
      where: { slug: p.slug },
      update: {
        name: p.name,
        defaultBaseUrl: p.defaultBaseUrl,
        credentialsSchema: p.credentialsSchema,
        docsUrl: p.docsUrl,
        supportsStreaming: p.supportsStreaming,
        supportsTools: p.supportsTools,
        isActive: true,
      },
      create: { ...p, isActive: true },
    }),
  ),
)

const providerBySlug = new Map(providerRows.map((r) => [r.slug, r]))
```

**GigaChat docs caveat:** the credential field names and scopes above are a best-guess fallback. At implementation time, run a context7 MCP lookup for the current GigaChat REST API auth shape and adjust the `credentialsSchema` entries before committing. The rest of the schema does not change; only the JSON `credentialsSchema` value.

- [ ] **Step 5.4: Append AI model seed block**

Directly after the provider block above:

```ts
const aiModels = [
  {
    providerSlug: "ollama",
    slug: "gemma4",
    displayName: "Gemma 4 (Ollama)",
    contextTokens: 8192,
    maxOutputTokens: 4096,
    supportsVision: false,
    supportsFunctionCalling: false,
    minPlanSlug: null,
  },
  {
    providerSlug: "openai",
    slug: "gpt-4o-mini",
    displayName: "GPT-4o mini",
    contextTokens: 128000,
    maxOutputTokens: 16384,
    supportsVision: true,
    supportsFunctionCalling: true,
    minPlanSlug: "personal",
  },
  {
    providerSlug: "openai",
    slug: "gpt-4o",
    displayName: "GPT-4o",
    contextTokens: 128000,
    maxOutputTokens: 16384,
    supportsVision: true,
    supportsFunctionCalling: true,
    minPlanSlug: "personal",
  },
  {
    providerSlug: "gigachat",
    slug: "GigaChat",
    displayName: "GigaChat",
    contextTokens: 32000,
    maxOutputTokens: 8000,
    supportsVision: false,
    supportsFunctionCalling: true,
    minPlanSlug: "personal",
  },
  {
    providerSlug: "gigachat",
    slug: "GigaChat-Pro",
    displayName: "GigaChat Pro",
    contextTokens: 32000,
    maxOutputTokens: 8000,
    supportsVision: false,
    supportsFunctionCalling: true,
    minPlanSlug: "personal",
  },
  {
    providerSlug: "gigachat",
    slug: "GigaChat-Max",
    displayName: "GigaChat Max",
    contextTokens: 131072,
    maxOutputTokens: 8000,
    supportsVision: true,
    supportsFunctionCalling: true,
    minPlanSlug: "corporate",
  },
] as const

for (const m of aiModels) {
  const provider = providerBySlug.get(m.providerSlug)
  if (!provider) throw new Error(`Seed: unknown AI provider slug ${m.providerSlug}`)
  await prisma.aiModel.upsert({
    where: { providerId_slug: { providerId: provider.id, slug: m.slug } },
    update: {
      displayName: m.displayName,
      contextTokens: m.contextTokens,
      maxOutputTokens: m.maxOutputTokens,
      supportsVision: m.supportsVision,
      supportsFunctionCalling: m.supportsFunctionCalling,
      minPlanSlug: m.minPlanSlug,
      isActive: true,
    },
    create: {
      providerId: provider.id,
      slug: m.slug,
      displayName: m.displayName,
      contextTokens: m.contextTokens,
      maxOutputTokens: m.maxOutputTokens,
      supportsVision: m.supportsVision,
      supportsFunctionCalling: m.supportsFunctionCalling,
      minPlanSlug: m.minPlanSlug,
      isActive: true,
    },
  })
}
```

- [ ] **Step 5.5: Run the seed**

```bash
pnpm --filter @repo/db prisma:seed
```

Expected: no errors, no uncaught promise rejections.

- [ ] **Step 5.6: Verify row counts**

Replace `user` / `anynote` below with the credentials from `.env` `DATABASE_URL` if different:

```bash
docker compose exec -T postgres psql -U user -d anynote -c "SELECT COUNT(*) FROM ai_providers;"
docker compose exec -T postgres psql -U user -d anynote -c "SELECT COUNT(*) FROM ai_models;"
```

Expected: `3` and `6`.

- [ ] **Step 5.7: Verify idempotency**

Re-run the seed:
```bash
pnpm --filter @repo/db prisma:seed
```

Expected: no errors, counts still `3` and `6` (not `6` and `12`).

- [ ] **Step 5.8: Verify `chat_message_files` table exists and is empty**

```bash
docker compose exec -T postgres psql -U user -d anynote -c "\\d chat_message_files"
```

Expected: table description printed with columns `messageId`, `fileId`, `createdAt`, composite PK.

- [ ] **Step 5.9: Verify `pages.ownership` default**

```bash
docker compose exec -T postgres psql -U user -d anynote -c "SELECT column_default FROM information_schema.columns WHERE table_name = 'pages' AND column_name = 'ownership';"
```

Expected: `'TEXT'::\"PageOwnership\"` or equivalent.

- [ ] **Step 5.10: Commit**

```bash
git add packages/db/prisma/seed.ts
git commit -m "$(cat <<'EOF'
feat(db): seed AI providers (ollama/openai/gigachat) and starter models

Adds 3 AiProvider rows + 6 AiModel rows (gemma4, gpt-4o-mini, gpt-4o,
GigaChat, GigaChat-Pro, GigaChat-Max) with plan gating and context
window capabilities. Idempotent via upsert on slug / (providerId, slug).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Full-workspace verification

**Files:** none modified.

- [ ] **Step 6.1: Run `pnpm lint`**

```bash
pnpm lint
```

Expected: no warnings (ESLint `--max-warnings 0`). If a warning appears in a renamed file, fix it and amend the relevant earlier commit with `git commit --amend --no-edit` OR add a new fix-up commit — ask the user which they prefer.

- [ ] **Step 6.2: Run `pnpm check-types`**

```bash
pnpm check-types
```

Expected: 0 errors.

- [ ] **Step 6.3: Run `pnpm build`**

```bash
pnpm build
```

Expected: Next.js build succeeds (App Router). Watch for RSC boundary errors per `CLAUDE.md` — none expected since prop-level code did not change.

- [ ] **Step 6.4: Dev server + yjs + Playwright**

In terminal 1:
```bash
pnpm dev
```

Wait until `http://localhost:3000` responds. In terminal 2:

```bash
pnpm --filter @repo/yjs-server dev
```

In terminal 3:

```bash
pnpm exec playwright test
```

Expected: existing e2e suite green. If a spec fails on a literal string like `"Новый поиск"`, update the literal to `"Новый чат"` in the spec file, commit separately:

```bash
git add apps/e2e
git commit -m "test(e2e): update default chat title literal"
```

- [ ] **Step 6.5: psql smoke check**

```bash
docker compose exec -T postgres psql -U user -d anynote <<'SQL'
\d chats
\d chat_messages
\d chat_message_files
\d ai_providers
\d ai_models
SELECT column_name FROM information_schema.columns WHERE table_name = 'pages' AND column_name = 'ownership';
SELECT COUNT(*) FROM ai_providers;
SELECT COUNT(*) FROM ai_models;
SQL
```

Expected: five table descriptions printed, `pages.ownership` row returned, counts `3` and `6`.

- [ ] **Step 6.6: No commit in this task unless Step 6.4 edited an e2e spec.**

---

## Task 7: Hand-off

**Files:** none.

- [ ] **Step 7.1: Review commits**

```bash
git log --oneline main..HEAD 2>/dev/null || git log --oneline -10
git status
```

Expected: 4 commits from Tasks 2, 3, 4, 5 (schema+db-index, trpc rename, web callers, seed). Working tree clean.

- [ ] **Step 7.2: Do NOT merge into `main` autonomously.**

Report to the user:
- commit list
- verified counts (3 providers, 6 models)
- green `check-types` / `lint` / `build` / playwright
- pending work for next pillars (see spec `Out-of-scope Follow-ups` section)

The user will decide merge timing and whether to use a `feat/db-foundation` branch (current workflow is direct-to-main per recent history) or a worktree.

---

## Self-Review — spec ↔ plan coverage

| Spec requirement | Implemented in |
|------------------|----------------|
| Rename `SearchChat`/`SearchMessage` (model, table, relation names, enum) | Task 1 steps 1.1, 1.2, 1.3, 1.4; Task 2 (re-exports); Task 3 (tRPC); Task 4 (web) |
| `ChatMessageFile` new join table | Task 1 step 1.5, 1.6 |
| `AiProvider` + `AiModel` catalog | Task 1 steps 1.9, 1.10; Task 5 (seed) |
| `Page.ownership` + `PageOwnership` enum + index | Task 1 steps 1.7, 1.8 |
| `prisma db push --force-reset` + reseed | Task 1 step 1.13; Task 5 step 5.5 |
| `minPlanSlug` soft FK values (`personal`, `corporate`, null) | Task 5 step 5.4 |
| Callers updated across tRPC + app | Tasks 3, 4 |
| Green `check-types` / `lint` / `build` / Playwright | Task 6 |
| No UI, no Python, no new apps, no indexing fields | Every task scope explicitly excludes those |
| `credentialsSchema` JSON shape for OpenAI / Ollama / GigaChat | Task 5 step 5.3 (with GigaChat context7-verification note) |

**Placeholder scan:** every code block contains runnable code, every command has an expected output, every identifier referenced in later tasks is defined in Task 1. No "TBD", no "similar to ...", no "fill in details".

**Type consistency:** `Chat`, `ChatMessage`, `ChatMessageFile`, `ChatMessageRole`, `AiProvider`, `AiModel`, `PageOwnership` are defined in Task 1 step names that match their usage in Tasks 2–5. `prisma.chat`, `prisma.chatMessage`, `prisma.aiProvider`, `prisma.aiModel` match their model definitions (Prisma lowercases model names to client properties).

**Scope check:** single pillar, single spec, ~4 commits. Inside one implementation session.
