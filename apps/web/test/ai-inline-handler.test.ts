import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { handleInlineAi, type InlineAiDeps } from '../src/app/api/ai/inline/handler'
import { __resetInlineAiRateLimit, INLINE_AI_RATE_LIMIT_MAX } from '../src/lib/ai/inline-rate-limit'

const workspaceId = '22222222-2222-4222-9222-222222222222'
const pageId = '11111111-1111-4111-9111-111111111111'
const userId = '33333333-3333-4333-9333-333333333333'
const chatId = '44444444-4444-4444-9444-444444444444'

const SELECTED = 'Длинный исходный текст для трансформации.'

function sseStream(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f))
      controller.close()
    },
  })
}

function happyUpstream(): typeof fetch {
  return vi.fn(
    async () =>
      new Response(
        sseStream([
          'data: {"type":"token","text":"Краткое "}\n\n',
          'data: {"type":"token","text":"резюме."}\n\n',
          // HYPOTHETICAL / forward-compat: agents does NOT emit a `usage` frame
          // today (spec §6). This synthetic frame only exercises the handler's
          // token-capture path so it's wired and ready; it is NOT proof of live
          // production token-accounting until agents actually emits `usage`.
          'data: {"type":"usage","promptTokens":12,"completionTokens":3,"totalTokens":15}\n\n',
          'data: {"type":"done"}\n\n',
        ]),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ),
  ) as unknown as typeof fetch
}

type DepsOverrides = Partial<InlineAiDeps>

function makeDeps(overrides: DepsOverrides = {}): InlineAiDeps {
  const auditCreate = vi.fn(async () => ({ id: 'audit-1' }))
  const prisma = {
    page: {
      findFirst: vi.fn(async () => ({
        id: pageId,
        workspaceId,
        deletedAt: null,
        createdById: userId,
      })),
    },
    workspaceMember: {
      findUnique: vi.fn(async () => ({ role: 'OWNER' })),
    },
    workspaceBlockedUser: {
      findUnique: vi.fn(async () => null),
    },
    workspaceAiSettings: {
      findUnique: vi.fn(async () => ({
        temperature: 0.4,
        topP: 0.9,
        systemPrompt: 'sys',
        defaultModel: {
          slug: 'gpt-4o-mini',
          provider: {
            kind: 'OPENAI',
            workspaceId,
            connection: { apiKey: 'sk-test' },
            connectionEnc: null,
          },
        },
        embeddingsModel: null,
      })),
    },
    chat: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: chatId })),
    },
    workspaceAuditLog: {
      create: auditCreate,
    },
  }
  return {
    getSession: vi.fn(async () => ({ user: { id: userId } })),
    prisma: prisma as unknown as InlineAiDeps['prisma'],
    getFeatures: vi.fn(async () => ({ aiSettingsEnabled: true })),
    signJwt: vi.fn(async () => 'signed.jwt'),
    upstreamFetch: happyUpstream(),
    ...overrides,
  }
}

function makeRequest(
  body: Record<string, unknown> = {
    action: 'summarize',
    selectedText: SELECTED,
    pageId,
    workspaceId,
  },
  init: { signal?: AbortSignal } = {},
): Request {
  return new Request('http://localhost/api/ai/inline', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: init.signal,
  })
}

/** Drains a streamed Response body to a single string. */
async function drain(res: Response): Promise<string> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let out = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out += decoder.decode(value, { stream: true })
  }
  return out
}

beforeEach(() => {
  __resetInlineAiRateLimit()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('POST /api/ai/inline — gating order (spec §3.1)', () => {
  it('401 when there is no session (never touches the provider)', async () => {
    const deps = makeDeps({ getSession: vi.fn(async () => null) })
    const res = await handleInlineAi(makeRequest(), deps)
    expect(res.status).toBe(401)
    expect(deps.upstreamFetch).not.toHaveBeenCalled()
  })

  it('400 on an unknown action (allow-list authority)', async () => {
    const deps = makeDeps()
    const res = await handleInlineAi(
      makeRequest({ action: 'hack', selectedText: SELECTED, pageId, workspaceId }),
      deps,
    )
    expect(res.status).toBe(400)
    expect(deps.upstreamFetch).not.toHaveBeenCalled()
  })

  it('400 on a malformed body (zod validation)', async () => {
    const deps = makeDeps()
    const res = await handleInlineAi(
      makeRequest({ action: 'summarize', pageId, workspaceId }),
      deps,
    )
    expect(res.status).toBe(400)
    expect(deps.upstreamFetch).not.toHaveBeenCalled()
  })

  it('404 when the page is not editable by the caller', async () => {
    const deps = makeDeps()
    ;(deps.prisma.page.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const res = await handleInlineAi(makeRequest(), deps)
    expect(res.status).toBe(404)
    // No oracle: plan + provider never consulted on an inaccessible page.
    expect(deps.getFeatures).not.toHaveBeenCalled()
    expect(deps.upstreamFetch).not.toHaveBeenCalled()
  })

  it('403 when the plan gate (aiSettingsEnabled) is off', async () => {
    const deps = makeDeps({ getFeatures: vi.fn(async () => ({ aiSettingsEnabled: false })) })
    const res = await handleInlineAi(makeRequest(), deps)
    expect(res.status).toBe(403)
    expect(deps.upstreamFetch).not.toHaveBeenCalled()
  })

  it('400 when the workspace has no default AI model (never a global fallback)', async () => {
    const deps = makeDeps()
    ;(deps.prisma.workspaceAiSettings.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      temperature: null,
      topP: null,
      systemPrompt: null,
      defaultModel: null,
      embeddingsModel: null,
    })
    const res = await handleInlineAi(makeRequest(), deps)
    expect(res.status).toBe(400)
    expect(deps.upstreamFetch).not.toHaveBeenCalled()
  })

  it('429 once the per-(user,workspace) window is exhausted', async () => {
    const deps = makeDeps()
    for (let i = 0; i < INLINE_AI_RATE_LIMIT_MAX; i += 1) {
      const ok = await handleInlineAi(makeRequest(), deps)
      expect(ok.status).toBe(200)
    }
    const limited = await handleInlineAi(makeRequest(), deps)
    expect(limited.status).toBe(429)
  })
})

describe('POST /api/ai/inline — happy path', () => {
  it('calls /agent/run with the workspace provider (kind lowercased) and the preset prompt', async () => {
    const deps = makeDeps()
    const res = await handleInlineAi(makeRequest(), deps)
    expect(res.status).toBe(200)
    await drain(res)

    expect(deps.upstreamFetch).toHaveBeenCalledTimes(1)
    const [url, init] = (deps.upstreamFetch as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(String(url)).toMatch(/\/agent\/run$/)

    const sent = JSON.parse((init as RequestInit).body as string)
    // Provider resolution is the workspace's own kind, lowercased — never global.
    expect(sent.model.provider).toBe('openai')
    expect(sent.model.name).toBe('gpt-4o-mini')
    expect(sent.model.connection).toEqual({ apiKey: 'sk-test' })
    // No MCP tools for a pure text transform.
    expect(sent.mcp_servers).toEqual([])
    // Empty history — single-shot transform.
    expect(sent.chat_history).toEqual([])
    expect(sent.chat_id).toBe(chatId)
    // The user_message carries BOTH the selected text and the preset instruction;
    // the client never supplies a system prompt.
    expect(sent.user_message).toContain(SELECTED)
    expect(sent.user_message.toLowerCase()).toMatch(/сократ|кратк|резюм/)
  })

  it('mints the agents JWT bound to the ephemeral chat with the membership role', async () => {
    const deps = makeDeps()
    await drain(await handleInlineAi(makeRequest(), deps))
    expect(deps.signJwt).toHaveBeenCalledWith(
      expect.objectContaining({ userId, workspaceId, chatId, role: 'OWNER' }),
    )
    const [, init] = (deps.upstreamFetch as ReturnType<typeof vi.fn>).mock.calls[0]!
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers['authorization']).toBe('Bearer signed.jwt')
  })

  it('passes the request signal through to the upstream fetch (real cancellation)', async () => {
    const controller = new AbortController()
    const deps = makeDeps()
    await drain(await handleInlineAi(makeRequest(undefined, { signal: controller.signal }), deps))
    const [, init] = (deps.upstreamFetch as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal)
  })

  it('pipes the upstream token frames through to the browser', async () => {
    const deps = makeDeps()
    const res = await handleInlineAi(makeRequest(), deps)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const body = await drain(res)
    expect(body).toContain('Краткое ')
    expect(body).toContain('резюме.')
    expect(body).toContain('"type":"done"')
  })

  it('writes an audit row with the preset, provider, model, pageId (and usage when emitted)', async () => {
    const deps = makeDeps()
    await drain(await handleInlineAi(makeRequest(), deps))
    const auditCreate = deps.prisma.workspaceAuditLog.create as ReturnType<typeof vi.fn>
    expect(auditCreate).toHaveBeenCalledTimes(1)
    const arg = auditCreate.mock.calls[0]![0] as {
      data: {
        workspaceId: string
        actorId: string
        action: string
        metadata: Record<string, unknown>
      }
    }
    expect(arg.data.workspaceId).toBe(workspaceId)
    expect(arg.data.actorId).toBe(userId)
    expect(arg.data.action).toBe('ai.inline.run')
    expect(arg.data.metadata).toMatchObject({
      preset: 'summarize',
      provider: 'openai',
      model: 'gpt-4o-mini',
      pageId,
      promptTokens: 12,
      completionTokens: 3,
      totalTokens: 15,
    })
  })

  it('reuses an existing INLINE_AI chat instead of creating a new one', async () => {
    const deps = makeDeps()
    ;(deps.prisma.chat.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: chatId })
    await drain(await handleInlineAi(makeRequest(), deps))
    expect(deps.prisma.chat.create).not.toHaveBeenCalled()
  })
})
