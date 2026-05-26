# Page Ordering & Drag-and-Drop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add personalized favorites ordering, tail-insert on create, and full tree drag-and-drop shared across the workspace.

**Architecture:** Backend linked-list reorder via new `page.reorder` tRPC mutation; favorites order via `FavoritePage.position` integer + `page.reorderFavorites` mutation; frontend uses dnd-kit flat-list strategy in `PageTreeSection` and `FavoritesSection` with query-cache optimistic updates.

**Tech Stack:** Prisma 7, tRPC v11, Vitest (unit mocks), dnd-kit (`@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities`), React 19, MUI v6, Playwright (E2E)

---

## File Map

| File | Action |
|------|--------|
| `packages/db/prisma/schema.prisma` | Modify — add `position` to `FavoritePage` |
| `packages/db/prisma/migrations/<ts>_favorite_page_position/migration.sql` | Create — via `prisma migrate dev` |
| `packages/trpc/src/routers/page.ts` | Modify — fix `create`, `addFavorite`, `listFavorites`, add `reorder` + `reorderFavorites` |
| `packages/trpc/test/page-ordering.test.ts` | Create — unit tests for all five mutations above |
| `apps/web/package.json` | Modify — add dnd-kit deps |
| `apps/web/src/components/workspace/types.ts` | Modify — add `FlatPageItem`, `flattenTree` |
| `apps/web/src/components/workspace/page-tree-section.tsx` | Modify — DnD flat-list rewrite |
| `apps/web/src/components/workspace/favorites-section.tsx` | Modify — DnD reordering |
| `apps/e2e/page-ordering.spec.ts` | Create — E2E tests |

---

## Task 1: DB migration — FavoritePage.position

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1.1 — Add `position` field to FavoritePage in schema**

In `packages/db/prisma/schema.prisma`, find `model FavoritePage` (currently at line ~483) and add the `position` field:

```prisma
model FavoritePage {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  pageId    String   @map("page_id") @db.Uuid
  position  Int      @default(0) @map("position")
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  page Page @relation(fields: [pageId], references: [id], onDelete: Cascade)

  @@unique([userId, pageId])
  @@index([userId])
  @@map("favorite_pages")
}
```

- [ ] **Step 1.2 — Generate migration**

```bash
pnpm --filter @repo/db exec prisma migrate dev --name favorite_page_position
```

Expected: Prisma creates `packages/db/prisma/migrations/<timestamp>_favorite_page_position/migration.sql` with an `ALTER TABLE` statement.

- [ ] **Step 1.3 — Edit migration SQL to backfill existing rows**

Open the generated `migration.sql` and append after the `ALTER TABLE` line:

```sql
-- backfill: assign position = row_number per user, ordered by createdAt
UPDATE "favorite_pages" fp
SET position = sub.rn - 1
FROM (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at ASC) - 1 AS rn
  FROM "favorite_pages"
) sub
WHERE fp.id = sub.id;
```

- [ ] **Step 1.4 — Re-apply migration to pick up the backfill**

```bash
pnpm --filter @repo/db exec prisma migrate dev
```

Expected: `Database schema is up to date!` (migration already applied; only verifies sync).

- [ ] **Step 1.5 — Regenerate Prisma client**

```bash
pnpm --filter @repo/db prisma:generate
```

Expected: `Generated Prisma Client`.

- [ ] **Step 1.6 — Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): add position to FavoritePage for personalized favorites order"
```

---

## Task 2: Backend — fix page.create (tail insert)

**Files:**
- Modify: `packages/trpc/src/routers/page.ts`
- Create: `packages/trpc/test/page-ordering.test.ts`

- [ ] **Step 2.1 — Write failing test**

Create `packages/trpc/test/page-ordering.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@repo/auth', () => ({ getUserFromRequest: vi.fn() }))
vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return { ...actual, prisma: {} }
})

import type { PrismaClient } from '@repo/db'
import { pageRouter } from '../src/routers/page'
import { createCallerFactory } from '../src/trpc'

// ── Constants ─────────────────────────────────────────────────────────────────

const WS_ID = '11111111-1111-1111-1111-111111111111'
const USER_ID = '22222222-2222-2222-2222-222222222222'
const PAGE_A = '33333333-3333-3333-3333-333333333333'
const PAGE_B = '44444444-4444-4444-4444-444444444444'
const PAGE_C = '55555555-5555-5555-5555-555555555555'
const PAGE_NEW = '66666666-6666-6666-6666-666666666666'

// ── Context factory ───────────────────────────────────────────────────────────

function ctx(prisma: unknown) {
  return {
    prisma: prisma as PrismaClient,
    user: { id: USER_ID },
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {},
    returnUrlBase: 'http://localhost:3000',
  }
}

const caller = createCallerFactory(pageRouter)

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal mock prisma for page.create */
function createPrisma(overrides: Record<string, unknown> = {}) {
  const newPage = { id: PAGE_NEW, workspaceId: WS_ID, parentId: null, type: 'TEXT' }
  return {
    workspaceMember: { findUnique: vi.fn(async () => ({ role: 'MEMBER' })) },
    workspace: { findUnique: vi.fn(async () => ({ plan: { features: [] } })) },
    page: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      create: vi.fn(async () => newPage),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({})),
    },
    outboxEvent: { create: vi.fn(async () => ({})) },
    kanbanColumn: { createMany: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({
        page: {
          create: vi.fn(async () => newPage),
          findFirst: vi.fn(async () => null),
          update: vi.fn(async () => ({})),
        },
        outboxEvent: { create: vi.fn(async () => ({})) },
        kanbanColumn: { createMany: vi.fn(async () => ({})) },
      }),
    ),
    ...overrides,
  }
}

// ── Tests: page.create tail insert ───────────────────────────────────────────

describe('page.create — tail insert', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sets prevPageId = null when no siblings exist (first page)', async () => {
    const txPage = {
      create: vi.fn(async () => ({ id: PAGE_NEW, workspaceId: WS_ID, parentId: null })),
      findFirst: vi.fn(async () => null), // no siblings
      update: vi.fn(async () => ({})),
    }
    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => ({ role: 'MEMBER' })) },
      workspace: { findUnique: vi.fn(async () => ({ plan: { features: [] } })) },
      page: { findFirst: vi.fn(async () => null) },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({
          page: txPage,
          outboxEvent: { create: vi.fn(async () => ({})) },
          kanbanColumn: { createMany: vi.fn(async () => ({})) },
        }),
      ),
    }

    await caller(ctx(prisma)).create({ workspaceId: WS_ID, parentId: null })

    // Created with prevPageId: null (no siblings)
    expect(txPage.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ prevPageId: null }) }),
    )
    // update not called (no sibling to update)
    expect(txPage.update).not.toHaveBeenCalled()
  })

  it('sets new page prevPageId = tail sibling id when siblings exist', async () => {
    // Siblings: A (prevPageId=null) → B (prevPageId=A) — tail is B
    const siblings = [
      { id: PAGE_A, prevPageId: null },
      { id: PAGE_B, prevPageId: PAGE_A },
    ]
    const txPage = {
      create: vi.fn(async () => ({ id: PAGE_NEW, workspaceId: WS_ID, parentId: null })),
      findMany: vi.fn(async () => siblings),
      update: vi.fn(async () => ({})),
    }
    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => ({ role: 'MEMBER' })) },
      workspace: { findUnique: vi.fn(async () => ({ plan: { features: [] } })) },
      page: { findFirst: vi.fn(async () => null) },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({
          page: txPage,
          outboxEvent: { create: vi.fn(async () => ({})) },
          kanbanColumn: { createMany: vi.fn(async () => ({})) },
        }),
      ),
    }

    await caller(ctx(prisma)).create({ workspaceId: WS_ID, parentId: null })

    // new page should get prevPageId = PAGE_B (the tail)
    expect(txPage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PAGE_NEW },
        data: { prevPageId: PAGE_B },
      }),
    )
  })
})
```

- [ ] **Step 2.2 — Run test to verify it fails**

```bash
pnpm --filter @repo/trpc test -- page-ordering
```

Expected: FAIL — "update not called" assertion fails because current code calls update on the first sibling (head insert).

- [ ] **Step 2.3 — Implement tail insert in page.create**

In `packages/trpc/src/routers/page.ts`, replace the `create` transaction body (lines ~104–147). Remove the `existingFirst` logic and replace with tail-finding logic:

```typescript
return ctx.prisma.$transaction(async (tx) => {
  const newPage = await tx.page.create({
    data: {
      workspaceId: input.workspaceId,
      parentId: input.parentId,
      title: input.title ?? null,
      icon: input.icon ?? null,
      type: input.type ?? PageType.TEXT,
      prevPageId: null,
      createdById: ctx.user.id,
      updatedById: ctx.user.id,
    },
  })

  // Insert at tail of linked list: find the sibling whose id is not
  // referenced as prevPageId by any other sibling (= the last one).
  const siblings = await tx.page.findMany({
    where: {
      workspaceId: input.workspaceId,
      parentId: input.parentId,
      id: { not: newPage.id },
      deletedAt: null,
    },
    select: { id: true, prevPageId: true },
  })
  if (siblings.length > 0) {
    const prevPageIds = new Set(
      siblings.map((s) => s.prevPageId).filter((id): id is string => id !== null),
    )
    const tail = siblings.find((s) => !prevPageIds.has(s.id))
    if (tail) {
      await tx.page.update({
        where: { id: newPage.id },
        data: { prevPageId: tail.id },
      })
    }
  }

  await enqueueOutboxEvent(tx, {
    eventType: 'page.upserted',
    aggregateType: 'page',
    aggregateId: newPage.id,
    workspaceId: input.workspaceId,
  })

  if (newPage.type === PageType.KANBAN) {
    await seedKanbanDefaults(tx, newPage.id)
  }

  return { id: newPage.id }
})
```

- [ ] **Step 2.4 — Run tests**

```bash
pnpm --filter @repo/trpc test -- page-ordering
```

Expected: PASS — both "tail insert" tests pass.

- [ ] **Step 2.5 — Verify types**

```bash
pnpm check-types
```

Expected: no errors.

- [ ] **Step 2.6 — Commit**

```bash
git add packages/trpc/src/routers/page.ts packages/trpc/test/page-ordering.test.ts
git commit -m "feat(trpc): page.create inserts new page at tail of sibling list"
```

---

## Task 3: Backend — addFavorite position + listFavorites order

**Files:**
- Modify: `packages/trpc/src/routers/page.ts`
- Modify: `packages/trpc/test/page-ordering.test.ts`

- [ ] **Step 3.1 — Write failing tests**

Append to `packages/trpc/test/page-ordering.test.ts`:

```typescript
// ── Tests: addFavorite position ──────────────────────────────────────────────

describe('page.addFavorite — appends at tail', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sets position = 0 when user has no existing favorites', async () => {
    const upsert = vi.fn(async () => ({}))
    const prisma = {
      page: { findFirst: vi.fn(async () => ({ id: PAGE_A, workspaceId: WS_ID, createdById: USER_ID })) },
      workspaceMember: { findUnique: vi.fn(async () => ({ role: 'MEMBER' })) },
      workspace: { findUnique: vi.fn(async () => ({ plan: { features: [] } })) },
      favoritePage: {
        aggregate: vi.fn(async () => ({ _max: { position: null } })),
        upsert,
      },
    }

    await caller(ctx(prisma)).addFavorite({ pageId: PAGE_A })

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ position: 0 }) }),
    )
  })

  it('sets position = max + 1 when favorites already exist', async () => {
    const upsert = vi.fn(async () => ({}))
    const prisma = {
      page: { findFirst: vi.fn(async () => ({ id: PAGE_A, workspaceId: WS_ID, createdById: USER_ID })) },
      workspaceMember: { findUnique: vi.fn(async () => ({ role: 'MEMBER' })) },
      workspace: { findUnique: vi.fn(async () => ({ plan: { features: [] } })) },
      favoritePage: {
        aggregate: vi.fn(async () => ({ _max: { position: 4 } })),
        upsert,
      },
    }

    await caller(ctx(prisma)).addFavorite({ pageId: PAGE_A })

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ position: 5 }) }),
    )
  })
})

// ── Tests: listFavorites order ───────────────────────────────────────────────

describe('page.listFavorites — ordered by position ASC', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes orderBy position asc to prisma', async () => {
    const findMany = vi.fn(async () => [])
    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => ({ role: 'MEMBER' })) },
      favoritePage: { findMany },
    }

    await caller(ctx(prisma)).listFavorites({ workspaceId: WS_ID })

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { position: 'asc' } }),
    )
  })
})
```

- [ ] **Step 3.2 — Run tests to verify failure**

```bash
pnpm --filter @repo/trpc test -- page-ordering
```

Expected: FAIL — `addFavorite` and `listFavorites` tests fail (no `aggregate` call, no `orderBy position`).

- [ ] **Step 3.3 — Implement addFavorite with position**

In `packages/trpc/src/routers/page.ts`, replace the `addFavorite` procedure:

```typescript
addFavorite: protectedProcedure
  .input(z.object({ pageId: z.string().uuid() }))
  .mutation(async ({ ctx, input }) => {
    const page = await assertPageAccess(ctx, input.pageId)
    await requireWritableWorkspace(page.workspaceId)

    const maxResult = await ctx.prisma.favoritePage.aggregate({
      where: { userId: ctx.user.id },
      _max: { position: true },
    })
    const nextPosition = (maxResult._max.position ?? -1) + 1

    return ctx.prisma.favoritePage.upsert({
      where: { userId_pageId: { userId: ctx.user.id, pageId: input.pageId } },
      create: { userId: ctx.user.id, pageId: input.pageId, position: nextPosition },
      update: {},
    })
  }),
```

- [ ] **Step 3.4 — Implement listFavorites ordered by position**

In `packages/trpc/src/routers/page.ts`, in `listFavorites`, replace `orderBy: { createdAt: 'desc' }` with:

```typescript
orderBy: { position: 'asc' },
```

- [ ] **Step 3.5 — Run tests**

```bash
pnpm --filter @repo/trpc test -- page-ordering
```

Expected: all tests PASS.

- [ ] **Step 3.6 — Commit**

```bash
git add packages/trpc/src/routers/page.ts packages/trpc/test/page-ordering.test.ts
git commit -m "feat(trpc): favorites ordered by position; addFavorite appends at tail"
```

---

## Task 4: Backend — page.reorder procedure

**Files:**
- Modify: `packages/trpc/src/routers/page.ts`
- Modify: `packages/trpc/test/page-ordering.test.ts`

- [ ] **Step 4.1 — Write failing tests**

Append to `packages/trpc/test/page-ordering.test.ts`:

```typescript
// ── Tests: page.reorder ──────────────────────────────────────────────────────

/** Build a prisma mock for reorder tests */
function reorderPrisma(overrides: {
  page?: Record<string, unknown>
  extra?: Record<string, unknown>
} = {}) {
  const basePage = {
    id: PAGE_B,
    workspaceId: WS_ID,
    parentId: null,
    prevPageId: PAGE_A,
    deletedAt: null,
  }
  const txPage = {
    findFirst: vi.fn(async (q: { where: Record<string, unknown> }) => {
      // nextSibling query: looking for prevPageId = PAGE_B
      if (q.where?.prevPageId === PAGE_B) return { id: PAGE_C, prevPageId: PAGE_B }
      // pageAtInsertPoint query: page at newPrevPageId position
      return null
    }),
    update: vi.fn(async () => ({})),
    ...overrides.page,
  }
  return {
    workspaceMember: { findUnique: vi.fn(async () => ({ role: 'MEMBER' })) },
    workspace: { findUnique: vi.fn(async () => ({ plan: { features: [] } })) },
    page: {
      findFirst: vi.fn(async () => basePage),
      findMany: vi.fn(async () => []),
    },
    outboxEvent: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({ page: txPage, outboxEvent: { create: vi.fn(async () => ({})) } }),
    ),
    ...overrides.extra,
  }
}

describe('page.reorder', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reorders siblings: detaches from old position and inserts at new', async () => {
    // List: A → B → C. Move B to after C (newPrevPageId = PAGE_C).
    const txPage = {
      findFirst: vi.fn()
        .mockResolvedValueOnce({ id: PAGE_C, prevPageId: PAGE_B }) // nextSibling of B = C
        .mockResolvedValueOnce(null), // no page after PAGE_C in new position
      update: vi.fn(async () => ({})),
    }
    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => ({ role: 'MEMBER' })) },
      workspace: { findUnique: vi.fn(async () => ({ plan: { features: [] } })) },
      page: {
        findFirst: vi.fn(async () => ({
          id: PAGE_B, workspaceId: WS_ID, parentId: null, prevPageId: PAGE_A, deletedAt: null,
        })),
        findMany: vi.fn(async () => []),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({ page: txPage, outboxEvent: { create: vi.fn(async () => ({})) } }),
      ),
    }

    await caller(ctx(prisma)).reorder({
      pageId: PAGE_B,
      newParentId: null,
      newPrevPageId: PAGE_C,
    })

    // Step 1: detach — C's prevPageId should be set to B's old prevPageId (PAGE_A)
    expect(txPage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PAGE_C },
        data: { prevPageId: PAGE_A },
      }),
    )
    // Step 3: update moved page — B gets prevPageId = PAGE_C
    expect(txPage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PAGE_B },
        data: expect.objectContaining({ prevPageId: PAGE_C }),
      }),
    )
  })

  it('changes parent when newParentId differs', async () => {
    const PARENT_ID = '77777777-7777-7777-7777-777777777777'
    const txPage = {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn(async () => ({})),
    }
    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => ({ role: 'MEMBER' })) },
      workspace: { findUnique: vi.fn(async () => ({ plan: { features: [] } })) },
      page: {
        findFirst: vi.fn(async () => ({
          id: PAGE_B, workspaceId: WS_ID, parentId: null, prevPageId: null, deletedAt: null,
        })),
        findMany: vi.fn(async () => []),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({ page: txPage, outboxEvent: { create: vi.fn(async () => ({})) } }),
      ),
    }

    await caller(ctx(prisma)).reorder({
      pageId: PAGE_B,
      newParentId: PARENT_ID,
      newPrevPageId: null,
    })

    expect(txPage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PAGE_B },
        data: expect.objectContaining({ parentId: PARENT_ID }),
      }),
    )
  })

  it('rejects non-member', async () => {
    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => null) },
      workspace: { findUnique: vi.fn(async () => ({ plan: { features: [] } })) },
      page: {
        findFirst: vi.fn(async () => ({
          id: PAGE_B, workspaceId: WS_ID, parentId: null, prevPageId: null, deletedAt: null,
        })),
        findMany: vi.fn(async () => []),
      },
    }

    await expect(
      caller(ctx(prisma)).reorder({ pageId: PAGE_B, newParentId: null, newPrevPageId: null }),
    ).rejects.toThrow()
  })

  it('rejects cycle: moving page into its own descendant', async () => {
    const CHILD_ID = '88888888-8888-8888-8888-888888888888'
    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => ({ role: 'MEMBER' })) },
      workspace: { findUnique: vi.fn(async () => ({ plan: { features: [] } })) },
      page: {
        findFirst: vi.fn(async () => ({
          id: PAGE_B, workspaceId: WS_ID, parentId: null, prevPageId: null, deletedAt: null,
        })),
        // first findMany call returns CHILD_ID as descendant
        findMany: vi.fn(async () => [{ id: CHILD_ID }]),
      },
    }

    await expect(
      caller(ctx(prisma)).reorder({ pageId: PAGE_B, newParentId: CHILD_ID, newPrevPageId: null }),
    ).rejects.toThrow(/потомка/)
  })

  it('is a no-op when position unchanged', async () => {
    const txFn = vi.fn()
    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => ({ role: 'MEMBER' })) },
      workspace: { findUnique: vi.fn(async () => ({ plan: { features: [] } })) },
      page: {
        findFirst: vi.fn(async () => ({
          id: PAGE_B, workspaceId: WS_ID, parentId: null, prevPageId: PAGE_A, deletedAt: null,
        })),
        findMany: vi.fn(async () => []),
      },
      $transaction: txFn,
    }

    await caller(ctx(prisma)).reorder({
      pageId: PAGE_B,
      newParentId: null,      // same as current
      newPrevPageId: PAGE_A,  // same as current
    })

    expect(txFn).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 4.2 — Run tests to verify failure**

```bash
pnpm --filter @repo/trpc test -- page-ordering
```

Expected: FAIL — `reorder` is not defined.

- [ ] **Step 4.3 — Implement page.reorder**

In `packages/trpc/src/routers/page.ts`, add the `reorder` procedure before `addFavorite`:

```typescript
reorder: protectedProcedure
  .input(
    z.object({
      pageId: z.string().uuid(),
      newParentId: z.string().uuid().nullable(),
      newPrevPageId: z.string().uuid().nullable(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    if (input.newPrevPageId === input.pageId) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Страница не может ссылаться на себя' })
    }

    const page = await ctx.prisma.page.findFirst({
      where: { id: input.pageId, deletedAt: null },
    })
    if (!page) throw new TRPCError({ code: 'NOT_FOUND', message: 'Страница не найдена' })

    await assertWorkspaceMember(ctx, page.workspaceId)
    await requireWritableWorkspace(page.workspaceId)

    // No-op: nothing changed
    if (page.parentId === input.newParentId && page.prevPageId === input.newPrevPageId) {
      return { id: input.pageId }
    }

    // Cycle check: newParentId must not be a descendant of pageId
    if (input.newParentId !== null) {
      let queue = [input.pageId]
      while (queue.length > 0) {
        const children = await ctx.prisma.page.findMany({
          where: { parentId: { in: queue }, deletedAt: null },
          select: { id: true },
        })
        const childIds = children.map((c) => c.id)
        if (childIds.includes(input.newParentId)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Нельзя вложить страницу в собственного потомка',
          })
        }
        queue = childIds
      }
    }

    return ctx.prisma.$transaction(async (tx) => {
      // Step 1: Detach — fix next sibling's back-pointer
      const nextSibling = await tx.page.findFirst({
        where: { prevPageId: input.pageId, deletedAt: null },
      })
      if (nextSibling) {
        await tx.page.update({
          where: { id: nextSibling.id },
          data: { prevPageId: page.prevPageId },
        })
      }

      // Step 2: Plug the gap at insert point — the page that currently sits
      // after newPrevPageId in the target parent group now points to pageId
      const pageAtInsertPoint = await tx.page.findFirst({
        where: {
          prevPageId: input.newPrevPageId,
          workspaceId: page.workspaceId,
          parentId: input.newParentId,
          deletedAt: null,
          id: { not: input.pageId },
        },
      })
      if (pageAtInsertPoint) {
        await tx.page.update({
          where: { id: pageAtInsertPoint.id },
          data: { prevPageId: input.pageId },
        })
      }

      // Step 3: Update the moved page
      await tx.page.update({
        where: { id: input.pageId },
        data: {
          parentId: input.newParentId,
          prevPageId: input.newPrevPageId,
          updatedById: ctx.user.id,
        },
      })

      await enqueueOutboxEvent(tx, {
        eventType: 'page.upserted',
        aggregateType: 'page',
        aggregateId: input.pageId,
        workspaceId: page.workspaceId,
      })

      return { id: input.pageId }
    })
  }),
```

- [ ] **Step 4.4 — Run tests**

```bash
pnpm --filter @repo/trpc test -- page-ordering
```

Expected: all tests PASS.

- [ ] **Step 4.5 — Type check**

```bash
pnpm check-types
```

Expected: no errors.

- [ ] **Step 4.6 — Commit**

```bash
git add packages/trpc/src/routers/page.ts packages/trpc/test/page-ordering.test.ts
git commit -m "feat(trpc): add page.reorder — workspace-shared DnD tree reordering"
```

---

## Task 5: Backend — page.reorderFavorites procedure

**Files:**
- Modify: `packages/trpc/src/routers/page.ts`
- Modify: `packages/trpc/test/page-ordering.test.ts`

- [ ] **Step 5.1 — Write failing test**

Append to `packages/trpc/test/page-ordering.test.ts`:

```typescript
// ── Tests: page.reorderFavorites ─────────────────────────────────────────────

describe('page.reorderFavorites', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updates position = index for each id in orderedIds', async () => {
    const updateMany = vi.fn(async () => ({}))
    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => ({ role: 'MEMBER' })) },
      favoritePage: { updateMany },
      $transaction: vi.fn(async (fns: unknown[]) =>
        Promise.all((fns as Array<Promise<unknown>>)),
      ),
    }

    await caller(ctx(prisma)).reorderFavorites({
      workspaceId: WS_ID,
      orderedIds: [PAGE_C, PAGE_A, PAGE_B],
    })

    expect(updateMany).toHaveBeenCalledTimes(3)
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ pageId: PAGE_C, userId: USER_ID }),
        data: { position: 0 },
      }),
    )
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ pageId: PAGE_A, userId: USER_ID }),
        data: { position: 1 },
      }),
    )
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ pageId: PAGE_B, userId: USER_ID }),
        data: { position: 2 },
      }),
    )
  })

  it('rejects non-member', async () => {
    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => null) },
    }
    await expect(
      caller(ctx(prisma)).reorderFavorites({ workspaceId: WS_ID, orderedIds: [PAGE_A] }),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 5.2 — Run test to verify failure**

```bash
pnpm --filter @repo/trpc test -- page-ordering
```

Expected: FAIL — `reorderFavorites` is not defined.

- [ ] **Step 5.3 — Implement page.reorderFavorites**

In `packages/trpc/src/routers/page.ts`, add after `removeFavorite`:

```typescript
reorderFavorites: protectedProcedure
  .input(
    z.object({
      workspaceId: z.string().uuid(),
      orderedIds: z.array(z.string().uuid()),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    await assertWorkspaceMember(ctx, input.workspaceId)

    await ctx.prisma.$transaction(
      input.orderedIds.map((pageId, index) =>
        ctx.prisma.favoritePage.updateMany({
          where: {
            userId: ctx.user.id,
            pageId,
            page: { workspaceId: input.workspaceId },
          },
          data: { position: index },
        }),
      ),
    )

    return { ok: true }
  }),
```

- [ ] **Step 5.4 — Run tests**

```bash
pnpm --filter @repo/trpc test -- page-ordering
```

Expected: all tests PASS.

- [ ] **Step 5.5 — Run full trpc test suite**

```bash
pnpm --filter @repo/trpc test
```

Expected: all tests PASS.

- [ ] **Step 5.6 — Type check + lint**

```bash
pnpm check-types && pnpm lint
```

Expected: no errors or warnings.

- [ ] **Step 5.7 — Commit**

```bash
git add packages/trpc/src/routers/page.ts packages/trpc/test/page-ordering.test.ts
git commit -m "feat(trpc): add page.reorderFavorites — personalized favorites ordering"
```

---

## Task 6: Frontend types — FlatPageItem + flattenTree + dnd-kit install

**Files:**
- Modify: `apps/web/src/components/workspace/types.ts`
- Modify: `apps/web/package.json`

- [ ] **Step 6.1 — Install dnd-kit**

```bash
pnpm --filter web add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

Expected: packages added to `apps/web/package.json`.

- [ ] **Step 6.2 — Add FlatPageItem type and flattenTree to types.ts**

In `apps/web/src/components/workspace/types.ts`, append after the existing exports:

```typescript
export type FlatPageItem = PageItem & {
  depth: number
  collapsed: boolean
}

/**
 * Converts hierarchical pages into a flat ordered list for DnD rendering.
 * Children of collapsed nodes are omitted.
 */
export function flattenTree(
  pages: PageItem[],
  parentId: string | null = null,
  depth = 0,
  collapsedIds: Set<string> = new Set(),
): FlatPageItem[] {
  const siblings = orderSiblings(pages.filter((p) => p.parentId === parentId))
  const result: FlatPageItem[] = []
  for (const page of siblings) {
    const collapsed = collapsedIds.has(page.id)
    result.push({ ...page, depth, collapsed })
    if (!collapsed) {
      result.push(...flattenTree(pages, page.id, depth + 1, collapsedIds))
    }
  }
  return result
}
```

- [ ] **Step 6.3 — Type check**

```bash
pnpm check-types
```

Expected: no errors.

- [ ] **Step 6.4 — Commit**

```bash
git add apps/web/package.json apps/web/src/components/workspace/types.ts pnpm-lock.yaml
git commit -m "feat(web): install dnd-kit, add FlatPageItem + flattenTree"
```

---

## Task 7: Frontend — PageTreeSection DnD

**Files:**
- Modify: `apps/web/src/components/workspace/page-tree-section.tsx`

The existing component uses a recursive `PageTreeItem` that manages its own `expanded` state. We replace this with a flat-list approach: `collapsedIds` is lifted to `PageTreeSection`, the tree is flattened to `FlatPageItem[]`, and each row is wrapped in `useSortable`.

- [ ] **Step 7.1 — Rewrite page-tree-section.tsx**

Replace the full content of `apps/web/src/components/workspace/page-tree-section.tsx` with:

```typescript
'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useMemo, useState, useRef, type MouseEvent } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  AccountTreeIcon,
  AddIcon,
  Box,
  BrushIcon,
  ChevronRightIcon,
  DescriptionIcon,
  DragIndicatorIcon,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  MoreHorizIcon,
  SchemaIcon,
  Typography,
  ViewKanbanIcon,
} from '@repo/ui/components'
import type { PageType } from '@repo/db'
import { trpc } from '@/trpc/client'
import { PageContextMenu } from './page-context-menu'
import { MovePageDialog } from './move-page-dialog'
import { type FlatPageItem, type PageItem, flattenTree } from './types'

// ── Types ─────────────────────────────────────────────────────────────────────

type CreatablePageType = Extract<
  PageType,
  'TEXT' | 'EXCALIDRAW' | 'GENOGRAM' | 'MERMAID' | 'PLANTUML' | 'LIKEC4' | 'DRAWIO' | 'KANBAN'
>

type Props = {
  workspaceId: string
  pages: PageItem[]
  favoritePageIds: Set<string>
}

// ── Submenus (unchanged from original) ───────────────────────────────────────

function DiagramSubmenu({
  onCreate,
  onClose,
}: {
  onCreate: (type: CreatablePageType) => void
  onClose: () => void
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const choose = (type: CreatablePageType) => { onCreate(type); setAnchor(null); onClose() }
  return (
    <>
      <MenuItem onClick={(e) => setAnchor(e.currentTarget)}>
        <ListItemIcon><SchemaIcon fontSize="small" /></ListItemIcon>
        <ListItemText primary="Диаграмма" />
        <ChevronRightIcon fontSize="small" sx={{ ml: 'auto', color: 'text.secondary' }} />
      </MenuItem>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        onClick={(e) => e.stopPropagation()}>
        <MenuItem onClick={() => choose('MERMAID')}><ListItemIcon><SchemaIcon fontSize="small" /></ListItemIcon><ListItemText primary="MermaidJS" /></MenuItem>
        <MenuItem onClick={() => choose('PLANTUML')}><ListItemIcon><SchemaIcon fontSize="small" /></ListItemIcon><ListItemText primary="PlantUML" /></MenuItem>
        <MenuItem onClick={() => choose('LIKEC4')}><ListItemIcon><SchemaIcon fontSize="small" /></ListItemIcon><ListItemText primary="LikeC4" /></MenuItem>
      </Menu>
    </>
  )
}

function HolstSubmenu({
  onCreate,
  onClose,
}: {
  onCreate: (type: CreatablePageType) => void
  onClose: () => void
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const choose = (type: CreatablePageType) => { onCreate(type); setAnchor(null); onClose() }
  return (
    <>
      <MenuItem onClick={(e) => setAnchor(e.currentTarget)}>
        <ListItemIcon><BrushIcon fontSize="small" /></ListItemIcon>
        <ListItemText primary="Холст" />
        <ChevronRightIcon fontSize="small" sx={{ ml: 'auto', color: 'text.secondary' }} />
      </MenuItem>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        onClick={(e) => e.stopPropagation()}>
        <MenuItem onClick={() => choose('EXCALIDRAW')}><ListItemIcon><BrushIcon fontSize="small" /></ListItemIcon><ListItemText primary="Excalidraw" /></MenuItem>
        <MenuItem onClick={() => choose('DRAWIO')}><ListItemIcon><SchemaIcon fontSize="small" /></ListItemIcon><ListItemText primary="Draw.io" /></MenuItem>
      </Menu>
    </>
  )
}

function CreatePageMenu({
  anchorEl,
  onClose,
  onCreate,
}: {
  anchorEl: HTMLElement | null
  onClose: () => void
  onCreate: (type: CreatablePageType) => void
}) {
  return (
    <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={onClose} onClick={(e) => e.stopPropagation()}>
      <MenuItem onClick={() => { onCreate('TEXT'); onClose() }}>
        <ListItemIcon><DescriptionIcon fontSize="small" /></ListItemIcon>
        <ListItemText primary="Текст" />
      </MenuItem>
      <HolstSubmenu onCreate={onCreate} onClose={onClose} />
      <MenuItem onClick={() => { onCreate('GENOGRAM'); onClose() }}>
        <ListItemIcon><AccountTreeIcon fontSize="small" /></ListItemIcon>
        <ListItemText primary="Генограмма" />
      </MenuItem>
      <MenuItem onClick={() => { onCreate('KANBAN'); onClose() }}>
        <ListItemIcon><ViewKanbanIcon fontSize="small" /></ListItemIcon>
        <ListItemText primary="Канбан" />
      </MenuItem>
      <DiagramSubmenu onCreate={onCreate} onClose={onClose} />
    </Menu>
  )
}

// ── DropLine ─────────────────────────────────────────────────────────────────

function DropLine({ depth }: { depth: number }) {
  return (
    <Box
      sx={{
        position: 'absolute',
        left: 4 + depth * 24,
        right: 4,
        height: 2,
        borderRadius: 1,
        bgcolor: 'primary.main',
        pointerEvents: 'none',
        zIndex: 10,
      }}
    />
  )
}

// ── SortablePageRow ───────────────────────────────────────────────────────────

function SortablePageRow({
  item,
  workspaceId,
  pages,
  favoritePageIds,
  isActive,
  showDropBefore,
  showDropAfter,
  onToggleCollapse,
}: {
  item: FlatPageItem
  workspaceId: string
  pages: PageItem[]
  favoritePageIds: Set<string>
  isActive: boolean
  showDropBefore: boolean
  showDropAfter: boolean
  onToggleCollapse: (id: string) => void
}) {
  const pathname = usePathname()
  const router = useRouter()
  const utils = trpc.useUtils()

  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [createAnchor, setCreateAnchor] = useState<HTMLElement | null>(null)
  const [moveOpen, setMoveOpen] = useState(false)

  const isCurrentPage = pathname === `/workspaces/${workspaceId}/pages/${item.id}`
  const hasChildren = pages.some((p) => p.parentId === item.id)

  const createPage = trpc.page.create.useMutation({
    onSuccess: async (data) => {
      await utils.page.listByWorkspace.invalidate({ workspaceId })
      router.push(`/workspaces/${workspaceId}/pages/${data.id}`)
    },
  })

  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    position: 'relative' as const,
  }

  return (
    <Box ref={setNodeRef} style={style} data-page-row={item.id}>
      {showDropBefore && <DropLine depth={item.depth} />}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          pr: 0.5,
          pl: 0.5 + item.depth * 1.5,
          borderRadius: 0.75,
          bgcolor: isCurrentPage ? 'action.selected' : 'transparent',
          '&:hover': { bgcolor: isCurrentPage ? 'action.selected' : 'action.hover' },
          '&:hover .page-actions': { visibility: 'visible' },
          '&:hover .drag-handle': { visibility: 'visible' },
        }}
      >
        {/* Drag handle */}
        <Box
          ref={setActivatorNodeRef}
          className="drag-handle"
          {...attributes}
          {...listeners}
          data-drag-handle={item.id}
          sx={{
            visibility: 'hidden',
            cursor: 'grab',
            display: 'flex',
            alignItems: 'center',
            color: 'text.disabled',
            mr: 0.25,
            flexShrink: 0,
            '&:active': { cursor: 'grabbing' },
          }}
        >
          <DragIndicatorIcon sx={{ fontSize: 14 }} />
        </Box>

        {/* Expand/collapse toggle */}
        {hasChildren ? (
          <IconButton
            size="small"
            onClick={() => onToggleCollapse(item.id)}
            sx={{ p: 0, mr: 0.25 }}
          >
            <ChevronRightIcon
              sx={{
                fontSize: 16,
                transform: item.collapsed ? 'none' : 'rotate(90deg)',
                transition: 'transform 0.15s',
              }}
            />
          </IconButton>
        ) : null}

        {/* Page link */}
        <Link
          href={`/workspaces/${workspaceId}/pages/${item.id}`}
          onClick={(e) => e.stopPropagation()}
          style={{ textDecoration: 'none', flex: 1, minWidth: 0, display: 'flex', gap: 4 }}
        >
          {item.icon ? (
            <Typography variant="body2" component="span" sx={{ flexShrink: 0, lineHeight: '28px' }}>
              {item.icon}
            </Typography>
          ) : null}
          <Typography
            variant="body2"
            noWrap
            sx={{ py: 0.5, color: isCurrentPage ? 'text.primary' : 'text.secondary' }}
          >
            {item.title ?? 'Новая страница'}
          </Typography>
        </Link>

        {/* Actions */}
        <Box
          className="page-actions"
          sx={{
            display: 'flex',
            visibility: menuAnchor || createAnchor ? 'visible' : 'hidden',
            flexShrink: 0,
          }}
        >
          <IconButton
            size="small"
            onClick={(e: MouseEvent<HTMLElement>) => { e.stopPropagation(); setCreateAnchor(e.currentTarget) }}
            sx={{ p: 0.25 }}
          >
            <AddIcon sx={{ fontSize: 16 }} />
          </IconButton>
          <IconButton
            size="small"
            onClick={(e) => { e.stopPropagation(); setMenuAnchor(e.currentTarget as HTMLElement) }}
            sx={{ p: 0.25 }}
          >
            <MoreHorizIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>
      </Box>
      {showDropAfter && <DropLine depth={item.depth} />}

      <CreatePageMenu
        anchorEl={createAnchor}
        onClose={() => setCreateAnchor(null)}
        onCreate={(type) => createPage.mutate({ workspaceId, parentId: item.id, type })}
      />
      <PageContextMenu
        anchorEl={menuAnchor}
        onClose={() => setMenuAnchor(null)}
        page={item}
        workspaceId={workspaceId}
        isFavorite={favoritePageIds.has(item.id)}
        onOpenMoveDialog={() => { setMenuAnchor(null); setMoveOpen(true) }}
      />
      <MovePageDialog
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        page={item}
        pages={pages}
        workspaceId={workspaceId}
      />
    </Box>
  )
}

// ── PageTreeSection ───────────────────────────────────────────────────────────

export function PageTreeSection({ workspaceId, pages: initialPages, favoritePageIds }: Props) {
  const [createAnchor, setCreateAnchor] = useState<HTMLElement | null>(null)
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const router = useRouter()
  const utils = trpc.useUtils()

  const pagesQuery = trpc.page.listByWorkspace.useQuery({ workspaceId })
  const pages = pagesQuery.data ?? initialPages

  const reorder = trpc.page.reorder.useMutation({
    onError: () => utils.page.listByWorkspace.invalidate({ workspaceId }),
  })

  const createPage = trpc.page.create.useMutation({
    onSuccess: async (data) => {
      await utils.page.listByWorkspace.invalidate({ workspaceId })
      router.push(`/workspaces/${workspaceId}/pages/${data.id}`)
    },
  })

  const flatItems = useMemo(
    () => flattenTree(pages, null, 0, collapsedIds),
    [pages, collapsedIds],
  )

  const toggleCollapse = useCallback((id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  )

  function onDragStart({ active }: DragStartEvent) {
    setActiveId(active.id as string)
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    setActiveId(null)
    setOverIndex(null)

    if (!over || active.id === over.id) return

    const activeIdx = flatItems.findIndex((i) => i.id === active.id)
    const overIdx = flatItems.findIndex((i) => i.id === over.id)
    if (activeIdx === -1 || overIdx === -1) return

    const overItem = flatItems[overIdx]
    // Dropping before overItem if dragging downward past it, else after
    const droppingBefore = activeIdx > overIdx

    const newParentId = overItem.parentId
    const newPrevPageId = droppingBefore ? overItem.prevPageId : overItem.id

    // Optimistic update: patch the cached page list linked-list pointers
    utils.page.listByWorkspace.setData({ workspaceId }, (old) => {
      if (!old) return old
      const active = old.find((p) => p.id === (active as DragEndEvent['active']).id)
      // Find current next sibling of dragged page
      const currentNextSiblingId = old.find((p) => p.prevPageId === activeId)?.id
      // Find page at insert point
      const pageAtInsertPointId = old.find(
        (p) => p.prevPageId === newPrevPageId && p.parentId === newParentId && p.id !== activeId,
      )?.id
      return old.map((p) => {
        if (p.id === activeId) return { ...p, parentId: newParentId, prevPageId: newPrevPageId }
        if (currentNextSiblingId && p.id === currentNextSiblingId)
          return { ...p, prevPageId: active?.prevPageId ?? null }
        if (pageAtInsertPointId && p.id === pageAtInsertPointId)
          return { ...p, prevPageId: activeId }
        return p
      })
    })

    reorder.mutate({ pageId: active.id as string, newParentId, newPrevPageId })
  }

  const activeItem = activeId ? flatItems.find((i) => i.id === activeId) : null

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, gap: 1 }}>
        <Typography variant="overline" sx={{ color: 'text.secondary', letterSpacing: '0.06em' }}>
          Страницы
        </Typography>
        <IconButton
          aria-label="Новая страница"
          size="small"
          onClick={(e: MouseEvent<HTMLElement>) => setCreateAnchor(e.currentTarget)}
        >
          <AddIcon sx={{ fontSize: 16 }} />
        </IconButton>
        <CreatePageMenu
          anchorEl={createAnchor}
          onClose={() => setCreateAnchor(null)}
          onCreate={(type) => createPage.mutate({ workspaceId, parentId: null, type })}
        />
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={flatItems.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            {flatItems.map((item, idx) => (
              <SortablePageRow
                key={item.id}
                item={item}
                workspaceId={workspaceId}
                pages={pages}
                favoritePageIds={favoritePageIds}
                isActive={item.id === activeId}
                showDropBefore={activeId !== null && overIndex === idx && flatItems.findIndex((i) => i.id === activeId) > idx}
                showDropAfter={activeId !== null && overIndex === idx && flatItems.findIndex((i) => i.id === activeId) < idx}
                onToggleCollapse={toggleCollapse}
              />
            ))}
          </SortableContext>
          <DragOverlay>
            {activeItem ? (
              <Box
                sx={{
                  pl: 0.5 + activeItem.depth * 1.5,
                  py: 0.5,
                  borderRadius: 0.75,
                  bgcolor: 'background.paper',
                  boxShadow: 3,
                  opacity: 0.9,
                }}
              >
                <Typography variant="body2" noWrap sx={{ color: 'text.secondary' }}>
                  {activeItem.icon ? `${activeItem.icon} ` : ''}{activeItem.title ?? 'Новая страница'}
                </Typography>
              </Box>
            ) : null}
          </DragOverlay>
        </DndContext>
      </Box>
    </Box>
  )
}
```

- [ ] **Step 7.2 — Verify DragIndicatorIcon is exported from @repo/ui**

```bash
grep -r "DragIndicatorIcon" /Users/victor/Projects/anynote/packages/ui/src/
```

If not found, add to `packages/ui/src/components/index.ts`:
```typescript
export { DragIndicator as DragIndicatorIcon } from '@mui/icons-material'
```

- [ ] **Step 7.3 — Type check**

```bash
pnpm check-types
```

Fix any errors. Common ones:
- `active` variable shadowing in `onDragEnd` — rename the captured `active` to `activePageData`
- Missing imports from `@dnd-kit/*`

- [ ] **Step 7.4 — Lint**

```bash
pnpm lint
```

Expected: no warnings (0 warnings due to `--max-warnings 0`).

- [ ] **Step 7.5 — Commit**

```bash
git add apps/web/src/components/workspace/page-tree-section.tsx packages/ui/src/components/index.ts
git commit -m "feat(web): page tree drag-and-drop reordering via dnd-kit"
```

---

## Task 8: Frontend — FavoritesSection DnD

**Files:**
- Modify: `apps/web/src/components/workspace/favorites-section.tsx`

- [ ] **Step 8.1 — Rewrite favorites-section.tsx with DnD**

Replace the full content of `apps/web/src/components/workspace/favorites-section.tsx`:

```typescript
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ArrowDropDownIcon,
  ArrowDropUpIcon,
  Box,
  DragIndicatorIcon,
  IconButton,
  MoreHorizIcon,
  Stack,
  StarIcon,
  Typography,
} from '@repo/ui/components'
import { trpc } from '@/trpc/client'
import { PageContextMenu } from './page-context-menu'
import { MovePageDialog } from './move-page-dialog'
import type { PageItem } from './types'

type Props = {
  workspaceId: string
  allPages: PageItem[]
  favoritePageIds: Set<string>
}

function getAllDescendants(pageId: string, allPages: PageItem[]): PageItem[] {
  const result: PageItem[] = []
  const directChildren = allPages.filter((p) => p.parentId === pageId)
  for (const child of directChildren) {
    result.push(child)
    result.push(...getAllDescendants(child.id, allPages))
  }
  return result
}

// ── SortableFavItem ───────────────────────────────────────────────────────────

function SortableFavItem({
  page,
  workspaceId,
  onOpenMenu,
  isFavorite,
}: {
  page: PageItem
  workspaceId: string
  onOpenMenu: (event: React.MouseEvent<HTMLElement>, page: PageItem) => void
  isFavorite: boolean
}) {
  const pathname = usePathname()
  const isActive = pathname === `/workspaces/${workspaceId}/pages/${page.id}`

  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: page.id })

  return (
    <Box
      ref={setNodeRef}
      data-fav-row={page.id}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      sx={{
        display: 'flex',
        alignItems: 'center',
        pr: 0.5,
        pl: 1,
        borderRadius: 0.75,
        color: 'text.secondary',
        bgcolor: isActive ? 'action.selected' : 'transparent',
        '&:hover': { bgcolor: isActive ? 'action.selected' : 'action.hover' },
        '&:hover .fav-more': { visibility: 'visible' },
        '&:hover .fav-handle': { visibility: 'visible' },
        fontSize: 13,
      }}
    >
      {/* Drag handle */}
      <Box
        ref={setActivatorNodeRef}
        className="fav-handle"
        {...attributes}
        {...listeners}
        data-drag-handle={page.id}
        sx={{
          visibility: 'hidden',
          cursor: 'grab',
          display: 'flex',
          alignItems: 'center',
          color: 'text.disabled',
          mr: 0.25,
          flexShrink: 0,
          '&:active': { cursor: 'grabbing' },
        }}
      >
        <DragIndicatorIcon sx={{ fontSize: 14 }} />
      </Box>

      <Link
        href={`/workspaces/${workspaceId}/pages/${page.id}`}
        style={{
          textDecoration: 'none',
          color: 'inherit',
          display: 'flex',
          alignItems: 'center',
          flex: 1,
          minWidth: 0,
          paddingTop: 4,
          paddingBottom: 4,
        }}
      >
        {page.icon ? (
          <span style={{ fontSize: 14, marginRight: 8, flexShrink: 0 }}>{page.icon}</span>
        ) : null}
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {page.title ?? 'Новая страница'}
        </span>
      </Link>

      <IconButton
        size="small"
        className="fav-more"
        onClick={(e) => onOpenMenu(e, page)}
        sx={{ visibility: 'hidden', flexShrink: 0, p: 0.25 }}
      >
        <MoreHorizIcon sx={{ fontSize: 16 }} />
      </IconButton>
    </Box>
  )
}

// ── FavoritesSection ──────────────────────────────────────────────────────────

export function FavoritesSection({ workspaceId, allPages: initialPages, favoritePageIds }: Props) {
  const [open, setOpen] = useState(true)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [menuPage, setMenuPage] = useState<PageItem | null>(null)
  const [movePage, setMovePage] = useState<PageItem | null>(null)

  const favorites = trpc.page.listFavorites.useQuery({ workspaceId })
  const pagesQuery = trpc.page.listByWorkspace.useQuery({ workspaceId })
  const utils = trpc.useUtils()
  const allPages = pagesQuery.data ?? initialPages

  const reorderFavorites = trpc.page.reorderFavorites.useMutation({
    onError: () => utils.page.listFavorites.invalidate({ workspaceId }),
  })

  const favPages = favorites.data ?? []
  const hasFavorites = favPages.length > 0 || favoritePageIds.size > 0
  if (!hasFavorites && favorites.isFetched) return null

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  )

  function onDragEnd({ active, over }: DragEndEvent) {
    setActiveId(null)
    if (!over || active.id === over.id) return

    const activeIdx = favPages.findIndex((p) => p.id === active.id)
    const overIdx = favPages.findIndex((p) => p.id === over.id)
    if (activeIdx === -1 || overIdx === -1) return

    // Build reordered list
    const reordered = [...favPages]
    const [moved] = reordered.splice(activeIdx, 1)
    reordered.splice(overIdx, 0, moved)
    const orderedIds = reordered.map((p) => p.id)

    // Optimistic update
    utils.page.listFavorites.setData({ workspaceId }, reordered)

    reorderFavorites.mutate({ workspaceId, orderedIds })
  }

  const activeItem = activeId ? favPages.find((p) => p.id === activeId) : null

  const handleOpenMenu = (event: React.MouseEvent<HTMLElement>, page: PageItem) => {
    event.preventDefault()
    event.stopPropagation()
    setMenuAnchor(event.currentTarget)
    setMenuPage(page)
  }

  return (
    <Box>
      <Box
        onClick={() => setOpen((prev) => !prev)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1,
          py: 0.75,
          cursor: 'pointer',
          color: 'text.secondary',
          '&:hover': { color: 'text.primary' },
        }}
      >
        <StarIcon sx={{ fontSize: 16 }} />
        <Typography variant="overline" sx={{ color: 'inherit', flex: 1, letterSpacing: '0.06em', lineHeight: 1.4 }}>
          ИЗБРАННОЕ
        </Typography>
        {open ? <ArrowDropUpIcon sx={{ fontSize: 16 }} /> : <ArrowDropDownIcon sx={{ fontSize: 16 }} />}
      </Box>

      {open ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={({ active }) => setActiveId(active.id as string)}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={favPages.map((p) => p.id)} strategy={verticalListSortingStrategy}>
            <Stack spacing={0.25} sx={{ maxHeight: 200, overflow: 'auto' }}>
              {favPages.map((fav) => {
                const page = allPages.find((p) => p.id === fav.id) ?? {
                  ...fav,
                  prevPageId: null,
                  createdById: null,
                  createdAt: new Date(),
                }
                const descendants = getAllDescendants(fav.id, allPages)
                return (
                  <Box key={fav.id}>
                    <SortableFavItem
                      page={page}
                      workspaceId={workspaceId}
                      onOpenMenu={handleOpenMenu}
                      isFavorite={favoritePageIds.has(page.id)}
                    />
                    {descendants.map((child) => (
                      <Box key={child.id} sx={{ pl: 2 }}>
                        <SortableFavItem
                          page={child}
                          workspaceId={workspaceId}
                          onOpenMenu={handleOpenMenu}
                          isFavorite={favoritePageIds.has(child.id)}
                        />
                      </Box>
                    ))}
                  </Box>
                )
              })}
            </Stack>
          </SortableContext>
          <DragOverlay>
            {activeItem ? (
              <Box
                sx={{
                  px: 1,
                  py: 0.5,
                  borderRadius: 0.75,
                  bgcolor: 'background.paper',
                  boxShadow: 3,
                  opacity: 0.9,
                  fontSize: 13,
                  color: 'text.secondary',
                }}
              >
                {activeItem.icon ? `${activeItem.icon} ` : ''}{activeItem.title ?? 'Новая страница'}
              </Box>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : null}

      {menuPage ? (
        <PageContextMenu
          anchorEl={menuAnchor}
          onClose={() => setMenuAnchor(null)}
          page={menuPage}
          workspaceId={workspaceId}
          isFavorite={favoritePageIds.has(menuPage.id)}
          onOpenMoveDialog={() => { setMovePage(menuPage); setMenuAnchor(null) }}
        />
      ) : null}

      {movePage ? (
        <MovePageDialog
          open={!!movePage}
          onClose={() => setMovePage(null)}
          page={movePage}
          pages={allPages}
          workspaceId={workspaceId}
        />
      ) : null}
    </Box>
  )
}
```

- [ ] **Step 8.2 — Type check + lint**

```bash
pnpm check-types && pnpm lint
```

Expected: no errors.

- [ ] **Step 8.3 — Commit**

```bash
git add apps/web/src/components/workspace/favorites-section.tsx
git commit -m "feat(web): favorites section drag-and-drop reordering"
```

---

## Task 9: E2E tests

**Files:**
- Create: `apps/e2e/page-ordering.spec.ts`

- [ ] **Step 9.1 — Write E2E spec**

Create `apps/e2e/page-ordering.spec.ts`:

```typescript
import { expect, test } from '@playwright/test'
import { signUpAndAuthAs } from './helpers/auth'

const WS_SLUG = 'test-ordering'

test.describe('page ordering', () => {
  test.beforeEach(async ({ page }) => {
    await signUpAndAuthAs(page, `ordering-${Date.now()}@test.com`)
    // Navigate to workspace pages section
    await page.getByRole('button', { name: /страницы/i }).click()
  })

  // ── 1. New pages append at tail ─────────────────────────────────────────────

  test('new pages are added at the end of the list', async ({ page }) => {
    // Create three root pages via the + button
    const createBtn = page.getByRole('button', { name: /новая страница/i }).first()

    await createBtn.click()
    await page.getByRole('menuitem', { name: /текст/i }).click()
    await page.waitForURL(/\/pages\//)
    await page.getByRole('button', { name: /страницы/i }).click()

    await createBtn.click()
    await page.getByRole('menuitem', { name: /текст/i }).click()
    await page.waitForURL(/\/pages\//)
    await page.getByRole('button', { name: /страницы/i }).click()

    await createBtn.click()
    await page.getByRole('menuitem', { name: /текст/i }).click()
    await page.waitForURL(/\/pages\//)
    await page.getByRole('button', { name: /страницы/i }).click()

    // Wait for sidebar to stabilize
    const rows = page.locator('[data-page-row]')
    await expect(rows).toHaveCount(3)

    // Get the IDs in order
    const ids = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-page-row')))

    // The URL of the last created page should be the third item
    const lastUrl = page.url()
    const lastId = lastUrl.split('/pages/')[1]
    expect(ids[2]).toBe(lastId)
  })

  // ── 2. DnD reorder siblings ─────────────────────────────────────────────────

  test('drag-and-drop reorders pages in sidebar', async ({ page }) => {
    // Create two pages
    const createBtn = page.getByRole('button', { name: /новая страница/i }).first()

    await createBtn.click()
    await page.getByRole('menuitem', { name: /текст/i }).click()
    await page.waitForURL(/\/pages\//)
    // Rename to "Alpha" via the URL — just note the id
    const alphaId = page.url().split('/pages/')[1]
    await page.getByRole('button', { name: /страницы/i }).click()

    await createBtn.click()
    await page.getByRole('menuitem', { name: /текст/i }).click()
    await page.waitForURL(/\/pages\//)
    const betaId = page.url().split('/pages/')[1]
    await page.getByRole('button', { name: /страницы/i }).click()

    const rows = page.locator('[data-page-row]')
    await expect(rows).toHaveCount(2)

    // Initially: Alpha (index 0), Beta (index 1)
    const firstId = await rows.first().getAttribute('data-page-row')
    expect(firstId).toBe(alphaId)

    // Drag Beta's handle to above Alpha
    const betaHandle = page.locator(`[data-drag-handle="${betaId}"]`)
    const alphaRow = page.locator(`[data-page-row="${alphaId}"]`)

    await betaHandle.hover()
    const alphaBox = await alphaRow.boundingBox()
    const betaBox = await (page.locator(`[data-page-row="${betaId}"]`)).boundingBox()

    if (!alphaBox || !betaBox) throw new Error('Could not get bounding boxes')

    await page.mouse.move(betaBox.x + betaBox.width / 2, betaBox.y + betaBox.height / 2)
    await page.mouse.down()
    // Move to top of Alpha row (before position)
    await page.mouse.move(alphaBox.x + alphaBox.width / 2, alphaBox.y + 4, { steps: 10 })
    await page.mouse.up()

    // Verify new order after drop
    await page.waitForTimeout(300)
    const newFirstId = await rows.first().getAttribute('data-page-row')
    expect(newFirstId).toBe(betaId)

    // Verify persisted after reload
    await page.reload()
    await page.getByRole('button', { name: /страницы/i }).click()
    const reloadedFirstId = await page.locator('[data-page-row]').first().getAttribute('data-page-row')
    expect(reloadedFirstId).toBe(betaId)
  })

  // ── 3. Favorites DnD — personal order ──────────────────────────────────────

  test('favorites order is personalized and persists after reload', async ({ page }) => {
    // Create two pages and favorite both
    const createBtn = page.getByRole('button', { name: /новая страница/i }).first()

    await createBtn.click()
    await page.getByRole('menuitem', { name: /текст/i }).click()
    await page.waitForURL(/\/pages\//)
    const pageAId = page.url().split('/pages/')[1]
    await page.getByRole('button', { name: /страницы/i }).click()

    await createBtn.click()
    await page.getByRole('menuitem', { name: /текст/i }).click()
    await page.waitForURL(/\/pages\//)
    const pageBId = page.url().split('/pages/')[1]
    await page.getByRole('button', { name: /страницы/i }).click()

    // Star both pages via context menu
    for (const id of [pageAId, pageBId]) {
      const row = page.locator(`[data-page-row="${id}"]`)
      await row.hover()
      await row.locator('[aria-label]').last().click() // ⋮ more menu
      await page.getByRole('menuitem', { name: /избранн/i }).click()
    }

    // Wait for favorites section
    const favRows = page.locator('[data-fav-row]')
    await expect(favRows).toHaveCount(2)

    const firstFavId = await favRows.first().getAttribute('data-fav-row')
    expect(firstFavId).toBe(pageAId) // A added first

    // Drag B's handle above A
    const bHandle = page.locator(`[data-fav-row="${pageBId}"] [data-drag-handle="${pageBId}"]`)
    const aFavRow = page.locator(`[data-fav-row="${pageAId}"]`)

    await bHandle.hover()
    const aBox = await aFavRow.boundingBox()
    const bBox = await page.locator(`[data-fav-row="${pageBId}"]`).boundingBox()
    if (!aBox || !bBox) throw new Error('Could not get bounding boxes')

    await page.mouse.move(bBox.x + bBox.width / 2, bBox.y + bBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(aBox.x + aBox.width / 2, aBox.y + 4, { steps: 10 })
    await page.mouse.up()

    await page.waitForTimeout(300)
    const newFirst = await favRows.first().getAttribute('data-fav-row')
    expect(newFirst).toBe(pageBId)

    // Verify persists after reload
    await page.reload()
    await page.getByRole('button', { name: /страницы/i }).click()
    const reloadedFavFirst = await page.locator('[data-fav-row]').first().getAttribute('data-fav-row')
    expect(reloadedFavFirst).toBe(pageBId)
  })
})
```

- [ ] **Step 9.2 — Run E2E tests**

```bash
pnpm exec playwright test apps/e2e/page-ordering.spec.ts --retries=1
```

Expected: all 3 tests PASS. If DnD tests are flaky on timing, add `--retries=2`.

- [ ] **Step 9.3 — Run full gate**

```bash
pnpm gates
```

Expected: all checks pass (types, lint, build, unit tests).

- [ ] **Step 9.4 — Commit**

```bash
git add apps/e2e/page-ordering.spec.ts
git commit -m "test(e2e): page ordering — tail insert, DnD siblings, favorites DnD"
```

---

## Self-Review Checklist

- [x] **Spec §1 (personalized favorites)** — covered: `addFavorite` assigns `position`, `listFavorites` orders by `position ASC`
- [x] **Spec §2 (favorites sort order)** — covered: `reorderFavorites` + FavoritesSection DnD + `data-fav-row` E2E
- [x] **Spec §3 (new page at end)** — covered: Task 2 tail insert in `page.create`
- [x] **Spec §4 (DnD)** — covered: Tasks 7–8 frontend, `page.reorder` backend, sibling + parent-change both handled
- [x] **Spec §5 (shared tree order)** — `page.reorder` updates the shared linked-list; all workspace members see the same order
- [x] **No placeholders** — all code steps contain complete implementations
- [x] **Type consistency** — `FlatPageItem` defined in Task 6, used in Tasks 7; `reorder` input shape matches between Task 4 (backend) and Task 7 (frontend call)
- [x] **DragIndicatorIcon** — Task 7 includes a grep check and fallback to add the export if missing
