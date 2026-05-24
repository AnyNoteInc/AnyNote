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
