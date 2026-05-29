import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { PrismaClient } from '@repo/db'

import { DomainError } from '../../src/errors.ts'
import { assertPageAccess, assertPageOwnership } from '../../src/kanban/access.ts'

describe('kanban access', () => {
  const pageFindFirst = vi.fn()
  const memberFindUnique = vi.fn()
  const prisma = {
    page: { findFirst: pageFindFirst },
    workspaceMember: { findUnique: memberFindUnique },
  } as unknown as PrismaClient

  beforeEach(() => vi.clearAllMocks())

  it('assertPageAccess returns the page for a workspace member', async () => {
    pageFindFirst.mockResolvedValue({ id: 'p1', workspaceId: 'w1', createdById: 'u9' })
    await expect(assertPageAccess(prisma, 'u1', 'p1')).resolves.toMatchObject({ id: 'p1' })
  })

  it('assertPageAccess throws NOT_FOUND for non-members', async () => {
    pageFindFirst.mockResolvedValue(null)
    await expect(assertPageAccess(prisma, 'u1', 'p1')).rejects.toBeInstanceOf(DomainError)
  })

  it('assertPageOwnership allows the creator', async () => {
    pageFindFirst.mockResolvedValue({ id: 'p1', workspaceId: 'w1', createdById: 'u1' })
    await expect(assertPageOwnership(prisma, 'u1', 'p1')).resolves.toMatchObject({ id: 'p1' })
    expect(memberFindUnique).not.toHaveBeenCalled()
  })

  it('assertPageOwnership allows a workspace OWNER who is not the creator', async () => {
    pageFindFirst.mockResolvedValue({ id: 'p1', workspaceId: 'w1', createdById: 'u9' })
    memberFindUnique.mockResolvedValue({ role: 'OWNER' })
    await expect(assertPageOwnership(prisma, 'u1', 'p1')).resolves.toMatchObject({ id: 'p1' })
  })

  it('assertPageOwnership rejects a non-owner non-creator', async () => {
    pageFindFirst.mockResolvedValue({ id: 'p1', workspaceId: 'w1', createdById: 'u9' })
    memberFindUnique.mockResolvedValue({ role: 'EDITOR' })
    await expect(assertPageOwnership(prisma, 'u1', 'p1')).rejects.toBeInstanceOf(DomainError)
  })
})
