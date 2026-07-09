import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  activeStreamRegistry: { create: vi.fn() },
  getSession: vi.fn(),
  getWorkspaceFeatures: vi.fn(),
  // Marker predicate: lets tests pin that the route embeds this function's
  // result into the page lookup (deleting the AND wiring must fail them).
  buildPageVisibilityWhere: vi.fn(() => ({ visibilityPredicate: true })),
  prisma: {
    $transaction: vi.fn(),
    chat: { findFirst: vi.fn() },
    chatMessage: { update: vi.fn(), findMany: vi.fn() },
    file: { findMany: vi.fn() },
    page: { findFirst: vi.fn() },
    workspaceAiSettings: { findUnique: vi.fn() },
    workspaceMember: { findUnique: vi.fn() },
    workspaceMcpServer: { findMany: vi.fn() },
    workspaceAgentMemory: { findMany: vi.fn() },
  },
  signAgentsJwt: vi.fn(),
  buildEnginesMcpHeaders: vi.fn(),
  decryptMcpHeadersMap: vi.fn(),
}))

// The route resolves membership through getMembershipForToken (active members
// only); keep the existing per-test workspaceMember.findUnique fixtures working.
const getMembershipForToken = vi.hoisted(() =>
  vi.fn(async () => {
    const member = (await mocks.prisma.workspaceMember.findUnique()) as { role: string } | null
    return member ? { role: member.role } : null
  }),
)

vi.mock('@repo/db', () => ({
  FileStatus: { ACTIVE: 'ACTIVE' },
  prisma: mocks.prisma,
  parseAiProviderConnection: vi.fn((slug: string, raw: unknown) => ({
    provider: slug,
    ...(raw as object),
  })),
}))
// Mock the @repo/trpc root: importing it for real pulls the whole appRouter,
// whose load-time static initializers dereference @repo/db enums — which this
// suite mocks away (same failure mode as the @repo/domain root barrel).
vi.mock('@repo/trpc', () => ({
  buildPageVisibilityWhere: mocks.buildPageVisibilityWhere,
  getWorkspaceFeatures: mocks.getWorkspaceFeatures,
}))
vi.mock('@/lib/get-session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/chat/active-stream-registry', () => ({
  activeStreamRegistry: mocks.activeStreamRegistry,
}))
vi.mock('@/lib/agents-token', () => ({
  signAgentsJwt: mocks.signAgentsJwt,
  getMembershipForToken,
}))
vi.mock('@/lib/chat/engines-mcp-headers', () => ({
  buildEnginesMcpHeaders: mocks.buildEnginesMcpHeaders,
}))
vi.mock('@/lib/decrypt-workspace-secrets', () => ({
  decryptMcpHeadersMap: mocks.decryptMcpHeadersMap,
}))

import { POST } from '../src/app/api/agents/generate/route'

const chatId = '11111111-1111-1111-1111-111111111111'
const workspaceId = '22222222-2222-2222-2222-222222222222'
const userId = '33333333-3333-3333-3333-333333333333'
const userMessageId = '44444444-4444-4444-4444-444444444444'
const assistantMessageId = '55555555-5555-5555-5555-555555555555'
const pageId = '66666666-6666-6666-6666-666666666666'

function makeEntry(assistantMsgId: string) {
  const entry = {
    assistantMessageId: assistantMsgId,
    segments: [] as Array<{ type: string; [key: string]: unknown }>,
    chatId,
    errorMessage: undefined as string | undefined,
    lastTouchedAt: Date.now(),
    status: 'STREAMING' as string,
    upstreamTask: null as Promise<void> | null,
    userMessageId,
    publishToolStatus: vi.fn((block: { id: string; [key: string]: unknown }) => {
      const idx = entry.segments.findIndex((s) => s.type === 'tool' && s.id === block.id)
      const seg = { type: 'tool', ...block }
      if (idx >= 0) entry.segments[idx] = seg
      else entry.segments.push(seg)
    }),
    publishCreated: vi.fn(),
    publishDelta: vi.fn((t: string) => {
      const last = entry.segments.at(-1)
      if (last && last.type === 'text') last.text = `${last.text as string}${t}`
      else entry.segments.push({ type: 'text', text: t })
    }),
    publishThinking: vi.fn((t: string) => {
      const last = entry.segments.at(-1)
      if (last && last.type === 'thinking') last.text = `${last.text as string}${t}`
      else entry.segments.push({ type: 'thinking', text: t })
    }),
    publishDone: vi.fn(),
    publishStatus: vi.fn((s: string, e?: string) => {
      entry.status = s
      entry.errorMessage = e
    }),
    scheduleCleanup: vi.fn(),
    setUpstreamTask: vi.fn((t: Promise<void>) => {
      entry.upstreamTask = t
    }),
    subscribe: vi.fn((cb: (e: unknown) => void) => {
      cb({
        type: 'message.delta',
        assistantMessageId: assistantMsgId,
        segmentIndex: 0,
        text: 'Hello',
      })
      cb({ type: 'message.status', assistantMessageId: assistantMsgId, status: 'DONE' })
      cb({ type: 'message.done', assistantMessageId: assistantMsgId })
      return () => {}
    }),
  }
  return entry
}

describe('POST /api/agents/generate', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mocks.signAgentsJwt.mockResolvedValue('signed.jwt.token')
    mocks.buildEnginesMcpHeaders.mockReturnValue({ authorization: 'Bearer sig' })
    mocks.decryptMcpHeadersMap.mockReturnValue({})
    mocks.getWorkspaceFeatures.mockResolvedValue({ chatsEnabled: true })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('calls /agent/run with JWT auth and translates token event to publishDelta', async () => {
    let upstreamTask: Promise<void> | null = null
    const entry = makeEntry(assistantMessageId)
    entry.setUpstreamTask = vi.fn((t) => {
      upstreamTask = t
    })

    mocks.getSession.mockResolvedValue({ user: { id: userId } })
    mocks.prisma.chat.findFirst.mockResolvedValue({
      id: chatId,
      title: 'Новый чат',
      workspaceId,
      parentId: null,
    })
    mocks.prisma.workspaceMember.findUnique.mockResolvedValue({ role: 'OWNER' })
    mocks.prisma.workspaceAiSettings.findUnique.mockResolvedValue({
      temperature: 0.5,
      topP: 0.9,
      systemPrompt: 'sys',
      defaultModel: {
        slug: 'GigaChat-2-Pro',
        provider: { slug: 'gigachat', kind: 'GIGACHAT', connection: {} },
      },
      embeddingsModel: null,
    })
    mocks.prisma.workspaceMcpServer.findMany.mockResolvedValue([])
    mocks.prisma.workspaceAgentMemory.findMany.mockResolvedValue([])
    mocks.prisma.chatMessage.findMany.mockResolvedValue([])
    mocks.prisma.file.findMany.mockResolvedValue([])
    mocks.prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        ...mocks.prisma,
        chat: { update: vi.fn() },
        chatMessage: {
          create: vi
            .fn()
            .mockResolvedValueOnce({ id: userMessageId })
            .mockResolvedValueOnce({ id: assistantMessageId }),
        },
      }),
    )
    mocks.activeStreamRegistry.create.mockReturnValue(entry)

    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          ['data: {"type":"token","text":"Hello"}', '', 'data: {"type":"done"}', ''].join('\n'),
          { headers: { 'content-type': 'text/event-stream' }, status: 200 },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(
      new NextRequest('http://localhost/api/agents/generate', {
        method: 'POST',
        body: JSON.stringify({ chatId, text: 'Hello', fileIds: [] }),
      }),
    )

    expect(response.status).toBe(200)
    await upstreamTask

    // Verify it called /agent/run (not /chat/generate)
    const [calledUrl, calledInit] = fetchMock.mock.calls[0]!
    expect(String(calledUrl)).toMatch(/\/agent\/run$/)

    // Verify Authorization header contains the JWT
    const headers = calledInit.headers as Record<string, string>
    expect(headers['authorization']).toBe('Bearer signed.jwt.token')

    // Verify JWT was signed with correct args
    expect(mocks.signAgentsJwt).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        workspaceId,
        chatId,
        role: 'OWNER',
      }),
    )

    // Verify token event was published as delta
    expect(entry.publishDelta).toHaveBeenCalledWith('Hello')

    // Verify done was published
    expect(entry.publishStatus).toHaveBeenCalledWith('DONE')
  })

  it('translates tool_status running/done into publishToolStatus', async () => {
    let upstreamTask: Promise<void> | null = null
    const entry = makeEntry(assistantMessageId)
    entry.setUpstreamTask = vi.fn((t) => {
      upstreamTask = t
    })

    mocks.getSession.mockResolvedValue({ user: { id: userId } })
    mocks.prisma.chat.findFirst.mockResolvedValue({
      id: chatId,
      title: 'Test',
      workspaceId,
      parentId: null,
    })
    mocks.prisma.workspaceMember.findUnique.mockResolvedValue({ role: 'EDITOR' })
    mocks.prisma.workspaceAiSettings.findUnique.mockResolvedValue({
      temperature: null,
      topP: null,
      systemPrompt: null,
      defaultModel: {
        slug: 'gpt-4o-mini',
        provider: { slug: 'openai', kind: 'OPENAI', connection: { apiKey: 'sk-test' } },
      },
      embeddingsModel: null,
    })
    mocks.prisma.workspaceMcpServer.findMany.mockResolvedValue([])
    mocks.prisma.workspaceAgentMemory.findMany.mockResolvedValue([])
    mocks.prisma.chatMessage.findMany.mockResolvedValue([])
    mocks.prisma.file.findMany.mockResolvedValue([])
    mocks.prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        ...mocks.prisma,
        chat: { update: vi.fn() },
        chatMessage: {
          create: vi
            .fn()
            .mockResolvedValueOnce({ id: userMessageId })
            .mockResolvedValueOnce({ id: assistantMessageId }),
        },
      }),
    )
    mocks.activeStreamRegistry.create.mockReturnValue(entry)

    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          [
            'data: {"type":"tool_status","id":"t1","tool":"search_workspace_pages","state":"running","title":"Searching"}',
            '',
            'data: {"type":"tool_status","id":"t1","tool":"search_workspace_pages","state":"done","title":"Searching","detail":"3 results"}',
            '',
            'data: {"type":"done"}',
            '',
          ].join('\n'),
          { headers: { 'content-type': 'text/event-stream' }, status: 200 },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    await POST(
      new NextRequest('http://localhost/api/agents/generate', {
        method: 'POST',
        body: JSON.stringify({ chatId, text: 'search stuff', fileIds: [] }),
      }),
    )
    await upstreamTask

    expect(entry.publishToolStatus).toHaveBeenCalledTimes(2)
    const publishToolStatusMock = vi.mocked(entry.publishToolStatus)
    const firstCall = publishToolStatusMock.mock.calls[0]![0]
    expect(firstCall).toMatchObject({
      id: 't1',
      kind: 'tool',
      state: 'running',
      title: 'Searching',
    })
    const secondCall = publishToolStatusMock.mock.calls[1]![0]
    expect(secondCall).toMatchObject({ id: 't1', kind: 'tool', state: 'done', detail: '3 results' })
  })

  it('scopes the chat lookup away from blocked users (blocked ⇒ uniform 404)', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: userId } })
    // A blocked user falls out of the filtered lookup exactly like a non-member.
    mocks.prisma.chat.findFirst.mockResolvedValue(null)

    const response = await POST(
      new NextRequest('http://localhost/api/agents/generate', {
        method: 'POST',
        body: JSON.stringify({ chatId, text: 'hi', fileIds: [] }),
      }),
    )

    expect(response.status).toBe(404)
    expect(mocks.prisma.chat.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspace: {
            members: { some: { userId } },
            blockedUsers: { none: { userId } },
          },
        }),
      }),
    )
  })

  it('publishes ERROR status when upstream returns non-200', async () => {
    let upstreamTask: Promise<void> | null = null
    const entry = makeEntry(assistantMessageId)
    entry.setUpstreamTask = vi.fn((t) => {
      upstreamTask = t
    })

    mocks.getSession.mockResolvedValue({ user: { id: userId } })
    mocks.prisma.chat.findFirst.mockResolvedValue({
      id: chatId,
      title: 'Test',
      workspaceId,
      parentId: null,
    })
    mocks.prisma.workspaceMember.findUnique.mockResolvedValue({ role: 'VIEWER' })
    mocks.prisma.workspaceAiSettings.findUnique.mockResolvedValue({
      temperature: null,
      topP: null,
      systemPrompt: null,
      defaultModel: {
        slug: 'gpt-4o-mini',
        provider: { slug: 'openai', kind: 'OPENAI', connection: {} },
      },
      embeddingsModel: null,
    })
    mocks.prisma.workspaceMcpServer.findMany.mockResolvedValue([])
    mocks.prisma.workspaceAgentMemory.findMany.mockResolvedValue([])
    mocks.prisma.chatMessage.findMany.mockResolvedValue([])
    mocks.prisma.file.findMany.mockResolvedValue([])
    mocks.prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        ...mocks.prisma,
        chat: { update: vi.fn() },
        chatMessage: {
          create: vi
            .fn()
            .mockResolvedValueOnce({ id: userMessageId })
            .mockResolvedValueOnce({ id: assistantMessageId }),
        },
      }),
    )
    mocks.activeStreamRegistry.create.mockReturnValue(entry)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))

    await POST(
      new NextRequest('http://localhost/api/agents/generate', {
        method: 'POST',
        body: JSON.stringify({ chatId, text: 'hi', fileIds: [] }),
      }),
    )
    await upstreamTask

    expect(entry.publishStatus).toHaveBeenCalledWith('ERROR', expect.stringContaining('503'))
  })

  it('gates PAGE-chat generation on the plan (403 PLAN) before any message writes', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: userId } })
    mocks.prisma.chat.findFirst.mockResolvedValue({
      id: chatId,
      title: 'Стр',
      workspaceId,
      parentId: null,
      kind: 'PAGE',
      pageId,
    })
    mocks.getWorkspaceFeatures.mockResolvedValue({ chatsEnabled: false })

    const response = await POST(
      new NextRequest('http://localhost/api/agents/generate', {
        method: 'POST',
        body: JSON.stringify({ chatId, text: 'hi', fileIds: [] }),
      }),
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ code: 'PLAN' })
    expect(mocks.getWorkspaceFeatures).toHaveBeenCalledWith(workspaceId)
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('rejects PAGE-chat generation when the page is invisible (uniform 404, no writes)', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: userId } })
    mocks.prisma.chat.findFirst.mockResolvedValue({
      id: chatId,
      title: 'Стр',
      workspaceId,
      parentId: null,
      kind: 'PAGE',
      pageId,
    })
    // Trashed, moved out of visibility, or otherwise gone — the route must 404
    // even though the caller sent no pageContext (spec §6.2 gates generate itself).
    mocks.prisma.page.findFirst.mockResolvedValue(null)

    const response = await POST(
      new NextRequest('http://localhost/api/agents/generate', {
        method: 'POST',
        body: JSON.stringify({ chatId, text: 'hi', fileIds: [] }),
      }),
    )

    expect(response.status).toBe(404)
    // The visibility predicate is built for the session user AND embedded in
    // the lookup — dropping the AND wiring must fail this assertion.
    expect(mocks.buildPageVisibilityWhere).toHaveBeenCalledWith(userId)
    expect(mocks.prisma.page.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: pageId,
          workspaceId,
          deletedAt: null,
          AND: [{ visibilityPredicate: true }],
        }),
      }),
    )
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('rejects PAGE-chat generation when the page link was severed (orphan ⇒ 404, no writes)', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: userId } })
    // Page delete SetNull'd Chat.pageId — the chat's history may still hold
    // private-page content, so the route must fail closed without a lookup.
    mocks.prisma.chat.findFirst.mockResolvedValue({
      id: chatId,
      title: 'Стр',
      workspaceId,
      parentId: null,
      kind: 'PAGE',
      pageId: null,
    })

    const response = await POST(
      new NextRequest('http://localhost/api/agents/generate', {
        method: 'POST',
        body: JSON.stringify({ chatId, text: 'hi', fileIds: [] }),
      }),
    )

    expect(response.status).toBe(404)
    expect(mocks.prisma.page.findFirst).not.toHaveBeenCalled()
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('injects visible-page context as the first upstream attachment on PAGE chats', async () => {
    let upstreamTask: Promise<void> | null = null
    const entry = makeEntry(assistantMessageId)
    entry.setUpstreamTask = vi.fn((t) => {
      upstreamTask = t
    })

    mocks.getSession.mockResolvedValue({ user: { id: userId } })
    mocks.prisma.chat.findFirst.mockResolvedValue({
      id: chatId,
      title: 'Стр',
      workspaceId,
      parentId: null,
      kind: 'PAGE',
      pageId,
      useThinking: false,
      thinkingEffort: 'MEDIUM',
    })
    mocks.prisma.page.findFirst.mockResolvedValue({ id: pageId, title: 'Стр' })
    mocks.prisma.workspaceMember.findUnique.mockResolvedValue({ role: 'EDITOR' })
    mocks.prisma.workspaceAiSettings.findUnique.mockResolvedValue({
      temperature: null,
      topP: null,
      systemPrompt: null,
      defaultModel: {
        slug: 'gpt-4o-mini',
        provider: { slug: 'openai', kind: 'OPENAI', connection: {} },
      },
      embeddingsModel: null,
    })
    mocks.prisma.workspaceMcpServer.findMany.mockResolvedValue([])
    mocks.prisma.workspaceAgentMemory.findMany.mockResolvedValue([])
    mocks.prisma.chatMessage.findMany.mockResolvedValue([])
    mocks.prisma.file.findMany.mockResolvedValue([])
    mocks.prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        ...mocks.prisma,
        chat: { update: vi.fn() },
        chatMessage: {
          create: vi
            .fn()
            .mockResolvedValueOnce({ id: userMessageId })
            .mockResolvedValueOnce({ id: assistantMessageId }),
        },
      }),
    )
    mocks.activeStreamRegistry.create.mockReturnValue(entry)

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(['data: {"type":"done"}', ''].join('\n'), {
        headers: { 'content-type': 'text/event-stream' },
        status: 200,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(
      new NextRequest('http://localhost/api/agents/generate', {
        method: 'POST',
        body: JSON.stringify({
          chatId,
          text: 'Что на странице?',
          fileIds: [],
          pageContext: { content: '# MD', isSelection: false },
        }),
      }),
    )

    expect(response.status).toBe(200)
    await upstreamTask

    const [, calledInit] = fetchMock.mock.calls[0]!
    const payload = JSON.parse(calledInit.body as string)
    // The page-context attachment leads; resolved file attachments (none here)
    // follow it — nothing else may sneak in ahead of the injected context.
    expect(payload.attachments).toHaveLength(1)
    expect(payload.attachments[0]).toMatchObject({
      id: 'page-context',
      name: 'Стр.md',
      mime: 'text/markdown',
      included: true,
      content: '# MD',
    })
  })

  it('rejects pageContext on a non-PAGE chat (400, no writes)', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: userId } })
    mocks.prisma.chat.findFirst.mockResolvedValue({
      id: chatId,
      title: 'Test',
      workspaceId,
      parentId: null,
      kind: 'NORMAL',
      pageId: null,
    })

    const response = await POST(
      new NextRequest('http://localhost/api/agents/generate', {
        method: 'POST',
        body: JSON.stringify({
          chatId,
          text: 'hi',
          fileIds: [],
          pageContext: { content: '# MD', isSelection: false },
        }),
      }),
    )

    expect(response.status).toBe(400)
    expect(mocks.prisma.page.findFirst).not.toHaveBeenCalled()
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })
})
