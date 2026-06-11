import { beforeEach, describe, expect, it, jest } from '@jest/globals'

// Mock @repo/db BEFORE importing auth
const mockPageFindFirst = jest.fn<(args: unknown) => Promise<unknown>>()

jest.unstable_mockModule('@repo/db', () => ({
  prisma: { page: { findFirst: mockPageFindFirst } },
  PageType: {
    TEXT: 'TEXT',
    EXCALIDRAW: 'EXCALIDRAW',
    GENOGRAM: 'GENOGRAM',
    MERMAID: 'MERMAID',
    PLANTUML: 'PLANTUML',
  },
}))

const { canAccessPage, isReadOnlyAccess } = await import('./auth.js')

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
