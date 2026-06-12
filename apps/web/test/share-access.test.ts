import { describe, expect, it, vi } from 'vitest'

// `server-only` is aliased to an empty stub for Vitest in apps/web/vitest.config.ts,
// so share-access.ts can be imported here without a per-file mock.
import { resolveShareAccess, mapMemberRole } from '@/lib/share-access'

// Full page row used both by the web resolver's own fast-path query and by the
// domain ShareAccessRepository (a superset that satisfies both `select`s — the
// mock ignores the select and returns the whole object).
const PAGE = {
  id: 'p1',
  type: 'TEXT',
  title: 'Doc',
  icon: null,
  contentYjs: null,
  workspaceId: 'w1',
  createdById: 'owner',
  parentId: null,
  collectionId: null,
  archivedAt: null,
  deletedAt: null,
}

// A share row carrying every field the domain repository selects, plus the
// `id` + `page` the web resolver reads. `mode: 'LINK'` so public availability
// is governed purely by `access`.
function shareRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 's-id',
    shareId: 's',
    access: 'RESTRICTED',
    linkRole: 'READER',
    mode: 'LINK',
    expiresAt: null,
    publishedAt: null,
    unpublishedAt: null,
    allowIndexing: false,
    allowCopy: false,
    publishSubpages: true,
    analyticsGoogleId: null,
    analyticsYandexMetricaId: null,
    passwordHash: null,
    exposesAt: null,
    page: PAGE,
    ...overrides,
  }
}

function prismaWith(opts: {
  share: unknown
  member?: { role: string } | null
  grant?: { role: string } | null
  page?: unknown
  blocked?: { id: string } | null
}) {
  return {
    pageShare: { findUnique: vi.fn(async () => opts.share) },
    workspaceMember: { findUnique: vi.fn(async () => opts.member ?? null) },
    workspaceBlockedUser: { findUnique: vi.fn(async () => opts.blocked ?? null) },
    pageShareUser: { findFirst: vi.fn(async () => opts.grant ?? null) },
    page: {
      findUnique: vi.fn(async () => opts.page ?? PAGE),
      findFirst: vi.fn(async () => opts.page ?? PAGE),
    },
  } as never
}

const shareRestricted = shareRow()
const sharePublicEditor = shareRow({ access: 'PUBLIC', linkRole: 'EDITOR' })

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
    expect(res.kind).toBe('not_found')
  })

  it('denies anonymous on a restricted page (unavailable/disabled)', async () => {
    const res = await resolveShareAccess(prismaWith({ share: shareRestricted }), 's', null)
    expect(res.kind).toBe('unavailable')
    if (res.kind === 'unavailable') expect(res.reason).toBe('disabled')
  })

  it('gives anonymous the public role on a public link page', async () => {
    const res = await resolveShareAccess(prismaWith({ share: sharePublicEditor }), 's', null)
    expect(res.kind).toBe('public')
    if (res.kind === 'public') {
      expect(res.role).toBe('EDITOR')
      expect(res.page.id).toBe('p1')
    }
  })

  it('denies anonymous with policy_disabled when the workspace security policy kills public links', async () => {
    // The domain repository joins page→workspace→securityPolicy in its share
    // lookup; the mock returns the whole object for both queries.
    const share = shareRow({
      access: 'PUBLIC',
      page: { ...PAGE, workspace: { securityPolicy: { disablePublicLinksSitesForms: true } } },
    })
    const res = await resolveShareAccess(prismaWith({ share }), 's', null)
    expect(res.kind).toBe('unavailable')
    if (res.kind === 'unavailable') expect(res.reason).toBe('policy_disabled')
  })

  it('keeps the member fast-path under the public-sharing policy (members retain access)', async () => {
    const share = shareRow({
      access: 'PUBLIC',
      page: { ...PAGE, workspace: { securityPolicy: { disablePublicLinksSitesForms: true } } },
    })
    const session = { user: { id: 'u1' } } as never
    const res = await resolveShareAccess(
      prismaWith({ share, member: { role: 'EDITOR' } }),
      's',
      session,
    )
    expect(res.kind).toBe('member')
  })

  it('prefers workspace membership over link role', async () => {
    const session = { user: { id: 'u1' } } as never
    const res = await resolveShareAccess(
      prismaWith({ share: sharePublicEditor, member: { role: 'VIEWER' } }),
      's',
      session,
    )
    expect(res.kind).toBe('member')
    if (res.kind === 'member') expect(res.role).toBe('READER') // VIEWER beats public EDITOR link
  })

  it('uses a named grant when not a member, scoped to this share + user', async () => {
    const session = { user: { id: 'u1' } } as never
    const pageShareUser = { findFirst: vi.fn(async () => ({ role: 'COMMENTER' })) }
    const prisma = {
      pageShare: { findUnique: vi.fn(async () => shareRestricted) },
      workspaceMember: { findUnique: vi.fn(async () => null) },
      workspaceBlockedUser: { findUnique: vi.fn(async () => null) },
      pageShareUser,
      page: { findUnique: vi.fn(async () => PAGE), findFirst: vi.fn(async () => PAGE) },
    } as never
    const res = await resolveShareAccess(prisma, 's', session)
    expect(res.kind).toBe('grant')
    if (res.kind === 'grant') expect(res.role).toBe('COMMENTER')
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
      workspaceBlockedUser: { findUnique: vi.fn(async () => null) },
      pageShareUser,
      page: { findUnique: vi.fn(async () => PAGE), findFirst: vi.fn(async () => PAGE) },
    } as never
    const res = await resolveShareAccess(prisma, 's', session)
    expect(res.kind).toBe('member')
    if (res.kind === 'member') expect(res.role).toBe('READER') // VIEWER membership wins over the EDITOR grant
    expect(pageShareUser.findFirst).not.toHaveBeenCalled()
  })

  it('drops the member fast-path for a workspace-blocked user (falls through to public deny)', async () => {
    const session = { user: { id: 'u1' } } as never
    const prisma = prismaWith({
      share: shareRestricted,
      member: { role: 'EDITOR' },
      blocked: { id: 'b1' },
    })
    const res = await resolveShareAccess(prisma, 's', session)
    expect(res.kind).toBe('unavailable')
    if (res.kind === 'unavailable') expect(res.reason).toBe('disabled')
  })

  it('drops the named-grant fast-path for a workspace-blocked user', async () => {
    const session = { user: { id: 'u1' } } as never
    const pageShareUser = { findFirst: vi.fn(async () => ({ role: 'EDITOR' })) }
    const prisma = {
      pageShare: { findUnique: vi.fn(async () => shareRestricted) },
      workspaceMember: { findUnique: vi.fn(async () => null) },
      workspaceBlockedUser: { findUnique: vi.fn(async () => ({ id: 'b1' })) },
      pageShareUser,
      page: { findUnique: vi.fn(async () => PAGE), findFirst: vi.fn(async () => PAGE) },
    } as never
    const res = await resolveShareAccess(prisma, 's', session)
    expect(res.kind).toBe('unavailable')
    // Neither fast-path may even consult the grant for blocked users.
    expect(pageShareUser.findFirst).not.toHaveBeenCalled()
  })

  it('keeps anonymous-level public access for a blocked user on a genuinely public link', async () => {
    const session = { user: { id: 'u1' } } as never
    const res = await resolveShareAccess(
      prismaWith({ share: sharePublicEditor, member: { role: 'OWNER' }, blocked: { id: 'b1' } }),
      's',
      session,
    )
    expect(res.kind).toBe('public')
    if (res.kind === 'public') expect(res.role).toBe('EDITOR') // the link role, not the member role
  })

  it('gives anonymous COMMENTER on a public commenter link', async () => {
    const sharePublicCommenter = shareRow({ access: 'PUBLIC', linkRole: 'COMMENTER' })
    const res = await resolveShareAccess(prismaWith({ share: sharePublicCommenter }), 's', null)
    expect(res.kind).toBe('public')
    if (res.kind === 'public') expect(res.role).toBe('COMMENTER')
  })

  it('reports unavailable/expired for an expired public link', async () => {
    const expired = shareRow({
      access: 'PUBLIC',
      linkRole: 'READER',
      expiresAt: new Date(Date.now() - 1000),
    })
    const res = await resolveShareAccess(prismaWith({ share: expired }), 's', null)
    expect(res.kind).toBe('unavailable')
    if (res.kind === 'unavailable') expect(res.reason).toBe('expired')
  })

  it('reports unavailable/password_required for a SITE with a password', async () => {
    const sited = shareRow({
      mode: 'SITE',
      publishedAt: new Date(Date.now() - 1000),
      passwordHash: 'salt:deadbeef',
    })
    const res = await resolveShareAccess(prismaWith({ share: sited }), 's', null)
    expect(res.kind).toBe('unavailable')
    if (res.kind === 'unavailable') expect(res.reason).toBe('password_required')
  })
})
