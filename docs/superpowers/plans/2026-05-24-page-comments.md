# Inline Page Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add inline, anchored, threaded comments (with resolve/reopen, @mentions, notifications) to TEXT pages, lighting up the COMMENTER role from page sharing — including anonymous commenting via public links.

**Architecture:** Comment threads + messages live in Postgres (`PageCommentThread` + `PageComment`), served by a `publicProcedure` tRPC router authorized by session **or** `shareId`. Anchors are encoded Yjs `RelativePosition`s stored on the thread and rendered as **ProseMirror decorations** (view-only, never written to the doc) so read-only commenters/anonymous viewers can both anchor and see comments. Realtime via an in-memory bus + tRPC subscription (members) / refetch (public). Reuses the dormant `COMMENT_CREATED`/`PAGE_MENTION` notifications and `filterMentionItems`.

**Tech Stack:** Prisma 7 / Postgres, tRPC v11 + Zod (+ subscriptions), Tiptap 3 / ProseMirror, y-prosemirror 1.3.7 (`RelativePosition`), Yjs, Next.js 16 / React 19 / MUI v6, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-05-24-page-comments-design.md`

---

## File Structure

**Create:**
- `packages/db/prisma/migrations/<ts>_page_comments/migration.sql` — generated.
- `packages/trpc/src/helpers/comment-access.ts` — `resolveCommentContext` (session ▸ grant ▸ public-link; author identity).
- `packages/trpc/test/comment-access.test.ts` — resolution matrix.
- `packages/trpc/src/realtime/page-comment-bus.ts` — in-memory pub/sub (mirrors `kanban-bus`).
- `packages/trpc/src/routers/comment.ts` — `commentRouter` (listThreads/createThread/addComment/editComment/deleteComment/resolveThread/reopenThread/events).
- `packages/trpc/test/comment-router.test.ts` — CRUD + authz + notification fan-out.
- `packages/editor/src/comment-anchor.ts` — `selectionToAnchor` / `anchorToRange` (Yjs RelativePosition ↔ PM range).
- `packages/editor/test/comment-anchor.test.ts` — yjs round-trip (node env).
- `packages/editor/src/extensions/comments.ts` — decoration plugin + `setCommentThreads` command.
- `packages/editor/src/types-comments.ts` — shared `CommentThreadAnchor` type (editor ↔ app).
- `apps/web/src/components/page/comments/` — `comment-composer.tsx`, `thread-popover.tsx`, `comments-panel.tsx`, `use-page-comments.ts` (data hook), `anon-id.ts`.

**Modify:**
- `packages/db/prisma/schema.prisma` — 2 models + back-relations on `Page`, `User`.
- `packages/trpc/src/index.ts` — mount `comment: commentRouter`.
- `packages/notifications/src/helpers.ts` — `actorId?` optional on `commentCreated`/`pageMention`.
- `packages/editor/src/types.ts` — add `commentThreads`/`onCreateComment`/`onOpenThread`/`canComment` to `AnyNoteEditorProps`; export comment types.
- `packages/editor/src/extensions/index.ts` — add `Comments` extension + thread the new opts.
- `packages/editor/src/anynote-editor.tsx` — pass comment opts into `buildExtensions`; render nothing else (popover/panel are app-side).
- `packages/editor/src/components/floating-toolbar.tsx` — «Комментировать» button.
- `packages/editor/src/index.ts` — export `selectionToAnchor`/types if needed by app.
- `packages/editor/src/styles/*.css` (or `content.css`) — `.comment-highlight` style.
- `apps/web/src/components/page/page-renderer.tsx` — wire comments (fetch, pass, callbacks, panel).
- `apps/web/src/app/(share)/s/[shareId]/share-page-client.tsx` — pass `shareId`, `anonId`, `canComment`.
- `apps/e2e/page-comments.spec.ts` — E2E.

---

# Phase 1 — Data model + API (signed-in)

### Task 1: Prisma models + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add models** after the `PageShareUser` model (search `model PageShareUser`):

```prisma
model PageCommentThread {
  id           String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  pageId       String    @map("page_id") @db.Uuid
  anchorStart  String    @map("anchor_start") @db.Text
  anchorEnd    String    @map("anchor_end") @db.Text
  quotedText   String    @map("quoted_text") @db.Text
  resolvedAt   DateTime? @map("resolved_at") @db.Timestamptz(6)
  resolvedById String?   @map("resolved_by_id") @db.Uuid
  createdById  String?   @map("created_by_id") @db.Uuid
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt    DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  page      Page          @relation(fields: [pageId], references: [id], onDelete: Cascade)
  createdBy User?         @relation("PageCommentThreadAuthor", fields: [createdById], references: [id], onDelete: SetNull)
  comments  PageComment[]

  @@index([pageId])
  @@map("page_comment_threads")
}

model PageComment {
  id           String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  threadId     String    @map("thread_id") @db.Uuid
  authorId     String?   @map("author_id") @db.Uuid
  authorName   String    @map("author_name") @db.VarChar(255)
  authorAnonId String?   @map("author_anon_id") @db.VarChar(64)
  content      Json
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt    DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt    DateTime? @map("deleted_at") @db.Timestamptz(6)

  thread PageCommentThread @relation(fields: [threadId], references: [id], onDelete: Cascade)
  author User?             @relation("PageCommentAuthor", fields: [authorId], references: [id], onDelete: SetNull)

  @@index([threadId, createdAt])
  @@map("page_comments")
}
```

- [ ] **Step 2: Add back-relations.** In `model Page` (after the `share PageShare?` line) add:

```prisma
  commentThreads   PageCommentThread[]
```

In `model User` (after the `pageShareGrants` line) add:

```prisma
  pageCommentThreadsAuthored PageCommentThread[] @relation("PageCommentThreadAuthor")
  pageCommentsAuthored       PageComment[]       @relation("PageCommentAuthor")
```

- [ ] **Step 3: Create + apply the migration**

Run: `docker compose up -d && pnpm --filter @repo/db exec prisma migrate dev --name page_comments`
Expected: migration created + applied, client regenerated, no errors.

- [ ] **Step 4: Verify types**

Run: `pnpm --filter @repo/db exec prisma generate && pnpm --filter @repo/trpc check-types`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): add PageCommentThread and PageComment models"
```

---

### Task 2: `resolveCommentContext` (signed-in resolution)

**Files:**
- Create: `packages/trpc/src/helpers/comment-access.ts`
- Test: `packages/trpc/test/comment-access.test.ts`

This task implements the **signed-in** branches (member ▸ named grant). The public-link / anonymous branch is added in Task 11 (Phase 4); the test here only covers signed-in + deny.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest'

import { resolveCommentContext, canWriteComment } from '../src/helpers/comment-access'

const PAGE = { id: 'p1', workspaceId: 'w1', createdById: 'owner' }

function ctx(prisma: unknown, user: { id: string } | null) {
  return { prisma, user } as never
}

describe('canWriteComment', () => {
  it('allows COMMENTER/EDITOR/OWNER, denies READER/null', () => {
    expect(canWriteComment('OWNER')).toBe(true)
    expect(canWriteComment('EDITOR')).toBe(true)
    expect(canWriteComment('COMMENTER')).toBe(true)
    expect(canWriteComment('READER')).toBe(false)
    expect(canWriteComment(null)).toBe(false)
  })
})

describe('resolveCommentContext (signed-in)', () => {
  it('resolves a workspace member to a mapped role + user author', async () => {
    const prisma = {
      page: { findUnique: vi.fn(async () => PAGE) },
      workspaceMember: { findUnique: vi.fn(async () => ({ role: 'COMMENTER' })) },
      pageShareUser: { findFirst: vi.fn() },
      user: { findUnique: vi.fn(async () => ({ firstName: 'Ann', lastName: 'B', email: 'a@b.c' })) },
    }
    const res = await resolveCommentContext(ctx(prisma, { id: 'u1' }), { pageId: 'p1' })
    expect(res.role).toBe('COMMENTER')
    expect(res.workspaceId).toBe('w1')
    expect(res.author).toEqual({ userId: 'u1', name: 'Ann B' })
    expect(prisma.pageShareUser.findFirst).not.toHaveBeenCalled()
  })

  it('falls back to a named grant when not a member', async () => {
    const prisma = {
      page: { findUnique: vi.fn(async () => PAGE) },
      workspaceMember: { findUnique: vi.fn(async () => null) },
      pageShare: { findUnique: vi.fn(async () => ({ id: 's1' })) },
      pageShareUser: { findFirst: vi.fn(async () => ({ role: 'EDITOR' })) },
      user: { findUnique: vi.fn(async () => ({ firstName: 'Ann', lastName: '', email: 'a@b.c' })) },
    }
    const res = await resolveCommentContext(ctx(prisma, { id: 'u1' }), { pageId: 'p1' })
    expect(res.role).toBe('EDITOR')
  })

  it('denies a signed-in non-member non-grant (no public link)', async () => {
    const prisma = {
      page: { findUnique: vi.fn(async () => PAGE) },
      workspaceMember: { findUnique: vi.fn(async () => null) },
      pageShare: { findUnique: vi.fn(async () => null) },
      pageShareUser: { findFirst: vi.fn(async () => null) },
      user: { findUnique: vi.fn(async () => ({ firstName: 'X', lastName: '', email: 'x@y.z' })) },
    }
    const res = await resolveCommentContext(ctx(prisma, { id: 'u1' }), { pageId: 'p1' })
    expect(res.role).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @repo/trpc test -- comment-access`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `comment-access.ts`** (signed-in branches; public/anon branch is extended in Task 11)

```ts
import { TRPCError } from '@trpc/server'
import type { PrismaClient } from '@repo/db'

export type EffectiveRole = 'OWNER' | 'EDITOR' | 'COMMENTER' | 'READER'
export type CommentAuthor = { userId?: string; anonId?: string; name: string }

type Ctx = { prisma: PrismaClient; user: { id: string } | null }
type Input = { pageId?: string; shareId?: string; anonId?: string }

export function canWriteComment(role: EffectiveRole | null): boolean {
  return role === 'OWNER' || role === 'EDITOR' || role === 'COMMENTER'
}

function mapMemberRole(role: string): EffectiveRole {
  switch (role) {
    case 'OWNER':
      return 'OWNER'
    case 'ADMIN':
    case 'EDITOR':
      return 'EDITOR'
    case 'COMMENTER':
      return 'COMMENTER'
    default:
      return 'READER'
  }
}

function displayName(u: { firstName: string | null; lastName: string | null; email: string }): string {
  return [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email
}

export type CommentContext = {
  pageId: string
  workspaceId: string
  page: { createdById: string | null }
  role: EffectiveRole | null
  author: CommentAuthor
}

/**
 * Resolve the viewer's effective role on a page for commenting, plus their
 * author identity. Signed-in: member ▸ named grant. (Public-link / anonymous
 * branch added in Task 11.) Throws NOT_FOUND if neither pageId nor shareId
 * resolves to a page.
 */
export async function resolveCommentContext(ctx: Ctx, input: Input): Promise<CommentContext> {
  const page = input.pageId
    ? await ctx.prisma.page.findUnique({
        where: { id: input.pageId },
        select: { id: true, workspaceId: true, createdById: true },
      })
    : null
  if (!page) throw new TRPCError({ code: 'NOT_FOUND', message: 'Страница не найдена' })

  const base = { pageId: page.id, workspaceId: page.workspaceId, page: { createdById: page.createdById } }

  if (ctx.user) {
    const self = await ctx.prisma.user.findUnique({
      where: { id: ctx.user.id },
      select: { firstName: true, lastName: true, email: true },
    })
    const author: CommentAuthor = { userId: ctx.user.id, name: self ? displayName(self) : 'Пользователь' }

    const member = await ctx.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: page.workspaceId, userId: ctx.user.id } },
      select: { role: true },
    })
    if (member) return { ...base, role: mapMemberRole(member.role), author }

    const share = await ctx.prisma.pageShare.findUnique({
      where: { pageId: page.id },
      select: { id: true },
    })
    if (share) {
      const grant = await ctx.prisma.pageShareUser.findFirst({
        where: { pageShareId: share.id, userId: ctx.user.id },
        select: { role: true },
      })
      if (grant) return { ...base, role: grant.role as EffectiveRole, author }
    }
    return { ...base, role: null, author }
  }

  // Anonymous handled in Task 11.
  return { ...base, role: null, author: { name: 'Гость' } }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @repo/trpc test -- comment-access`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/helpers/comment-access.ts packages/trpc/test/comment-access.test.ts
git commit -m "feat(trpc): resolveCommentContext (signed-in resolution)"
```

---

### Task 3: comment router — listThreads / createThread / addComment

**Files:**
- Create: `packages/trpc/src/realtime/page-comment-bus.ts`
- Create: `packages/trpc/src/routers/comment.ts`
- Modify: `packages/trpc/src/index.ts`
- Test: `packages/trpc/test/comment-router.test.ts`

- [ ] **Step 1: Create the bus** `packages/trpc/src/realtime/page-comment-bus.ts`

```ts
export type PageCommentEvent = {
  kind: 'thread.upserted' | 'thread.deleted'
  threadId: string
}

type Listener = (event: PageCommentEvent) => void

export class PageCommentBus {
  private readonly listeners = new Map<string, Set<Listener>>()

  on(pageId: string, listener: Listener): () => void {
    const existing = this.listeners.get(pageId)
    const set = existing ?? new Set<Listener>()
    if (!existing) this.listeners.set(pageId, set)
    set.add(listener)
    return () => {
      set.delete(listener)
      if (set.size === 0) this.listeners.delete(pageId)
    }
  }

  emit(pageId: string, event: PageCommentEvent): void {
    const set = this.listeners.get(pageId)
    if (!set) return
    for (const listener of set) listener(event)
  }
}

export const pageCommentBus = new PageCommentBus()
```

- [ ] **Step 2: Write the failing test** `packages/trpc/test/comment-router.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@repo/auth', () => ({ getUserFromRequest: vi.fn() }))
vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return { ...actual, prisma: {} }
})
vi.mock('@repo/notifications', () => ({ notify: { commentCreated: vi.fn(), pageMention: vi.fn() } }))

import type { PrismaClient } from '@repo/db'
import { commentRouter } from '../src/routers/comment'
import { createCallerFactory } from '../src/trpc'

const PAGE = { id: 'p1', workspaceId: 'w1', createdById: 'owner' }
const caller = createCallerFactory(commentRouter)
function ctx(prisma: PrismaClient, user: { id: string } | null) {
  return {
    prisma,
    user,
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {},
    returnUrlBase: 'http://localhost:3000',
  }
}

describe('comment.listThreads / createThread', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists threads for a viewer with access', async () => {
    const prisma = {
      page: { findUnique: vi.fn(async () => PAGE) },
      workspaceMember: { findUnique: vi.fn(async () => ({ role: 'READER' })) },
      user: { findUnique: vi.fn(async () => ({ firstName: 'A', lastName: '', email: 'a@b.c' })) },
      pageCommentThread: { findMany: vi.fn(async () => [{ id: 't1', comments: [] }]) },
    } as never
    const res = await caller(ctx(prisma, { id: 'u1' })).listThreads({ pageId: 'p1' })
    expect(res).toHaveLength(1)
  })

  it('rejects createThread for a READER', async () => {
    const prisma = {
      page: { findUnique: vi.fn(async () => PAGE) },
      workspaceMember: { findUnique: vi.fn(async () => ({ role: 'READER' })) },
      user: { findUnique: vi.fn(async () => ({ firstName: 'A', lastName: '', email: 'a@b.c' })) },
    } as never
    await expect(
      caller(ctx(prisma, { id: 'u1' })).createThread({
        pageId: 'p1',
        anchorStart: 'x',
        anchorEnd: 'y',
        quotedText: 'q',
        content: { text: 'hi', mentions: [] },
      }),
    ).rejects.toThrow(/Недостаточно прав/)
  })

  it('creates a thread + first comment for a COMMENTER', async () => {
    const created = { id: 't1', comments: [{ id: 'c1' }] }
    const tx = {
      pageCommentThread: { create: vi.fn(async () => ({ id: 't1' })) },
      pageComment: { create: vi.fn(async () => ({ id: 'c1' })) },
    }
    const prisma = {
      page: { findUnique: vi.fn(async () => PAGE) },
      workspaceMember: { findUnique: vi.fn(async () => ({ role: 'COMMENTER' })) },
      user: { findUnique: vi.fn(async () => ({ firstName: 'A', lastName: '', email: 'a@b.c' })) },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      pageCommentThread: { findUnique: vi.fn(async () => created) },
    } as never
    const res = await caller(ctx(prisma, { id: 'u1' })).createThread({
      pageId: 'p1',
      anchorStart: 'x',
      anchorEnd: 'y',
      quotedText: 'q',
      content: { text: 'hi', mentions: [] },
    })
    expect(tx.pageCommentThread.create).toHaveBeenCalledOnce()
    expect(tx.pageComment.create).toHaveBeenCalledOnce()
    expect(res.id).toBe('t1')
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @repo/trpc test -- comment-router`
Expected: FAIL — module not found.

- [ ] **Step 4: Relax notify helpers, then implement `comment.ts`.** First, in `packages/notifications/src/helpers.ts`, change `actorId: string` → `actorId?: string` on **both** `commentCreated` and `pageMention` (the router may pass an anonymous/undefined actor; `emit` already accepts `actorId?`). Then implement the router (listThreads/createThread/addComment; remaining procedures in Task 4):

```ts
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { notify } from '@repo/notifications'

import { router, publicProcedure } from '../trpc'
import { resolveCommentContext, canWriteComment } from '../helpers/comment-access'
import { pageCommentBus } from '../realtime/page-comment-bus'

const ContentSchema = z.object({
  text: z.string().trim().min(1).max(5000),
  mentions: z.array(z.string().uuid()).default([]),
})
const Target = { pageId: z.string().uuid().optional(), shareId: z.string().optional(), anonId: z.string().max(64).optional() }

const threadInclude = {
  comments: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      authorId: true,
      authorName: true,
      content: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} as const

async function notifyNewComment(
  prisma: Parameters<typeof resolveCommentContext>[0]['prisma'],
  args: {
    threadId: string
    commentId: string
    pageId: string
    workspaceId: string
    actor: { userId?: string; name: string }
    text: string
    mentions: string[]
  },
): Promise<void> {
  // Recipients: distinct prior comment authors + page creator, minus the actor.
  const thread = await prisma.pageCommentThread.findUnique({
    where: { id: args.threadId },
    select: { createdById: true, page: { select: { createdById: true } }, comments: { select: { authorId: true } } },
  })
  const recipients = new Set<string>()
  if (thread?.page.createdById) recipients.add(thread.page.createdById)
  for (const c of thread?.comments ?? []) if (c.authorId) recipients.add(c.authorId)
  if (args.actor.userId) recipients.delete(args.actor.userId)
  const mentioned = new Set(args.mentions)
  const snippet = args.text.slice(0, 140)
  for (const userId of recipients) {
    if (mentioned.has(userId)) continue // a PAGE_MENTION will cover them
    await notify.commentCreated(prisma as never, {
      userId,
      workspaceId: args.workspaceId,
      pageId: args.pageId,
      commentId: args.commentId,
      actorId: args.actor.userId,
      actorName: args.actor.name,
      snippet,
    })
  }
  for (const userId of mentioned) {
    if (userId === args.actor.userId) continue
    await notify.pageMention(prisma as never, {
      userId,
      workspaceId: args.workspaceId,
      pageId: args.pageId,
      actorId: args.actor.userId,
      actorName: args.actor.name,
      snippet,
    })
  }
}

export const commentRouter = router({
  listThreads: publicProcedure
    .input(z.object({ ...Target }))
    .query(async ({ ctx, input }) => {
      const c = await resolveCommentContext(ctx, input)
      if (!c.role) throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' })
      return ctx.prisma.pageCommentThread.findMany({
        where: { pageId: c.pageId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          anchorStart: true,
          anchorEnd: true,
          quotedText: true,
          resolvedAt: true,
          createdById: true,
          ...threadInclude,
        },
      })
    }),

  createThread: publicProcedure
    .input(z.object({ ...Target, anchorStart: z.string(), anchorEnd: z.string(), quotedText: z.string().max(2000), content: ContentSchema }))
    .mutation(async ({ ctx, input }) => {
      const c = await resolveCommentContext(ctx, input)
      if (!canWriteComment(c.role)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав' })
      const thread = await ctx.prisma.$transaction(async (tx) => {
        const t = await tx.pageCommentThread.create({
          data: {
            pageId: c.pageId,
            anchorStart: input.anchorStart,
            anchorEnd: input.anchorEnd,
            quotedText: input.quotedText,
            createdById: c.author.userId ?? null,
          },
          select: { id: true },
        })
        await tx.pageComment.create({
          data: {
            threadId: t.id,
            authorId: c.author.userId ?? null,
            authorName: c.author.name,
            authorAnonId: c.author.anonId ?? null,
            content: input.content,
          },
          select: { id: true },
        })
        return t
      })
      const firstComment = await ctx.prisma.pageComment.findFirst({
        where: { threadId: thread.id },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      })
      await notifyNewComment(ctx.prisma, {
        threadId: thread.id,
        commentId: firstComment?.id ?? thread.id,
        pageId: c.pageId,
        workspaceId: c.workspaceId,
        actor: c.author,
        text: input.content.text,
        mentions: input.content.mentions,
      })
      pageCommentBus.emit(c.pageId, { kind: 'thread.upserted', threadId: thread.id })
      return ctx.prisma.pageCommentThread.findUnique({
        where: { id: thread.id },
        select: {
          id: true, anchorStart: true, anchorEnd: true, quotedText: true, resolvedAt: true, createdById: true,
          ...threadInclude,
        },
      })
    }),

  addComment: publicProcedure
    .input(z.object({ ...Target, threadId: z.string().uuid(), content: ContentSchema }))
    .mutation(async ({ ctx, input }) => {
      const c = await resolveCommentContext(ctx, input)
      if (!canWriteComment(c.role)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав' })
      const thread = await ctx.prisma.pageCommentThread.findUnique({
        where: { id: input.threadId },
        select: { pageId: true },
      })
      if (!thread || thread.pageId !== c.pageId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Тред не найден' })
      const comment = await ctx.prisma.pageComment.create({
        data: {
          threadId: input.threadId,
          authorId: c.author.userId ?? null,
          authorName: c.author.name,
          authorAnonId: c.author.anonId ?? null,
          content: input.content,
        },
        select: { id: true },
      })
      await notifyNewComment(ctx.prisma, {
        threadId: input.threadId,
        commentId: comment.id,
        pageId: c.pageId,
        workspaceId: c.workspaceId,
        actor: c.author,
        text: input.content.text,
        mentions: input.content.mentions,
      })
      pageCommentBus.emit(c.pageId, { kind: 'thread.upserted', threadId: input.threadId })
      return comment
    }),
})
```

> Note: `@repo/notifications` exports `notify`. Confirm the import path — `grep -n "export.*notify" packages/notifications/src/index.ts`. If `notify` isn't re-exported, add `export { notify } from './helpers'` there.

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @repo/trpc test -- comment-router`
Expected: PASS.

- [ ] **Step 6: Mount the router.** In `packages/trpc/src/index.ts` add the import after the others:

```ts
import { commentRouter } from './routers/comment'
```
and add `comment: commentRouter,` to the `appRouter` object (after `kanban:`).

- [ ] **Step 7: Verify + commit**

Run: `pnpm --filter @repo/trpc check-types && pnpm --filter @repo/trpc test -- comment-router`
Expected: PASS.

```bash
git add packages/trpc/src/realtime/page-comment-bus.ts packages/trpc/src/routers/comment.ts packages/trpc/src/index.ts packages/trpc/test/comment-router.test.ts packages/notifications/src/helpers.ts
git commit -m "feat(trpc): comment listThreads/createThread/addComment + bus"
```

---

### Task 4: edit / delete / resolve / reopen

**Files:**
- Modify: `packages/trpc/src/routers/comment.ts`
- Test: `packages/trpc/test/comment-router.test.ts`

- [ ] **Step 1: Add failing tests** (append a `describe`)

```ts
describe('comment edit/delete/resolve', () => {
  beforeEach(() => vi.clearAllMocks())

  function memberPrisma(role: string, extra: Record<string, unknown>) {
    return {
      page: { findUnique: vi.fn(async () => PAGE) },
      workspaceMember: { findUnique: vi.fn(async () => ({ role })) },
      user: { findUnique: vi.fn(async () => ({ firstName: 'A', lastName: '', email: 'a@b.c' })) },
      ...extra,
    } as never
  }

  it('lets the author edit own comment', async () => {
    const prisma = memberPrisma('COMMENTER', {
      pageComment: {
        findUnique: vi.fn(async () => ({ authorId: 'u1', authorAnonId: null, thread: { pageId: 'p1' } })),
        update: vi.fn(async () => ({ id: 'c1' })),
      },
    })
    await caller(ctx(prisma, { id: 'u1' })).editComment({ pageId: 'p1', commentId: 'c1', content: { text: 'x', mentions: [] } })
    expect(prisma.pageComment.update).toHaveBeenCalled()
  })

  it('forbids editing someone else’s comment', async () => {
    const prisma = memberPrisma('COMMENTER', {
      pageComment: { findUnique: vi.fn(async () => ({ authorId: 'other', authorAnonId: null, thread: { pageId: 'p1' } })) },
    })
    await expect(
      caller(ctx(prisma, { id: 'u1' })).editComment({ pageId: 'p1', commentId: 'c1', content: { text: 'x', mentions: [] } }),
    ).rejects.toThrow(/только свои/)
  })

  it('lets an EDITOR delete any comment (moderation)', async () => {
    const prisma = memberPrisma('EDITOR', {
      pageComment: {
        findUnique: vi.fn(async () => ({ authorId: 'other', authorAnonId: null, threadId: 't1', thread: { pageId: 'p1' } })),
        update: vi.fn(async () => ({ id: 'c1' })),
        count: vi.fn(async () => 1),
      },
      pageCommentThread: { update: vi.fn() },
    })
    await caller(ctx(prisma, { id: 'u1' })).deleteComment({ pageId: 'p1', commentId: 'c1' })
    expect(prisma.pageComment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
    )
  })

  it('resolves a thread', async () => {
    const prisma = memberPrisma('COMMENTER', {
      pageCommentThread: {
        findUnique: vi.fn(async () => ({ pageId: 'p1' })),
        update: vi.fn(async () => ({ id: 't1', resolvedAt: new Date() })),
      },
    })
    const res = await caller(ctx(prisma, { id: 'u1' })).resolveThread({ pageId: 'p1', threadId: 't1' })
    expect(res.resolvedAt).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @repo/trpc test -- comment-router`
Expected: FAIL — procedures not defined.

- [ ] **Step 3: Add the procedures** inside `commentRouter` (after `addComment`). Add a `canModerate` import line is not needed — moderation is computed inline:

```ts
  editComment: publicProcedure
    .input(z.object({ ...Target, commentId: z.string().uuid(), content: ContentSchema }))
    .mutation(async ({ ctx, input }) => {
      const c = await resolveCommentContext(ctx, input)
      if (!canWriteComment(c.role)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав' })
      const existing = await ctx.prisma.pageComment.findUnique({
        where: { id: input.commentId },
        select: { authorId: true, authorAnonId: true, thread: { select: { pageId: true } } },
      })
      if (!existing || existing.thread.pageId !== c.pageId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Комментарий не найден' })
      }
      const isAuthor =
        (c.author.userId && existing.authorId === c.author.userId) ||
        (c.author.anonId && existing.authorAnonId === c.author.anonId)
      if (!isAuthor) throw new TRPCError({ code: 'FORBIDDEN', message: 'Можно редактировать только свои комментарии' })
      return ctx.prisma.pageComment.update({
        where: { id: input.commentId },
        data: { content: input.content },
        select: { id: true },
      })
    }),

  deleteComment: publicProcedure
    .input(z.object({ ...Target, commentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const c = await resolveCommentContext(ctx, input)
      if (!canWriteComment(c.role)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав' })
      const existing = await ctx.prisma.pageComment.findUnique({
        where: { id: input.commentId },
        select: { authorId: true, authorAnonId: true, threadId: true, thread: { select: { pageId: true } } },
      })
      if (!existing || existing.thread.pageId !== c.pageId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Комментарий не найден' })
      }
      const isAuthor =
        (c.author.userId && existing.authorId === c.author.userId) ||
        (c.author.anonId && existing.authorAnonId === c.author.anonId)
      const canModerate =
        c.role === 'OWNER' ||
        c.role === 'EDITOR' ||
        (!!c.author.userId && c.author.userId === c.page.createdById)
      if (!isAuthor && !canModerate) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав на удаление' })
      }
      await ctx.prisma.pageComment.update({
        where: { id: input.commentId },
        data: { deletedAt: new Date() },
      })
      // If the thread has no remaining comments, soft-remove the thread too.
      const remaining = await ctx.prisma.pageComment.count({
        where: { threadId: existing.threadId, deletedAt: null },
      })
      if (remaining === 0) {
        await ctx.prisma.pageCommentThread.update({
          where: { id: existing.threadId },
          data: { resolvedAt: new Date() },
        })
        pageCommentBus.emit(c.pageId, { kind: 'thread.deleted', threadId: existing.threadId })
      } else {
        pageCommentBus.emit(c.pageId, { kind: 'thread.upserted', threadId: existing.threadId })
      }
      return { ok: true as const }
    }),

  resolveThread: publicProcedure
    .input(z.object({ ...Target, threadId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const c = await resolveCommentContext(ctx, input)
      if (!canWriteComment(c.role)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав' })
      const thread = await ctx.prisma.pageCommentThread.findUnique({
        where: { id: input.threadId },
        select: { pageId: true },
      })
      if (!thread || thread.pageId !== c.pageId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Тред не найден' })
      const updated = await ctx.prisma.pageCommentThread.update({
        where: { id: input.threadId },
        data: { resolvedAt: new Date(), resolvedById: c.author.userId ?? null },
        select: { id: true, resolvedAt: true },
      })
      pageCommentBus.emit(c.pageId, { kind: 'thread.upserted', threadId: input.threadId })
      return updated
    }),

  reopenThread: publicProcedure
    .input(z.object({ ...Target, threadId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const c = await resolveCommentContext(ctx, input)
      if (!canWriteComment(c.role)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав' })
      const thread = await ctx.prisma.pageCommentThread.findUnique({
        where: { id: input.threadId },
        select: { pageId: true },
      })
      if (!thread || thread.pageId !== c.pageId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Тред не найден' })
      const updated = await ctx.prisma.pageCommentThread.update({
        where: { id: input.threadId },
        data: { resolvedAt: null, resolvedById: null },
        select: { id: true, resolvedAt: true },
      })
      pageCommentBus.emit(c.pageId, { kind: 'thread.upserted', threadId: input.threadId })
      return updated
    }),
```

- [ ] **Step 4: Run + commit**

Run: `pnpm --filter @repo/trpc test -- comment-router && pnpm --filter @repo/trpc check-types`
Expected: PASS.

```bash
git add packages/trpc/src/routers/comment.ts packages/trpc/test/comment-router.test.ts
git commit -m "feat(trpc): comment edit/delete (moderation) + resolve/reopen"
```

---

# Phase 2 — Editor integration

### Task 5: `comment-anchor.ts` (RelativePosition ↔ range) + yjs round-trip test

**Files:**
- Create: `packages/editor/src/comment-anchor.ts`
- Create: `packages/editor/src/types-comments.ts`
- Test: `packages/editor/test/comment-anchor.test.ts`

> `@repo/editor` has no DOM test env, but `comment-anchor`'s core is a pure Yjs round-trip testable in node with a `Y.Doc` directly (no editor view), by exercising the same `y-prosemirror` position utilities against a `Y.XmlFragment`. Confirm `@repo/editor` has a vitest config + `test` script; if not, add one mirroring `packages/trpc` (node env). If adding a runner is out of scope, mark this test `DONE_WITH_CONCERNS` and rely on the E2E — but attempt it first.

- [ ] **Step 1: Define the shared type** `packages/editor/src/types-comments.ts`

```ts
export type CommentThreadAnchor = {
  id: string
  anchorStart: string // base64 Yjs RelativePosition
  anchorEnd: string
  resolvedAt: string | Date | null
}
```

- [ ] **Step 2: Write the failing test** `packages/editor/test/comment-anchor.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { encodeAnchor, decodeAnchor } from '../src/comment-anchor'

// Verifies the base64 RelativePosition codec is a faithful round-trip and that
// a relative position tracks insertions before it (Yjs RelativePosition semantics).
describe('comment-anchor codec', () => {
  it('round-trips a RelativePosition through base64', () => {
    const doc = new Y.Doc()
    const text = doc.getText('t')
    text.insert(0, 'hello world')
    const rel = Y.createRelativePositionFromTypeIndex(text, 6) // before "world"
    const encoded = encodeAnchor(rel)
    expect(typeof encoded).toBe('string')
    const back = decodeAnchor(encoded)
    const abs = Y.createAbsolutePositionFromRelativePosition(back, doc)
    expect(abs?.index).toBe(6)
  })

  it('relative position shifts when earlier text is inserted', () => {
    const doc = new Y.Doc()
    const text = doc.getText('t')
    text.insert(0, 'world')
    const rel = Y.createRelativePositionFromTypeIndex(text, 5) // end
    text.insert(0, 'hello ') // 6 chars before
    const abs = Y.createAbsolutePositionFromRelativePosition(decodeAnchor(encodeAnchor(rel)), doc)
    expect(abs?.index).toBe(11)
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @repo/editor test -- comment-anchor`
Expected: FAIL — module not found (or "no test script" → add the runner first, see note).

- [ ] **Step 4: Implement `comment-anchor.ts`**

```ts
import * as Y from 'yjs'
import {
  ySyncPluginKey,
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
} from 'y-prosemirror'
import type { EditorView } from '@tiptap/pm/view'

import type { CommentThreadAnchor } from './types-comments'

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}
function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

export function encodeAnchor(rel: Y.RelativePosition): string {
  return toBase64(Y.encodeRelativePosition(rel))
}
export function decodeAnchor(b64: string): Y.RelativePosition {
  return Y.decodeRelativePosition(fromBase64(b64))
}

type YState = { doc: Y.Doc; type: Y.XmlFragment; binding: { mapping: unknown } }

function ystate(view: EditorView): YState | null {
  const st = ySyncPluginKey.getState(view.state) as YState | undefined
  return st?.binding ? st : null
}

/** Current selection → encoded anchor + quoted text. Read-only safe. Null if empty/no-binding. */
export function selectionToAnchor(
  view: EditorView,
): { anchorStart: string; anchorEnd: string; quotedText: string } | null {
  const st = ystate(view)
  if (!st) return null
  const { from, to } = view.state.selection
  if (from === to) return null
  const relStart = absolutePositionToRelativePosition(from, st.type, st.binding.mapping)
  const relEnd = absolutePositionToRelativePosition(to, st.type, st.binding.mapping)
  return {
    anchorStart: encodeAnchor(relStart),
    anchorEnd: encodeAnchor(relEnd),
    quotedText: view.state.doc.textBetween(from, to, ' ').slice(0, 2000),
  }
}

/** Encoded anchor → absolute PM range, or null if the anchored text is gone (orphan). */
export function anchorToRange(
  view: EditorView,
  anchor: Pick<CommentThreadAnchor, 'anchorStart' | 'anchorEnd'>,
): { from: number; to: number } | null {
  const st = ystate(view)
  if (!st) return null
  const from = relativePositionToAbsolutePosition(st.doc, st.type, decodeAnchor(anchor.anchorStart), st.binding.mapping)
  const to = relativePositionToAbsolutePosition(st.doc, st.type, decodeAnchor(anchor.anchorEnd), st.binding.mapping)
  if (from == null || to == null || from >= to) return null
  return { from, to }
}
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @repo/editor test -- comment-anchor`
Expected: PASS (both round-trip tests).

- [ ] **Step 6: Commit**

```bash
git add packages/editor/src/comment-anchor.ts packages/editor/src/types-comments.ts packages/editor/test/comment-anchor.test.ts
git commit -m "feat(editor): comment-anchor RelativePosition codec + range resolver"
```

---

### Task 6: `comments` extension (decoration plugin)

**Files:**
- Create: `packages/editor/src/extensions/comments.ts`
- Modify: `packages/editor/src/extensions/index.ts`, `packages/editor/src/types.ts`, `packages/editor/src/anynote-editor.tsx`

- [ ] **Step 1: Implement the extension** `packages/editor/src/extensions/comments.ts` (mirrors the `drop-placement.ts` plugin shape: PluginKey + state via setMeta + `props.decorations`)

```ts
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

import { anchorToRange } from '../comment-anchor'
import type { CommentThreadAnchor } from '../types-comments'

type PluginState = { threads: CommentThreadAnchor[] }
export const commentsPluginKey = new PluginKey<PluginState>('comments')

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    comments: { setCommentThreads: (threads: CommentThreadAnchor[]) => ReturnType }
  }
}

function build(view: EditorView, threads: CommentThreadAnchor[]): DecorationSet {
  const decos: Decoration[] = []
  for (const t of threads) {
    if (t.resolvedAt) continue
    const range = anchorToRange(view, t)
    if (!range) continue
    decos.push(
      Decoration.inline(range.from, range.to, { class: 'comment-highlight', 'data-thread-id': t.id }),
    )
  }
  return DecorationSet.create(view.state.doc, decos)
}

export type CommentsOptions = { onOpenThread: (threadId: string) => void }

export const Comments = Extension.create<CommentsOptions>({
  name: 'comments',
  addOptions() {
    return { onOpenThread: () => undefined }
  },
  addCommands() {
    return {
      setCommentThreads:
        (threads) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(commentsPluginKey, { threads }))
          return true
        },
    }
  },
  addProseMirrorPlugins() {
    const onOpenThread = this.options.onOpenThread
    return [
      new Plugin<PluginState>({
        key: commentsPluginKey,
        state: {
          init: () => ({ threads: [] }),
          apply(tr, value) {
            const meta = tr.getMeta(commentsPluginKey) as PluginState | undefined
            return meta ?? value
          },
        },
        props: {
          decorations(state) {
            // Re-resolve on every render so anchors track edits.
            const view = (this as unknown as { view?: EditorView }).view
            const pstate = commentsPluginKey.getState(state)
            if (!view || !pstate) return DecorationSet.empty
            return build(view, pstate.threads)
          },
          handleClick(view, pos) {
            const pstate = commentsPluginKey.getState(view.state)
            if (!pstate) return false
            for (const t of pstate.threads) {
              if (t.resolvedAt) continue
              const range = anchorToRange(view, t)
              if (range && pos >= range.from && pos < range.to) {
                onOpenThread(t.id)
                return true
              }
            }
            return false
          },
        },
      }),
    ]
  },
})
```

> The `props.decorations` closure can't rely on `this.view` reliably across PM versions; if `view` is unavailable there, fall back to computing the `DecorationSet` in the plugin `state.apply` (store the set in state, recompute on every transaction using `tr.doc` + a captured `EditorView` from the plugin `view()` lifecycle). Verify which works under `@tiptap/pm` in this repo during implementation; prefer the `view()`-captured reference (same approach `drop-placement.ts` uses to access `editorView`).

- [ ] **Step 2: Add editor props.** In `packages/editor/src/types.ts` add to `AnyNoteEditorProps`:

```ts
  commentThreads?: import('./types-comments').CommentThreadAnchor[]
  onCreateComment?: (anchor: { anchorStart: string; anchorEnd: string; quotedText: string }) => void
  onOpenThread?: (threadId: string) => void
  canComment?: boolean
```
and re-export the type: `export type { CommentThreadAnchor } from './types-comments'`.

- [ ] **Step 3: Wire into `buildExtensions`.** In `extensions/index.ts`, add to `BuildExtensionsOptions`:

```ts
  onOpenThread: (threadId: string) => void
```
import `Comments`, and add `Comments.configure({ onOpenThread: opts.onOpenThread })` to the returned array (after `DropPlacement`).

- [ ] **Step 4: Pass the option + push threads.** In `anynote-editor.tsx`:
  - add `onOpenThread` to the `buildExtensions({...})` call: `onOpenThread: props.onOpenThread ?? (() => undefined)`.
  - after the editor is created, add an effect that pushes threads into the plugin:

```tsx
  useEffect(() => {
    if (!editor) return
    editor.commands.setCommentThreads(props.commentThreads ?? [])
  }, [editor, props.commentThreads])
```

- [ ] **Step 5: Add the highlight style.** Append to the editor content stylesheet (`packages/editor/src/styles/content.css` or wherever `.anynote-editor` styles live):

```css
.comment-highlight {
  background: color-mix(in srgb, #ffb300 28%, transparent);
  border-bottom: 2px solid #ffb300;
  cursor: pointer;
}
```

- [ ] **Step 6: Verify types + commit**

Run: `pnpm --filter @repo/editor check-types`
Expected: PASS.

```bash
git add packages/editor/src/extensions/comments.ts packages/editor/src/extensions/index.ts packages/editor/src/types.ts packages/editor/src/anynote-editor.tsx packages/editor/src/styles
git commit -m "feat(editor): comment highlight decorations + setCommentThreads"
```

---

### Task 7: «Комментировать» toolbar button

**Files:**
- Modify: `packages/editor/src/components/floating-toolbar.tsx`

- [ ] **Step 1: Add the button.** In `floating-toolbar.tsx`, accept the new props (it already receives `editor`; add `canComment` + `onCreateComment` via the editor's options or a new prop). The toolbar reads them from a module-level ref set by `anynote-editor.tsx`, OR (simpler) from `editor.storage`. Use `editor.storage`: in `anynote-editor.tsx` set `editor.storage.comments = { canComment, onCreateComment }` in an effect, then in the toolbar:

```tsx
import { selectionToAnchor } from '../comment-anchor'
// ...inside the toolbar button Stack, after the highlight button:
{(editor.storage as { comments?: { canComment?: boolean; onCreateComment?: (a: unknown) => void } }).comments
  ?.canComment ? (
  <ToolbarButton
    label="Комментировать"
    onClick={() => {
      const anchor = selectionToAnchor(editor.view)
      const cb = (editor.storage as { comments?: { onCreateComment?: (a: unknown) => void } }).comments
        ?.onCreateComment
      if (anchor && cb) cb(anchor)
    }}
  >
    <CommentIcon fontSize="small" />
  </ToolbarButton>
) : null}
```

Use the existing toolbar-button component/markup in that file (match how the highlight/link buttons are rendered — this snippet is illustrative; copy the actual button element used at the highlight button site). Add a `comments` storage initializer in the extension: `addStorage() { return { canComment: false, onCreateComment: undefined } }` in `comments.ts`.

- [ ] **Step 2: Set storage in `anynote-editor.tsx`**

```tsx
  useEffect(() => {
    if (!editor) return
    ;(editor.storage as Record<string, unknown>).comments = {
      canComment: props.canComment ?? false,
      onCreateComment: props.onCreateComment,
    }
  }, [editor, props.canComment, props.onCreateComment])
```

- [ ] **Step 3: Add `CommentIcon`** to `@repo/ui` if missing: `export { default as CommentIcon } from '@mui/icons-material/ChatBubbleOutline'` in `packages/ui/src/components/index.ts`; import it in the toolbar from `@repo/ui/components`.

- [ ] **Step 4: Verify + commit**

Run: `pnpm --filter @repo/editor check-types && pnpm --filter @repo/ui check-types`
Expected: PASS.

```bash
git add packages/editor/src/components/floating-toolbar.tsx packages/editor/src/extensions/comments.ts packages/editor/src/anynote-editor.tsx packages/ui/src/components/index.ts
git commit -m "feat(editor): «Комментировать» button on the floating toolbar"
```

---

### Task 8: App-side comments UI + PageRenderer wiring

**Files:**
- Create: `apps/web/src/components/page/comments/anon-id.ts`, `use-page-comments.ts`, `comment-composer.tsx`, `thread-popover.tsx`, `comments-panel.tsx`
- Modify: `apps/web/src/components/page/page-renderer.tsx`

- [ ] **Step 1: anon id** `anon-id.ts`

```ts
const KEY = 'anynote.anonId'
export function getAnonId(): string {
  if (globalThis.window === undefined) return ''
  let id = globalThis.localStorage.getItem(KEY)
  if (!id) {
    id = crypto.randomUUID()
    globalThis.localStorage.setItem(KEY, id)
  }
  return id
}
```

- [ ] **Step 2: data hook** `use-page-comments.ts` — wraps the tRPC calls + supplies `pageId`/`shareId`/`anonId` and exposes threads + mutations. For the in-app renderer pass `{ pageId }`; the share route passes `{ shareId, anonId }`.

```ts
'use client'
import { useMemo } from 'react'
import { trpc } from '@/trpc/client'

type Target = { pageId: string } | { shareId: string; anonId: string }

export function usePageComments(target: Target) {
  const utils = trpc.useUtils()
  const input = 'pageId' in target ? { pageId: target.pageId } : { shareId: target.shareId, anonId: target.anonId }
  const threadsQ = trpc.comment.listThreads.useQuery(input, { refetchOnWindowFocus: true })
  const invalidate = () => utils.comment.listThreads.invalidate()
  const createThread = trpc.comment.createThread.useMutation({ onSuccess: invalidate })
  const addComment = trpc.comment.addComment.useMutation({ onSuccess: invalidate })
  const editComment = trpc.comment.editComment.useMutation({ onSuccess: invalidate })
  const deleteComment = trpc.comment.deleteComment.useMutation({ onSuccess: invalidate })
  const resolveThread = trpc.comment.resolveThread.useMutation({ onSuccess: invalidate })
  const reopenThread = trpc.comment.reopenThread.useMutation({ onSuccess: invalidate })
  const base = useMemo(() => input, [JSON.stringify(input)])
  return { threads: threadsQ.data ?? [], base, invalidate, createThread, addComment, editComment, deleteComment, resolveThread, reopenThread }
}
```

- [ ] **Step 3: composer** `comment-composer.tsx` — a `TextField` (multiline) + send button; emits `{ text, mentions: [] }` (mentions wired in Task 10). Cmd/Ctrl+Enter submits. Use `@repo/ui/components` (`TextField`, `Button`, `Stack`).

```tsx
'use client'
import { useState } from 'react'
import { Button, Stack, TextField } from '@repo/ui/components'

export function CommentComposer({ onSubmit, autoFocus }: { onSubmit: (c: { text: string; mentions: string[] }) => void; autoFocus?: boolean }) {
  const [text, setText] = useState('')
  const submit = () => {
    const t = text.trim()
    if (!t) return
    onSubmit({ text: t, mentions: [] })
    setText('')
  }
  return (
    <Stack direction="row" spacing={1} alignItems="flex-end">
      <TextField
        fullWidth size="small" multiline maxRows={6} placeholder="Комментарий…" value={text}
        autoFocus={autoFocus}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit() } }}
      />
      <Button variant="contained" size="small" onClick={submit} disabled={!text.trim()}>Отпр.</Button>
    </Stack>
  )
}
```

- [ ] **Step 4: thread popover** `thread-popover.tsx` — given a thread (from `threads`), render the comment list + a reply composer + Решить/Открыть. Positioned via MUI `Popover`/`Popper` anchored to a DOM rect (the highlight element `[data-thread-id]`). Renders comment author/name/time + own-delete.

```tsx
'use client'
import { Box, Button, Paper, Stack, Typography } from '@repo/ui/components'
import { CommentComposer } from './comment-composer'

type Comment = { id: string; authorName: string; content: { text: string }; createdAt: string | Date }
type Thread = { id: string; quotedText: string; resolvedAt: string | Date | null; comments: Comment[] }

export function ThreadCard({
  thread, onReply, onResolve, onReopen, onDeleteComment,
}: {
  thread: Thread
  onReply: (text: string, mentions: string[]) => void
  onResolve: () => void
  onReopen: () => void
  onDeleteComment: (commentId: string) => void
}) {
  return (
    <Paper sx={{ p: 1.5, width: 320, maxHeight: 420, overflow: 'auto' }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>«{thread.quotedText}»</Typography>
      <Stack spacing={1} sx={{ mt: 1 }}>
        {thread.comments.map((c) => (
          <Box key={c.id}>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="subtitle2">{c.authorName}</Typography>
              <Button size="small" color="error" onClick={() => onDeleteComment(c.id)}>×</Button>
            </Stack>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{c.content.text}</Typography>
          </Box>
        ))}
      </Stack>
      <Box sx={{ mt: 1 }}>
        <CommentComposer onSubmit={(c) => onReply(c.text, c.mentions)} />
      </Box>
      <Box sx={{ mt: 1, textAlign: 'right' }}>
        {thread.resolvedAt ? (
          <Button size="small" onClick={onReopen}>Открыть заново</Button>
        ) : (
          <Button size="small" onClick={onResolve}>Решить</Button>
        )}
      </Box>
    </Paper>
  )
}
```

- [ ] **Step 5: comments panel** `comments-panel.tsx` — a toggleable right column listing threads with Active/Resolved filter; clicking a thread calls `onOpenThread(threadId)` (scroll/flash handled by the editor highlight + popover open).

```tsx
'use client'
import { useState } from 'react'
import { Box, Button, Stack, Typography } from '@repo/ui/components'

type Thread = { id: string; quotedText: string; resolvedAt: string | Date | null; comments: { authorName: string; content: { text: string } }[] }

export function CommentsPanel({ threads, onOpen }: { threads: Thread[]; onOpen: (id: string) => void }) {
  const [tab, setTab] = useState<'active' | 'resolved'>('active')
  const shown = threads.filter((t) => (tab === 'active' ? !t.resolvedAt : !!t.resolvedAt))
  return (
    <Box sx={{ width: 320, borderLeft: 1, borderColor: 'divider', height: '100%', overflow: 'auto', p: 1.5 }}>
      <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
        <Button size="small" variant={tab === 'active' ? 'contained' : 'text'} onClick={() => setTab('active')}>Активные</Button>
        <Button size="small" variant={tab === 'resolved' ? 'contained' : 'text'} onClick={() => setTab('resolved')}>Решённые</Button>
      </Stack>
      <Stack spacing={1}>
        {shown.map((t) => (
          <Box key={t.id} onClick={() => onOpen(t.id)} sx={{ p: 1, borderRadius: 1, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}>
            <Typography variant="caption" color="text.secondary" noWrap>«{t.quotedText}»</Typography>
            <Typography variant="body2" noWrap>{t.comments[0]?.authorName}: {t.comments[0]?.content.text}</Typography>
          </Box>
        ))}
        {shown.length === 0 && <Typography variant="body2" color="text.secondary">Нет комментариев</Typography>}
      </Stack>
    </Box>
  )
}
```

- [ ] **Step 6: Wire `PageRenderer`** (TEXT branch only). Add (near the top of the component): the comments hook, panel toggle state, and an "open thread" handler that finds the highlight DOM node and opens the popover. Map threads → `CommentThreadAnchor[]` for the editor. Pass `canComment` (from a new prop — see Task 12; default `true` for in-app members), `commentThreads`, `onCreateComment` (opens a new-thread composer that calls `createThread`), `onOpenThread`. Render `<CommentsPanel>` beside the editor and the active `<ThreadCard>` in a `Popover` anchored to `[data-thread-id="…"]`.

```tsx
// inside PageRenderer, TEXT branch wiring (add a new Props field `canComment?: boolean` defaulting true)
const comments = usePageComments({ pageId: page.id })
const [openThreadId, setOpenThreadId] = useState<string | null>(null)
const commentThreads = comments.threads.map((t) => ({
  id: t.id, anchorStart: t.anchorStart, anchorEnd: t.anchorEnd, resolvedAt: t.resolvedAt,
}))
const handleCreateComment = (anchor: { anchorStart: string; anchorEnd: string; quotedText: string }) => {
  // open a transient composer; on submit:
  comments.createThread.mutate({ ...comments.base, ...anchor, content: { text: /* from composer */ '', mentions: [] } })
}
```

> The new-thread composer flow (Step 6) needs a small transient popover at the selection. Reuse the `ThreadCard` composer pattern: on `onCreateComment(anchor)` store `pendingAnchor` + open a composer popover anchored to the current selection rect (`editor.view.coordsAtPos`); on submit call `createThread.mutate`. Implement this as a `NewThreadPopover` analogous to `ThreadCard` (composer only). The editor branch passes `onCreateComment={(a) => setPendingAnchor(a)}`.

- [ ] **Step 7: Verify + dev smoke + commit**

Run: `pnpm --filter web check-types`
Expected: PASS.
Dev smoke (`docker compose up -d`, `pnpm --filter web dev`, **and** `pnpm --filter @repo/yjs-server dev` so the doc syncs): open a TEXT page, select text → «Комментировать» → type → a highlight appears; reload → highlight persists; click highlight → thread popover; reply; Решить → highlight disappears.

```bash
git add apps/web/src/components/page/comments apps/web/src/components/page/page-renderer.tsx
git commit -m "feat(web): inline comment UI (highlight popover + panel) wired to PageRenderer"
```

---

# Phase 3 — Mentions + notifications

### Task 9: notification fan-out test

The `actorId?` optional relaxation and `notifyNewComment` both landed in Task 3 (Step 4). This task locks the fan-out behavior with a test.

**Files:**
- Test: `packages/trpc/test/comment-router.test.ts`

- [ ] **Step 1: Add the assertions** (append a `describe`; the `notify` mock is already declared at the top of the file from Task 3)

```ts
import { notify } from '@repo/notifications'

describe('comment notification fan-out', () => {
  beforeEach(() => vi.clearAllMocks())

  it('notifies the page author + mentioned users on a new thread', async () => {
    const tx = {
      pageCommentThread: { create: vi.fn(async () => ({ id: 't1' })) },
      pageComment: { create: vi.fn(async () => ({ id: 'c1' })) },
    }
    const prisma = {
      page: { findUnique: vi.fn(async () => PAGE) },
      workspaceMember: { findUnique: vi.fn(async () => ({ role: 'COMMENTER' })) },
      user: { findUnique: vi.fn(async () => ({ firstName: 'A', lastName: '', email: 'a@b.c' })) },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      pageComment: { findFirst: vi.fn(async () => ({ id: 'c1' })) },
      pageCommentThread: {
        findUnique: vi.fn(async () => ({ createdById: null, page: { createdById: 'owner' }, comments: [] })),
      },
    } as never
    await caller(ctx(prisma, { id: 'u1' })).createThread({
      pageId: 'p1', anchorStart: 'x', anchorEnd: 'y', quotedText: 'q',
      content: { text: 'hi', mentions: ['11111111-1111-1111-1111-111111111111'] },
    })
    expect(notify.commentCreated).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'owner' }),
    )
    expect(notify.pageMention).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: '11111111-1111-1111-1111-111111111111' }),
    )
  })
})
```

- [ ] **Step 2: Run** — `pnpm --filter @repo/trpc test -- comment-router`. Expected: PASS (behavior exists from Task 3).
- [ ] **Step 3: Commit**

```bash
git add packages/trpc/test/comment-router.test.ts
git commit -m "test(trpc): comment notification fan-out"
```

---

### Task 10: @mention autocomplete in the composer

**Files:**
- Modify: `apps/web/src/components/page/comments/comment-composer.tsx`

- [ ] **Step 1: Add an @-autocomplete.** Track the `@token` under the caret; query members via `trpc.workspace.listMembers` + `filterMentionItems` (from `@repo/editor`); on select, insert a `@Name` chip token into the text and push the userId into `mentions`. Keep the stored shape `{ text, mentions: string[] }`. (For the share route where `listMembers` is unavailable to anonymous users, the autocomplete simply returns no results — degrade gracefully.)

```tsx
import { filterMentionItems } from '@repo/editor'
import { trpc } from '@/trpc/client'
// maintain `mentions: string[]`; render a small dropdown of filterMentionItems(members, token);
// on pick: append "@"+name+" " to text and mentions.push(userId).
```

> This is a focused enhancement of the Task 8 composer. Keep the textarea; render a positioned `Paper` list when an `@token` is active (same pattern as the ShareDialog search dropdown). On submit, emit `{ text, mentions }`. Verify with `pnpm --filter web check-types`.

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/page/comments/comment-composer.tsx
git commit -m "feat(web): @mention autocomplete in the comment composer"
```

---

# Phase 4 — Anonymous / public path

### Task 11: public-link + anonymous resolution + moderation

**Files:**
- Modify: `packages/trpc/src/helpers/comment-access.ts`
- Test: `packages/trpc/test/comment-access.test.ts`

- [ ] **Step 1: Add failing tests** (append)

```ts
describe('resolveCommentContext (public + anonymous)', () => {
  const SHARE = { id: 's1', access: 'PUBLIC', linkRole: 'COMMENTER', pageId: 'p1', page: { id: 'p1', workspaceId: 'w1', createdById: 'owner' } }
  const ANIMALS_OK = /^Гость · /

  it('resolves an anonymous viewer via a PUBLIC commenter link', async () => {
    const prisma = { pageShare: { findUnique: vi.fn(async () => SHARE) } }
    const res = await resolveCommentContext(ctx(prisma, null), { shareId: 's1', anonId: 'a-1' })
    expect(res.role).toBe('COMMENTER')
    expect(res.author.anonId).toBe('a-1')
    expect(res.author.name).toMatch(ANIMALS_OK)
    expect(res.pageId).toBe('p1')
  })

  it('denies anonymous when the link is RESTRICTED', async () => {
    const prisma = { pageShare: { findUnique: vi.fn(async () => ({ ...SHARE, access: 'RESTRICTED' })) } }
    const res = await resolveCommentContext(ctx(prisma, null), { shareId: 's1', anonId: 'a-1' })
    expect(res.role).toBeNull()
  })
})
```

- [ ] **Step 2: Implement** — add a `shareId` lookup path to `resolveCommentContext`. When `input.shareId` is present, load the share (with its page); use it both to discover the `pageId` (when `pageId` not given) and to grant the public `linkRole`. For an anonymous user (`ctx.user` null) require the share `PUBLIC`. Replace the top "load page" block + the trailing anonymous return:

```ts
  // Resolve the page from pageId OR shareId.
  const share = input.shareId
    ? await ctx.prisma.pageShare.findUnique({
        where: { shareId: input.shareId },
        select: { id: true, access: true, linkRole: true, pageId: true, page: { select: { id: true, workspaceId: true, createdById: true } } },
      })
    : null
  const page =
    (input.pageId
      ? await ctx.prisma.page.findUnique({ where: { id: input.pageId }, select: { id: true, workspaceId: true, createdById: true } })
      : null) ?? share?.page ?? null
  if (!page) throw new TRPCError({ code: 'NOT_FOUND', message: 'Страница не найдена' })
  const base = { pageId: page.id, workspaceId: page.workspaceId, page: { createdById: page.createdById } }

  if (ctx.user) {
    // ... unchanged member ▸ grant resolution ...
    // then, before the final `return { ...base, role: null, author }`, add a public-link fallback:
    if (share && share.access === 'PUBLIC') return { ...base, role: share.linkRole as EffectiveRole, author }
    return { ...base, role: null, author }
  }

  // Anonymous: only via a PUBLIC link.
  if (share && share.access === 'PUBLIC') {
    const animals = ['Лис', 'Кот', 'Барс', 'Сокол', 'Ёж', 'Бобр', 'Тур', 'Краб']
    const name = `Гость · ${animals[Math.floor(Math.random() * animals.length)]}`
    return { ...base, role: share.linkRole as EffectiveRole, author: { anonId: input.anonId ?? 'anon', name } }
  }
  return { ...base, role: null, author: { name: 'Гость' } }
```

- [ ] **Step 3: Run + commit**

Run: `pnpm --filter @repo/trpc test -- comment-access comment-router && pnpm --filter @repo/trpc check-types`
Expected: PASS.

```bash
git add packages/trpc/src/helpers/comment-access.ts packages/trpc/test/comment-access.test.ts
git commit -m "feat(trpc): anonymous + public-link comment resolution"
```

---

### Task 12: wire the `/s/{shareId}` share route

**Files:**
- Modify: `apps/web/src/app/(share)/s/[shareId]/share-page-client.tsx`, `apps/web/src/components/page/page-renderer.tsx`

- [ ] **Step 1: Thread comment access into `PageRenderer`.** Add to `PageRenderer` `Props`: `commentTarget?: { shareId: string } | { pageId: string }` and `canComment?: boolean`. Default in-app: `commentTarget = { pageId: page.id }`, `canComment = true`. The TEXT branch uses `usePageComments(commentTarget)` and passes `canComment` to `<AnyNoteEditor>`. For anonymous targets, inject `anonId` via `getAnonId()` inside `usePageComments` when `shareId` is present.

- [ ] **Step 2: Share route.** In `share-page-client.tsx`, pass `commentTarget={{ shareId }}` and `canComment={editable || role === 'COMMENTER'}` to `PageRenderer`. Add `role` to `SharePageClient` props (the `/s/` `page.tsx` already computes `role`; pass it through and set `canComment = role !== 'READER'`). Update `page.tsx` to pass `role`.

```tsx
// share-page-client.tsx props add: role: 'OWNER'|'EDITOR'|'COMMENTER'|'READER'
<PageRenderer
  page={page} workspaceId={workspaceId} user={user} yjsToken={yjsToken} editable={editable}
  commentTarget={{ shareId }} canComment={role !== 'READER'}
/>
```

- [ ] **Step 3: Verify + commit**

Run: `pnpm --filter web check-types`
Expected: PASS.

```bash
git add "apps/web/src/app/(share)" apps/web/src/components/page/page-renderer.tsx
git commit -m "feat(web): comments on the public /s share route (anonymous-capable)"
```

---

# Phase 5 — Realtime

### Task 13: `comment.events` subscription + client wiring

**Files:**
- Modify: `packages/trpc/src/routers/comment.ts`
- Modify: `apps/web/src/components/page/comments/use-page-comments.ts`

- [ ] **Step 1: Add a subscription** to `commentRouter` (members only; mirrors `kanban` events). Anonymous/public viewers do not subscribe (they refetch on focus).

```ts
  events: router({
    subscribe: publicProcedure
      .input(z.object({ pageId: z.string().uuid() }))
      .subscription(async function* ({ ctx, input, signal }) {
        const c = await resolveCommentContext(ctx, { pageId: input.pageId })
        if (!c.role) throw new TRPCError({ code: 'FORBIDDEN', message: 'Нет доступа' })
        const queue: import('../realtime/page-comment-bus').PageCommentEvent[] = []
        let resolveNext: ((v: unknown) => void) | null = null
        const unsub = pageCommentBus.on(input.pageId, (e) => {
          if (resolveNext) { const r = resolveNext; resolveNext = null; r(e) } else { queue.push(e) }
        })
        const onAbort = () => { if (resolveNext) { const r = resolveNext; resolveNext = null; r(null) } }
        signal?.addEventListener('abort', onAbort)
        try {
          while (!signal?.aborted) {
            const buffered = queue.shift()
            if (buffered) { yield buffered; continue }
            const e = await new Promise((res) => { resolveNext = res })
            if (e === null || signal?.aborted) break
            yield e as import('../realtime/page-comment-bus').PageCommentEvent
          }
        } finally { unsub(); signal?.removeEventListener('abort', onAbort) }
      }),
  }),
```

(Import `pageCommentBus` is already in the file.)

- [ ] **Step 2: Subscribe in the hook** (only for the `pageId` target). In `use-page-comments.ts`:

```ts
  trpc.comment.events.subscribe.useSubscription(
    'pageId' in target ? { pageId: target.pageId } : undefined,
    { enabled: 'pageId' in target, onData: () => invalidate() },
  )
```

(Guard so the subscription is skipped for `shareId` targets.)

- [ ] **Step 3: Verify + commit**

Run: `pnpm --filter @repo/trpc check-types && pnpm --filter web check-types`
Expected: PASS.

```bash
git add packages/trpc/src/routers/comment.ts apps/web/src/components/page/comments/use-page-comments.ts
git commit -m "feat: realtime comment updates via bus + subscription (members)"
```

---

# Phase 6 — E2E + gates

### Task 14: Playwright E2E

**Files:**
- Create: `apps/e2e/page-comments.spec.ts`

- [ ] **Step 1: Write the spec.** A workspace member creates a comment on a text selection and sees it persist. (Live anchoring needs a yjs server — the Playwright webServer doesn't start one, so this spec verifies the **thread is created + listed via tRPC** and the panel shows it, which doesn't depend on live yjs sync. Anchor decoration rendering is exercised in dev smoke / unit `comment-anchor` test.)

```ts
import { expect, test } from '@playwright/test'
import { signUpAndAuthAs, loadEnvFromRoot } from './helpers/auth'

const password = 'SuperSecure123!'

test('a member adds an inline comment that persists', async ({ page }) => {
  test.setTimeout(120_000)
  await signUpAndAuthAs(page, { email: `comments+${Date.now()}@example.com`, password, firstName: 'Тест', lastName: 'Тест' })
  await page.getByRole('textbox', { name: 'Название' }).fill('Comments WS')
  await page.getByRole('button', { name: 'Создать пространство' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/chats/, { timeout: 30_000 })
  await page.getByRole('button', { name: 'Страницы' }).click()
  await page.getByRole('button', { name: 'Новая страница' }).click()
  await page.getByRole('menuitem', { name: 'Текст' }).click()
  await page.waitForURL(/\/workspaces\/[a-f0-9-]+\/pages\/[a-f0-9-]+/, { timeout: 15_000 })
  const editor = page.locator('.anynote-editor .ProseMirror')
  await expect(editor).toBeVisible({ timeout: 15_000 })
  const pageId = /\/pages\/([a-f0-9-]+)/.exec(page.url())?.[1]

  await editor.click()
  await page.keyboard.type('Комментируемый текст')
  // select the word "Комментируемый"
  await page.keyboard.press('Home')
  for (let i = 0; i < 'Комментируемый'.length; i++) await page.keyboard.press('Shift+ArrowRight')
  await page.getByRole('button', { name: 'Комментировать' }).click()
  await page.getByPlaceholder('Комментарий…').first().fill('Это вопрос')
  await page.getByRole('button', { name: 'Отпр.' }).first().click()

  // Verify persisted in DB.
  loadEnvFromRoot()
  const { prisma } = await import('../../packages/db/src/index')
  let count = 0
  for (let i = 0; i < 50; i++) {
    count = await prisma.pageCommentThread.count({ where: { pageId } })
    if (count > 0) break
    await new Promise((r) => setTimeout(r, 100))
  }
  expect(count).toBe(1)
})
```

> If the «Комментировать» button or composer selectors differ from the rendered DOM, adjust the locators to match — do not change app code to fit the test. Creating the comment requires the editor's y-prosemirror binding to compute the anchor; that works client-side without a yjs server (the binding exists from the Collaboration extension even before the socket connects). If anchor computation proves flaky without a connected provider, assert via the panel/DB only and relax the selection step.

- [ ] **Step 2: Run**

Run: `pnpm exec playwright test apps/e2e/page-comments.spec.ts --retries=1`
Expected: PASS (requires `docker compose up -d`).

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/page-comments.spec.ts
git commit -m "test(e2e): inline comment creation persists"
```

---

### Task 15: Full gate run

- [ ] **Step 1:** `pnpm gates` → fix anything surfaced → re-run until green.
- [ ] **Step 2:** Commit any fixes: `git add -A && git commit -m "chore(comments): satisfy gates"`.

---

## Self-Review

**Spec coverage:**
- Select → thread, replies, resolve/reopen → Tasks 3, 4 (API) + 6, 8 (UI). ✅
- Anchors = RelativePosition decorations (not marks), read-only-safe → Task 5 (`comment-anchor`) + Task 6 (decoration plugin). ✅
- Threads/messages in Postgres → Task 1; `publicProcedure` session-or-shareId → Tasks 2, 3, 11. ✅
- Roles (COMMENTER/EDITOR/OWNER write, READER view) → `canWriteComment` + `resolveCommentContext` (Tasks 2, 11). ✅
- Anonymous commenting (nullable author + name + anonId; publicProcedure shareId path; moderation) → Tasks 1, 11, 12 + delete-any in Task 4. ✅
- @mentions + notifications (reuse `commentCreated`/`pageMention`, `filterMentionItems`) → Tasks 3 (fan-out + `actorId?` relax), 9 (fan-out test), 10 (composer). ✅
- Inline highlight + popover + «Комментарии» panel → Tasks 6, 8. ✅
- Realtime (bus + subscription members; refetch public) → Tasks 3 (bus), 13 (subscription) + `refetchOnWindowFocus` in Task 8. ✅
- Orphan handling (deleted anchor → null range → not highlighted; shown via quotedText in panel under Resolved) → Task 6 (`build` skips null ranges) + Task 8 panel. ✅
- Tests: resolution matrix (2, 11), router CRUD/authz/fan-out (3, 4, 9), anchor yjs round-trip (5), e2e (14). ✅

**Placeholder scan:** No `TODO`/`TBD`. Two tasks (6 decorations-this.view, 8 NewThreadPopover) carry explicit implementation notes with a concrete fallback, not placeholders. Selector drift in E2E is the only flagged flexibility, with guidance.

**Type consistency:** `EffectiveRole` (`OWNER|EDITOR|COMMENTER|READER`) and `canWriteComment` are shared across `comment-access.ts` and the router. `CommentThreadAnchor` (`id, anchorStart, anchorEnd, resolvedAt`) is shared editor↔app and matches `comment.listThreads`'s select. `content` shape `{ text, mentions: string[] }` is consistent across `ContentSchema`, composer, and notify fan-out. `resolveCommentContext` return (`{ pageId, workspaceId, page.createdById, role, author{userId?,anonId?,name} }`) is consumed identically by every procedure. The `notify.commentCreated`/`pageMention` calls match the (now `actorId?`-optional) helper signatures.
