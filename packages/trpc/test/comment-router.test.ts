import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@repo/auth', () => ({ getUserFromRequest: vi.fn() }))
vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return { ...actual, prisma: {} }
})
vi.mock('@repo/notifications', () => ({ notify: { commentCreated: vi.fn(), pageMention: vi.fn() } }))

import type { PrismaClient } from '@repo/db'
import { notify } from '@repo/notifications'
import { commentRouter } from '../src/routers/comment'
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
    expect(res?.id).toBe('t1')
    expect(notify.commentCreated).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'owner' }),
    )
  })
})

describe('comment edit/delete/resolve', () => {
  const COMMENT_ID = '55555555-5555-5555-5555-555555555555'
  const THREAD_ID = '66666666-6666-6666-6666-666666666666'
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
        findUnique: vi.fn(async () => ({ authorId: 'u1', authorAnonId: null, thread: { pageId: PAGE_ID } })),
        update: vi.fn(async () => ({ id: COMMENT_ID })),
      },
    })
    await caller(ctx(prisma, { id: 'u1' })).editComment({ pageId: PAGE_ID, commentId: COMMENT_ID, content: { text: 'x', mentions: [] } })
    expect(prisma.pageComment.update).toHaveBeenCalled()
  })

  it('forbids editing someone else’s comment', async () => {
    const prisma = memberPrisma('COMMENTER', {
      pageComment: { findUnique: vi.fn(async () => ({ authorId: 'other', authorAnonId: null, thread: { pageId: PAGE_ID } })) },
    })
    await expect(
      caller(ctx(prisma, { id: 'u1' })).editComment({ pageId: PAGE_ID, commentId: COMMENT_ID, content: { text: 'x', mentions: [] } }),
    ).rejects.toThrow(/только свои/)
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

  it('resolves a thread', async () => {
    const prisma = memberPrisma('COMMENTER', {
      pageCommentThread: {
        findUnique: vi.fn(async () => ({ pageId: PAGE_ID })),
        update: vi.fn(async () => ({ id: THREAD_ID, resolvedAt: new Date() })),
      },
    })
    const res = await caller(ctx(prisma, { id: 'u1' })).resolveThread({ pageId: PAGE_ID, threadId: THREAD_ID })
    expect(res.resolvedAt).toBeTruthy()
  })
})
