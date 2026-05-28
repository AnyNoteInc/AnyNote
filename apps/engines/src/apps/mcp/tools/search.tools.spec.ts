import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'

import type { AuthedRequest } from '../../api/auth/auth-context.js'
import type { AgentsSearchClient, AgentsSearchHit } from '../services/agents-search.client.js'
import type { EmbeddingConfigService } from '../services/embedding-config.service.js'
import type { PageFtsService } from '../services/page-fts.service.js'
import { SearchTools } from './search.tools.js'

describe('SearchTools', () => {
  const findUnique = jest.fn<(...args: unknown[]) => Promise<unknown>>()
  const prisma = { workspaceMember: { findUnique } } as unknown as PrismaClient
  const searchRag = jest.fn<AgentsSearchClient['searchRag']>()
  const ftsSearch = jest.fn<PageFtsService['search']>()
  const forWorkspace = jest.fn<EmbeddingConfigService['forWorkspace']>()
  const agents: AgentsSearchClient = { searchRag }
  const fts = { search: ftsSearch } as unknown as PageFtsService
  const embeddingConfig = { forWorkspace } as unknown as EmbeddingConfigService
  const member = { headers: {}, auth: { userId: 'u1', source: 'api-key' as const } } as AuthedRequest
  let tools: SearchTools

  beforeEach(() => {
    jest.clearAllMocks()
    findUnique.mockResolvedValue({ workspaceId: 'w1' })
    tools = new SearchTools(agents, prisma, fts, embeddingConfig)
  })

  it('search_pages merges title hits then RAG hits, deduped by pageId', async () => {
    ftsSearch.mockResolvedValue([
      { pageId: 'p1', title: 'T1', icon: null, type: 'TEXT', blockNumber: 0, excerpt: 'title hit' },
    ])
    forWorkspace.mockResolvedValue({ provider: 'openai', modelSlug: 'm', vectorSize: 3, connection: {} } as never)
    searchRag.mockResolvedValue([
      { pageId: 'p1', workspaceId: 'w1', blockNumber: 1, title: 'T1', content: 'rag dup' },
      { pageId: 'p2', workspaceId: 'w1', blockNumber: 0, title: 'T2', content: 'rag hit' },
    ])

    const out = await tools.searchPages({ workspaceId: 'w1', query: 'hi', k: 10 }, {} as never, member)

    expect(out.results.map((r: AgentsSearchHit) => r.pageId)).toEqual(['p1', 'p2'])
  })

  it('search_pages skips RAG when no embedding configured', async () => {
    ftsSearch.mockResolvedValue([])
    forWorkspace.mockResolvedValue(null)
    const out = await tools.searchPages({ workspaceId: 'w1', query: 'hi', k: 10 }, {} as never, member)
    expect(out.results).toEqual([])
    expect(searchRag).not.toHaveBeenCalled()
  })

  it('search_pages tolerates a RAG error and returns title hits', async () => {
    ftsSearch.mockResolvedValue([
      { pageId: 'p1', title: 'T1', icon: null, type: 'TEXT', blockNumber: null, excerpt: null },
    ])
    forWorkspace.mockResolvedValue({ provider: 'openai', modelSlug: 'm', vectorSize: 3, connection: {} } as never)
    searchRag.mockRejectedValue(new Error('agents 500'))
    const out = await tools.searchPages({ workspaceId: 'w1', query: 'hi', k: 10 }, {} as never, member)
    expect(out.results.map((r: AgentsSearchHit) => r.pageId)).toEqual(['p1'])
  })

  it('searchPagesByTitle returns candidate pages', async () => {
    ftsSearch.mockResolvedValue([
      { pageId: 'p1', title: 'Roadmap', icon: '🗺️', type: 'TEXT', blockNumber: 0, excerpt: 'x' },
    ])
    const out = await tools.searchPagesByTitle({ workspaceId: 'w1', query: 'road', limit: 5 }, {} as never, member)
    expect(out.pages).toEqual([{ id: 'p1', title: 'Roadmap', type: 'TEXT', icon: '🗺️' }])
  })

  it('rejects non-member', async () => {
    findUnique.mockResolvedValue(null)
    await expect(
      tools.searchPages({ workspaceId: 'w1', query: 'q', k: 5 }, {} as never, member),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('throws Unauthorized when req.auth is missing', async () => {
    await expect(
      tools.searchPages({ workspaceId: 'w1', query: 'q', k: 5 }, {} as never, { headers: {} } as AuthedRequest),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })
})
