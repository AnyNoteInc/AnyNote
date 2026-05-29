# `@repo/domain` SP2 — Notifications + Favorites + Reminders — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the write business-logic for Notifications, Favorites, and Reminders into `@repo/domain`, then refactor both consumers — `@repo/trpc` procedures and `apps/engines` MCP services — to call the single domain implementation. This collapses duplicated/divergent logic into one source of truth, adds the missing `markAllRead` and `reorderFavorites` MCP tools, and **fixes the delivery bug** where engines reminder writes never scheduled `notificationDelivery` rows.

**Architecture:** Same pattern as SP1: domain functions are `fn(prisma, actorUserId, input) → result`. Reminders add a Port (`DeliveryScheduler`) so scheduling stays inside the domain transaction without importing `@repo/notifications`. tRPC and engines both inject the real scheduler; tests inject a fake. Reads stay direct-Prisma in each consumer.

**Tech Stack:** TypeScript NodeNext (`@repo/domain`), Prisma 7 (`@repo/db`), Zod, tRPC v11 (`@repo/trpc`), NestJS + `@rekog/mcp-nest` (engines), Vitest (domain/trpc) + Jest (engines).

**Spec:** [docs/superpowers/specs/2026-05-29-domain-notifications-favorites-reminders-design.md](docs/superpowers/specs/2026-05-29-domain-notifications-favorites-reminders-design.md)

**Conventions:**
- `@repo/domain` & consumers: relative imports use **explicit `.ts` extensions**, matching `@repo/db`. Prettier: no semicolons, single quotes, 100-width.
- Domain functions: never import `@repo/auth` / `@repo/ui` / `@repo/notifications` / `@trpc/server` / event buses. They take `prisma` + `actorUserId` + typed input, return data, throw `DomainError`.
- Commit per task; end body with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. No `--no-verify`.
- Domain tests: `pnpm --filter @repo/domain test`. tRPC: `pnpm --filter @repo/trpc test`. engines: `pnpm --filter engines test`.

---

## Phase A — Spike: validate `@repo/notifications` import compatibility

### Task 1: Spike — verify engines can import `@repo/notifications` root export

**Files:**
- Modify (temporarily): `apps/engines/src/apps/mcp/services/reminder.service.ts`

- [ ] **Step 1: Add a throwaway import to `reminder.service.ts`**

At the very top of `apps/engines/src/apps/mcp/services/reminder.service.ts`, after the existing imports, add these two lines:

```ts
import { rebuildDeliveries, cancelPendingDeliveries } from '@repo/notifications'
void rebuildDeliveries; void cancelPendingDeliveries
```

The file before the addition opens with:
```ts
import { Inject, Injectable } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { PageNotFoundError, ReminderNotFoundError } from '../errors/mcp.errors.js'
```

Add the two throwaway lines immediately after those existing imports.

- [ ] **Step 2: Run `pnpm --filter engines check-types`**

Expected outcome A (clean): proceed — the import works under engines NodeNext. Document `SPIKE RESULT: OK` as a comment in the commit message.

Expected outcome B (TS2835 or resolution error): follow the fallback sub-steps below, then re-run until clean.

**Fallback sub-steps (only if outcome B):**

Check `packages/notifications/tsconfig.json` — if `moduleResolution` is not `NodeNext`, update it to match `@repo/db`'s tsconfig (`"module": "NodeNext"`, `"moduleResolution": "NodeNext"`). Also add explicit `.ts` extensions to all relative imports inside `packages/notifications/src/` (run `grep -rn "from '\./\|from '\.\."` to find them). Re-run `pnpm --filter @repo/notifications check-types` first. Then re-run `pnpm --filter engines check-types`.

- [ ] **Step 3: Revert the throwaway lines**

Remove the two `import`/`void` lines added in Step 1 from `reminder.service.ts`. The file must be identical to its pre-spike state.

- [ ] **Step 4: Commit**

```bash
git add apps/engines/src/apps/mcp/services/reminder.service.ts
git commit -m "$(cat <<'EOF'
chore(domain): spike — validate @repo/notifications import under engines NodeNext (SPIKE RESULT: OK)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

(If the fallback was needed, include modified `packages/notifications/` files in the commit and note `SPIKE RESULT: fixed notifications tsconfig` in the message.)

---

## Phase B — Notifications domain module + tRPC + engines

### Task 2: `packages/domain/src/notifications/{schemas,functions,index}.ts` + tests

**Files:**
- Create: `packages/domain/src/notifications/schemas.ts`
- Create: `packages/domain/src/notifications/functions.ts`
- Create: `packages/domain/src/notifications/index.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `packages/domain/test/notifications/functions.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/domain/test/notifications/functions.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { PrismaClient } from '@repo/db'

import { deleteAll, markAllRead, markRead } from '../../src/notifications/functions.ts'

describe('domain notifications', () => {
  const updateMany = vi.fn()
  const deleteMany = vi.fn()
  const prisma = {
    notificationInApp: { updateMany, deleteMany },
  } as unknown as PrismaClient

  beforeEach(() => vi.clearAllMocks())

  it('markRead calls updateMany with ids filter and readAt', async () => {
    updateMany.mockResolvedValue({ count: 2 })
    const result = await markRead(prisma, 'u1', { ids: ['id1', 'id2'] })
    expect(result).toEqual({ updated: 2 })
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', id: { in: ['id1', 'id2'] }, readAt: null },
      data: { readAt: expect.any(Date) },
    })
  })

  it('markAllRead calls updateMany without id filter', async () => {
    updateMany.mockResolvedValue({ count: 5 })
    const result = await markAllRead(prisma, 'u1')
    expect(result).toEqual({ updated: 5 })
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', readAt: null },
      data: { readAt: expect.any(Date) },
    })
  })

  it('deleteAll calls deleteMany and returns deleted count', async () => {
    deleteMany.mockResolvedValue({ count: 3 })
    const result = await deleteAll(prisma, 'u1')
    expect(result).toEqual({ deleted: 3 })
    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } })
  })

  it('markRead throws for empty ids array', async () => {
    await expect(markRead(prisma, 'u1', { ids: [] })).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/domain test -- notifications`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement `schemas.ts`**

`packages/domain/src/notifications/schemas.ts`:
```ts
import { z } from 'zod'

export const markReadInput = z.object({
  ids: z.array(z.string().uuid()).min(1).max(50),
})
export type MarkReadInput = z.infer<typeof markReadInput>
```

- [ ] **Step 4: Implement `functions.ts`**

`packages/domain/src/notifications/functions.ts`:
```ts
import type { PrismaClient } from '@repo/db'

import type { MarkReadInput } from './schemas.ts'

export async function markRead(
  prisma: PrismaClient,
  userId: string,
  input: MarkReadInput,
): Promise<{ updated: number }> {
  // markReadInput validates min(1) — parse defensively so the domain is self-protecting
  if (input.ids.length === 0) throw new Error('ids must not be empty')
  const result = await prisma.notificationInApp.updateMany({
    where: { userId, id: { in: input.ids }, readAt: null },
    data: { readAt: new Date() },
  })
  return { updated: result.count }
}

export async function markAllRead(
  prisma: PrismaClient,
  userId: string,
): Promise<{ updated: number }> {
  const result = await prisma.notificationInApp.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  })
  return { updated: result.count }
}

export async function deleteAll(
  prisma: PrismaClient,
  userId: string,
): Promise<{ deleted: number }> {
  const result = await prisma.notificationInApp.deleteMany({
    where: { userId },
  })
  return { deleted: result.count }
}
```

- [ ] **Step 5: Create `notifications/index.ts` barrel**

`packages/domain/src/notifications/index.ts`:
```ts
export * from './functions.ts'
export * from './schemas.ts'
```

- [ ] **Step 6: Update `packages/domain/src/index.ts`**

Before (current content):
```ts
export * from './errors.ts'
export * from './kanban/index.ts'
```

After:
```ts
export * from './errors.ts'
export * from './kanban/index.ts'
export * from './notifications/index.ts'
```

- [ ] **Step 7: Run tests + check-types**

Run: `pnpm --filter @repo/domain test && pnpm --filter @repo/domain check-types`
Expected: PASS, clean.

- [ ] **Step 8: Commit**

```bash
git add packages/domain/src/notifications packages/domain/src/index.ts packages/domain/test/notifications
git commit -m "$(cat <<'EOF'
feat(domain): add notifications domain module (markRead/markAllRead/deleteAll)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: tRPC `notification.ts` — migrate three mutations to domain wrappers

**Files:**
- Modify: `packages/trpc/src/routers/notification.ts`

The full current content of `packages/trpc/src/routers/notification.ts` is 214 lines. Only the three mutations `markRead`, `markAllRead`, `deleteAll` change. The remaining procedures (`list`, `unreadCount`, `getPreferences`, `setPreference`, `listPushSubscriptions`, `registerPushSubscription`, `revokePushSubscription`) are **completely untouched**.

- [ ] **Step 1: Add domain imports to `notification.ts`**

In `packages/trpc/src/routers/notification.ts`, change the imports block.

Before (lines 1–7):
```ts
import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { NotificationCategory, NotificationChannel } from '@repo/db'
import { EVENT_CATALOG } from '@repo/notifications'

import { router, protectedProcedure } from '../trpc'
```

After:
```ts
import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { NotificationCategory, NotificationChannel } from '@repo/db'
import { EVENT_CATALOG } from '@repo/notifications'
import * as domain from '@repo/domain'
import { mapDomain } from '../helpers/map-domain'

import { router, protectedProcedure } from '../trpc'
```

- [ ] **Step 2: Replace `markRead` procedure**

Before:
```ts
  markRead: protectedProcedure
    .input(z.object({ ids: z.array(z.string().uuid()).min(1).max(50) }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.prisma.notificationInApp.updateMany({
        where: { userId: ctx.user.id, id: { in: input.ids }, readAt: null },
        data: { readAt: new Date() },
      })
      return { updated: result.count }
    }),
```

After:
```ts
  markRead: protectedProcedure
    .input(domain.markReadInput)
    .mutation(async ({ ctx, input }) => {
      return mapDomain(() => domain.markRead(ctx.prisma, ctx.user.id, input))
    }),
```

- [ ] **Step 3: Replace `markAllRead` procedure**

Before:
```ts
  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    const result = await ctx.prisma.notificationInApp.updateMany({
      where: { userId: ctx.user.id, readAt: null },
      data: { readAt: new Date() },
    })
    return { updated: result.count }
  }),
```

After:
```ts
  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    return mapDomain(() => domain.markAllRead(ctx.prisma, ctx.user.id))
  }),
```

- [ ] **Step 4: Replace `deleteAll` procedure**

Before:
```ts
  deleteAll: protectedProcedure.mutation(async ({ ctx }) => {
    const result = await ctx.prisma.notificationInApp.deleteMany({
      where: { userId: ctx.user.id },
    })
    return { deleted: result.count }
  }),
```

After:
```ts
  deleteAll: protectedProcedure.mutation(async ({ ctx }) => {
    return mapDomain(() => domain.deleteAll(ctx.prisma, ctx.user.id))
  }),
```

- [ ] **Step 5: Run tRPC tests + check-types**

Run: `pnpm --filter @repo/trpc test && pnpm --filter @repo/trpc check-types`
Expected: PASS. The existing notification/procedure tests are the regression guard; return shapes match exactly (`{ updated: number }` / `{ deleted: number }`).

- [ ] **Step 6: Commit**

```bash
git add packages/trpc/src/routers/notification.ts
git commit -m "$(cat <<'EOF'
refactor(trpc): notification markRead/markAllRead/deleteAll delegate to @repo/domain

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: engines `NotificationService` delegates to domain + add `markAllRead` tool

**Files:**
- Modify: `apps/engines/src/apps/mcp/services/notification.service.ts`
- Modify: `apps/engines/src/apps/mcp/tools/notification.tools.ts`
- Modify: `apps/agents/agents/apps/agent/services/tool_registry.py`
- Create: `apps/engines/src/apps/mcp/services/notification.service.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/engines/src/apps/mcp/services/notification.service.spec.ts`:
```ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'

// SP1 pattern: NO jest.unstable_mockModule. Import the service normally and build a
// hand-mocked PrismaClient. The REAL @repo/domain functions run against the mock prisma,
// so we assert on mocked prisma calls + returned values directly.
import { NotificationService } from './notification.service.js'

function makeMockPrisma() {
  const updateMany = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ count: 0 }))
  const deleteMany = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ count: 0 }))
  const findMany = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => [])
  return {
    notificationInApp: { updateMany, deleteMany, findMany },
    __mocks: { updateMany, deleteMany, findMany },
  } as unknown as PrismaClient & { __mocks: Record<string, ReturnType<typeof jest.fn>> }
}

describe('NotificationService', () => {
  let mockPrisma: ReturnType<typeof makeMockPrisma>
  let svc: NotificationService

  beforeEach(() => {
    jest.clearAllMocks()
    mockPrisma = makeMockPrisma()
    svc = new NotificationService(mockPrisma)
  })

  it('markRead(ids) calls notificationInApp.updateMany with ids filter and returns { count }', async () => {
    mockPrisma.__mocks.updateMany.mockResolvedValue({ count: 2 })
    const result = await svc.markRead({ userId: 'u1', ids: ['id1', 'id2'] })
    expect(mockPrisma.__mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'u1', id: { in: ['id1', 'id2'] } }),
      }),
    )
    expect(result).toEqual({ count: 2 })
  })

  it('markRead(all:true) calls notificationInApp.updateMany without id filter and returns { count }', async () => {
    mockPrisma.__mocks.updateMany.mockResolvedValue({ count: 5 })
    const result = await svc.markRead({ userId: 'u1', all: true })
    const call = mockPrisma.__mocks.updateMany.mock.calls[0][0] as { where: Record<string, unknown> }
    expect(call.where).not.toHaveProperty('id')
    expect(call.where).toMatchObject({ userId: 'u1', readAt: null })
    expect(result).toEqual({ count: 5 })
  })

  it('list uses direct Prisma findMany', async () => {
    mockPrisma.__mocks.findMany.mockResolvedValue([])
    await svc.list({ userId: 'u1', unreadOnly: true, limit: 10 })
    expect(mockPrisma.__mocks.findMany).toHaveBeenCalled()
    expect(mockPrisma.__mocks.updateMany).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter engines test -- notification.service`
Expected: FAIL.

- [ ] **Step 3: Rewrite `notification.service.ts`**

Full new content of `apps/engines/src/apps/mcp/services/notification.service.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'
import * as domain from '@repo/domain'

import { PRISMA } from '../../../infra/db/db.providers.js'

export type ListNotificationsInput = { userId: string; unreadOnly: boolean; limit: number }
export type MarkReadInput = { userId: string; all?: boolean; ids?: string[] }

@Injectable()
export class NotificationService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async list(input: ListNotificationsInput) {
    const rows = await this.prisma.notificationInApp.findMany({
      where: { userId: input.userId, ...(input.unreadOnly ? { readAt: null } : {}) },
      select: {
        id: true,
        readAt: true,
        createdAt: true,
        event: { select: { type: true, category: true, resourceUrl: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: input.limit,
    })
    return rows.map((r) => ({
      id: r.id,
      type: r.event.type,
      category: r.event.category,
      resourceUrl: r.event.resourceUrl,
      read: r.readAt != null,
      createdAt: r.createdAt,
    }))
  }

  async markRead(input: MarkReadInput): Promise<{ count: number }> {
    if (input.all) {
      const result = await domain.markAllRead(this.prisma, input.userId)
      return { count: result.updated }
    }
    const result = await domain.markRead(this.prisma, input.userId, { ids: input.ids ?? [] })
    return { count: result.updated }
  }
}
```

- [ ] **Step 4: Add `markAllRead` tool to `notification.tools.ts`**

Full new content of `apps/engines/src/apps/mcp/tools/notification.tools.ts`:
```ts
import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common'
import type { Context } from '@rekog/mcp-nest'
import { Tool } from '@rekog/mcp-nest'
import { z } from 'zod'

import type { AuthContext, AuthedRequest } from '../../api/auth/auth-context.js'
import { NotificationService } from '../services/notification.service.js'
import { mcpInput } from '../utils/mcp-input.js'

const ListNotificationsInput = z.object({
  unreadOnly: mcpInput(z.boolean().default(true)),
  limit: mcpInput(z.number().int().positive().max(100).default(50)),
})
const MarkReadInput = z.object({
  all: mcpInput(z.boolean().optional()),
  ids: mcpInput(z.array(z.string().uuid()).optional()),
})
const MarkAllReadInput = z.object({})

type ListNotificationsArgs = z.infer<typeof ListNotificationsInput>
type MarkReadArgs = z.infer<typeof MarkReadInput>

function requireAuth(req: AuthedRequest | undefined): AuthContext {
  if (!req?.auth) throw new UnauthorizedException('Unauthenticated MCP request')
  return req.auth
}

@Injectable()
export class NotificationTools {
  constructor(private readonly notifications: NotificationService) {}

  @Tool({
    name: 'listNotifications',
    description:
      'Список уведомлений пользователя (по всем пространствам). По умолчанию только ' +
      'непрочитанные. Возвращает id, type, category, resourceUrl, read, createdAt. ' +
      'Используй для "покажи мне уведомления". Параметры: unreadOnly (def true), limit (def 50).',
    parameters: ListNotificationsInput,
  })
  async listNotifications(args: ListNotificationsArgs, _context: Context, req: AuthedRequest) {
    const auth = requireAuth(req)
    const notifications = await this.notifications.list({
      userId: auth.userId,
      unreadOnly: args.unreadOnly,
      limit: args.limit,
    })
    return { notifications }
  }

  @Tool({
    name: 'markNotificationsRead',
    description:
      'Помечает уведомления прочитанными. Укажи all:true (все) или ids[] (конкретные). ' +
      'Используй для "прочитай все уведомления". Параметры: all?, ids?.',
    parameters: MarkReadInput,
  })
  async markNotificationsRead(args: MarkReadArgs, _context: Context, req: AuthedRequest) {
    const auth = requireAuth(req)
    if (args.all !== true && (args.ids?.length ?? 0) === 0) {
      throw new BadRequestException('Provide all:true or a non-empty ids array')
    }
    return this.notifications.markRead({ userId: auth.userId, all: args.all, ids: args.ids })
  }

  @Tool({
    name: 'markAllNotificationsRead',
    description:
      'Помечает все уведомления пользователя прочитанными одним вызовом. ' +
      'Используй когда агент хочет «отметить все как прочитанные» без перечисления ids. ' +
      'Требует подтверждения. Параметры: нет.',
    parameters: MarkAllReadInput,
  })
  async markAllNotificationsRead(_args: Record<string, never>, _context: Context, req: AuthedRequest) {
    const auth = requireAuth(req)
    return this.notifications.markRead({ userId: auth.userId, all: true })
  }
}
```

- [ ] **Step 5: Add `markAllNotificationsRead` to `tool_registry.py`**

In `apps/agents/agents/apps/agent/services/tool_registry.py`, add a new entry to `DEFAULT_ENGINES_TOOLS` after the existing `markNotificationsRead` entry.

Before:
```python
    'markNotificationsRead': ToolMeta('markNotificationsRead', SCOPE_NOTIFICATIONS_WRITE, False,
                                       _summary_generic('markNotificationsRead'), _preview_default),
```

After:
```python
    'markNotificationsRead': ToolMeta('markNotificationsRead', SCOPE_NOTIFICATIONS_WRITE, False,
                                       _summary_generic('markNotificationsRead'), _preview_default),
    'markAllNotificationsRead': ToolMeta('markAllNotificationsRead', SCOPE_NOTIFICATIONS_WRITE, True,
                                          lambda a: 'Отметить все уведомления прочитанными', _preview_default),
```

- [ ] **Step 6: Run tests + check-types**

Run: `pnpm --filter engines test -- notification && pnpm --filter engines check-types`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/engines/src/apps/mcp/services/notification.service.ts \
        apps/engines/src/apps/mcp/services/notification.service.spec.ts \
        apps/engines/src/apps/mcp/tools/notification.tools.ts \
        apps/agents/agents/apps/agent/services/tool_registry.py
git commit -m "$(cat <<'EOF'
feat(mcp): notification service delegates to domain; add markAllNotificationsRead tool

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase C — Favorites domain module + tRPC + engines

### Task 5: `packages/domain/src/favorites/{schemas,functions,index}.ts` + tests

**Files:**
- Create: `packages/domain/src/favorites/schemas.ts`
- Create: `packages/domain/src/favorites/functions.ts`
- Create: `packages/domain/src/favorites/index.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `packages/domain/test/favorites/functions.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/domain/test/favorites/functions.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { PrismaClient } from '@repo/db'

import { DomainError } from '../../src/errors.ts'
import { addFavorite, removeFavorite, reorderFavorites } from '../../src/favorites/functions.ts'

function makePrisma(overrides: Record<string, unknown> = {}) {
  const aggregate = vi.fn(async () => ({ _max: { position: null } }))
  const upsert = vi.fn(async () => ({ userId: 'u1', pageId: 'p1', position: 0 }))
  const deleteMany = vi.fn(async () => ({ count: 1 }))
  const findFirst = vi.fn(async () => ({ id: 'p1', workspaceId: 'w1', createdById: 'u1' }))
  const findUnique = vi.fn(async () => ({ workspaceId: 'w1', userId: 'u1', role: 'EDITOR' as const }))
  const updateMany = vi.fn(async () => ({ count: 1 }))
  const $transaction = vi.fn(async (fns: unknown) => {
    if (Array.isArray(fns)) return Promise.all(fns)
    if (typeof fns === 'function') return fns({ favoritePage: { updateMany }, workspaceMember: { findUnique } })
    return fns
  })
  return {
    page: { findFirst },
    workspaceMember: { findUnique },
    favoritePage: { aggregate, upsert, deleteMany, updateMany },
    $transaction,
    __mocks: { aggregate, upsert, deleteMany, findFirst, findUnique, updateMany, $transaction },
    ...overrides,
  } as unknown as PrismaClient & { __mocks: Record<string, ReturnType<typeof vi.fn>> }
}

describe('domain favorites', () => {
  beforeEach(() => vi.clearAllMocks())

  it('addFavorite: first favorite gets position 0 (tRPC rule: (_max ?? -1)+1)', async () => {
    const prisma = makePrisma()
    await addFavorite(prisma, 'u1', { pageId: 'p1' })
    const { upsert } = (prisma as unknown as { __mocks: Record<string, ReturnType<typeof vi.fn>> }).__mocks
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ position: 0 }) }),
    )
  })

  it('addFavorite: subsequent favorite gets position max+1', async () => {
    const prisma = makePrisma()
    ;(prisma as unknown as { __mocks: Record<string, ReturnType<typeof vi.fn>> }).__mocks.aggregate.mockResolvedValue({ _max: { position: 3 } })
    await addFavorite(prisma, 'u1', { pageId: 'p1' })
    const { upsert } = (prisma as unknown as { __mocks: Record<string, ReturnType<typeof vi.fn>> }).__mocks
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ position: 4 }) }),
    )
  })

  it('addFavorite: throws NOT_FOUND when page is inaccessible', async () => {
    const prisma = makePrisma()
    ;(prisma as unknown as { __mocks: Record<string, ReturnType<typeof vi.fn>> }).__mocks.findFirst.mockResolvedValue(null)
    await expect(addFavorite(prisma, 'u1', { pageId: 'p1' })).rejects.toBeInstanceOf(DomainError)
  })

  it('removeFavorite: calls favoritePage.deleteMany and returns { count: 1 }', async () => {
    const prisma = makePrisma()
    const result = await removeFavorite(prisma, 'u1', { pageId: 'p1' })
    const { deleteMany } = (prisma as unknown as { __mocks: Record<string, ReturnType<typeof vi.fn>> }).__mocks
    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1', pageId: 'p1' } })
    expect(result).toEqual({ count: 1 })
  })

  it('removeFavorite: does NOT call assertPageAccess (no page.findFirst)', async () => {
    const prisma = makePrisma()
    await removeFavorite(prisma, 'u1', { pageId: 'p1' })
    const { findFirst } = (prisma as unknown as { __mocks: Record<string, ReturnType<typeof vi.fn>> }).__mocks
    expect(findFirst).not.toHaveBeenCalled()
  })

  it('reorderFavorites: throws FORBIDDEN when not a member', async () => {
    const prisma = makePrisma()
    ;(prisma as unknown as { __mocks: Record<string, ReturnType<typeof vi.fn>> }).__mocks.findUnique.mockResolvedValue(null)
    await expect(reorderFavorites(prisma, 'u1', { workspaceId: 'w1', orderedIds: ['p1'] })).rejects.toBeInstanceOf(DomainError)
  })

  it('reorderFavorites: dispatches one updateMany per id with 0-based index', async () => {
    const prisma = makePrisma()
    await reorderFavorites(prisma, 'u1', { workspaceId: 'w1', orderedIds: ['p1', 'p2'] })
    const { $transaction } = (prisma as unknown as { __mocks: Record<string, ReturnType<typeof vi.fn>> }).__mocks
    expect($transaction).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/domain test -- favorites`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement `schemas.ts`**

`packages/domain/src/favorites/schemas.ts`:
```ts
import { z } from 'zod'

export const addFavoriteInput = z.object({
  pageId: z.string().uuid(),
})
export type AddFavoriteInput = z.infer<typeof addFavoriteInput>

export const removeFavoriteInput = z.object({
  pageId: z.string().uuid(),
})
export type RemoveFavoriteInput = z.infer<typeof removeFavoriteInput>

export const reorderFavoritesInput = z.object({
  workspaceId: z.string().uuid(),
  orderedIds: z.array(z.string().uuid()),
})
export type ReorderFavoritesInput = z.infer<typeof reorderFavoritesInput>
```

- [ ] **Step 4: Implement `functions.ts`**

`packages/domain/src/favorites/functions.ts`:
```ts
import type { PrismaClient } from '@repo/db'

import { forbidden, notFound } from '../errors.ts'
import type { AddFavoriteInput, RemoveFavoriteInput, ReorderFavoritesInput } from './schemas.ts'

async function assertPageAccess(prisma: PrismaClient, userId: string, pageId: string) {
  const page = await prisma.page.findFirst({
    where: { id: pageId, workspace: { members: { some: { userId } } } },
  })
  if (!page) throw notFound('Страница не найдена')
  return page
}

export async function addFavorite(
  prisma: PrismaClient,
  userId: string,
  input: AddFavoriteInput,
) {
  await assertPageAccess(prisma, userId, input.pageId)
  return prisma.$transaction(async (tx) => {
    const maxResult = await tx.favoritePage.aggregate({
      where: { userId },
      _max: { position: true },
    })
    const nextPosition = (maxResult._max.position ?? -1) + 1
    return tx.favoritePage.upsert({
      where: { userId_pageId: { userId, pageId: input.pageId } },
      create: { userId, pageId: input.pageId, position: nextPosition },
      update: {},
    })
  })
}

export async function removeFavorite(
  prisma: PrismaClient,
  userId: string,
  input: RemoveFavoriteInput,
): Promise<{ count: number }> {
  // No assertPageAccess: allow un-favoriting a page you've lost access to.
  // Access checks live in the tRPC wrapper (which also returns { pageId } to its callers).
  return prisma.favoritePage.deleteMany({
    where: { userId, pageId: input.pageId },
  })
}

export async function reorderFavorites(
  prisma: PrismaClient,
  userId: string,
  input: ReorderFavoritesInput,
): Promise<{ ok: true }> {
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: input.workspaceId, userId } },
  })
  if (!member) throw forbidden('Вы не являетесь участником воркспейса')

  await prisma.$transaction(
    input.orderedIds.map((pageId, index) =>
      prisma.favoritePage.updateMany({
        where: {
          userId,
          pageId,
          page: { workspaceId: input.workspaceId },
        },
        data: { position: index },
      }),
    ),
  )
  return { ok: true }
}
```

- [ ] **Step 5: Create `favorites/index.ts` barrel**

`packages/domain/src/favorites/index.ts`:
```ts
export * from './functions.ts'
export * from './schemas.ts'
```

- [ ] **Step 6: Update `packages/domain/src/index.ts`**

Before:
```ts
export * from './errors.ts'
export * from './kanban/index.ts'
export * from './notifications/index.ts'
```

After:
```ts
export * from './errors.ts'
export * from './favorites/index.ts'
export * from './kanban/index.ts'
export * from './notifications/index.ts'
```

- [ ] **Step 7: Run tests + check-types**

Run: `pnpm --filter @repo/domain test && pnpm --filter @repo/domain check-types`
Expected: PASS, clean.

- [ ] **Step 8: Commit**

```bash
git add packages/domain/src/favorites packages/domain/src/index.ts packages/domain/test/favorites
git commit -m "$(cat <<'EOF'
feat(domain): add favorites domain module (addFavorite/removeFavorite/reorderFavorites)

Position rule: (_max ?? -1)+1 (0-based, matches tRPC). reorderFavorites enforces workspace
membership. removeFavorite returns {count} (deleteMany result) with NO assertPageAccess so
users can un-favorite a page they've lost access to. tRPC wrapper preserves {pageId} contract
by running its own assertPageAccess + requireWritableWorkspace before delegation.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: tRPC `page.ts` favorites — wrappers that preserve existing pre-checks

**Files:**
- Modify: `packages/trpc/src/routers/page.ts`

The favorites procedures in `page.ts` are at lines 744–800. Only `addFavorite`, `removeFavorite`, and `reorderFavorites` change. `listFavorites` is **untouched**.

- [ ] **Step 1: Add domain imports to `page.ts`**

`page.ts` currently imports from helpers at the top. Add two more imports after the existing import block. The relevant existing imports are:

```ts
import {
  assertWorkspaceMember,
  assertPageAccess,
  assertPageOwnership,
  assertCanManageShare,
} from '../helpers/page-access'
import { requireWritableWorkspace } from '../helpers/plan'
```

Add after those lines:
```ts
import * as domain from '@repo/domain'
import { mapDomain } from '../helpers/map-domain'
```

- [ ] **Step 2: Replace `addFavorite` procedure**

Before (lines 744–763):
```ts
  addFavorite: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageAccess(ctx, input.pageId)
      await requireWritableWorkspace(page.workspaceId)

      return ctx.prisma.$transaction(async (tx) => {
        const maxResult = await tx.favoritePage.aggregate({
          where: { userId: ctx.user.id },
          _max: { position: true },
        })
        const nextPosition = (maxResult._max.position ?? -1) + 1

        return tx.favoritePage.upsert({
          where: { userId_pageId: { userId: ctx.user.id, pageId: input.pageId } },
          create: { userId: ctx.user.id, pageId: input.pageId, position: nextPosition },
          update: {},
        })
      })
    }),
```

After:
```ts
  addFavorite: protectedProcedure
    .input(domain.addFavoriteInput)
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageAccess(ctx, input.pageId)
      await requireWritableWorkspace(page.workspaceId)
      return mapDomain(() => domain.addFavorite(ctx.prisma, ctx.user.id, input))
    }),
```

- [ ] **Step 3: Replace `removeFavorite` procedure**

Before (lines 765–774):
```ts
  removeFavorite: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageAccess(ctx, input.pageId)
      await requireWritableWorkspace(page.workspaceId)
      await ctx.prisma.favoritePage.deleteMany({
        where: { userId: ctx.user.id, pageId: input.pageId },
      })
      return { pageId: input.pageId }
    }),
```

After:
```ts
  removeFavorite: protectedProcedure
    .input(domain.removeFavoriteInput)
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageAccess(ctx, input.pageId)
      await requireWritableWorkspace(page.workspaceId)
      // domain.removeFavorite returns { count } — tRPC callers expect { pageId },
      // so we delegate and then return the pageId ourselves.
      return mapDomain(async () => {
        await domain.removeFavorite(ctx.prisma, ctx.user.id, input)
        return { pageId: input.pageId }
      })
    }),
```

- [ ] **Step 4: Replace `reorderFavorites` procedure**

Before (lines 776–800):
```ts
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

After:
```ts
  reorderFavorites: protectedProcedure
    .input(domain.reorderFavoritesInput)
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      return mapDomain(() => domain.reorderFavorites(ctx.prisma, ctx.user.id, input))
    }),
```

- [ ] **Step 5: Run tRPC tests + check-types**

Run: `pnpm --filter @repo/trpc test && pnpm --filter @repo/trpc check-types`
Expected: PASS. The existing page/favorite tests are the regression guard; return shapes are preserved exactly.

- [ ] **Step 6: Commit**

```bash
git add packages/trpc/src/routers/page.ts
git commit -m "$(cat <<'EOF'
refactor(trpc): favorites addFavorite/removeFavorite/reorderFavorites delegate to @repo/domain

Pre-checks (assertPageAccess + requireWritableWorkspace / assertWorkspaceMember) are preserved
in the tRPC wrapper before delegation.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: engines `FavoriteService` delegates to domain + add `reorderFavorites` tool

**Files:**
- Modify: `apps/engines/src/apps/mcp/services/favorite.service.ts`
- Modify: `apps/engines/src/apps/mcp/tools/favorite.tools.ts`
- Modify: `apps/agents/agents/apps/agent/services/tool_registry.py`
- Create: `apps/engines/src/apps/mcp/services/favorite.service.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/engines/src/apps/mcp/services/favorite.service.spec.ts`:
```ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'

// SP1 pattern: NO jest.unstable_mockModule. Import the service normally; the REAL
// @repo/domain functions run against a hand-mocked PrismaClient.
import { FavoriteService } from './favorite.service.js'

function makeMockPrisma() {
  const deleteMany = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ count: 1 }))
  const aggregate = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ _max: { position: null } }))
  const upsert = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ userId: 'u1', pageId: 'p1', position: 0 }))
  const favFindMany = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => [])
  const favUpdateMany = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ count: 1 }))
  const pageFindFirst = jest.fn<(...a: unknown[]) => Promise<unknown>>(
    async () => ({ id: 'p1', workspaceId: 'w1', createdById: 'u1' }),
  )
  const memberFindUnique = jest.fn<(...a: unknown[]) => Promise<unknown>>(
    async () => ({ workspaceId: 'w1', userId: 'u1', role: 'EDITOR' }),
  )
  const $transaction = jest.fn<(...a: unknown[]) => Promise<unknown>>(async (fns: unknown) => {
    if (Array.isArray(fns)) return Promise.all(fns as Promise<unknown>[])
    if (typeof fns === 'function')
      return (fns as (tx: unknown) => unknown)({
        favoritePage: { aggregate, upsert, deleteMany, updateMany: favUpdateMany },
        workspaceMember: { findUnique: memberFindUnique },
      })
    return fns
  })
  return {
    page: { findFirst: pageFindFirst },
    workspaceMember: { findUnique: memberFindUnique },
    favoritePage: { aggregate, upsert, deleteMany, findMany: favFindMany, updateMany: favUpdateMany },
    $transaction,
    __mocks: { deleteMany, aggregate, upsert, favFindMany, favUpdateMany, pageFindFirst, memberFindUnique, $transaction },
  } as unknown as PrismaClient & { __mocks: Record<string, ReturnType<typeof jest.fn>> }
}

describe('FavoriteService', () => {
  let mockPrisma: ReturnType<typeof makeMockPrisma>
  let svc: FavoriteService

  beforeEach(() => {
    jest.clearAllMocks()
    mockPrisma = makeMockPrisma()
    svc = new FavoriteService(mockPrisma)
  })

  it('add calls domain.addFavorite (page.findFirst + $transaction + favoritePage.upsert)', async () => {
    await svc.add({ userId: 'u1', workspaceId: 'w1', pageId: 'p1' })
    expect(mockPrisma.__mocks.pageFindFirst).toHaveBeenCalled()
    expect(mockPrisma.__mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ userId: 'u1', pageId: 'p1' }) }),
    )
  })

  it('remove calls favoritePage.deleteMany and returns { count: 1 }', async () => {
    const result = await svc.remove({ userId: 'u1', pageId: 'p1' })
    expect(mockPrisma.__mocks.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', pageId: 'p1' },
    })
    expect(result).toEqual({ count: 1 })
  })

  it('reorder calls $transaction for updateMany batch', async () => {
    await svc.reorder({ userId: 'u1', workspaceId: 'w1', orderedIds: ['p1', 'p2'] })
    expect(mockPrisma.__mocks.$transaction).toHaveBeenCalled()
  })

  it('list uses direct Prisma favoritePage.findMany (does not touch page.findFirst)', async () => {
    mockPrisma.__mocks.favFindMany.mockResolvedValue([])
    await svc.list({ userId: 'u1' })
    expect(mockPrisma.__mocks.favFindMany).toHaveBeenCalled()
    expect(mockPrisma.__mocks.pageFindFirst).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter engines test -- favorite.service`
Expected: FAIL.

- [ ] **Step 3: Rewrite `favorite.service.ts`**

Full new content of `apps/engines/src/apps/mcp/services/favorite.service.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'
import * as domain from '@repo/domain'

import { PRISMA } from '../../../infra/db/db.providers.js'

export type ListFavoritesInput = { userId: string; workspaceId?: string }
export type AddFavoriteInput = { userId: string; workspaceId: string; pageId: string }
export type RemoveFavoriteInput = { userId: string; pageId: string } // returns { count: number }
export type ReorderFavoritesInput = { userId: string; workspaceId: string; orderedIds: string[] }

@Injectable()
export class FavoriteService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async list(input: ListFavoritesInput) {
    const rows = await this.prisma.favoritePage.findMany({
      where: {
        userId: input.userId,
        ...(input.workspaceId ? { page: { workspaceId: input.workspaceId } } : {}),
      },
      select: { page: { select: { id: true, title: true, type: true, icon: true, workspaceId: true } } },
      orderBy: { position: 'asc' },
      take: 200,
    })
    return rows.map((r) => ({
      pageId: r.page.id,
      title: r.page.title,
      type: r.page.type,
      icon: r.page.icon,
      workspaceId: r.page.workspaceId,
    }))
  }

  async add(input: AddFavoriteInput): Promise<{ ok: true }> {
    await domain.addFavorite(this.prisma, input.userId, { pageId: input.pageId })
    return { ok: true }
  }

  async remove(input: RemoveFavoriteInput): Promise<{ count: number }> {
    // domain.removeFavorite returns { count } (no assertPageAccess). Engines MCP
    // callers get the deleteMany count; the tRPC wrapper maps this to { pageId } itself.
    return domain.removeFavorite(this.prisma, input.userId, { pageId: input.pageId })
  }

  async reorder(input: ReorderFavoritesInput): Promise<{ ok: true }> {
    return domain.reorderFavorites(this.prisma, input.userId, {
      workspaceId: input.workspaceId,
      orderedIds: input.orderedIds,
    })
  }
}
```

- [ ] **Step 4: Add `reorderFavorites` tool to `favorite.tools.ts`**

Full new content of `apps/engines/src/apps/mcp/tools/favorite.tools.ts`:
```ts
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import type { Context } from '@rekog/mcp-nest'
import { Tool } from '@rekog/mcp-nest'
import type { PrismaClient } from '@repo/db'
import { z } from 'zod'

import { PRISMA } from '../../../infra/db/db.providers.js'
import { assertMember } from '../../api/auth/membership.js'
import type { AuthContext, AuthedRequest } from '../../api/auth/auth-context.js'
import { FavoriteService } from '../services/favorite.service.js'
import { mcpInput, mcpUuid } from '../utils/mcp-input.js'

const ListFavoritesInput = z.object({
  workspaceId: mcpInput(z.string().uuid().optional()),
})
const AddFavoriteInput = z.object({
  workspaceId: z.string().uuid(),
  pageId: mcpUuid(),
})
const RemoveFavoriteInput = z.object({
  pageId: mcpUuid(),
})
const ReorderFavoritesInput = z.object({
  workspaceId: z.string().uuid(),
  orderedIds: z.array(z.string().uuid()).min(1).max(200),
})

type ListFavoritesArgs = z.infer<typeof ListFavoritesInput>
type AddFavoriteArgs = z.infer<typeof AddFavoriteInput>
type RemoveFavoriteArgs = z.infer<typeof RemoveFavoriteInput>
type ReorderFavoritesArgs = z.infer<typeof ReorderFavoritesInput>

function requireAuth(req: AuthedRequest | undefined): AuthContext {
  if (!req?.auth) throw new UnauthorizedException('Unauthenticated MCP request')
  return req.auth
}

@Injectable()
export class FavoriteTools {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly favorites: FavoriteService,
  ) {}

  @Tool({
    name: 'listFavorites',
    description:
      'Список избранных страниц пользователя (по всем пространствам или по одному, ' +
      'если задан workspaceId). Возвращает pageId, title, type, icon, workspaceId. ' +
      'Параметр: workspaceId (опц.).',
    parameters: ListFavoritesInput,
  })
  async listFavorites(args: ListFavoritesArgs, _context: Context, req: AuthedRequest) {
    const auth = requireAuth(req)
    const favorites = await this.favorites.list({ userId: auth.userId, workspaceId: args.workspaceId ?? undefined })
    return { favorites }
  }

  @Tool({
    name: 'addFavorite',
    description: 'Добавляет страницу в избранное. Параметры: workspaceId, pageId.',
    parameters: AddFavoriteInput,
  })
  addFavorite(args: AddFavoriteArgs, _context: Context, req: AuthedRequest) {
    return this.doAddFavorite(requireAuth(req), args)
  }

  async doAddFavorite(auth: AuthContext, args: AddFavoriteArgs) {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    return this.favorites.add({ userId: auth.userId, workspaceId: args.workspaceId, pageId: args.pageId })
  }

  @Tool({
    name: 'removeFavorite',
    description: 'Убирает страницу из избранного. Параметр: pageId.',
    parameters: RemoveFavoriteInput,
  })
  async removeFavorite(args: RemoveFavoriteArgs, _context: Context, req: AuthedRequest) {
    const auth = requireAuth(req)
    return this.favorites.remove({ userId: auth.userId, pageId: args.pageId })
  }

  @Tool({
    name: 'reorderFavorites',
    description:
      'Переупорядочивает избранные страницы пользователя в воркспейсе. ' +
      'orderedIds — полный список pageId в желаемом порядке (0-based position). ' +
      'Требует подтверждения. Параметры: workspaceId, orderedIds[].',
    parameters: ReorderFavoritesInput,
  })
  async reorderFavorites(args: ReorderFavoritesArgs, _context: Context, req: AuthedRequest) {
    const auth = requireAuth(req)
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    return this.favorites.reorder({
      userId: auth.userId,
      workspaceId: args.workspaceId,
      orderedIds: args.orderedIds,
    })
  }
}
```

- [ ] **Step 5: Add `reorderFavorites` to `tool_registry.py`**

In `apps/agents/agents/apps/agent/services/tool_registry.py`, add a new entry after `removeFavorite`:

Before:
```python
    'removeFavorite': ToolMeta('removeFavorite', SCOPE_FAVORITES_WRITE, False,
                                _summary_generic('removeFavorite'), _preview_default),
```

After:
```python
    'removeFavorite': ToolMeta('removeFavorite', SCOPE_FAVORITES_WRITE, False,
                                _summary_generic('removeFavorite'), _preview_default),
    'reorderFavorites': ToolMeta('reorderFavorites', SCOPE_FAVORITES_WRITE, True,
                                  lambda a: f'Переупорядочить избранное в воркспейсе {a.get("workspaceId")}', _preview_default),
```

- [ ] **Step 6: Run tests + check-types**

Run: `pnpm --filter engines test -- favorite && pnpm --filter engines check-types`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/engines/src/apps/mcp/services/favorite.service.ts \
        apps/engines/src/apps/mcp/services/favorite.service.spec.ts \
        apps/engines/src/apps/mcp/tools/favorite.tools.ts \
        apps/agents/agents/apps/agent/services/tool_registry.py
git commit -m "$(cat <<'EOF'
feat(mcp): favorite service delegates to domain; add reorderFavorites tool (gap-fix)

off-by-one fix: engines was using (_max ?? 0)+1; domain adopts tRPC's (_max ?? -1)+1 (0-based).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase D — Reminders domain module (Ports) + tRPC + engines

### Task 8: `packages/domain/src/reminders/ports.ts` + `schemas.ts`

**Files:**
- Create: `packages/domain/src/reminders/ports.ts`
- Create: `packages/domain/src/reminders/schemas.ts`

No test is needed for pure-type declarations; the schemas are tested implicitly by the function tests in Tasks 9 and 10.

- [ ] **Step 1: Create `ports.ts`**

`packages/domain/src/reminders/ports.ts`:
```ts
import type { Prisma, ReminderAudience } from '@repo/db'

export interface ReminderForRebuild {
  id: string
  pageId: string
  workspaceId: string
  createdById: string | null
  dueAt: Date
  offsets: number[]
  audience: ReminderAudience
  label: string | null
  recipients: string[]
  doneAt: Date | null
}

export interface DeliveryScheduler {
  rebuild(tx: Prisma.TransactionClient, r: ReminderForRebuild): Promise<void>
  cancel(tx: Prisma.TransactionClient, reminderIds: string[], reason: string): Promise<void>
}
```

- [ ] **Step 2: Create `schemas.ts`**

`packages/domain/src/reminders/schemas.ts`:
```ts
import { z } from 'zod'

export const createReminderInput = z.object({
  pageId: z.string().uuid(),
  dueAt: z.date(),
  offsets: z.array(z.number().int().min(0).max(525_600)).max(20).default([]),
  audience: z.enum(['ME', 'WORKSPACE', 'LIST']).default('ME'),
  label: z.string().max(200).nullable().optional(),
})
export type CreateReminderInput = z.infer<typeof createReminderInput>

export const moveReminderInput = z.object({
  reminderId: z.string().uuid(),
  dueAt: z.date().optional(),
  shift: z
    .object({
      days: z.number().int().optional(),
      hours: z.number().int().optional(),
      minutes: z.number().int().optional(),
    })
    .optional(),
})
export type MoveReminderInput = z.infer<typeof moveReminderInput>

export const deleteReminderInput = z.object({
  reminderId: z.string().uuid().optional(),
  reminderIds: z.array(z.string().uuid()).optional(),
  all: z.boolean().optional(),
  pageId: z.string().uuid().optional(),
})
export type DeleteReminderInput = z.infer<typeof deleteReminderInput>

export const completeReminderInput = z.object({
  reminderId: z.string().uuid(),
})
export type CompleteReminderInput = z.infer<typeof completeReminderInput>

export const reminderSyncItemSchema = z.object({
  id: z.string().uuid(),
  dueAt: z.string().datetime(),
  offsets: z.array(z.number().int().min(0).max(525_600)).max(20),
  audience: z.enum(['ME', 'WORKSPACE', 'LIST']),
  label: z.string().max(200).nullable(),
  recipients: z.array(z.string().uuid()).max(100),
  doneAt: z.string().datetime().nullable(),
})
export type ReminderSyncItem = z.infer<typeof reminderSyncItemSchema>

export const syncRemindersInput = z.object({
  pageId: z.string().uuid(),
  reminders: z.array(reminderSyncItemSchema).max(500),
})
export type SyncRemindersInput = z.infer<typeof syncRemindersInput>
```

- [ ] **Step 3: check-types**

Run: `pnpm --filter @repo/domain check-types`
Expected: clean (types only — no logic yet).

- [ ] **Step 4: Commit**

```bash
git add packages/domain/src/reminders/ports.ts packages/domain/src/reminders/schemas.ts
git commit -m "$(cat <<'EOF'
feat(domain): add reminders ports (DeliveryScheduler) and input schemas

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Domain granular reminder functions + tests

**Files:**
- Create: `packages/domain/src/reminders/functions.ts`
- Create: `packages/domain/test/reminders/functions.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/domain/test/reminders/functions.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { PrismaClient } from '@repo/db'

import { DomainError } from '../../src/errors.ts'
import {
  completeReminder,
  createReminder,
  deleteReminder,
  moveReminder,
} from '../../src/reminders/functions.ts'
import type { DeliveryScheduler } from '../../src/reminders/ports.ts'

function makeScheduler(): DeliveryScheduler & { rebuild: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> } {
  return { rebuild: vi.fn(async () => undefined), cancel: vi.fn(async () => undefined) }
}

function makePrisma() {
  const txReminder = {
    create: vi.fn(async () => ({ id: 'r1', pageId: 'p1', workspaceId: 'w1', createdById: 'u1', dueAt: new Date(), offsets: [0], audience: 'ME' as const, label: null, recipients: [], doneAt: null })),
    update: vi.fn(async () => ({ id: 'r1', pageId: 'p1', workspaceId: 'w1', createdById: 'u1', dueAt: new Date(), offsets: [0], audience: 'ME' as const, label: null, doneAt: null })),
    updateMany: vi.fn(async () => ({ count: 1 })),
    findUnique: vi.fn(async () => ({ id: 'r1', pageId: 'p1', workspaceId: 'w1', createdById: 'u1', dueAt: new Date(), offsets: [0], audience: 'ME' as const, label: null, doneAt: null })),
    // findMany used by deleteReminder to get matched ids before cancel
    findMany: vi.fn(async () => [{ id: 'r1' }]),
  }
  const txRecipient = { deleteMany: vi.fn(async () => ({ count: 0 })) }
  const tx = { reminder: txReminder, reminderRecipient: txRecipient }
  return {
    page: { findFirst: vi.fn(async () => ({ id: 'p1', workspaceId: 'w1', createdById: 'u1' })) },
    reminder: {
      findUnique: vi.fn(async () => ({ id: 'r1', pageId: 'p1', workspaceId: 'w1', createdById: 'u1', dueAt: new Date(), offsets: [0], audience: 'ME' as const, label: null, doneAt: null })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    __tx: tx,
  } as unknown as PrismaClient & { __tx: typeof tx }
}

describe('domain reminders granular', () => {
  beforeEach(() => vi.clearAllMocks())

  it('createReminder: creates reminder inside transaction and calls scheduler.rebuild', async () => {
    const prisma = makePrisma()
    const sched = makeScheduler()
    const result = await createReminder(
      prisma,
      'u1',
      { pageId: 'p1', dueAt: new Date(), offsets: [0], audience: 'ME', label: null },
      sched,
    )
    expect(result).toEqual({ reminderId: 'r1' })
    expect(sched.rebuild).toHaveBeenCalledOnce()
  })

  it('createReminder: throws NOT_FOUND when page not accessible', async () => {
    const prisma = makePrisma()
    ;(prisma.page.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const sched = makeScheduler()
    await expect(
      createReminder(prisma, 'u1', { pageId: 'p1', dueAt: new Date(), offsets: [], audience: 'ME', label: null }, sched),
    ).rejects.toBeInstanceOf(DomainError)
    expect(sched.rebuild).not.toHaveBeenCalled()
  })

  it('moveReminder: updates dueAt and calls scheduler.rebuild', async () => {
    const prisma = makePrisma()
    const sched = makeScheduler()
    const newDue = new Date(Date.now() + 86_400_000)
    const result = await moveReminder(prisma, 'u1', { reminderId: 'r1', dueAt: newDue }, sched)
    expect(result.id).toBe('r1')
    expect(sched.rebuild).toHaveBeenCalledOnce()
    expect(sched.cancel).not.toHaveBeenCalled()
  })

  it('moveReminder: throws NOT_FOUND when reminder belongs to another user', async () => {
    const prisma = makePrisma()
    ;(prisma.reminder.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      { id: 'r1', pageId: 'p1', workspaceId: 'w1', createdById: 'OTHER', dueAt: new Date(), offsets: [], audience: 'ME', label: null, doneAt: null },
    )
    const sched = makeScheduler()
    await expect(
      moveReminder(prisma, 'u1', { reminderId: 'r1', dueAt: new Date() }, sched),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('deleteReminder: soft-deletes and calls scheduler.cancel with matched ids', async () => {
    const prisma = makePrisma()
    const sched = makeScheduler()
    // tx.reminder.findMany returns [{ id: 'r1' }], so cancel should be called with ['r1']
    const result = await deleteReminder(prisma, 'u1', { reminderId: 'r1' }, sched)
    expect(result).toEqual({ count: 1 })
    expect(sched.cancel).toHaveBeenCalledWith(expect.anything(), ['r1'], 'reminder removed')
  })

  it('deleteReminder: supports full input shape (reminderIds, pageId)', async () => {
    const prisma = makePrisma()
    const sched = makeScheduler()
    const result = await deleteReminder(
      prisma,
      'u1',
      { reminderIds: ['r1', 'r2'], pageId: 'p1' },
      sched,
    )
    expect(result).toEqual({ count: 1 })
    expect(sched.cancel).toHaveBeenCalledOnce()
  })

  it('completeReminder: sets doneAt and calls scheduler.cancel', async () => {
    const prisma = makePrisma()
    const sched = makeScheduler()
    const result = await completeReminder(prisma, 'u1', { reminderId: 'r1' }, sched)
    expect(result).toEqual({ id: 'r1' })
    expect(sched.cancel).toHaveBeenCalledWith(expect.anything(), ['r1'], 'reminder completed')
  })

  it('completeReminder: throws NOT_FOUND when updateMany returns count 0', async () => {
    const prisma = makePrisma()
    ;(prisma as unknown as { __tx: { reminder: { updateMany: ReturnType<typeof vi.fn> } } }).__tx.reminder.updateMany.mockResolvedValue({ count: 0 })
    const sched = makeScheduler()
    await expect(completeReminder(prisma, 'u1', { reminderId: 'r1' }, sched)).rejects.toBeInstanceOf(DomainError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/domain test -- reminders`
Expected: FAIL — `functions.ts` missing.

- [ ] **Step 3: Implement `functions.ts`**

`packages/domain/src/reminders/functions.ts`:
```ts
import type { PrismaClient } from '@repo/db'

import { notFound } from '../errors.ts'
import type {
  CompleteReminderInput,
  CreateReminderInput,
  DeleteReminderInput,
  MoveReminderInput,
} from './schemas.ts'
import type { DeliveryScheduler, ReminderForRebuild } from './ports.ts'

function shiftMs(shift: { days?: number; hours?: number; minutes?: number }): number {
  return (shift.days ?? 0) * 86_400_000 + (shift.hours ?? 0) * 3_600_000 + (shift.minutes ?? 0) * 60_000
}

async function assertPageAccess(prisma: PrismaClient, userId: string, pageId: string) {
  const page = await prisma.page.findFirst({
    where: { id: pageId, workspace: { members: { some: { userId } } } },
  })
  if (!page) throw notFound('Страница не найдена')
  return page
}

export async function createReminder(
  prisma: PrismaClient,
  userId: string,
  input: CreateReminderInput,
  scheduler: DeliveryScheduler,
): Promise<{ reminderId: string }> {
  const page = await assertPageAccess(prisma, userId, input.pageId)

  return prisma.$transaction(async (tx) => {
    const reminder = await tx.reminder.create({
      data: {
        pageId: input.pageId,
        workspaceId: page.workspaceId,
        createdById: userId,
        label: input.label ?? null,
        dueAt: input.dueAt,
        audience: input.audience,
        offsets: input.offsets,
      },
      select: {
        id: true,
        pageId: true,
        workspaceId: true,
        createdById: true,
        dueAt: true,
        offsets: true,
        audience: true,
        label: true,
        doneAt: true,
      },
    })

    const forRebuild: ReminderForRebuild = {
      id: reminder.id,
      pageId: reminder.pageId,
      workspaceId: reminder.workspaceId,
      createdById: reminder.createdById,
      dueAt: reminder.dueAt,
      offsets: reminder.offsets,
      audience: reminder.audience,
      label: reminder.label,
      recipients: [],
      doneAt: null,
    }
    await scheduler.rebuild(tx, forRebuild)
    return { reminderId: reminder.id }
  })
}

export async function moveReminder(
  prisma: PrismaClient,
  userId: string,
  input: MoveReminderInput,
  scheduler: DeliveryScheduler,
): Promise<{ id: string; dueAt: Date }> {
  const existing = await prisma.reminder.findUnique({
    where: { id: input.reminderId },
    select: { id: true, pageId: true, workspaceId: true, createdById: true, dueAt: true, offsets: true, audience: true, label: true, doneAt: true },
  })
  if (!existing || existing.createdById !== userId) throw notFound('Напоминание не найдено')

  const newDueAt = input.dueAt ?? new Date(existing.dueAt.getTime() + shiftMs(input.shift ?? {}))

  return prisma.$transaction(async (tx) => {
    await tx.reminder.update({
      where: { id: input.reminderId },
      data: { dueAt: newDueAt },
    })

    const recipients = await tx.reminderRecipient.findMany({
      where: { reminderId: input.reminderId },
      select: { userId: true },
    })

    const forRebuild: ReminderForRebuild = {
      id: existing.id,
      pageId: existing.pageId,
      workspaceId: existing.workspaceId,
      createdById: existing.createdById,
      dueAt: newDueAt,
      offsets: existing.offsets,
      audience: existing.audience,
      label: existing.label,
      recipients: recipients.map((r) => r.userId),
      doneAt: existing.doneAt,
    }
    await scheduler.rebuild(tx, forRebuild)
    return { id: input.reminderId, dueAt: newDueAt }
  })
}

export async function deleteReminder(
  prisma: PrismaClient,
  actorUserId: string,
  input: DeleteReminderInput,
  scheduler: DeliveryScheduler,
): Promise<{ count: number }> {
  // Replicate original engines where-clause: support reminderId, reminderIds[], and pageId.
  // `all` stays in the input type for tool compatibility but, as in the original, is not used
  // in the where — when no ids and no pageId the where matches all of the user's active reminders.
  const ids = [...(input.reminderId ? [input.reminderId] : []), ...(input.reminderIds ?? [])]
  const where = {
    createdById: actorUserId,
    deletedAt: null,
    ...(ids.length ? { id: { in: ids } } : {}),
    ...(input.pageId ? { pageId: input.pageId } : {}),
  }
  return prisma.$transaction(async (tx) => {
    const matched = await tx.reminder.findMany({ where, select: { id: true } })
    const matchedIds = matched.map((r) => r.id)
    const result = await tx.reminder.updateMany({ where, data: { deletedAt: new Date() } })
    if (matchedIds.length) await scheduler.cancel(tx, matchedIds, 'reminder removed')
    return { count: result.count }
  })
}

export async function completeReminder(
  prisma: PrismaClient,
  userId: string,
  input: CompleteReminderInput,
  scheduler: DeliveryScheduler,
): Promise<{ id: string }> {
  return prisma.$transaction(async (tx) => {
    const result = await tx.reminder.updateMany({
      where: {
        id: input.reminderId,
        doneAt: null,
        OR: [{ createdById: userId }, { recipients: { some: { userId } } }],
      },
      data: { doneAt: new Date(), doneById: userId },
    })
    if (result.count === 0) throw notFound('Напоминание не найдено')
    await scheduler.cancel(tx, [input.reminderId], 'reminder completed')
    return { id: input.reminderId }
  })
}
```

- [ ] **Step 4: Run tests + check-types**

Run: `pnpm --filter @repo/domain test -- reminders && pnpm --filter @repo/domain check-types`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/reminders/functions.ts packages/domain/test/reminders/functions.test.ts
git commit -m "$(cat <<'EOF'
feat(domain): add granular reminder domain functions with DeliveryScheduler port

createReminder/moveReminder/deleteReminder/completeReminder all call scheduler inside
$transaction, ensuring delivery rows are always created atomically.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Domain `syncReminders` (batch) + tests

**Files:**
- Create: `packages/domain/src/reminders/sync.ts`
- Create: `packages/domain/src/reminders/index.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `packages/domain/test/reminders/sync.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/domain/test/reminders/sync.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { PrismaClient } from '@repo/db'

import { DomainError } from '../../src/errors.ts'
import { syncReminders } from '../../src/reminders/sync.ts'
import type { DeliveryScheduler } from '../../src/reminders/ports.ts'

function makeScheduler(): DeliveryScheduler & { rebuild: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> } {
  return { rebuild: vi.fn(async () => undefined), cancel: vi.fn(async () => undefined) }
}

function makePrisma(memberRole: string | null = 'EDITOR') {
  const pageData = { workspaceId: 'w1' }
  const memberData = memberRole ? { userId: 'u1', role: memberRole } : null

  const txReminder = {
    findMany: vi.fn(async () => []),
    upsert: vi.fn(async () => ({})),
    updateMany: vi.fn(async () => ({ count: 0 })),
  }
  const txRecipient = {
    deleteMany: vi.fn(async () => ({ count: 0 })),
    createMany: vi.fn(async () => ({ count: 0 })),
  }
  const txMember = {
    findMany: vi.fn(async () => (memberData ? [memberData] : [])),
  }
  const tx = { reminder: txReminder, reminderRecipient: txRecipient, workspaceMember: txMember }

  return {
    page: { findUniqueOrThrow: vi.fn(async () => pageData) },
    workspaceMember: { findUnique: vi.fn(async () => memberData), findMany: vi.fn(async () => (memberData ? [memberData] : [])) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    __tx: tx,
  } as unknown as PrismaClient & { __tx: typeof tx }
}

describe('domain reminders syncReminders', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws FORBIDDEN when user is not OWNER/ADMIN/EDITOR', async () => {
    const prisma = makePrisma('VIEWER')
    const sched = makeScheduler()
    await expect(
      syncReminders(prisma, 'u1', { pageId: 'p1', reminders: [] }, sched),
    ).rejects.toBeInstanceOf(DomainError)
    expect(sched.rebuild).not.toHaveBeenCalled()
  })

  it('throws BAD_REQUEST when LIST recipients are not workspace members', async () => {
    const prisma = makePrisma('EDITOR')
    ;(prisma.workspaceMember.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
    const sched = makeScheduler()
    const reminder = {
      id: 'r1',
      dueAt: new Date().toISOString(),
      offsets: [0],
      audience: 'LIST' as const,
      label: null,
      recipients: ['non-member-uuid-0001-000000000000'],
      doneAt: null,
    }
    await expect(
      syncReminders(prisma, 'u1', { pageId: 'p1', reminders: [reminder] }, sched),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('upserts reminders and calls scheduler.rebuild for each', async () => {
    const prisma = makePrisma('EDITOR')
    const sched = makeScheduler()
    const reminder = {
      id: 'r1',
      dueAt: new Date().toISOString(),
      offsets: [0],
      audience: 'ME' as const,
      label: 'Test',
      recipients: [],
      doneAt: null,
    }
    const result = await syncReminders(prisma, 'u1', { pageId: 'p1', reminders: [reminder] }, sched)
    expect(result).toEqual({ ok: true })
    expect(sched.rebuild).toHaveBeenCalledOnce()
  })

  it('calls scheduler.cancel for reminders removed from the list', async () => {
    const prisma = makePrisma('EDITOR')
    ;(prisma as unknown as { __tx: { reminder: { findMany: ReturnType<typeof vi.fn> } } }).__tx.reminder.findMany.mockResolvedValue([
      { id: 'old-r', deletedAt: null, doneAt: null, dueAt: new Date(), offsets: [], audience: 'ME', createdById: 'u1' },
    ])
    const sched = makeScheduler()
    // No reminders in the incoming list — old-r should be deleted
    const result = await syncReminders(prisma, 'u1', { pageId: 'p1', reminders: [] }, sched)
    expect(result).toEqual({ ok: true })
    expect(sched.cancel).toHaveBeenCalledWith(expect.anything(), ['old-r'], 'reminder removed')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/domain test -- sync`
Expected: FAIL — `sync.ts` missing.

- [ ] **Step 3: Implement `sync.ts`** — port `reminder.ts` `syncForPage` verbatim

`packages/domain/src/reminders/sync.ts`:
```ts
import type { PrismaClient } from '@repo/db'

import { badRequest, forbidden } from '../errors.ts'
import type { DeliveryScheduler, ReminderForRebuild } from './ports.ts'
import type { SyncRemindersInput } from './schemas.ts'

export async function syncReminders(
  prisma: PrismaClient,
  userId: string,
  input: SyncRemindersInput,
  scheduler: DeliveryScheduler,
): Promise<{ ok: true }> {
  const page = await prisma.page.findUniqueOrThrow({
    where: { id: input.pageId },
    select: { workspaceId: true },
  })

  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: page.workspaceId, userId } },
  })
  if (!member || !(['OWNER', 'ADMIN', 'EDITOR'] as string[]).includes(member.role)) {
    throw forbidden('Недостаточно прав')
  }

  // Validate LIST recipients are workspace members (security)
  const listRemindersWithRecipients = input.reminders.filter(
    (r) => r.audience === 'LIST' && r.recipients.length > 0,
  )
  if (listRemindersWithRecipients.length > 0) {
    const allRecipientIds = Array.from(
      new Set(listRemindersWithRecipients.flatMap((r) => r.recipients)),
    )
    const members = await prisma.workspaceMember.findMany({
      where: {
        workspaceId: page.workspaceId,
        userId: { in: allRecipientIds },
      },
      select: { userId: true },
    })
    const memberSet = new Set(members.map((m) => m.userId))
    const invalid = allRecipientIds.filter((id) => !memberSet.has(id))
    if (invalid.length > 0) {
      throw badRequest(`Some recipients are not workspace members: ${invalid.join(', ')}`)
    }
  }

  await prisma.$transaction(async (tx) => {
    const existing = await tx.reminder.findMany({
      where: { pageId: input.pageId },
      select: {
        id: true,
        deletedAt: true,
        doneAt: true,
        dueAt: true,
        offsets: true,
        audience: true,
        createdById: true,
      },
    })
    const existingById = new Map(existing.map((r) => [r.id, r]))
    const incomingIds = new Set(input.reminders.map((r) => r.id))

    for (const r of input.reminders) {
      const prev = existingById.get(r.id)
      await tx.reminder.upsert({
        where: { id: r.id },
        create: {
          id: r.id,
          pageId: input.pageId,
          workspaceId: page.workspaceId,
          createdById: userId,
          dueAt: new Date(r.dueAt),
          offsets: r.offsets,
          audience: r.audience,
          label: r.label,
          doneAt: r.doneAt ? new Date(r.doneAt) : null,
          doneById: r.doneAt ? userId : null,
        },
        update: {
          dueAt: new Date(r.dueAt),
          offsets: r.offsets,
          audience: r.audience,
          label: r.label,
          doneAt: r.doneAt ? new Date(r.doneAt) : null,
          deletedAt: null,
          doneById: r.doneAt && !prev?.doneAt ? userId : undefined,
        },
      })

      await tx.reminderRecipient.deleteMany({ where: { reminderId: r.id } })
      if (r.audience === 'LIST' && r.recipients.length) {
        await tx.reminderRecipient.createMany({
          data: r.recipients.map((uid) => ({ reminderId: r.id, userId: uid })),
        })
      }

      const forRebuild: ReminderForRebuild = {
        id: r.id,
        pageId: input.pageId,
        workspaceId: page.workspaceId,
        createdById: prev?.createdById ?? userId,
        dueAt: new Date(r.dueAt),
        offsets: r.offsets,
        audience: r.audience,
        label: r.label,
        recipients: r.recipients,
        doneAt: r.doneAt ? new Date(r.doneAt) : null,
      }
      await scheduler.rebuild(tx, forRebuild)
    }

    const toDelete = [...existingById.keys()].filter((id) => !incomingIds.has(id))
    if (toDelete.length) {
      await tx.reminder.updateMany({
        where: { id: { in: toDelete }, deletedAt: null },
        data: { deletedAt: new Date() },
      })
      await scheduler.cancel(tx, toDelete, 'reminder removed')
    }
  })

  return { ok: true }
}
```

- [ ] **Step 4: Create `reminders/index.ts` barrel**

`packages/domain/src/reminders/index.ts`:
```ts
export * from './functions.ts'
export * from './ports.ts'
export * from './schemas.ts'
export * from './sync.ts'
```

- [ ] **Step 5: Update `packages/domain/src/index.ts`**

Before:
```ts
export * from './errors.ts'
export * from './favorites/index.ts'
export * from './kanban/index.ts'
export * from './notifications/index.ts'
```

After:
```ts
export * from './errors.ts'
export * from './favorites/index.ts'
export * from './kanban/index.ts'
export * from './notifications/index.ts'
export * from './reminders/index.ts'
```

- [ ] **Step 6: Run tests + check-types**

Run: `pnpm --filter @repo/domain test && pnpm --filter @repo/domain check-types`
Expected: PASS, clean.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/reminders/sync.ts packages/domain/src/reminders/index.ts \
        packages/domain/src/index.ts packages/domain/test/reminders/sync.test.ts
git commit -m "$(cat <<'EOF'
feat(domain): add syncReminders (batch reconcile) ported verbatim from tRPC syncForPage

Recipient validation + transaction upsert/rebuild/cancel loop matches tRPC exactly.
FORBIDDEN thrown for non-OWNER/ADMIN/EDITOR. BAD_REQUEST for non-member LIST recipients.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: tRPC `reminder.ts` — `syncForPage` delegates to domain

**Files:**
- Modify: `packages/trpc/src/routers/reminder.ts`

- [ ] **Step 1: Rewrite `reminder.ts`**

The full new content of `packages/trpc/src/routers/reminder.ts`:
```ts
import { router, protectedProcedure } from '../trpc'
import {
  rebuildDeliveries,
  cancelPendingDeliveries,
} from '@repo/notifications'
import * as domain from '@repo/domain'
import { mapDomain } from '../helpers/map-domain'

const scheduler = {
  rebuild: rebuildDeliveries,
  cancel: cancelPendingDeliveries,
}

export const reminderRouter = router({
  syncForPage: protectedProcedure
    .input(domain.syncRemindersInput)
    .mutation(async ({ ctx, input }) => {
      return mapDomain(() => domain.syncReminders(ctx.prisma, ctx.user.id, input, scheduler))
    }),
})
```

- [ ] **Step 2: Run tRPC tests + check-types**

Run: `pnpm --filter @repo/trpc test && pnpm --filter @repo/trpc check-types`
Expected: PASS. The existing reminder test suite is the regression guard; the input schema is behaviorally identical to the original `reminderSyncSchema` + `{ pageId, reminders }` shape (same field names, same constraints).

- [ ] **Step 3: Commit**

```bash
git add packages/trpc/src/routers/reminder.ts
git commit -m "$(cat <<'EOF'
refactor(trpc): reminder syncForPage delegates to domain.syncReminders + injects scheduler

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: engines `ReminderService` delegates to domain — fixes the delivery bug

**Files:**
- Modify: `apps/engines/src/apps/mcp/services/reminder.service.ts`
- Create: `apps/engines/src/apps/mcp/services/reminder.service.spec.ts`

The `ReminderTools` and `mcp.module.ts` are **not changed** — the tool names, parameters, and module wiring are identical to today. `@Optional()` on the `scheduler` constructor param means Nest resolves it to `undefined` when no provider is registered (the default), so the service falls back to `realScheduler` automatically. No provider registration or module change is needed.

- [ ] **Step 1: Write the failing test**

`apps/engines/src/apps/mcp/services/reminder.service.spec.ts`:
```ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { PrismaClient } from '@repo/db'

// SP1 pattern: NO jest.unstable_mockModule. Import the service normally; the REAL
// @repo/domain functions run against a hand-mocked PrismaClient. The scheduler is
// stubbed via the @Optional() constructor param (Correction 2).
import { ReminderService } from './reminder.service.js'

function makeStubScheduler() {
  return {
    rebuild: jest.fn<(...a: unknown[]) => Promise<void>>(async () => undefined),
    cancel: jest.fn<(...a: unknown[]) => Promise<void>>(async () => undefined),
  }
}

function makeMockPrisma() {
  const txFindMany = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => [{ id: 'r1' }])
  const txUpdateMany = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ count: 1 }))
  const txCreate = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({
    id: 'r1',
    pageId: 'p1',
    workspaceId: 'w1',
    createdById: 'u1',
    dueAt: new Date(),
    offsets: [0],
    audience: 'ME',
    label: null,
    recipients: [],
    doneAt: null,
  }))
  const txUpdate = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({
    id: 'r1',
    dueAt: new Date(),
  }))
  const txRecipientFindMany = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => [])
  const txRecipientDeleteMany = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ count: 0 }))
  const tx = {
    reminder: { create: txCreate, update: txUpdate, updateMany: txUpdateMany, findMany: txFindMany, findUnique: jest.fn() },
    reminderRecipient: { findMany: txRecipientFindMany, deleteMany: txRecipientDeleteMany },
  }
  const pageFindFirst = jest.fn<(...a: unknown[]) => Promise<unknown>>(
    async () => ({ id: 'p1', workspaceId: 'w1', createdById: 'u1' }),
  )
  const reminderFindUnique = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({
    id: 'r1',
    pageId: 'p1',
    workspaceId: 'w1',
    createdById: 'u1',
    dueAt: new Date(),
    offsets: [0],
    audience: 'ME',
    label: null,
    doneAt: null,
  }))
  const reminderFindMany = jest.fn<(...a: unknown[]) => Promise<unknown>>(async () => [])
  const $transaction = jest.fn<(...a: unknown[]) => Promise<unknown>>(
    async (fn: unknown) => (fn as (t: typeof tx) => unknown)(tx),
  )
  return {
    page: { findFirst: pageFindFirst },
    reminder: { findUnique: reminderFindUnique, findMany: reminderFindMany, updateMany: txUpdateMany },
    $transaction,
    __mocks: { txCreate, txUpdate, txUpdateMany, txFindMany, pageFindFirst, reminderFindUnique, reminderFindMany, $transaction },
  } as unknown as PrismaClient & { __mocks: Record<string, ReturnType<typeof jest.fn>> }
}

describe('ReminderService', () => {
  let mockPrisma: ReturnType<typeof makeMockPrisma>
  let stubScheduler: ReturnType<typeof makeStubScheduler>
  let svc: ReminderService

  beforeEach(() => {
    jest.clearAllMocks()
    mockPrisma = makeMockPrisma()
    stubScheduler = makeStubScheduler()
    // Pass stubScheduler as the @Optional() second param so real @repo/notifications is NOT called
    svc = new ReminderService(mockPrisma, stubScheduler)
  })

  it('createReminder creates reminder via prisma tx and calls stubScheduler.rebuild', async () => {
    const result = await svc.createReminder({
      userId: 'u1',
      workspaceId: 'w1',
      pageId: 'p1',
      dueAt: new Date(),
      offsets: [0],
      audience: 'ME',
    })
    expect(result).toBe('r1')
    expect(mockPrisma.__mocks.txCreate).toHaveBeenCalledOnce()
    expect(stubScheduler.rebuild).toHaveBeenCalledOnce()
    expect(stubScheduler.cancel).not.toHaveBeenCalled()
  })

  it('moveReminder updates dueAt in tx and calls stubScheduler.rebuild', async () => {
    const result = await svc.moveReminder({ userId: 'u1', reminderId: 'r1', dueAt: new Date() })
    expect(result.id).toBe('r1')
    expect(mockPrisma.__mocks.txUpdate).toHaveBeenCalledOnce()
    expect(stubScheduler.rebuild).toHaveBeenCalledOnce()
  })

  it('deleteReminder soft-deletes in tx and calls stubScheduler.cancel', async () => {
    const result = await svc.deleteReminder({ userId: 'u1', reminderId: 'r1' })
    expect(result).toEqual({ count: 1 })
    expect(stubScheduler.cancel).toHaveBeenCalledWith(expect.anything(), ['r1'], 'reminder removed')
  })

  it('deleteReminder passes full input shape ({ reminderIds, pageId }) to domain.deleteReminder', async () => {
    await svc.deleteReminder({ userId: 'u1', reminderIds: ['r1', 'r2'], all: true })
    expect(stubScheduler.cancel).toHaveBeenCalledOnce()
  })

  it('completeReminder calls stubScheduler.cancel with completed reason', async () => {
    mockPrisma.__mocks.txUpdateMany.mockResolvedValue({ count: 1 })
    const result = await svc.completeReminder({ userId: 'u1', reminderId: 'r1' })
    expect(result).toEqual({ id: 'r1' })
    expect(stubScheduler.cancel).toHaveBeenCalledWith(expect.anything(), ['r1'], 'reminder completed')
  })

  it('listReminders uses direct Prisma (scheduler is never called)', async () => {
    mockPrisma.__mocks.reminderFindMany.mockResolvedValue([])
    await svc.listReminders({ userId: 'u1' })
    expect(mockPrisma.__mocks.reminderFindMany).toHaveBeenCalled()
    expect(stubScheduler.rebuild).not.toHaveBeenCalled()
    expect(stubScheduler.cancel).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter engines test -- reminder.service`
Expected: FAIL.

- [ ] **Step 3: Rewrite `reminder.service.ts`** — the full new content

`apps/engines/src/apps/mcp/services/reminder.service.ts`:
```ts
import { Inject, Injectable, Optional } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'
import * as domain from '@repo/domain'
import type { DeliveryScheduler } from '@repo/domain'
import { rebuildDeliveries, cancelPendingDeliveries } from '@repo/notifications'

import { PRISMA } from '../../../infra/db/db.providers.js'

export type CreateReminderInput = {
  userId: string
  workspaceId: string
  pageId: string
  dueAt: Date
  label?: string | null
  audience?: 'ME' | 'WORKSPACE' | 'LIST'
  offsets?: number[]
}
export type ListRemindersInput = {
  userId: string
  workspaceId?: string
  pageId?: string
  includeDone?: boolean
}
export type MoveReminderInput = {
  userId: string
  reminderId: string
  dueAt?: Date
  shift?: { days?: number; hours?: number; minutes?: number }
}
export type DeleteReminderInput = {
  userId: string
  reminderId?: string
  reminderIds?: string[]
  all?: boolean
  pageId?: string
}

const realScheduler: DeliveryScheduler = {
  rebuild: rebuildDeliveries,
  cancel: cancelPendingDeliveries,
}

@Injectable()
export class ReminderService {
  private readonly scheduler: DeliveryScheduler

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    // @Optional() so Nest resolves undefined in production → falls back to realScheduler.
    // Unit tests pass a stub scheduler as the second constructor arg (no DI change needed).
    // mcp.module.ts is UNCHANGED: @Optional() makes the unregistered param resolve to undefined → real.
    @Optional() scheduler?: DeliveryScheduler,
  ) {
    this.scheduler = scheduler ?? realScheduler
  }

  async createReminder(input: CreateReminderInput): Promise<string> {
    const result = await domain.createReminder(
      this.prisma,
      input.userId,
      {
        pageId: input.pageId,
        dueAt: input.dueAt,
        offsets: input.offsets ?? [],
        audience: input.audience ?? 'ME',
        label: input.label ?? null,
      },
      this.scheduler,
    )
    return result.reminderId
  }

  async listReminders(input: ListRemindersInput) {
    const rows = await this.prisma.reminder.findMany({
      where: {
        deletedAt: null,
        OR: [{ createdById: input.userId }, { recipients: { some: { userId: input.userId } } }],
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        ...(input.pageId ? { pageId: input.pageId } : {}),
        ...(input.includeDone ? {} : { doneAt: null }),
      },
      select: {
        id: true,
        label: true,
        dueAt: true,
        doneAt: true,
        page: { select: { id: true, title: true } },
        workspace: { select: { id: true, name: true } },
      },
      orderBy: { dueAt: 'asc' },
      take: 200,
    })
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      dueAt: r.dueAt,
      done: r.doneAt != null,
      page: r.page,
      workspace: r.workspace,
    }))
  }

  async moveReminder(input: MoveReminderInput): Promise<{ id: string; dueAt: Date }> {
    return domain.moveReminder(
      this.prisma,
      input.userId,
      { reminderId: input.reminderId, dueAt: input.dueAt, shift: input.shift },
      this.scheduler,
    )
  }

  async deleteReminder(input: DeleteReminderInput): Promise<{ count: number }> {
    // Delegates the full { reminderId, reminderIds, all, pageId } shape to domain.deleteReminder
    // which replicates the original engines where-clause and cancels matched deliveries atomically.
    return domain.deleteReminder(
      this.prisma,
      input.userId,
      {
        reminderId: input.reminderId,
        reminderIds: input.reminderIds,
        all: input.all,
        pageId: input.pageId,
      },
      this.scheduler,
    )
  }

  async completeReminder(input: { userId: string; reminderId: string }): Promise<{ id: string }> {
    return domain.completeReminder(
      this.prisma,
      input.userId,
      { reminderId: input.reminderId },
      this.scheduler,
    )
  }
}
```

- [ ] **Step 4: Run tests + check-types**

Run: `pnpm --filter engines test -- reminder && pnpm --filter engines check-types`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/engines/src/apps/mcp/services/reminder.service.ts \
        apps/engines/src/apps/mcp/services/reminder.service.spec.ts
git commit -m "$(cat <<'EOF'
fix(mcp): reminder service delegates to domain with scheduler injection — fixes delivery bug

Engines reminder writes now call rebuildDeliveries/cancelPendingDeliveries inside the domain
transaction. Previously, delivery rows were never created for agent-created reminders.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Capstone integration test — `reminders-domain.e2e.spec.ts`

**Files:**
- Create: `apps/engines/test/integration/reminders-domain.e2e.spec.ts`

This mirrors `kanban-domain.e2e.spec.ts` exactly: seeds real DB rows, constructs the service with `prisma` directly, exercises `createReminder`, asserts `notificationDelivery` rows were created (proving the delivery bug is fixed).

- [ ] **Step 1: Write the integration test**

`apps/engines/test/integration/reminders-domain.e2e.spec.ts`:
```ts
import { afterAll, afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import { prisma } from '@repo/db'

import { ReminderService } from '../../src/apps/mcp/services/reminder.service.js'

/**
 * Proves the engines write path runs end-to-end against a real Postgres:
 *   ReminderService → @repo/domain → injected rebuildDeliveries → DB.
 * This is the only layer that exercises domain.createReminder against a live database —
 * unit suites both mock Prisma. Requires `docker compose up -d`.
 *
 * Fix validated: before this change, engines ReminderService.createReminder never wrote
 * notificationDelivery rows. After this change, at least one IN_APP delivery row exists.
 */
describe('Reminders engines → @repo/domain → DB (integration)', () => {
  const svc = new ReminderService(prisma)

  let workspaceId: string
  let userId: string
  let pageId: string

  beforeEach(async () => {
    const ws = await prisma.workspace.create({ data: { name: 'reminders-domain-int' } })
    workspaceId = ws.id
    const user = await prisma.user.create({
      data: {
        name: 'Reminder User',
        firstName: 'R',
        lastName: 'U',
        email: `reminder-${workspaceId}@e.com`,
        emailVerified: true,
      },
    })
    userId = user.id
    await prisma.workspaceMember.create({ data: { workspaceId, userId, role: 'EDITOR' } })
    const page = await prisma.page.create({
      data: { workspaceId, title: 'Reminder Test', type: 'TEXT', createdById: userId, updatedById: userId },
    })
    pageId = page.id
  })

  afterEach(async () => {
    await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined)
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined)
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('createReminder creates the reminder and schedules at least one IN_APP delivery row', async () => {
    const reminderId = await svc.createReminder({
      userId,
      workspaceId,
      pageId,
      dueAt: new Date(Date.now() + 3_600_000), // 1 hour from now
      offsets: [0],
      audience: 'ME',
    })

    expect(typeof reminderId).toBe('string')

    const reminder = await prisma.reminder.findUniqueOrThrow({ where: { id: reminderId } })
    expect(reminder.pageId).toBe(pageId)
    expect(reminder.workspaceId).toBe(workspaceId)
    expect(reminder.createdById).toBe(userId)

    // The key assertion: delivery scheduling now runs inside the domain transaction.
    const deliveries = await prisma.notificationDelivery.findMany({
      where: {
        event: {
          type: 'REMINDER_DUE',
          payload: { path: ['reminderId'], equals: reminderId },
        },
        status: 'PENDING',
        channel: 'IN_APP',
      },
    })
    expect(deliveries.length).toBeGreaterThanOrEqual(1)
  })
})
```

- [ ] **Step 2: Run the integration test**

Run: `docker compose up -d && pnpm --filter engines test-int -- reminders-domain`
Expected: PASS — the assertion `deliveries.length >= 1` is green, proving the delivery bug is fixed.

- [ ] **Step 3: Commit**

```bash
git add apps/engines/test/integration/reminders-domain.e2e.spec.ts
git commit -m "$(cat <<'EOF'
test(domain): capstone integration test — reminders engines→domain→DB delivery fix

Asserts notificationDelivery row is created when engines ReminderService.createReminder runs
against a real Postgres, proving the delivery scheduling bug is fixed end-to-end.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase E — Verify + close out

### Task 14: Full gates + drift-guard + spec status

**Files:**
- Modify: `apps/web/test/agents-token.test.ts` (confirm no new scopes needed — read and verify only)
- Modify: `docs/superpowers/specs/2026-05-29-domain-notifications-favorites-reminders-design.md`

- [ ] **Step 1: Verify `agents-token.test.ts` drift-guard is still satisfied**

Run: `pnpm --filter web test -- agents-token`
Expected: PASS — no new scopes were added. `markAllNotificationsRead` reuses `SCOPE_NOTIFICATIONS_WRITE` (`notifications:write`), and `reorderFavorites` reuses `SCOPE_FAVORITES_WRITE` (`favorites:write`), both already in `WRITE_SCOPES` in `agents-token.ts`. No edits to this test file are needed.

- [ ] **Step 2: Clean `.next/types` if stale**

If `pnpm --filter web check-types` reports `TS2307 'cannot find module .../route.js'` for a deleted route, run:
```bash
rm -rf apps/web/.next/types
```
Then re-run check-types.

- [ ] **Step 3: Full gates**

Run: `pnpm gates`
Expected: check-types + lint + build + test all PASS. `@repo/domain` builds first via turbo `^build` because both `@repo/trpc` and `apps/engines` declare it as a dependency.

- [ ] **Step 4: Mark spec implemented**

In `docs/superpowers/specs/2026-05-29-domain-notifications-favorites-reminders-design.md`, change:
```
**Status:** Draft, awaiting user review
```
to:
```
**Status:** Implemented
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-05-29-domain-notifications-favorites-reminders-design.md
git commit -m "$(cat <<'EOF'
chore(domain): SP2 gates green — mark spec implemented

pnpm gates clean. agents-token drift-guard passes (no new scopes).
markAllNotificationsRead reuses notifications:write; reorderFavorites reuses favorites:write.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Task 1: `@repo/notifications` import risk validated under engines NodeNext before any reminders work. ✔
- Tasks 2–4 (Notifications): domain `markRead`/`markAllRead`/`deleteAll` extracted; tRPC wrappers thin; engines delegates + new `markAllNotificationsRead` tool. `setPreference` + push-subscriptions intentionally stay in tRPC (not duplicated; `EVENT_CATALOG` dependency). ✔
- Tasks 5–7 (Favorites): domain `addFavorite`/`removeFavorite`/`reorderFavorites` extracted; position off-by-one fixed (domain uses tRPC's `(_max ?? -1)+1 = 0-based`); tRPC pre-checks (`assertPageAccess` + `requireWritableWorkspace` / `assertWorkspaceMember`) preserved in the wrapper; new `reorderFavorites` MCP tool added. `removeFavorite` domain fn returns `{ count }` (no assertPageAccess — users can un-favorite a page they've lost access to); tRPC wrapper adds its own assertPageAccess and maps to `{ pageId }`; engines `FavoriteService.remove` returns `{ count }`. ✔
- Tasks 8–10 (Reminders — ports + functions + sync): `DeliveryScheduler` port defined in domain without importing `@repo/notifications`; granular functions (`createReminder`/`moveReminder`/`deleteReminder`/`completeReminder`) all call scheduler inside `$transaction`; `syncReminders` ported verbatim from tRPC `syncForPage` including recipient validation and LIST upsert loop. ✔
- Task 11 (tRPC reminder): `syncForPage` becomes a one-liner wrapper injecting the scheduler. ✔
- Task 12 (engines reminder): delivery bug fixed — all four write methods now call domain functions which schedule deliveries atomically. `listReminders` stays direct-Prisma. ✔
- Task 13: Capstone integration test proves delivery scheduling end-to-end against live Postgres. ✔
- Task 14: Full gates + drift-guard verified; no new scopes (two new tools reuse existing scopes). ✔

**Type/name consistency:**
- Domain function names: `markRead`, `markAllRead`, `deleteAll` (notifications); `addFavorite`, `removeFavorite`, `reorderFavorites` (favorites); `createReminder`, `moveReminder`, `deleteReminder`, `completeReminder`, `syncReminders` (reminders). Used identically in tRPC wrappers, engines services, and domain barrel.
- `mapDomain` imported from `../../helpers/map-domain` in tRPC (already exists from SP1).
- `mapDomainError` not used here — engines reminder/notification/favorite services import domain directly and let `DomainError` propagate; tools call `this.svc.method()` and exceptions bubble to the existing `McpExceptionFilter`.
- `ReminderForRebuild` re-declared in `domain/reminders/ports.ts` matches `@repo/notifications` shape structurally — zero adapter code needed.

**Placeholder scan:** none — every step has complete verbatim code. Every Modify step shows the exact before and after text.

**Return-shape audit:**
- `markRead` → `{ updated: number }` ✔ (matches tRPC `result.count` → `{ updated: result.count }`)
- `markAllRead` → `{ updated: number }` ✔
- `deleteAll` → `{ deleted: number }` ✔
- `addFavorite` → `favoritePage` row (tRPC returns the full upsert result) ✔
- `domain.removeFavorite` → `{ count: number }` (deleteMany result; no assertPageAccess) ✔
- tRPC `removeFavorite` wrapper → `{ pageId: string }` ✔ (wrapper runs assertPageAccess + requireWritableWorkspace, then delegates and returns `{ pageId }`)
- engines `FavoriteService.remove` → `{ count: number }` ✔ (delegates directly to domain.removeFavorite)
- `reorderFavorites` → `{ ok: true }` ✔
- `createReminder` → `{ reminderId: string }` ✔ (engines returns `.reminderId`)
- `moveReminder` → `{ id: string; dueAt: Date }` ✔
- `deleteReminder` → `{ count: number }` ✔
- `completeReminder` → `{ id: string }` ✔
- `syncReminders` → `{ ok: true }` ✔

---

## Notes for the executor

- **Task 1 first, always.** The spike validates whether `@repo/notifications` resolves cleanly under engines NodeNext before you touch anything in the reminders tasks. If the spike fails, fix `@repo/notifications` first; the fallback sub-steps in Task 1 describe exactly what to change. Do not proceed to Task 8+ until the spike is clean.
- **`@repo/domain` must be built** (`pnpm --filter @repo/domain build`) before `@repo/trpc` or engines `check-types` in CI. Turbo's `^build` handles this because both consumers declare `@repo/domain` as a dependency. Locally, run the domain build once after Task 2.
- **Notifications `list`/`unreadCount`/`getPreferences`/`setPreference`/push-subscription procedures are untouched.** Do not touch them. Only the three mutations listed in Tasks 2–4 change.
- **Favorites `listFavorites` is untouched.** Only the three write procedures change.
- **Reminders `listReminders` stays direct-Prisma** in `reminder.service.ts`. The `list` method in the rewritten service is an exact port of the original.
- **`ReminderTools` and `mcp.module.ts` are NOT changed** in Task 12. The tool names, parameters, zod schemas, and module providers/exports for reminders are identical to today — only the service body changes.
- **`deleteReminder` in engines (Task 12):** the rewritten `ReminderService.deleteReminder` delegates the full `{ reminderId?, reminderIds[]?, all?, pageId? }` shape directly to `domain.deleteReminder`. The domain function replicates the original engines where-clause (using `id: { in: ids }` when ids are given, `pageId` filter when set, and matching all active user reminders when neither is provided). `all` is preserved in the input type for tool compatibility but — as in the original — is not used in the where clause. `scheduler.cancel` is called atomically inside the domain transaction with the matched ids.
- **Conventional Commits with scope** at every step. The scope maps to the package changed: `domain`, `trpc`, `mcp`, `test(domain)`, `chore(domain)`. Husky runs lint-staged on commit — run `pnpm lint` if the hook fails before re-trying.
- **Recommended task order:** 1 → 2 → 3 → 4 (notification phase complete, independently green) → 5 → 6 → 7 (favorites phase complete) → 8 → 9 → 10 → 11 → 12 → 13 (reminders phase complete) → 14 (verify). Each phase is independently green and committable.
