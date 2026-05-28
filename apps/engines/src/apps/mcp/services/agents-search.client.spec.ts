import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals'

import { createAgentsSearchClient } from './agents-search.client.js'
import type { EmbeddingPayload } from './embedding-config.service.js'

describe('createAgentsSearchClient.searchRag', () => {
  const fetchMock = jest.fn<typeof fetch>()
  beforeEach(() => {
    jest.clearAllMocks()
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('posts workspaceId, embedding and scoreThreshold and maps results', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ results: [{ page_id: 'p', workspace_id: 'w', block_number: 2, title: 't', content: 'c' }] }),
        { status: 200 },
      ),
    )
    const client = createAgentsSearchClient('http://agents')
    const embedding = { provider: 'openai' as const, modelSlug: 'm', vectorSize: 3, connection: {} } as EmbeddingPayload

    const hits = await client.searchRag({ workspaceId: 'w', query: 'q', k: 5, embedding })

    expect(hits).toEqual([{ pageId: 'p', workspaceId: 'w', blockNumber: 2, title: 't', content: 'c' }])
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)
    expect(body).toMatchObject({ workspaceId: 'w', query: 'q', limit: 5, embedding, scoreThreshold: 0.7 })
  })
})
