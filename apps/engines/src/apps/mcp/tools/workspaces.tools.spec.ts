import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { UnauthorizedException } from '@nestjs/common'

import { WorkspacesTools } from './workspaces.tools.js'

describe('WorkspacesTools.listWorkspaces', () => {
  const prisma = {
    workspaceMember: { findMany: jest.fn<(...args: unknown[]) => Promise<unknown>>() },
  } as any
  let tools: WorkspacesTools

  beforeEach(() => {
    jest.clearAllMocks()
    tools = new WorkspacesTools(prisma)
  })

  it('returns workspaces where the caller is a member', async () => {
    ;(prisma as any).workspaceMember.findMany.mockResolvedValue([
      { role: 'OWNER', workspace: { id: 'w1', name: 'A', slug: 'a' } },
      { role: 'EDITOR', workspace: { id: 'w2', name: 'B', slug: null } },
    ])

    const req: any = { auth: { userId: 'u1', source: 'api-key' } }
    const result = await tools.listWorkspaces({}, {} as any, req)

    expect(result.workspaces).toEqual([
      { id: 'w1', name: 'A', slug: 'a', role: 'OWNER' },
      { id: 'w2', name: 'B', slug: null, role: 'EDITOR' },
    ])
    expect(prisma.workspaceMember.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      select: { role: true, workspace: { select: { id: true, name: true, slug: true } } },
      orderBy: { workspace: { name: 'asc' } },
    })
  })

  it('throws UnauthorizedException when req.auth is missing', async () => {
    const req: any = { headers: {} }
    await expect(
      tools.listWorkspaces({}, {} as any, req),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })
})
