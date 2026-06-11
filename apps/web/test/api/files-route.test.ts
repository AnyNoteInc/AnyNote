import { Readable } from 'node:stream'

import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fileFindUnique: vi.fn<(args: unknown) => Promise<unknown>>(),
  fileUpdate: vi.fn<(args: unknown) => Promise<unknown>>(async () => ({})),
  memberFindUnique: vi.fn<(args: unknown) => Promise<unknown>>(async () => null),
  blockedFindUnique: vi.fn<(args: unknown) => Promise<unknown>>(async () => null),
  pageFileFindFirst: vi.fn<(args: unknown) => Promise<unknown>>(async () => null),
  storageGet: vi.fn<(path: string) => Promise<unknown>>(),
  getSession: vi.fn<() => Promise<unknown>>(),
}))

vi.mock('@repo/db', () => ({
  prisma: {
    file: { findUnique: mocks.fileFindUnique, update: mocks.fileUpdate },
    workspaceMember: { findUnique: mocks.memberFindUnique },
    workspaceBlockedUser: { findUnique: mocks.blockedFindUnique },
    pageFile: { findFirst: mocks.pageFileFindFirst },
  },
}))

vi.mock('@repo/storage', () => ({
  storage: { get: mocks.storageGet },
}))

vi.mock('@/lib/get-session', () => ({
  getSession: mocks.getSession,
}))

import { GET } from '../../src/app/api/files/[id]/route'

const FILE_ID = '11111111-1111-4111-8111-111111111111'
const WS_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'

function fileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: FILE_ID,
    status: 'ACTIVE',
    expiresAt: null,
    isPublic: false,
    userId: 'someone-else',
    workspaceId: WS_ID,
    path: 'files/x',
    mimeType: 'text/plain',
    fileSize: BigInt(3),
    name: 'doc',
    ext: 'txt',
    ...overrides,
  }
}

function callRoute() {
  const req = new Request(`http://localhost:3000/api/files/${FILE_ID}`) as unknown as NextRequest
  return GET(req, { params: Promise.resolve({ id: FILE_ID }) })
}

beforeEach(() => {
  mocks.fileFindUnique.mockReset()
  mocks.memberFindUnique.mockReset().mockResolvedValue(null)
  mocks.blockedFindUnique.mockReset().mockResolvedValue(null)
  mocks.pageFileFindFirst.mockReset().mockResolvedValue(null)
  mocks.storageGet.mockReset().mockResolvedValue(Readable.from(['abc']))
  mocks.getSession.mockReset().mockResolvedValue({ user: { id: USER_ID } })
})

describe('GET /api/files/[id] — membership arm block enforcement', () => {
  it('streams the file for an active (unblocked) workspace member', async () => {
    mocks.fileFindUnique.mockResolvedValue(fileRow())
    mocks.memberFindUnique.mockResolvedValue({ userId: USER_ID })
    const res = await callRoute()
    expect(res.status).toBe(200)
  })

  it('returns 403 for a workspace-blocked member', async () => {
    mocks.fileFindUnique.mockResolvedValue(fileRow())
    mocks.memberFindUnique.mockResolvedValue({ userId: USER_ID })
    mocks.blockedFindUnique.mockResolvedValue({ id: 'b1' })
    const res = await callRoute()
    expect(res.status).toBe(403)
  })

  it('the page-attachment arm excludes blocked users in the query itself', async () => {
    mocks.fileFindUnique.mockResolvedValue(fileRow({ workspaceId: null }))
    await callRoute()
    expect(mocks.pageFileFindFirst).toHaveBeenCalledTimes(1)
    const args = mocks.pageFileFindFirst.mock.calls[0]?.[0] as {
      where: { page: { workspace: Record<string, unknown> } }
    }
    expect(args.where.page.workspace).toMatchObject({
      members: { some: { userId: USER_ID } },
      blockedUsers: { none: { userId: USER_ID } },
    })
  })

  it('still returns 403 (not 200) when a blocked member is also the page-attachment viewer', async () => {
    mocks.fileFindUnique.mockResolvedValue(fileRow())
    mocks.memberFindUnique.mockResolvedValue({ userId: USER_ID })
    mocks.blockedFindUnique.mockResolvedValue({ id: 'b1' })
    // Simulates the DB answering "no row" because of blockedUsers:none in the where.
    mocks.pageFileFindFirst.mockResolvedValue(null)
    const res = await callRoute()
    expect(res.status).toBe(403)
  })
})
