import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'

import { AgentsClient } from './agents-client.service.js'

const embedding = {
  provider: 'ollama' as const,
  modelSlug: 'nomic-embed-text',
  vectorSize: 768,
  connection: { provider: 'ollama' as const, baseUrl: 'http://ollama:11434' },
}

describe('AgentsClient', () => {
  const originalFetch = globalThis.fetch
  beforeEach(() => {
    process.env.AGENTS_SERVICE_URL = 'http://agents:8080'
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('POSTs payload to /vectorization and resolves on 2xx', async () => {
    const mockFetch = jest.fn(async () => new Response('{}', { status: 200 }))
    globalThis.fetch = mockFetch as unknown as typeof fetch
    const client = new AgentsClient()
    await client.vectorize({
      pageId: 'p',
      workspaceId: 'w',
      title: '',
      pageType: 'TEXT',
      contents: [],
      embedding,
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://agents:8080/vectorization')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual(
      expect.objectContaining({
        embedding,
      }),
    )
  })

  it('DELETEs page vectors by page id', async () => {
    const mockFetch = jest.fn(async () => new Response(null, { status: 204 }))
    globalThis.fetch = mockFetch as unknown as typeof fetch
    const client = new AgentsClient()
    await client.deletePageVectors('p1')
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://agents:8080/vectorization/pages/p1')
    expect(init.method).toBe('DELETE')
    expect(init.body).toBeUndefined()
  })

  it('DELETEs workspace vectors by workspace id', async () => {
    const mockFetch = jest.fn(async () => new Response(null, { status: 204 }))
    globalThis.fetch = mockFetch as unknown as typeof fetch
    const client = new AgentsClient()
    await client.deleteWorkspaceVectors('w1')
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://agents:8080/vectorization/workspaces/w1')
    expect(init.method).toBe('DELETE')
    expect(init.body).toBeUndefined()
  })

  it('throws on 5xx with readable message', async () => {
    globalThis.fetch = jest.fn(
      async () => new Response('boom', { status: 500 }),
    ) as unknown as typeof fetch
    const client = new AgentsClient()
    await expect(
      client.vectorize({
        pageId: 'p',
        workspaceId: 'w',
        title: '',
        pageType: 'TEXT',
        contents: [],
        embedding,
      }),
    ).rejects.toThrow(/500.*boom/)
  })
})
