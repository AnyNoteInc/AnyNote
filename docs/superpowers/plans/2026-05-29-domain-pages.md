# `@repo/domain` SP3 — Pages write logic — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the write business-logic for the 10 mutating `page` procedures into `@repo/domain` (a new `pages/` module), then refactor both consumers — the `@repo/trpc` `page` router and the `apps/engines` page-writer service — to call the single domain implementation. This collapses duplicated/divergent logic into one source of truth and **fixes two latent engines gaps**: engines `createPage` inserts pages with no linked-list position, and engines `movePage` has no cycle-detection — routing both through the domain fixes them.

**Architecture:** Same pattern as SP1/SP2: domain functions are `fn(prisma, actorUserId, input) → result`, validate via exported `zod` schemas, access-check first, throw `DomainError`, own their `prisma.$transaction`. The outbox enqueue (`enqueueOutboxEvent` from `@repo/db`) is a pure in-transaction DB write, so the page domain functions **import and call it directly** inside their `$transaction` — **no Port needed** (the reminders-delivery complication does not recur here). `seedKanbanDefaults` **moves into the domain** (`domain/kanban/seed.ts`) because `domain.createPage` must call it for KANBAN pages and the domain cannot import `@repo/trpc`. tRPC and engines both delegate; tests mock Prisma.

**Tech Stack:** TypeScript NodeNext (`@repo/domain`), Prisma 7 (`@repo/db`), Zod, tRPC v11 (`@repo/trpc`), NestJS + `@rekog/mcp-nest` (engines), Vitest (domain/trpc) + Jest (engines).

**Spec:** [docs/superpowers/specs/2026-05-29-domain-pages-design.md](docs/superpowers/specs/2026-05-29-domain-pages-design.md)

**Conventions:**
- `@repo/domain` & consumers: relative imports use **explicit `.ts` extensions**, matching `@repo/db`. Prettier: no semicolons, single quotes, 100-width.
- Domain functions: never import `@repo/auth` / `@repo/ui` / `@repo/notifications` / `@trpc/server` / event buses. They take `prisma` + `actorUserId` + typed input, return data, throw `DomainError`. Deps stay `@repo/db` + `zod` only (the outbox helper + Prisma/enum types come from `@repo/db` — allowed).
- **Public domain fns use `actorUserId`** (not `userId`); internal helpers (`assertPageAccess`/`assertPageOwnership` in `domain/kanban/access.ts`) take `userId`.
- **Atomic multi-step ops use `tx.*` inside `prisma.$transaction(async (tx) => …)`**, never the outer `prisma` — the outbox enqueue is called with `tx`.
- **engines service specs MUST use real-domain + mocked-Prisma**, NEVER `jest.unstable_mockModule` (repo ts-jest ESM doesn't support it). Construct `new PageWriter(mockPrisma)`, run real `@repo/domain`, assert on mocked Prisma calls + the returned value.
- **`noUncheckedIndexedAccess: true`** is on — type test `__mocks` precisely (`typeof __mocks`) or use `!` on guaranteed-present lookups; tuple-destructure `mock.calls`.
- Commit per task; end body with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. No `--no-verify`.
- Domain tests: `pnpm --filter @repo/domain test`. tRPC: `pnpm --filter @repo/trpc test`. engines: `pnpm --filter engines test`.

**State note (read before starting):** Favorites already moved out of `page.ts` in SP2 — `addFavorite`/`removeFavorite`/`reorderFavorites`/`listFavorites` (lines ~746–799 of `page.ts`) are **untouched** by this plan. `page.ts` already imports `import * as domain from '@repo/domain'`, `import { mapDomain } from '../helpers/map-domain'`, and `import { seedKanbanDefaults } from './kanban/helpers'`. `domain/kanban/access.ts` already exports `assertPageAccess(prisma, userId, pageId)` and `assertPageOwnership(prisma, userId, pageId)` (SP1). `enqueueOutboxEvent(tx, { eventType, aggregateType, aggregateId, workspaceId?, payload? })` is exported from `@repo/db` (`aggregateType` is the union `'page' | 'file'`).

---

## Phase A — Cluster A foundation: scaffold, ordering helpers, seedKanbanDefaults move, Core CRUD

### Task 1: `domain/pages/schemas.ts` + `domain/pages/ordering.ts` (no logic-bearing tests yet)

**Files:**
- Create: `packages/domain/src/pages/schemas.ts`
- Create: `packages/domain/src/pages/ordering.ts`

`ordering.ts` holds the cycle-detection primitives ported verbatim from `page.ts` (the ancestor walk used by `move`, the BFS used by `reorder`). These are pure functions over a `TransactionClient`; they are exercised by the function tests in Tasks 4 and 5 (no standalone test file).

- [ ] **Step 1: Create `schemas.ts`**

`packages/domain/src/pages/schemas.ts`:
```ts
import { PageType } from '@repo/db'
import { z } from 'zod'

export const createPageInput = z.object({
  workspaceId: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  title: z.string().optional(),
  icon: z.string().optional(),
  type: z.nativeEnum(PageType).optional(),
})
export type CreatePageInput = z.infer<typeof createPageInput>

export const renamePageInput = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  title: z.string(),
  icon: z.string().nullable().optional(),
})
export type RenamePageInput = z.infer<typeof renamePageInput>

export const updatePageInput = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  title: z.string().optional(),
  icon: z.string().nullable().optional(),
  type: z.nativeEnum(PageType).optional(),
})
export type UpdatePageInput = z.infer<typeof updatePageInput>

export const duplicatePageInput = z.object({
  pageId: z.string().uuid(),
})
export type DuplicatePageInput = z.infer<typeof duplicatePageInput>

export const movePageInput = z.object({
  pageId: z.string().uuid(),
  newParentId: z.string().uuid().nullable(),
})
export type MovePageInput = z.infer<typeof movePageInput>

export const reorderPageInput = z.object({
  pageId: z.string().uuid(),
  newParentId: z.string().uuid().nullable(),
  newPrevPageId: z.string().uuid().nullable(),
})
export type ReorderPageInput = z.infer<typeof reorderPageInput>

export const softDeletePageInput = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
})
export type SoftDeletePageInput = z.infer<typeof softDeletePageInput>

export const restorePageInput = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
})
export type RestorePageInput = z.infer<typeof restorePageInput>

export const hardDeletePageInput = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
})
export type HardDeletePageInput = z.infer<typeof hardDeletePageInput>

export const emptyTrashInput = z.object({
  workspaceId: z.string().uuid(),
})
export type EmptyTrashInput = z.infer<typeof emptyTrashInput>
```

- [ ] **Step 2: Create `ordering.ts`**

These two helpers are the cycle-detection algorithms lifted verbatim from `page.ts` `move` (ancestor walk, lines 524–539) and `reorder` (BFS, lines 668–684). Both throw `badRequest` (the domain analog of the tRPC `BAD_REQUEST`), preserving the exact Russian messages.

`packages/domain/src/pages/ordering.ts`:
```ts
import type { Prisma } from '@repo/db'

import { badRequest } from '../errors.ts'

/**
 * `move` cycle-detection: walk up from `newParentId` through `parentId` links.
 * If we reach `pageId`, the move would nest a page inside its own descendant.
 * Ported verbatim from tRPC page.move (the ancestor walk).
 */
export async function assertNotMovingIntoOwnDescendant(
  tx: Prisma.TransactionClient,
  pageId: string,
  newParentId: string | null,
): Promise<void> {
  if (!newParentId) return
  let currentId: string | null = newParentId
  while (currentId) {
    if (currentId === pageId) {
      throw badRequest('Невозможно переместить страницу в собственного потомка')
    }
    const ancestor: { parentId: string | null } | null = await tx.page.findFirst({
      where: { id: currentId, deletedAt: null },
      select: { parentId: true },
    })
    currentId = ancestor?.parentId ?? null
  }
}

/**
 * `reorder` cycle-detection: BFS down the descendant tree of `pageId`.
 * If `newParentId` appears anywhere below `pageId`, reject the reorder.
 * Ported verbatim from tRPC page.reorder (the BFS).
 */
export async function assertNotReorderingIntoOwnDescendant(
  tx: Prisma.TransactionClient,
  pageId: string,
  newParentId: string | null,
): Promise<void> {
  if (newParentId === null) return
  let queue = [pageId]
  while (queue.length > 0) {
    const children = await tx.page.findMany({
      where: { parentId: { in: queue }, deletedAt: null },
      select: { id: true },
    })
    const childIds = children.map((c) => c.id)
    if (childIds.includes(newParentId)) {
      throw badRequest('Нельзя вложить страницу в собственного потомка')
    }
    queue = childIds
  }
}
```

- [ ] **Step 3: check-types**

Run: `pnpm --filter @repo/domain check-types`
Expected: clean (types + pure helpers, no barrel wiring yet — these files are not yet re-exported, so they compile standalone).

- [ ] **Step 4: Commit**

```bash
git add packages/domain/src/pages/schemas.ts packages/domain/src/pages/ordering.ts
git commit -m "$(cat <<'EOF'
feat(domain): add pages schemas + ordering cycle-detection helpers

ordering.ts ports the ancestor-walk (move) and BFS (reorder) cycle-detection verbatim from
the tRPC page router. Both throw DomainError badRequest with the original Russian messages.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Move `seedKanbanDefaults` into `domain/kanban/seed.ts` + re-export from tRPC kanban helpers

**Files:**
- Create: `packages/domain/src/kanban/seed.ts`
- Modify: `packages/domain/src/kanban/index.ts`
- Modify: `packages/trpc/src/routers/kanban/helpers.ts`
- Create: `packages/domain/test/kanban/seed.test.ts`

`seedKanbanDefaults` + `DEFAULT_PRIORITY_COLORS` currently live in `packages/trpc/src/routers/kanban/helpers.ts`. They are pure Prisma `createMany` writes seeding columns/types/priorities. The domain cannot import `@repo/trpc`, so they move into `@repo/domain`. The tRPC helpers file then re-exports the domain version so `page.create` (the only production caller — verified) keeps working unchanged.

- [ ] **Step 1: Write the failing test**

`packages/domain/test/kanban/seed.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Prisma } from '@repo/db'

import { seedKanbanDefaults } from '../../src/kanban/seed.ts'

describe('seedKanbanDefaults', () => {
  const columnCreateMany = vi.fn(async () => ({ count: 3 }))
  const typeCreateMany = vi.fn(async () => ({ count: 2 }))
  const priorityCreateMany = vi.fn(async () => ({ count: 4 }))
  const tx = {
    kanbanColumn: { createMany: columnCreateMany },
    kanbanType: { createMany: typeCreateMany },
    kanbanPriority: { createMany: priorityCreateMany },
  } as unknown as Prisma.TransactionClient

  beforeEach(() => vi.clearAllMocks())

  it('seeds 3 columns, 2 types, 4 priorities for the page', async () => {
    await seedKanbanDefaults(tx, 'page-1')
    expect(columnCreateMany).toHaveBeenCalledWith({
      data: [
        { pageId: 'page-1', title: 'Todo', kind: 'ACTIVE', position: 1024 },
        { pageId: 'page-1', title: 'In Progress', kind: 'ACTIVE', position: 2048 },
        { pageId: 'page-1', title: 'Done', kind: 'DONE', position: 3072 },
      ],
    })
    expect(typeCreateMany).toHaveBeenCalledWith({
      data: [
        { pageId: 'page-1', title: 'Задача', position: 1024 },
        { pageId: 'page-1', title: 'Баг', position: 2048 },
      ],
    })
    expect(priorityCreateMany).toHaveBeenCalledWith({
      data: [
        { pageId: 'page-1', title: 'Низкий', color: '#6B7280', position: 1024 },
        { pageId: 'page-1', title: 'Средний', color: '#3B82F6', position: 2048 },
        { pageId: 'page-1', title: 'Высокий', color: '#F97316', position: 3072 },
        { pageId: 'page-1', title: 'Критичный', color: '#EF4444', position: 4096 },
      ],
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/domain test -- seed`
Expected: FAIL — `domain/kanban/seed.ts` missing.

- [ ] **Step 3: Implement `seed.ts`** — ported verbatim from tRPC `kanban/helpers.ts`

`packages/domain/src/kanban/seed.ts`:
```ts
import type { Prisma } from '@repo/db'

const DEFAULT_PRIORITY_COLORS = {
  low: '#6B7280',
  medium: '#3B82F6',
  high: '#F97316',
  critical: '#EF4444',
} as const

type TxClient = Prisma.TransactionClient

export async function seedKanbanDefaults(tx: TxClient, pageId: string): Promise<void> {
  await tx.kanbanColumn.createMany({
    data: [
      { pageId, title: 'Todo', kind: 'ACTIVE', position: 1024 },
      { pageId, title: 'In Progress', kind: 'ACTIVE', position: 2048 },
      { pageId, title: 'Done', kind: 'DONE', position: 3072 },
    ],
  })
  await tx.kanbanType.createMany({
    data: [
      { pageId, title: 'Задача', position: 1024 },
      { pageId, title: 'Баг', position: 2048 },
    ],
  })
  await tx.kanbanPriority.createMany({
    data: [
      { pageId, title: 'Низкий', color: DEFAULT_PRIORITY_COLORS.low, position: 1024 },
      { pageId, title: 'Средний', color: DEFAULT_PRIORITY_COLORS.medium, position: 2048 },
      { pageId, title: 'Высокий', color: DEFAULT_PRIORITY_COLORS.high, position: 3072 },
      { pageId, title: 'Критичный', color: DEFAULT_PRIORITY_COLORS.critical, position: 4096 },
    ],
  })
}
```

- [ ] **Step 4: Re-export from the kanban barrel**

In `packages/domain/src/kanban/index.ts`, add the seed export.

Before (current content):
```ts
export * from './access.ts'
export * from './comments.ts'
export * from './helpers.ts'
export * from './schemas.ts'
export * from './sprints.ts'
export * from './tasks.ts'
```

After:
```ts
export * from './access.ts'
export * from './comments.ts'
export * from './helpers.ts'
export * from './schemas.ts'
export * from './seed.ts'
export * from './sprints.ts'
export * from './tasks.ts'
```

- [ ] **Step 5: Re-export from tRPC `kanban/helpers.ts` (delete local definition)**

`packages/trpc/src/routers/kanban/helpers.ts` currently defines `seedKanbanDefaults` + `DEFAULT_PRIORITY_COLORS` locally. Replace the whole file so it re-exports the domain version. Any other tRPC caller still resolves `seedKanbanDefaults` from this module.

Before (full current content):
```ts
import type { Prisma } from '@repo/db'
export { POSITION_GAP, dateInput, endPosition, positionBetween, recordActivity } from '@repo/domain'

const DEFAULT_PRIORITY_COLORS = {
  low: '#6B7280',
  medium: '#3B82F6',
  high: '#F97316',
  critical: '#EF4444',
} as const

type TxClient = Prisma.TransactionClient

export async function seedKanbanDefaults(tx: TxClient, pageId: string): Promise<void> {
  await tx.kanbanColumn.createMany({
    data: [
      { pageId, title: 'Todo', kind: 'ACTIVE', position: 1024 },
      { pageId, title: 'In Progress', kind: 'ACTIVE', position: 2048 },
      { pageId, title: 'Done', kind: 'DONE', position: 3072 },
    ],
  })
  await tx.kanbanType.createMany({
    data: [
      { pageId, title: 'Задача', position: 1024 },
      { pageId, title: 'Баг', position: 2048 },
    ],
  })
  await tx.kanbanPriority.createMany({
    data: [
      { pageId, title: 'Низкий', color: DEFAULT_PRIORITY_COLORS.low, position: 1024 },
      { pageId, title: 'Средний', color: DEFAULT_PRIORITY_COLORS.medium, position: 2048 },
      { pageId, title: 'Высокий', color: DEFAULT_PRIORITY_COLORS.high, position: 3072 },
      { pageId, title: 'Критичный', color: DEFAULT_PRIORITY_COLORS.critical, position: 4096 },
    ],
  })
}
```

After (full new content):
```ts
export {
  POSITION_GAP,
  dateInput,
  endPosition,
  positionBetween,
  recordActivity,
  seedKanbanDefaults,
} from '@repo/domain'
```

- [ ] **Step 6: Run domain tests + check-types on both packages**

Run: `pnpm --filter @repo/domain test -- seed && pnpm --filter @repo/domain check-types && pnpm --filter @repo/domain build && pnpm --filter @repo/trpc check-types`
Expected: PASS, clean. (The domain must be **built** before `@repo/trpc check-types` resolves the new `seedKanbanDefaults` re-export — run the build step here so the dist exists locally.)

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/kanban/seed.ts packages/domain/src/kanban/index.ts \
        packages/domain/test/kanban/seed.test.ts packages/trpc/src/routers/kanban/helpers.ts
git commit -m "$(cat <<'EOF'
refactor(domain): move seedKanbanDefaults into @repo/domain (kanban/seed.ts)

domain.createPage will call seedKanbanDefaults for KANBAN pages and cannot import @repo/trpc,
so it moves into the domain. tRPC kanban/helpers re-exports it so page.create (the only caller)
is unchanged. DEFAULT_PRIORITY_COLORS + the createMany payloads are ported verbatim.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `domain/pages/functions.ts` — `createPage` + tests

**Files:**
- Create: `packages/domain/src/pages/functions.ts`
- Create: `packages/domain/test/pages/functions.test.ts`

`domain.createPage` is the union of the tRPC `page.create` linked-list-tail insert (the source of truth) **plus** the optional `ownership`/`content`/`contentYjs` fields the engines `PageWriter.createPage` needs. The tRPC caller passes the `{ workspaceId, parentId, title, icon, type }` subset; engines passes `{ ownership, content, contentYjs }` too. The function:
1. validates parent (exists, same workspace, not deleted),
2. creates the page,
3. inserts at the **tail** of the sibling linked-list (the gap-fix for engines),
4. enqueues `page.upserted`,
5. seeds kanban defaults when `type === KANBAN`,
6. returns `{ id }`.

This task implements only `createPage`; later tasks append the other functions to the same file.

- [ ] **Step 1: Write the failing test**

`packages/domain/test/pages/functions.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { PrismaClient } from '@repo/db'

import { DomainError } from '../../src/errors.ts'
import { createPage } from '../../src/pages/functions.ts'

type TxMocks = {
  pageCreate: ReturnType<typeof vi.fn>
  pageFindMany: ReturnType<typeof vi.fn>
  pageUpdate: ReturnType<typeof vi.fn>
  outboxCreate: ReturnType<typeof vi.fn>
  kanbanColumnCreateMany: ReturnType<typeof vi.fn>
  kanbanTypeCreateMany: ReturnType<typeof vi.fn>
  kanbanPriorityCreateMany: ReturnType<typeof vi.fn>
}

function makePrisma(opts: { parent?: unknown } = {}) {
  const pageCreate = vi.fn(async () => ({ id: 'new-1', type: 'TEXT' }))
  const pageFindMany = vi.fn(async () => [] as { id: string; prevPageId: string | null }[])
  const pageUpdate = vi.fn(async () => ({}))
  const outboxCreate = vi.fn(async () => ({}))
  const kanbanColumnCreateMany = vi.fn(async () => ({ count: 3 }))
  const kanbanTypeCreateMany = vi.fn(async () => ({ count: 2 }))
  const kanbanPriorityCreateMany = vi.fn(async () => ({ count: 4 }))
  // outer prisma.page.findFirst is the parent lookup
  const pageFindFirst = vi.fn(async () => (opts.parent === undefined ? { id: 'parent-1' } : opts.parent))
  const tx = {
    page: { create: pageCreate, findMany: pageFindMany, update: pageUpdate },
    outboxEvent: { create: outboxCreate },
    kanbanColumn: { createMany: kanbanColumnCreateMany },
    kanbanType: { createMany: kanbanTypeCreateMany },
    kanbanPriority: { createMany: kanbanPriorityCreateMany },
  }
  const $transaction = vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx))
  const mocks: TxMocks = {
    pageCreate,
    pageFindMany,
    pageUpdate,
    outboxCreate,
    kanbanColumnCreateMany,
    kanbanTypeCreateMany,
    kanbanPriorityCreateMany,
  }
  return {
    page: { findFirst: pageFindFirst },
    $transaction,
    __mocks: { ...mocks, pageFindFirst, $transaction },
  } as unknown as PrismaClient & { __mocks: TxMocks & { pageFindFirst: ReturnType<typeof vi.fn>; $transaction: ReturnType<typeof vi.fn> } }
}

describe('domain createPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a page and enqueues page.upserted', async () => {
    const prisma = makePrisma()
    const result = await createPage(prisma, 'u1', {
      workspaceId: 'w1',
      parentId: null,
      title: 'Hello',
    })
    expect(result).toEqual({ id: 'new-1' })
    expect(prisma.__mocks.pageCreate).toHaveBeenCalledOnce()
    expect(prisma.__mocks.outboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'page.upserted',
          aggregateType: 'page',
          aggregateId: 'new-1',
          workspaceId: 'w1',
        }),
      }),
    )
  })

  it('links the new page to the tail sibling (the one no sibling points at)', async () => {
    const prisma = makePrisma()
    // siblings: s1 is head (prevPageId null), s2 follows s1 → tail is s2
    prisma.__mocks.pageFindMany.mockResolvedValue([
      { id: 's1', prevPageId: null },
      { id: 's2', prevPageId: 's1' },
    ])
    await createPage(prisma, 'u1', { workspaceId: 'w1', parentId: null, title: 'T' })
    expect(prisma.__mocks.pageUpdate).toHaveBeenCalledWith({
      where: { id: 'new-1' },
      data: { prevPageId: 's2' },
    })
  })

  it('does not link when there are no siblings (page is the head)', async () => {
    const prisma = makePrisma()
    prisma.__mocks.pageFindMany.mockResolvedValue([])
    await createPage(prisma, 'u1', { workspaceId: 'w1', parentId: null, title: 'T' })
    expect(prisma.__mocks.pageUpdate).not.toHaveBeenCalled()
  })

  it('seeds kanban defaults when type is KANBAN', async () => {
    const prisma = makePrisma()
    prisma.__mocks.pageCreate.mockResolvedValue({ id: 'kb-1', type: 'KANBAN' })
    await createPage(prisma, 'u1', { workspaceId: 'w1', parentId: null, title: 'Board', type: 'KANBAN' })
    expect(prisma.__mocks.kanbanColumnCreateMany).toHaveBeenCalledOnce()
    expect(prisma.__mocks.kanbanTypeCreateMany).toHaveBeenCalledOnce()
    expect(prisma.__mocks.kanbanPriorityCreateMany).toHaveBeenCalledOnce()
  })

  it('does not seed kanban defaults for a TEXT page', async () => {
    const prisma = makePrisma()
    await createPage(prisma, 'u1', { workspaceId: 'w1', parentId: null, title: 'T', type: 'TEXT' })
    expect(prisma.__mocks.kanbanColumnCreateMany).not.toHaveBeenCalled()
  })

  it('throws NOT_FOUND when parentId is given but the parent is missing', async () => {
    const prisma = makePrisma({ parent: null })
    await expect(
      createPage(prisma, 'u1', { workspaceId: 'w1', parentId: 'missing', title: 'T' }),
    ).rejects.toBeInstanceOf(DomainError)
    expect(prisma.__mocks.pageCreate).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/domain test -- pages`
Expected: FAIL — `pages/functions.ts` missing.

- [ ] **Step 3: Implement `functions.ts` with `createPage`**

`domain.createPage` ports the tRPC `page.create` body verbatim (the parent check, the create, the tail-insert sibling walk, the outbox enqueue, the kanban seed) with the mechanical transforms (`ctx.prisma`→`prisma`/`tx`, `ctx.user.id`→`actorUserId`, `TRPCError`→`DomainError`, `enqueueOutboxEvent` called with `tx`). The extra optional `ownership`/`content`/`contentYjs` fields are forwarded to `tx.page.create` only when present, so the engines content/ownership pipeline is preserved.

`packages/domain/src/pages/functions.ts`:
```ts
import { PageType, enqueueOutboxEvent } from '@repo/db'
import type { Prisma, PrismaClient } from '@repo/db'

import { notFound } from '../errors.ts'
import { assertPageAccess, assertPageOwnership } from '../kanban/access.ts'
import { seedKanbanDefaults } from '../kanban/seed.ts'
import {
  assertNotMovingIntoOwnDescendant,
  assertNotReorderingIntoOwnDescendant,
} from './ordering.ts'
import type {
  CreatePageInput,
  DuplicatePageInput,
  EmptyTrashInput,
  HardDeletePageInput,
  MovePageInput,
  RenamePageInput,
  ReorderPageInput,
  RestorePageInput,
  SoftDeletePageInput,
  UpdatePageInput,
} from './schemas.ts'

/**
 * Engines passes ownership/content/contentYjs; tRPC passes only the schema subset.
 * createPage accepts the superset so both consumers share one positioning + outbox path.
 */
export type CreatePageExtra = {
  ownership?: 'TEXT' | 'SKILL' | 'AGENT'
  content?: Prisma.InputJsonValue
  contentYjs?: Uint8Array
}

export async function createPage(
  prisma: PrismaClient,
  actorUserId: string,
  input: CreatePageInput & CreatePageExtra,
): Promise<{ id: string }> {
  // If parent is a page, verify it exists and belongs to the same workspace.
  if (input.parentId) {
    const parentPage = await prisma.page.findFirst({
      where: { id: input.parentId, workspaceId: input.workspaceId, deletedAt: null },
    })
    if (!parentPage) {
      throw notFound('Родительская страница не найдена')
    }
  }

  return prisma.$transaction(async (tx) => {
    const newPage = await tx.page.create({
      data: {
        workspaceId: input.workspaceId,
        parentId: input.parentId,
        title: input.title ?? null,
        icon: input.icon ?? null,
        type: input.type ?? PageType.TEXT,
        ...(input.ownership ? { ownership: input.ownership } : {}),
        ...(input.content === undefined ? {} : { content: input.content }),
        ...(input.contentYjs === undefined ? {} : { contentYjs: input.contentYjs }),
        prevPageId: null,
        createdById: actorUserId,
        updatedById: actorUserId,
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
}
```

(The imports for `assertPageAccess`/`assertPageOwnership`/the ordering helpers/the other input types are added now even though `createPage` doesn't use all of them yet — Tasks 4–7 fill in the remaining functions in this same file. `void` them if check-types complains about unused; but since later steps append usages, prefer to keep them and tolerate a transient unused-import only between Step 3 and Task 4. To stay lint-clean on the per-task commit, trim the imports in this commit to only what `createPage` uses, then re-add in Task 4. The exact import block to use **for this commit** is:)

```ts
import { PageType, enqueueOutboxEvent } from '@repo/db'
import type { Prisma, PrismaClient } from '@repo/db'

import { notFound } from '../errors.ts'
import { seedKanbanDefaults } from '../kanban/seed.ts'
import type { CreatePageInput } from './schemas.ts'
```

- [ ] **Step 4: Run tests + check-types**

Run: `pnpm --filter @repo/domain test -- pages && pnpm --filter @repo/domain check-types`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/pages/functions.ts packages/domain/test/pages/functions.test.ts
git commit -m "$(cat <<'EOF'
feat(domain): add pages.createPage (tail-insert + outbox + kanban seed)

Ports tRPC page.create verbatim and accepts the engines ownership/content/contentYjs superset,
unifying list-positioning (the engines gap-fix) and the page.upserted outbox enqueue.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `renamePage` + `updatePage` + tests

**Files:**
- Modify: `packages/domain/src/pages/functions.ts`
- Modify: `packages/domain/test/pages/functions.test.ts`

Both port their tRPC counterparts verbatim. The tRPC procedures call `assertPageOwnership` in the procedure body **before** the transaction; the spec keeps `requireWritableWorkspace`/`assertWorkspaceMember` as caller pre-checks, but **`assertPageOwnership` moves into the domain function** (it is page-access business logic, and `domain/kanban/access.ts` already provides `assertPageOwnership(prisma, userId, pageId)`). The tRPC wrapper will therefore drop its own `assertPageOwnership` call for these two (the domain does it) but keep `requireWritableWorkspace`. Returns `{ id, title, icon, updatedAt }`.

- [ ] **Step 1: Add the failing tests**

Append these cases inside the existing `describe('domain createPage', …)` file — add a new top-level `describe` block at the end of `packages/domain/test/pages/functions.test.ts`:
```ts
import { renamePage, updatePage } from '../../src/pages/functions.ts'

function makeRenamePrisma(page: unknown = { id: 'p1', workspaceId: 'w1', createdById: 'u1' }) {
  const pageUpdate = vi.fn(async () => ({ id: 'p1', title: 'New', icon: null, updatedAt: new Date() }))
  const outboxCreate = vi.fn(async () => ({}))
  const pageFindFirst = vi.fn(async () => page)
  const memberFindUnique = vi.fn(async () => ({ role: 'OWNER' as const }))
  const tx = { page: { update: pageUpdate }, outboxEvent: { create: outboxCreate } }
  const $transaction = vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx))
  return {
    page: { findFirst: pageFindFirst },
    workspaceMember: { findUnique: memberFindUnique },
    $transaction,
    __mocks: { pageUpdate, outboxCreate, pageFindFirst, memberFindUnique, $transaction },
  } as unknown as PrismaClient & {
    __mocks: {
      pageUpdate: ReturnType<typeof vi.fn>
      outboxCreate: ReturnType<typeof vi.fn>
      pageFindFirst: ReturnType<typeof vi.fn>
      memberFindUnique: ReturnType<typeof vi.fn>
      $transaction: ReturnType<typeof vi.fn>
    }
  }
}

describe('domain renamePage / updatePage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renamePage updates title + updatedById and enqueues page.upserted', async () => {
    const prisma = makeRenamePrisma()
    const result = await renamePage(prisma, 'u1', { id: 'p1', workspaceId: 'w1', title: 'New' })
    expect(result).toEqual(expect.objectContaining({ id: 'p1' }))
    const [, args] = prisma.__mocks.pageUpdate.mock.calls[0] ?? []
    void args
    expect(prisma.__mocks.pageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({ title: 'New', updatedById: 'u1' }),
      }),
    )
    expect(prisma.__mocks.outboxCreate).toHaveBeenCalledOnce()
  })

  it('renamePage sets icon only when provided', async () => {
    const prisma = makeRenamePrisma()
    await renamePage(prisma, 'u1', { id: 'p1', workspaceId: 'w1', title: 'New', icon: null })
    const call = prisma.__mocks.pageUpdate.mock.calls[0]?.[0] as { data: Record<string, unknown> }
    expect(call.data).toHaveProperty('icon', null)
  })

  it('renamePage throws FORBIDDEN when actor is neither creator nor OWNER', async () => {
    const prisma = makeRenamePrisma({ id: 'p1', workspaceId: 'w1', createdById: 'someone-else' })
    prisma.__mocks.memberFindUnique.mockResolvedValue({ role: 'EDITOR' })
    await expect(
      renamePage(prisma, 'u1', { id: 'p1', workspaceId: 'w1', title: 'New' }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('updatePage sets title/icon/type only when provided', async () => {
    const prisma = makeRenamePrisma()
    await updatePage(prisma, 'u1', { id: 'p1', workspaceId: 'w1', type: 'KANBAN' })
    const call = prisma.__mocks.pageUpdate.mock.calls[0]?.[0] as { data: Record<string, unknown> }
    expect(call.data).toMatchObject({ type: 'KANBAN', updatedById: 'u1' })
    expect(call.data).not.toHaveProperty('title')
    expect(prisma.__mocks.outboxCreate).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/domain test -- pages`
Expected: FAIL — `renamePage`/`updatePage` missing.

- [ ] **Step 3: Update the import block + append the two functions**

First, replace the trimmed import block (added in Task 3 Step 3) with the fuller block. Before:
```ts
import { PageType, enqueueOutboxEvent } from '@repo/db'
import type { Prisma, PrismaClient } from '@repo/db'

import { notFound } from '../errors.ts'
import { seedKanbanDefaults } from '../kanban/seed.ts'
import type { CreatePageInput } from './schemas.ts'
```

After:
```ts
import { PageType, enqueueOutboxEvent } from '@repo/db'
import type { Prisma, PrismaClient } from '@repo/db'

import { notFound } from '../errors.ts'
import { assertPageOwnership } from '../kanban/access.ts'
import { seedKanbanDefaults } from '../kanban/seed.ts'
import type {
  CreatePageInput,
  RenamePageInput,
  UpdatePageInput,
} from './schemas.ts'
```

Then append after `createPage`:
```ts
export async function renamePage(
  prisma: PrismaClient,
  actorUserId: string,
  input: RenamePageInput,
): Promise<{ id: string; title: string | null; icon: string | null; updatedAt: Date }> {
  await assertPageOwnership(prisma, actorUserId, input.id)
  const data: { title: string; icon?: string | null; updatedById: string } = {
    title: input.title,
    updatedById: actorUserId,
  }
  if (input.icon !== undefined) data.icon = input.icon
  return prisma.$transaction(async (tx) => {
    const updated = await tx.page.update({
      where: { id: input.id },
      data,
      select: { id: true, title: true, icon: true, updatedAt: true },
    })
    await enqueueOutboxEvent(tx, {
      eventType: 'page.upserted',
      aggregateType: 'page',
      aggregateId: updated.id,
      workspaceId: input.workspaceId,
    })
    return updated
  })
}

export async function updatePage(
  prisma: PrismaClient,
  actorUserId: string,
  input: UpdatePageInput,
): Promise<{ id: string; title: string | null; icon: string | null; updatedAt: Date }> {
  await assertPageOwnership(prisma, actorUserId, input.id)
  const data: {
    title?: string
    icon?: string | null
    type?: PageType
    updatedById: string
  } = { updatedById: actorUserId }
  if (input.title !== undefined) data.title = input.title
  if (input.icon !== undefined) data.icon = input.icon
  if (input.type !== undefined) data.type = input.type
  return prisma.$transaction(async (tx) => {
    const updated = await tx.page.update({
      where: { id: input.id },
      data,
      select: { id: true, title: true, icon: true, updatedAt: true },
    })
    await enqueueOutboxEvent(tx, {
      eventType: 'page.upserted',
      aggregateType: 'page',
      aggregateId: updated.id,
      workspaceId: input.workspaceId,
    })
    return updated
  })
}
```

- [ ] **Step 4: Run tests + check-types**

Run: `pnpm --filter @repo/domain test -- pages && pnpm --filter @repo/domain check-types`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/pages/functions.ts packages/domain/test/pages/functions.test.ts
git commit -m "$(cat <<'EOF'
feat(domain): add pages.renamePage + pages.updatePage

Both call assertPageOwnership then update + enqueue page.upserted. Ported verbatim from the
tRPC page.rename/page.update mutations; ownership check moves into the domain.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `duplicatePage` + tests

**Files:**
- Modify: `packages/domain/src/pages/functions.ts`
- Modify: `packages/domain/test/pages/functions.test.ts`

Ports tRPC `page.duplicate` verbatim: `assertPageAccess` (the tRPC procedure calls `assertPageAccess` then `requireWritableWorkspace`; the access check moves into the domain), detach old next sibling, create the copy (`(копия)` title, copy `content` + `contentYjs` bytes, `prevPageId: page.id`), reattach old next to the copy, enqueue `page.upserted`. Returns `{ id }`.

- [ ] **Step 1: Add the failing test**

Append a new `describe` block to `packages/domain/test/pages/functions.test.ts`:
```ts
import { duplicatePage } from '../../src/pages/functions.ts'

function makeDuplicatePrisma(original: Record<string, unknown>) {
  const copyCreate = vi.fn(async () => ({ id: 'copy-1' }))
  const pageUpdate = vi.fn(async () => ({}))
  const outboxCreate = vi.fn(async () => ({}))
  const txFindFirst = vi.fn(async () => null) // old next sibling lookup (none by default)
  // outer page.findFirst is assertPageAccess
  const accessFindFirst = vi.fn(async () => original)
  const tx = {
    page: { findFirst: txFindFirst, create: copyCreate, update: pageUpdate },
    outboxEvent: { create: outboxCreate },
  }
  const $transaction = vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx))
  return {
    page: { findFirst: accessFindFirst },
    $transaction,
    __mocks: { copyCreate, pageUpdate, outboxCreate, txFindFirst, accessFindFirst, $transaction },
  } as unknown as PrismaClient & {
    __mocks: {
      copyCreate: ReturnType<typeof vi.fn>
      pageUpdate: ReturnType<typeof vi.fn>
      outboxCreate: ReturnType<typeof vi.fn>
      txFindFirst: ReturnType<typeof vi.fn>
      accessFindFirst: ReturnType<typeof vi.fn>
      $transaction: ReturnType<typeof vi.fn>
    }
  }
}

describe('domain duplicatePage', () => {
  beforeEach(() => vi.clearAllMocks())

  const original = {
    id: 'p1',
    workspaceId: 'w1',
    parentId: null,
    type: 'TEXT',
    title: 'Doc',
    icon: null,
    content: { type: 'doc' },
    contentYjs: new Uint8Array([1, 2, 3]),
    createdById: 'u1',
  }

  it('creates a copy after the original with "(копия)" suffix and copied content', async () => {
    const prisma = makeDuplicatePrisma(original)
    const result = await duplicatePage(prisma, 'u1', { pageId: 'p1' })
    expect(result).toEqual({ id: 'copy-1' })
    const call = prisma.__mocks.copyCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> }
    expect(call.data).toMatchObject({
      workspaceId: 'w1',
      parentId: null,
      type: 'TEXT',
      title: 'Doc (копия)',
      prevPageId: 'p1',
      createdById: 'u1',
      updatedById: 'u1',
    })
    expect(prisma.__mocks.outboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'page.upserted', aggregateId: 'copy-1' }),
      }),
    )
  })

  it('relinks the old next sibling to point at the copy', async () => {
    const prisma = makeDuplicatePrisma(original)
    prisma.__mocks.txFindFirst.mockResolvedValue({ id: 'next-1' })
    await duplicatePage(prisma, 'u1', { pageId: 'p1' })
    // detach old next to null, then reattach to copy
    expect(prisma.__mocks.pageUpdate).toHaveBeenCalledWith({
      where: { id: 'next-1' },
      data: { prevPageId: null },
    })
    expect(prisma.__mocks.pageUpdate).toHaveBeenCalledWith({
      where: { id: 'next-1' },
      data: { prevPageId: 'copy-1' },
    })
  })

  it('throws NOT_FOUND when the source page is inaccessible', async () => {
    const prisma = makeDuplicatePrisma(original)
    prisma.__mocks.accessFindFirst.mockResolvedValue(null)
    await expect(duplicatePage(prisma, 'u1', { pageId: 'p1' })).rejects.toBeInstanceOf(DomainError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/domain test -- pages`
Expected: FAIL — `duplicatePage` missing.

- [ ] **Step 3: Update import block + append `duplicatePage`**

Update the import block to add `assertPageAccess` and `DuplicatePageInput`. Before:
```ts
import { notFound } from '../errors.ts'
import { assertPageOwnership } from '../kanban/access.ts'
import { seedKanbanDefaults } from '../kanban/seed.ts'
import type {
  CreatePageInput,
  RenamePageInput,
  UpdatePageInput,
} from './schemas.ts'
```

After:
```ts
import { notFound } from '../errors.ts'
import { assertPageAccess, assertPageOwnership } from '../kanban/access.ts'
import { seedKanbanDefaults } from '../kanban/seed.ts'
import type {
  CreatePageInput,
  DuplicatePageInput,
  RenamePageInput,
  UpdatePageInput,
} from './schemas.ts'
```

Append after `updatePage`:
```ts
export async function duplicatePage(
  prisma: PrismaClient,
  actorUserId: string,
  input: DuplicatePageInput,
): Promise<{ id: string }> {
  const page = await assertPageAccess(prisma, actorUserId, input.pageId)

  return prisma.$transaction(async (tx) => {
    // 1. Detach old next sibling first (prevPageId is unique)
    const oldNext = await tx.page.findFirst({
      where: { prevPageId: page.id, deletedAt: null },
    })
    if (oldNext) {
      await tx.page.update({
        where: { id: oldNext.id },
        data: { prevPageId: null },
      })
    }

    // 2. Create copy with same parent, inserted after original. Copy both
    // the JSON snapshot AND the authoritative contentYjs bytes — the editor
    // loads from contentYjs, so without it the duplicate renders empty.
    const copy = await tx.page.create({
      data: {
        workspaceId: page.workspaceId,
        parentId: page.parentId,
        type: page.type,
        title: `${page.title ?? ''} (копия)`.trim(),
        icon: page.icon,
        content: page.content ?? undefined,
        contentYjs: page.contentYjs ?? undefined,
        prevPageId: page.id,
        createdById: actorUserId,
        updatedById: actorUserId,
      },
    })

    // 3. Reattach old next sibling to point to copy
    if (oldNext) {
      await tx.page.update({
        where: { id: oldNext.id },
        data: { prevPageId: copy.id },
      })
    }

    await enqueueOutboxEvent(tx, {
      eventType: 'page.upserted',
      aggregateType: 'page',
      aggregateId: copy.id,
      workspaceId: page.workspaceId,
    })

    return { id: copy.id }
  })
}
```

Note: `assertPageAccess` returns the page from `prisma.page.findFirst` with a `*` selection (no `select` clause), so `page.content`/`page.contentYjs`/`page.parentId`/`page.title`/`page.icon`/`page.type` are all present, matching the tRPC original which also reads them off the `assertPageAccess` result.

- [ ] **Step 4: Run tests + check-types**

Run: `pnpm --filter @repo/domain test -- pages && pnpm --filter @repo/domain check-types`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/pages/functions.ts packages/domain/test/pages/functions.test.ts
git commit -m "$(cat <<'EOF'
feat(domain): add pages.duplicatePage (copy content+contentYjs, relink, outbox)

Ported verbatim from tRPC page.duplicate: detach old next, create "(копия)" after original
with copied content/contentYjs bytes, reattach old next to the copy, enqueue page.upserted.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase B — Cluster B: movePage + reorderPage (cycle-detection)

### Task 6: `movePage` + tests

**Files:**
- Modify: `packages/domain/src/pages/functions.ts`
- Modify: `packages/domain/test/pages/functions.test.ts`

Ports tRPC `page.move` verbatim. The tRPC procedure runs `assertPageAccess` → `assertPageOwnership` → `requireWritableWorkspace` before the transaction; `assertPageAccess` + `assertPageOwnership` move into the domain (`requireWritableWorkspace` stays a tRPC caller pre-check). Inside the transaction: detach old next sibling, **ancestor-walk cycle-detection** (`assertNotMovingIntoOwnDescendant` from `ordering.ts`), set new `parentId` (insert at head), reattach old next, insert at head of new parent's list, enqueue `page.upserted`. Returns `{ id }`.

- [ ] **Step 1: Add the failing test**

Append a new `describe` block:
```ts
import { movePage } from '../../src/pages/functions.ts'

function makeMovePrisma(page: Record<string, unknown>) {
  const accessFindFirst = vi.fn(async () => page)
  const memberFindUnique = vi.fn(async () => ({ role: 'OWNER' as const }))
  // tx.page.findFirst is used for: next sibling, ancestor walk, existingFirst
  const txFindFirst = vi.fn(async () => null)
  const pageUpdate = vi.fn(async () => ({}))
  const outboxCreate = vi.fn(async () => ({}))
  const tx = {
    page: { findFirst: txFindFirst, update: pageUpdate },
    outboxEvent: { create: outboxCreate },
  }
  const $transaction = vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx))
  return {
    page: { findFirst: accessFindFirst },
    workspaceMember: { findUnique: memberFindUnique },
    $transaction,
    __mocks: { accessFindFirst, memberFindUnique, txFindFirst, pageUpdate, outboxCreate, $transaction },
  } as unknown as PrismaClient & {
    __mocks: {
      accessFindFirst: ReturnType<typeof vi.fn>
      memberFindUnique: ReturnType<typeof vi.fn>
      txFindFirst: ReturnType<typeof vi.fn>
      pageUpdate: ReturnType<typeof vi.fn>
      outboxCreate: ReturnType<typeof vi.fn>
      $transaction: ReturnType<typeof vi.fn>
    }
  }
}

describe('domain movePage', () => {
  beforeEach(() => vi.clearAllMocks())

  const page = { id: 'p1', workspaceId: 'w1', parentId: null, prevPageId: null, createdById: 'u1' }

  it('moves to a new parent and enqueues page.upserted', async () => {
    const prisma = makeMovePrisma(page)
    const result = await movePage(prisma, 'u1', { pageId: 'p1', newParentId: 'parent-2' })
    expect(result).toEqual({ id: 'p1' })
    expect(prisma.__mocks.pageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({ parentId: 'parent-2', prevPageId: null, updatedById: 'u1' }),
      }),
    )
    expect(prisma.__mocks.outboxCreate).toHaveBeenCalledOnce()
  })

  it('throws BAD_REQUEST when moving into own descendant (ancestor walk hits pageId)', async () => {
    const prisma = makeMovePrisma(page)
    // ancestor walk: newParentId 'child-of-p1' → its parent is 'p1' → cycle
    prisma.__mocks.txFindFirst.mockImplementation(async (arg: { where?: { id?: string } }) => {
      if (arg?.where?.id === 'child-of-p1') return { parentId: 'p1' }
      return null
    })
    await expect(
      movePage(prisma, 'u1', { pageId: 'p1', newParentId: 'child-of-p1' }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('throws FORBIDDEN when actor lacks ownership', async () => {
    const prisma = makeMovePrisma({ ...page, createdById: 'other' })
    prisma.__mocks.memberFindUnique.mockResolvedValue({ role: 'EDITOR' })
    await expect(
      movePage(prisma, 'u1', { pageId: 'p1', newParentId: null }),
    ).rejects.toBeInstanceOf(DomainError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/domain test -- pages`
Expected: FAIL — `movePage` missing.

- [ ] **Step 3: Update import block + append `movePage`**

Update the import block to add the ordering helper + `MovePageInput`. Before:
```ts
import { assertPageAccess, assertPageOwnership } from '../kanban/access.ts'
import { seedKanbanDefaults } from '../kanban/seed.ts'
import type {
  CreatePageInput,
  DuplicatePageInput,
  RenamePageInput,
  UpdatePageInput,
} from './schemas.ts'
```

After:
```ts
import { assertPageAccess, assertPageOwnership } from '../kanban/access.ts'
import { seedKanbanDefaults } from '../kanban/seed.ts'
import { assertNotMovingIntoOwnDescendant } from './ordering.ts'
import type {
  CreatePageInput,
  DuplicatePageInput,
  MovePageInput,
  RenamePageInput,
  UpdatePageInput,
} from './schemas.ts'
```

Append after `duplicatePage`:
```ts
export async function movePage(
  prisma: PrismaClient,
  actorUserId: string,
  input: MovePageInput,
): Promise<{ id: string }> {
  const page = await assertPageAccess(prisma, actorUserId, input.pageId)
  // Ownership: must be creator or workspace OWNER.
  await assertPageOwnership(prisma, actorUserId, input.pageId)

  return prisma.$transaction(async (tx) => {
    // 1. Remove from old linked-list (detach first to avoid unique constraint)
    const nextSibling = await tx.page.findFirst({
      where: { prevPageId: page.id, deletedAt: null },
    })
    if (nextSibling) {
      await tx.page.update({
        where: { id: nextSibling.id },
        data: { prevPageId: null },
      })
    }

    // 2. Prevent moving into own descendant
    await assertNotMovingIntoOwnDescendant(tx, input.pageId, input.newParentId)

    // 3. Set new parentId
    await tx.page.update({
      where: { id: page.id },
      data: {
        parentId: input.newParentId,
        prevPageId: null,
        updatedById: actorUserId,
      },
    })

    // Reattach next sibling to previous in old list
    if (nextSibling) {
      await tx.page.update({
        where: { id: nextSibling.id },
        data: { prevPageId: page.prevPageId },
      })
    }

    // 4. Insert at head of new parent's linked-list
    const existingFirst = await tx.page.findFirst({
      where: {
        workspaceId: page.workspaceId,
        parentId: input.newParentId,
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

    await enqueueOutboxEvent(tx, {
      eventType: 'page.upserted',
      aggregateType: 'page',
      aggregateId: page.id,
      workspaceId: page.workspaceId,
    })

    return { id: page.id }
  })
}
```

- [ ] **Step 4: Run tests + check-types**

Run: `pnpm --filter @repo/domain test -- pages && pnpm --filter @repo/domain check-types`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/pages/functions.ts packages/domain/test/pages/functions.test.ts
git commit -m "$(cat <<'EOF'
feat(domain): add pages.movePage (reparent + ancestor-walk cycle-detection)

Ported verbatim from tRPC page.move. Detach old list, reject moving into own descendant via
assertNotMovingIntoOwnDescendant, insert at head of new parent, enqueue page.upserted.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `reorderPage` (BFS cycle-detection) + tests

**Files:**
- Modify: `packages/domain/src/pages/functions.ts`
- Modify: `packages/domain/test/pages/functions.test.ts`

Ports tRPC `page.reorder` verbatim. The tRPC procedure does the self-reference guard, loads the page (`findFirst deletedAt: null`), `assertWorkspaceMember`, `requireWritableWorkspace`, the no-op short-circuit, the BFS cycle-check, then the 3-step relink transaction. The access/membership business logic moves into the domain (`requireWritableWorkspace` stays a caller pre-check; `assertWorkspaceMember` becomes a domain `assertPageAccess`-equivalent — but tRPC `reorder` only checks **membership**, not ownership, so the domain uses `assertPageAccess` which is the membership-level check). Returns `{ id }`.

- [ ] **Step 1: Add the failing test**

Append a new `describe` block:
```ts
import { reorderPage } from '../../src/pages/functions.ts'

function makeReorderPrisma(page: Record<string, unknown> | null) {
  const pageFindFirst = vi.fn(async () => page) // both the load AND the cycle BFS findMany sibling
  const pageFindMany = vi.fn(async () => [] as { id: string }[])
  const txFindFirst = vi.fn(async () => null)
  const txFindMany = vi.fn(async () => [] as { id: string }[])
  const pageUpdate = vi.fn(async () => ({}))
  const outboxCreate = vi.fn(async () => ({}))
  const memberFindUnique = vi.fn(async () => ({ role: 'EDITOR' as const }))
  const tx = {
    page: { findFirst: txFindFirst, findMany: txFindMany, update: pageUpdate },
    outboxEvent: { create: outboxCreate },
  }
  const $transaction = vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx))
  return {
    page: { findFirst: pageFindFirst, findMany: pageFindMany },
    workspaceMember: { findUnique: memberFindUnique },
    $transaction,
    __mocks: { pageFindFirst, pageFindMany, txFindFirst, txFindMany, pageUpdate, outboxCreate, memberFindUnique, $transaction },
  } as unknown as PrismaClient & {
    __mocks: {
      pageFindFirst: ReturnType<typeof vi.fn>
      pageFindMany: ReturnType<typeof vi.fn>
      txFindFirst: ReturnType<typeof vi.fn>
      txFindMany: ReturnType<typeof vi.fn>
      pageUpdate: ReturnType<typeof vi.fn>
      outboxCreate: ReturnType<typeof vi.fn>
      memberFindUnique: ReturnType<typeof vi.fn>
      $transaction: ReturnType<typeof vi.fn>
    }
  }
}

describe('domain reorderPage', () => {
  beforeEach(() => vi.clearAllMocks())

  const page = { id: 'p1', workspaceId: 'w1', parentId: null, prevPageId: null }

  it('throws BAD_REQUEST when newPrevPageId === pageId (self-reference)', async () => {
    const prisma = makeReorderPrisma(page)
    await expect(
      reorderPage(prisma, 'u1', { pageId: 'p1', newParentId: null, newPrevPageId: 'p1' }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('throws NOT_FOUND when the page does not exist', async () => {
    const prisma = makeReorderPrisma(null)
    await expect(
      reorderPage(prisma, 'u1', { pageId: 'p1', newParentId: null, newPrevPageId: null }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('short-circuits (no transaction) when parent + prev are unchanged', async () => {
    const prisma = makeReorderPrisma(page)
    const result = await reorderPage(prisma, 'u1', {
      pageId: 'p1',
      newParentId: null,
      newPrevPageId: null,
    })
    expect(result).toEqual({ id: 'p1' })
    expect(prisma.__mocks.$transaction).not.toHaveBeenCalled()
  })

  it('throws BAD_REQUEST when newParentId is a descendant (BFS finds it)', async () => {
    const prisma = makeReorderPrisma(page)
    // first BFS layer: children of p1 include 'desc-1'
    prisma.__mocks.pageFindMany.mockResolvedValueOnce([{ id: 'desc-1' }])
    await expect(
      reorderPage(prisma, 'u1', { pageId: 'p1', newParentId: 'desc-1', newPrevPageId: null }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('performs the 3-step relink and enqueues page.upserted when position changes', async () => {
    const prisma = makeReorderPrisma(page)
    const result = await reorderPage(prisma, 'u1', {
      pageId: 'p1',
      newParentId: 'parent-2',
      newPrevPageId: null,
    })
    expect(result).toEqual({ id: 'p1' })
    expect(prisma.__mocks.pageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({ parentId: 'parent-2', prevPageId: null, updatedById: 'u1' }),
      }),
    )
    expect(prisma.__mocks.outboxCreate).toHaveBeenCalledOnce()
  })

  it('throws FORBIDDEN when actor is not a workspace member', async () => {
    const prisma = makeReorderPrisma(page)
    prisma.__mocks.pageFindFirst.mockResolvedValue(page) // page exists
    prisma.__mocks.memberFindUnique.mockResolvedValue(null) // not a member
    await expect(
      reorderPage(prisma, 'u1', { pageId: 'p1', newParentId: 'parent-2', newPrevPageId: null }),
    ).rejects.toBeInstanceOf(DomainError)
  })
})
```

Note on the test: the BFS cycle-check in `reorder` runs against the **outer** `prisma` (not `tx`) in the tRPC original (lines 671–683 use `ctx.prisma`), so the domain port keeps it on `prisma`; the test wires `prisma.__mocks.pageFindMany` for the BFS and `prisma.__mocks.txFindMany` for any in-transaction `findMany`. The membership check uses `assertPageAccess` (membership-level) — the FORBIDDEN test stubs `page.findFirst` to a page but the **domain `assertPageAccess`** queries `prisma.page.findFirst` with the `workspace.members.some` filter; to make the membership test deterministic, the domain calls `assertPageAccess(prisma, actorUserId, page.id)` which returns null when not a member. Adjust the FORBIDDEN test so `pageFindFirst` returns the page for the initial load but `null` for the access check — simplest is to assert the access path: make `accessFindFirst` return null on the second call. **Implementation guidance:** because `reorder` loads the page first (`findFirst deletedAt:null`) and then calls `assertWorkspaceMember`, the cleanest verbatim port loads the page, then calls the domain `assertPageAccess` (which re-queries with the member filter and throws NOT_FOUND if the actor can't see it). If the executor finds the double-findFirst awkward to mock, keep the tRPC structure exactly: load page → `assertPageAccess(prisma, actorUserId, input.pageId)` for membership. The FORBIDDEN-vs-NOT_FOUND distinction: tRPC `assertWorkspaceMember` throws FORBIDDEN; the domain membership check via `assertPageAccess` throws NOT_FOUND. **To preserve the exact tRPC FORBIDDEN semantics**, the domain port uses an inline membership check identical to `assertWorkspaceMember` (throw `forbidden`), not `assertPageAccess`. The implementation below does exactly that.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/domain test -- pages`
Expected: FAIL — `reorderPage` missing.

- [ ] **Step 3: Update import block + append `reorderPage`**

The function needs `badRequest`, `forbidden`, `notFound`, and the BFS helper. Update the imports. Before:
```ts
import { notFound } from '../errors.ts'
import { assertPageAccess, assertPageOwnership } from '../kanban/access.ts'
import { seedKanbanDefaults } from '../kanban/seed.ts'
import { assertNotMovingIntoOwnDescendant } from './ordering.ts'
import type {
  CreatePageInput,
  DuplicatePageInput,
  MovePageInput,
  RenamePageInput,
  UpdatePageInput,
} from './schemas.ts'
```

After:
```ts
import { badRequest, forbidden, notFound } from '../errors.ts'
import { assertPageAccess, assertPageOwnership } from '../kanban/access.ts'
import { seedKanbanDefaults } from '../kanban/seed.ts'
import {
  assertNotMovingIntoOwnDescendant,
  assertNotReorderingIntoOwnDescendant,
} from './ordering.ts'
import type {
  CreatePageInput,
  DuplicatePageInput,
  MovePageInput,
  RenamePageInput,
  ReorderPageInput,
  UpdatePageInput,
} from './schemas.ts'
```

Append after `movePage`. This is the tRPC `page.reorder` body verbatim — the BFS cycle-check is delegated to `assertNotReorderingIntoOwnDescendant` (the helper runs the same loop on `prisma`), and the membership check is inlined to throw `forbidden` exactly like `assertWorkspaceMember`:
```ts
export async function reorderPage(
  prisma: PrismaClient,
  actorUserId: string,
  input: ReorderPageInput,
): Promise<{ id: string }> {
  if (input.newPrevPageId === input.pageId) {
    throw badRequest('Страница не может ссылаться на себя')
  }

  const page = await prisma.page.findFirst({
    where: { id: input.pageId, deletedAt: null },
  })
  if (!page) throw notFound('Страница не найдена')

  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: page.workspaceId, userId: actorUserId } },
  })
  if (!member) throw forbidden('Вы не являетесь участником воркспейса')

  if (page.parentId === input.newParentId && page.prevPageId === input.newPrevPageId) {
    return { id: input.pageId }
  }

  // Cycle check: newParentId must not be a descendant of pageId
  await assertNotReorderingIntoOwnDescendant(prisma, input.pageId, input.newParentId)

  return prisma.$transaction(async (tx) => {
    // Step 0: Lift the moved page out so its prev_page_id doesn't clash
    // with the next sibling adopting the same value in step 1
    // (prev_page_id is UNIQUE — two rows can't hold the same value).
    if (page.prevPageId !== null) {
      await tx.page.update({
        where: { id: input.pageId },
        data: { prevPageId: null },
      })
    }

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

    // Step 2: Plug the gap at insert point
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

    // Step 3: Update the moved page to its final position
    await tx.page.update({
      where: { id: input.pageId },
      data: {
        parentId: input.newParentId,
        prevPageId: input.newPrevPageId,
        updatedById: actorUserId,
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
}
```

Note: `assertPageAccess`/`assertPageOwnership` from `../kanban/access.ts` are still imported because `duplicatePage`/`movePage`/`createPage` use them; `reorderPage` inlines its membership check (FORBIDDEN, matching tRPC `assertWorkspaceMember`) rather than using the access helper (which throws NOT_FOUND), so the error code is preserved exactly.

- [ ] **Step 4: Run tests + check-types**

Run: `pnpm --filter @repo/domain test -- pages && pnpm --filter @repo/domain check-types`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/pages/functions.ts packages/domain/test/pages/functions.test.ts
git commit -m "$(cat <<'EOF'
feat(domain): add pages.reorderPage (BFS cycle-detection + 3-step relink)

Ported verbatim from tRPC page.reorder: self-ref guard, membership FORBIDDEN, no-op
short-circuit, BFS descendant cycle-check, UNIQUE-safe 3-step relink, enqueue page.upserted.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase C — Cluster C: Trash lifecycle (softDelete/restore/hardDelete/emptyTrash)

### Task 8: `softDeletePage` + `restorePage` (recursive BFS) + tests

**Files:**
- Modify: `packages/domain/src/pages/functions.ts`
- Modify: `packages/domain/test/pages/functions.test.ts`

Both port their tRPC counterparts verbatim, including the breadth-first descendant walk. `softDeletePage`: `assertPageOwnership` (moves into domain), detach from list, soft-delete the page, reattach next sibling, recursive BFS soft-delete of descendants, enqueue `page.deleted`, return `{ id }`. `restorePage`: `assertPageOwnership` (moves into domain), then inside the transaction re-find the page, handle deleted-parent → root, restore, insert at head, recursive BFS restore of descendants, enqueue `page.upserted`, return `{ id }`.

- [ ] **Step 1: Add the failing tests**

Append a new `describe` block:
```ts
import { restorePage, softDeletePage } from '../../src/pages/functions.ts'

function makeTrashPrisma(opts: {
  ownershipPage?: Record<string, unknown> | null
  txPage?: Record<string, unknown> | null
  parentPage?: Record<string, unknown> | null
} = {}) {
  const ownershipFindFirst = vi.fn(async () =>
    opts.ownershipPage === undefined
      ? { id: 'p1', workspaceId: 'w1', parentId: null, prevPageId: null, deletedAt: null, createdById: 'u1' }
      : opts.ownershipPage,
  )
  const memberFindUnique = vi.fn(async () => ({ role: 'OWNER' as const }))
  // tx.page.findFirst: nextSibling / the restore re-find / parent check / existingFirst
  const calls: Record<string, unknown>[] = []
  const txFindFirst = vi.fn(async (arg: Record<string, unknown>) => {
    calls.push(arg)
    return null
  })
  const txFindMany = vi.fn(async () => [] as { id: string }[]) // descendant BFS: empty
  const txUpdate = vi.fn(async () => ({}))
  const txUpdateMany = vi.fn(async () => ({ count: 0 }))
  const outboxCreate = vi.fn(async () => ({}))
  const tx = {
    page: { findFirst: txFindFirst, update: txUpdate, updateMany: txUpdateMany, findMany: txFindMany },
    outboxEvent: { create: outboxCreate },
  }
  const $transaction = vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx))
  return {
    page: { findFirst: ownershipFindFirst },
    workspaceMember: { findUnique: memberFindUnique },
    $transaction,
    __mocks: { ownershipFindFirst, memberFindUnique, txFindFirst, txFindMany, txUpdate, txUpdateMany, outboxCreate, $transaction },
  } as unknown as PrismaClient & {
    __mocks: {
      ownershipFindFirst: ReturnType<typeof vi.fn>
      memberFindUnique: ReturnType<typeof vi.fn>
      txFindFirst: ReturnType<typeof vi.fn>
      txFindMany: ReturnType<typeof vi.fn>
      txUpdate: ReturnType<typeof vi.fn>
      txUpdateMany: ReturnType<typeof vi.fn>
      outboxCreate: ReturnType<typeof vi.fn>
      $transaction: ReturnType<typeof vi.fn>
    }
  }
}

describe('domain softDeletePage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('soft-deletes the page (sets deletedAt) and enqueues page.deleted', async () => {
    const prisma = makeTrashPrisma()
    const result = await softDeletePage(prisma, 'u1', { id: 'p1', workspaceId: 'w1' })
    expect(result).toEqual({ id: 'p1' })
    expect(prisma.__mocks.txUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({ prevPageId: null, updatedById: 'u1' }),
      }),
    )
    expect(prisma.__mocks.outboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'page.deleted', aggregateId: 'p1' }),
      }),
    )
  })

  it('recursively soft-deletes descendants via BFS (updateMany per layer)', async () => {
    const prisma = makeTrashPrisma()
    prisma.__mocks.txFindMany
      .mockResolvedValueOnce([{ id: 'c1' }, { id: 'c2' }]) // layer 1
      .mockResolvedValueOnce([]) // layer 2 empty → stop
    await softDeletePage(prisma, 'u1', { id: 'p1', workspaceId: 'w1' })
    expect(prisma.__mocks.txUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['c1', 'c2'] } } }),
    )
  })

  it('throws FORBIDDEN when actor lacks ownership', async () => {
    const prisma = makeTrashPrisma({
      ownershipPage: { id: 'p1', workspaceId: 'w1', parentId: null, prevPageId: null, createdById: 'other' },
    })
    prisma.__mocks.memberFindUnique.mockResolvedValue({ role: 'EDITOR' })
    await expect(
      softDeletePage(prisma, 'u1', { id: 'p1', workspaceId: 'w1' }),
    ).rejects.toBeInstanceOf(DomainError)
  })
})

describe('domain restorePage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws NOT_FOUND when the page is not in trash (deletedAt null)', async () => {
    const prisma = makeTrashPrisma()
    // tx re-find returns a non-deleted page → NOT_FOUND
    prisma.__mocks.txFindFirst.mockResolvedValueOnce({ id: 'p1', workspaceId: 'w1', parentId: null, deletedAt: null })
    await expect(
      restorePage(prisma, 'u1', { id: 'p1', workspaceId: 'w1' }),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('restores a trashed page and enqueues page.upserted', async () => {
    const prisma = makeTrashPrisma()
    // tx re-find returns a deleted page (in trash)
    prisma.__mocks.txFindFirst.mockResolvedValueOnce({
      id: 'p1',
      workspaceId: 'w1',
      parentId: null,
      deletedAt: new Date(),
    })
    const result = await restorePage(prisma, 'u1', { id: 'p1', workspaceId: 'w1' })
    expect(result).toEqual({ id: 'p1' })
    expect(prisma.__mocks.txUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p1' },
        data: expect.objectContaining({ deletedAt: null, prevPageId: null, updatedById: 'u1' }),
      }),
    )
    expect(prisma.__mocks.outboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'page.upserted', aggregateId: 'p1' }),
      }),
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/domain test -- pages`
Expected: FAIL — `softDeletePage`/`restorePage` missing.

- [ ] **Step 3: Update import block + append both functions**

Update the imports to add `SoftDeletePageInput` and `RestorePageInput`. Before:
```ts
import type {
  CreatePageInput,
  DuplicatePageInput,
  MovePageInput,
  RenamePageInput,
  ReorderPageInput,
  UpdatePageInput,
} from './schemas.ts'
```

After:
```ts
import type {
  CreatePageInput,
  DuplicatePageInput,
  MovePageInput,
  RenamePageInput,
  ReorderPageInput,
  RestorePageInput,
  SoftDeletePageInput,
  UpdatePageInput,
} from './schemas.ts'
```

Append after `reorderPage`. Both are verbatim ports (the tRPC `softDelete` reads `page` off the `assertPageOwnership` result for `page.id`/`page.prevPageId`; `restore` re-finds inside the tx):
```ts
export async function softDeletePage(
  prisma: PrismaClient,
  actorUserId: string,
  input: SoftDeletePageInput,
): Promise<{ id: string }> {
  const page = await assertPageOwnership(prisma, actorUserId, input.id)
  const now = new Date()

  return prisma.$transaction(async (tx) => {
    // Remove page from linked list (detach first to avoid unique constraint)
    const nextSibling = await tx.page.findFirst({
      where: { prevPageId: page.id, deletedAt: null },
    })
    if (nextSibling) {
      await tx.page.update({
        where: { id: nextSibling.id },
        data: { prevPageId: null },
      })
    }

    // Soft-delete this page
    await tx.page.update({
      where: { id: page.id },
      data: { deletedAt: now, prevPageId: null, updatedById: actorUserId },
    })

    // Reattach next sibling to previous
    if (nextSibling) {
      await tx.page.update({
        where: { id: nextSibling.id },
        data: { prevPageId: page.prevPageId },
      })
    }

    // Soft-delete all descendants recursively
    // Use a loop to walk the tree breadth-first
    let parentIds: string[] = [page.id]
    while (parentIds.length > 0) {
      const children = await tx.page.findMany({
        where: {
          parentId: { in: parentIds },
          deletedAt: null,
        },
        select: { id: true },
      })
      if (children.length === 0) break
      const childIds = children.map((c) => c.id)
      await tx.page.updateMany({
        where: { id: { in: childIds } },
        data: { deletedAt: now, updatedById: actorUserId },
      })
      parentIds = childIds
    }

    await enqueueOutboxEvent(tx, {
      eventType: 'page.deleted',
      aggregateType: 'page',
      aggregateId: page.id,
      workspaceId: input.workspaceId,
    })

    return { id: page.id }
  })
}

export async function restorePage(
  prisma: PrismaClient,
  actorUserId: string,
  input: RestorePageInput,
): Promise<{ id: string }> {
  await assertPageOwnership(prisma, actorUserId, input.id)

  return prisma.$transaction(async (tx) => {
    const page = await tx.page.findFirst({
      where: { id: input.id, workspaceId: input.workspaceId },
    })
    if (!page || !page.deletedAt) {
      throw notFound('Страница не найдена в корзине')
    }

    // Determine restore location: if parent is deleted, move to workspace root
    let restoreParentId = page.parentId

    if (page.parentId) {
      const parentPage = await tx.page.findFirst({
        where: { id: page.parentId, deletedAt: null },
      })
      if (!parentPage) {
        // Parent is still deleted — move to workspace root
        restoreParentId = null
      }
    }

    // Restore the page
    await tx.page.update({
      where: { id: page.id },
      data: {
        deletedAt: null,
        parentId: restoreParentId,
        prevPageId: null,
        updatedById: actorUserId,
      },
    })

    // Insert at start of linked list
    const existingFirst = await tx.page.findFirst({
      where: {
        workspaceId: input.workspaceId,
        parentId: restoreParentId,
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

    // Restore all descendants recursively
    let parentIds: string[] = [page.id]
    while (parentIds.length > 0) {
      const children = await tx.page.findMany({
        where: {
          parentId: { in: parentIds },
          deletedAt: { not: null },
        },
        select: { id: true },
      })
      if (children.length === 0) break
      const childIds = children.map((c) => c.id)
      await tx.page.updateMany({
        where: { id: { in: childIds } },
        data: { deletedAt: null, updatedById: actorUserId },
      })
      parentIds = childIds
    }

    await enqueueOutboxEvent(tx, {
      eventType: 'page.upserted',
      aggregateType: 'page',
      aggregateId: page.id,
      workspaceId: input.workspaceId,
    })

    return { id: page.id }
  })
}
```

- [ ] **Step 4: Run tests + check-types**

Run: `pnpm --filter @repo/domain test -- pages && pnpm --filter @repo/domain check-types`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/pages/functions.ts packages/domain/test/pages/functions.test.ts
git commit -m "$(cat <<'EOF'
feat(domain): add pages.softDeletePage + pages.restorePage (recursive BFS)

Ported verbatim from tRPC page.softDelete/page.restore including the breadth-first descendant
walk, deleted-parent→root restore handling, and page.deleted / page.upserted outbox events.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: `hardDeletePage` + `emptyTrash` + barrel + index + tests

**Files:**
- Modify: `packages/domain/src/pages/functions.ts`
- Create: `packages/domain/src/pages/index.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/domain/test/pages/functions.test.ts`

`hardDeletePage`: `assertPageOwnership` (moves into domain), then inside the tx re-find the page, unlink next sibling, delete (cascade), enqueue `page.deleted`, return `{ id }`. `emptyTrash`: the tRPC procedure calls `assertWorkspaceMember` → `requireWritableWorkspace` → checks `member.role === 'OWNER'`. The **OWNER check moves into the domain** (it is trash business logic): the domain inlines the membership lookup + OWNER guard (`forbidden`). Returns `{ count }`. This task also wires the barrel so the new module is exported.

- [ ] **Step 1: Add the failing tests**

Append a new `describe` block:
```ts
import { emptyTrash, hardDeletePage } from '../../src/pages/functions.ts'

function makeHardDeletePrisma(txPage: Record<string, unknown> | null = { id: 'p1', workspaceId: 'w1', prevPageId: null }) {
  const ownershipFindFirst = vi.fn(async () => ({ id: 'p1', workspaceId: 'w1', createdById: 'u1' }))
  const memberFindUnique = vi.fn(async () => ({ role: 'OWNER' as const }))
  const txFindFirst = vi.fn(async () => txPage)
  const txUpdate = vi.fn(async () => ({}))
  const txDelete = vi.fn(async () => ({}))
  const outboxCreate = vi.fn(async () => ({}))
  const tx = {
    page: { findFirst: txFindFirst, update: txUpdate, delete: txDelete },
    outboxEvent: { create: outboxCreate },
  }
  const $transaction = vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx))
  return {
    page: { findFirst: ownershipFindFirst },
    workspaceMember: { findUnique: memberFindUnique },
    $transaction,
    __mocks: { ownershipFindFirst, memberFindUnique, txFindFirst, txUpdate, txDelete, outboxCreate, $transaction },
  } as unknown as PrismaClient & {
    __mocks: {
      ownershipFindFirst: ReturnType<typeof vi.fn>
      memberFindUnique: ReturnType<typeof vi.fn>
      txFindFirst: ReturnType<typeof vi.fn>
      txUpdate: ReturnType<typeof vi.fn>
      txDelete: ReturnType<typeof vi.fn>
      outboxCreate: ReturnType<typeof vi.fn>
      $transaction: ReturnType<typeof vi.fn>
    }
  }
}

describe('domain hardDeletePage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes the page and enqueues page.deleted', async () => {
    const prisma = makeHardDeletePrisma()
    const result = await hardDeletePage(prisma, 'u1', { id: 'p1', workspaceId: 'w1' })
    expect(result).toEqual({ id: 'p1' })
    expect(prisma.__mocks.txDelete).toHaveBeenCalledWith({ where: { id: 'p1' } })
    expect(prisma.__mocks.outboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'page.deleted', aggregateId: 'p1' }),
      }),
    )
  })

  it('throws NOT_FOUND when the page does not exist in the workspace', async () => {
    const prisma = makeHardDeletePrisma(null)
    await expect(
      hardDeletePage(prisma, 'u1', { id: 'p1', workspaceId: 'w1' }),
    ).rejects.toBeInstanceOf(DomainError)
  })
})

function makeEmptyTrashPrisma(role: string = 'OWNER') {
  const memberFindUnique = vi.fn(async () => ({ role }))
  const txFindMany = vi.fn(async () => [{ id: 't1' }, { id: 't2' }])
  const txDeleteMany = vi.fn(async () => ({ count: 2 }))
  const outboxCreate = vi.fn(async () => ({}))
  const tx = {
    page: { findMany: txFindMany, deleteMany: txDeleteMany },
    outboxEvent: { create: outboxCreate },
  }
  const $transaction = vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx))
  return {
    workspaceMember: { findUnique: memberFindUnique },
    $transaction,
    __mocks: { memberFindUnique, txFindMany, txDeleteMany, outboxCreate, $transaction },
  } as unknown as PrismaClient & {
    __mocks: {
      memberFindUnique: ReturnType<typeof vi.fn>
      txFindMany: ReturnType<typeof vi.fn>
      txDeleteMany: ReturnType<typeof vi.fn>
      outboxCreate: ReturnType<typeof vi.fn>
      $transaction: ReturnType<typeof vi.fn>
    }
  }
}

describe('domain emptyTrash', () => {
  beforeEach(() => vi.clearAllMocks())

  it('hard-deletes trashed pages and enqueues page.deleted per page', async () => {
    const prisma = makeEmptyTrashPrisma('OWNER')
    const result = await emptyTrash(prisma, 'u1', { workspaceId: 'w1' })
    expect(result).toEqual({ count: 2 })
    expect(prisma.__mocks.txDeleteMany).toHaveBeenCalledWith({
      where: { workspaceId: 'w1', deletedAt: { not: null } },
    })
    expect(prisma.__mocks.outboxCreate).toHaveBeenCalledTimes(2)
  })

  it('throws FORBIDDEN when the actor is not the OWNER', async () => {
    const prisma = makeEmptyTrashPrisma('ADMIN')
    await expect(emptyTrash(prisma, 'u1', { workspaceId: 'w1' })).rejects.toBeInstanceOf(DomainError)
    expect(prisma.__mocks.txDeleteMany).not.toHaveBeenCalled()
  })

  it('throws FORBIDDEN when the actor is not a member', async () => {
    const prisma = makeEmptyTrashPrisma('OWNER')
    prisma.__mocks.memberFindUnique.mockResolvedValue(null)
    await expect(emptyTrash(prisma, 'u1', { workspaceId: 'w1' })).rejects.toBeInstanceOf(DomainError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/domain test -- pages`
Expected: FAIL — `hardDeletePage`/`emptyTrash` missing.

- [ ] **Step 3: Update import block + append both functions**

Update the imports to add `EmptyTrashInput` and `HardDeletePageInput`. Before:
```ts
import type {
  CreatePageInput,
  DuplicatePageInput,
  MovePageInput,
  RenamePageInput,
  ReorderPageInput,
  RestorePageInput,
  SoftDeletePageInput,
  UpdatePageInput,
} from './schemas.ts'
```

After:
```ts
import type {
  CreatePageInput,
  DuplicatePageInput,
  EmptyTrashInput,
  HardDeletePageInput,
  MovePageInput,
  RenamePageInput,
  ReorderPageInput,
  RestorePageInput,
  SoftDeletePageInput,
  UpdatePageInput,
} from './schemas.ts'
```

Append after `restorePage`. `emptyTrash` inlines the membership + OWNER guard (tRPC `assertWorkspaceMember` FORBIDDEN + the explicit OWNER check):
```ts
export async function hardDeletePage(
  prisma: PrismaClient,
  actorUserId: string,
  input: HardDeletePageInput,
): Promise<{ id: string }> {
  await assertPageOwnership(prisma, actorUserId, input.id)

  return prisma.$transaction(async (tx) => {
    const page = await tx.page.findFirst({
      where: { id: input.id, workspaceId: input.workspaceId },
    })
    if (!page) {
      throw notFound('Страница не найдена')
    }

    // Remove from linked list if still linked
    const nextSibling = await tx.page.findFirst({
      where: { prevPageId: page.id },
    })
    if (nextSibling) {
      await tx.page.update({
        where: { id: nextSibling.id },
        data: { prevPageId: page.prevPageId },
      })
    }

    // Delete the page (cascade handles related rows)
    await tx.page.delete({ where: { id: page.id } })

    await enqueueOutboxEvent(tx, {
      eventType: 'page.deleted',
      aggregateType: 'page',
      aggregateId: page.id,
      workspaceId: input.workspaceId,
    })

    return { id: page.id }
  })
}

export async function emptyTrash(
  prisma: PrismaClient,
  actorUserId: string,
  input: EmptyTrashInput,
): Promise<{ count: number }> {
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: actorUserId } },
  })
  if (!member) throw forbidden('Вы не являетесь участником воркспейса')
  if (member.role !== 'OWNER') {
    throw forbidden('Только владелец может очистить корзину')
  }
  return prisma.$transaction(async (tx) => {
    const trashed = await tx.page.findMany({
      where: { workspaceId: input.workspaceId, deletedAt: { not: null } },
      select: { id: true },
    })
    const deleted = await tx.page.deleteMany({
      where: { workspaceId: input.workspaceId, deletedAt: { not: null } },
    })
    for (const { id } of trashed) {
      await enqueueOutboxEvent(tx, {
        eventType: 'page.deleted',
        aggregateType: 'page',
        aggregateId: id,
        workspaceId: input.workspaceId,
      })
    }
    return { count: deleted.count }
  })
}
```

- [ ] **Step 4: Create the `pages/index.ts` barrel**

`packages/domain/src/pages/index.ts`:
```ts
export * from './functions.ts'
export * from './ordering.ts'
export * from './schemas.ts'
```

- [ ] **Step 5: Update `packages/domain/src/index.ts`**

Before (current content):
```ts
export * from './errors.ts'
export * from './favorites/index.ts'
export * from './kanban/index.ts'
export * from './notifications/index.ts'
export * from './reminders/index.ts'
```

After:
```ts
export * from './errors.ts'
export * from './favorites/index.ts'
export * from './kanban/index.ts'
export * from './notifications/index.ts'
export * from './pages/index.ts'
export * from './reminders/index.ts'
```

- [ ] **Step 6: Run full domain tests + check-types + build**

Run: `pnpm --filter @repo/domain test && pnpm --filter @repo/domain check-types && pnpm --filter @repo/domain build`
Expected: PASS, clean, dist emitted. (Build now so the downstream `@repo/trpc`/engines check-types in later phases resolve the new exports locally.)

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/pages/functions.ts packages/domain/src/pages/index.ts \
        packages/domain/src/index.ts packages/domain/test/pages/functions.test.ts
git commit -m "$(cat <<'EOF'
feat(domain): add pages.hardDeletePage + pages.emptyTrash; export pages module

hardDeletePage unlinks + cascades + enqueues page.deleted. emptyTrash inlines the OWNER guard
(FORBIDDEN) and enqueues page.deleted per trashed page. Ported verbatim from tRPC.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase D — tRPC wiring: the 10 procedures become thin domain wrappers

### Task 10: tRPC `page.ts` — Core CRUD wrappers (`create`/`rename`/`update`/`duplicate`)

**Files:**
- Modify: `packages/trpc/src/routers/page.ts`

The `import * as domain`, `mapDomain`, and `seedKanbanDefaults` imports already exist at the top of `page.ts` (lines 12–14). Each procedure keeps its existing **pre-checks** (`assertWorkspaceMember`/`requireWritableWorkspace`/`assertPageOwnership`/`assertPageAccess`) in the wrapper, then delegates to the domain. The domain functions also run `assertPageOwnership`/`assertPageAccess` internally — that double-check is harmless (idempotent reads) and preserves the exact pre-check ordering/messages the tRPC suite asserts. Return shapes are preserved exactly because the domain functions return the same shapes (`{ id }`, `{ id, title, icon, updatedAt }`).

- [ ] **Step 1: Replace the `create` procedure**

Before (lines 79–157):
```ts
  create: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        parentId: z.string().uuid().nullable(),
        title: z.string().optional(),
        icon: z.string().optional(),
        type: z.nativeEnum(PageType).optional(),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<{ id: string }> => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      await requireWritableWorkspace(input.workspaceId)

      // If parent is a page, verify it exists and belongs to same workspace
      if (input.parentId) {
        const parentPage = await ctx.prisma.page.findFirst({
          where: { id: input.parentId, workspaceId: input.workspaceId, deletedAt: null },
        })
        if (!parentPage) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Родительская страница не найдена',
          })
        }
      }

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
    }),
```

After:
```ts
  create: protectedProcedure
    .input(domain.createPageInput)
    .mutation(async ({ ctx, input }): Promise<{ id: string }> => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      await requireWritableWorkspace(input.workspaceId)
      return mapDomain(() => domain.createPage(ctx.prisma, ctx.user.id, input))
    }),
```

- [ ] **Step 2: Replace the `rename` procedure**

Before (lines 159–196):
```ts
  rename: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        workspaceId: z.string().uuid(),
        title: z.string(),
        icon: z.string().nullable().optional(),
      }),
    )
    .mutation(
      async ({
        ctx,
        input,
      }): Promise<{ id: string; title: string | null; icon: string | null; updatedAt: Date }> => {
        await assertPageOwnership(ctx, input.id)
        await requireWritableWorkspace(input.workspaceId)
        const data: {
          title: string
          icon?: string | null
          updatedById: string
        } = { title: input.title, updatedById: ctx.user.id }
        if (input.icon !== undefined) data.icon = input.icon
        return ctx.prisma.$transaction(async (tx) => {
          const updated = await tx.page.update({
            where: { id: input.id },
            data,
            select: { id: true, title: true, icon: true, updatedAt: true },
          })
          await enqueueOutboxEvent(tx, {
            eventType: 'page.upserted',
            aggregateType: 'page',
            aggregateId: updated.id,
            workspaceId: input.workspaceId,
          })
          return updated
        })
      },
    ),
```

After:
```ts
  rename: protectedProcedure
    .input(domain.renamePageInput)
    .mutation(
      async ({
        ctx,
        input,
      }): Promise<{ id: string; title: string | null; icon: string | null; updatedAt: Date }> => {
        await requireWritableWorkspace(input.workspaceId)
        return mapDomain(() => domain.renamePage(ctx.prisma, ctx.user.id, input))
      },
    ),
```

(The domain `renamePage` runs `assertPageOwnership` internally, so the wrapper drops its own call but keeps `requireWritableWorkspace`.)

- [ ] **Step 3: Replace the `update` procedure**

Before (lines 198–239):
```ts
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        workspaceId: z.string().uuid(),
        title: z.string().optional(),
        icon: z.string().nullable().optional(),
        type: z.nativeEnum(PageType).optional(),
      }),
    )
    .mutation(
      async ({
        ctx,
        input,
      }): Promise<{ id: string; title: string | null; icon: string | null; updatedAt: Date }> => {
        await assertPageOwnership(ctx, input.id)
        await requireWritableWorkspace(input.workspaceId)
        const data: {
          title?: string
          icon?: string | null
          type?: PageType
          updatedById: string
        } = { updatedById: ctx.user.id }
        if (input.title !== undefined) data.title = input.title
        if (input.icon !== undefined) data.icon = input.icon
        if (input.type !== undefined) data.type = input.type
        return ctx.prisma.$transaction(async (tx) => {
          const updated = await tx.page.update({
            where: { id: input.id },
            data,
            select: { id: true, title: true, icon: true, updatedAt: true },
          })
          await enqueueOutboxEvent(tx, {
            eventType: 'page.upserted',
            aggregateType: 'page',
            aggregateId: updated.id,
            workspaceId: input.workspaceId,
          })
          return updated
        })
      },
    ),
```

After:
```ts
  update: protectedProcedure
    .input(domain.updatePageInput)
    .mutation(
      async ({
        ctx,
        input,
      }): Promise<{ id: string; title: string | null; icon: string | null; updatedAt: Date }> => {
        await requireWritableWorkspace(input.workspaceId)
        return mapDomain(() => domain.updatePage(ctx.prisma, ctx.user.id, input))
      },
    ),
```

- [ ] **Step 4: Replace the `duplicate` procedure**

Before (lines 587–640):
```ts
  duplicate: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .mutation(async ({ ctx, input }): Promise<{ id: string }> => {
      const page = await assertPageAccess(ctx, input.pageId)
      await requireWritableWorkspace(page.workspaceId)

      return ctx.prisma.$transaction(async (tx) => {
        // 1. Detach old next sibling first (prevPageId is unique)
        const oldNext = await tx.page.findFirst({
          where: { prevPageId: page.id, deletedAt: null },
        })
        if (oldNext) {
          await tx.page.update({
            where: { id: oldNext.id },
            data: { prevPageId: null },
          })
        }

        // 2. Create copy with same parent, inserted after original. Copy both
        // the JSON snapshot AND the authoritative contentYjs bytes — the editor
        // loads from contentYjs, so without it the duplicate renders empty.
        const copy = await tx.page.create({
          data: {
            workspaceId: page.workspaceId,
            parentId: page.parentId,
            type: page.type,
            title: `${page.title ?? ''} (копия)`.trim(),
            icon: page.icon,
            content: page.content ?? undefined,
            contentYjs: page.contentYjs ?? undefined,
            prevPageId: page.id,
            createdById: ctx.user.id,
            updatedById: ctx.user.id,
          },
        })

        // 3. Reattach old next sibling to point to copy
        if (oldNext) {
          await tx.page.update({
            where: { id: oldNext.id },
            data: { prevPageId: copy.id },
          })
        }

        await enqueueOutboxEvent(tx, {
          eventType: 'page.upserted',
          aggregateType: 'page',
          aggregateId: copy.id,
          workspaceId: page.workspaceId,
        })

        return { id: copy.id }
      })
    }),
```

After:
```ts
  duplicate: protectedProcedure
    .input(domain.duplicatePageInput)
    .mutation(async ({ ctx, input }): Promise<{ id: string }> => {
      const page = await assertPageAccess(ctx, input.pageId)
      await requireWritableWorkspace(page.workspaceId)
      return mapDomain(() => domain.duplicatePage(ctx.prisma, ctx.user.id, input))
    }),
```

(The wrapper keeps `assertPageAccess` to resolve `page.workspaceId` for the `requireWritableWorkspace` pre-check; the domain re-runs `assertPageAccess` itself.)

- [ ] **Step 5: Run tRPC tests + check-types**

Run: `pnpm --filter @repo/trpc test && pnpm --filter @repo/trpc check-types`
Expected: PASS. The existing page-router regression suite is the guard; return shapes (`{ id }`, `{ id, title, icon, updatedAt }`) are byte-identical.

- [ ] **Step 6: Commit**

```bash
git add packages/trpc/src/routers/page.ts
git commit -m "$(cat <<'EOF'
refactor(trpc): page create/rename/update/duplicate delegate to @repo/domain

Thin mapDomain wrappers keep requireWritableWorkspace / assertWorkspaceMember / assertPageAccess
pre-checks; the domain owns the transaction + outbox + kanban seed. Return shapes preserved.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: tRPC `page.ts` — Move/Reorder/Trash wrappers + import cleanup

**Files:**
- Modify: `packages/trpc/src/routers/page.ts`

Wire `move` → `domain.movePage`, `reorder` → `domain.reorderPage`, `softDelete` → `domain.softDeletePage`, `restore` → `domain.restorePage`, `hardDelete` → `domain.hardDeletePage`, `emptyTrash` → `domain.emptyTrash`. After this task the only direct-Prisma writes left in `page.ts` are the favorites (SP2) and reads. The `TRPCError`, `enqueueOutboxEvent`, `PageType`, and `seedKanbanDefaults` imports become unused — remove them in Step 7.

- [ ] **Step 1: Replace the `softDelete` procedure**

Before (lines 241–308):
```ts
  softDelete: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        workspaceId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageOwnership(ctx, input.id)
      await requireWritableWorkspace(input.workspaceId)
      const now = new Date()

      return ctx.prisma.$transaction(async (tx) => {
        // Remove page from linked list (detach first to avoid unique constraint)
        const nextSibling = await tx.page.findFirst({
          where: { prevPageId: page.id, deletedAt: null },
        })
        if (nextSibling) {
          await tx.page.update({
            where: { id: nextSibling.id },
            data: { prevPageId: null },
          })
        }

        // Soft-delete this page
        await tx.page.update({
          where: { id: page.id },
          data: { deletedAt: now, prevPageId: null, updatedById: ctx.user.id },
        })

        // Reattach next sibling to previous
        if (nextSibling) {
          await tx.page.update({
            where: { id: nextSibling.id },
            data: { prevPageId: page.prevPageId },
          })
        }

        // Soft-delete all descendants recursively
        // Use a loop to walk the tree breadth-first
        let parentIds: string[] = [page.id]
        while (parentIds.length > 0) {
          const children = await tx.page.findMany({
            where: {
              parentId: { in: parentIds },
              deletedAt: null,
            },
            select: { id: true },
          })
          if (children.length === 0) break
          const childIds = children.map((c) => c.id)
          await tx.page.updateMany({
            where: { id: { in: childIds } },
            data: { deletedAt: now, updatedById: ctx.user.id },
          })
          parentIds = childIds
        }

        await enqueueOutboxEvent(tx, {
          eventType: 'page.deleted',
          aggregateType: 'page',
          aggregateId: page.id,
          workspaceId: input.workspaceId,
        })

        return { id: page.id }
      })
    }),
```

After:
```ts
  softDelete: protectedProcedure
    .input(domain.softDeletePageInput)
    .mutation(async ({ ctx, input }) => {
      await requireWritableWorkspace(input.workspaceId)
      return mapDomain(() => domain.softDeletePage(ctx.prisma, ctx.user.id, input))
    }),
```

- [ ] **Step 2: Replace the `restore` procedure**

Before (lines 310–398):
```ts
  restore: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        workspaceId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertPageOwnership(ctx, input.id)
      await requireWritableWorkspace(input.workspaceId)

      return ctx.prisma.$transaction(async (tx) => {
        const page = await tx.page.findFirst({
          where: { id: input.id, workspaceId: input.workspaceId },
        })
        if (!page || !page.deletedAt) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Страница не найдена в корзине' })
        }

        // Determine restore location: if parent is deleted, move to workspace root
        let restoreParentId = page.parentId

        if (page.parentId) {
          const parentPage = await tx.page.findFirst({
            where: { id: page.parentId, deletedAt: null },
          })
          if (!parentPage) {
            // Parent is still deleted — move to workspace root
            restoreParentId = null
          }
        }

        // Restore the page
        await tx.page.update({
          where: { id: page.id },
          data: {
            deletedAt: null,
            parentId: restoreParentId,
            prevPageId: null,
            updatedById: ctx.user.id,
          },
        })

        // Insert at start of linked list
        const existingFirst = await tx.page.findFirst({
          where: {
            workspaceId: input.workspaceId,
            parentId: restoreParentId,
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

        // Restore all descendants recursively
        let parentIds: string[] = [page.id]
        while (parentIds.length > 0) {
          const children = await tx.page.findMany({
            where: {
              parentId: { in: parentIds },
              deletedAt: { not: null },
            },
            select: { id: true },
          })
          if (children.length === 0) break
          const childIds = children.map((c) => c.id)
          await tx.page.updateMany({
            where: { id: { in: childIds } },
            data: { deletedAt: null, updatedById: ctx.user.id },
          })
          parentIds = childIds
        }

        await enqueueOutboxEvent(tx, {
          eventType: 'page.upserted',
          aggregateType: 'page',
          aggregateId: page.id,
          workspaceId: input.workspaceId,
        })

        return { id: page.id }
      })
    }),
```

After:
```ts
  restore: protectedProcedure
    .input(domain.restorePageInput)
    .mutation(async ({ ctx, input }) => {
      await requireWritableWorkspace(input.workspaceId)
      return mapDomain(() => domain.restorePage(ctx.prisma, ctx.user.id, input))
    }),
```

- [ ] **Step 3: Replace the `hardDelete` procedure**

Before (lines 400–442):
```ts
  hardDelete: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        workspaceId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertPageOwnership(ctx, input.id)
      await requireWritableWorkspace(input.workspaceId)

      return ctx.prisma.$transaction(async (tx) => {
        const page = await tx.page.findFirst({
          where: { id: input.id, workspaceId: input.workspaceId },
        })
        if (!page) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Страница не найдена' })
        }

        // Remove from linked list if still linked
        const nextSibling = await tx.page.findFirst({
          where: { prevPageId: page.id },
        })
        if (nextSibling) {
          await tx.page.update({
            where: { id: nextSibling.id },
            data: { prevPageId: page.prevPageId },
          })
        }

        // Delete the page (cascade handles related rows)
        await tx.page.delete({ where: { id: page.id } })

        await enqueueOutboxEvent(tx, {
          eventType: 'page.deleted',
          aggregateType: 'page',
          aggregateId: page.id,
          workspaceId: input.workspaceId,
        })

        return { id: page.id }
      })
    }),
```

After:
```ts
  hardDelete: protectedProcedure
    .input(domain.hardDeletePageInput)
    .mutation(async ({ ctx, input }) => {
      await requireWritableWorkspace(input.workspaceId)
      return mapDomain(() => domain.hardDeletePage(ctx.prisma, ctx.user.id, input))
    }),
```

- [ ] **Step 4: Replace the `emptyTrash` procedure**

Before (lines 466–495):
```ts
  emptyTrash: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const member = await assertWorkspaceMember(ctx, input.workspaceId)
      await requireWritableWorkspace(input.workspaceId)
      if (member.role !== 'OWNER') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Только владелец может очистить корзину',
        })
      }
      return ctx.prisma.$transaction(async (tx) => {
        const trashed = await tx.page.findMany({
          where: { workspaceId: input.workspaceId, deletedAt: { not: null } },
          select: { id: true },
        })
        const deleted = await tx.page.deleteMany({
          where: { workspaceId: input.workspaceId, deletedAt: { not: null } },
        })
        for (const { id } of trashed) {
          await enqueueOutboxEvent(tx, {
            eventType: 'page.deleted',
            aggregateType: 'page',
            aggregateId: id,
            workspaceId: input.workspaceId,
          })
        }
        return { count: deleted.count }
      })
    }),
```

After:
```ts
  emptyTrash: protectedProcedure
    .input(domain.emptyTrashInput)
    .mutation(async ({ ctx, input }) => {
      await requireWritableWorkspace(input.workspaceId)
      return mapDomain(() => domain.emptyTrash(ctx.prisma, ctx.user.id, input))
    }),
```

(The domain `emptyTrash` inlines the membership + OWNER guard, so the wrapper drops `assertWorkspaceMember` + the OWNER check but keeps `requireWritableWorkspace`.)

- [ ] **Step 5: Replace the `move` procedure**

Before (lines 497–585):
```ts
  move: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        newParentId: z.string().uuid().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageAccess(ctx, input.pageId)

      // Check ownership: must be creator or workspace OWNER
      await assertPageOwnership(ctx, input.pageId)
      await requireWritableWorkspace(page.workspaceId)

      return ctx.prisma.$transaction(async (tx) => {
        // 1. Remove from old linked-list (detach first to avoid unique constraint)
        const nextSibling = await tx.page.findFirst({
          where: { prevPageId: page.id, deletedAt: null },
        })
        if (nextSibling) {
          await tx.page.update({
            where: { id: nextSibling.id },
            data: { prevPageId: null },
          })
        }

        // 2. Prevent moving into own descendant
        if (input.newParentId) {
          let currentId: string | null = input.newParentId
          while (currentId) {
            if (currentId === input.pageId) {
              throw new TRPCError({
                code: 'BAD_REQUEST',
                message: 'Невозможно переместить страницу в собственного потомка',
              })
            }
            const ancestor: { parentId: string | null } | null = await tx.page.findFirst({
              where: { id: currentId, deletedAt: null },
              select: { parentId: true },
            })
            currentId = ancestor?.parentId ?? null
          }
        }

        // 3. Set new parentId
        await tx.page.update({
          where: { id: page.id },
          data: {
            parentId: input.newParentId,
            prevPageId: null,
            updatedById: ctx.user.id,
          },
        })

        // Reattach next sibling to previous in old list
        if (nextSibling) {
          await tx.page.update({
            where: { id: nextSibling.id },
            data: { prevPageId: page.prevPageId },
          })
        }

        // 4. Insert at head of new parent's linked-list
        const existingFirst = await tx.page.findFirst({
          where: {
            workspaceId: page.workspaceId,
            parentId: input.newParentId,
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

        await enqueueOutboxEvent(tx, {
          eventType: 'page.upserted',
          aggregateType: 'page',
          aggregateId: page.id,
          workspaceId: page.workspaceId,
        })

        return { id: page.id }
      })
    }),
```

After:
```ts
  move: protectedProcedure
    .input(domain.movePageInput)
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageAccess(ctx, input.pageId)
      await requireWritableWorkspace(page.workspaceId)
      return mapDomain(() => domain.movePage(ctx.prisma, ctx.user.id, input))
    }),
```

(The wrapper keeps `assertPageAccess` to resolve `page.workspaceId` for `requireWritableWorkspace`; the domain re-runs `assertPageAccess` + `assertPageOwnership` itself.)

- [ ] **Step 6: Replace the `reorder` procedure**

Before (lines 642–744):
```ts
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
        // Step 0: Lift the moved page out so its prev_page_id doesn't clash
        // with the next sibling adopting the same value in step 1
        // (prev_page_id is UNIQUE — two rows can't hold the same value).
        if (page.prevPageId !== null) {
          await tx.page.update({
            where: { id: input.pageId },
            data: { prevPageId: null },
          })
        }

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

        // Step 2: Plug the gap at insert point
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

        // Step 3: Update the moved page to its final position
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

After:
```ts
  reorder: protectedProcedure
    .input(domain.reorderPageInput)
    .mutation(async ({ ctx, input }) => {
      const page = await ctx.prisma.page.findFirst({
        where: { id: input.pageId, deletedAt: null },
        select: { workspaceId: true },
      })
      if (page) await requireWritableWorkspace(page.workspaceId)
      return mapDomain(() => domain.reorderPage(ctx.prisma, ctx.user.id, input))
    }),
```

(The wrapper does a minimal page lookup only to run the `requireWritableWorkspace` plan gate; the domain `reorderPage` re-finds the page, throws NOT_FOUND if missing, runs the membership FORBIDDEN check, the self-ref/no-op/BFS logic, and the relink. If the page is missing the wrapper skips the plan gate and lets the domain throw the canonical NOT_FOUND.)

- [ ] **Step 7: Clean up now-unused imports**

After Steps 1–6, `page.ts` no longer references `TRPCError` (in the migrated procedures), `enqueueOutboxEvent`, `PageType`, or `seedKanbanDefaults`. **Verify** with a grep before deleting — `getById` (line 48) and `listByWorkspace`/`listTrashed`/`listFavorites` still use `TRPCError`? Check: `getById` throws `new TRPCError({ code: 'NOT_FOUND' })` at line 48, so **`TRPCError` stays**. `z` is still used by reads (`getById`/`listByWorkspace`/`listTrashed`/`listFavorites`). `enqueueOutboxEvent`, `PageType`, and `seedKanbanDefaults` are now unused.

Before (lines 1–15):
```ts
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { PageType, enqueueOutboxEvent } from '@repo/db'

import { router, protectedProcedure } from '../trpc'
import { requireWritableWorkspace } from '../helpers/plan'
import {
  assertWorkspaceMember,
  assertPageAccess,
  assertPageOwnership,
} from '../helpers/page-access'
import * as domain from '@repo/domain'
import { mapDomain } from '../helpers/map-domain'
import { seedKanbanDefaults } from './kanban/helpers'
import { pageShareRouter } from './page-share'
```

After:
```ts
import { z } from 'zod'
import { TRPCError } from '@trpc/server'

import { router, protectedProcedure } from '../trpc'
import { requireWritableWorkspace } from '../helpers/plan'
import {
  assertWorkspaceMember,
  assertPageAccess,
} from '../helpers/page-access'
import * as domain from '@repo/domain'
import { mapDomain } from '../helpers/map-domain'
import { pageShareRouter } from './page-share'
```

(`assertPageOwnership` is removed from the import: after migration, no procedure in `page.ts` calls it directly — `create`/`reorder` use `assertWorkspaceMember`; `move`/`duplicate` use `assertPageAccess`; rename/update/softDelete/restore/hardDelete delegate the ownership check to the domain. `assertWorkspaceMember` is still used by `listByWorkspace`/`listTrashed`/`create`/`listFavorites`. **Grep to confirm before deleting** — if any read still references `assertPageOwnership`, keep it.)

- [ ] **Step 8: Run tRPC tests + check-types + lint**

Run: `pnpm --filter @repo/trpc test && pnpm --filter @repo/trpc check-types && pnpm --filter @repo/trpc lint`
Expected: PASS, clean, no unused-import warnings. The page-router regression suite proves move/reorder/trash messages + return shapes are unchanged.

- [ ] **Step 9: Commit**

```bash
git add packages/trpc/src/routers/page.ts
git commit -m "$(cat <<'EOF'
refactor(trpc): page move/reorder/softDelete/restore/hardDelete/emptyTrash delegate to @repo/domain

All 10 page write mutations are now thin mapDomain wrappers keeping requireWritableWorkspace +
membership/access pre-checks. Removed now-unused enqueueOutboxEvent/PageType/seedKanbanDefaults
imports. Return shapes + error codes preserved (regression suite green).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase E — engines wiring: createPage + movePage delegate (gap-fixes)

### Task 12: engines `PageWriter` — `createPage` + `movePage` delegate to domain + spec

**Files:**
- Modify: `apps/engines/src/apps/mcp/services/page-writer.service.ts`
- Create: `apps/engines/src/apps/mcp/services/page-writer.service.spec.ts`

ONLY `createPage` + `movePage` delegate. `updatePage`, `appendContent`, `setArchived`, `createDiagramPage`, `updateDiagramSource` and the private `ensureParent` STAY direct-Prisma (do NOT migrate). The class is named `PageWriter` (not `PageWriterService`), constructed `new PageWriter(prisma)`. Tool contracts: `doCreatePage` returns `{ pageId, url }`, `doMovePage` returns `{ ok: true }` — both preserved (the service `createPage` returns the page id string; `movePage` returns `void`).

**Mapping decisions (pinned):**
- engines `createPage` input `{ userId, workspaceId, parentId?, title, ownership?, content? }` → `domain.createPage(prisma, userId, { workspaceId, parentId: parentId ?? null, title, type: 'TEXT', ownership, content })`. This adds **list-tail positioning** (the gap-fix) and unifies the outbox path. `content` is passed through (the domain forwards it to `tx.page.create`); engines no longer builds `contentYjs` itself for create — **the domain does not build `contentYjs` from a Tiptap doc**, so to preserve the engines behavior (editor loads from `contentYjs`), the service builds `contentYjs` via the existing `buildContentYjs(content)` helper and passes it as the `contentYjs` field of the domain input. Pin: pass BOTH `content` (JSON) and `contentYjs` (bytes) to the domain, exactly as the engines original did.
- engines `movePage` input `{ userId, workspaceId, pageId, newParentId?, prevPageId? }` → **`domain.reorderPage`** (NOT `domain.movePage`). engines `movePage` carries an explicit `prevPageId` and its 5-step relink matches tRPC `reorder` (which takes `newPrevPageId`), not tRPC `move` (head-insert only, no prev). Map `prevPageId` → `newPrevPageId`. This adds **BFS cycle-detection** (the gap-fix). The engines workspace-ownership check (`page.workspaceId !== input.workspaceId` → `PageNotFoundError`) and parent validation (`ensureParent`) must be preserved as a pre-step before delegating, because the domain `reorderPage` checks membership (not the engines cross-workspace `workspaceId` match) — so the service keeps a lightweight pre-check then delegates.

- [ ] **Step 1: Write the failing spec**

`apps/engines/src/apps/mcp/services/page-writer.service.spec.ts`:
```ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'

// SP1 pattern: NO jest.unstable_mockModule. Import the service normally; the REAL
// @repo/domain functions run against a hand-mocked PrismaClient. We assert on mocked
// prisma calls + returned values directly.
import { PageWriter } from './page-writer.service.js'

function makeMockPrisma() {
  // createPage path
  const pageCreate = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ id: 'new-1', type: 'TEXT' }))
  const txFindMany = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => [])
  const txFindFirst = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => null)
  const txUpdate = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({}))
  const outboxCreate = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({}))
  // outer parent lookup (domain.createPage uses prisma.page.findFirst for the parent check;
  // engines movePage pre-check uses prisma.page.findUnique). Provide both.
  const pageFindFirst = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => null) // no parent by default
  const pageFindUnique = jest.fn<(...a: unknown[]) => Promise<unknown>>(
    async () => ({ id: 'p1', workspaceId: 'w1', prevPageId: null }),
  )
  const memberFindUnique = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ role: 'EDITOR' }))
  const tx = {
    page: { create: pageCreate, findMany: txFindMany, findFirst: txFindFirst, update: txUpdate },
    outboxEvent: { create: outboxCreate },
    kanbanColumn: { createMany: jest.fn() },
    kanbanType: { createMany: jest.fn() },
    kanbanPriority: { createMany: jest.fn() },
  }
  const $transaction = jest.fn<(...a: unknown[]) => Promise<unknown>>(
    async (fn: unknown) => (fn as (t: typeof tx) => unknown)(tx),
  )
  return {
    page: { findFirst: pageFindFirst, findUnique: pageFindUnique, findMany: txFindMany },
    workspaceMember: { findUnique: memberFindUnique },
    $transaction,
    __mocks: { pageCreate, txFindMany, txFindFirst, txUpdate, outboxCreate, pageFindFirst, pageFindUnique, memberFindUnique, $transaction },
  } as unknown as PrismaClient & { __mocks: Record<string, ReturnType<typeof jest.fn>> }
}

describe('PageWriter', () => {
  let mockPrisma: ReturnType<typeof makeMockPrisma>
  let writer: PageWriter

  beforeEach(() => {
    jest.clearAllMocks()
    mockPrisma = makeMockPrisma()
    writer = new PageWriter(mockPrisma)
  })

  it('createPage delegates to domain: positions the page (findMany siblings) and enqueues outbox', async () => {
    const id = await writer.createPage({
      userId: 'u1',
      workspaceId: 'w1',
      parentId: null,
      title: 'Note',
      ownership: 'TEXT',
    })
    expect(id).toBe('new-1')
    expect(mockPrisma.__mocks.pageCreate).toHaveBeenCalledTimes(1)
    // the linked-list positioning query (the gap-fix) ran:
    expect(mockPrisma.__mocks.txFindMany).toHaveBeenCalled()
    expect(mockPrisma.__mocks.outboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'page.upserted', aggregateId: 'new-1' }),
      }),
    )
  })

  it('createPage links the new page to the tail sibling', async () => {
    mockPrisma.__mocks.txFindMany.mockResolvedValue([
      { id: 's1', prevPageId: null },
      { id: 's2', prevPageId: 's1' },
    ])
    await writer.createPage({ userId: 'u1', workspaceId: 'w1', title: 'Note' })
    expect(mockPrisma.__mocks.txUpdate).toHaveBeenCalledWith({
      where: { id: 'new-1' },
      data: { prevPageId: 's2' },
    })
  })

  it('movePage delegates to domain.reorderPage: enqueues page.upserted on position change', async () => {
    // page exists in workspace w1, currently at parent null / prev null
    mockPrisma.__mocks.pageFindUnique.mockResolvedValue({ id: 'p1', workspaceId: 'w1', prevPageId: null })
    // domain.reorderPage re-loads via prisma.page.findFirst; return the same page
    mockPrisma.__mocks.pageFindFirst.mockResolvedValue({
      id: 'p1',
      workspaceId: 'w1',
      parentId: null,
      prevPageId: null,
    })
    await writer.movePage({ userId: 'u1', workspaceId: 'w1', pageId: 'p1', newParentId: 'parent-2', prevPageId: null })
    expect(mockPrisma.__mocks.outboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'page.upserted', aggregateId: 'p1' }),
      }),
    )
  })

  it('movePage throws when the page is not in the given workspace (engines cross-workspace guard)', async () => {
    mockPrisma.__mocks.pageFindUnique.mockResolvedValue({ id: 'p1', workspaceId: 'OTHER', prevPageId: null })
    await expect(
      writer.movePage({ userId: 'u1', workspaceId: 'w1', pageId: 'p1', newParentId: null, prevPageId: null }),
    ).rejects.toThrow()
  })

  it('updatePage stays direct-Prisma (does NOT call domain positioning findMany)', async () => {
    mockPrisma.__mocks.pageFindUnique.mockResolvedValue({ id: 'p1', workspaceId: 'w1' })
    await writer.updatePage({ userId: 'u1', workspaceId: 'w1', pageId: 'p1', title: 'X' })
    // direct update, no sibling-positioning findMany on the create path
    expect(mockPrisma.__mocks.txUpdate).toHaveBeenCalled()
    expect(mockPrisma.__mocks.pageCreate).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter engines test -- page-writer.service`
Expected: FAIL.

- [ ] **Step 3: Rewrite `createPage` + `movePage` in `page-writer.service.ts`**

First, add the domain import. Before (lines 1–9):
```ts
import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { TiptapTransformer } from '@hocuspocus/transformer'
import type { PrismaClient } from '@repo/db'
import { Prisma } from '@repo/db'
import StarterKit from '@tiptap/starter-kit'
import * as Y from 'yjs'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { PageNotFoundError } from '../errors/mcp.errors.js'
```

After:
```ts
import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { TiptapTransformer } from '@hocuspocus/transformer'
import type { PrismaClient } from '@repo/db'
import { Prisma } from '@repo/db'
import * as domain from '@repo/domain'
import StarterKit from '@tiptap/starter-kit'
import * as Y from 'yjs'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { PageNotFoundError } from '../errors/mcp.errors.js'
```

Then replace the `createPage` method. Before (lines 49–78):
```ts
  async createPage(input: CreatePageInput): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      await this.ensureParent(tx, input.parentId, input.workspaceId)
      const contentYjs = input.content === undefined ? undefined : buildContentYjs(input.content)
      const page = await tx.page.create({
        data: {
          workspaceId: input.workspaceId,
          parentId: input.parentId ?? null,
          title: input.title,
          ownership: input.ownership ?? 'TEXT',
          type: 'TEXT',
          content: input.content === undefined ? undefined : (input.content as never),
          contentYjs,
          createdById: input.userId,
          updatedById: input.userId,
        },
        select: { id: true },
      })
      await tx.outboxEvent.create({
        data: {
          eventType: 'page.upserted',
          aggregateType: 'page',
          aggregateId: page.id,
          workspaceId: input.workspaceId,
          payload: {},
        },
      })
      return page.id
    })
  }
```

After:
```ts
  async createPage(input: CreatePageInput): Promise<string> {
    // Delegate to @repo/domain so engines-created pages land in the linked list
    // (positioning gap-fix) and share the outbox path. The domain builds neither the
    // contentYjs bytes nor the Tiptap snapshot, so we still construct contentYjs here
    // (the editor loads from contentYjs) and pass both content + contentYjs through.
    const contentYjs = input.content === undefined ? undefined : buildContentYjs(input.content)
    const result = await domain.createPage(this.prisma, input.userId, {
      workspaceId: input.workspaceId,
      parentId: input.parentId ?? null,
      title: input.title,
      type: 'TEXT',
      ownership: input.ownership ?? 'TEXT',
      content: input.content === undefined ? undefined : (input.content as Prisma.InputJsonValue),
      contentYjs,
    })
    return result.id
  }
```

Then replace the `movePage` method. Before (lines 110–188):
```ts
  async movePage(input: MovePageInput): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // 1. Find the page being moved; validate workspace ownership.
      const page = await tx.page.findUnique({
        where: { id: input.pageId },
        select: { id: true, workspaceId: true, prevPageId: true },
      })
      if (page?.workspaceId !== input.workspaceId) {
        throw new PageNotFoundError(input.pageId)
      }

      // Validate new parent (cross-workspace / soft-deleted check).
      await this.ensureParent(tx, input.newParentId, input.workspaceId)

      // 2. Collapse the old position: find the page currently pointing at the
      //    moved page as predecessor and relink it to moved page's previous
      //    predecessor. Detach first to avoid P2002 on the @unique prevPageId.
      const oldSuccessor = await tx.page.findFirst({
        where: { prevPageId: input.pageId },
        select: { id: true },
      })
      if (oldSuccessor) {
        await tx.page.update({
          where: { id: oldSuccessor.id },
          data: { prevPageId: null },
        })
      }

      // 3. Make room at the new position: the current successor of the new
      //    predecessor must be relinked to the moved page.
      let newSuccessor: { id: string } | null = null
      if (input.prevPageId) {
        newSuccessor = await tx.page.findFirst({
          where: { prevPageId: input.prevPageId, id: { not: input.pageId } },
          select: { id: true },
        })
        if (newSuccessor) {
          await tx.page.update({
            where: { id: newSuccessor.id },
            data: { prevPageId: null },
          })
        }
      }

      // 4. Update the moved page with its new parent + predecessor.
      await tx.page.update({
        where: { id: input.pageId },
        data: {
          parentId: input.newParentId ?? null,
          prevPageId: input.prevPageId ?? null,
          updatedById: input.userId,
        },
      })

      // 5. Finish relinking now that the moved page is out of the way.
      if (oldSuccessor) {
        await tx.page.update({
          where: { id: oldSuccessor.id },
          data: { prevPageId: page.prevPageId ?? null },
        })
      }
      if (newSuccessor) {
        await tx.page.update({
          where: { id: newSuccessor.id },
          data: { prevPageId: input.pageId },
        })
      }

      await tx.outboxEvent.create({
        data: {
          eventType: 'page.upserted',
          aggregateType: 'page',
          aggregateId: input.pageId,
          workspaceId: input.workspaceId,
          payload: {},
        },
      })
    })
  }
```

After:
```ts
  async movePage(input: MovePageInput): Promise<void> {
    // Preserve the engines cross-workspace guard + parent validation, then delegate to
    // domain.reorderPage (which matches this op's prevPageId semantics — closer to tRPC
    // reorder than move) so the agent gets BFS cycle-detection (the gap-fix).
    const page = await this.prisma.page.findUnique({
      where: { id: input.pageId },
      select: { id: true, workspaceId: true },
    })
    if (page?.workspaceId !== input.workspaceId) {
      throw new PageNotFoundError(input.pageId)
    }
    if (input.newParentId) {
      const parent = await this.prisma.page.findUnique({
        where: { id: input.newParentId },
        select: { workspaceId: true, deletedAt: true },
      })
      if (!parent || parent.workspaceId !== input.workspaceId || parent.deletedAt) {
        throw new PageNotFoundError(input.newParentId)
      }
    }
    await domain.reorderPage(this.prisma, input.userId, {
      pageId: input.pageId,
      newParentId: input.newParentId ?? null,
      newPrevPageId: input.prevPageId ?? null,
    })
  }
```

(The `ensureParent` private helper is still used by `createDiagramPage` — verify it is NOT removed. `createPage` no longer calls `ensureParent` directly because the domain does the parent existence/workspace check itself; the engines `createPage` previously also validated cross-workspace parents via `ensureParent`, and the domain `createPage` parent check (`workspaceId: input.workspaceId, deletedAt: null`) is equivalent.)

- [ ] **Step 4: Run tests + check-types**

Run: `pnpm --filter engines test -- page-writer && pnpm --filter engines check-types`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/engines/src/apps/mcp/services/page-writer.service.ts \
        apps/engines/src/apps/mcp/services/page-writer.service.spec.ts
git commit -m "$(cat <<'EOF'
fix(mcp): page-writer createPage + movePage delegate to @repo/domain — gap-fixes

createPage now positions the page in the sibling linked list (was unordered); movePage now
runs BFS cycle-detection (maps prevPageId → reorderPage.newPrevPageId). updatePage/append/
diagram/setArchived stay direct-Prisma. Tool return shapes ({ pageId, url } / { ok }) preserved.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase F — Capstone integration test + verify + close out

### Task 13: Capstone integration test — `pages-domain.e2e.spec.ts`

**Files:**
- Create: `apps/engines/test/integration/pages-domain.e2e.spec.ts`

Mirrors `reminders-domain.e2e.spec.ts` / `kanban-domain.e2e.spec.ts`: seeds real DB rows, constructs `new PageWriter(prisma)`, exercises `createPage`, and asserts (a) the page row exists, (b) it has a linked-list position (either `prevPageId` set to the prior tail, or it is itself the tail/head), and (c) a `page.upserted` `outbox_events` row exists — proving the engines positioning gap-fix end-to-end. Requires docker.

- [ ] **Step 1: Write the integration test**

`apps/engines/test/integration/pages-domain.e2e.spec.ts`:
```ts
import { afterAll, afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import { prisma } from '@repo/db'

import { PageWriter } from '../../src/apps/mcp/services/page-writer.service.js'

/**
 * Proves the engines write path runs end-to-end against a real Postgres:
 *   PageWriter.createPage → @repo/domain → Prisma → DB.
 * This is the only layer that exercises domain.createPage against a live database —
 * unit suites mock Prisma. Requires `docker compose up -d`.
 *
 * Gap-fix validated: engines-created pages now land IN the linked list (have a position)
 * AND a page.upserted outbox row is enqueued.
 */
describe('Pages engines → @repo/domain → DB (integration)', () => {
  const writer = new PageWriter(prisma)

  let workspaceId: string
  let userId: string

  beforeEach(async () => {
    const ws = await prisma.workspace.create({ data: { name: 'pages-domain-int' } })
    workspaceId = ws.id
    const user = await prisma.user.create({
      data: {
        name: 'Page User',
        firstName: 'P',
        lastName: 'U',
        email: `page-${workspaceId}@e.com`,
        emailVerified: true,
      },
    })
    userId = user.id
    await prisma.workspaceMember.create({ data: { workspaceId, userId, role: 'EDITOR' } })
  })

  afterEach(async () => {
    await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined)
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined)
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('createPage positions the second page after the first (linked list) and enqueues page.upserted', async () => {
    const firstId = await writer.createPage({
      userId,
      workspaceId,
      parentId: null,
      title: 'First',
    })
    const secondId = await writer.createPage({
      userId,
      workspaceId,
      parentId: null,
      title: 'Second',
    })

    expect(typeof firstId).toBe('string')
    expect(typeof secondId).toBe('string')

    const first = await prisma.page.findUniqueOrThrow({ where: { id: firstId } })
    const second = await prisma.page.findUniqueOrThrow({ where: { id: secondId } })

    // The first page is the head (no predecessor). The second page must be positioned
    // in the list — its prevPageId points at the first (the prior tail). This is the gap-fix:
    // before delegation, engines-created pages had prevPageId == null (unordered).
    expect(first.prevPageId).toBeNull()
    expect(second.prevPageId).toBe(firstId)

    // A page.upserted outbox row exists for the created page.
    const outbox = await prisma.outboxEvent.findMany({
      where: { eventType: 'page.upserted', aggregateType: 'page', aggregateId: secondId },
    })
    expect(outbox.length).toBeGreaterThanOrEqual(1)
  })
})
```

- [ ] **Step 2: Run the integration test**

Run: `docker compose up -d && pnpm --filter engines test-int -- pages-domain`
Expected: PASS — `second.prevPageId === firstId` (positioning gap-fix proven) and the `page.upserted` outbox row exists.

- [ ] **Step 3: Commit**

```bash
git add apps/engines/test/integration/pages-domain.e2e.spec.ts
git commit -m "$(cat <<'EOF'
test(domain): capstone integration test — pages engines→domain→DB positioning gap-fix

Asserts the second engines-created page lands in the linked list (prevPageId == first page)
and a page.upserted outbox row is enqueued, proving the positioning fix end-to-end on Postgres.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Full gates + drift-guard + spec status

**Files:**
- Modify: `apps/web/test/agents-token.test.ts` (read + verify only — no edits expected)
- Modify: `docs/superpowers/specs/2026-05-29-domain-pages-design.md`

- [ ] **Step 1: Verify `agents-token.test.ts` drift-guard is still satisfied**

Run: `pnpm --filter web test -- agents-token`
Expected: PASS — **no new scopes, no new MCP tools** were added. Page scopes (`pages:read` / `pages:write` / `pages:delete`) already exist; this cycle only changes service internals. No edits to this test file are needed.

- [ ] **Step 2: Clean `.next/types` if stale**

If `pnpm --filter web check-types` reports `TS2307 'cannot find module .../route.js'` for a deleted route, run:
```bash
rm -rf apps/web/.next/types
```
Then re-run check-types. (Known stale-artifact lesson — not a real break.)

- [ ] **Step 3: Full gates**

Run: `pnpm gates`
Expected: check-types + lint + build + test all PASS. `@repo/domain` builds first via turbo `^build` because `@repo/trpc` and `apps/engines` both declare it as a dependency.

- [ ] **Step 4: Mark spec implemented**

In `docs/superpowers/specs/2026-05-29-domain-pages-design.md`, change:
```
**Status:** Draft, awaiting user review
```
to:
```
**Status:** Implemented
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-05-29-domain-pages-design.md
git commit -m "$(cat <<'EOF'
chore(domain): SP3 gates green — mark pages spec implemented

pnpm gates clean. agents-token drift-guard passes (no new scopes, no new MCP tools).
All 10 page write mutations now route through @repo/domain; engines createPage/movePage
gap-fixes (positioning + cycle-detection) validated by the capstone integration test.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Tasks 1–9 (domain): all 10 functions extracted into `packages/domain/src/pages/` (`schemas.ts`, `ordering.ts`, `functions.ts`, `index.ts`); `seedKanbanDefaults` moved into `domain/kanban/seed.ts` and re-exported from tRPC `kanban/helpers.ts`. Cycle-detection (ancestor walk for `move`, BFS for `reorder`) ported verbatim into `ordering.ts`; recursive descendant BFS in `softDelete`/`restore` ported verbatim. Outbox enqueued via **direct `enqueueOutboxEvent(tx, …)` import** — no Port. ✔
- Tasks 10–11 (tRPC): all 10 procedures → thin `mapDomain(() => domain.<fn>(ctx.prisma, ctx.user.id, input))` wrappers; `requireWritableWorkspace` + membership/access pre-checks retained where needed to resolve `workspaceId` for the plan gate; ownership/OWNER guards that were procedure-body logic moved into the domain. Reads + favorites untouched. Return shapes (`{ id }`, `{ id, title, icon, updatedAt }`, `{ count }`) preserved exactly. ✔
- Task 12 (engines): ONLY `createPage` + `movePage` delegate. `createPage` → `domain.createPage` (adds list-positioning; passes `content` + `contentYjs` built via `buildContentYjs`); `movePage` → `domain.reorderPage` (adds BFS cycle-detection; maps `prevPageId` → `newPrevPageId`; preserves the engines cross-workspace guard + parent validation as a pre-step). `updatePage`/`appendContent`/`setArchived`/`createDiagramPage`/`updateDiagramSource`/`ensureParent` stay direct-Prisma. Tool return shapes (`{ pageId, url }` / `{ ok: true }`) preserved. ✔
- Task 13: capstone integration test proves the engines positioning gap-fix + outbox enqueue end-to-end against live Postgres. ✔
- Task 14: full gates + drift-guard verified; **no new scopes, no new MCP tools, no `tool_registry.py`/`agents-token.ts`/`mcp.module.ts` changes**. ✔

**Lessons baked in (SP1/SP2 execution):**
1. engines spec uses real-domain + mocked-Prisma (`new PageWriter(mockPrisma)`); NO `jest.unstable_mockModule`. ✔ (Task 12 Step 1)
2. Public domain fns use `actorUserId`; internal `assertPageAccess`/`assertPageOwnership` (from `domain/kanban/access.ts`) take `userId`. ✔
3. Domain throws `DomainError` (`notFound`/`forbidden`/`badRequest`) — all error tests assert `rejects.toBeInstanceOf(DomainError)`. ✔
4. Atomic multi-step ops use `tx.*` inside `prisma.$transaction(async (tx) => …)`; the outbox enqueue is called with `tx`. `$transaction` mocks pass a `tx` exposing every method the fn calls (`page.create/findFirst/findMany/update/updateMany/delete`, `outboxEvent.create`, kanban `createMany`). ✔
5. `noUncheckedIndexedAccess` handled: `__mocks` typed precisely per fixture; `mock.calls[0]?.[0]` tuple access guarded with `?.`. ✔
6. Domain modules: explicit `.ts` import extensions; import only `@repo/db` + `zod` + sibling `.ts` (the outbox helper + `Prisma`/`PageType` types come from `@repo/db`). ✔
7. Every Modify step shows exact verbatim before/after (no cross-references). ✔

**Type/name consistency:** domain fn names `createPage`, `renamePage`, `updatePage`, `duplicatePage`, `movePage`, `reorderPage`, `softDeletePage`, `restorePage`, `hardDeletePage`, `emptyTrash` — used identically in tRPC wrappers, engines service, and the domain barrel. Schemas exported as `createPageInput`…`emptyTrashInput`. `mapDomain`, `domain.*`, and `seedKanbanDefaults` imports already present in `page.ts` (lines 12–14).

**Return-shape audit:**
- `createPage` → `{ id }` ✔ (tRPC `{ id }`; engines `.id` → string)
- `renamePage` / `updatePage` → `{ id, title, icon, updatedAt }` ✔
- `duplicatePage` → `{ id }` ✔
- `movePage` (domain) → `{ id }`; tRPC returns it directly; engines `movePage` returns `void` (delegates to `reorderPage`, discards result) ✔
- `reorderPage` → `{ id }` ✔
- `softDeletePage` / `restorePage` / `hardDeletePage` → `{ id }` ✔
- `emptyTrash` → `{ count }` ✔
- engines `createPage` → `string` (`.id`); tool `{ pageId, url }` preserved ✔
- engines `movePage` → `void`; tool `{ ok: true }` preserved ✔

**Placeholder scan:** none — every step has complete verbatim code; every Modify step shows exact before/after.

---

## Notes for the executor

- **Build the domain after Task 9.** `pnpm --filter @repo/domain build` must run before `@repo/trpc`/engines `check-types` resolve the new `domain.*pageInput` schemas + functions locally. Tasks 2, 9, and 14 include explicit build steps; CI handles it via turbo `^build`.
- **Single `functions.ts`, grown incrementally.** Tasks 3–9 all append to `packages/domain/src/pages/functions.ts` and edit its import block. Each task's "Before/After" for the import block is exact — apply them in order. The test file `packages/domain/test/pages/functions.test.ts` likewise grows by appended `describe` blocks (Task 3 creates it; 4–9 append). Per-task imports at the top of the test file accumulate (`createPage`, then `renamePage, updatePage`, etc.); keep each `import { … } from '../../src/pages/functions.ts'` line — Vitest tolerates multiple imports from the same module, but you may consolidate them into one import line at the top if lint prefers it.
- **`seedKanbanDefaults` has exactly one production caller** — `page.create` (now `domain.createPage`). Verified: the only other match is a stale `.next` build map. The tRPC `kanban/helpers.ts` re-export keeps any future caller working; do not delete that re-export.
- **The engines class is `PageWriter`** (file `page-writer.service.ts`), constructed `new PageWriter(prisma)` — not `PageWriterService`. The integration + unit specs both use `PageWriter`.
- **engines `movePage` maps to `domain.reorderPage`, NOT `domain.movePage`.** This is the load-bearing decision: engines `movePage` carries an explicit `prevPageId` (insert-after semantics) matching tRPC `reorder`; tRPC `move` is head-insert only (no prev). Mapping to `movePage` would silently drop `prevPageId` and change ordering behavior. The pre-step (cross-workspace `workspaceId` guard + parent validation) is preserved because the domain `reorderPage` checks **membership** (FORBIDDEN), not the engines cross-workspace `PageNotFoundError`.
- **engines `createPage` passes both `content` and `contentYjs`.** The domain `createPage` forwards them to `tx.page.create` but does NOT build `contentYjs` from a Tiptap doc — so the service still calls `buildContentYjs(content)` and passes the bytes. Without this the editor renders empty (the `y-excalidraw`/`contentYjs` lesson).
- **Ownership/membership checks moved into the domain** for `rename`/`update`/`softDelete`/`restore`/`hardDelete` (`assertPageOwnership`) and `emptyTrash` (inlined OWNER guard) and `reorder` (inlined membership FORBIDDEN). The tRPC wrappers keep `requireWritableWorkspace` (the plan/billing gate — a caller concern per the spec) plus a minimal `assertPageAccess`/page lookup only where needed to resolve `workspaceId`. The page-router regression suite is the guard that error codes/messages are unchanged.
- **`reorderPage` membership check is inlined as FORBIDDEN**, not delegated to `assertPageAccess` (which throws NOT_FOUND). This preserves the exact tRPC `assertWorkspaceMember` → FORBIDDEN semantics. The BFS cycle-check runs on the outer `prisma` (matching the tRPC original, which used `ctx.prisma` outside the transaction).
- **Conventional Commits with scope** at every step: `feat(domain)`, `refactor(domain)`, `refactor(trpc)`, `fix(mcp)`, `test(domain)`, `chore(domain)`. Husky runs lint-staged + gates on commit — run `pnpm lint` if the hook fails before re-trying. No `--no-verify`.
- **Recommended task order:** 1 → 2 → 3 → 4 → 5 (Cluster A complete) → 6 → 7 (Cluster B) → 8 → 9 (Cluster C, domain green + exported) → 10 → 11 (tRPC wiring; page-router regression suite green) → 12 (engines) → 13 (capstone) → 14 (verify). Domain (1–9) is independently green before any consumer changes.
