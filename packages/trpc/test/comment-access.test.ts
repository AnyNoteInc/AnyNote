import { describe, expect, it, vi } from 'vitest'

import { resolveCommentContext, canWriteComment } from '../src/helpers/comment-access'

const PAGE = { id: 'p1', workspaceId: 'w1', createdById: 'owner' }
const SHARE_PAGE = { id: 'p2', workspaceId: 'w1', createdById: 'owner' }
const PUBLIC_SHARE = { id: 's1', access: 'PUBLIC', linkRole: 'COMMENTER', pageId: 'p2', page: SHARE_PAGE }
const RESTRICTED_SHARE = { id: 's2', access: 'RESTRICTED', linkRole: 'COMMENTER', pageId: 'p2', page: SHARE_PAGE }

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
      workspaceBlockedUser: { findUnique: vi.fn(async () => null) },
      pageShareUser: { findFirst: vi.fn() },
      user: { findUnique: vi.fn(async () => ({ firstName: 'Ann', lastName: 'B', email: 'a@b.c' })) },
    }
    const res = await resolveCommentContext(ctx(prisma, { id: 'u1' }), { pageId: 'p1' })
    expect(res.role).toBe('COMMENTER')
    expect(res.workspaceId).toBe('w1')
    expect(res.author).toEqual({ userId: 'u1', name: 'Ann B' })
    expect(prisma.pageShareUser.findFirst).not.toHaveBeenCalled()
  })

  it('falls back to a named grant when not a member (ancestor-walk lookup)', async () => {
    const prisma = {
      // Serves the base fetch AND the grant walk; PAGE has no parentId so the
      // walk terminates at the page itself.
      page: { findUnique: vi.fn(async () => PAGE) },
      workspaceMember: { findUnique: vi.fn(async () => null) },
      workspaceBlockedUser: { findUnique: vi.fn(async () => null) },
      pageShare: { findUnique: vi.fn(async () => ({ id: 's1' })) },
      pageShareUser: {
        findMany: vi.fn(async () => [{ role: 'EDITOR', pageShare: { pageId: 'p1' } }]),
      },
      user: { findUnique: vi.fn(async () => ({ firstName: 'Ann', lastName: '', email: 'a@b.c' })) },
    }
    const res = await resolveCommentContext(ctx(prisma, { id: 'u1' }), { pageId: 'p1' })
    expect(res.role).toBe('EDITOR')
  })

  it('denies a signed-in non-member non-grant (no public link)', async () => {
    const prisma = {
      page: { findUnique: vi.fn(async () => PAGE) },
      workspaceMember: { findUnique: vi.fn(async () => null) },
      workspaceBlockedUser: { findUnique: vi.fn(async () => null) },
      pageShare: { findUnique: vi.fn(async () => null) },
      pageShareUser: { findMany: vi.fn(async () => []) },
      user: { findUnique: vi.fn(async () => ({ firstName: 'X', lastName: '', email: 'x@y.z' })) },
    }
    const res = await resolveCommentContext(ctx(prisma, { id: 'u1' }), { pageId: 'p1' })
    expect(res.role).toBeNull()
  })

  it('falls back to a public link role for a signed-in non-member non-grant', async () => {
    const prisma = {
      // The grant walk reads the page chain; null ends it grantless. The BASE
      // page still comes from the share's embedded page (res.pageId below).
      page: { findUnique: vi.fn(async () => null) },
      workspaceMember: { findUnique: vi.fn(async () => null) },
      workspaceBlockedUser: { findUnique: vi.fn(async () => null) },
      pageShare: { findUnique: vi.fn(async () => PUBLIC_SHARE) },
      pageShareUser: { findMany: vi.fn(async () => []) },
      user: { findUnique: vi.fn(async () => ({ firstName: 'X', lastName: '', email: 'x@y.z' })) },
    }
    const res = await resolveCommentContext(ctx(prisma, { id: 'u1' }), { shareId: 'public-share' })
    expect(res.pageId).toBe('p2')
    expect(res.role).toBe('COMMENTER')
  })
})

describe('resolveCommentContext (anonymous public links)', () => {
  it('resolves an anonymous public commenter link', async () => {
    const prisma = {
      pageShare: { findUnique: vi.fn(async () => PUBLIC_SHARE) },
    }
    const res = await resolveCommentContext(ctx(prisma, null), { shareId: 'public-share', anonId: 'anon-123' })
    expect(res.pageId).toBe('p2')
    expect(res.workspaceId).toBe('w1')
    expect(res.role).toBe('COMMENTER')
    expect(res.author.anonId).toBe('anon-123')
    expect(res.author.name).toMatch(/^Гость · /)
    expect(res.author.name).not.toContain('anon-123')
  })

  it('allows anonymous public viewing without creating shared anonymous ownership', async () => {
    const prisma = {
      pageShare: { findUnique: vi.fn(async () => PUBLIC_SHARE) },
    }
    const res = await resolveCommentContext(ctx(prisma, null), { shareId: 'public-share' })
    expect(res.role).toBe('COMMENTER')
    expect(res.author.anonId).toBeUndefined()
    expect(res.author.name).toMatch(/^Гость/)
  })

  it('denies an anonymous restricted link', async () => {
    const prisma = {
      pageShare: { findUnique: vi.fn(async () => RESTRICTED_SHARE) },
    }
    const res = await resolveCommentContext(ctx(prisma, null), { shareId: 'restricted-share', anonId: 'anon-123' })
    expect(res.role).toBeNull()
    expect(res.author.anonId).toBe('anon-123')
    expect(res.author.name).toMatch(/^Гость · /)
    expect(res.author.name).not.toContain('anon-123')
  })
})
