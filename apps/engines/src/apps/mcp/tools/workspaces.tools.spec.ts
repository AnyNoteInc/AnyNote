import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { UnauthorizedException } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'

import type { AuthedRequest } from '../../api/auth/auth-context.js'
import type { Context } from '../utils/mcp-request-context.js'
import { WorkspacesTools } from './workspaces.tools.js'

describe('WorkspacesTools.listWorkspaces', () => {
  const findMany = jest.fn<(...args: unknown[]) => Promise<unknown>>()
  const findFirst = jest.fn<(...args: unknown[]) => Promise<unknown>>()
  const prisma = {
    workspaceMember: { findMany },
    userPreference: { findFirst },
  } as unknown as PrismaClient
  let tools: WorkspacesTools

  beforeEach(() => {
    jest.clearAllMocks()
    tools = new WorkspacesTools(prisma)
  })

  it('flags current and default workspaces', async () => {
    findMany.mockResolvedValue([
      { role: 'OWNER', workspace: { id: 'w1', name: 'A', slug: 'a' } },
      { role: 'EDITOR', workspace: { id: 'w2', name: 'B', slug: null } },
    ])
    findFirst.mockResolvedValue({ defaultWorkspaceId: 'w2' })

    const req = { auth: { userId: 'u1', source: 'api-key' as const } } as AuthedRequest
    const result = await tools.listWorkspaces({ workspaceId: 'w1' }, {} as Context, req)

    expect(result.workspaces).toEqual([
      { id: 'w1', name: 'A', slug: 'a', role: 'OWNER', isCurrent: true, isDefault: false },
      { id: 'w2', name: 'B', slug: null, role: 'EDITOR', isCurrent: false, isDefault: true },
    ])
  })

  it('throws UnauthorizedException when req.auth is missing', async () => {
    const req = { headers: {} } as AuthedRequest
    await expect(tools.listWorkspaces({}, {} as Context, req)).rejects.toBeInstanceOf(UnauthorizedException)
  })
})
