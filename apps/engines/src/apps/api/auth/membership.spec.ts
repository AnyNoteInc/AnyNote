import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { ForbiddenException } from '@nestjs/common'

import type { PrismaClient } from '@repo/db'

import { assertMember } from './membership.js'

describe('assertMember', () => {
  const prisma = {
    workspaceMember: { findUnique: jest.fn<(...a: unknown[]) => Promise<unknown>>() },
  } as unknown as PrismaClient

  beforeEach(() => {
    ;(prisma.workspaceMember.findUnique as jest.Mock).mockReset()
  })

  it('resolves when membership exists', async () => {
    ;(prisma.workspaceMember.findUnique as jest.Mock).mockResolvedValue({ workspaceId: 'w' } as never)
    await expect(assertMember(prisma, 'u', 'w')).resolves.toBeUndefined()
  })

  it('throws ForbiddenException when membership missing', async () => {
    ;(prisma.workspaceMember.findUnique as jest.Mock).mockResolvedValue(null as never)
    await expect(assertMember(prisma, 'u', 'w')).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('queries by composite key (workspaceId, userId)', async () => {
    ;(prisma.workspaceMember.findUnique as jest.Mock).mockResolvedValue({ workspaceId: 'w' } as never)
    await assertMember(prisma, 'u', 'w')
    expect(prisma.workspaceMember.findUnique as jest.Mock).toHaveBeenCalledWith({
      where: { workspaceId_userId: { workspaceId: 'w', userId: 'u' } },
      select: { workspaceId: true },
    })
  })
})
