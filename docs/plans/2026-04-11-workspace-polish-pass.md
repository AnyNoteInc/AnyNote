# Workspace Polish Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the 14 follow-ups from the first review pass — Notion-style `Block` model, chat-style search, plan-gated workspace settings, theme-reactive `(protected)` group, collapsible icon-rail sidebar, `/profile` page, and assorted UI cleanup.

**Architecture:** One Prisma migration adds `Block`, `SearchChat`, `SearchMessage`. Three new tRPC routers (`block`, `page`, `search`) plus `workspace` additions. Theme becomes globally thin and honours user preference across `(protected)`. Workspace shell drops its internal `ThemeProvider` and the AI column; left sidebar gains a 56px icon rail mode. Start page switches from hard-coded TSX to data-driven render of seeded blocks.

**Tech Stack:** Prisma 7 + PostgreSQL 16, tRPC v11, Next.js 16 App Router (RSC + client islands), MUI v6, better-auth 1.6.2, Playwright 1.59.

**Reference spec:** `docs/specs/2026-04-11-workspace-polish-pass-design.md`

---

## Pre-flight

Before starting Task 1:

1. Ensure `docker compose up -d` is running (postgres on 5432).
2. Ensure the branch is clean or carry over only the review-pass fixes the controller explicitly instructs.
3. Dispatch subagents sequentially (never in parallel) — the Prisma schema and tRPC router boilerplate mutate shared files.

---

## Group A — Schema & Migration

### Task 1: `Block` Prisma model + `BlockType` enum

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add `BlockType` enum**

Append before the existing `ParentType` enum (or anywhere in the enum block):

```prisma
enum BlockType {
  // MVP-rendered
  PARAGRAPH
  HEADING_1
  HEADING_2
  HEADING_3
  TO_DO
  BULLETED_LIST_ITEM
  NUMBERED_LIST_ITEM
  TOGGLE
  QUOTE
  CALLOUT
  DIVIDER
  CODE
  // Reserved for future
  IMAGE
  VIDEO
  FILE
  PDF
  BOOKMARK
  EQUATION
  TABLE
  COLUMN
  SYNCED_BLOCK
  LINK_TO_PAGE
}
```

- [ ] **Step 2: Add `Block` model** (append after the `Page` model)

```prisma
model Block {
  id            String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  type          BlockType
  pageId        String    @map("page_id") @db.Uuid
  parentBlockId String?   @map("parent_block_id") @db.Uuid
  prevBlockId   String?   @map("prev_block_id") @db.Uuid
  content       Json      @default("{}")
  createdById   String    @map("created_by_id") @db.Uuid
  updatedById   String?   @map("updated_by_id") @db.Uuid
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt     DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  archivedAt    DateTime? @map("archived_at") @db.Timestamptz(6)

  page      Page    @relation(fields: [pageId], references: [id], onDelete: Cascade)
  parent    Block?  @relation("BlockTree", fields: [parentBlockId], references: [id], onDelete: Cascade)
  children  Block[] @relation("BlockTree")
  prev      Block?  @relation("BlockPrev", fields: [prevBlockId], references: [id], onDelete: SetNull)
  next      Block?  @relation("BlockPrev")
  createdBy User    @relation("BlockCreator", fields: [createdById], references: [id], onDelete: Restrict)
  updatedBy User?   @relation("BlockUpdater", fields: [updatedById], references: [id], onDelete: SetNull)

  @@unique([parentBlockId, prevBlockId], map: "blocks_parent_prev_unique")
  @@index([pageId])
  @@index([pageId, parentBlockId])
  @@map("blocks")
}
```

- [ ] **Step 3: Add back-relations on `Page` and `User`**

In the `Page` model, add the `blocks Block[]` relation:

```prisma
model Page {
  // ...existing fields...
  blocks Block[]
}
```

In the `User` model, add these relations (merge next to the existing ones):

```prisma
model User {
  // ...existing relations...
  blocksCreated Block[] @relation("BlockCreator")
  blocksUpdated Block[] @relation("BlockUpdater")
}
```

- [ ] **Step 4: Validate schema compiles**

```bash
pnpm --filter @repo/db prisma:generate
```

Expected: `✔ Generated Prisma Client` with no errors. If Prisma complains about missing inverse relations, re-check Step 3.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat(db): add Block model with BlockType enum"
```

---

### Task 2: `SearchChat` + `SearchMessage` models

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add `SearchMessageRole` enum**

```prisma
enum SearchMessageRole {
  USER
  ASSISTANT
}
```

- [ ] **Step 2: Add both models** (append after `Block`)

```prisma
model SearchChat {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  workspaceId String   @map("workspace_id") @db.Uuid
  createdById String   @map("created_by_id") @db.Uuid
  title       String   @default("Новый поиск")
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  workspace Workspace       @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  createdBy User            @relation("SearchChatCreator", fields: [createdById], references: [id], onDelete: Restrict)
  messages  SearchMessage[]

  @@index([workspaceId, updatedAt(sort: Desc)])
  @@map("search_chats")
}

model SearchMessage {
  id        String            @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  chatId    String            @map("chat_id") @db.Uuid
  role      SearchMessageRole
  content   String            @db.Text
  sources   Json              @default("[]")
  createdAt DateTime          @default(now()) @map("created_at") @db.Timestamptz(6)

  chat SearchChat @relation(fields: [chatId], references: [id], onDelete: Cascade)

  @@index([chatId, createdAt])
  @@map("search_messages")
}
```

- [ ] **Step 3: Add back-relations**

In `Workspace`: `searchChats SearchChat[]`.
In `User`: `searchChats SearchChat[] @relation("SearchChatCreator")`.

- [ ] **Step 4: Validate**

```bash
pnpm --filter @repo/db prisma:generate
```

Expected: clean generation.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat(db): add SearchChat and SearchMessage models"
```

---

### Task 3: Migration — apply schema + manual partial indexes

**Files:**
- Create: `packages/db/prisma/migrations/<timestamp>_workspace_polish_pass/migration.sql`

- [ ] **Step 1: Run migration dev command**

```bash
pnpm --filter @repo/db prisma migrate dev --name workspace_polish_pass
```

This generates the SQL for new enums, new tables, FKs, the `@@unique([parentBlockId, prevBlockId])`, and the indexes.

- [ ] **Step 2: Append manual partial indexes**

Open the generated migration file (latest under `packages/db/prisma/migrations/`) and append:

```sql
-- ---- manual additions below ----

-- Exactly one root-level head block per page (prev=null and parent=null)
CREATE UNIQUE INDEX "blocks_head_root"
  ON "blocks" ("page_id")
  WHERE "parent_block_id" IS NULL AND "prev_block_id" IS NULL;

-- Exactly one head per nested sibling group (prev=null, parent not null)
CREATE UNIQUE INDEX "blocks_head_nested"
  ON "blocks" ("parent_block_id")
  WHERE "parent_block_id" IS NOT NULL AND "prev_block_id" IS NULL;
```

- [ ] **Step 3: Re-apply with the added SQL**

```bash
pnpm --filter @repo/db prisma migrate dev
```

Expected: "Migration already applied" or reapplied with the new indexes. If Prisma asks whether to reset, answer NO and instead apply via:

```bash
DATABASE_URL=... psql -f packages/db/prisma/migrations/<timestamp>_workspace_polish_pass/migration.sql
```

Alternative (simpler, reliable): before running Step 1, run `pnpm --filter @repo/db prisma migrate dev --create-only --name workspace_polish_pass`, then append manual SQL, then `prisma migrate deploy`.

- [ ] **Step 4: Verify indexes exist**

```bash
docker compose exec -T postgres psql -U postgres -d anynote -c "\\d blocks"
```

Expected output contains `blocks_head_root`, `blocks_head_nested`, `blocks_parent_prev_unique`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/migrations/<timestamp>_workspace_polish_pass
git commit -m "feat(db): migrate blocks + search_chats with linked-list indexes"
```

---

### Task 4: Regenerate Prisma Client and verify types

**Files:** (no file edits — verification only)

- [ ] **Step 1: Generate client**

```bash
pnpm --filter @repo/db prisma:generate
```

- [ ] **Step 2: Type-check workspace**

```bash
pnpm check-types
```

Expected: 0 errors. `@repo/db` should now expose `Block`, `BlockType`, `SearchChat`, `SearchMessage`, `SearchMessageRole` in the generated types.

- [ ] **Step 3: Write a temporary type assertion (smoke test)**

Create `/tmp/block-type-check.ts`:

```ts
import type { Block, BlockType, SearchChat, SearchMessage } from "@repo/db"

const _probe: { b: Block; t: BlockType; c: SearchChat; m: SearchMessage } = {} as never
void _probe
```

Run:

```bash
pnpm --filter @repo/db exec tsc --noEmit /tmp/block-type-check.ts
```

Expected: no output (pass).

- [ ] **Step 4: Clean up the probe**

```bash
rm /tmp/block-type-check.ts
```

- [ ] **Step 5: No commit** (nothing to stage).

---

### Task 5: Update `@repo/db` explicit re-exports

**Files:**
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Extend the explicit exports list**

Replace the existing `export { ... } from "@prisma/client"` blocks so `BlockType`, `SearchMessageRole`, `Block`, `SearchChat`, `SearchMessage` are included:

```ts
// Explicit re-exports — avoid `export *` from @prisma/client, which is CJS and
// trips Turbopack's "unexpected export *" warning on the server bundle.
export { PrismaClient, Prisma }
export {
  RoleType,
  ParentType,
  IntegrationScope,
  IntegrationStatus,
  SubscriptionStatus,
  BlockType,
  SearchMessageRole,
} from "@prisma/client"
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
  Block,
  SearchChat,
  SearchMessage,
} from "@prisma/client"
export default prisma
```

- [ ] **Step 2: Type-check**

```bash
pnpm --filter @repo/db check-types
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/index.ts
git commit -m "feat(db): export Block, SearchChat, SearchMessage explicitly"
```

---

## Group B — tRPC

### Task 6: `blockRouter` with `listByPage`, `create`, `update`, `move`, `archive`

**Files:**
- Create: `packages/trpc/src/routers/block.ts`
- Create: `packages/trpc/src/schemas/block-content.ts`

- [ ] **Step 1: Create the content schema module**

`packages/trpc/src/schemas/block-content.ts`:

```ts
import { z } from "zod"

const textBlock = z.object({ text: z.string().max(10_000) })
const todoBlock = z.object({ text: z.string().max(10_000), checked: z.boolean().default(false) })
const calloutBlock = z.object({ text: z.string().max(10_000), emoji: z.string().max(8).optional() })
const codeBlock = z.object({ text: z.string().max(50_000), language: z.string().max(32).default("plaintext") })
const emptyBlock = z.object({}).strict()

export const BlockCreateInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("PARAGRAPH"), content: textBlock }),
  z.object({ type: z.literal("HEADING_1"), content: textBlock }),
  z.object({ type: z.literal("HEADING_2"), content: textBlock }),
  z.object({ type: z.literal("HEADING_3"), content: textBlock }),
  z.object({ type: z.literal("TO_DO"), content: todoBlock }),
  z.object({ type: z.literal("BULLETED_LIST_ITEM"), content: textBlock }),
  z.object({ type: z.literal("NUMBERED_LIST_ITEM"), content: textBlock }),
  z.object({ type: z.literal("TOGGLE"), content: textBlock }),
  z.object({ type: z.literal("QUOTE"), content: textBlock }),
  z.object({ type: z.literal("CALLOUT"), content: calloutBlock }),
  z.object({ type: z.literal("DIVIDER"), content: emptyBlock }),
  z.object({ type: z.literal("CODE"), content: codeBlock }),
])

export type BlockCreateInputType = z.infer<typeof BlockCreateInput>
```

- [ ] **Step 2: Create the router**

`packages/trpc/src/routers/block.ts`:

```ts
import { z } from "zod"
import { TRPCError } from "@trpc/server"

import type { Block } from "@repo/db"

import { router, protectedProcedure } from "../trpc"
import { BlockCreateInput } from "../schemas/block-content"

type OrderedBlock = Block & { depth: number }

function orderBlocks(blocks: Block[]): OrderedBlock[] {
  const byParent = new Map<string | null, Map<string | null, Block>>()
  for (const block of blocks) {
    const parent = block.parentBlockId
    let group = byParent.get(parent)
    if (!group) {
      group = new Map()
      byParent.set(parent, group)
    }
    group.set(block.prevBlockId, block)
  }

  const out: OrderedBlock[] = []
  const walk = (parent: string | null, depth: number) => {
    const group = byParent.get(parent)
    if (!group) return
    let cursor: string | null = null
    while (group.has(cursor)) {
      const next = group.get(cursor)!
      out.push(Object.assign(next, { depth }))
      walk(next.id, depth + 1)
      cursor = next.id
    }
  }
  walk(null, 0)
  return out
}

async function assertPageAccess(
  ctx: { prisma: typeof import("@repo/db").default; user: { id: string } },
  pageId: string,
) {
  const page = await ctx.prisma.page.findFirst({
    where: { id: pageId, workspace: { members: { some: { userId: ctx.user.id } } } },
    select: { id: true },
  })
  if (!page) throw new TRPCError({ code: "NOT_FOUND", message: "Страница не найдена" })
}

export const blockRouter = router({
  listByPage: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertPageAccess(ctx, input.pageId)
      const rows = await ctx.prisma.block.findMany({
        where: { pageId: input.pageId, archivedAt: null },
      })
      return orderBlocks(rows)
    }),

  create: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        parentBlockId: z.string().uuid().nullish(),
        afterBlockId: z.string().uuid().nullish(),
        block: BlockCreateInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertPageAccess(ctx, input.pageId)
      return ctx.prisma.$transaction(async (tx) => {
        const parentBlockId = input.parentBlockId ?? null
        const after = input.afterBlockId
          ? await tx.block.findFirst({
              where: { id: input.afterBlockId, pageId: input.pageId, parentBlockId },
            })
          : null
        if (input.afterBlockId && !after) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "afterBlockId not in the same sibling group" })
        }

        const exNext = await tx.block.findFirst({
          where: { pageId: input.pageId, parentBlockId, prevBlockId: after?.id ?? null },
        })

        const created = await tx.block.create({
          data: {
            pageId: input.pageId,
            parentBlockId,
            prevBlockId: after?.id ?? null,
            type: input.block.type,
            content: input.block.content,
            createdById: ctx.user.id,
          },
        })

        if (exNext) {
          await tx.block.update({
            where: { id: exNext.id },
            data: { prevBlockId: created.id },
          })
        }

        return created
      })
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        content: z.record(z.string(), z.unknown()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const block = await ctx.prisma.block.findFirst({
        where: { id: input.id, page: { workspace: { members: { some: { userId: ctx.user.id } } } } },
      })
      if (!block) throw new TRPCError({ code: "NOT_FOUND" })
      return ctx.prisma.block.update({
        where: { id: input.id },
        data: { content: input.content, updatedById: ctx.user.id },
      })
    }),

  move: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        newParentBlockId: z.string().uuid().nullable(),
        newAfterBlockId: z.string().uuid().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.$transaction(async (tx) => {
        const block = await tx.block.findFirst({
          where: { id: input.id, page: { workspace: { members: { some: { userId: ctx.user.id } } } } },
        })
        if (!block) throw new TRPCError({ code: "NOT_FOUND" })

        // Unlink from current position
        const oldNext = await tx.block.findFirst({
          where: { pageId: block.pageId, parentBlockId: block.parentBlockId, prevBlockId: block.id },
        })
        if (oldNext) {
          await tx.block.update({
            where: { id: oldNext.id },
            data: { prevBlockId: block.prevBlockId },
          })
        }

        // Link at new position
        const newPrev = input.newAfterBlockId
          ? await tx.block.findFirst({
              where: { id: input.newAfterBlockId, pageId: block.pageId, parentBlockId: input.newParentBlockId },
            })
          : null
        const newNext = await tx.block.findFirst({
          where: {
            pageId: block.pageId,
            parentBlockId: input.newParentBlockId,
            prevBlockId: newPrev?.id ?? null,
          },
        })

        await tx.block.update({
          where: { id: block.id },
          data: { parentBlockId: input.newParentBlockId, prevBlockId: newPrev?.id ?? null },
        })
        if (newNext && newNext.id !== block.id) {
          await tx.block.update({
            where: { id: newNext.id },
            data: { prevBlockId: block.id },
          })
        }

        return tx.block.findUnique({ where: { id: block.id } })
      })
    }),

  archive: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.$transaction(async (tx) => {
        const block = await tx.block.findFirst({
          where: { id: input.id, page: { workspace: { members: { some: { userId: ctx.user.id } } } } },
        })
        if (!block) throw new TRPCError({ code: "NOT_FOUND" })
        const next = await tx.block.findFirst({
          where: { pageId: block.pageId, parentBlockId: block.parentBlockId, prevBlockId: block.id },
        })
        if (next) {
          await tx.block.update({
            where: { id: next.id },
            data: { prevBlockId: block.prevBlockId },
          })
        }
        return tx.block.update({
          where: { id: block.id },
          data: { archivedAt: new Date(), prevBlockId: null },
        })
      })
    }),
})
```

- [ ] **Step 3: Type-check**

```bash
pnpm --filter @repo/trpc check-types
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/trpc/src/routers/block.ts packages/trpc/src/schemas/block-content.ts
git commit -m "feat(trpc): add blockRouter with linked-list operations"
```

---

### Task 7: `pageRouter` (minimal)

**Files:**
- Create: `packages/trpc/src/routers/page.ts`

- [ ] **Step 1: Create the router**

```ts
import { z } from "zod"
import { TRPCError } from "@trpc/server"

import { router, protectedProcedure } from "../trpc"

export const pageRouter = router({
  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const page = await ctx.prisma.page.findFirst({
        where: {
          id: input.id,
          workspace: { members: { some: { userId: ctx.user.id } } },
        },
      })
      if (!page) throw new TRPCError({ code: "NOT_FOUND" })
      return page
    }),

  listByWorkspace: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.page.findMany({
        where: {
          workspaceId: input.workspaceId,
          workspace: { members: { some: { userId: ctx.user.id } } },
          archived: false,
          deletedAt: null,
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          title: true,
          icon: true,
          parentType: true,
          parentId: true,
          createdAt: true,
        },
      })
    }),
})
```

- [ ] **Step 2: Type-check**

```bash
pnpm --filter @repo/trpc check-types
```

- [ ] **Step 3: Commit**

```bash
git add packages/trpc/src/routers/page.ts
git commit -m "feat(trpc): add pageRouter with getById and listByWorkspace"
```

---

### Task 8: `seedStartPage` helper + rewire `workspace.create`

**Files:**
- Create: `packages/trpc/src/helpers/seed-start-page.ts`
- Modify: `packages/trpc/src/routers/workspace.ts`

- [ ] **Step 1: Create the seed helper**

```ts
import type { Prisma } from "@repo/db"

type Tx = Prisma.TransactionClient

type SeedBlock =
  | { type: "TO_DO"; text: string; checked?: boolean }
  | { type: "TOGGLE"; text: string }

const START_BLOCKS: SeedBlock[] = [
  { type: "TO_DO", text: "Create your first page", checked: true },
  { type: "TO_DO", text: "Pick a workspace icon", checked: true },
  { type: "TO_DO", text: "Try a slash command — type /heading on a blank line" },
  { type: "TO_DO", text: "Import notes from Notion or Obsidian" },
  { type: "TO_DO", text: "Upload a file or image with drag-and-drop" },
  { type: "TO_DO", text: "Connect an integration (GitHub, Telegram, AmoCRM)" },
  { type: "TOGGLE", text: "Advanced: databases, views, filters" },
  { type: "TO_DO", text: "Share a page with a public link" },
  { type: "TO_DO", text: "Ask AI about your docs — /ask" },
  { type: "TO_DO", text: "Invite a teammate" },
]

export async function seedStartPage(
  tx: Tx,
  workspaceId: string,
  userId: string,
): Promise<{ pageId: string }> {
  const page = await tx.page.create({
    data: {
      workspaceId,
      parentType: "WORKSPACE",
      parentId: workspaceId,
      title: "Welcome to AnyNote",
      icon: "👋",
      createdById: userId,
      updatedById: userId,
    },
  })

  let prevId: string | null = null
  for (const item of START_BLOCKS) {
    const content =
      item.type === "TO_DO"
        ? { text: item.text, checked: item.checked ?? false }
        : { text: item.text }

    const block = await tx.block.create({
      data: {
        pageId: page.id,
        prevBlockId: prevId,
        type: item.type,
        content,
        createdById: userId,
      },
    })
    prevId = block.id
  }

  return { pageId: page.id }
}
```

- [ ] **Step 2: Wire into `workspaceRouter.create`**

In `packages/trpc/src/routers/workspace.ts`, modify the `create` procedure's transaction to call the helper after creating the member:

```ts
import { seedStartPage } from "../helpers/seed-start-page"

// ...inside create mutation, after workspaceMember.create and userPreference.upsert:

const { pageId } = await seedStartPage(tx, workspace.id, ctx.user.id)
return { ...workspace, startPageId: pageId }
```

Full updated transaction block:

```ts
return ctx.prisma.$transaction(async (tx) => {
  const workspace = await tx.workspace.create({
    data: { name: input.name, icon: input.icon, createdById: ctx.user.id },
  })
  await tx.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: ctx.user.id, role: "OWNER" },
  })
  await tx.userPreference.upsert({
    where: { userId: ctx.user.id },
    create: { userId: ctx.user.id, defaultWorkspaceId: workspace.id },
    update: { defaultWorkspaceId: workspace.id },
  })
  const { pageId } = await seedStartPage(tx, workspace.id, ctx.user.id)
  return { ...workspace, startPageId: pageId }
})
```

- [ ] **Step 3: Type-check**

```bash
pnpm --filter @repo/trpc check-types
```

- [ ] **Step 4: Commit**

```bash
git add packages/trpc/src/helpers/seed-start-page.ts packages/trpc/src/routers/workspace.ts
git commit -m "feat(trpc): seed welcome page + blocks on workspace create"
```

---

### Task 9: `workspaceRouter` — rename / listMembers / inviteMember / removeMember / delete

**Files:**
- Modify: `packages/trpc/src/routers/workspace.ts`

- [ ] **Step 1: Add plan-gate helper**

At the top of the file after imports:

```ts
async function assertPaidPlan(ctx: { prisma: typeof import("@repo/db").default; user: { id: string } }) {
  const { plan } = await getActivePlanForUser(ctx.prisma, ctx.user.id)
  if (plan.slug === "free") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Это действие доступно на платных тарифах",
    })
  }
}

async function assertRole(
  ctx: { prisma: typeof import("@repo/db").default; user: { id: string } },
  workspaceId: string,
  allowed: Array<"OWNER" | "ADMIN" | "EDITOR" | "COMMENTER" | "VIEWER" | "GUEST">,
) {
  const member = await ctx.prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: ctx.user.id } },
  })
  if (!member || !allowed.includes(member.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Недостаточно прав" })
  }
  return member
}
```

- [ ] **Step 2: Add the new procedures** to the `workspaceRouter` object:

```ts
rename: protectedProcedure
  .input(
    z.object({
      id: z.string().uuid(),
      name: z.string().min(1).max(64),
      icon: z.string().max(64).optional(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    await assertRole(ctx, input.id, ["OWNER", "ADMIN"])
    await assertPaidPlan(ctx)
    return ctx.prisma.workspace.update({
      where: { id: input.id },
      data: { name: input.name, icon: input.icon },
    })
  }),

listMembers: protectedProcedure
  .input(z.object({ workspaceId: z.string().uuid() }))
  .query(async ({ ctx, input }) => {
    await assertRole(ctx, input.workspaceId, ["OWNER", "ADMIN", "EDITOR", "COMMENTER", "VIEWER", "GUEST"])
    return ctx.prisma.workspaceMember.findMany({
      where: { workspaceId: input.workspaceId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, image: true } },
      },
      orderBy: { createdAt: "asc" },
    })
  }),

inviteMember: protectedProcedure
  .input(
    z.object({
      workspaceId: z.string().uuid(),
      email: z.string().email(),
      role: z.enum(["ADMIN", "EDITOR", "COMMENTER", "VIEWER"]),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    await assertRole(ctx, input.workspaceId, ["OWNER"])
    await assertPaidPlan(ctx)

    const user = await ctx.prisma.user.findUnique({ where: { email: input.email } })
    if (!user) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Пользователь с таким email не зарегистрирован. Приглашения по ссылке будут позже.",
      })
    }

    return ctx.prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: user.id } },
      create: { workspaceId: input.workspaceId, userId: user.id, role: input.role },
      update: { role: input.role },
    })
  }),

removeMember: protectedProcedure
  .input(z.object({ workspaceId: z.string().uuid(), userId: z.string().uuid() }))
  .mutation(async ({ ctx, input }) => {
    await assertRole(ctx, input.workspaceId, ["OWNER"])
    if (input.userId === ctx.user.id) {
      const owners = await ctx.prisma.workspaceMember.count({
        where: { workspaceId: input.workspaceId, role: "OWNER" },
      })
      if (owners <= 1) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Нельзя удалить единственного OWNER. Передайте роль другому или удалите пространство.",
        })
      }
    }
    await ctx.prisma.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: input.userId } },
    })
    return { ok: true }
  }),

delete: protectedProcedure
  .input(z.object({ id: z.string().uuid() }))
  .mutation(async ({ ctx, input }) => {
    await assertRole(ctx, input.id, ["OWNER"])
    await assertPaidPlan(ctx)
    await ctx.prisma.workspace.delete({ where: { id: input.id } })
    return { ok: true }
  }),
```

- [ ] **Step 3: Type-check**

```bash
pnpm --filter @repo/trpc check-types
```

- [ ] **Step 4: Commit**

```bash
git add packages/trpc/src/routers/workspace.ts
git commit -m "feat(trpc): workspace rename/members/delete with plan gating"
```

---

### Task 10: `searchRouter` with chat + echo message pipeline

**Files:**
- Create: `packages/trpc/src/routers/search.ts`

- [ ] **Step 1: Create the router**

```ts
import { z } from "zod"
import { TRPCError } from "@trpc/server"

import { router, protectedProcedure } from "../trpc"

async function assertWorkspaceMember(
  ctx: { prisma: typeof import("@repo/db").default; user: { id: string } },
  workspaceId: string,
) {
  const member = await ctx.prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: ctx.user.id } },
  })
  if (!member) throw new TRPCError({ code: "FORBIDDEN" })
}

async function assertChatAccess(
  ctx: { prisma: typeof import("@repo/db").default; user: { id: string } },
  chatId: string,
) {
  const chat = await ctx.prisma.searchChat.findFirst({
    where: {
      id: chatId,
      workspace: { members: { some: { userId: ctx.user.id } } },
    },
  })
  if (!chat) throw new TRPCError({ code: "NOT_FOUND" })
  return chat
}

export const searchRouter = router({
  listChats: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      return ctx.prisma.searchChat.findMany({
        where: { workspaceId: input.workspaceId },
        orderBy: { updatedAt: "desc" },
        take: 50,
      })
    }),

  getChat: protectedProcedure
    .input(z.object({ chatId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const chat = await assertChatAccess(ctx, input.chatId)
      const messages = await ctx.prisma.searchMessage.findMany({
        where: { chatId: chat.id },
        orderBy: { createdAt: "asc" },
      })
      return { chat, messages }
    }),

  createChat: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      return ctx.prisma.searchChat.create({
        data: {
          workspaceId: input.workspaceId,
          createdById: ctx.user.id,
        },
      })
    }),

  sendMessage: protectedProcedure
    .input(
      z.object({
        chatId: z.string().uuid(),
        content: z.string().min(1).max(4000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const chat = await assertChatAccess(ctx, input.chatId)
      return ctx.prisma.$transaction(async (tx) => {
        const userMessage = await tx.searchMessage.create({
          data: { chatId: chat.id, role: "USER", content: input.content },
        })
        const assistantMessage = await tx.searchMessage.create({
          data: {
            chatId: chat.id,
            role: "ASSISTANT",
            content: `🔎 MVP echo: "${input.content}". Настоящий RAG подключим с OLLAMA + Weaviate.`,
          },
        })
        const shouldRename = chat.title === "Новый поиск"
        await tx.searchChat.update({
          where: { id: chat.id },
          data: {
            updatedAt: new Date(),
            title: shouldRename ? input.content.slice(0, 48) : undefined,
          },
        })
        return { userMessage, assistantMessage }
      })
    }),

  deleteChat: protectedProcedure
    .input(z.object({ chatId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertChatAccess(ctx, input.chatId)
      await ctx.prisma.searchChat.delete({ where: { id: input.chatId } })
      return { ok: true }
    }),
})
```

- [ ] **Step 2: Type-check**

```bash
pnpm --filter @repo/trpc check-types
```

- [ ] **Step 3: Commit**

```bash
git add packages/trpc/src/routers/search.ts
git commit -m "feat(trpc): add searchRouter with echo message pipeline"
```

---

### Task 11: Register new routers + remove `loggerLink`

**Files:**
- Modify: `packages/trpc/src/index.ts`
- Modify: `apps/web/src/trpc/client.tsx`

- [ ] **Step 1: Register routers in `packages/trpc/src/index.ts`**

```ts
import { blockRouter } from "./routers/block"
import { pageRouter } from "./routers/page"
import { searchRouter } from "./routers/search"

export const appRouter = router({
  // ...existing namespaces
  block: blockRouter,
  page: pageRouter,
  search: searchRouter,
})
```

- [ ] **Step 2: Remove `loggerLink` in `apps/web/src/trpc/client.tsx`**

Replace the `links` array content:

```ts
import { httpBatchLink } from "@trpc/client"
// remove loggerLink import

links: [
  httpBatchLink({
    url: `${getBaseUrl()}/api/trpc`,
  }),
],
```

- [ ] **Step 3: Type-check and build**

```bash
pnpm check-types && pnpm --filter web build
```

Expected: clean. No Turbopack warnings about Prisma.

- [ ] **Step 4: Commit**

```bash
git add packages/trpc/src/index.ts apps/web/src/trpc/client.tsx
git commit -m "feat(trpc): register block/page/search routers, drop loggerLink"
```

---

## Group C — Theme, Typography, Cleanup

### Task 12: Thin typography weights + dark palette tokens in theme

**Files:**
- Modify: `packages/ui/src/theme/theme.ts`

- [ ] **Step 1: Replace the theme factory**

```ts
import { createTheme } from "@mui/material/styles"
import type { PaletteMode } from "@mui/material"

export function createAppTheme(mode: PaletteMode = "light") {
  return createTheme({
    palette: {
      mode,
      primary: { main: "#0f766e" },
      secondary: { main: "#155e75" },
      background:
        mode === "dark"
          ? {
              default: "#0c0d10",
              paper: "#14161a",
            }
          : {
              default: "#fafaf9",
              paper: "#ffffff",
            },
      text:
        mode === "dark"
          ? {
              primary: "#e7e8ea",
              secondary: "#a7aab1",
              disabled: "#6b6e75",
            }
          : {
              primary: "#1f2021",
              secondary: "#52525b",
              disabled: "#a1a1aa",
            },
      divider: mode === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
    },
    shape: { borderRadius: 4 },
    typography: {
      fontFamily: [
        "var(--font-geist-sans)",
        "system-ui",
        "-apple-system",
        "BlinkMacSystemFont",
        "sans-serif",
      ].join(", "),
      fontWeightLight: 200,
      fontWeightRegular: 300,
      fontWeightMedium: 400,
      fontWeightBold: 500,
      h1: { fontWeight: 300, letterSpacing: "-0.04em", lineHeight: 1.08 },
      h2: { fontWeight: 300, letterSpacing: "-0.03em", lineHeight: 1.12 },
      h3: { fontWeight: 300, letterSpacing: "-0.02em" },
      h4: { fontWeight: 400 },
      h5: { fontWeight: 400 },
      h6: { fontWeight: 400 },
      subtitle1: { fontWeight: 400 },
      subtitle2: { fontWeight: 400 },
      body1: { fontWeight: 300 },
      body2: { fontWeight: 300 },
      button: { textTransform: "none", fontWeight: 400 },
      overline: {
        fontFamily: ["var(--font-geist-mono)", "ui-monospace", "SFMono-Regular", "monospace"].join(", "),
        letterSpacing: "0.16em",
        fontWeight: 400,
      },
    },
    components: {
      MuiButton: {
        defaultProps: { variant: "contained" },
        styleOverrides: {
          root: { borderRadius: 4, paddingInline: 18 },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: "none" },
        },
      },
    },
  })
}
```

- [ ] **Step 2: Type-check and build**

```bash
pnpm --filter @repo/ui check-types
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/theme/theme.ts
git commit -m "feat(ui): thin typography weights and extended palette tokens"
```

---

### Task 13: Remove internal `ThemeProvider` and hex colors from `WorkspaceShell`

**Files:**
- Modify: `apps/web/src/components/workspace/workspace-shell.tsx`

- [ ] **Step 1: Replace the file contents**

```tsx
"use client"

import type { ReactNode } from "react"

import { Box } from "@repo/ui/components"

type Props = {
  sidebar: ReactNode
  main: ReactNode
  sidebarWidth: number
}

export function WorkspaceShell({ sidebar, main, sidebarWidth }: Props) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: `${sidebarWidth}px minmax(0, 1fr)`,
        height: "100vh",
        bgcolor: "background.default",
        color: "text.primary",
        overflow: "hidden",
      }}
    >
      {sidebar}
      <Box component="main" sx={{ overflow: "auto" }}>
        {main}
      </Box>
    </Box>
  )
}
```

Notes: shell is now a pure 2-column layout that receives pre-rendered slots. The internal `ThemeProvider` and `CssBaseline` are gone — the root layout owns them. `sidebarWidth` is a number so the caller can switch between `240` and `56`.

- [ ] **Step 2: Type-check**

```bash
pnpm --filter web check-types
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/workspace/workspace-shell.tsx
git commit -m "refactor(web): simplify WorkspaceShell, drop internal ThemeProvider"
```

---

### Task 14: Fix `resolveTheme()` + client-side `system` handling

**Files:**
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `packages/ui/src/providers/ui-provider.tsx`

- [ ] **Step 1: Update `resolveTheme()` to return `system`**

In `apps/web/src/app/layout.tsx`:

```ts
async function resolveTheme(): Promise<"light" | "dark" | "system"> {
  const cookieStore = await cookies()
  const cookieTheme = cookieStore.get("theme")?.value as "light" | "dark" | "system" | undefined

  const session = await getSession()
  if (session) {
    try {
      const trpc = await getServerTRPC()
      const prefs = await trpc.user.getPreferences()
      const stored = (prefs?.theme as "light" | "dark" | "system" | null) ?? cookieTheme ?? "system"
      return stored
    } catch {
      // fall through
    }
  }

  return cookieTheme ?? "system"
}
```

Update the call site to pass `"system"` through by changing the prop type in `UiProvider`:

```tsx
<UiProvider initial={mode}>{children}</UiProvider>
```

- [ ] **Step 2: Update `UiProvider` to accept `system` and listen to `prefers-color-scheme`**

```tsx
"use client"

import { CssBaseline, GlobalStyles } from "@mui/material"
import type { PaletteMode } from "@mui/material"
import { ThemeProvider } from "@mui/material/styles"
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter"
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react"

import { createAppTheme } from "@repo/ui/theme"

type Preference = PaletteMode | "system"

type ThemeModeContextValue = {
  mode: PaletteMode
  preference: Preference
  setPreference: (p: Preference) => void
  toggleMode: () => void
}

const ThemeModeContext = createContext<ThemeModeContextValue | null>(null)

export function useThemeMode() {
  const value = useContext(ThemeModeContext)
  if (!value) throw new Error("useThemeMode must be used within UiProvider")
  return value
}

export type UiProviderProps = PropsWithChildren<{ initial?: Preference }>

function resolveMode(preference: Preference, prefersDark: boolean): PaletteMode {
  if (preference === "light" || preference === "dark") return preference
  return prefersDark ? "dark" : "light"
}

export function UiProvider({ children, initial = "system" }: UiProviderProps) {
  const [preference, setPreferenceState] = useState<Preference>(initial)
  const [prefersDark, setPrefersDark] = useState<boolean>(false)

  useEffect(() => {
    const stored = window.localStorage.getItem("app-theme-mode") as Preference | null
    if (stored === "light" || stored === "dark" || stored === "system") {
      setPreferenceState(stored)
    }
  }, [])

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    setPrefersDark(mq.matches)
    const handler = (e: MediaQueryListEvent) => setPrefersDark(e.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])

  useEffect(() => {
    window.localStorage.setItem("app-theme-mode", preference)
  }, [preference])

  const mode = resolveMode(preference, prefersDark)
  const theme = useMemo(() => createAppTheme(mode), [mode])

  const setPreference = (p: Preference) => setPreferenceState(p)
  const toggleMode = () => setPreferenceState(mode === "light" ? "dark" : "light")

  return (
    <AppRouterCacheProvider options={{ key: "css", enableCssLayer: true }}>
      <ThemeModeContext.Provider value={{ mode, preference, setPreference, toggleMode }}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <GlobalStyles
            styles={{
              body: { backgroundColor: theme.palette.background.default },
            }}
          />
          {children}
        </ThemeProvider>
      </ThemeModeContext.Provider>
    </AppRouterCacheProvider>
  )
}
```

- [ ] **Step 3: Type-check**

```bash
pnpm check-types
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/layout.tsx packages/ui/src/providers/ui-provider.tsx
git commit -m "feat(ui): system theme preference with prefers-color-scheme"
```

---

## Group D — Routes

### Task 15: `/settings` → `/settings/general` redirect

**Files:**
- Create: `apps/web/src/app/(protected)/settings/page.tsx`

- [ ] **Step 1: Create the redirect page**

```tsx
import { redirect } from "next/navigation"

export default function SettingsIndexRedirect(): never {
  redirect("/settings/general")
}
```

- [ ] **Step 2: Verify via curl** (assumes `pnpm dev` running)

```bash
curl -sI http://localhost:3000/settings | head -5
```

Expected: `HTTP/1.1 307 Temporary Redirect` and `location: /settings/general`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/(protected)/settings/page.tsx
git commit -m "feat(web): redirect /settings to /settings/general"
```

---

### Task 16: `/workspaces` → default workspace redirect

**Files:**
- Create: `apps/web/src/app/(protected)/workspaces/page.tsx`

- [ ] **Step 1: Create the server redirect**

```tsx
import { redirect } from "next/navigation"

import { getServerTRPC } from "@/trpc/server"

export default async function WorkspacesIndexRedirect() {
  const trpc = await getServerTRPC()
  const defaultWorkspace = await trpc.workspace.getDefault()
  if (defaultWorkspace) {
    redirect(`/workspaces/${defaultWorkspace.id}`)
  }
  const owned = await trpc.workspace.listMine()
  if (owned.length > 0) {
    redirect(`/workspaces/${owned[0]!.id}`)
  }
  redirect("/workspaces/new")
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/(protected)/workspaces/page.tsx
git commit -m "feat(web): redirect /workspaces to default workspace"
```

---

### Task 17: `/profile` page with avatar + workspace cards

**Files:**
- Create: `apps/web/src/app/(protected)/profile/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
import Link from "next/link"

import {
  Avatar,
  Box,
  Button,
  Container,
  Paper,
  Stack,
  Typography,
} from "@repo/ui/components"

import { requireSession } from "@/lib/get-session"
import { getServerTRPC } from "@/trpc/server"

export const metadata = { title: "Мой профиль" }

export default async function ProfilePage() {
  const session = await requireSession()
  const trpc = await getServerTRPC()
  const workspaces = await trpc.workspace.listMine()

  const initials = `${session.user.firstName.charAt(0)}${session.user.lastName.charAt(0)}`.toUpperCase()

  return (
    <Container maxWidth="sm" sx={{ py: { xs: 4, md: 8 } }}>
      <Stack alignItems="center" spacing={3}>
        <Avatar
          sx={{
            width: 128,
            height: 128,
            fontSize: 44,
            background: "linear-gradient(135deg,#0f766e,#155e75)",
            color: "#fff",
          }}
        >
          {initials}
        </Avatar>
        <Stack alignItems="center" spacing={0.5}>
          <Typography variant="h4">
            {session.user.firstName} {session.user.lastName}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {session.user.email}
          </Typography>
        </Stack>

        <Box sx={{ width: "100%", pt: 2 }}>
          <Typography variant="overline" color="text.secondary">
            Рабочие пространства
          </Typography>
          {workspaces.length === 0 ? (
            <Paper variant="outlined" sx={{ p: 3, textAlign: "center", mt: 1 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                У вас пока нет рабочих пространств
              </Typography>
              <Button component={Link} href="/workspaces/new">
                Создать пространство
              </Button>
            </Paper>
          ) : (
            <Stack spacing={1.5} sx={{ mt: 1 }}>
              {workspaces.map((workspace) => (
                <Paper
                  key={workspace.id}
                  variant="outlined"
                  sx={{
                    p: 2,
                    display: "flex",
                    alignItems: "center",
                    gap: 2,
                  }}
                >
                  <Box
                    sx={{
                      width: 40,
                      height: 40,
                      borderRadius: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 20,
                      bgcolor: "action.hover",
                    }}
                  >
                    {workspace.icon ?? "📒"}
                  </Box>
                  <Stack spacing={0} sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body1" noWrap>
                      {workspace.name}
                    </Typography>
                  </Stack>
                  <Button
                    component={Link}
                    href={`/workspaces/${workspace.id}`}
                    size="small"
                    variant="outlined"
                  >
                    Перейти
                  </Button>
                </Paper>
              ))}
            </Stack>
          )}
        </Box>
      </Stack>
    </Container>
  )
}
```

- [ ] **Step 2: Verify Avatar is exported from `@repo/ui/components`**

```bash
grep -n "Avatar" packages/ui/src/components/index.ts
```

If missing, add `export { Avatar } from "@mui/material"` to the list.

- [ ] **Step 3: Type-check**

```bash
pnpm --filter web check-types
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(protected\)/profile/page.tsx packages/ui/src/components/index.ts
git commit -m "feat(web): add /profile page with avatar and workspaces"
```

---

### Task 18: `/workspaces/[id]/settings` layout + nav

**Files:**
- Create: `apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/layout.tsx`
- Create: `apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/page.tsx`
- Create: `apps/web/src/components/workspace/workspace-settings-nav.tsx`

- [ ] **Step 1: Create the settings nav client component**

```tsx
"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { Stack } from "@repo/ui/components"

type Props = { workspaceId: string }

const ITEMS = [
  { label: "Общее", slug: "general" },
  { label: "Участники", slug: "members" },
  { label: "Опасная зона", slug: "danger" },
] as const

export function WorkspaceSettingsNav({ workspaceId }: Props) {
  const pathname = usePathname()
  const base = `/workspaces/${workspaceId}/settings`

  return (
    <Stack spacing={0.5} component="nav">
      {ITEMS.map((item) => {
        const href = `${base}/${item.slug}`
        const active = pathname === href
        return (
          <Link
            key={item.slug}
            href={href}
            style={{
              display: "block",
              padding: "6px 10px",
              borderRadius: 6,
              textDecoration: "none",
              fontSize: 14,
              color: active ? "var(--mui-palette-text-primary)" : "var(--mui-palette-text-secondary)",
              backgroundColor: active ? "var(--mui-palette-action-selected)" : "transparent",
            }}
          >
            {item.label}
          </Link>
        )
      })}
    </Stack>
  )
}
```

- [ ] **Step 2: Create the layout**

```tsx
import type { ReactNode } from "react"

import { Box, Container, Paper } from "@repo/ui/components"
import { notFound } from "next/navigation"

import { WorkspaceSettingsNav } from "@/components/workspace/workspace-settings-nav"
import { getServerTRPC } from "@/trpc/server"

type Props = {
  children: ReactNode
  params: Promise<{ workspaceId: string }>
}

export default async function WorkspaceSettingsLayout({ children, params }: Props) {
  const { workspaceId } = await params
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getById({ id: workspaceId })
  if (!workspace) notFound()

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "220px minmax(0,1fr)" },
          gap: { xs: 3, md: 4 },
        }}
      >
        <Paper variant="outlined" sx={{ p: 2, alignSelf: "start" }}>
          <WorkspaceSettingsNav workspaceId={workspaceId} />
        </Paper>
        <Box>{children}</Box>
      </Box>
    </Container>
  )
}
```

- [ ] **Step 3: Create the index redirect**

```tsx
import { redirect } from "next/navigation"

type Props = { params: Promise<{ workspaceId: string }> }

export default async function WorkspaceSettingsIndex({ params }: Props) {
  const { workspaceId } = await params
  redirect(`/workspaces/${workspaceId}/settings/general`)
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(protected\)/workspaces/\[workspaceId\]/settings apps/web/src/components/workspace/workspace-settings-nav.tsx
git commit -m "feat(web): workspace settings layout and nav"
```

---

### Task 19: Workspace settings — `/general` (rename, plan-gated)

**Files:**
- Create: `apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/general/page.tsx`
- Create: `apps/web/src/components/workspace/settings/general-section.tsx`

- [ ] **Step 1: Create the client section**

`apps/web/src/components/workspace/settings/general-section.tsx`:

```tsx
"use client"

import { useState } from "react"

import {
  Alert,
  Button,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@repo/ui/components"

import { trpc } from "@/trpc/client"

type Props = {
  workspace: { id: string; name: string; icon: string | null }
  locked: boolean
}

export function WorkspaceGeneralSection({ workspace, locked }: Props) {
  const [name, setName] = useState(workspace.name)
  const [icon, setIcon] = useState(workspace.icon ?? "")
  const [successShown, setSuccessShown] = useState(false)
  const utils = trpc.useUtils()
  const rename = trpc.workspace.rename.useMutation({
    onSuccess: async () => {
      setSuccessShown(true)
      await utils.workspace.getById.invalidate({ id: workspace.id })
      setTimeout(() => setSuccessShown(false), 3000)
    },
  })

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Stack spacing={2}>
        <Typography variant="h6">Общее</Typography>
        {locked ? (
          <Alert severity="info">
            Переименование доступно на платных тарифах. <a href="/settings/billing">Апгрейд</a>
          </Alert>
        ) : null}
        {rename.error ? <Alert severity="error">{rename.error.message}</Alert> : null}
        {successShown ? <Alert severity="success">Сохранено</Alert> : null}
        <TextField
          label="Название"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={locked || rename.isPending}
          fullWidth
        />
        <TextField
          label="Иконка (эмодзи)"
          value={icon}
          onChange={(event) => setIcon(event.target.value)}
          disabled={locked || rename.isPending}
          inputProps={{ maxLength: 8 }}
        />
        <Stack direction="row" spacing={1}>
          <Button
            onClick={() => rename.mutate({ id: workspace.id, name, icon: icon || undefined })}
            disabled={locked || rename.isPending || !name.trim()}
          >
            Сохранить
          </Button>
        </Stack>
      </Stack>
    </Paper>
  )
}
```

- [ ] **Step 2: Create the server page**

```tsx
import { notFound } from "next/navigation"

import { getServerTRPC } from "@/trpc/server"
import { WorkspaceGeneralSection } from "@/components/workspace/settings/general-section"

type Props = { params: Promise<{ workspaceId: string }> }

export default async function WorkspaceSettingsGeneralPage({ params }: Props) {
  const { workspaceId } = await params
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getById({ id: workspaceId })
  if (!workspace) notFound()
  const { plan } = await trpc.subscription.getCurrent()

  return (
    <WorkspaceGeneralSection
      workspace={{ id: workspace.id, name: workspace.name, icon: workspace.icon }}
      locked={plan.slug === "free"}
    />
  )
}
```

- [ ] **Step 3: Type-check**

```bash
pnpm --filter web check-types
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(protected\)/workspaces/\[workspaceId\]/settings/general apps/web/src/components/workspace/settings/general-section.tsx
git commit -m "feat(web): workspace settings general (rename, plan-gated)"
```

---

### Task 20: Workspace settings — `/members`

**Files:**
- Create: `apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/members/page.tsx`
- Create: `apps/web/src/components/workspace/settings/members-section.tsx`

- [ ] **Step 1: Create the client section**

```tsx
"use client"

import { useState } from "react"

import {
  Alert,
  Button,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@repo/ui/components"

import { trpc } from "@/trpc/client"

type Props = {
  workspaceId: string
  locked: boolean
  currentUserId: string
}

export function WorkspaceMembersSection({ workspaceId, locked, currentUserId }: Props) {
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<"ADMIN" | "EDITOR" | "COMMENTER" | "VIEWER">("EDITOR")
  const utils = trpc.useUtils()
  const members = trpc.workspace.listMembers.useQuery({ workspaceId })
  const invite = trpc.workspace.inviteMember.useMutation({
    onSuccess: async () => {
      setEmail("")
      await utils.workspace.listMembers.invalidate({ workspaceId })
    },
  })
  const remove = trpc.workspace.removeMember.useMutation({
    onSuccess: async () => utils.workspace.listMembers.invalidate({ workspaceId }),
  })

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Stack spacing={2}>
        <Typography variant="h6">Участники</Typography>
        {locked ? (
          <Alert severity="info">
            Приглашения доступны на платных тарифах. <a href="/settings/billing">Апгрейд</a>
          </Alert>
        ) : null}
        {invite.error ? <Alert severity="error">{invite.error.message}</Alert> : null}
        {remove.error ? <Alert severity="error">{remove.error.message}</Alert> : null}

        <Stack direction="row" spacing={1} alignItems="flex-start">
          <TextField
            label="Email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={locked || invite.isPending}
            size="small"
            sx={{ flex: 1 }}
          />
          <Select
            value={role}
            onChange={(event) => setRole(event.target.value as typeof role)}
            disabled={locked || invite.isPending}
            size="small"
            sx={{ minWidth: 140 }}
          >
            <MenuItem value="ADMIN">Admin</MenuItem>
            <MenuItem value="EDITOR">Editor</MenuItem>
            <MenuItem value="COMMENTER">Commenter</MenuItem>
            <MenuItem value="VIEWER">Viewer</MenuItem>
          </Select>
          <Button
            onClick={() => invite.mutate({ workspaceId, email, role })}
            disabled={locked || invite.isPending || !email}
          >
            Пригласить
          </Button>
        </Stack>

        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Участник</TableCell>
              <TableCell>Роль</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {members.data?.map((member) => (
              <TableRow key={member.id}>
                <TableCell>
                  {member.user.firstName} {member.user.lastName}
                  <Typography component="span" color="text.secondary" sx={{ ml: 1 }}>
                    {member.user.email}
                  </Typography>
                </TableCell>
                <TableCell>{member.role}</TableCell>
                <TableCell align="right">
                  {member.userId !== currentUserId ? (
                    <Button
                      size="small"
                      color="error"
                      variant="outlined"
                      disabled={locked}
                      onClick={() =>
                        remove.mutate({ workspaceId, userId: member.userId })
                      }
                    >
                      Удалить
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Stack>
    </Paper>
  )
}
```

- [ ] **Step 2: Create the server page**

```tsx
import { notFound } from "next/navigation"

import { requireSession } from "@/lib/get-session"
import { getServerTRPC } from "@/trpc/server"
import { WorkspaceMembersSection } from "@/components/workspace/settings/members-section"

type Props = { params: Promise<{ workspaceId: string }> }

export default async function WorkspaceSettingsMembersPage({ params }: Props) {
  const { workspaceId } = await params
  const session = await requireSession()
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getById({ id: workspaceId })
  if (!workspace) notFound()
  const { plan } = await trpc.subscription.getCurrent()

  return (
    <WorkspaceMembersSection
      workspaceId={workspace.id}
      locked={plan.slug === "free"}
      currentUserId={session.user.id}
    />
  )
}
```

- [ ] **Step 3: Verify `Select`, `MenuItem` are exported from `@repo/ui/components`**

```bash
grep -E "Select|MenuItem" packages/ui/src/components/index.ts
```

If missing, add:
```ts
export { Select, MenuItem } from "@mui/material"
```

- [ ] **Step 4: Type-check and commit**

```bash
pnpm --filter web check-types
git add apps/web/src/app/\(protected\)/workspaces/\[workspaceId\]/settings/members apps/web/src/components/workspace/settings/members-section.tsx packages/ui/src/components/index.ts
git commit -m "feat(web): workspace settings members (invite/remove, gated)"
```

---

### Task 21: Workspace settings — `/danger` (delete)

**Files:**
- Create: `apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/danger/page.tsx`
- Create: `apps/web/src/components/workspace/settings/danger-section.tsx`

- [ ] **Step 1: Create the client section**

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { Alert, Button, Paper, Stack, TextField, Typography } from "@repo/ui/components"

import { trpc } from "@/trpc/client"

type Props = {
  workspace: { id: string; name: string }
  locked: boolean
}

export function WorkspaceDangerSection({ workspace, locked }: Props) {
  const [confirmation, setConfirmation] = useState("")
  const router = useRouter()
  const del = trpc.workspace.delete.useMutation({
    onSuccess: () => router.push("/workspaces"),
  })

  return (
    <Paper variant="outlined" sx={{ p: 3, borderColor: "error.main" }}>
      <Stack spacing={2}>
        <Typography variant="h6" color="error">
          Опасная зона
        </Typography>
        {locked ? (
          <Alert severity="info">
            Удаление доступно на платных тарифах. <a href="/settings/billing">Апгрейд</a>
          </Alert>
        ) : null}
        {del.error ? <Alert severity="error">{del.error.message}</Alert> : null}
        <Typography variant="body2" color="text.secondary">
          Удаление пространства необратимо. Все страницы, блоки и поисковые чаты будут удалены.
        </Typography>
        <TextField
          label={`Введите "${workspace.name}" для подтверждения`}
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          disabled={locked || del.isPending}
        />
        <Button
          color="error"
          onClick={() => del.mutate({ id: workspace.id })}
          disabled={locked || del.isPending || confirmation !== workspace.name}
        >
          Удалить пространство
        </Button>
      </Stack>
    </Paper>
  )
}
```

- [ ] **Step 2: Create the server page**

```tsx
import { notFound } from "next/navigation"

import { getServerTRPC } from "@/trpc/server"
import { WorkspaceDangerSection } from "@/components/workspace/settings/danger-section"

type Props = { params: Promise<{ workspaceId: string }> }

export default async function WorkspaceSettingsDangerPage({ params }: Props) {
  const { workspaceId } = await params
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getById({ id: workspaceId })
  if (!workspace) notFound()
  const { plan } = await trpc.subscription.getCurrent()

  return (
    <WorkspaceDangerSection
      workspace={{ id: workspace.id, name: workspace.name }}
      locked={plan.slug === "free"}
    />
  )
}
```

- [ ] **Step 3: Commit**

```bash
pnpm --filter web check-types
git add apps/web/src/app/\(protected\)/workspaces/\[workspaceId\]/settings/danger apps/web/src/components/workspace/settings/danger-section.tsx
git commit -m "feat(web): workspace settings danger zone (delete)"
```

---

## Group E — Search

### Task 22: `/workspaces/[id]/search` entry redirect

**Files:**
- Create: `apps/web/src/app/(protected)/workspaces/[workspaceId]/search/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
import { redirect } from "next/navigation"

import { getServerTRPC } from "@/trpc/server"

type Props = { params: Promise<{ workspaceId: string }> }

export default async function SearchIndexPage({ params }: Props) {
  const { workspaceId } = await params
  const trpc = await getServerTRPC()
  const chats = await trpc.search.listChats({ workspaceId })
  if (chats.length > 0) {
    redirect(`/workspaces/${workspaceId}/search/${chats[0]!.id}`)
  }
  const created = await trpc.search.createChat({ workspaceId })
  redirect(`/workspaces/${workspaceId}/search/${created.id}`)
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/\(protected\)/workspaces/\[workspaceId\]/search/page.tsx
git commit -m "feat(web): search index redirects to latest chat"
```

---

### Task 23: `/workspaces/[id]/search/[chatId]` chat view

**Files:**
- Create: `apps/web/src/app/(protected)/workspaces/[workspaceId]/search/[chatId]/page.tsx`
- Create: `apps/web/src/components/workspace/search/search-chat-view.tsx`
- Create: `apps/web/src/components/workspace/search/search-chat-input.tsx`

- [ ] **Step 1: Create the input component**

```tsx
"use client"

import { useState, useRef, useEffect } from "react"

import { Box, Button, Stack, TextField } from "@repo/ui/components"

import { trpc } from "@/trpc/client"

type Props = { chatId: string; workspaceId: string }

export function SearchChatInput({ chatId, workspaceId }: Props) {
  const [value, setValue] = useState("")
  const inputRef = useRef<HTMLInputElement | null>(null)
  const utils = trpc.useUtils()
  const send = trpc.search.sendMessage.useMutation({
    onSuccess: async () => {
      setValue("")
      await utils.search.getChat.invalidate({ chatId })
      await utils.search.listChats.invalidate({ workspaceId })
    },
  })

  useEffect(() => {
    inputRef.current?.focus()
  }, [chatId])

  return (
    <Box
      component="form"
      onSubmit={(event) => {
        event.preventDefault()
        if (!value.trim() || send.isPending) return
        send.mutate({ chatId, content: value.trim() })
      }}
      sx={{
        position: "sticky",
        bottom: 0,
        bgcolor: "background.default",
        borderTop: "1px solid",
        borderColor: "divider",
        p: 2,
      }}
    >
      <Stack direction="row" spacing={1} sx={{ maxWidth: 720, mx: "auto" }}>
        <TextField
          inputRef={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Спросите что-нибудь о пространстве..."
          size="small"
          fullWidth
          disabled={send.isPending}
        />
        <Button type="submit" disabled={!value.trim() || send.isPending}>
          Отправить
        </Button>
      </Stack>
    </Box>
  )
}
```

- [ ] **Step 2: Create the chat view**

```tsx
"use client"

import { Box, Paper, Stack, Typography } from "@repo/ui/components"

import { trpc } from "@/trpc/client"

import { SearchChatInput } from "./search-chat-input"

type Props = { chatId: string; workspaceId: string }

export function SearchChatView({ chatId, workspaceId }: Props) {
  const chat = trpc.search.getChat.useQuery({ chatId })

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <Box sx={{ flex: 1, overflowY: "auto", px: 3, py: 4 }}>
        <Stack spacing={2} sx={{ maxWidth: 720, mx: "auto" }}>
          {chat.data?.messages.length === 0 ? (
            <Typography color="text.secondary" textAlign="center">
              Начните новый поиск — напишите, что хотите найти
            </Typography>
          ) : null}
          {chat.data?.messages.map((message) => (
            <Paper
              key={message.id}
              variant="outlined"
              sx={{
                p: 2,
                alignSelf: message.role === "USER" ? "flex-end" : "flex-start",
                bgcolor:
                  message.role === "USER" ? "action.selected" : "background.paper",
                maxWidth: "80%",
              }}
            >
              <Typography variant="body1" sx={{ whiteSpace: "pre-wrap" }}>
                {message.content}
              </Typography>
            </Paper>
          ))}
        </Stack>
      </Box>
      <SearchChatInput chatId={chatId} workspaceId={workspaceId} />
    </Box>
  )
}
```

- [ ] **Step 3: Create the server page**

```tsx
import { notFound } from "next/navigation"

import { getServerTRPC } from "@/trpc/server"
import { SearchChatView } from "@/components/workspace/search/search-chat-view"

type Props = { params: Promise<{ workspaceId: string; chatId: string }> }

export default async function SearchChatPage({ params }: Props) {
  const { workspaceId, chatId } = await params
  const trpc = await getServerTRPC()
  try {
    await trpc.search.getChat({ chatId })
  } catch {
    notFound()
  }
  return <SearchChatView chatId={chatId} workspaceId={workspaceId} />
}
```

- [ ] **Step 4: Commit**

```bash
pnpm --filter web check-types
git add apps/web/src/app/\(protected\)/workspaces/\[workspaceId\]/search/\[chatId\] apps/web/src/components/workspace/search
git commit -m "feat(web): search chat view with echo pipeline"
```

---

### Task 24: `PageView` + `BlockRenderer` for data-driven start page

**Files:**
- Create: `apps/web/src/components/page/page-view.tsx`
- Create: `apps/web/src/components/page/block-renderer.tsx`

- [ ] **Step 1: Create the block renderer**

```tsx
import type { Block } from "@repo/db"

import { Box, Checkbox, Typography } from "@repo/ui/components"

type BlockContent = {
  text?: string
  checked?: boolean
  emoji?: string
  language?: string
}

export function BlockRenderer({ block }: { block: Block & { depth: number } }) {
  const content = (block.content ?? {}) as BlockContent
  const indent = block.depth * 24

  switch (block.type) {
    case "PARAGRAPH":
      return (
        <Typography sx={{ pl: `${indent}px`, my: 0.75 }}>{content.text}</Typography>
      )
    case "HEADING_1":
      return (
        <Typography variant="h3" sx={{ pl: `${indent}px`, mt: 3, mb: 1 }}>
          {content.text}
        </Typography>
      )
    case "HEADING_2":
      return (
        <Typography variant="h4" sx={{ pl: `${indent}px`, mt: 2.5, mb: 1 }}>
          {content.text}
        </Typography>
      )
    case "HEADING_3":
      return (
        <Typography variant="h5" sx={{ pl: `${indent}px`, mt: 2, mb: 0.75 }}>
          {content.text}
        </Typography>
      )
    case "TO_DO":
      return (
        <Box
          sx={{ display: "flex", alignItems: "center", gap: 1, pl: `${indent}px`, my: 0.25 }}
        >
          <Checkbox checked={!!content.checked} disabled size="small" />
          <Typography
            sx={{
              textDecoration: content.checked ? "line-through" : "none",
              color: content.checked ? "text.disabled" : "text.primary",
            }}
          >
            {content.text}
          </Typography>
        </Box>
      )
    case "BULLETED_LIST_ITEM":
      return (
        <Typography sx={{ pl: `${indent + 16}px`, my: 0.25 }}>• {content.text}</Typography>
      )
    case "NUMBERED_LIST_ITEM":
      return (
        <Typography sx={{ pl: `${indent + 16}px`, my: 0.25 }}>{content.text}</Typography>
      )
    case "TOGGLE":
      return (
        <Box component="details" sx={{ pl: `${indent}px`, my: 0.5 }}>
          <Box component="summary" sx={{ cursor: "pointer", listStyle: "none" }}>
            <Typography component="span">▸ {content.text}</Typography>
          </Box>
        </Box>
      )
    case "QUOTE":
      return (
        <Typography
          sx={{
            pl: `${indent + 12}px`,
            borderLeft: "3px solid",
            borderColor: "divider",
            my: 1,
            fontStyle: "italic",
          }}
        >
          {content.text}
        </Typography>
      )
    case "CALLOUT":
      return (
        <Box
          sx={{
            display: "flex",
            gap: 1,
            p: 1.5,
            borderRadius: 1,
            bgcolor: "action.hover",
            ml: `${indent}px`,
            my: 1,
          }}
        >
          <Typography component="span">{content.emoji ?? "💡"}</Typography>
          <Typography>{content.text}</Typography>
        </Box>
      )
    case "DIVIDER":
      return (
        <Box
          component="hr"
          sx={{ ml: `${indent}px`, border: 0, borderTop: "1px solid", borderColor: "divider", my: 1.5 }}
        />
      )
    case "CODE":
      return (
        <Box
          component="pre"
          sx={{
            ml: `${indent}px`,
            p: 1.5,
            borderRadius: 1,
            bgcolor: "action.hover",
            fontFamily: "var(--font-geist-mono)",
            fontSize: 13,
            overflowX: "auto",
          }}
        >
          {content.text}
        </Box>
      )
    default:
      return null
  }
}
```

- [ ] **Step 2: Create the page view**

```tsx
import type { Block, Page } from "@repo/db"

import { Box, Stack, Typography } from "@repo/ui/components"

import { BlockRenderer } from "./block-renderer"

type Props = {
  page: Page
  blocks: Array<Block & { depth: number }>
}

export function PageView({ page, blocks }: Props) {
  return (
    <Box sx={{ maxWidth: 720, mx: "auto", px: 3, py: 6 }}>
      <Stack spacing={1} sx={{ mb: 4 }}>
        {page.icon ? (
          <Typography sx={{ fontSize: 40, lineHeight: 1 }}>{page.icon}</Typography>
        ) : null}
        <Typography variant="h3">{page.title ?? "Untitled"}</Typography>
      </Stack>
      {blocks.map((block) => (
        <BlockRenderer key={block.id} block={block} />
      ))}
    </Box>
  )
}
```

- [ ] **Step 3: Type-check**

```bash
pnpm --filter web check-types
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/page
git commit -m "feat(web): PageView and BlockRenderer for data-driven pages"
```

---

### Task 25: Wire `/workspaces/[id]` to `PageView` and remove `WorkspaceOnboarding`

**Files:**
- Modify: `apps/web/src/app/(protected)/workspaces/[workspaceId]/page.tsx`
- Delete: `apps/web/src/components/workspace/workspace-onboarding.tsx`

- [ ] **Step 1: Rewrite the page**

```tsx
import { notFound } from "next/navigation"

import { getServerTRPC } from "@/trpc/server"
import { PageView } from "@/components/page/page-view"

type Props = { params: Promise<{ workspaceId: string }> }

export default async function WorkspaceRootPage({ params }: Props) {
  const { workspaceId } = await params
  const trpc = await getServerTRPC()
  const pages = await trpc.page.listByWorkspace({ workspaceId })
  if (pages.length === 0) notFound()

  const firstPage = pages[0]!
  const [page, blocks] = await Promise.all([
    trpc.page.getById({ id: firstPage.id }),
    trpc.block.listByPage({ pageId: firstPage.id }),
  ])

  return <PageView page={page} blocks={blocks} />
}
```

- [ ] **Step 2: Delete the old onboarding component**

```bash
rm apps/web/src/components/workspace/workspace-onboarding.tsx
```

- [ ] **Step 3: Type-check + build**

```bash
pnpm --filter web check-types
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(protected\)/workspaces/\[workspaceId\]/page.tsx apps/web/src/components/workspace/workspace-onboarding.tsx
git commit -m "feat(web): render workspace root via PageView from seeded blocks"
```

---

## Group F — Sidebar, Toolbar, Shell

### Task 26: `WorkspaceSidebar` — remove "Главная", add search section, settings link update

**Files:**
- Modify: `apps/web/src/components/workspace/workspace-sidebar.tsx`
- Create: `apps/web/src/components/workspace/search-sidebar-section.tsx`

- [ ] **Step 1: Create `SearchSidebarSection`**

```tsx
"use client"

import Link from "next/link"
import { useState } from "react"

import { Box, Stack, Typography } from "@repo/ui/components"

import { trpc } from "@/trpc/client"

type Props = { workspaceId: string; collapsed: boolean }

export function SearchSidebarSection({ workspaceId, collapsed }: Props) {
  const [open, setOpen] = useState(true)
  const chats = trpc.search.listChats.useQuery({ workspaceId })
  const create = trpc.search.createChat.useMutation()

  if (collapsed) {
    return (
      <Link href={`/workspaces/${workspaceId}/search`} style={{ textDecoration: "none" }}>
        <Box
          title="Поиск"
          sx={{
            display: "flex",
            justifyContent: "center",
            py: 0.75,
            color: "text.secondary",
            "&:hover": { color: "text.primary" },
          }}
        >
          ⌕
        </Box>
      </Link>
    )
  }

  return (
    <Box>
      <Box
        onClick={() => setOpen((prev) => !prev)}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1,
          py: 0.75,
          cursor: "pointer",
          color: "text.secondary",
          "&:hover": { color: "text.primary" },
        }}
      >
        <span>⌕</span>
        <span style={{ fontSize: 13, flex: 1 }}>Поиск</span>
        <span style={{ fontSize: 11 }}>{open ? "▾" : "▸"}</span>
      </Box>
      {open ? (
        <Stack spacing={0.25} sx={{ pl: 3 }}>
          {chats.data?.map((chat) => (
            <Link
              key={chat.id}
              href={`/workspaces/${workspaceId}/search/${chat.id}`}
              style={{ textDecoration: "none" }}
            >
              <Typography
                variant="body2"
                noWrap
                sx={{ py: 0.5, color: "text.secondary", "&:hover": { color: "text.primary" } }}
              >
                {chat.title}
              </Typography>
            </Link>
          ))}
          <Box
            onClick={() => create.mutate({ workspaceId })}
            sx={{
              cursor: "pointer",
              py: 0.5,
              color: "text.disabled",
              "&:hover": { color: "text.primary" },
              fontSize: 13,
            }}
          >
            ＋ Новый чат
          </Box>
        </Stack>
      ) : null}
    </Box>
  )
}
```

- [ ] **Step 2: Replace `WorkspaceSidebar`**

```tsx
"use client"

import Link from "next/link"

import { Box, Stack, Tooltip, Typography } from "@repo/ui/components"

import { SearchSidebarSection } from "./search-sidebar-section"

type Props = {
  workspace: { id: string; name: string; icon: string | null }
  planName: string
  pages: Array<{ id: string; title: string | null; icon: string | null }>
  collapsed: boolean
  onToggleCollapsed: () => void
  userMenu: React.ReactNode
}

export function WorkspaceSidebar({
  workspace,
  planName,
  pages,
  collapsed,
  onToggleCollapsed,
  userMenu,
}: Props) {
  const width = collapsed ? 56 : 240
  return (
    <Box
      component="aside"
      sx={{
        width,
        borderRight: "1px solid",
        borderColor: "divider",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.paper",
        px: collapsed ? 0.5 : 1.25,
        py: 1.75,
        transition: "width 150ms ease",
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: collapsed ? 0 : 1, pb: 1.75, justifyContent: collapsed ? "center" : "flex-start" }}>
        <Box
          sx={{
            width: 24,
            height: 24,
            borderRadius: 0.75,
            background: "linear-gradient(135deg,#0f766e,#155e75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 14,
          }}
        >
          {workspace.icon ?? "📒"}
        </Box>
        {collapsed ? null : (
          <Stack spacing={0}>
            <Typography variant="body2">{workspace.name}</Typography>
            <Typography variant="caption" color="text.secondary">
              {planName} plan
            </Typography>
          </Stack>
        )}
      </Stack>

      <Stack spacing={0.25} sx={{ py: 0.75 }}>
        <SearchSidebarSection workspaceId={workspace.id} collapsed={collapsed} />
        <NavItem
          icon="⚙"
          label="Настройки"
          href={`/workspaces/${workspace.id}/settings`}
          collapsed={collapsed}
        />
      </Stack>

      {collapsed ? null : (
        <Typography
          variant="overline"
          sx={{ color: "text.disabled", px: 1, pt: 2, pb: 0.5, letterSpacing: "0.06em" }}
        >
          Страницы
        </Typography>
      )}
      <Stack spacing={0.25}>
        {pages.map((page) => (
          <NavItem
            key={page.id}
            icon={page.icon ?? "📄"}
            label={page.title ?? "Untitled"}
            href={`/workspaces/${workspace.id}`}
            collapsed={collapsed}
          />
        ))}
        <NavItem icon="＋" label="Новая страница" href="#" collapsed={collapsed} muted />
      </Stack>

      <Box sx={{ flex: 1 }} />

      <Box sx={{ borderTop: "1px solid", borderColor: "divider", pt: 1.25 }}>
        <NavItem icon="🗑" label="Корзина" href="#" collapsed={collapsed} muted />
      </Box>

      <Box
        onClick={onToggleCollapsed}
        sx={{
          cursor: "pointer",
          textAlign: "center",
          color: "text.disabled",
          py: 0.75,
          "&:hover": { color: "text.primary" },
        }}
      >
        {collapsed ? "▸" : "◂"}
      </Box>

      <Box sx={{ borderTop: "1px solid", borderColor: "divider", pt: 1 }}>{userMenu}</Box>
    </Box>
  )
}

function NavItem({
  icon,
  label,
  href,
  collapsed,
  active,
  muted,
}: {
  icon: string
  label: string
  href: string
  collapsed: boolean
  active?: boolean
  muted?: boolean
}) {
  const body = (
    <Box
      component={Link}
      href={href}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: collapsed ? 0 : 1,
        py: 0.75,
        justifyContent: collapsed ? "center" : "flex-start",
        borderRadius: 0.75,
        textDecoration: "none",
        color: active
          ? "text.primary"
          : muted
            ? "text.disabled"
            : "text.secondary",
        backgroundColor: active ? "action.selected" : "transparent",
        "&:hover": { backgroundColor: active ? "action.selected" : "action.hover" },
        fontSize: 13,
      }}
    >
      <span>{icon}</span>
      {collapsed ? null : <span>{label}</span>}
    </Box>
  )
  if (collapsed) {
    return (
      <Tooltip title={label} placement="right">
        {body}
      </Tooltip>
    )
  }
  return body
}
```

- [ ] **Step 3: Verify `Tooltip` and `Checkbox` are exported**

```bash
grep -E "Tooltip|Checkbox" packages/ui/src/components/index.ts
```

If missing, add `export { Tooltip, Checkbox } from "@mui/material"`.

- [ ] **Step 4: Commit**

```bash
pnpm --filter web check-types
git add apps/web/src/components/workspace/workspace-sidebar.tsx apps/web/src/components/workspace/search-sidebar-section.tsx packages/ui/src/components/index.ts
git commit -m "feat(web): workspace sidebar with search section and collapse"
```

---

### Task 27: `WorkspaceUserMenu` footer component

**Files:**
- Create: `apps/web/src/components/workspace/workspace-user-menu.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client"

import Link from "next/link"
import { useState } from "react"

import {
  Avatar,
  Box,
  Menu,
  MenuItem,
  Stack,
  Typography,
} from "@repo/ui/components"

import { signOut } from "@/lib/auth-client"

type Props = {
  user: { firstName: string; lastName: string; email: string }
  collapsed: boolean
}

export function WorkspaceUserMenu({ user, collapsed }: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const initials = `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase()

  return (
    <>
      <Box
        onClick={(event) => setAnchor(event.currentTarget)}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          p: 0.75,
          borderRadius: 0.75,
          cursor: "pointer",
          justifyContent: collapsed ? "center" : "flex-start",
          "&:hover": { bgcolor: "action.hover" },
        }}
      >
        <Avatar
          sx={{
            width: 28,
            height: 28,
            fontSize: 13,
            background: "linear-gradient(135deg,#0f766e,#155e75)",
          }}
        >
          {initials}
        </Avatar>
        {collapsed ? null : (
          <Stack spacing={0} sx={{ minWidth: 0 }}>
            <Typography variant="body2" noWrap>
              {user.firstName} {user.lastName}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {user.email}
            </Typography>
          </Stack>
        )}
      </Box>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        <MenuItem component={Link} href="/profile" onClick={() => setAnchor(null)}>
          Мой профиль
        </MenuItem>
        <MenuItem component={Link} href="/settings/general" onClick={() => setAnchor(null)}>
          Настройки
        </MenuItem>
        <MenuItem
          onClick={async () => {
            setAnchor(null)
            await signOut()
          }}
        >
          Выйти
        </MenuItem>
      </Menu>
    </>
  )
}
```

- [ ] **Step 2: Verify `Menu` is exported from `@repo/ui/components`**

```bash
grep -E "\\bMenu\\b" packages/ui/src/components/index.ts
```

If not, add `export { Menu } from "@mui/material"`.

- [ ] **Step 3: Commit**

```bash
pnpm --filter web check-types
git add apps/web/src/components/workspace/workspace-user-menu.tsx packages/ui/src/components/index.ts
git commit -m "feat(web): workspace footer user menu"
```

---

### Task 28: `WorkspaceToolbar` cleanup (remove Share / ⋯ / New AI chat)

**Files:**
- Modify: `apps/web/src/components/workspace/workspace-toolbar.tsx`

- [ ] **Step 1: Replace the file**

```tsx
import { Box, Stack, Typography } from "@repo/ui/components"

type Props = {
  pageTitle: string
  pageIcon?: string | null
  editedLabel: string
}

export function WorkspaceToolbar({ pageTitle, pageIcon, editedLabel }: Props) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1.25}
      sx={{
        px: 2,
        py: 1.25,
        borderBottom: "1px solid",
        borderColor: "divider",
      }}
    >
      <Typography variant="body2" noWrap>
        {pageIcon ? `${pageIcon} ` : ""}
        {pageTitle}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        ·
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Private
      </Typography>
      <Box sx={{ flex: 1 }} />
      <Typography variant="caption" color="text.secondary">
        {editedLabel}
      </Typography>
    </Stack>
  )
}
```

- [ ] **Step 2: Commit**

```bash
pnpm --filter web check-types
git add apps/web/src/components/workspace/workspace-toolbar.tsx
git commit -m "refactor(web): strip Share/more/AI from WorkspaceToolbar"
```

---

### Task 29: Delete `WorkspaceAiPanel` + update `/workspaces/[id]/layout.tsx`

**Files:**
- Delete: `apps/web/src/components/workspace/workspace-ai-panel.tsx`
- Delete: `apps/web/src/components/workspace/cookie-banner.tsx` (if present; it was part of the AI panel layout)
- Modify: `apps/web/src/app/(protected)/workspaces/[workspaceId]/layout.tsx`

- [ ] **Step 1: Delete the files**

```bash
rm apps/web/src/components/workspace/workspace-ai-panel.tsx
rm -f apps/web/src/components/workspace/cookie-banner.tsx
```

- [ ] **Step 2: Rewrite the workspace layout**

```tsx
import { notFound } from "next/navigation"

import { getServerTRPC } from "@/trpc/server"
import { requireSession } from "@/lib/get-session"
import { WorkspaceShell } from "@/components/workspace/workspace-shell"
import { WorkspaceSidebar } from "@/components/workspace/workspace-sidebar"
import { WorkspaceToolbar } from "@/components/workspace/workspace-toolbar"
import { WorkspaceUserMenu } from "@/components/workspace/workspace-user-menu"
import { WorkspaceLayoutClient } from "@/components/workspace/workspace-layout-client"

type Props = {
  children: React.ReactNode
  params: Promise<{ workspaceId: string }>
}

export default async function WorkspaceLayout({ children, params }: Props) {
  const { workspaceId } = await params
  const session = await requireSession()
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getById({ id: workspaceId })
  if (!workspace) notFound()
  const pages = await trpc.page.listByWorkspace({ workspaceId })
  const { plan } = await trpc.subscription.getCurrent()

  return (
    <WorkspaceLayoutClient
      workspace={{ id: workspace.id, name: workspace.name, icon: workspace.icon }}
      planName={plan.name}
      pages={pages.map((p) => ({ id: p.id, title: p.title, icon: p.icon }))}
      user={{
        firstName: session.user.firstName,
        lastName: session.user.lastName,
        email: session.user.email,
      }}
      firstPageTitle={pages[0]?.title ?? "Untitled"}
      firstPageIcon={pages[0]?.icon ?? null}
    >
      {children}
    </WorkspaceLayoutClient>
  )
}
```

- [ ] **Step 3: Create the client layout wrapper**

`apps/web/src/components/workspace/workspace-layout-client.tsx`:

```tsx
"use client"

import { useEffect, useState, type ReactNode } from "react"

import { Box } from "@repo/ui/components"

import { WorkspaceShell } from "./workspace-shell"
import { WorkspaceSidebar } from "./workspace-sidebar"
import { WorkspaceToolbar } from "./workspace-toolbar"
import { WorkspaceUserMenu } from "./workspace-user-menu"

type Props = {
  workspace: { id: string; name: string; icon: string | null }
  planName: string
  pages: Array<{ id: string; title: string | null; icon: string | null }>
  user: { firstName: string; lastName: string; email: string }
  firstPageTitle: string
  firstPageIcon: string | null
  children: ReactNode
}

const STORAGE_KEY = "workspace.sidebar.collapsed"

export function WorkspaceLayoutClient({
  workspace,
  planName,
  pages,
  user,
  firstPageTitle,
  firstPageIcon,
  children,
}: Props) {
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === "true") setCollapsed(true)
  }, [])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, String(collapsed))
  }, [collapsed])

  const sidebarWidth = collapsed ? 56 : 240

  return (
    <WorkspaceShell
      sidebarWidth={sidebarWidth}
      sidebar={
        <WorkspaceSidebar
          workspace={workspace}
          planName={planName}
          pages={pages}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((prev) => !prev)}
          userMenu={<WorkspaceUserMenu user={user} collapsed={collapsed} />}
        />
      }
      main={
        <Box>
          <WorkspaceToolbar
            pageTitle={firstPageTitle}
            pageIcon={firstPageIcon}
            editedLabel="Edited just now"
          />
          {children}
        </Box>
      }
    />
  )
}
```

- [ ] **Step 4: Type-check + build**

```bash
pnpm check-types && pnpm --filter web build
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(protected\)/workspaces/\[workspaceId\]/layout.tsx apps/web/src/components/workspace/workspace-layout-client.tsx apps/web/src/components/workspace/workspace-ai-panel.tsx apps/web/src/components/workspace/cookie-banner.tsx
git commit -m "refactor(web): remove AI panel, wire collapsible shell"
```

---

### Task 30: Update e2e spec + final verification

**Files:**
- Modify: `apps/e2e/workspace-flow.spec.ts`

- [ ] **Step 1: Update the existing spec**

Edit `apps/e2e/workspace-flow.spec.ts` so it no longer expects "Главная" and clicks the new settings link. Focus on three assertions: sign up → reach workspace → open `/workspaces/[id]/settings/general` via sidebar Settings → see the rename card.

```ts
import { test, expect } from "@playwright/test"

const email = `review+${Date.now()}@example.com`
const password = "SuperSecure123!"

test("workspace + settings happy path", async ({ page }) => {
  await page.goto("/sign-up")
  await page.getByRole("textbox", { name: "Email" }).fill(email)
  await page.getByRole("textbox", { name: "Фамилия" }).fill("Ревьюер")
  await page.getByRole("textbox", { name: "Имя" }).fill("Тест")
  await page.getByRole("textbox", { name: /^пароль$/i }).fill(password)
  await page.getByRole("textbox", { name: "Повторите пароль" }).fill(password)
  await page.getByRole("button", { name: "Зарегистрироваться" }).click()

  await page.waitForURL(/\/workspaces\/new/)
  await page.getByRole("textbox", { name: "Название" }).fill("Рабочее пространство")
  await page.getByRole("button", { name: "Создать пространство" }).click()

  await page.waitForURL(/\/workspaces\/[a-f0-9-]+$/)
  await expect(page.getByRole("heading", { name: "Welcome to AnyNote" })).toBeVisible()

  await page.getByRole("link", { name: "Настройки" }).click()
  await page.waitForURL(/\/settings\/general$/)
  await expect(page.getByRole("heading", { name: "Общее" })).toBeVisible()
})

test("free plan blocks second workspace create", async ({ page }) => {
  const email2 = `review2+${Date.now()}@example.com`
  await page.goto("/sign-up")
  await page.getByRole("textbox", { name: "Email" }).fill(email2)
  await page.getByRole("textbox", { name: "Фамилия" }).fill("Ревьюер")
  await page.getByRole("textbox", { name: "Имя" }).fill("Тест")
  await page.getByRole("textbox", { name: /^пароль$/i }).fill(password)
  await page.getByRole("textbox", { name: "Повторите пароль" }).fill(password)
  await page.getByRole("button", { name: "Зарегистрироваться" }).click()

  await page.waitForURL(/\/workspaces\/new/)
  await page.getByRole("textbox", { name: "Название" }).fill("Первое")
  await page.getByRole("button", { name: "Создать пространство" }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+$/)

  await page.goto("/workspaces/new")
  await page.getByRole("textbox", { name: "Название" }).fill("Второе")
  await page.getByRole("button", { name: "Создать пространство" }).click()
  await expect(page.getByText(/можно создать не больше/)).toBeVisible()
})
```

- [ ] **Step 2: Run e2e tests**

```bash
pnpm exec playwright test apps/e2e/workspace-flow.spec.ts
```

Expected: both tests green. Dev server must be running on 3000 first.

- [ ] **Step 3: Full verification suite**

```bash
pnpm run lint
pnpm run format
pnpm run check-types
pnpm run build
```

Expected: all green. No Turbopack warnings.

- [ ] **Step 4: Commit**

```bash
git add apps/e2e/workspace-flow.spec.ts
git commit -m "test(e2e): workspace flow with new sidebar and settings path"
```

---

## Verification Checklist

After all 30 tasks:

- [ ] `pnpm run lint` clean
- [ ] `pnpm run check-types` clean
- [ ] `pnpm run build` clean, zero Turbopack warnings, especially no `export *` Prisma warning
- [ ] `pnpm exec playwright test` both specs green
- [ ] Manual smoke in Playwright MCP on: `/profile`, `/settings` (redirect), `/workspaces` (redirect), `/workspaces/[id]` (renders seeded blocks), `/workspaces/[id]/search` (creates first chat), `/workspaces/[id]/settings/general` (rename section visible, buttons disabled for free plan)
- [ ] Sidebar collapse toggle persists across reload
- [ ] Theme switch in user menu reflects in workspace area (no more forced dark)

---

## Commit Message Convention

All commits from this plan end with:

```
Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

Controller is expected to append it via HEREDOC as in prior workflows; tasks above show the subject line only for brevity.
