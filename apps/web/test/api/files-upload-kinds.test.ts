import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { validateUpload } from '../../src/lib/file-validation'

const mocks = vi.hoisted(() => ({
  fileFindFirst: vi.fn<(args: unknown) => Promise<unknown>>(async () => null),
  fileAggregate: vi.fn<(args: unknown) => Promise<unknown>>(async () => ({
    _sum: { fileSize: 0n },
  })),
  limitFindUnique: vi.fn<(args: unknown) => Promise<unknown>>(async () => null),
  userUpdate: vi.fn<(args: unknown) => Promise<unknown>>(async () => ({})),
  txFileCreate: vi.fn<(args: unknown) => Promise<unknown>>(),
  txUserUpdate: vi.fn<(args: unknown) => Promise<unknown>>(async () => ({})),
  storagePut: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => undefined),
  getSession: vi.fn<() => Promise<unknown>>(),
  getActiveWorkspaceForUser: vi.fn<() => Promise<unknown>>(async () => null),
}))

vi.mock('@repo/db', () => ({
  FileStatus: { ACTIVE: 'ACTIVE' },
  Prisma: { PrismaClientKnownRequestError: class extends Error {} },
  prisma: {
    file: { findFirst: mocks.fileFindFirst, aggregate: mocks.fileAggregate },
    workspaceLimit: { findUnique: mocks.limitFindUnique },
    user: { update: mocks.userUpdate },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ file: { create: mocks.txFileCreate }, user: { update: mocks.txUserUpdate } }),
  },
}))

vi.mock('@repo/storage', () => ({
  storage: { put: mocks.storagePut },
}))

vi.mock('@/lib/get-session', () => ({
  getSession: mocks.getSession,
}))

vi.mock('@/lib/active-workspace', () => ({
  getActiveWorkspaceForUser: mocks.getActiveWorkspaceForUser,
}))

import { POST } from '../../src/app/api/files/upload/route'

const USER_ID = '33333333-3333-4333-8333-333333333333'
const MB = 1024 * 1024

const createdRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'f-new-1',
  name: 'pic.png',
  ext: 'png',
  mimeType: 'image/png',
  fileSize: BigInt(10),
  isPublic: true,
  createdAt: new Date('2026-06-17T00:00:00Z'),
  ...overrides,
})

function makeUploadRequest(kind: string, file: File): NextRequest {
  const url = `http://localhost:3000/api/files/upload?kind=${kind}`
  const fd = new FormData()
  fd.set('file', file)
  const req = new Request(url, { method: 'POST', body: fd })
  Object.defineProperty(req, 'nextUrl', { value: new URL(url) })
  return req as unknown as NextRequest
}

const pngFile = (bytes = 10, name = 'pic.png') =>
  new File([new Uint8Array(bytes)], name, { type: 'image/png' })

beforeEach(() => {
  mocks.fileFindFirst.mockReset().mockResolvedValue(null)
  mocks.fileAggregate.mockReset().mockResolvedValue({ _sum: { fileSize: 0n } })
  mocks.limitFindUnique.mockReset().mockResolvedValue(null)
  mocks.userUpdate.mockReset().mockResolvedValue({})
  mocks.txFileCreate.mockReset().mockResolvedValue(createdRow())
  mocks.txUserUpdate.mockReset().mockResolvedValue({})
  mocks.storagePut.mockReset().mockResolvedValue(undefined)
  mocks.getSession.mockReset().mockResolvedValue({ user: { id: USER_ID } })
  mocks.getActiveWorkspaceForUser.mockReset().mockResolvedValue(null)
})

// ── validateUpload: the new kinds ────────────────────────────────────────────

describe('validateUpload — icon kind (1MB, image MIME)', () => {
  it('accepts a 1MB png', () => {
    expect(validateUpload('icon', 1 * MB, 'image/png')).toBeNull()
  })

  it('rejects anything over 1MB', () => {
    expect(validateUpload('icon', 1 * MB + 1, 'image/png')).toMatchObject({ status: 400 })
  })

  it.each(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])('accepts %s', (mime) => {
    expect(validateUpload('icon', 100, mime)).toBeNull()
  })

  it('rejects non-image MIME (pdf)', () => {
    expect(validateUpload('icon', 100, 'application/pdf')).toMatchObject({ status: 400 })
  })

  it('rejects svg (not in the image whitelist)', () => {
    expect(validateUpload('icon', 100, 'image/svg+xml')).toMatchObject({ status: 400 })
  })
})

describe('validateUpload — cover kind (10MB, image MIME)', () => {
  it('accepts a 10MB jpeg', () => {
    expect(validateUpload('cover', 10 * MB, 'image/jpeg')).toBeNull()
  })

  it('rejects anything over 10MB', () => {
    expect(validateUpload('cover', 10 * MB + 1, 'image/jpeg')).toMatchObject({ status: 400 })
  })

  it('rejects non-image MIME (zip)', () => {
    expect(validateUpload('cover', 100, 'application/zip')).toMatchObject({ status: 400 })
  })
})

// ── POST /api/files/upload?kind=icon|cover ───────────────────────────────────

describe('POST /api/files/upload — icon/cover kinds (public-by-id, no quota)', () => {
  it.each(['icon', 'cover'] as const)(
    'kind=%s creates a PUBLIC file with workspaceId null and returns imageUrl',
    async (kind) => {
      const res = await POST(makeUploadRequest(kind, pngFile()))
      expect(res.status).toBe(200)
      const body = (await res.json()) as { file: { id: string }; imageUrl?: string }
      expect(body.imageUrl).toBe('/api/files/f-new-1')
      expect(mocks.txFileCreate).toHaveBeenCalledTimes(1)
      const createArgs = mocks.txFileCreate.mock.calls[0]?.[0] as {
        data: Record<string, unknown>
      }
      expect(createArgs.data).toMatchObject({ isPublic: true, workspaceId: null })
    },
  )

  it.each(['icon', 'cover'] as const)(
    'kind=%s is quota-exempt (no workspace limit lookup) and never touches User.image',
    async (kind) => {
      const res = await POST(makeUploadRequest(kind, pngFile()))
      expect(res.status).toBe(200)
      expect(mocks.limitFindUnique).not.toHaveBeenCalled()
      expect(mocks.fileAggregate).not.toHaveBeenCalled()
      expect(mocks.txUserUpdate).not.toHaveBeenCalled()
      expect(mocks.userUpdate).not.toHaveBeenCalled()
    },
  )

  it('kind=icon rejects a file over 1MB with 400', async () => {
    const res = await POST(makeUploadRequest('icon', pngFile(MB + 1)))
    expect(res.status).toBe(400)
    expect(mocks.txFileCreate).not.toHaveBeenCalled()
  })

  it('kind=cover rejects a non-image MIME with 400', async () => {
    const file = new File([new Uint8Array(10)], 'doc.pdf', { type: 'application/pdf' })
    const res = await POST(makeUploadRequest('cover', file))
    expect(res.status).toBe(400)
    expect(mocks.txFileCreate).not.toHaveBeenCalled()
  })

  it('still rejects an unknown kind with 400', async () => {
    const res = await POST(makeUploadRequest('banner', pngFile()))
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('Invalid kind')
  })

  it('dedup hit (existing row) for icon does NOT update User.image and still answers with imageUrl', async () => {
    mocks.fileFindFirst.mockResolvedValue(createdRow({ id: 'f-existing-1' }))
    const res = await POST(makeUploadRequest('icon', pngFile()))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { imageUrl?: string }
    expect(body.imageUrl).toBe('/api/files/f-existing-1')
    expect(mocks.txFileCreate).not.toHaveBeenCalled()
    expect(mocks.userUpdate).not.toHaveBeenCalled()
  })

  it('avatar keeps its User.image side-effect (regression pin)', async () => {
    const res = await POST(makeUploadRequest('avatar', pngFile()))
    expect(res.status).toBe(200)
    expect(mocks.txUserUpdate).toHaveBeenCalledTimes(1)
  })
})
