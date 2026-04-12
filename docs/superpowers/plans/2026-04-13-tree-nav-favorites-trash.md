# Tree Navigation, Favorites & Trash Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace flat page/chat lists in the sidebar with tree views (MUI X Tree View), add favorites section, implement trash page with soft-delete/restore/hard-delete, and add page context menu with actions.

**Architecture:** Schema changes add `prevPageId` linked-list to Page, `parentId` to SearchChat, and a new `FavoritePage` join table. The page tRPC router gets 10 new procedures (CRUD, move, favorites, trash). Frontend uses MUI X `RichTreeView` for pages (D&D) and `SimpleTreeView` for chats. A new `/workspaces/[workspaceId]/trash` route shows soft-deleted pages.

**Tech Stack:** Prisma 7, tRPC v11, MUI X Tree View, React 19, Next.js 16 App Router

**Spec:** `docs/superpowers/specs/2026-04-13-tree-nav-favorites-trash-design.md`

---

## File Structure

### Schema & DB
- Modify: `packages/db/prisma/schema.prisma` — add `prevPageId` to Page, `parentId` to SearchChat, new `FavoritePage` model
- Modify: `packages/db/src/index.ts` — re-export `FavoritePage` type

### UI Package
- Modify: `packages/ui/package.json` — add `@mui/x-tree-view` dependency
- Modify: `packages/ui/src/components/index.ts` — re-export Tree View components + new icons

### tRPC Routers
- Modify: `packages/trpc/src/routers/page.ts` — expand from 2 to 12 procedures
- Modify: `packages/trpc/src/routers/search.ts` — add `parentId` to listChats/createChat/deleteChat

### Frontend Components
- Create: `apps/web/src/components/workspace/page-tree-section.tsx` — tree view for pages with hover actions
- Create: `apps/web/src/components/workspace/page-context-menu.tsx` — MoreHoriz menu for pages
- Create: `apps/web/src/components/workspace/favorites-section.tsx` — favorites tree section
- Create: `apps/web/src/components/workspace/move-page-dialog.tsx` — modal with tree picker for moving pages
- Modify: `apps/web/src/components/workspace/search-sidebar-section.tsx` — replace flat list with tree + add AddIcon
- Modify: `apps/web/src/components/workspace/workspace-sidebar.tsx` — integrate new sections
- Modify: `apps/web/src/components/workspace/workspace-layout-client.tsx` — pass userId, update page type

### Routes
- Create: `apps/web/src/app/(protected)/workspaces/[workspaceId]/trash/page.tsx` — trash page
- Create: `apps/web/src/app/(protected)/workspaces/[workspaceId]/pages/[pageId]/page.tsx` — page view (stub)
- Modify: `apps/web/src/app/(protected)/workspaces/[workspaceId]/layout.tsx` — pass userId to layout client

---

## Task 1: Schema Changes (Prisma)

**Files:**
- Modify: `packages/db/prisma/schema.prisma:10-36` (User model — add FavoritePage relation)
- Modify: `packages/db/prisma/schema.prisma:167-184` (Workspace — add FavoritePage relation not needed, it's user-level)
- Modify: `packages/db/prisma/schema.prisma:204-229` (Page model)
- Modify: `packages/db/prisma/schema.prisma:256-270` (SearchChat model)
- Modify: `packages/db/src/index.ts` (re-export FavoritePage type)

- [ ] **Step 1: Add `prevPageId` to Page model**

In `packages/db/prisma/schema.prisma`, add the linked-list field to the Page model (after line 213 `archived`):

```prisma
  prevPageId    String?    @unique @map("prev_page_id") @db.Uuid
```

And add the self-relations (after line 223 `blocks Block[]`):

```prisma
  prevPage  Page?  @relation("PageOrder", fields: [prevPageId], references: [id], onDelete: SetNull)
  nextPage  Page?  @relation("PageOrder")
  children  Page[] @relation("PageTree")
  parent    Page?  @relation("PageTree", fields: [parentId], references: [id], onDelete: SetNull)
  favorites FavoritePage[]
```

Note: The Page model already has `parentId` and `parentType` fields. We'll use `parentId` with `parentType = PAGE` for child pages, and `parentType = WORKSPACE` for root pages. The new `parent` relation makes Prisma aware of the self-reference.

- [ ] **Step 2: Add `parentId` to SearchChat model**

In `packages/db/prisma/schema.prisma`, add to SearchChat model (after line 260 `title`):

```prisma
  parentId    String?  @map("parent_id") @db.Uuid
```

Add self-relations (after line 266 `messages`):

```prisma
  parent   SearchChat?  @relation("ChatTree", fields: [parentId], references: [id], onDelete: Cascade)
  children SearchChat[] @relation("ChatTree")
```

- [ ] **Step 3: Add FavoritePage model**

Add after the SearchMessage model (after line 284):

```prisma
model FavoritePage {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  pageId    String   @map("page_id") @db.Uuid
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  page Page @relation(fields: [pageId], references: [id], onDelete: Cascade)

  @@unique([userId, pageId])
  @@index([userId])
  @@map("favorite_pages")
}
```

- [ ] **Step 4: Add relations on User model**

In the User model (around line 33), add:

```prisma
  favoritePages FavoritePage[]
```

- [ ] **Step 5: Re-export FavoritePage type**

In `packages/db/src/index.ts`, add `FavoritePage` to the type re-exports (line 46-62):

```typescript
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
  FavoritePage,
} from "@prisma/client"
```

- [ ] **Step 6: Generate Prisma client and push schema**

```bash
pnpm --filter @repo/db prisma:generate
pnpm --filter @repo/db prisma:db-push
```

Expected: Schema pushed successfully, client regenerated.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/src/index.ts
git commit -m "feat(db): add prevPageId, SearchChat.parentId, and FavoritePage model"
```

---

## Task 2: MUI X Tree View in UI Package

**Files:**
- Modify: `packages/ui/package.json`
- Modify: `packages/ui/src/components/index.ts`

- [ ] **Step 1: Install @mui/x-tree-view**

```bash
pnpm --filter @repo/ui add @mui/x-tree-view
```

- [ ] **Step 2: Add Tree View re-exports to components/index.ts**

In `packages/ui/src/components/index.ts`, add after the existing exports:

```typescript
export { SimpleTreeView } from "@mui/x-tree-view/SimpleTreeView"
export { RichTreeView } from "@mui/x-tree-view/RichTreeView"
export { TreeItem } from "@mui/x-tree-view/TreeItem"
export type { TreeViewBaseItem } from "@mui/x-tree-view/models"
```

- [ ] **Step 3: Add new icon re-exports**

In `packages/ui/src/components/index.ts`, add the icons needed for page actions:

```typescript
export { default as StarIcon } from "@mui/icons-material/Star"
export { default as StarBorderIcon } from "@mui/icons-material/StarBorder"
export { default as LinkIcon } from "@mui/icons-material/Link"
export { default as ContentCopyIcon } from "@mui/icons-material/ContentCopy"
export { default as MovingIcon } from "@mui/icons-material/Moving"
export { default as RestoreIcon } from "@mui/icons-material/Restore"
export { default as DeleteForeverIcon } from "@mui/icons-material/DeleteForever"
```

- [ ] **Step 4: Verify build**

```bash
pnpm check-types
```

Expected: Only pre-existing TS2742 error in trpc/client.tsx.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/package.json packages/ui/src/components/index.ts pnpm-lock.yaml
git commit -m "feat(ui): add MUI X Tree View and new icons to shared UI package"
```

---

## Task 3: Page tRPC Router — Core CRUD

**Files:**
- Modify: `packages/trpc/src/routers/page.ts`

This task expands the page router from 2 procedures to include: `create`, `rename`, `softDelete`, `restore`, `hardDelete`, `listTrashed`. The linked-list helpers and access control are added here.

- [ ] **Step 1: Add helpers and expand listByWorkspace**

Replace `packages/trpc/src/routers/page.ts` entirely:

```typescript
import { z } from "zod"
import { TRPCError } from "@trpc/server"
import type { PrismaClient } from "@repo/db"

import { router, protectedProcedure } from "../trpc"

async function assertWorkspaceMember(
  ctx: { prisma: PrismaClient; user: { id: string } },
  workspaceId: string,
) {
  const member = await ctx.prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: ctx.user.id } },
  })
  if (!member) throw new TRPCError({ code: "FORBIDDEN", message: "Нет доступа к пространству" })
  return member
}

async function assertPageAccess(
  ctx: { prisma: PrismaClient; user: { id: string } },
  pageId: string,
) {
  const page = await ctx.prisma.page.findFirst({
    where: { id: pageId, workspace: { members: { some: { userId: ctx.user.id } } } },
  })
  if (!page) throw new TRPCError({ code: "NOT_FOUND", message: "Страница не найдена" })
  return page
}

async function assertPageOwnership(
  ctx: { prisma: PrismaClient; user: { id: string } },
  pageId: string,
  workspaceId: string,
) {
  const page = await assertPageAccess(ctx, pageId)
  if (page.createdById === ctx.user.id) return page
  const member = await ctx.prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: ctx.user.id } },
  })
  if (member?.role !== "OWNER") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Только создатель или владелец пространства" })
  }
  return page
}

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
      await assertWorkspaceMember(ctx, input.workspaceId)
      return ctx.prisma.page.findMany({
        where: {
          workspaceId: input.workspaceId,
          archived: false,
          deletedAt: null,
        },
        select: {
          id: true,
          title: true,
          icon: true,
          parentType: true,
          parentId: true,
          prevPageId: true,
          createdById: true,
          createdAt: true,
        },
      })
    }),

  create: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        parentId: z.string().uuid().nullable(),
        title: z.string().max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      return ctx.prisma.$transaction(async (tx) => {
        const page = await tx.page.create({
          data: {
            workspaceId: input.workspaceId,
            parentType: input.parentId ? "PAGE" : "WORKSPACE",
            parentId: input.parentId ?? input.workspaceId,
            title: input.title ?? "Untitled",
            prevPageId: null,
            createdById: ctx.user.id,
            updatedById: ctx.user.id,
          },
        })
        // Push existing first sibling to point to the new page
        const existingFirst = await tx.page.findFirst({
          where: {
            workspaceId: input.workspaceId,
            parentType: input.parentId ? "PAGE" : "WORKSPACE",
            parentId: input.parentId ?? input.workspaceId,
            prevPageId: null,
            id: { not: page.id },
            deletedAt: null,
          },
        })
        if (existingFirst) {
          await tx.page.update({
            where: { id: existingFirst.id },
            data: { prevPageId: page.id },
          })
        }
        return page
      })
    }),

  rename: protectedProcedure
    .input(z.object({ pageId: z.string().uuid(), title: z.string().min(1).max(255) }))
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageAccess(ctx, input.pageId)
      await assertPageOwnership(ctx, input.pageId, page.workspaceId)
      return ctx.prisma.page.update({
        where: { id: input.pageId },
        data: { title: input.title, updatedById: ctx.user.id },
      })
    }),

  softDelete: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageAccess(ctx, input.pageId)
      await assertPageOwnership(ctx, input.pageId, page.workspaceId)
      return ctx.prisma.$transaction(async (tx) => {
        // Collect all descendant IDs recursively
        const allIds = [page.id]
        const queue = [page.id]
        while (queue.length > 0) {
          const parentId = queue.shift()!
          const children = await tx.page.findMany({
            where: { parentId, parentType: "PAGE", deletedAt: null },
            select: { id: true },
          })
          for (const child of children) {
            allIds.push(child.id)
            queue.push(child.id)
          }
        }
        // Remove from linked-list: find the next sibling and rewire
        const nextSibling = await tx.page.findFirst({
          where: {
            workspaceId: page.workspaceId,
            parentType: page.parentType,
            parentId: page.parentId,
            prevPageId: page.id,
            deletedAt: null,
          },
        })
        if (nextSibling) {
          await tx.page.update({
            where: { id: nextSibling.id },
            data: { prevPageId: page.prevPageId },
          })
        }
        // Soft-delete all
        const now = new Date()
        await tx.page.updateMany({
          where: { id: { in: allIds } },
          data: { deletedAt: now, prevPageId: null },
        })
        return { deletedCount: allIds.length }
      })
    }),

  listTrashed: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      return ctx.prisma.page.findMany({
        where: {
          workspaceId: input.workspaceId,
          deletedAt: { not: null },
        },
        orderBy: { deletedAt: "desc" },
        select: {
          id: true,
          title: true,
          icon: true,
          deletedAt: true,
          createdById: true,
          parentId: true,
          parentType: true,
        },
      })
    }),

  restore: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const page = await ctx.prisma.page.findFirst({
        where: { id: input.pageId, workspace: { members: { some: { userId: ctx.user.id } } } },
      })
      if (!page) throw new TRPCError({ code: "NOT_FOUND" })
      await assertPageOwnership(ctx, input.pageId, page.workspaceId)
      return ctx.prisma.$transaction(async (tx) => {
        // Collect all descendant IDs (they were soft-deleted together)
        const allIds = [page.id]
        const queue = [page.id]
        while (queue.length > 0) {
          const parentId = queue.shift()!
          const children = await tx.page.findMany({
            where: { parentId, parentType: "PAGE", deletedAt: { not: null } },
            select: { id: true },
          })
          for (const child of children) {
            allIds.push(child.id)
            queue.push(child.id)
          }
        }
        // Check if parent is still alive
        const parentAlive =
          page.parentType === "WORKSPACE"
            ? true
            : await tx.page
                .findFirst({
                  where: { id: page.parentId!, deletedAt: null },
                  select: { id: true },
                })
                .then((p) => !!p)

        // If parent is deleted, move to workspace root
        const newParentType = parentAlive ? page.parentType : "WORKSPACE"
        const newParentId = parentAlive ? page.parentId : page.workspaceId

        // Restore all descendants
        await tx.page.updateMany({
          where: { id: { in: allIds } },
          data: { deletedAt: null },
        })

        // Insert restored page at start of its parent's linked-list
        const existingFirst = await tx.page.findFirst({
          where: {
            workspaceId: page.workspaceId,
            parentType: newParentType,
            parentId: newParentId,
            prevPageId: null,
            id: { not: page.id },
            deletedAt: null,
          },
        })
        await tx.page.update({
          where: { id: page.id },
          data: { parentType: newParentType, parentId: newParentId, prevPageId: null },
        })
        if (existingFirst) {
          await tx.page.update({
            where: { id: existingFirst.id },
            data: { prevPageId: page.id },
          })
        }
        return { restoredCount: allIds.length }
      })
    }),

  hardDelete: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const page = await ctx.prisma.page.findFirst({
        where: { id: input.pageId, workspace: { members: { some: { userId: ctx.user.id } } } },
      })
      if (!page) throw new TRPCError({ code: "NOT_FOUND" })
      await assertPageOwnership(ctx, input.pageId, page.workspaceId)
      // Cascade delete handles blocks via DB-level onDelete: Cascade
      await ctx.prisma.page.delete({ where: { id: input.pageId } })
      return { ok: true }
    }),
})
```

- [ ] **Step 2: Verify types compile**

```bash
pnpm check-types
```

Expected: Only pre-existing TS2742 error.

- [ ] **Step 3: Commit**

```bash
git add packages/trpc/src/routers/page.ts
git commit -m "feat(trpc): expand page router with create, rename, softDelete, restore, hardDelete, listTrashed"
```

---

## Task 4: Page tRPC Router — Move, Duplicate, Favorites

**Files:**
- Modify: `packages/trpc/src/routers/page.ts`

- [ ] **Step 1: Add move, duplicate, addFavorite, removeFavorite, listFavorites**

Add these procedures to the `pageRouter` object in `packages/trpc/src/routers/page.ts`, before the closing `})`:

```typescript
  move: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        newParentId: z.string().uuid().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageAccess(ctx, input.pageId)
      await assertPageOwnership(ctx, input.pageId, page.workspaceId)
      return ctx.prisma.$transaction(async (tx) => {
        // 1. Remove from old linked-list
        const oldNext = await tx.page.findFirst({
          where: {
            workspaceId: page.workspaceId,
            parentType: page.parentType,
            parentId: page.parentId,
            prevPageId: page.id,
            deletedAt: null,
          },
        })
        if (oldNext) {
          await tx.page.update({
            where: { id: oldNext.id },
            data: { prevPageId: page.prevPageId },
          })
        }

        // 2. Set new parent
        const newParentType = input.newParentId ? "PAGE" : "WORKSPACE"
        const newParentId = input.newParentId ?? page.workspaceId

        // 3. Prevent moving into own descendant
        if (input.newParentId) {
          let checkId: string | null = input.newParentId
          while (checkId) {
            if (checkId === page.id) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Нельзя переместить страницу в собственного потомка",
              })
            }
            const parent = await tx.page.findUnique({
              where: { id: checkId },
              select: { parentId: true, parentType: true },
            })
            checkId = parent?.parentType === "PAGE" ? parent.parentId : null
          }
        }

        // 4. Insert at start of new parent's linked-list
        const existingFirst = await tx.page.findFirst({
          where: {
            workspaceId: page.workspaceId,
            parentType: newParentType,
            parentId: newParentId,
            prevPageId: null,
            id: { not: page.id },
            deletedAt: null,
          },
        })
        await tx.page.update({
          where: { id: page.id },
          data: {
            parentType: newParentType as "WORKSPACE" | "PAGE",
            parentId: newParentId,
            prevPageId: null,
          },
        })
        if (existingFirst) {
          await tx.page.update({
            where: { id: existingFirst.id },
            data: { prevPageId: page.id },
          })
        }
        return tx.page.findUnique({ where: { id: page.id } })
      })
    }),

  duplicate: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageAccess(ctx, input.pageId)
      return ctx.prisma.$transaction(async (tx) => {
        // Create copy with same parent, title "(копия)"
        const copy = await tx.page.create({
          data: {
            workspaceId: page.workspaceId,
            parentType: page.parentType,
            parentId: page.parentId,
            title: `${page.title ?? "Untitled"} (копия)`,
            icon: page.icon,
            prevPageId: page.id,
            createdById: ctx.user.id,
            updatedById: ctx.user.id,
          },
        })
        // Rewire: the old next sibling now points to the copy
        const oldNext = await tx.page.findFirst({
          where: {
            workspaceId: page.workspaceId,
            parentType: page.parentType,
            parentId: page.parentId,
            prevPageId: page.id,
            id: { not: copy.id },
            deletedAt: null,
          },
        })
        if (oldNext) {
          await tx.page.update({
            where: { id: oldNext.id },
            data: { prevPageId: copy.id },
          })
        }
        // Copy all blocks (flat copy, reset linked-list)
        const blocks = await tx.block.findMany({
          where: { pageId: page.id, archivedAt: null },
        })
        for (const block of blocks) {
          await tx.block.create({
            data: {
              type: block.type,
              pageId: copy.id,
              parentBlockId: block.parentBlockId,
              prevBlockId: block.prevBlockId,
              content: block.content as object,
              createdById: ctx.user.id,
            },
          })
        }
        return copy
      })
    }),

  addFavorite: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertPageAccess(ctx, input.pageId)
      return ctx.prisma.favoritePage.upsert({
        where: { userId_pageId: { userId: ctx.user.id, pageId: input.pageId } },
        create: { userId: ctx.user.id, pageId: input.pageId },
        update: {},
      })
    }),

  removeFavorite: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.favoritePage.deleteMany({
        where: { userId: ctx.user.id, pageId: input.pageId },
      })
      return { ok: true }
    }),

  listFavorites: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      const favorites = await ctx.prisma.favoritePage.findMany({
        where: { userId: ctx.user.id, page: { workspaceId: input.workspaceId, deletedAt: null } },
        include: {
          page: {
            select: {
              id: true,
              title: true,
              icon: true,
              parentId: true,
              parentType: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      })
      return favorites.map((f) => f.page)
    }),
```

- [ ] **Step 2: Verify types compile**

```bash
pnpm check-types
```

Expected: Only pre-existing TS2742 error.

- [ ] **Step 3: Commit**

```bash
git add packages/trpc/src/routers/page.ts
git commit -m "feat(trpc): add page move, duplicate, favorites procedures"
```

---

## Task 5: Search Router — parentId Support

**Files:**
- Modify: `packages/trpc/src/routers/search.ts`

- [ ] **Step 1: Update listChats to include parentId**

In `packages/trpc/src/routers/search.ts`, update the `listChats` query (line 37-41) to select parentId:

```typescript
      return ctx.prisma.searchChat.findMany({
        where: { workspaceId: input.workspaceId },
        orderBy: { updatedAt: "desc" },
        take: 50,
        select: {
          id: true,
          title: true,
          parentId: true,
          updatedAt: true,
          createdAt: true,
          createdById: true,
        },
      })
```

- [ ] **Step 2: Update createChat to accept parentId**

Update `createChat` input and data (line 55-65):

```typescript
  createChat: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        parentId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      if (input.parentId) {
        await assertChatAccess(ctx, input.parentId)
      }
      return ctx.prisma.searchChat.create({
        data: {
          workspaceId: input.workspaceId,
          createdById: ctx.user.id,
          parentId: input.parentId ?? null,
        },
      })
    }),
```

- [ ] **Step 3: Update deleteChat — cascade is DB-level, no code change needed**

The `onDelete: Cascade` in the schema handles child deletion automatically. The existing `deleteChat` procedure works as-is. But update the delete confirmation text in the frontend later to mention children.

- [ ] **Step 4: Verify types compile**

```bash
pnpm check-types
```

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/routers/search.ts
git commit -m "feat(trpc): add parentId to search chat list and create"
```

---

## Task 6: Layout Wiring — Pass userId and Expanded Page Data

**Files:**
- Modify: `apps/web/src/app/(protected)/workspaces/[workspaceId]/layout.tsx`
- Modify: `apps/web/src/components/workspace/workspace-layout-client.tsx`
- Modify: `apps/web/src/components/workspace/workspace-sidebar.tsx`

- [ ] **Step 1: Pass userId from server layout**

In `apps/web/src/app/(protected)/workspaces/[workspaceId]/layout.tsx`, update the props passed to WorkspaceLayoutClient (line 24-35):

Replace:

```tsx
    <WorkspaceLayoutClient
      workspace={{ id: workspace.id, name: workspace.name, icon: workspace.icon }}
      planName={plan.name}
      pages={pages.map((p) => ({ id: p.id, title: p.title, icon: p.icon }))}
      user={{
        firstName: session.user.firstName,
        lastName: session.user.lastName,
        email: session.user.email,
      }}
    >
```

With:

```tsx
    <WorkspaceLayoutClient
      workspace={{ id: workspace.id, name: workspace.name, icon: workspace.icon }}
      planName={plan.name}
      pages={pages}
      user={{
        id: session.user.id,
        firstName: session.user.firstName,
        lastName: session.user.lastName,
        email: session.user.email,
      }}
    >
```

- [ ] **Step 2: Update WorkspaceLayoutClient Props type**

In `apps/web/src/components/workspace/workspace-layout-client.tsx`, update the Props type (lines 15-21):

```typescript
type PageItem = {
  id: string
  title: string | null
  icon: string | null
  parentType: string
  parentId: string | null
  prevPageId: string | null
  createdById: string | null
}

type Props = {
  workspace: { id: string; name: string; icon: string | null }
  planName: string
  pages: PageItem[]
  user: { id: string; firstName: string; lastName: string; email: string }
  children: ReactNode
}
```

- [ ] **Step 3: Update sidebarProps to pass userId**

In the same file, update the sidebarProps (line 72):

```typescript
  const sidebarProps = { workspace, planName, pages, userMenu, userId: user.id }
```

- [ ] **Step 4: Update WorkspaceSidebar Props**

In `apps/web/src/components/workspace/workspace-sidebar.tsx`, update the Props type (lines 22-28):

```typescript
type PageItem = {
  id: string
  title: string | null
  icon: string | null
  parentType: string
  parentId: string | null
  prevPageId: string | null
  createdById: string | null
}

type Props = {
  workspace: { id: string; name: string; icon: string | null }
  planName: string
  pages: PageItem[]
  onHide?: () => void
  userMenu: ReactNode
  userId: string
}
```

Update the function signature to destructure `userId`:

```typescript
export function WorkspaceSidebar({
  workspace,
  planName,
  pages,
  onHide,
  userMenu,
  userId,
}: Props) {
```

- [ ] **Step 5: Verify types compile**

```bash
pnpm check-types
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/\(protected\)/workspaces/\[workspaceId\]/layout.tsx \
       apps/web/src/components/workspace/workspace-layout-client.tsx \
       apps/web/src/components/workspace/workspace-sidebar.tsx
git commit -m "feat: wire userId and expanded page data through layout"
```

---

## Task 7: Page Context Menu Component

**Files:**
- Create: `apps/web/src/components/workspace/page-context-menu.tsx`

- [ ] **Step 1: Create the page context menu component**

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import {
  Menu,
  MenuItem,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  StarIcon,
  StarBorderIcon,
  LinkIcon,
  ContentCopyIcon,
  DriveFileRenameOutlineIcon,
  MovingIcon,
  DeleteIcon,
  TextField,
} from "@repo/ui/components"
import { Button } from "@repo/ui/components"

import { trpc } from "@/trpc/client"

type PageItem = {
  id: string
  title: string | null
  icon: string | null
  parentType: string
  parentId: string | null
  prevPageId: string | null
  createdById: string | null
}

type Props = {
  anchorEl: HTMLElement | null
  onClose: () => void
  page: PageItem
  workspaceId: string
  userId: string
  isFavorite: boolean
  onOpenMoveDialog: () => void
}

export function PageContextMenu({
  anchorEl,
  onClose,
  page,
  workspaceId,
  userId,
  isFavorite,
  onOpenMoveDialog,
}: Props) {
  const router = useRouter()
  const utils = trpc.useUtils()

  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState("")
  const [deleteOpen, setDeleteOpen] = useState(false)

  const isOwnerOrCreator = page.createdById === userId
  // Workspace owner check is server-side; client heuristic: show always, server rejects if unauthorized

  const rename = trpc.page.rename.useMutation({
    onSuccess: async () => {
      await utils.page.listByWorkspace.invalidate({ workspaceId })
      await utils.page.listFavorites.invalidate({ workspaceId })
      setRenameOpen(false)
    },
  })

  const softDelete = trpc.page.softDelete.useMutation({
    onSuccess: async () => {
      await utils.page.listByWorkspace.invalidate({ workspaceId })
      await utils.page.listFavorites.invalidate({ workspaceId })
    },
  })

  const duplicate = trpc.page.duplicate.useMutation({
    onSuccess: async (data) => {
      await utils.page.listByWorkspace.invalidate({ workspaceId })
      router.push(`/workspaces/${workspaceId}/pages/${data.id}`)
    },
  })

  const addFavorite = trpc.page.addFavorite.useMutation({
    onSuccess: () => utils.page.listFavorites.invalidate({ workspaceId }),
  })

  const removeFavorite = trpc.page.removeFavorite.useMutation({
    onSuccess: () => utils.page.listFavorites.invalidate({ workspaceId }),
  })

  const handleCopyLink = () => {
    const url = `${window.location.origin}/workspaces/${workspaceId}/pages/${page.id}`
    navigator.clipboard.writeText(url)
    onClose()
  }

  return (
    <>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={onClose}>
        <MenuItem
          onClick={() => {
            if (isFavorite) {
              removeFavorite.mutate({ pageId: page.id })
            } else {
              addFavorite.mutate({ pageId: page.id })
            }
            onClose()
          }}
          sx={{ gap: 1, fontSize: 13 }}
        >
          {isFavorite ? <StarIcon fontSize="small" /> : <StarBorderIcon fontSize="small" />}
          {isFavorite ? "Убрать из избранного" : "В избранное"}
        </MenuItem>
        <Divider />
        <MenuItem onClick={handleCopyLink} sx={{ gap: 1, fontSize: 13 }}>
          <LinkIcon fontSize="small" />
          Копировать ссылку
        </MenuItem>
        <MenuItem
          onClick={() => {
            duplicate.mutate({ pageId: page.id })
            onClose()
          }}
          sx={{ gap: 1, fontSize: 13 }}
        >
          <ContentCopyIcon fontSize="small" />
          Дублировать
        </MenuItem>
        <MenuItem
          onClick={() => {
            onClose()
            setRenameValue(page.title ?? "")
            setRenameOpen(true)
          }}
          sx={{ gap: 1, fontSize: 13 }}
        >
          <DriveFileRenameOutlineIcon fontSize="small" />
          Переименовать
        </MenuItem>
        <MenuItem
          onClick={() => {
            onClose()
            onOpenMoveDialog()
          }}
          sx={{ gap: 1, fontSize: 13 }}
        >
          <MovingIcon fontSize="small" />
          Переместить
        </MenuItem>
        <MenuItem
          onClick={() => {
            onClose()
            setDeleteOpen(true)
          }}
          sx={{ gap: 1, fontSize: 13, color: "error.main" }}
        >
          <DeleteIcon fontSize="small" />
          В корзину
        </MenuItem>
      </Menu>

      {/* Rename dialog */}
      <Dialog open={renameOpen} onClose={() => setRenameOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Переименовать страницу</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && renameValue.trim()) {
                rename.mutate({ pageId: page.id, title: renameValue.trim() })
              }
            }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setRenameOpen(false)}>
            Отмена
          </Button>
          <Button
            onClick={() => rename.mutate({ pageId: page.id, title: renameValue.trim() })}
            disabled={!renameValue.trim() || rename.isPending}
          >
            Сохранить
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Удалить страницу?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Страница «{page.title ?? "Untitled"}» и все дочерние страницы будут перемещены в
            корзину.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setDeleteOpen(false)}>
            Отмена
          </Button>
          <Button
            onClick={() => {
              softDelete.mutate({ pageId: page.id })
              setDeleteOpen(false)
            }}
            disabled={softDelete.isPending}
          >
            Удалить
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
```

- [ ] **Step 2: Verify types compile**

```bash
pnpm check-types
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/workspace/page-context-menu.tsx
git commit -m "feat: add PageContextMenu with favorites, rename, duplicate, move, delete"
```

---

## Task 8: Move Page Dialog

**Files:**
- Create: `apps/web/src/components/workspace/move-page-dialog.tsx`

- [ ] **Step 1: Create the move dialog component**

```tsx
"use client"

import { useMemo } from "react"

import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  SimpleTreeView,
  TreeItem,
  Box,
} from "@repo/ui/components"
import { Button } from "@repo/ui/components"

import { trpc } from "@/trpc/client"

type PageItem = {
  id: string
  title: string | null
  icon: string | null
  parentType: string
  parentId: string | null
  prevPageId: string | null
  createdById: string | null
}

type Props = {
  open: boolean
  onClose: () => void
  page: PageItem
  pages: PageItem[]
  workspaceId: string
}

function getDescendantIds(pageId: string, pages: PageItem[]): Set<string> {
  const ids = new Set<string>()
  const queue = [pageId]
  while (queue.length > 0) {
    const id = queue.shift()!
    for (const p of pages) {
      if (p.parentId === id && p.parentType === "PAGE" && !ids.has(p.id)) {
        ids.add(p.id)
        queue.push(p.id)
      }
    }
  }
  return ids
}

function orderSiblings(pages: PageItem[]): PageItem[] {
  if (pages.length === 0) return []
  const byPrev = new Map<string | null, PageItem>()
  for (const p of pages) byPrev.set(p.prevPageId, p)
  const out: PageItem[] = []
  let cursor: string | null = null
  while (byPrev.has(cursor)) {
    const next = byPrev.get(cursor)!
    out.push(next)
    cursor = next.id
  }
  // Include any pages not in the chain (data inconsistency fallback)
  const inChain = new Set(out.map((p) => p.id))
  for (const p of pages) {
    if (!inChain.has(p.id)) out.push(p)
  }
  return out
}

function PageTreeItems({
  parentId,
  parentType,
  pages,
  excludeIds,
}: {
  parentId: string
  parentType: string
  pages: PageItem[]
  excludeIds: Set<string>
}) {
  const children = orderSiblings(
    pages.filter(
      (p) => p.parentId === parentId && p.parentType === parentType && !excludeIds.has(p.id),
    ),
  )
  return children.map((page) => (
    <TreeItem
      key={page.id}
      itemId={page.id}
      label={
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, py: 0.25 }}>
          <span style={{ fontSize: 14 }}>{page.icon ?? "📄"}</span>
          <span style={{ fontSize: 13 }}>{page.title ?? "Untitled"}</span>
        </Box>
      }
    >
      <PageTreeItems parentId={page.id} parentType="PAGE" pages={pages} excludeIds={excludeIds} />
    </TreeItem>
  ))
}

export function MovePageDialog({ open, onClose, page, pages, workspaceId }: Props) {
  const utils = trpc.useUtils()
  const move = trpc.page.move.useMutation({
    onSuccess: async () => {
      await utils.page.listByWorkspace.invalidate({ workspaceId })
      await utils.page.listFavorites.invalidate({ workspaceId })
      onClose()
    },
  })

  const excludeIds = useMemo(() => {
    const ids = getDescendantIds(page.id, pages)
    ids.add(page.id)
    return ids
  }, [page.id, pages])

  const handleSelect = (_event: React.SyntheticEvent, itemId: string | null) => {
    if (!itemId) return
    const newParentId = itemId === "__root__" ? null : itemId
    move.mutate({ pageId: page.id, newParentId })
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Переместить «{page.title ?? "Untitled"}»</DialogTitle>
      <DialogContent>
        <SimpleTreeView onItemClick={handleSelect}>
          <TreeItem
            itemId="__root__"
            label={
              <Box sx={{ py: 0.25, fontSize: 13, fontWeight: 500 }}>Корень</Box>
            }
          />
          <PageTreeItems
            parentId={workspaceId}
            parentType="WORKSPACE"
            pages={pages}
            excludeIds={excludeIds}
          />
        </SimpleTreeView>
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={onClose}>
          Отмена
        </Button>
      </DialogActions>
    </Dialog>
  )
}
```

- [ ] **Step 2: Verify types compile**

```bash
pnpm check-types
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/workspace/move-page-dialog.tsx
git commit -m "feat: add MovePageDialog with tree picker"
```

---

## Task 9: Page Tree Section Component

**Files:**
- Create: `apps/web/src/components/workspace/page-tree-section.tsx`

This is the main tree view for pages in the sidebar, replacing the flat NavItem list.

- [ ] **Step 1: Create page-tree-section.tsx**

```tsx
"use client"

import { useState, useMemo, useCallback } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"

import {
  Box,
  Typography,
  IconButton,
  AddIcon,
  MoreHorizIcon,
  RichTreeView,
  TreeItem,
} from "@repo/ui/components"
import type { TreeViewBaseItem } from "@repo/ui/components"

import { trpc } from "@/trpc/client"
import { PageContextMenu } from "./page-context-menu"
import { MovePageDialog } from "./move-page-dialog"

type PageItem = {
  id: string
  title: string | null
  icon: string | null
  parentType: string
  parentId: string | null
  prevPageId: string | null
  createdById: string | null
}

type Props = {
  workspaceId: string
  pages: PageItem[]
  userId: string
  favoritePageIds: Set<string>
}

function orderSiblings(pages: PageItem[]): PageItem[] {
  if (pages.length === 0) return []
  const byPrev = new Map<string | null, PageItem>()
  for (const p of pages) byPrev.set(p.prevPageId, p)
  const out: PageItem[] = []
  let cursor: string | null = null
  while (byPrev.has(cursor)) {
    const next = byPrev.get(cursor)!
    out.push(next)
    cursor = next.id
  }
  const inChain = new Set(out.map((p) => p.id))
  for (const p of pages) {
    if (!inChain.has(p.id)) out.push(p)
  }
  return out
}

function PageTreeItem({
  page,
  pages,
  workspaceId,
  userId,
  favoritePageIds,
  pathname,
}: {
  page: PageItem
  pages: PageItem[]
  workspaceId: string
  userId: string
  favoritePageIds: Set<string>
  pathname: string
}) {
  const router = useRouter()
  const utils = trpc.useUtils()

  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [moveOpen, setMoveOpen] = useState(false)

  const isActive = pathname === `/workspaces/${workspaceId}/pages/${page.id}`

  const createChild = trpc.page.create.useMutation({
    onSuccess: async (data) => {
      await utils.page.listByWorkspace.invalidate({ workspaceId })
      router.push(`/workspaces/${workspaceId}/pages/${data.id}`)
    },
  })

  const children = orderSiblings(
    pages.filter((p) => p.parentId === page.id && p.parentType === "PAGE"),
  )

  return (
    <>
      <TreeItem
        itemId={page.id}
        label={
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.5,
              py: 0.25,
              pr: 0.5,
              minWidth: 0,
              "&:hover .page-actions": { visibility: "visible" },
            }}
          >
            <Link
              href={`/workspaces/${workspaceId}/pages/${page.id}`}
              onClick={(e) => e.stopPropagation()}
              style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 4, flex: 1, minWidth: 0 }}
            >
              <span style={{ fontSize: 14, flexShrink: 0 }}>{page.icon ?? "📄"}</span>
              <Typography
                variant="body2"
                noWrap
                sx={{
                  color: isActive ? "text.primary" : "text.secondary",
                  fontSize: 13,
                }}
              >
                {page.title ?? "Untitled"}
              </Typography>
            </Link>
            <Box
              className="page-actions"
              sx={{
                display: "flex",
                visibility: menuAnchor ? "visible" : "hidden",
                flexShrink: 0,
              }}
            >
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation()
                  createChild.mutate({ workspaceId, parentId: page.id })
                }}
                sx={{ p: 0.25 }}
              >
                <AddIcon sx={{ fontSize: 16 }} />
              </IconButton>
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation()
                  setMenuAnchor(e.currentTarget)
                }}
                sx={{ p: 0.25 }}
              >
                <MoreHorizIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Box>
          </Box>
        }
      >
        {children.map((child) => (
          <PageTreeItem
            key={child.id}
            page={child}
            pages={pages}
            workspaceId={workspaceId}
            userId={userId}
            favoritePageIds={favoritePageIds}
            pathname={pathname}
          />
        ))}
      </TreeItem>
      <PageContextMenu
        anchorEl={menuAnchor}
        onClose={() => setMenuAnchor(null)}
        page={page}
        workspaceId={workspaceId}
        userId={userId}
        isFavorite={favoritePageIds.has(page.id)}
        onOpenMoveDialog={() => setMoveOpen(true)}
      />
      <MovePageDialog
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        page={page}
        pages={pages}
        workspaceId={workspaceId}
      />
    </>
  )
}

export function PageTreeSection({ workspaceId, pages, userId, favoritePageIds }: Props) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const pathname = usePathname()

  const createPage = trpc.page.create.useMutation({
    onSuccess: async (data) => {
      await utils.page.listByWorkspace.invalidate({ workspaceId })
      router.push(`/workspaces/${workspaceId}/pages/${data.id}`)
    },
  })

  const rootPages = orderSiblings(
    pages.filter((p) => p.parentType === "WORKSPACE"),
  )

  return (
    <Box>
      <Typography
        variant="overline"
        sx={{ color: "text.disabled", px: 1, pt: 2, pb: 0.5, letterSpacing: "0.06em" }}
      >
        Страницы
      </Typography>
      <Box sx={{ "& .MuiTreeItem-content": { py: 0, minHeight: 28 } }}>
        {rootPages.map((page) => (
          <PageTreeItem
            key={page.id}
            page={page}
            pages={pages}
            workspaceId={workspaceId}
            userId={userId}
            favoritePageIds={favoritePageIds}
            pathname={pathname}
          />
        ))}
      </Box>
      <Box
        onClick={() => createPage.mutate({ workspaceId, parentId: null })}
        sx={{
          cursor: "pointer",
          py: 0.5,
          px: 1,
          color: "text.disabled",
          "&:hover": { color: "text.primary" },
          fontSize: 13,
        }}
      >
        ＋ Новая страница
      </Box>
    </Box>
  )
}
```

Note: This uses individual `TreeItem` components without `SimpleTreeView`/`RichTreeView` wrapper initially — D&D via `RichTreeView` will be wired in a follow-up step once the basic tree renders correctly. For now, each `TreeItem` is rendered standalone to keep the initial integration simple.

- [ ] **Step 2: Verify types compile**

```bash
pnpm check-types
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/workspace/page-tree-section.tsx
git commit -m "feat: add PageTreeSection with tree rendering and hover actions"
```

---

## Task 10: Favorites Section Component

**Files:**
- Create: `apps/web/src/components/workspace/favorites-section.tsx`

- [ ] **Step 1: Create favorites-section.tsx**

```tsx
"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import {
  Box,
  Typography,
  IconButton,
  MoreHorizIcon,
  ArrowDropDownIcon,
  ArrowDropUpIcon,
} from "@repo/ui/components"

import { trpc } from "@/trpc/client"
import { PageContextMenu } from "./page-context-menu"
import { MovePageDialog } from "./move-page-dialog"

type PageItem = {
  id: string
  title: string | null
  icon: string | null
  parentType: string
  parentId: string | null
  prevPageId: string | null
  createdById: string | null
}

type FavoritePage = {
  id: string
  title: string | null
  icon: string | null
  parentId: string | null
  parentType: string
}

type Props = {
  workspaceId: string
  allPages: PageItem[]
  userId: string
  favoritePageIds: Set<string>
}

function FavoriteItem({
  page,
  allPages,
  workspaceId,
  userId,
  favoritePageIds,
  pathname,
}: {
  page: FavoritePage
  allPages: PageItem[]
  workspaceId: string
  userId: string
  favoritePageIds: Set<string>
  pathname: string
}) {
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [moveOpen, setMoveOpen] = useState(false)
  const isActive = pathname === `/workspaces/${workspaceId}/pages/${page.id}`

  // Find the full PageItem for context menu
  const fullPage = allPages.find((p) => p.id === page.id)
  if (!fullPage) return null

  // Find children of this favorite page from allPages
  const children = allPages.filter((p) => p.parentId === page.id && p.parentType === "PAGE")

  return (
    <>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          pr: 0.5,
          borderRadius: 0.75,
          bgcolor: isActive ? "action.selected" : "transparent",
          "&:hover": { bgcolor: isActive ? "action.selected" : "action.hover" },
          "&:hover .fav-more": { visibility: "visible" },
        }}
      >
        <Link
          href={`/workspaces/${workspaceId}/pages/${page.id}`}
          style={{ textDecoration: "none", flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 4 }}
        >
          <Box sx={{ pl: 1, py: 0.5, display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
            <span style={{ fontSize: 14, flexShrink: 0 }}>{page.icon ?? "📄"}</span>
            <Typography
              variant="body2"
              noWrap
              sx={{ color: isActive ? "text.primary" : "text.secondary", fontSize: 13 }}
            >
              {page.title ?? "Untitled"}
            </Typography>
          </Box>
        </Link>
        <IconButton
          className="fav-more"
          size="small"
          onClick={(e) => {
            e.stopPropagation()
            setMenuAnchor(e.currentTarget)
          }}
          sx={{ p: 0.25, flexShrink: 0, visibility: menuAnchor ? "visible" : "hidden" }}
        >
          <MoreHorizIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Box>
      {children.length > 0 && (
        <Box sx={{ pl: 2 }}>
          {children.map((child) => {
            const childActive = pathname === `/workspaces/${workspaceId}/pages/${child.id}`
            return (
              <Link
                key={child.id}
                href={`/workspaces/${workspaceId}/pages/${child.id}`}
                style={{ textDecoration: "none" }}
              >
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0.5,
                    px: 1,
                    py: 0.5,
                    borderRadius: 0.75,
                    color: childActive ? "text.primary" : "text.secondary",
                    bgcolor: childActive ? "action.selected" : "transparent",
                    "&:hover": { bgcolor: childActive ? "action.selected" : "action.hover" },
                    fontSize: 13,
                  }}
                >
                  <span style={{ fontSize: 14 }}>{child.icon ?? "📄"}</span>
                  <Typography variant="body2" noWrap sx={{ fontSize: 13 }}>
                    {child.title ?? "Untitled"}
                  </Typography>
                </Box>
              </Link>
            )
          })}
        </Box>
      )}
      <PageContextMenu
        anchorEl={menuAnchor}
        onClose={() => setMenuAnchor(null)}
        page={fullPage}
        workspaceId={workspaceId}
        userId={userId}
        isFavorite={true}
        onOpenMoveDialog={() => setMoveOpen(true)}
      />
      <MovePageDialog
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        page={fullPage}
        pages={allPages}
        workspaceId={workspaceId}
      />
    </>
  )
}

export function FavoritesSection({ workspaceId, allPages, userId, favoritePageIds }: Props) {
  const [open, setOpen] = useState(true)
  const pathname = usePathname()
  const favorites = trpc.page.listFavorites.useQuery({ workspaceId })

  if (!favorites.data || favorites.data.length === 0) return null

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
        <span style={{ fontSize: 13, flex: 1 }}>Избранное</span>
        {open ? (
          <ArrowDropUpIcon sx={{ fontSize: 16 }} />
        ) : (
          <ArrowDropDownIcon sx={{ fontSize: 16 }} />
        )}
      </Box>
      {open && (
        <Box sx={{ pl: 1 }}>
          {favorites.data.map((page) => (
            <FavoriteItem
              key={page.id}
              page={page}
              allPages={allPages}
              workspaceId={workspaceId}
              userId={userId}
              favoritePageIds={favoritePageIds}
              pathname={pathname}
            />
          ))}
        </Box>
      )}
    </Box>
  )
}
```

- [ ] **Step 2: Verify types compile**

```bash
pnpm check-types
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/workspace/favorites-section.tsx
git commit -m "feat: add FavoritesSection with collapsible favorites list and child pages"
```

---

## Task 11: Update Search Sidebar for Tree + Add Child

**Files:**
- Modify: `apps/web/src/components/workspace/search-sidebar-section.tsx`

- [ ] **Step 1: Refactor ChatListItem to support tree + AddIcon**

Replace the entire file `apps/web/src/components/workspace/search-sidebar-section.tsx`:

```tsx
"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useState, useMemo } from "react"

import {
  AddIcon,
  ArrowDropDownIcon,
  ArrowDropUpIcon,
  Box,
  Button,
  DeleteIcon,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  DriveFileRenameOutlineIcon,
  IconButton,
  Menu,
  MenuItem,
  MoreHorizIcon,
  SearchIcon,
  Stack,
  TextField,
  Typography,
} from "@repo/ui/components"

import { trpc } from "@/trpc/client"

type Props = { workspaceId: string }

type ChatItem = {
  id: string
  title: string | null
  parentId: string | null
  updatedAt: string | Date
}

function ChatTreeItem({
  chat,
  workspaceId,
  allChats,
}: {
  chat: ChatItem
  workspaceId: string
  allChats: ChatItem[]
}) {
  const pathname = usePathname()
  const router = useRouter()
  const utils = trpc.useUtils()

  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState("")
  const [deleteOpen, setDeleteOpen] = useState(false)

  const isActive = pathname === `/workspaces/${workspaceId}/search/${chat.id}`

  const children = useMemo(
    () =>
      allChats
        .filter((c) => c.parentId === chat.id)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [allChats, chat.id],
  )

  const rename = trpc.search.renameChat.useMutation({
    onSuccess: async () => {
      await utils.search.listChats.invalidate({ workspaceId })
      setRenameOpen(false)
    },
  })

  const deleteChat = trpc.search.deleteChat.useMutation({
    onSuccess: async () => {
      await utils.search.listChats.invalidate({ workspaceId })
      setDeleteOpen(false)
      if (isActive) router.push(`/workspaces/${workspaceId}/search`)
    },
  })

  const createChild = trpc.search.createChat.useMutation({
    onSuccess: async (data) => {
      await utils.search.listChats.invalidate({ workspaceId })
      router.push(`/workspaces/${workspaceId}/search/${data.id}`)
    },
  })

  return (
    <>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          pr: 0.5,
          borderRadius: 0.75,
          bgcolor: isActive ? "action.selected" : "transparent",
          "&:hover": { bgcolor: isActive ? "action.selected" : "action.hover" },
          "&:hover .chat-actions": { visibility: "visible" },
        }}
      >
        <Link
          href={`/workspaces/${workspaceId}/search/${chat.id}`}
          style={{ textDecoration: "none", flex: 1, minWidth: 0 }}
        >
          <Typography
            variant="body2"
            noWrap
            sx={{
              py: 0.5,
              pl: 0.5,
              color: isActive ? "text.primary" : "text.secondary",
            }}
          >
            {chat.title ?? "Без названия"}
          </Typography>
        </Link>
        <Box
          className="chat-actions"
          sx={{
            display: "flex",
            visibility: menuAnchor ? "visible" : "hidden",
            flexShrink: 0,
          }}
        >
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation()
              createChild.mutate({ workspaceId, parentId: chat.id })
            }}
            sx={{ p: 0.25 }}
          >
            <AddIcon sx={{ fontSize: 16 }} />
          </IconButton>
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation()
              setMenuAnchor(e.currentTarget)
            }}
            sx={{ p: 0.25 }}
          >
            <MoreHorizIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>
      </Box>

      {children.length > 0 && (
        <Stack spacing={0.25} sx={{ pl: 2 }}>
          {children.map((child) => (
            <ChatTreeItem
              key={child.id}
              chat={child}
              workspaceId={workspaceId}
              allChats={allChats}
            />
          ))}
        </Stack>
      )}

      {/* Context menu */}
      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem
          onClick={() => {
            setMenuAnchor(null)
            setRenameValue(chat.title ?? "")
            setRenameOpen(true)
          }}
          sx={{ gap: 1, fontSize: 13 }}
        >
          <DriveFileRenameOutlineIcon fontSize="small" />
          Переименовать
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMenuAnchor(null)
            setDeleteOpen(true)
          }}
          sx={{ gap: 1, fontSize: 13, color: "error.main" }}
        >
          <DeleteIcon fontSize="small" />
          Удалить
        </MenuItem>
      </Menu>

      {/* Rename dialog */}
      <Dialog open={renameOpen} onClose={() => setRenameOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Переименовать чат</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && renameValue.trim()) {
                rename.mutate({ chatId: chat.id, title: renameValue.trim() })
              }
            }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setRenameOpen(false)}>
            Отмена
          </Button>
          <Button
            onClick={() => rename.mutate({ chatId: chat.id, title: renameValue.trim() })}
            disabled={!renameValue.trim() || rename.isPending}
          >
            Сохранить
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Удалить чат?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Чат «{chat.title ?? "Без названия"}» и все дочерние чаты будут удалены навсегда.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setDeleteOpen(false)}>
            Отмена
          </Button>
          <Button
            onClick={() => deleteChat.mutate({ chatId: chat.id })}
            disabled={deleteChat.isPending}
          >
            Удалить
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

export function SearchSidebarSection({ workspaceId }: Props) {
  const [open, setOpen] = useState(true)
  const router = useRouter()
  const utils = trpc.useUtils()
  const chats = trpc.search.listChats.useQuery({ workspaceId })
  const create = trpc.search.createChat.useMutation({
    onSuccess: async (data) => {
      await utils.search.listChats.invalidate({ workspaceId })
      router.push(`/workspaces/${workspaceId}/search/${data.id}`)
    },
  })

  const rootChats = useMemo(
    () =>
      (chats.data ?? [])
        .filter((c) => !c.parentId)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [chats.data],
  )

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
        <SearchIcon sx={{ fontSize: 16 }} />
        <span style={{ fontSize: 13, flex: 1 }}>Поиск</span>
        {open ? (
          <ArrowDropUpIcon sx={{ fontSize: 16 }} />
        ) : (
          <ArrowDropDownIcon sx={{ fontSize: 16 }} />
        )}
      </Box>
      {open ? (
        <Stack spacing={0.25} sx={{ pl: 3 }}>
          {rootChats.map((chat) => (
            <ChatTreeItem
              key={chat.id}
              chat={chat}
              workspaceId={workspaceId}
              allChats={chats.data ?? []}
            />
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

- [ ] **Step 2: Verify types compile**

```bash
pnpm check-types
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/workspace/search-sidebar-section.tsx
git commit -m "feat: refactor SearchSidebarSection with tree hierarchy and AddIcon for child chats"
```

---

## Task 12: Update WorkspaceSidebar — Integrate All Sections

**Files:**
- Modify: `apps/web/src/components/workspace/workspace-sidebar.tsx`

- [ ] **Step 1: Replace flat page list with new sections**

Replace `apps/web/src/components/workspace/workspace-sidebar.tsx`:

```tsx
"use client"

import type { ReactNode } from "react"
import { useMemo } from "react"

import Link from "next/link"
import { usePathname } from "next/navigation"

import {
  Box,
  DeleteIcon,
  IconButton,
  KeyboardDoubleArrowLeftIcon,
  SettingsIcon,
  Stack,
  Tooltip,
  Typography,
} from "@repo/ui/components"

import { trpc } from "@/trpc/client"
import { SIDEBAR_WIDTH } from "./workspace-layout-client"
import { SearchSidebarSection } from "./search-sidebar-section"
import { FavoritesSection } from "./favorites-section"
import { PageTreeSection } from "./page-tree-section"

type PageItem = {
  id: string
  title: string | null
  icon: string | null
  parentType: string
  parentId: string | null
  prevPageId: string | null
  createdById: string | null
}

type Props = {
  workspace: { id: string; name: string; icon: string | null }
  planName: string
  pages: PageItem[]
  onHide?: () => void
  userMenu: ReactNode
  userId: string
}

export function WorkspaceSidebar({
  workspace,
  planName,
  pages,
  onHide,
  userMenu,
  userId,
}: Props) {
  const pathname = usePathname()
  const favorites = trpc.page.listFavorites.useQuery({ workspaceId: workspace.id })
  const favoritePageIds = useMemo(
    () => new Set((favorites.data ?? []).map((f) => f.id)),
    [favorites.data],
  )

  return (
    <Box
      component="aside"
      sx={{
        width: SIDEBAR_WIDTH,
        borderRight: "1px solid",
        borderColor: "divider",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.paper",
        px: 1.25,
        py: 1.75,
        overflow: "auto",
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ px: 1, pb: 1.75 }}
      >
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
            flexShrink: 0,
          }}
        >
          {workspace.icon ?? "📒"}
        </Box>
        <Stack spacing={0} sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" noWrap>
            {workspace.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {planName} plan
          </Typography>
        </Stack>
        {onHide ? (
          <Tooltip title="Скрыть" placement="right">
            <IconButton size="small" onClick={onHide} sx={{ flexShrink: 0 }}>
              <KeyboardDoubleArrowLeftIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        ) : null}
      </Stack>

      <Stack spacing={0.25} sx={{ py: 0.75 }}>
        <SearchSidebarSection workspaceId={workspace.id} />
        <NavItem
          icon={<SettingsIcon sx={{ fontSize: 16 }} />}
          label="Настройки"
          href={`/workspaces/${workspace.id}/settings`}
          matchPrefix={`/workspaces/${workspace.id}/settings`}
          pathname={pathname}
        />
      </Stack>

      <FavoritesSection
        workspaceId={workspace.id}
        allPages={pages}
        userId={userId}
        favoritePageIds={favoritePageIds}
      />

      <PageTreeSection
        workspaceId={workspace.id}
        pages={pages}
        userId={userId}
        favoritePageIds={favoritePageIds}
      />

      <Box sx={{ flex: 1 }} />

      <Box sx={{ borderTop: "1px solid", borderColor: "divider", pt: 1.25 }}>
        <NavItem
          icon={<DeleteIcon sx={{ fontSize: 16 }} />}
          label="Корзина"
          href={`/workspaces/${workspace.id}/trash`}
          matchPrefix={`/workspaces/${workspace.id}/trash`}
          pathname={pathname}
        />
      </Box>

      <Box sx={{ borderTop: "1px solid", borderColor: "divider", pt: 1 }}>{userMenu}</Box>
    </Box>
  )
}

function NavItem({
  icon,
  label,
  href,
  matchPrefix,
  pathname,
  muted,
}: {
  icon: ReactNode
  label: string
  href: string
  matchPrefix?: string
  pathname: string
  muted?: boolean
}) {
  const active = matchPrefix ? pathname.startsWith(matchPrefix) : false
  return (
    <Box
      component={Link}
      href={href}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: 1,
        py: 0.75,
        borderRadius: 0.75,
        textDecoration: "none",
        color: active ? "text.primary" : muted ? "text.disabled" : "text.secondary",
        backgroundColor: active ? "action.selected" : "transparent",
        "&:hover": { backgroundColor: active ? "action.selected" : "action.hover" },
        fontSize: 13,
      }}
    >
      {icon}
      <span>{label}</span>
    </Box>
  )
}
```

- [ ] **Step 2: Verify types compile**

```bash
pnpm check-types
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/workspace/workspace-sidebar.tsx
git commit -m "feat: integrate favorites, page tree, and trash link into WorkspaceSidebar"
```

---

## Task 13: Trash Page Route

**Files:**
- Create: `apps/web/src/app/(protected)/workspaces/[workspaceId]/trash/page.tsx`

- [ ] **Step 1: Create trash page**

```tsx
"use client"

import { use } from "react"

import {
  Box,
  Typography,
  IconButton,
  Tooltip,
  RestoreIcon,
  DeleteForeverIcon,
  Stack,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from "@repo/ui/components"
import { Button } from "@repo/ui/components"

import { trpc } from "@/trpc/client"
import { useState } from "react"

type TrashPageProps = {
  params: Promise<{ workspaceId: string }>
}

export default function TrashPage({ params }: TrashPageProps) {
  const { workspaceId } = use(params)
  const utils = trpc.useUtils()
  const trashed = trpc.page.listTrashed.useQuery({ workspaceId })

  const restore = trpc.page.restore.useMutation({
    onSuccess: async () => {
      await utils.page.listTrashed.invalidate({ workspaceId })
      await utils.page.listByWorkspace.invalidate({ workspaceId })
    },
  })

  const hardDelete = trpc.page.hardDelete.useMutation({
    onSuccess: async () => {
      await utils.page.listTrashed.invalidate({ workspaceId })
    },
  })

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const confirmPage = trashed.data?.find((p) => p.id === confirmDeleteId)

  return (
    <Box sx={{ p: 4, maxWidth: 710, mx: "auto" }}>
      <Typography variant="h5" sx={{ mb: 3 }}>
        Корзина
      </Typography>

      {trashed.data?.length === 0 && (
        <Typography color="text.secondary">Корзина пуста</Typography>
      )}

      <Stack spacing={0.5}>
        {trashed.data?.map((page) => (
          <Box
            key={page.id}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1.5,
              px: 2,
              py: 1,
              borderRadius: 1,
              "&:hover": { bgcolor: "action.hover" },
            }}
          >
            <span style={{ fontSize: 16 }}>{page.icon ?? "📄"}</span>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" noWrap>
                {page.title ?? "Untitled"}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Удалено {page.deletedAt ? new Date(page.deletedAt).toLocaleDateString("ru-RU") : ""}
              </Typography>
            </Box>
            <Tooltip title="Восстановить">
              <IconButton
                size="small"
                onClick={() => restore.mutate({ pageId: page.id })}
                disabled={restore.isPending}
              >
                <RestoreIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Удалить навсегда">
              <IconButton
                size="small"
                onClick={() => setConfirmDeleteId(page.id)}
                sx={{ color: "error.main" }}
              >
                <DeleteForeverIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          </Box>
        ))}
      </Stack>

      {/* Hard delete confirmation */}
      <Dialog
        open={Boolean(confirmDeleteId)}
        onClose={() => setConfirmDeleteId(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Удалить навсегда?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Страница «{confirmPage?.title ?? "Untitled"}» будет удалена безвозвратно.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setConfirmDeleteId(null)}>
            Отмена
          </Button>
          <Button
            onClick={() => {
              if (confirmDeleteId) {
                hardDelete.mutate({ pageId: confirmDeleteId })
                setConfirmDeleteId(null)
              }
            }}
            disabled={hardDelete.isPending}
          >
            Удалить навсегда
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
```

- [ ] **Step 2: Create page view stub**

Create `apps/web/src/app/(protected)/workspaces/[workspaceId]/pages/[pageId]/page.tsx`:

```tsx
"use client"

import { use } from "react"
import { Box, Typography } from "@repo/ui/components"
import { trpc } from "@/trpc/client"

type Props = {
  params: Promise<{ workspaceId: string; pageId: string }>
}

export default function PageView({ params }: Props) {
  const { pageId } = use(params)
  const page = trpc.page.getById.useQuery({ id: pageId })

  if (!page.data) return null

  return (
    <Box sx={{ p: 4, maxWidth: 710, mx: "auto" }}>
      <Typography variant="h4">{page.data.title ?? "Untitled"}</Typography>
    </Box>
  )
}
```

- [ ] **Step 3: Verify types compile**

```bash
pnpm check-types
```

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(protected)/workspaces/[workspaceId]/trash/page.tsx" \
       "apps/web/src/app/(protected)/workspaces/[workspaceId]/pages/[pageId]/page.tsx"
git commit -m "feat: add trash page and page view stub routes"
```

---

## Task 14: Visual Testing & Bug Fixes

**Files:** Various (based on bugs found)

- [ ] **Step 1: Start dev server and test**

```bash
pnpm dev
```

Open `http://localhost:3000` in browser. Navigate to a workspace.

- [ ] **Step 2: Test page tree**

Verify:
- Pages render as a tree in the sidebar
- Creating a child page via AddIcon works
- Context menu opens on MoreHorizIcon click
- Rename dialog works
- Copy link copies to clipboard
- Duplicate creates a copy
- Soft delete moves to trash

- [ ] **Step 3: Test search chat tree**

Verify:
- Chats render with hierarchy
- Creating child chats via AddIcon works
- Deleting a parent chat also removes children
- Rename and delete dialogs work

- [ ] **Step 4: Test favorites section**

Verify:
- Favorites section hidden when empty
- Adding to favorites via context menu shows section
- Children of favorited pages appear nested
- Removing from favorites hides the page
- Section collapses/expands

- [ ] **Step 5: Test trash page**

Navigate to `/workspaces/{id}/trash`:
- Soft-deleted pages appear in flat list
- Restore returns page to tree
- Hard delete removes permanently
- Child pages are soft-deleted with parent
- Restoring parent restores children
- Restoring child whose parent is deleted moves child to root

- [ ] **Step 6: Test move dialog**

Via context menu > Переместить:
- Tree shows all pages except the page and its descendants
- "Корень" option moves to workspace root
- Clicking a page moves into it

- [ ] **Step 7: Fix any bugs found, commit**

```bash
git add -A
git commit -m "fix: address visual testing bugs in tree nav, favorites, and trash"
```

---

## Task 15: Type Check & Lint Pass

- [ ] **Step 1: Run full type check**

```bash
pnpm check-types
```

Expected: Only pre-existing TS2742 error in trpc/client.tsx.

- [ ] **Step 2: Run lint**

```bash
pnpm lint
```

Expected: No errors (--max-warnings 0).

- [ ] **Step 3: Run format**

```bash
pnpm format
```

- [ ] **Step 4: Commit any formatting fixes**

```bash
git add -A
git commit -m "chore: lint and format pass"
```
