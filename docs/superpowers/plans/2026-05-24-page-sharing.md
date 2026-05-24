# Page Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a page owner share any page via a 64-char public link `/s/{shareId}` and/or named platform users, with reader/commenter/editor roles, where read/write is enforced server-side in the Yjs server.

**Architecture:** A `PageShare` (+ `PageShareUser`) row per page drives a single access-resolution function. All shared viewing happens through a public `/s/{shareId}` route that renders the existing `PageRenderer`; the editor connects to Yjs with a short-lived **share token** (HS256, shared secret) minted by `apps/web`. `apps/yjs` recognises share tokens, sets the connection `readOnly` for reader/commenter, and supports anonymous editors. Commenter == read-only-for-content until the separate comments spec (#2).

**Tech Stack:** Prisma 7 / Postgres, tRPC v11 + Zod, Next.js 16 App Router (RSC + client), MUI v6 via `@repo/ui`, Hocuspocus (`@repo/yjs-server`), `jose` for JWT, Vitest (unit/tRPC), Playwright (E2E).

**Spec:** `docs/superpowers/specs/2026-05-24-page-sharing-design.md`

---

## File Structure

**Create:**
- `packages/db/prisma/migrations/<ts>_page_sharing/migration.sql` — generated.
- `apps/web/src/lib/share-access.ts` — `resolveShareAccess(prisma, shareId, session)` + `mapMemberRole`; the single viewing-resolution authority (used by the `/s/` route and the share-token endpoint).
- `apps/web/test/share-access.test.ts` — resolution matrix.
- `packages/trpc/src/routers/page-share.ts` — `pageShareRouter` (`get`, `ensure`, `setAccess`, `addUser`, `updateUser`, `removeUser`).
- `packages/trpc/test/page-share-router.test.ts` — router CRUD + authz.
- `packages/trpc/test/user-search.test.ts` — `user.search` limits.
- `apps/web/src/components/page/share-dialog.tsx` — the «Общий доступ» dialog.
- `apps/web/src/components/page/share-button.tsx` — the «Поделиться» primary button.
- `apps/web/src/app/api/yjs/share-token/route.ts` — mints the share JWT.
- `apps/web/src/app/(share)/layout.tsx` — minimal public layout.
- `apps/web/src/app/(share)/s/[shareId]/page.tsx` — public share route (RSC).
- `apps/web/src/app/(share)/s/[shareId]/share-page-client.tsx` — client wrapper around `PageRenderer`.

**Modify:**
- `packages/db/prisma/schema.prisma` — enums `PageShareAccess`, `PageShareRole`; models `PageShare`, `PageShareUser`; back-relations on `Page`, `User`.
- `packages/trpc/src/helpers/page-access.ts` — add `assertCanManageShare`.
- `packages/trpc/src/routers/page.ts` — mount `share: pageShareRouter`.
- `packages/trpc/src/routers/user.ts` — add `search`.
- `packages/ui/src/components/index.ts` — add `ScreenShareIcon`, `LockIcon`, `PublicIcon`.
- `apps/web/src/components/page/page-actions-toolbar.tsx` — render `<ShareButton>` left of `<FavoriteStar>`.
- `apps/web/src/components/page/page-renderer.tsx` — optional `yjsToken` + `editable` props.
- `apps/yjs/src/env.ts` — `shareTokenSecret`.
- `apps/yjs/src/auth.ts` — `verifyShareToken`, `loadPageMeta`.
- `apps/yjs/src/index.ts` — share-token branch in `onAuthenticate` + `connection.readOnly`.
- `.env.example`, `turbo.json` (`globalEnv`) — `YJS_SHARE_TOKEN_SECRET`.
- `apps/e2e/page-sharing.spec.ts` — E2E.

---

# Phase 1 — Data model + access resolution

### Task 1: Prisma models, enums, migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add enums** after the `PageType` enum block (`schema.prisma:182-193`):

```prisma
enum PageShareAccess {
  RESTRICTED
  PUBLIC
}

enum PageShareRole {
  READER
  COMMENTER
  EDITOR
}
```

- [ ] **Step 2: Add models** immediately after the `Page` model (`schema.prisma:356`):

```prisma
model PageShare {
  id          String          @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  pageId      String          @unique @map("page_id") @db.Uuid
  shareId     String          @unique @map("share_id") @db.VarChar(64)
  access      PageShareAccess @default(RESTRICTED)
  linkRole    PageShareRole   @default(READER) @map("link_role")
  createdById String          @map("created_by_id") @db.Uuid
  createdAt   DateTime        @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime        @updatedAt @map("updated_at") @db.Timestamptz(6)

  page      Page            @relation(fields: [pageId], references: [id], onDelete: Cascade)
  createdBy User            @relation("PageShareCreatedBy", fields: [createdById], references: [id], onDelete: Cascade)
  users     PageShareUser[]

  @@index([shareId])
  @@map("page_shares")
}

model PageShareUser {
  id          String        @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  pageShareId String        @map("page_share_id") @db.Uuid
  userId      String        @map("user_id") @db.Uuid
  role        PageShareRole @default(READER)
  createdAt   DateTime      @default(now()) @map("created_at") @db.Timestamptz(6)

  pageShare PageShare @relation(fields: [pageShareId], references: [id], onDelete: Cascade)
  user      User      @relation("PageShareGrant", fields: [userId], references: [id], onDelete: Cascade)

  @@unique([pageShareId, userId])
  @@index([userId])
  @@map("page_share_users")
}
```

- [ ] **Step 3: Add back-relations.** In `model Page` (after the `favorites` relation, `schema.prisma:339`) add:

```prisma
  share            PageShare?
```

In `model User` (after `updatedPages`, `schema.prisma:27`) add:

```prisma
  pageSharesCreated    PageShare[]       @relation("PageShareCreatedBy")
  pageShareGrants      PageShareUser[]   @relation("PageShareGrant")
```

- [ ] **Step 4: Create + apply the migration**

Run: `pnpm --filter @repo/db exec prisma migrate dev --name page_sharing`
Expected: migration created under `packages/db/prisma/migrations/`, applied, `Prisma Client` regenerated, no errors.

- [ ] **Step 5: Verify the client compiles with the new types**

Run: `pnpm --filter @repo/db exec prisma generate && pnpm --filter @repo/trpc check-types`
Expected: PASS (no type errors).

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): add PageShare and PageShareUser models"
```

---

### Task 2: `resolveShareAccess` viewing-resolution authority

**Files:**
- Create: `apps/web/src/lib/share-access.ts`
- Test: `apps/web/test/share-access.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest'

import { resolveShareAccess, mapMemberRole } from '@/lib/share-access'

const PAGE = {
  id: 'p1',
  type: 'TEXT',
  title: 'Doc',
  icon: null,
  contentYjs: null,
  workspaceId: 'w1',
  createdById: 'owner',
}

function prismaWith(opts: {
  share: unknown
  member?: { role: string } | null
  grant?: { role: string } | null
}) {
  return {
    pageShare: { findUnique: vi.fn(async () => opts.share) },
    workspaceMember: { findUnique: vi.fn(async () => opts.member ?? null) },
    pageShareUser: { findFirst: vi.fn(async () => opts.grant ?? null) },
  } as never
}

const shareRestricted = { shareId: 's', access: 'RESTRICTED', linkRole: 'READER', page: PAGE }
const sharePublicEditor = { shareId: 's', access: 'PUBLIC', linkRole: 'EDITOR', page: PAGE }

describe('mapMemberRole', () => {
  it('maps workspace roles to effective roles', () => {
    expect(mapMemberRole('OWNER')).toBe('OWNER')
    expect(mapMemberRole('ADMIN')).toBe('EDITOR')
    expect(mapMemberRole('EDITOR')).toBe('EDITOR')
    expect(mapMemberRole('COMMENTER')).toBe('COMMENTER')
    expect(mapMemberRole('VIEWER')).toBe('READER')
    expect(mapMemberRole('GUEST')).toBe('READER')
  })
})

describe('resolveShareAccess', () => {
  it('returns not_found when no share exists', async () => {
    const res = await resolveShareAccess(prismaWith({ share: null }), 's', null)
    expect(res.share).toBeNull()
    expect(res.role).toBeNull()
  })

  it('denies anonymous on a restricted page', async () => {
    const res = await resolveShareAccess(prismaWith({ share: shareRestricted }), 's', null)
    expect(res.role).toBeNull()
    expect(res.page).not.toBeNull()
  })

  it('gives anonymous the link role on a public page', async () => {
    const res = await resolveShareAccess(prismaWith({ share: sharePublicEditor }), 's', null)
    expect(res.role).toBe('EDITOR')
  })

  it('prefers workspace membership over link role', async () => {
    const session = { user: { id: 'u1' } } as never
    const res = await resolveShareAccess(
      prismaWith({ share: sharePublicEditor, member: { role: 'VIEWER' } }),
      's',
      session,
    )
    expect(res.role).toBe('READER') // VIEWER beats public EDITOR link
  })

  it('uses a named grant when not a member', async () => {
    const session = { user: { id: 'u1' } } as never
    const res = await resolveShareAccess(
      prismaWith({ share: shareRestricted, member: null, grant: { role: 'COMMENTER' } }),
      's',
      session,
    )
    expect(res.role).toBe('COMMENTER')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test -- share-access`
Expected: FAIL — cannot find module `@/lib/share-access`.

- [ ] **Step 3: Implement `share-access.ts`**

```ts
import 'server-only'

import type { PrismaClient } from '@repo/db'

export type EffectiveRole = 'OWNER' | 'EDITOR' | 'COMMENTER' | 'READER'

type SessionLike = { user: { id: string } } | null

type SharePage = {
  id: string
  type: string
  title: string | null
  icon: string | null
  contentYjs: Uint8Array | Buffer | null
  workspaceId: string
  createdById: string | null
}

export function mapMemberRole(role: string): EffectiveRole {
  switch (role) {
    case 'OWNER':
      return 'OWNER'
    case 'ADMIN':
    case 'EDITOR':
      return 'EDITOR'
    case 'COMMENTER':
      return 'COMMENTER'
    default:
      return 'READER' // VIEWER, GUEST
  }
}

/**
 * Single viewing-resolution authority. Priority:
 *   workspace member ▸ named grant ▸ public link role ▸ deny.
 * `share === null` => the link does not exist (caller should 404).
 */
export async function resolveShareAccess(
  prisma: Pick<PrismaClient, 'pageShare' | 'workspaceMember' | 'pageShareUser'>,
  shareId: string,
  session: SessionLike,
): Promise<{ share: { id: string } | null; page: SharePage | null; role: EffectiveRole | null }> {
  const share = await prisma.pageShare.findUnique({
    where: { shareId },
    select: {
      id: true,
      access: true,
      linkRole: true,
      page: {
        select: {
          id: true,
          type: true,
          title: true,
          icon: true,
          contentYjs: true,
          workspaceId: true,
          createdById: true,
        },
      },
    },
  })
  if (!share) return { share: null, page: null, role: null }

  const page = share.page as SharePage

  if (session?.user) {
    const member = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: page.workspaceId, userId: session.user.id } },
      select: { role: true },
    })
    if (member) return { share, page, role: mapMemberRole(member.role) }

    const grant = await prisma.pageShareUser.findFirst({
      where: { pageShareId: share.id, userId: session.user.id },
      select: { role: true },
    })
    if (grant) return { share, page, role: grant.role as EffectiveRole }
  }

  if (share.access === 'PUBLIC') {
    return { share, page, role: share.linkRole as EffectiveRole }
  }

  return { share, page, role: null }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test -- share-access`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/share-access.ts apps/web/test/share-access.test.ts
git commit -m "feat(web): add resolveShareAccess viewing-resolution helper"
```

---

# Phase 2 — tRPC API

### Task 3: `assertCanManageShare` + `page.share.get` / `ensure`

**Files:**
- Modify: `packages/trpc/src/helpers/page-access.ts`
- Create: `packages/trpc/src/routers/page-share.ts`
- Modify: `packages/trpc/src/routers/page.ts:16` (mount), `packages/trpc/src/routers/page.ts:1-12` (imports)
- Test: `packages/trpc/test/page-share-router.test.ts`

- [ ] **Step 1: Add `assertCanManageShare`** to `packages/trpc/src/helpers/page-access.ts` (after `assertPageOwnership`, line 49):

```ts
export async function assertCanManageShare(ctx: Ctx, pageId: string) {
  const page = await ctx.prisma.page.findFirst({
    where: {
      id: pageId,
      workspace: { members: { some: { userId: ctx.user.id } } },
    },
  })
  if (!page) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Страница не найдена' })
  }
  if (page.createdById === ctx.user.id) return page
  const member = await ctx.prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: page.workspaceId, userId: ctx.user.id } },
  })
  if (member?.role !== 'OWNER' && member?.role !== 'ADMIN') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав' })
  }
  return page
}
```

- [ ] **Step 2: Write the failing test** `packages/trpc/test/page-share-router.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@repo/auth', () => ({ getUserFromRequest: vi.fn() }))
vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return { ...actual, prisma: {} }
})

import type { PrismaClient } from '@repo/db'
import { pageShareRouter } from '../src/routers/page-share'
import { createCallerFactory } from '../src/trpc'

const USER_ID = '22222222-2222-2222-2222-222222222222'
const PAGE_ID = '33333333-3333-3333-3333-333333333333'
const SHARE_ID = '44444444-4444-4444-4444-444444444444'

function ctx(prisma: PrismaClient) {
  return {
    prisma,
    user: { id: USER_ID },
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {},
    returnUrlBase: 'http://localhost:3000',
  }
}

const caller = createCallerFactory(pageShareRouter)

const ownedPage = { id: PAGE_ID, workspaceId: 'w1', createdById: USER_ID }
const userRow = { id: USER_ID, firstName: 'A', lastName: 'B', email: 'a@b.c', image: null }

describe('page.share.get (read-only) + ensure (lazy create)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('get returns canManage + existing share without creating', async () => {
    const prisma = {
      page: { findFirst: vi.fn(async () => ownedPage) },
      workspaceMember: { findUnique: vi.fn(async () => ({ role: 'OWNER' })) },
      pageShare: {
        findUnique: vi.fn(async () => ({
          id: SHARE_ID, shareId: 'a'.repeat(64), access: 'RESTRICTED', linkRole: 'READER', users: [],
        })),
        create: vi.fn(),
      },
      user: { findUnique: vi.fn(async () => userRow) },
    } as never

    const res = await caller(ctx(prisma)).get({ pageId: PAGE_ID })
    expect(prisma.pageShare.create).not.toHaveBeenCalled()
    expect(res.canManage).toBe(true)
    expect(res.share?.shareId).toHaveLength(64)
  })

  it('get returns share: null when none exists (no creation on read)', async () => {
    const prisma = {
      page: { findFirst: vi.fn(async () => ownedPage) },
      workspaceMember: { findUnique: vi.fn(async () => ({ role: 'OWNER' })) },
      pageShare: { findUnique: vi.fn(async () => null), create: vi.fn() },
      user: { findUnique: vi.fn(async () => userRow) },
    } as never
    const res = await caller(ctx(prisma)).get({ pageId: PAGE_ID })
    expect(res.share).toBeNull()
    expect(prisma.pageShare.create).not.toHaveBeenCalled()
  })

  it('get forbids a non-owner non-admin member', async () => {
    const prisma = {
      page: { findFirst: vi.fn(async () => ({ ...ownedPage, createdById: 'someone-else' })) },
      workspaceMember: { findUnique: vi.fn(async () => ({ role: 'EDITOR' })) },
    } as never
    await expect(caller(ctx(prisma)).get({ pageId: PAGE_ID })).rejects.toThrow(/Недостаточно прав/)
  })

  it('ensure lazily creates a 64-char shareId', async () => {
    const created = { id: SHARE_ID, shareId: 'b'.repeat(64), access: 'RESTRICTED', linkRole: 'READER', users: [] }
    const prisma = {
      page: { findFirst: vi.fn(async () => ownedPage) },
      workspaceMember: { findUnique: vi.fn(async () => ({ role: 'OWNER' })) },
      pageShare: { findUnique: vi.fn(async () => null), create: vi.fn(async () => created) },
    } as never
    const res = await caller(ctx(prisma)).ensure({ pageId: PAGE_ID })
    expect(prisma.pageShare.create).toHaveBeenCalledOnce()
    expect(prisma.pageShare.create.mock.calls[0][0].data.shareId).toHaveLength(64)
    expect(res.shareId).toHaveLength(64)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @repo/trpc test -- page-share-router`
Expected: FAIL — cannot find module `../src/routers/page-share`.

- [ ] **Step 4: Implement `page-share.ts` with `get`**

```ts
import { randomBytes } from 'node:crypto'
import { z } from 'zod'

import { router, protectedProcedure } from '../trpc'
import { assertCanManageShare } from '../helpers/page-access'

function newShareId(): string {
  return randomBytes(32).toString('hex') // 64 hex chars, 256-bit entropy
}

const userSelect = { id: true, firstName: true, lastName: true, email: true, image: true } as const

const shareSelect = {
  id: true,
  shareId: true,
  access: true,
  linkRole: true,
  users: { select: { role: true, user: { select: userSelect } }, orderBy: { createdAt: 'asc' as const } },
} as const

export const pageShareRouter = router({
  // Read-only: never creates a row (so the toolbar manage-probe stays side-effect-free).
  get: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const page = await assertCanManageShare(ctx, input.pageId)
      const share = await ctx.prisma.pageShare.findUnique({
        where: { pageId: input.pageId },
        select: shareSelect,
      })
      const owner = page.createdById
        ? await ctx.prisma.user.findUnique({ where: { id: page.createdById }, select: userSelect })
        : null
      return { share, owner, canManage: true }
    }),

  // Lazy create-or-return; called when the dialog opens (spec: lazy on dialog open).
  ensure: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertCanManageShare(ctx, input.pageId)
      const existing = await ctx.prisma.pageShare.findUnique({
        where: { pageId: input.pageId },
        select: shareSelect,
      })
      if (existing) return existing
      return ctx.prisma.pageShare.create({
        data: { pageId: input.pageId, shareId: newShareId(), createdById: ctx.user.id },
        select: shareSelect,
      })
    }),
})
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @repo/trpc test -- page-share-router`
Expected: PASS.

- [ ] **Step 6: Mount the router.** In `packages/trpc/src/routers/page.ts`, add the import at line 12:

```ts
import { pageShareRouter } from './page-share'
```

Then add `share: pageShareRouter,` as the first key inside `router({` at line 16:

```ts
export const pageRouter = router({
  share: pageShareRouter,
  getById: protectedProcedure
```

- [ ] **Step 7: Verify types + tests**

Run: `pnpm --filter @repo/trpc check-types && pnpm --filter @repo/trpc test -- page-share-router`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/trpc/src/helpers/page-access.ts packages/trpc/src/routers/page-share.ts packages/trpc/src/routers/page.ts packages/trpc/test/page-share-router.test.ts
git commit -m "feat(trpc): page.share get (read-only) + ensure (lazy create)"
```

---

### Task 4: share mutations (`setAccess`, `addUser`, `updateUser`, `removeUser`)

**Files:**
- Modify: `packages/trpc/src/routers/page-share.ts`
- Test: `packages/trpc/test/page-share-router.test.ts`

- [ ] **Step 1: Add the failing tests** (append inside the test file, new `describe`)

```ts
describe('page.share mutations', () => {
  beforeEach(() => vi.clearAllMocks())

  function manageablePrisma(extra: Record<string, unknown>) {
    return {
      page: { findFirst: vi.fn(async () => ownedPage) },
      workspaceMember: { findUnique: vi.fn(async () => ({ role: 'OWNER' })) },
      ...extra,
    } as never
  }

  it('setAccess updates access + linkRole', async () => {
    const prisma = manageablePrisma({
      pageShare: {
        update: vi.fn(async () => ({ id: SHARE_ID, access: 'PUBLIC', linkRole: 'EDITOR' })),
      },
    })
    const res = await caller(ctx(prisma)).setAccess({ pageId: PAGE_ID, access: 'PUBLIC', linkRole: 'EDITOR' })
    expect(res.access).toBe('PUBLIC')
    expect(prisma.pageShare.update).toHaveBeenCalledWith({
      where: { pageId: PAGE_ID },
      data: { access: 'PUBLIC', linkRole: 'EDITOR' },
      select: { id: true, access: true, linkRole: true },
    })
  })

  it('addUser rejects an existing workspace member', async () => {
    const prisma = manageablePrisma({
      pageShare: { findUnique: vi.fn(async () => ({ id: SHARE_ID })) },
      workspaceMember: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ role: 'OWNER' }) // assertCanManageShare
          .mockResolvedValueOnce({ role: 'VIEWER' }), // target already a member
      },
    })
    await expect(
      caller(ctx(prisma)).addUser({ pageId: PAGE_ID, userId: 'member-1', role: 'READER' }),
    ).rejects.toThrow(/уже имеет доступ/)
  })

  it('removeUser deletes the grant', async () => {
    const prisma = manageablePrisma({
      pageShare: { findUnique: vi.fn(async () => ({ id: SHARE_ID })) },
      pageShareUser: { deleteMany: vi.fn(async () => ({ count: 1 })) },
    })
    await caller(ctx(prisma)).removeUser({ pageId: PAGE_ID, userId: 'grant-1' })
    expect(prisma.pageShareUser.deleteMany).toHaveBeenCalledWith({
      where: { pageShareId: SHARE_ID, userId: 'grant-1' },
    })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @repo/trpc test -- page-share-router`
Expected: FAIL — `setAccess`/`addUser`/`removeUser` not a function.

- [ ] **Step 3: Implement the mutations.** First add `import { TRPCError } from '@trpc/server'` to the imports and define the two enums above the router (now first used here):

```ts
const RoleSchema = z.enum(['READER', 'COMMENTER', 'EDITOR'])
const AccessSchema = z.enum(['RESTRICTED', 'PUBLIC'])
```

Then add these procedures inside `pageShareRouter` (after `ensure`) in `page-share.ts`:

```ts
  setAccess: protectedProcedure
    .input(z.object({ pageId: z.string().uuid(), access: AccessSchema, linkRole: RoleSchema }))
    .mutation(async ({ ctx, input }) => {
      await assertCanManageShare(ctx, input.pageId)
      return ctx.prisma.pageShare.update({
        where: { pageId: input.pageId },
        data: { access: input.access, linkRole: input.linkRole },
        select: { id: true, access: true, linkRole: true },
      })
    }),

  addUser: protectedProcedure
    .input(z.object({ pageId: z.string().uuid(), userId: z.string().uuid(), role: RoleSchema }))
    .mutation(async ({ ctx, input }) => {
      const page = await assertCanManageShare(ctx, input.pageId)
      if (input.userId === page.createdById) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Автор уже является владельцем' })
      }
      const member = await ctx.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: page.workspaceId, userId: input.userId } },
      })
      if (member) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Пользователь уже имеет доступ к пространству' })
      }
      const share = await ctx.prisma.pageShare.findUnique({
        where: { pageId: input.pageId },
        select: { id: true },
      })
      if (!share) throw new TRPCError({ code: 'NOT_FOUND', message: 'Доступ ещё не создан' })
      return ctx.prisma.pageShareUser.upsert({
        where: { pageShareId_userId: { pageShareId: share.id, userId: input.userId } },
        create: { pageShareId: share.id, userId: input.userId, role: input.role },
        update: { role: input.role },
        select: { role: true, user: { select: userSelect } },
      })
    }),

  updateUser: protectedProcedure
    .input(z.object({ pageId: z.string().uuid(), userId: z.string().uuid(), role: RoleSchema }))
    .mutation(async ({ ctx, input }) => {
      await assertCanManageShare(ctx, input.pageId)
      const share = await ctx.prisma.pageShare.findUnique({
        where: { pageId: input.pageId },
        select: { id: true },
      })
      if (!share) throw new TRPCError({ code: 'NOT_FOUND', message: 'Доступ ещё не создан' })
      return ctx.prisma.pageShareUser.update({
        where: { pageShareId_userId: { pageShareId: share.id, userId: input.userId } },
        data: { role: input.role },
        select: { role: true, user: { select: userSelect } },
      })
    }),

  removeUser: protectedProcedure
    .input(z.object({ pageId: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertCanManageShare(ctx, input.pageId)
      const share = await ctx.prisma.pageShare.findUnique({
        where: { pageId: input.pageId },
        select: { id: true },
      })
      if (!share) return { ok: true }
      await ctx.prisma.pageShareUser.deleteMany({
        where: { pageShareId: share.id, userId: input.userId },
      })
      return { ok: true }
    }),
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @repo/trpc test -- page-share-router`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/routers/page-share.ts packages/trpc/test/page-share-router.test.ts
git commit -m "feat(trpc): page.share setAccess/addUser/updateUser/removeUser"
```

---

### Task 5: `user.search`

**Files:**
- Modify: `packages/trpc/src/routers/user.ts`
- Test: `packages/trpc/test/user-search.test.ts`

- [ ] **Step 1: Write the failing test** `packages/trpc/test/user-search.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@repo/auth', () => ({ getUserFromRequest: vi.fn(), withVerificationResendContext: vi.fn() }))
vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return { ...actual, prisma: {} }
})

import type { PrismaClient } from '@repo/db'
import { userRouter } from '../src/routers/user'
import { createCallerFactory } from '../src/trpc'

const caller = createCallerFactory(userRouter)

function ctx(prisma: PrismaClient) {
  return {
    prisma,
    user: { id: 'u1', email: 'u1@x.y', emailVerified: true },
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {},
    returnUrlBase: 'http://localhost:3000',
  }
}

describe('user.search', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns [] for queries shorter than 3 chars without querying', async () => {
    const prisma = { user: { findMany: vi.fn() } } as never
    const res = await caller(ctx(prisma)).search({ query: 'ab' })
    expect(res).toEqual([])
    expect(prisma.user.findMany).not.toHaveBeenCalled()
  })

  it('prefix-matches email/name, caps at 8, excludes self', async () => {
    const prisma = {
      user: {
        findMany: vi.fn(async () => [{ id: 'u2', firstName: 'Bo', lastName: 'B', email: 'bob@x.y', image: null }]),
      },
    } as never
    const res = await caller(ctx(prisma)).search({ query: 'bob' })
    expect(res).toHaveLength(1)
    const arg = prisma.user.findMany.mock.calls[0][0]
    expect(arg.take).toBe(8)
    expect(arg.where.id).toEqual({ not: 'u1' })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @repo/trpc test -- user-search`
Expected: FAIL — `search` not a function.

- [ ] **Step 3: Implement `search`.** Add this procedure inside `userRouter` in `user.ts` (after `getPreferences`, before `setTheme`). The router already imports `z` and `router, protectedProcedure`:

```ts
  search: protectedProcedure
    .input(z.object({ query: z.string() }))
    .query(async ({ ctx, input }) => {
      const q = input.query.trim()
      if (q.length < 3) return []
      return ctx.prisma.user.findMany({
        where: {
          id: { not: ctx.user.id },
          OR: [
            { email: { startsWith: q, mode: 'insensitive' } },
            { firstName: { startsWith: q, mode: 'insensitive' } },
            { lastName: { startsWith: q, mode: 'insensitive' } },
          ],
        },
        take: 8,
        orderBy: { email: 'asc' },
        select: { id: true, firstName: true, lastName: true, email: true, image: true },
      })
    }),
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @repo/trpc test -- user-search`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/routers/user.ts packages/trpc/test/user-search.test.ts
git commit -m "feat(trpc): user.search with anti-enumeration limits"
```

---

# Phase 3 — Dialog, button, icons

> UI tasks are verified by `check-types` + a dev smoke check here; full interaction coverage is the Playwright spec in Phase 7 (the editor/web packages have no DOM unit-test env).

### Task 6: Add icons to `@repo/ui`

**Files:**
- Modify: `packages/ui/src/components/index.ts`

- [ ] **Step 1: Add icon re-exports** near the other icon exports (after `PersonAddIcon`, `index.ts:120`):

```ts
export { default as ScreenShareIcon } from '@mui/icons-material/ScreenShare'
export { default as LockIcon } from '@mui/icons-material/Lock'
export { default as PublicIcon } from '@mui/icons-material/Public'
```

- [ ] **Step 2: Verify types**

Run: `pnpm --filter @repo/ui check-types`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/index.ts
git commit -m "feat(ui): export ScreenShare/Lock/Public icons"
```

---

### Task 7: `ShareDialog`

**Files:**
- Create: `apps/web/src/components/page/share-dialog.tsx`

- [ ] **Step 1: Implement the dialog**

```tsx
'use client'

import { useEffect, useMemo, useState } from 'react'

import {
  Avatar,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputAdornment,
  LockIcon,
  MenuItem,
  Paper,
  PersonAddIcon,
  PublicIcon,
  Select,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

type Props = {
  open: boolean
  onClose: () => void
  pageId: string
}

type ShareRole = 'READER' | 'COMMENTER' | 'EDITOR'

const ROLE_LABEL: Record<ShareRole, string> = {
  READER: 'Читатель',
  COMMENTER: 'Комментатор',
  EDITOR: 'Редактор',
}

function displayName(u: { firstName: string | null; lastName: string | null; email: string }): string {
  return [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email
}

function initials(u: { firstName: string | null; lastName: string | null; email: string }): string {
  return (u.firstName?.[0] ?? u.email[0] ?? '?').toUpperCase()
}

export function ShareDialog({ open, onClose, pageId }: Props) {
  const utils = trpc.useUtils()
  const shareQ = trpc.page.share.get.useQuery({ pageId }, { enabled: open })
  const invalidate = () => utils.page.share.get.invalidate({ pageId })
  const ensure = trpc.page.share.ensure.useMutation({ onSuccess: invalidate })
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState(false)

  // Lazily materialise the share row the first time the dialog is opened.
  useEffect(() => {
    if (open && shareQ.data && shareQ.data.share === null && !ensure.isPending) {
      ensure.mutate({ pageId })
    }
  }, [open, shareQ.data, ensure, pageId])

  const searchQ = trpc.user.search.useQuery({ query }, { enabled: open && query.trim().length >= 3 })

  const addUser = trpc.page.share.addUser.useMutation({ onSuccess: invalidate })
  const updateUser = trpc.page.share.updateUser.useMutation({ onSuccess: invalidate })
  const removeUser = trpc.page.share.removeUser.useMutation({ onSuccess: invalidate })
  const setAccess = trpc.page.share.setAccess.useMutation({ onSuccess: invalidate })

  const data = shareQ.data?.share ?? null
  const owner = shareQ.data?.owner ?? null
  const grantedIds = useMemo(() => new Set((data?.users ?? []).map((u) => u.user.id)), [data])

  const shareUrl = data ? `${window.location.origin}/s/${data.shareId}` : ''

  async function copyLink() {
    if (!shareUrl) return
    await navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const isPublic = data?.access === 'PUBLIC'

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Общий доступ</DialogTitle>
      <DialogContent>
        {!data ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            {/* Search */}
            <Box sx={{ position: 'relative' }}>
              <TextField
                fullWidth
                size="small"
                placeholder="Поиск пользователей по email или имени"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <PersonAddIcon fontSize="small" />
                    </InputAdornment>
                  ),
                }}
              />
              {query.trim().length >= 3 && (searchQ.data ?? []).length > 0 && (
                <Paper sx={{ position: 'absolute', zIndex: 10, left: 0, right: 0, mt: 0.5, maxHeight: 240, overflow: 'auto' }}>
                  {(searchQ.data ?? [])
                    .filter((u) => !grantedIds.has(u.id))
                    .map((u) => (
                      <Box
                        key={u.id}
                        onClick={() => {
                          addUser.mutate({ pageId, userId: u.id, role: 'READER' })
                          setQuery('')
                        }}
                        sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
                      >
                        <Avatar src={u.image ?? undefined} sx={{ width: 28, height: 28, fontSize: 13 }}>
                          {initials(u)}
                        </Avatar>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" noWrap>{displayName(u)}</Typography>
                          <Typography variant="caption" color="text.secondary" noWrap>{u.email}</Typography>
                        </Box>
                      </Box>
                    ))}
                </Paper>
              )}
            </Box>

            {/* People with access */}
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Пользователи, имеющие доступ</Typography>
              <Stack spacing={1}>
                {owner && (
                  <Stack direction="row" alignItems="center" spacing={1.5}>
                    <Avatar src={owner.image ?? undefined} sx={{ width: 32, height: 32, fontSize: 14 }}>
                      {initials(owner)}
                    </Avatar>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" noWrap>{displayName(owner)}</Typography>
                      <Typography variant="caption" color="text.secondary" noWrap>{owner.email}</Typography>
                    </Box>
                    <Typography variant="body2" color="text.secondary">Владелец</Typography>
                  </Stack>
                )}
                {data.users.map((g) => (
                  <Stack key={g.user.id} direction="row" alignItems="center" spacing={1.5}>
                    <Avatar src={g.user.image ?? undefined} sx={{ width: 32, height: 32, fontSize: 14 }}>
                      {initials(g.user)}
                    </Avatar>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" noWrap>{displayName(g.user)}</Typography>
                      <Typography variant="caption" color="text.secondary" noWrap>{g.user.email}</Typography>
                    </Box>
                    <Select
                      size="small"
                      value={g.role}
                      onChange={(e) => updateUser.mutate({ pageId, userId: g.user.id, role: e.target.value as ShareRole })}
                      sx={{ minWidth: 140 }}
                    >
                      {(['READER', 'COMMENTER', 'EDITOR'] as const).map((r) => (
                        <MenuItem key={r} value={r}>{ROLE_LABEL[r]}</MenuItem>
                      ))}
                    </Select>
                    <Button size="small" color="error" onClick={() => removeUser.mutate({ pageId, userId: g.user.id })}>
                      Убрать
                    </Button>
                  </Stack>
                ))}
              </Stack>
            </Box>

            {/* General access */}
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Общий доступ</Typography>
              <Stack direction="row" alignItems="flex-start" spacing={1.5}>
                <Box sx={{ pt: 1 }}>{isPublic ? <PublicIcon /> : <LockIcon />}</Box>
                <Box sx={{ flex: 1 }}>
                  <Select
                    size="small"
                    fullWidth
                    value={data.access}
                    onChange={(e) =>
                      setAccess.mutate({
                        pageId,
                        access: e.target.value as 'RESTRICTED' | 'PUBLIC',
                        linkRole: data.linkRole,
                      })
                    }
                  >
                    <MenuItem value="RESTRICTED">Доступ ограничен</MenuItem>
                    <MenuItem value="PUBLIC">Всем, у кого есть ссылка</MenuItem>
                  </Select>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    {isPublic
                      ? 'Просматривать могут все в интернете, у кого есть эта ссылка'
                      : 'Открывать контент по этой ссылке могут только пользователи, имеющие доступ'}
                  </Typography>
                  {isPublic && (
                    <Select
                      size="small"
                      value={data.linkRole}
                      onChange={(e) =>
                        setAccess.mutate({ pageId, access: 'PUBLIC', linkRole: e.target.value as ShareRole })
                      }
                      sx={{ mt: 1, minWidth: 160 }}
                    >
                      {(['READER', 'COMMENTER', 'EDITOR'] as const).map((r) => (
                        <MenuItem key={r} value={r}>{ROLE_LABEL[r]}</MenuItem>
                      ))}
                    </Select>
                  )}
                </Box>
              </Stack>
            </Box>
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between', px: 3, pb: 2 }}>
        <Button onClick={copyLink} disabled={!data}>
          {copied ? 'Скопировано' : 'Копировать ссылку'}
        </Button>
        <Button variant="contained" onClick={onClose}>Готово</Button>
      </DialogActions>
    </Dialog>
  )
}
```

- [ ] **Step 2: Ensure `Paper` is exported from `@repo/ui/components`**

Run: `grep -n "export { default as Paper" packages/ui/src/components/index.ts`
Expected: a line is printed. If empty, add `export { default as Paper, type PaperProps } from '@mui/material/Paper'` near the other exports, then re-run.

- [ ] **Step 3: Verify types**

Run: `pnpm --filter web check-types`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/page/share-dialog.tsx packages/ui/src/components/index.ts
git commit -m "feat(web): ShareDialog for the «Общий доступ» modal"
```

---

### Task 8: `ShareButton` in the toolbar

**Files:**
- Create: `apps/web/src/components/page/share-button.tsx`
- Modify: `apps/web/src/components/page/page-actions-toolbar.tsx`

- [ ] **Step 1: Implement `ShareButton`** — only renders when the viewer can manage sharing (it relies on `page.share.get` succeeding; on a `FORBIDDEN`/`NOT_FOUND` error it renders nothing):

```tsx
'use client'

import { useState } from 'react'

import { Button, ScreenShareIcon } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { ShareDialog } from './share-dialog'

type Props = { pageId: string }

export function ShareButton({ pageId }: Props) {
  const [open, setOpen] = useState(false)
  // canManage probe: this query throws FORBIDDEN for non-managers; we hide the button then.
  const probe = trpc.page.share.get.useQuery({ pageId }, { retry: false })

  if (probe.isError) return null

  return (
    <>
      <Button
        size="small"
        variant="contained"
        startIcon={<ScreenShareIcon sx={{ fontSize: 18 }} />}
        onClick={() => setOpen(true)}
      >
        Поделиться
      </Button>
      <ShareDialog open={open} onClose={() => setOpen(false)} pageId={pageId} />
    </>
  )
}
```

> Note: the `get` probe is side-effect-free (read-only). The `PageShare` row is created by `ensure` only when the dialog actually opens (Task 7), so merely viewing your own page creates nothing.

- [ ] **Step 2: Render it left of the star.** In `page-actions-toolbar.tsx`, add the import after line 8:

```ts
import { ShareButton } from './share-button'
```

Then add `<ShareButton>` as the first child of the `<Stack>` (before `<FavoriteStar>`, line 50):

```tsx
    <Stack direction="row" spacing={0.5} alignItems="center" className="page-actions-toolbar">
      <ShareButton pageId={pageId} />
      <FavoriteStar
```

- [ ] **Step 3: Verify types + dev smoke**

Run: `pnpm --filter web check-types`
Expected: PASS.
Then with `docker compose up -d` and `pnpm --filter web dev`, open a page as its owner: the «Поделиться» button appears left of the star and opens the dialog. (Manual smoke; automated in Phase 7.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/page/share-button.tsx apps/web/src/components/page/page-actions-toolbar.tsx
git commit -m "feat(web): «Поделиться» button in the page toolbar"
```

---

# Phase 4 — Share token + Yjs server

### Task 9: Yjs env + `verifyShareToken`

**Files:**
- Modify: `apps/yjs/src/env.ts`, `apps/yjs/src/auth.ts`
- Modify: `.env.example`, `turbo.json`

- [ ] **Step 1: Add the env var to `.env.example`** (under the existing yjs/auth section) and to `turbo.json` `globalEnv` array:

`.env.example`:
```
YJS_SHARE_TOKEN_SECRET=dev-share-secret-change-me
```

`turbo.json` — add `"YJS_SHARE_TOKEN_SECRET"` to the `globalEnv` array.

- [ ] **Step 2: Extend `loadEnv`** in `apps/yjs/src/env.ts`:

```ts
type Env = {
  port: number
  authBaseUrl: string
  jwksUrl: string
  jwtAudience: string | undefined
  shareTokenSecret: string
}
```
and in the returned object add:
```ts
    shareTokenSecret: required('YJS_SHARE_TOKEN_SECRET'),
```

- [ ] **Step 3: Add `verifyShareToken` + `loadPageMeta`** to `apps/yjs/src/auth.ts`. Add `decodeProtectedHeader` to the `jose` import and a `PageShareRole` type:

```ts
import { createRemoteJWKSet, jwtVerify, decodeProtectedHeader, type JWTPayload } from 'jose'
```
append:
```ts
export type ShareTokenClaims = {
  userId: string
  pageId: string
  shareId: string
  role: 'READER' | 'COMMENTER' | 'EDITOR'
  name: string
}

/** Returns claims if `token` is one of our HS256 share tokens, else null. */
export async function verifyShareToken(
  token: string,
  secret: string,
): Promise<ShareTokenClaims | null> {
  let alg: string | undefined
  try {
    alg = decodeProtectedHeader(token).alg
  } catch {
    return null
  }
  if (alg !== 'HS256') return null
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret))
  if ((payload as { typ?: string }).typ !== 'share') return null
  const sub = typeof payload.sub === 'string' ? payload.sub : undefined
  const pageId = (payload as { pageId?: string }).pageId
  const shareId = (payload as { shareId?: string }).shareId
  const role = (payload as { role?: ShareTokenClaims['role'] }).role
  const name = (payload as { name?: string }).name ?? 'Гость'
  if (!sub || !pageId || !shareId || !role) throw new Error('Malformed share token')
  return { userId: sub, pageId, shareId, role, name }
}

/** Page meta for persistence; no membership check (share token is the authority). */
export async function loadPageMeta(
  pageId: string,
): Promise<{ pageType: PageType; workspaceId: string } | null> {
  const page = await prisma.page.findFirst({
    where: { id: pageId, deletedAt: null },
    select: { type: true, workspaceId: true },
  })
  return page ? { pageType: page.type, workspaceId: page.workspaceId } : null
}
```

- [ ] **Step 4: Verify types**

Run: `pnpm --filter @repo/yjs-server check-types`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/yjs/src/env.ts apps/yjs/src/auth.ts .env.example turbo.json
git commit -m "feat(yjs): verifyShareToken + share-token env"
```

---

### Task 10: `onAuthenticate` share branch + read-only

**Files:**
- Modify: `apps/yjs/src/index.ts`

- [ ] **Step 1: Import the new helpers** — update the auth import (line 4):

```ts
import { initJwks, verifyJwt, canAccessPage, verifyShareToken, loadPageMeta } from './auth.js'
```

- [ ] **Step 2: Replace `onAuthenticate`** (lines 17-37) with the share-aware version. Note the added `connection` param and `connection.readOnly` for reader/commenter:

```ts
  async onAuthenticate({ token, documentName, connection }) {
    if (!token) throw new Error('Missing auth token')

    // Share token path (anonymous or non-member viewers via /s/{shareId}).
    const share = await verifyShareToken(token, env.shareTokenSecret)
    if (share) {
      if (share.pageId !== documentName) throw new Error('Forbidden')
      const meta = await loadPageMeta(documentName)
      if (!meta) throw new Error('Forbidden')
      if (share.role === 'READER' || share.role === 'COMMENTER') {
        connection.readOnly = true
      }
      log.info('authenticated (share)', {
        userId: share.userId,
        pageId: documentName,
        role: share.role,
        readOnly: connection.readOnly,
      })
      const ctx: AuthContext = {
        userId: share.userId,
        pageType: meta.pageType,
        workspaceId: meta.workspaceId,
      }
      return ctx
    }

    // Workspace-member path (unchanged).
    const { userId } = await verifyJwt(token, env.jwtAudience)
    const access = await canAccessPage(userId, documentName)
    if (!access) {
      log.warn('page access denied', { userId, pageId: documentName })
      throw new Error('Forbidden')
    }
    log.info('authenticated', {
      userId,
      pageId: documentName,
      pageType: access.pageType,
      workspaceId: access.workspaceId,
    })
    const ctx: AuthContext = {
      userId,
      pageType: access.pageType,
      workspaceId: access.workspaceId,
    }
    return ctx
  },
```

- [ ] **Step 3: Confirm `connection.readOnly` is in the Hocuspocus types**

Run: `pnpm --filter @repo/yjs-server check-types`
Expected: PASS. If `connection.readOnly` is rejected by the installed `@hocuspocus/server` types, set read-only via the documented alternative for that version (check `node_modules/@hocuspocus/server/dist` `onAuthenticatePayload`) — the payload exposes a mutable `connection.readOnly: boolean`.

- [ ] **Step 4: Commit**

```bash
git add apps/yjs/src/index.ts
git commit -m "feat(yjs): authorize share tokens with read-only for reader/commenter"
```

---

### Task 11: `/api/yjs/share-token` endpoint

**Files:**
- Create: `apps/web/src/app/api/yjs/share-token/route.ts`

- [ ] **Step 1: Confirm `jose` is available to `apps/web`**

Run: `node -e "require.resolve('jose', { paths: ['apps/web'] }) && console.log('ok')"`
Expected: prints `ok`. If it errors, run `pnpm --filter web add jose` and commit the manifest change with this task.

- [ ] **Step 2: Implement the route**

```ts
import { randomUUID } from 'node:crypto'
import { SignJWT } from 'jose'
import { NextResponse, type NextRequest } from 'next/server'

import { prisma } from '@repo/db'

import { getSession } from '@/lib/get-session'
import { resolveShareAccess } from '@/lib/share-access'

export const runtime = 'nodejs'

const ANIMALS = ['Лис', 'Кот', 'Барс', 'Сокол', 'Ёж', 'Бобр', 'Тур', 'Краб']

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => null)) as { shareId?: string } | null
  const shareId = body?.shareId
  if (!shareId) return NextResponse.json({ error: 'shareId required' }, { status: 400 })

  const session = await getSession()
  const { page, role } = await resolveShareAccess(prisma, shareId, session)
  if (!page || !role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sub = session?.user?.id ?? `anon:${randomUUID()}`
  const name = session?.user
    ? [session.user.firstName, session.user.lastName].filter(Boolean).join(' ').trim() ||
      session.user.email
    : `Гость · ${ANIMALS[Math.floor(Math.random() * ANIMALS.length)]}`

  const secret = new TextEncoder().encode(process.env.YJS_SHARE_TOKEN_SECRET)
  const token = await new SignJWT({ typ: 'share', pageId: page.id, shareId, role, name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(secret)

  return NextResponse.json({ token })
}
```

- [ ] **Step 3: Verify types**

Run: `pnpm --filter web check-types`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api/yjs/share-token/route.ts apps/web/package.json
git commit -m "feat(web): /api/yjs/share-token mints share JWTs"
```

---

### Task 12: `PageRenderer` optional `yjsToken` + `editable`

**Files:**
- Modify: `apps/web/src/components/page/page-renderer.tsx`

- [ ] **Step 1: Add props.** Change the `Props` type (lines 91-95) and destructure (line 97):

```tsx
type Props = {
  page: PageInput
  workspaceId: string
  user: { id: string; name: string; color: string }
  yjsToken?: () => Promise<string>
  editable?: boolean
}

export function PageRenderer({ page, workspaceId, user, yjsToken, editable = true }: Props) {
```

- [ ] **Step 2: Use the injected token.** Add right after the destructure / near the top of the component body:

```tsx
  const token = yjsToken ?? fetchYjsToken
```

- [ ] **Step 3: Thread `token` + `editable`.** Replace every `yjsToken={fetchYjsToken}` with `yjsToken={token}` (the `EXCALIDRAW`, `GENOGRAM`, `MERMAID`, `PLANTUML`, `LIKEC4`, `DRAWIO`, and `TEXT` branches). In the `TEXT` branch's `<AnyNoteEditor>` (line 458) also pass `editable`:

```tsx
        <AnyNoteEditor
          pageId={page.id}
          workspaceId={workspaceId}
          initialContentYjs={page.contentYjs}
          yjsUrl={resolveYjsUrl()}
          yjsToken={token}
          editable={editable}
          user={user}
```

(The `moveBlockToPage` call at line 361 keeps using `fetchYjsToken` — block-move is an in-app-only action.)

- [ ] **Step 4: Verify types**

Run: `pnpm --filter web check-types`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/page/page-renderer.tsx
git commit -m "feat(web): PageRenderer accepts injected yjsToken + editable"
```

---

# Phase 5 — Public `/s/{shareId}` route

### Task 13: `(share)` layout, route, and client wrapper

**Files:**
- Create: `apps/web/src/app/(share)/layout.tsx`
- Create: `apps/web/src/app/(share)/s/[shareId]/page.tsx`
- Create: `apps/web/src/app/(share)/s/[shareId]/share-page-client.tsx`

- [ ] **Step 1: Minimal public layout** `apps/web/src/app/(share)/layout.tsx`:

```tsx
import { Box } from '@repo/ui/components'

import { TRPCReactProvider } from '@/trpc/client'

export default function ShareLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <Box sx={{ minHeight: '100vh', color: 'text.primary' }}>
      <TRPCReactProvider>{children}</TRPCReactProvider>
    </Box>
  )
}
```

- [ ] **Step 2: Client wrapper** `apps/web/src/app/(share)/s/[shareId]/share-page-client.tsx`:

```tsx
'use client'

import type { PageType } from '@repo/db'

import { PageRenderer } from '@/components/page/page-renderer'

type Props = {
  shareId: string
  page: { id: string; type: PageType; contentYjs: string | null }
  workspaceId: string
  user: { id: string; name: string; color: string }
  editable: boolean
}

export function SharePageClient({ shareId, page, workspaceId, user, editable }: Props) {
  const yjsToken = async () => {
    const res = await fetch('/api/yjs/share-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shareId }),
    })
    if (!res.ok) throw new Error(`share token failed: ${res.status}`)
    const data = (await res.json()) as { token: string }
    return data.token
  }

  return (
    <PageRenderer page={page} workspaceId={workspaceId} user={user} yjsToken={yjsToken} editable={editable} />
  )
}
```

- [ ] **Step 3: The route** `apps/web/src/app/(share)/s/[shareId]/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { randomUUID } from 'node:crypto'

import { prisma } from '@repo/db'
import { Box, Button, LockIcon, PublicIcon, Stack, Typography } from '@repo/ui/components'

import { getSession } from '@/lib/get-session'
import { resolveShareAccess } from '@/lib/share-access'

import { SharePageClient } from './share-page-client'

const COLORS = ['#1976d2', '#9c27b0', '#2e7d32', '#ed6c02', '#0288d1', '#d32f2f']
const ANIMALS = ['Лис', 'Кот', 'Барс', 'Сокол', 'Ёж', 'Бобр', 'Тур', 'Краб']

export default async function SharePage({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params
  const session = await getSession()
  const { share, page, role } = await resolveShareAccess(prisma, shareId, session)

  if (!share || !page) notFound()

  if (!role) {
    return (
      <Box sx={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', p: 3 }}>
        <Stack spacing={2} alignItems="center">
          <LockIcon sx={{ fontSize: 40, color: 'text.secondary' }} />
          <Typography variant="h6">Нет доступа</Typography>
          <Typography color="text.secondary" textAlign="center">
            Открывать этот контент могут только пользователи, имеющие доступ.
          </Typography>
          {!session && (
            <Button variant="contained" href={`/sign-in?redirect=/s/${shareId}`}>Войти</Button>
          )}
        </Stack>
      </Box>
    )
  }

  const editable = role === 'EDITOR' || role === 'OWNER'
  const contentYjs = page.contentYjs ? Buffer.from(page.contentYjs).toString('base64') : null

  const user = session?.user
    ? {
        id: session.user.id,
        name:
          [session.user.firstName, session.user.lastName].filter(Boolean).join(' ').trim() ||
          session.user.email,
        color: COLORS[Math.abs(hash(session.user.id)) % COLORS.length]!,
      }
    : {
        id: `anon:${randomUUID()}`,
        name: `Гость · ${ANIMALS[Math.floor(Math.random() * ANIMALS.length)]}`,
        color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
      }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', minHeight: 0 }}>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ px: 3, py: 1.5, borderBottom: 1, borderColor: 'divider' }}
      >
        {page.icon ? <span>{page.icon}</span> : null}
        <Typography variant="subtitle1" sx={{ flex: 1 }} noWrap>
          {page.title || 'Без названия'}
        </Typography>
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: 'text.secondary' }}>
          {share && <PublicIcon sx={{ fontSize: 18 }} />}
          <Typography variant="caption">Общий доступ</Typography>
        </Stack>
        {!session && (
          <Button size="small" href={`/sign-in?redirect=/s/${shareId}`}>Войти</Button>
        )}
      </Stack>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <SharePageClient
          shareId={shareId}
          page={{ id: page.id, type: page.type as never, contentYjs }}
          workspaceId={page.workspaceId}
          user={user}
          editable={editable}
        />
      </Box>
    </Box>
  )
}

function hash(s: string): number {
  let h = 0
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0
  return h
}
```

- [ ] **Step 4: Verify types + dynamic-route smoke**

Run: `pnpm --filter web check-types`
Expected: PASS.
Then (`docker compose up -d`, `pnpm --filter web dev`): create a TEXT page, open the dialog, switch to «Всем, у кого есть ссылка», copy the link, open it in a private window — the page renders read-only; set link role «Редактор» and confirm an anonymous window can type and the edit persists after reload.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(share)"
git commit -m "feat(web): public /s/[shareId] share route"
```

---

# Phase 6 — Read-only across page types

> Data safety for **all** page types is already guaranteed by `connection.readOnly` (Task 10): the Yjs server rejects writes from reader/commenter connections regardless of UI. This task wires the **UI** read-only affordance for the dominant types. Per-board read-only polish for diagram types (Excalidraw view-mode, Monaco read-only, etc.) is the documented spec follow-up; for v1 those types render (view works) and are write-blocked server-side.

### Task 14: thread `editable` into TEXT + read-only banner

**Files:**
- Modify: `apps/web/src/app/(share)/s/[shareId]/page.tsx`

- [ ] **Step 1: Add a read-only banner** for reader/commenter. In the header `<Stack>` of the share route, after the «Общий доступ» caption block, add:

```tsx
        {!editable && <Typography variant="caption" color="text.secondary">Только просмотр</Typography>}
```

- [ ] **Step 2: Confirm TEXT honors `editable`.** `AnyNoteEditor` already passes `editable` to `useEditor` (`anynote-editor.tsx:289`). The `editable={editable}` wiring from Task 12 means a reader's TEXT page is non-editable in the UI and write-blocked on the server. No code change needed beyond Step 1; verify by opening a restricted reader link to a TEXT page (as a granted READER) — the cursor cannot modify content.

- [ ] **Step 3: Verify types**

Run: `pnpm --filter web check-types`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(share)/s/[shareId]/page.tsx"
git commit -m "feat(web): read-only banner on shared pages"
```

---

# Phase 7 — E2E + gates

### Task 15: Playwright E2E

**Files:**
- Create: `apps/e2e/page-sharing.spec.ts`

- [ ] **Step 1: Write the spec.** Uses `signUpAndAuthAs` (clears cookies, signs up, marks verified, signs in). The second visitor uses a fresh, unauthenticated browser context to exercise the public link.

```ts
import { test, expect } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

test('owner shares a page publicly; an anonymous visitor can read it', async ({ page, browser }) => {
  await signUpAndAuthAs(page)

  // Create a TEXT page (Pages section → Новая страница).
  await page.getByRole('link', { name: 'Страницы' }).click()
  await page.waitForURL(/\/workspaces\/.+/)
  await page.getByRole('button', { name: 'Новая страница' }).first().click()
  await page.waitForURL(/\/pages\/.+/)

  await page.getByRole('textbox').first().click()
  await page.keyboard.type('Привет из общего доступа')

  // Open the share dialog, go public, copy link.
  await page.getByRole('button', { name: 'Поделиться' }).click()
  await expect(page.getByRole('heading', { name: 'Общий доступ' })).toBeVisible()
  await page.getByRole('combobox').filter({ hasText: 'Доступ ограничен' }).click()
  await page.getByRole('option', { name: 'Всем, у кого есть ссылка' }).click()

  await page.getByRole('button', { name: 'Копировать ссылку' }).click()
  const shareUrl = await page.evaluate(() => navigator.clipboard.readText())
  expect(shareUrl).toMatch(/\/s\/[0-9a-f]{64}$/)

  // Anonymous visitor in a clean context.
  const anon = await browser.newContext()
  const anonPage = await anon.newPage()
  await anonPage.goto(shareUrl)
  await expect(anonPage.getByText('Общий доступ')).toBeVisible()
  await expect(anonPage.getByText('Привет из общего доступа')).toBeVisible()
  await anon.close()
})
```

- [ ] **Step 2: Run the spec**

Run: `pnpm exec playwright test apps/e2e/page-sharing.spec.ts --retries=1`
Expected: PASS. (Requires `docker compose up -d`; Playwright runs its own dev server on 3100.)

> If selector text differs from the live UI (button/section labels), adjust the locators to match the rendered DOM — do not change app code to fit the test.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/page-sharing.spec.ts
git commit -m "test(e2e): public page sharing read flow"
```

---

### Task 16: Full gate run

- [ ] **Step 1: Run the merge gate**

Run: `pnpm gates`
Expected: `check-types`, `lint` (`--max-warnings 0`), `build`, and `test` all PASS across the workspace.

- [ ] **Step 2: Fix anything the gate surfaces**, then re-run `pnpm gates` until green.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "chore(share): satisfy gates"
```

---

## Self-Review

**Spec coverage:**
- «Поделиться» primary button left of the star → Task 8. ✅
- 64-char `shareId`, `/s/{shareId}` → Task 1 (`newShareId`), Task 13. ✅
- Add specific platform users not in the workspace → Task 5 (`user.search`) + Task 4 (`addUser`, rejects members) + Task 7 (dialog). ✅
- Reader / Commenter / Editor roles → `PageShareRole` (Task 1); enforced via `connection.readOnly` (Task 10); commenter == read-only-for-content (documented, matches spec deferral). ✅
- Dialog layout (title, search, people list with owner=Владелец, general-access block with lock/public icon + two-mode select + helper text + link-role select, copy-link + Готово) → Task 7. ✅
- Restricted vs public + per-mode helper text → Task 7. ✅
- Single access-resolution authority → Task 2; used by route + token endpoint (Tasks 11, 13). ✅
- All page types → `PageRenderer` path reused for every type (Task 12/13); read-only guaranteed server-side for all (Task 10), UI read-only for TEXT (Task 14), diagram-board polish deferred per spec. ✅
- Anonymous editing → token `sub: anon:*` (Task 11), no membership check in yjs share path (Task 10), persistence already never writes `updatedById` (verified in `apps/yjs/src/persistence.ts`). ✅
- `YJS_SHARE_TOKEN_SECRET` in `.env.example` + `turbo.json` → Task 9. ✅
- Tests: resolution matrix (Task 2), tRPC CRUD/authz (Tasks 3-5), E2E (Task 15). ✅
- Manage-rights = author or OWNER/ADMIN → `assertCanManageShare` (Task 3). ✅

**Placeholder scan:** none — every code step contains complete code; selector-drift in E2E is the only explicitly-flexible item, with explicit guidance.

**Type consistency:** `EffectiveRole`/`PageShareRole` values (`READER|COMMENTER|EDITOR`, plus `OWNER` for the effective viewing role) are consistent across `share-access.ts`, the token claims (`auth.ts`), the route (`editable = EDITOR|OWNER`), and the dialog. `resolveShareAccess` return shape `{ share, page, role }` is consumed identically by Task 11 and Task 13. `page.share.get` returns `{ shareId, access, linkRole, users, owner, canManage }` — matched by the dialog (Task 7). `yjsToken: () => Promise<string>` matches `AnyNoteEditorProps` and the `PageRenderer` optional prop.
