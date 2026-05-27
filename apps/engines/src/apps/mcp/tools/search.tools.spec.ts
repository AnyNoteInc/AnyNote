import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { ForbiddenException, UnauthorizedException } from '@nestjs/common'

import type { PrismaClient } from '@repo/db'

import type { AgentsSearchClient } from '../services/agents-search.client.js'
import { SearchTools } from './search.tools.js'

describe('SearchTools.searchPages', () => {
  const prisma = {
    workspaceMember: { findUnique: jest.fn<(...args: unknown[]) => Promise<unknown>>() },
  } as unknown as PrismaClient
  const client: AgentsSearchClient = {
    searchRag: jest.fn<(...args: unknown[]) => Promise<unknown>>() as AgentsSearchClient['searchRag'],
  }
  let tools: SearchTools

  beforeEach(() => {
    jest.clearAllMocks()
    tools = new SearchTools(client, prisma)
  })

  it('searches when the caller is a workspace member', async () => {
    ;(prisma as any).workspaceMember.findUnique.mockResolvedValue({ workspaceId: 'w1' })
    ;(client as any).searchRag.mockResolvedValue([
      { pageId: 'p', blockNumber: 0, title: 't', content: 'c' },
    ])

    const req: any = { auth: { userId: 'u1', source: 'api-key' } }
    const result = await tools.searchPages(
      { workspaceId: 'w1', query: 'q', k: 5 },
      {} as any,
      req,
    )

    expect(result.results).toHaveLength(1)
    expect((client as any).searchRag).toHaveBeenCalledWith({
      workspaceId: 'w1',
      query: 'q',
      k: 5,
    })
  })

  it('rejects non-member with ForbiddenException', async () => {
    ;(prisma as any).workspaceMember.findUnique.mockResolvedValue(null)
    const req: any = { auth: { userId: 'u1', source: 'api-key' } }
    await expect(
      tools.searchPages({ workspaceId: 'w1', query: 'q', k: 5 }, {} as any, req),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('throws Unauthorized when req.auth is missing', async () => {
    const req: any = { headers: {} }
    await expect(
      tools.searchPages({ workspaceId: 'w1', query: 'q' } as any, {} as any, req),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })
})
