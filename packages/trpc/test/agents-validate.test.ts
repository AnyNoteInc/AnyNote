import { afterEach, describe, expect, it, vi } from 'vitest'

process.env.AGENTS_JWT_SECRET ||= Buffer.alloc(32, 7).toString('base64')

import { validateEmbedding, validateLlm, validateMcp } from '../src/helpers/agents-validate'

afterEach(() => vi.restoreAllMocks())

const AUTH = { userId: 'u1', workspaceId: 'w1' }

function mockFetch(body: unknown, ok = true) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response)
}

describe('agents-validate', () => {
  it('validateLlm posts to /validation/llm and returns ok', async () => {
    const f = mockFetch({ ok: true, error: null })
    const res = await validateLlm({ provider: 'openai', name: 'gpt', connection: { apiKey: 'k' } }, AUTH)
    expect(res).toEqual({ ok: true, error: null })
    expect(f.mock.calls[0][0]).toContain('/validation/llm')
    const headers = (f.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers.authorization).toMatch(/^Bearer /)
  })

  it('validateEmbedding returns vectorSize', async () => {
    mockFetch({ ok: true, vectorSize: 768, error: null })
    const res = await validateEmbedding(
      { provider: 'ollama', modelSlug: 'm', connection: { baseUrl: 'http://o:1' } },
      AUTH,
    )
    expect(res.ok).toBe(true)
    expect(res.vectorSize).toBe(768)
  })

  it('validateMcp returns tools', async () => {
    mockFetch({ ok: true, tools: ['search'], error: null })
    const res = await validateMcp(
      { url: 'http://x/mcp', transport: 'HTTP_JSONRPC', headers: {}, verify: true },
      AUTH,
    )
    expect(res.tools).toEqual(['search'])
  })

  it('treats a non-200 agents response as a failed validation', async () => {
    mockFetch({}, false)
    const res = await validateLlm({ provider: 'openai', name: 'gpt', connection: { apiKey: 'k' } }, AUTH)
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/validation service/i)
  })

  it('treats a network error as a failed validation', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network error'))
    const res = await validateLlm({ provider: 'openai', name: 'gpt', connection: { apiKey: 'k' } }, AUTH)
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/validation service/i)
  })
})
