import { beforeEach, describe, expect, it, jest } from '@jest/globals'

import { Test } from '@nestjs/testing'

import type { AgentsSearchClient } from '../services/agents-search.client.js'
import type { McpRequestWithContext } from '../utils/mcp-request-context.js'
import { AGENTS_SEARCH_CLIENT, SearchTools } from './search.tools.js'

describe('SearchTools.searchPages', () => {
  const workspaceId = 'w1'

  const fakeHit = {
    pageId: 'p1',
    workspaceId,
    blockNumber: 3,
    title: 'X',
    content: 'snippet',
  }

  let fakeAgents: jest.Mocked<AgentsSearchClient>
  let tool: SearchTools
  let req: McpRequestWithContext

  beforeEach(async () => {
    fakeAgents = {
      searchRag: jest.fn<AgentsSearchClient['searchRag']>().mockResolvedValue([fakeHit]),
    }

    const moduleRef = await Test.createTestingModule({
      providers: [
        SearchTools,
        { provide: AGENTS_SEARCH_CLIENT, useValue: fakeAgents },
      ],
    }).compile()

    tool = moduleRef.get(SearchTools)

    req = {
      headers: {},
      mcpContext: { userId: 'u1', workspaceId },
    } as McpRequestWithContext
  })

  it('returns trimmed RAG hits with workspaceId and blockNumber', async () => {
    const result = await tool.searchPages({ query: 'q', k: 5 }, {} as never, req)

    expect(result.results).toHaveLength(1)
    const hit = result.results[0]!
    expect(hit.pageId).toBe('p1')
    expect(hit.blockNumber).toBe(3)
    expect(fakeAgents.searchRag).toHaveBeenCalledWith({
      workspaceId,
      query: 'q',
      k: 5,
    })
  })
})
