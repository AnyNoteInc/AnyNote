import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  fileFindUnique: vi.fn(),
  memberFindUnique: vi.fn(),
  blockedFindUnique: vi.fn(),
  pageFileFindFirst: vi.fn(),
}))

vi.mock('@/lib/get-session', () => ({ getSession: mocks.getSession }))
vi.mock('@repo/db', () => ({
  prisma: {
    file: { findUnique: mocks.fileFindUnique },
    workspaceMember: { findUnique: mocks.memberFindUnique },
    workspaceBlockedUser: { findUnique: mocks.blockedFindUnique },
    pageFile: { findFirst: mocks.pageFileFindFirst },
  },
}))

import { authorizeFileRead } from '../src/lib/file-access'

const baseFile = {
  id: 'f1',
  userId: 'owner',
  workspaceId: 'w1',
  status: 'ACTIVE',
  isPublic: false,
  expiresAt: null,
}

describe('authorizeFileRead', () => {
  beforeEach(() => vi.clearAllMocks())

  it('404 когда файла нет или он не ACTIVE', async () => {
    mocks.fileFindUnique.mockResolvedValue(null)
    let res = await authorizeFileRead('f1')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.response.status).toBe(404)

    mocks.fileFindUnique.mockResolvedValue({ ...baseFile, status: 'DELETED' })
    res = await authorizeFileRead('f1')
    if (!res.ok) expect(res.response.status).toBe(404)
  })

  it('410 после expiresAt', async () => {
    mocks.fileFindUnique.mockResolvedValue({ ...baseFile, expiresAt: new Date(Date.now() - 1000) })
    const res = await authorizeFileRead('f1')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.response.status).toBe(410)
  })

  it('публичный файл отдаётся без сессии', async () => {
    mocks.fileFindUnique.mockResolvedValue({ ...baseFile, isPublic: true })
    mocks.getSession.mockResolvedValue(null)
    const res = await authorizeFileRead('f1')
    expect(res.ok).toBe(true)
  })

  it('401 приватный без сессии', async () => {
    mocks.fileFindUnique.mockResolvedValue(baseFile)
    mocks.getSession.mockResolvedValue(null)
    const res = await authorizeFileRead('f1')
    if (!res.ok) expect(res.response.status).toBe(401)
  })

  it('владелец проходит без проверок членства', async () => {
    mocks.fileFindUnique.mockResolvedValue(baseFile)
    mocks.getSession.mockResolvedValue({ user: { id: 'owner' } })
    const res = await authorizeFileRead('f1')
    expect(res.ok).toBe(true)
    expect(mocks.memberFindUnique).not.toHaveBeenCalled()
  })

  it('незаблокированный участник workspace проходит', async () => {
    mocks.fileFindUnique.mockResolvedValue(baseFile)
    mocks.getSession.mockResolvedValue({ user: { id: 'member' } })
    mocks.memberFindUnique.mockResolvedValue({ userId: 'member' })
    mocks.blockedFindUnique.mockResolvedValue(null)
    const res = await authorizeFileRead('f1')
    expect(res.ok).toBe(true)
  })

  it('заблокированный участник без PageFile-связи получает 403', async () => {
    mocks.fileFindUnique.mockResolvedValue(baseFile)
    mocks.getSession.mockResolvedValue({ user: { id: 'blocked' } })
    mocks.memberFindUnique.mockResolvedValue({ userId: 'blocked' })
    mocks.blockedFindUnique.mockResolvedValue({ id: 'b1' })
    mocks.pageFileFindFirst.mockResolvedValue(null)
    const res = await authorizeFileRead('f1')
    if (!res.ok) expect(res.response.status).toBe(403)
  })

  it('PageFile-связь с доступной страницей даёт доступ', async () => {
    mocks.fileFindUnique.mockResolvedValue({ ...baseFile, workspaceId: null })
    mocks.getSession.mockResolvedValue({ user: { id: 'reader' } })
    mocks.pageFileFindFirst.mockResolvedValue({ pageId: 'p1' })
    const res = await authorizeFileRead('f1')
    expect(res.ok).toBe(true)
  })
})
