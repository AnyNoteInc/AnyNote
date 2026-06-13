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
}))

const { canAccessPage, canAccessSyncedBlock, isReadOnlyAccess } = await import('./auth.js')

type Where = {
  workspace?: { members?: unknown; blockedUsers?: unknown }
  share?: unknown
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
