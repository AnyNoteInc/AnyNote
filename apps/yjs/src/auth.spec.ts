import { beforeEach, describe, expect, it, jest } from '@jest/globals'

// Mock @repo/db BEFORE importing auth
const mockPageFindFirst = jest.fn<(args: unknown) => Promise<unknown>>()
const mockSyncedBlockFindFirst = jest.fn<(args: unknown) => Promise<unknown>>()

jest.unstable_mockModule('@repo/db', () => ({
  prisma: {
    page: { findFirst: mockPageFindFirst },
    syncedBlock: { findFirst: mockSyncedBlockFindFirst },
  },
  PageType: {
    TEXT: 'TEXT',
    EXCALIDRAW: 'EXCALIDRAW',
    GENOGRAM: 'GENOGRAM',
    MERMAID: 'MERMAID',
    PLANTUML: 'PLANTUML',
  },
  // `buildPageVisibilityWhere` (deep-imported from @repo/domain by auth.ts) reads
  // CollectionKind to build the member-arm visibility predicate — surface it here.
  CollectionKind: {
    TEAM: 'TEAM',
    PERSONAL: 'PERSONAL',
    SITE: 'SITE',
  },
}))

const { canAccessPage, canAccessSyncedBlock, isReadOnlyAccess } = await import('./auth.js')

type VisibilityFragment = {
  OR?: Array<Record<string, unknown>>
}

type Where = {
  workspace?: { members?: unknown; blockedUsers?: unknown }
  share?: unknown
  AND?: VisibilityFragment[]
}

function whereOf(call: [unknown] | undefined): Where {
  if (!call) throw new Error('expected a recorded findFirst call')
  return (call[0] as { where: Where }).where
}

beforeEach(() => {
  mockPageFindFirst.mockReset()
  mockSyncedBlockFindFirst.mockReset()
})

describe('canAccessPage', () => {
  it('admits an active member with writable access (no grant role)', async () => {
    mockPageFindFirst.mockResolvedValueOnce({ type: 'TEXT', workspaceId: 'w1' })
    const access = await canAccessPage('u1', 'p1')
    expect(access).toEqual({
      pageType: 'TEXT',
      workspaceId: 'w1',
      access: 'member',
      role: null,
    })
    expect(access ? isReadOnlyAccess(access) : null).toBe(false)
  })

  it('the member arm excludes workspace-blocked users (blockedUsers none)', async () => {
    mockPageFindFirst.mockResolvedValue(null)
    await canAccessPage('u1', 'p1')
    const memberWhere = whereOf(mockPageFindFirst.mock.calls[0])
    expect(memberWhere.workspace).toMatchObject({
      members: { some: { userId: 'u1' } },
      blockedUsers: { none: { userId: 'u1' } },
    })
  })

  it('denies when the user is neither an active member nor a grant holder', async () => {
    mockPageFindFirst.mockResolvedValue(null)
    await expect(canAccessPage('u1', 'p1')).resolves.toBeNull()
    expect(mockPageFindFirst).toHaveBeenCalledTimes(2)
  })

  it('admits a guest with an EDITOR grant as writable', async () => {
    mockPageFindFirst
      .mockResolvedValueOnce(null) // member arm
      .mockResolvedValueOnce({
        type: 'TEXT',
        workspaceId: 'w1',
        share: { users: [{ role: 'EDITOR' }] },
      })
    const access = await canAccessPage('u1', 'p1')
    expect(access).toEqual({
      pageType: 'TEXT',
      workspaceId: 'w1',
      access: 'guest',
      role: 'EDITOR',
    })
    expect(access ? isReadOnlyAccess(access) : null).toBe(false)
  })

  it('admits READER/COMMENTER grants read-only', async () => {
    for (const role of ['READER', 'COMMENTER'] as const) {
      mockPageFindFirst.mockReset()
      mockPageFindFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          type: 'TEXT',
          workspaceId: 'w1',
          share: { users: [{ role }] },
        })
      const access = await canAccessPage('u1', 'p1')
      expect(access?.access).toBe('guest')
      expect(access?.role).toBe(role)
      expect(access ? isReadOnlyAccess(access) : null).toBe(true)
    }
  })

  it('the guest arm requires a grant and excludes blocked users', async () => {
    mockPageFindFirst.mockResolvedValue(null)
    await canAccessPage('u1', 'p1')
    const guestWhere = whereOf(mockPageFindFirst.mock.calls[1])
    expect(guestWhere.share).toMatchObject({ users: { some: { userId: 'u1' } } })
    expect(guestWhere.workspace).toMatchObject({
      blockedUsers: { none: { userId: 'u1' } },
    })
  })

  // The COLLECTION-PRIVACY gate (the leak fix): the member arm must carry the
  // page-visibility predicate (mirrors @repo/domain buildPageVisibilityWhere),
  // so a workspace member who cannot SEE a foreign PERSONAL page is denied here
  // too. Asserting the WHERE — not just the resolved value — is the only thing
  // that fails if someone later removes the filter (a null-mock value test can't
  // catch that). The predicate is the OR fragment under AND: TEAM OR null
  // collection OR PERSONAL-owned-by-this-user OR an explicit share grant.
  it('the member arm carries the page-visibility predicate (collection privacy)', async () => {
    mockPageFindFirst.mockResolvedValue(null)
    await canAccessPage('u1', 'p1')
    const memberWhere = whereOf(mockPageFindFirst.mock.calls[0])
    // The member arm must AND in the visibility predicate.
    const fragment = memberWhere.AND?.[0]
    expect(fragment).toBeDefined()
    expect(fragment?.OR).toEqual(
      expect.arrayContaining([
        { collection: { kind: 'TEAM' } },
        { collectionId: null },
        { collection: { kind: 'PERSONAL', ownerId: 'u1' } },
        { share: { users: { some: { userId: 'u1' } } } },
      ]),
    )
  })
})

describe('canAccessSyncedBlock', () => {
  it('resolves the block by id with deletedAt null and selects originPageId', async () => {
    mockSyncedBlockFindFirst.mockResolvedValue({ originPageId: 'origin1' })
    mockPageFindFirst.mockResolvedValueOnce({ type: 'TEXT', workspaceId: 'w1' })
    await canAccessSyncedBlock('u1', 'b1')
    const args = mockSyncedBlockFindFirst.mock.calls[0]![0] as {
      where: { id: string; deletedAt: null }
      select: { originPageId: boolean }
    }
    expect(args.where).toMatchObject({ id: 'b1', deletedAt: null })
    expect(args.select).toMatchObject({ originPageId: true })
  })

  it('admits a member of the origin page (same shape canAccessPage returns)', async () => {
    mockSyncedBlockFindFirst.mockResolvedValue({ originPageId: 'origin1' })
    mockPageFindFirst.mockResolvedValueOnce({ type: 'TEXT', workspaceId: 'w1' })
    const access = await canAccessSyncedBlock('u1', 'b1')
    expect(access).toEqual({
      pageType: 'TEXT',
      workspaceId: 'w1',
      access: 'member',
      role: null,
    })
    // It runs the page member/guest check against the ORIGIN page id.
    expect(whereOf(mockPageFindFirst.mock.calls[0])).toMatchObject({ id: 'origin1' } as never)
    expect(access ? isReadOnlyAccess(access) : null).toBe(false)
  })

  it('denies when the caller has no access to the origin page', async () => {
    mockSyncedBlockFindFirst.mockResolvedValue({ originPageId: 'origin1' })
    mockPageFindFirst.mockResolvedValue(null) // both member + guest arms miss
    await expect(canAccessSyncedBlock('u1', 'b1')).resolves.toBeNull()
    expect(mockPageFindFirst).toHaveBeenCalledTimes(2)
  })

  // The LIVE-CONNECTION leak fix (spec §8.1/§8.2): a workspace member opening the
  // live `syncedBlock:<id>` doc whose ORIGIN is a foreign PERSONAL page must be
  // DENIED. The DB returns null because the origin-page query now ANDs in the
  // visibility predicate, so the foreign personal page never matches the member
  // arm. We assert BOTH the null result AND that the member-arm WHERE against the
  // origin page carries that predicate — so the test fails if the gate is removed.
  it('denies a member whose synced-block origin is a foreign PERSONAL page (and gates the WHERE)', async () => {
    mockSyncedBlockFindFirst.mockResolvedValue({ originPageId: 'foreignPersonal' })
    // The foreign PERSONAL page is filtered out by the visibility predicate in
    // BOTH the member and guest arms → both return null.
    mockPageFindFirst.mockResolvedValue(null)

    const access = await canAccessSyncedBlock('u1', 'b1')
    expect(access).toBeNull()

    const memberWhere = whereOf(mockPageFindFirst.mock.calls[0])
    // The member arm queried the ORIGIN page id, with membership + the
    // collection-visibility predicate ANDed in.
    expect(memberWhere).toMatchObject({ id: 'foreignPersonal' } as never)
    // The origin-page member arm must AND in the visibility predicate.
    const fragment = memberWhere.AND?.[0]
    expect(fragment).toBeDefined()
    expect(fragment?.OR).toEqual(
      expect.arrayContaining([
        { collection: { kind: 'PERSONAL', ownerId: 'u1' } },
        { collection: { kind: 'TEAM' } },
      ]),
    )
  })

  // Counterpart: the caller's OWN personal origin page DOES match the predicate,
  // so the DB returns the page and access is granted (member, writable).
  it('admits a member whose synced-block origin is THEIR OWN personal page', async () => {
    mockSyncedBlockFindFirst.mockResolvedValue({ originPageId: 'myPersonal' })
    mockPageFindFirst.mockResolvedValueOnce({ type: 'TEXT', workspaceId: 'w1' })
    const access = await canAccessSyncedBlock('u1', 'b1')
    expect(access).toEqual({
      pageType: 'TEXT',
      workspaceId: 'w1',
      access: 'member',
      role: null,
    })
  })

  it('denies an orphaned block (originPageId null) WITHOUT touching the page table', async () => {
    mockSyncedBlockFindFirst.mockResolvedValue({ originPageId: null })
    await expect(canAccessSyncedBlock('u1', 'b1')).resolves.toBeNull()
    expect(mockPageFindFirst).not.toHaveBeenCalled()
  })

  it('denies a deleted/missing block (the deletedAt-null filter returns nothing)', async () => {
    mockSyncedBlockFindFirst.mockResolvedValue(null)
    await expect(canAccessSyncedBlock('u1', 'b1')).resolves.toBeNull()
    expect(mockPageFindFirst).not.toHaveBeenCalled()
  })

  it('admits via an EDITOR grant on the origin page (writable)', async () => {
    mockSyncedBlockFindFirst.mockResolvedValue({ originPageId: 'origin1' })
    mockPageFindFirst
      .mockResolvedValueOnce(null) // member arm misses
      .mockResolvedValueOnce({
        type: 'TEXT',
        workspaceId: 'w1',
        share: { users: [{ role: 'EDITOR' }] },
      })
    const access = await canAccessSyncedBlock('u1', 'b1')
    expect(access).toEqual({
      pageType: 'TEXT',
      workspaceId: 'w1',
      access: 'guest',
      role: 'EDITOR',
    })
    expect(access ? isReadOnlyAccess(access) : null).toBe(false)
  })

  it('denies a workspace-blocked user (both origin-page arms exclude blocked users)', async () => {
    mockSyncedBlockFindFirst.mockResolvedValue({ originPageId: 'origin1' })
    mockPageFindFirst.mockResolvedValue(null)
    await expect(canAccessSyncedBlock('u1', 'b1')).resolves.toBeNull()
    // Both arms carry the blockedUsers: none filter against the origin page.
    expect(whereOf(mockPageFindFirst.mock.calls[0]).workspace).toMatchObject({
      blockedUsers: { none: { userId: 'u1' } },
    })
    expect(whereOf(mockPageFindFirst.mock.calls[1]).workspace).toMatchObject({
      blockedUsers: { none: { userId: 'u1' } },
    })
  })

  it('maps a VIEWER (READER) grant on the origin page to read-only', async () => {
    mockSyncedBlockFindFirst.mockResolvedValue({ originPageId: 'origin1' })
    mockPageFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        type: 'TEXT',
        workspaceId: 'w1',
        share: { users: [{ role: 'READER' }] },
      })
    const access = await canAccessSyncedBlock('u1', 'b1')
    expect(access?.access).toBe('guest')
    expect(access?.role).toBe('READER')
    expect(access ? isReadOnlyAccess(access) : null).toBe(true)
  })
})
