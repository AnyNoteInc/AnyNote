import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { ForbiddenException } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'

import type { AuthedRequest } from '../../api/auth/auth-context.js'
import type { PageWriter } from '../services/page-writer.service.js'
import type { StatsService } from '../services/stats.service.js'
import { WorkspaceTools } from './workspace.tools.js'

describe('WorkspaceTools.listWorkspaceMembers', () => {
  const memberFindUnique = jest.fn<(...args: unknown[]) => Promise<unknown>>()
  const memberFindMany = jest.fn<(...args: unknown[]) => Promise<unknown>>()
  const prisma = {
    workspaceMember: { findUnique: memberFindUnique, findMany: memberFindMany },
    workspaceBlockedUser: { findUnique: jest.fn(async () => null) },
  } as unknown as PrismaClient
  let tools: WorkspaceTools

  beforeEach(() => {
    jest.clearAllMocks()
    tools = new WorkspaceTools(prisma, {} as PageWriter, {} as StatsService)
  })

  it('lists members with names and roles', async () => {
    memberFindUnique.mockResolvedValue({ workspaceId: 'w1' })
    memberFindMany.mockResolvedValue([
      { role: 'OWNER', user: { id: 'u1', firstName: 'Ann', lastName: 'Lee', email: 'a@x.io' } },
    ])
    const req = { headers: {}, auth: { userId: 'u1', source: 'api-key' as const } } as AuthedRequest

    const out = await tools.listWorkspaceMembers({ workspaceId: 'w1' }, {} as never, req)

    expect(out.members).toEqual([
      { userId: 'u1', firstName: 'Ann', lastName: 'Lee', email: 'a@x.io', role: 'OWNER' },
    ])
  })

  it('rejects non-member', async () => {
    memberFindUnique.mockResolvedValue(null)
    const req = { headers: {}, auth: { userId: 'u1', source: 'api-key' as const } } as AuthedRequest
    await expect(
      tools.listWorkspaceMembers({ workspaceId: 'w1' }, {} as never, req),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })
})
