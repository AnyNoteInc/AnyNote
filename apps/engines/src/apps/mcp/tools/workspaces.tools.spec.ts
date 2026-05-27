import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { UnauthorizedException } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'

import type { AuthedRequest } from '../../api/auth/auth-context.js'
import type { Context } from '../utils/mcp-request-context.js'

import { WorkspacesTools } from './workspaces.tools.js'

describe('WorkspacesTools.listWorkspaces', () => {
  const findMany = jest.fn<(...args: unknown[]) => Promise<unknown>>()
  const prisma = {
    workspaceMember: { findMany },
  } as unknown as PrismaClient
  let tools: WorkspacesTools

  beforeEach(() => {
    jest.clearAllMocks()
    tools = new WorkspacesTools(prisma)
  })

  it('returns workspaces where the caller is a member', async () => {
    findMany.mockResolvedValue([
      { role: 'OWNER', workspace: { id: 'w1', name: 'A', slug: 'a' } },
      { role: 'EDITOR', workspace: { id: 'w2', name: 'B', slug: null } },
    ])

    const req = { auth: { userId: 'u1', source: 'api-key' as const } } as AuthedRequest
    const result = await tools.listWorkspaces({}, {} as Context, req)

    expect(result.workspaces).toEqual([
      { id: 'w1', name: 'A', slug: 'a', role: 'OWNER' },
      { id: 'w2', name: 'B', slug: null, role: 'EDITOR' },
    ])
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      select: { role: true, workspace: { select: { id: true, name: true, slug: true } } },
      orderBy: { workspace: { name: 'asc' } },
      take: 200,
    })
  })

  it('throws UnauthorizedException when req.auth is missing', async () => {
    const req = { headers: {} } as AuthedRequest
    await expect(
      tools.listWorkspaces({}, {} as Context, req),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })
})
