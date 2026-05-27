import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { ForbiddenException, UnauthorizedException } from '@nestjs/common'

import type { PrismaClient } from '@repo/db'

import type { AuthedRequest } from '../../api/auth/auth-context.js'
import type { AgentsSearchClient, AgentsSearchHit } from '../services/agents-search.client.js'
import { SearchTools } from './search.tools.js'

describe('SearchTools.searchPages', () => {
  const workspaceMemberFindUniqueMock = jest.fn<(...args: unknown[]) => Promise<unknown>>()
  const prisma = {
    workspaceMember: { findUnique: workspaceMemberFindUniqueMock },
  } as unknown as PrismaClient
  const searchRagMock = jest.fn<
    (args: { workspaceId: string; query: string; k: number }) => Promise<AgentsSearchHit[]>
  >()
  const client: AgentsSearchClient = {
    searchRag: searchRagMock,
  }
  let tools: SearchTools

  beforeEach(() => {
    jest.clearAllMocks()
    tools = new SearchTools(client, prisma)
  })

  it('searches when the caller is a workspace member', async () => {
    workspaceMemberFindUniqueMock.mockResolvedValue({ workspaceId: 'w1' })
    searchRagMock.mockResolvedValue([
      { pageId: 'p', workspaceId: 'w1', blockNumber: 0, title: 't', content: 'c' },
    ])

    const req: AuthedRequest = { headers: {}, auth: { userId: 'u1', source: 'api-key' } }
    const result = await tools.searchPages(
      { workspaceId: 'w1', query: 'q', k: 5 },
      {} as never,
      req,
    )

    expect(result.results).toHaveLength(1)
    expect(searchRagMock).toHaveBeenCalledWith({
      workspaceId: 'w1',
      query: 'q',
      k: 5,
    })
  })

  it('rejects non-member with ForbiddenException', async () => {
    workspaceMemberFindUniqueMock.mockResolvedValue(null)
    const req: AuthedRequest = { headers: {}, auth: { userId: 'u1', source: 'api-key' } }
    await expect(
      tools.searchPages({ workspaceId: 'w1', query: 'q', k: 5 }, {} as never, req),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('throws Unauthorized when req.auth is missing', async () => {
    const req: AuthedRequest = { headers: {} }
    await expect(
      tools.searchPages({ workspaceId: 'w1', query: 'q', k: 5 }, {} as never, req),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })
})
