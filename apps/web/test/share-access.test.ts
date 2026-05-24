import { describe, expect, it, vi } from 'vitest'

// share-access.ts imports `server-only`, which throws when imported outside an
// RSC bundle (e.g. vitest's node env). Neutralise it for the unit test.
vi.mock('server-only', () => ({}))

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

const shareRestricted = { id: 's-id', shareId: 's', access: 'RESTRICTED', linkRole: 'READER', page: PAGE }
const sharePublicEditor = { id: 's-id', shareId: 's', access: 'PUBLIC', linkRole: 'EDITOR', page: PAGE }

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

  it('uses a named grant when not a member, scoped to this share + user', async () => {
    const session = { user: { id: 'u1' } } as never
    const pageShareUser = { findFirst: vi.fn(async () => ({ role: 'COMMENTER' })) }
    const prisma = {
      pageShare: { findUnique: vi.fn(async () => shareRestricted) },
      workspaceMember: { findUnique: vi.fn(async () => null) },
      pageShareUser,
    } as never
    const res = await resolveShareAccess(prisma, 's', session)
    expect(res.role).toBe('COMMENTER')
    // Grant lookup must be scoped to this share + this user (no cross-page leak).
    expect(pageShareUser.findFirst).toHaveBeenCalledWith({
      where: { pageShareId: 's-id', userId: 'u1' },
      select: { role: true },
    })
  })

  it('lets a workspace member win over a named grant (grant not consulted)', async () => {
    const session = { user: { id: 'u1' } } as never
    const pageShareUser = { findFirst: vi.fn(async () => ({ role: 'EDITOR' })) }
    const prisma = {
      pageShare: { findUnique: vi.fn(async () => shareRestricted) },
      workspaceMember: { findUnique: vi.fn(async () => ({ role: 'VIEWER' })) },
      pageShareUser,
    } as never
    const res = await resolveShareAccess(prisma, 's', session)
    expect(res.role).toBe('READER') // VIEWER membership wins over the EDITOR grant
    expect(pageShareUser.findFirst).not.toHaveBeenCalled()
  })

  it('gives anonymous COMMENTER on a public commenter link', async () => {
    const sharePublicCommenter = {
      id: 's-id',
      shareId: 's',
      access: 'PUBLIC',
      linkRole: 'COMMENTER',
      page: PAGE,
    }
    const res = await resolveShareAccess(prismaWith({ share: sharePublicCommenter }), 's', null)
    expect(res.role).toBe('COMMENTER')
  })
})
