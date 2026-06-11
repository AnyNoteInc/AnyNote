import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@repo/auth', () => ({ getUserFromRequest: vi.fn() }))
vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return { ...actual, prisma: {} }
})
vi.mock('@repo/notifications', () => ({
  notify: { commentCreated: vi.fn(), pageMention: vi.fn(), commentReply: vi.fn() },
  notifyPageActivity: vi.fn(),
  resolvePageActivityRecipients: vi.fn(async () => []),
}))

import type { PrismaClient } from '@repo/db'
import { notify } from '@repo/notifications'
import { commentRouter } from '../src/routers/comment'
import { pageCommentBus } from '../src/realtime/page-comment-bus'
import { createCallerFactory } from '../src/trpc'

const PAGE_ID = '33333333-3333-3333-3333-333333333333'
const PAGE = { id: PAGE_ID, workspaceId: 'w1', createdById: 'owner' }
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
  afterEach(() => vi.restoreAllMocks())

  it('rejects realtime subscriptions for signed-in public-link non-members', async () => {
    const prisma = {
      page: { findUnique: vi.fn(async () => PAGE) },
      user: { findUnique: vi.fn(async () => ({ firstName: 'A', lastName: '', email: 'a@b.c' })) },
      workspaceMember: { findUnique: vi.fn(async () => null) },
      pageShare: { findUnique: vi.fn(async () => ({ id: 'share1', access: 'PUBLIC', linkRole: 'COMMENTER', pageId: PAGE_ID })) },
      pageShareUser: { findFirst: vi.fn(async () => null) },
    } as never
    const subscription = await caller(ctx(prisma, { id: 'u1' })).events.subscribe({ pageId: PAGE_ID })

    const next = subscription.next().then(
      () => ({ ok: true as const, message: '' }),
      (error: Error) => ({ ok: false as const, message: error.message }),
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    pageCommentBus.emit(PAGE_ID, { kind: 'thread.upserted', threadId: '66666666-6666-6666-6666-666666666666' })

    await expect(next).resolves.toEqual({ ok: false, message: 'Нет доступа' })
  })

  it('lists threads for a viewer with access', async () => {
    const prisma = {
      page: { findUnique: vi.fn(async () => PAGE) },
      workspaceMember: { findUnique: vi.fn(async () => ({ role: 'READER' })) },
      user: { findUnique: vi.fn(async () => ({ firstName: 'A', lastName: '', email: 'a@b.c' })) },
      pageCommentThread: { findMany: vi.fn(async () => [{ id: 't1', comments: [] }]) },
    } as never
    const res = await caller(ctx(prisma, { id: 'u1' })).listThreads({ pageId: PAGE_ID })
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
        pageId: PAGE_ID,
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
      // The webhook emission must be transactional with the write — it goes
      // through the SAME tx client, never the root prisma.
      outboxEvent: { createMany: vi.fn(async () => ({ count: 2 })) },
    }
    const prisma = {
      page: { findUnique: vi.fn(async () => PAGE) },
      workspaceMember: {
        findUnique: vi.fn(async () => ({ role: 'COMMENTER' })),
        // The participant 'owner' must be a current workspace member to be
        // notified (the ex-member leak guard).
        findMany: vi.fn(async () => [{ userId: 'owner' }]),
      },
      user: { findUnique: vi.fn(async () => ({ firstName: 'A', lastName: '', email: 'a@b.c' })) },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      pageCommentThread: {
        findUnique: vi.fn(async () => ({ createdById: null, page: { createdById: 'owner' }, comments: [] })),
      },
    } as never
    // make the final findUnique (return value) resolve to the created thread
    ;(prisma as { pageCommentThread: { findUnique: ReturnType<typeof vi.fn> } }).pageCommentThread.findUnique
      .mockResolvedValueOnce({ createdById: null, page: { createdById: 'owner' }, comments: [] })
      .mockResolvedValueOnce(created)
    const res = await caller(ctx(prisma, { id: 'u1' })).createThread({
      pageId: PAGE_ID,
      anchorStart: 'x',
      anchorEnd: 'y',
      quotedText: 'q',
      content: { text: 'hi', mentions: [] },
    })
    expect(tx.pageCommentThread.create).toHaveBeenCalledOnce()
    expect(tx.pageComment.create).toHaveBeenCalledOnce()
    // The comment.created webhook+telegram outbox rows are written INSIDE the transaction.
    expect(tx.outboxEvent.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            eventType: 'comment.created',
            aggregateType: 'webhook_event',
            aggregateId: PAGE_ID,
          }),
          expect.objectContaining({
            eventType: 'comment.created',
            aggregateType: 'telegram_event',
            aggregateId: PAGE_ID,
          }),
        ],
      }),
    )
    expect(res?.id).toBe('t1')
    expect(notify.commentCreated).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'owner' }),
    )
  })

  it('rejects anonymous createThread without anonId on a public commenter link', async () => {
    const prisma = {
      pageShare: {
        findUnique: vi.fn(async () => ({
          id: 'share1',
          access: 'PUBLIC',
          linkRole: 'COMMENTER',
          pageId: PAGE_ID,
          page: PAGE,
        })),
      },
    } as never
    await expect(
      caller(ctx(prisma, null)).createThread({
        shareId: 'public-share',
        anchorStart: 'x',
        anchorEnd: 'y',
        quotedText: 'q',
        content: { text: 'hi', mentions: [] },
      }),
    ).rejects.toThrow(/anonymous identity/i)
  })

  it('creates anonymous public thread with anonId without exposing raw anonId as author name', async () => {
    const tx = {
      pageCommentThread: { create: vi.fn(async () => ({ id: 't1' })) },
      pageComment: { create: vi.fn(async () => ({ id: 'c1' })) },
      outboxEvent: { createMany: vi.fn(async () => ({ count: 2 })) },
    }
    const prisma = {
      pageShare: {
        findUnique: vi.fn(async () => ({
          id: 'share1',
          access: 'PUBLIC',
          linkRole: 'COMMENTER',
          pageId: PAGE_ID,
          page: PAGE,
        })),
      },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      pageCommentThread: { findUnique: vi.fn(async () => ({ id: 't1', page: { createdById: 'owner' }, comments: [] })) },
      workspaceMember: { findMany: vi.fn(async () => []) },
    } as never
    await caller(ctx(prisma, null)).createThread({
      shareId: 'public-share',
      anonId: 'anon-123',
      anchorStart: 'x',
      anchorEnd: 'y',
      quotedText: 'q',
      content: { text: 'hi', mentions: [] },
    })
    expect(tx.pageComment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          authorAnonId: 'anon-123',
          authorName: expect.stringMatching(/^Гость · /),
        }),
      }),
    )
    expect(tx.pageComment.create.mock.calls[0]?.[0].data.authorName).not.toContain('anon-123')
  })

  it('adds a reply with the write + webhook emission inside one transaction', async () => {
    const THREAD_ID = '66666666-6666-6666-6666-666666666666'
    const tx = {
      pageComment: { create: vi.fn(async () => ({ id: 'c2' })) },
      outboxEvent: { createMany: vi.fn(async () => ({ count: 2 })) },
    }
    const prisma = {
      page: { findUnique: vi.fn(async () => PAGE) },
      workspaceMember: {
        findUnique: vi.fn(async () => ({ role: 'COMMENTER' })),
        findMany: vi.fn(async () => []),
      },
      user: { findUnique: vi.fn(async () => ({ firstName: 'A', lastName: '', email: 'a@b.c' })) },
      pageCommentThread: {
        findUnique: vi.fn(async () => ({ pageId: PAGE_ID, page: { createdById: 'owner' }, comments: [] })),
      },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    } as never
    const res = await caller(ctx(prisma, { id: 'u1' })).addComment({
      pageId: PAGE_ID,
      threadId: THREAD_ID,
      content: { text: 'reply', mentions: [] },
    })
    expect(res).toEqual({ id: 'c2' })
    expect(tx.pageComment.create).toHaveBeenCalledOnce()
    expect(tx.outboxEvent.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            eventType: 'comment.created',
            aggregateType: 'webhook_event',
            aggregateId: PAGE_ID,
          }),
          expect.objectContaining({
            eventType: 'comment.created',
            aggregateType: 'telegram_event',
            aggregateId: PAGE_ID,
          }),
        ],
      }),
    )
  })

  it('rejects anonymous addComment without anonId on a public commenter link', async () => {
    const prisma = {
      pageShare: {
        findUnique: vi.fn(async () => ({
          id: 'share1',
          access: 'PUBLIC',
          linkRole: 'COMMENTER',
          pageId: PAGE_ID,
          page: PAGE,
        })),
      },
      pageCommentThread: { findUnique: vi.fn() },
    } as never
    await expect(
      caller(ctx(prisma, null)).addComment({
        shareId: 'public-share',
        threadId: '66666666-6666-6666-6666-666666666666',
        content: { text: 'reply', mentions: [] },
      }),
    ).rejects.toThrow(/anonymous identity/i)
    expect(prisma.pageCommentThread.findUnique).not.toHaveBeenCalled()
  })
})

describe('comment edit/delete/resolve', () => {
  const COMMENT_ID = '55555555-5555-5555-5555-555555555555'
  const THREAD_ID = '66666666-6666-6666-6666-666666666666'
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  function memberPrisma(role: string, extra: Record<string, unknown>) {
    return {
      page: { findUnique: vi.fn(async () => PAGE) },
      workspaceMember: { findUnique: vi.fn(async () => ({ role })) },
      user: { findUnique: vi.fn(async () => ({ firstName: 'A', lastName: '', email: 'a@b.c' })) },
      ...extra,
    } as never
  }

  it('lets the author edit own comment', async () => {
    const emit = vi.spyOn(pageCommentBus, 'emit')
    const prisma = memberPrisma('COMMENTER', {
      pageComment: {
        findUnique: vi.fn(async () => ({ authorId: 'u1', authorAnonId: null, threadId: THREAD_ID, thread: { pageId: PAGE_ID } })),
        update: vi.fn(async () => ({ id: COMMENT_ID })),
      },
    })
    await caller(ctx(prisma, { id: 'u1' })).editComment({ pageId: PAGE_ID, commentId: COMMENT_ID, content: { text: 'x', mentions: [] } })
    expect(prisma.pageComment.update).toHaveBeenCalled()
    expect(emit).toHaveBeenCalledWith(PAGE_ID, { kind: 'thread.upserted', threadId: THREAD_ID })
  })

  it('forbids editing someone else’s comment', async () => {
    const prisma = memberPrisma('COMMENTER', {
      pageComment: { findUnique: vi.fn(async () => ({ authorId: 'other', authorAnonId: null, thread: { pageId: PAGE_ID } })) },
    })
    await expect(
      caller(ctx(prisma, { id: 'u1' })).editComment({ pageId: PAGE_ID, commentId: COMMENT_ID, content: { text: 'x', mentions: [] } }),
    ).rejects.toThrow(/только свои/)
  })

  it('does not let missing anonymous anonId match an anonymous owner for edit', async () => {
    const prisma = {
      pageShare: {
        findUnique: vi.fn(async () => ({
          id: 'share1',
          access: 'PUBLIC',
          linkRole: 'COMMENTER',
          pageId: PAGE_ID,
          page: PAGE,
        })),
      },
      pageComment: {
        findUnique: vi.fn(async () => ({
          authorId: null,
          authorAnonId: 'anon',
          thread: { pageId: PAGE_ID },
        })),
        update: vi.fn(),
      },
    } as never
    await expect(
      caller(ctx(prisma, null)).editComment({
        shareId: 'public-share',
        commentId: COMMENT_ID,
        content: { text: 'x', mentions: [] },
      }),
    ).rejects.toThrow(/anonymous identity/i)
    expect(prisma.pageComment.update).not.toHaveBeenCalled()
  })

  it('rejects anonymous deleteComment without anonId before owner matching', async () => {
    const prisma = {
      pageShare: {
        findUnique: vi.fn(async () => ({
          id: 'share1',
          access: 'PUBLIC',
          linkRole: 'COMMENTER',
          pageId: PAGE_ID,
          page: PAGE,
        })),
      },
      pageComment: { findUnique: vi.fn(), update: vi.fn() },
    } as never
    await expect(
      caller(ctx(prisma, null)).deleteComment({
        shareId: 'public-share',
        commentId: COMMENT_ID,
      }),
    ).rejects.toThrow(/anonymous identity/i)
    expect(prisma.pageComment.findUnique).not.toHaveBeenCalled()
  })

  it('lets an EDITOR delete any comment (moderation)', async () => {
    const prisma = memberPrisma('EDITOR', {
      pageComment: {
        findUnique: vi.fn(async () => ({ authorId: 'other', authorAnonId: null, threadId: THREAD_ID, thread: { pageId: PAGE_ID } })),
        update: vi.fn(async () => ({ id: COMMENT_ID })),
        count: vi.fn(async () => 1),
      },
      pageCommentThread: { update: vi.fn() },
    })
    await caller(ctx(prisma, { id: 'u1' })).deleteComment({ pageId: PAGE_ID, commentId: COMMENT_ID })
    expect(prisma.pageComment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
    )
  })

  it('resolves a thread (write + webhook emission inside one transaction)', async () => {
    const tx = {
      pageCommentThread: { update: vi.fn(async () => ({ id: THREAD_ID, resolvedAt: new Date() })) },
      outboxEvent: { createMany: vi.fn(async () => ({ count: 2 })) },
    }
    const prisma = memberPrisma('COMMENTER', {
      pageCommentThread: { findUnique: vi.fn(async () => ({ pageId: PAGE_ID })) },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    })
    const res = await caller(ctx(prisma, { id: 'u1' })).resolveThread({ pageId: PAGE_ID, threadId: THREAD_ID })
    expect(res.resolvedAt).toBeTruthy()
    expect(tx.pageCommentThread.update).toHaveBeenCalledOnce()
    expect(tx.outboxEvent.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            eventType: 'comment.resolved',
            aggregateType: 'webhook_event',
            aggregateId: PAGE_ID,
          }),
          expect.objectContaining({
            eventType: 'comment.resolved',
            aggregateType: 'telegram_event',
            aggregateId: PAGE_ID,
          }),
        ],
      }),
    )
  })

  it('rejects anonymous resolveThread without anonId on a public commenter link', async () => {
    const prisma = {
      pageShare: {
        findUnique: vi.fn(async () => ({
          id: 'share1',
          access: 'PUBLIC',
          linkRole: 'COMMENTER',
          pageId: PAGE_ID,
          page: PAGE,
        })),
      },
      pageCommentThread: { findUnique: vi.fn(), update: vi.fn() },
    } as never
    await expect(
      caller(ctx(prisma, null)).resolveThread({
        shareId: 'public-share',
        threadId: THREAD_ID,
      }),
    ).rejects.toThrow(/anonymous identity/i)
    expect(prisma.pageCommentThread.findUnique).not.toHaveBeenCalled()
    expect(prisma.pageCommentThread.update).not.toHaveBeenCalled()
  })

  it('rejects anonymous reopenThread without anonId on a public commenter link', async () => {
    const prisma = {
      pageShare: {
        findUnique: vi.fn(async () => ({
          id: 'share1',
          access: 'PUBLIC',
          linkRole: 'COMMENTER',
          pageId: PAGE_ID,
          page: PAGE,
        })),
      },
      pageCommentThread: { findUnique: vi.fn(), update: vi.fn() },
    } as never
    await expect(
      caller(ctx(prisma, null)).reopenThread({
        shareId: 'public-share',
        threadId: THREAD_ID,
      }),
    ).rejects.toThrow(/anonymous identity/i)
    expect(prisma.pageCommentThread.findUnique).not.toHaveBeenCalled()
    expect(prisma.pageCommentThread.update).not.toHaveBeenCalled()
  })

  it('auto-resolves a thread when its last comment is deleted', async () => {
    const prisma = memberPrisma('COMMENTER', {
      pageComment: {
        findUnique: vi.fn(async () => ({
          authorId: 'u1',
          authorAnonId: null,
          threadId: THREAD_ID,
          thread: { pageId: PAGE_ID },
        })),
        update: vi.fn(async () => ({ id: COMMENT_ID })),
        count: vi.fn(async () => 0),
      },
      pageCommentThread: { update: vi.fn(async () => ({})) },
    })
    await caller(ctx(prisma, { id: 'u1' })).deleteComment({ pageId: PAGE_ID, commentId: COMMENT_ID })
    expect(prisma.pageCommentThread.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { resolvedAt: expect.any(Date) } }),
    )
  })

  it('forbids an anonymous public-EDITOR-link visitor from deleting another user’s comment', async () => {
    const prisma = {
      pageShare: {
        findUnique: vi.fn(async () => ({
          id: 's1',
          access: 'PUBLIC',
          linkRole: 'EDITOR',
          pageId: PAGE_ID,
          page: PAGE,
        })),
      },
      pageComment: {
        findUnique: vi.fn(async () => ({
          authorId: 'someone-else',
          authorAnonId: 'other-anon',
          threadId: THREAD_ID,
          thread: { pageId: PAGE_ID },
        })),
      },
    } as never
    await expect(
      caller(ctx(prisma, null)).deleteComment({
        shareId: 'e'.repeat(64),
        anonId: 'my-anon',
        commentId: COMMENT_ID,
      }),
    ).rejects.toThrow(/Недостаточно прав на удаление/)
  })
})

describe('comment access boundaries + mention validation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('denies listThreads for a no-access viewer (role null)', async () => {
    const prisma = {
      page: { findUnique: vi.fn(async () => PAGE) },
      workspaceMember: { findUnique: vi.fn(async () => null) },
      pageShare: { findUnique: vi.fn(async () => null) },
      pageShareUser: { findFirst: vi.fn(async () => null) },
      user: { findUnique: vi.fn(async () => ({ firstName: 'X', lastName: '', email: 'x@y.z' })) },
    } as never
    await expect(caller(ctx(prisma, { id: 'u9' })).listThreads({ pageId: PAGE_ID })).rejects.toThrow(/Нет доступа/)
  })

  it('drops mentions of non-workspace-members (no pageMention, snippet not leaked)', async () => {
    const tx = {
      pageCommentThread: { create: vi.fn(async () => ({ id: 't1' })) },
      pageComment: { create: vi.fn(async () => ({ id: 'c1' })) },
      outboxEvent: { createMany: vi.fn(async () => ({ count: 2 })) },
    }
    const prisma = {
      page: { findUnique: vi.fn(async () => PAGE) },
      // findMany validates BOTH mentions and participants against membership: the
      // bogus mention id is absent (→ dropped), the real participant 'owner' is a
      // member (→ kept). Keyed on the queried ids so each call returns its members.
      workspaceMember: {
        findUnique: vi.fn(async () => ({ role: 'COMMENTER' })),
        findMany: vi.fn(async ({ where }: { where: { userId: { in: string[] } } }) =>
          where.userId.in.includes('owner') ? [{ userId: 'owner' }] : [],
        ),
      },
      user: { findUnique: vi.fn(async () => ({ firstName: 'A', lastName: '', email: 'a@b.c' })) },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      pageCommentThread: { findUnique: vi.fn(async () => ({ page: { createdById: 'owner' }, comments: [] })) },
    } as never
    await caller(ctx(prisma, { id: 'u1' })).createThread({
      pageId: PAGE_ID, anchorStart: 'x', anchorEnd: 'y', quotedText: 'q',
      content: { text: 'hi', mentions: ['77777777-7777-7777-7777-777777777777'] },
    })
    expect(prisma.workspaceMember.findMany).toHaveBeenCalled()
    expect(notify.pageMention).not.toHaveBeenCalled()
    expect(notify.commentCreated).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'owner' }),
    )
  })

  it('notifies a mentioned workspace member via pageMention', async () => {
    const MENTION = '88888888-8888-8888-8888-888888888888'
    const tx = {
      pageCommentThread: { create: vi.fn(async () => ({ id: 't1' })) },
      pageComment: { create: vi.fn(async () => ({ id: 'c1' })) },
      outboxEvent: { createMany: vi.fn(async () => ({ count: 2 })) },
    }
    const prisma = {
      page: { findUnique: vi.fn(async () => PAGE) },
      workspaceMember: {
        findUnique: vi.fn(async () => ({ role: 'COMMENTER' })),
        findMany: vi.fn(async () => [{ userId: MENTION }]),
      },
      user: { findUnique: vi.fn(async () => ({ firstName: 'A', lastName: '', email: 'a@b.c' })) },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      pageCommentThread: { findUnique: vi.fn(async () => ({ page: { createdById: 'owner' }, comments: [] })) },
    } as never
    await caller(ctx(prisma, { id: 'u1' })).createThread({
      pageId: PAGE_ID, anchorStart: 'x', anchorEnd: 'y', quotedText: 'q',
      content: { text: 'hi', mentions: [MENTION] },
    })
    expect(notify.pageMention).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: MENTION }),
    )
  })
})
