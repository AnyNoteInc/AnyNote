import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  activeStreamRegistry: { create: vi.fn() },
  getSession: vi.fn(),
  prisma: {
    $transaction: vi.fn(),
    chat: { findFirst: vi.fn() },
    chatMessage: { update: vi.fn(), findMany: vi.fn() },
    file: { findMany: vi.fn() },
    workspaceAiSettings: { findUnique: vi.fn() },
    workspaceMember: { findUnique: vi.fn() },
    workspaceMcpServer: { findMany: vi.fn() },
    workspaceAgentMemory: { findMany: vi.fn() },
  },
  signAgentsJwt: vi.fn(),
  buildEnginesMcpHeaders: vi.fn(),
  decryptMcpHeadersMap: vi.fn(),
}))

vi.mock('@repo/db', () => ({
  FileStatus: { ACTIVE: 'ACTIVE' },
  prisma: mocks.prisma,
  parseAiProviderConnection: vi.fn((slug: string, raw: unknown) => ({ provider: slug, ...(raw as object) })),
}))
vi.mock('@/lib/get-session', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/chat/active-stream-registry', () => ({ activeStreamRegistry: mocks.activeStreamRegistry }))
vi.mock('@/lib/agents-token', () => ({ signAgentsJwt: mocks.signAgentsJwt }))
vi.mock('@/lib/chat/engines-mcp-headers', () => ({ buildEnginesMcpHeaders: mocks.buildEnginesMcpHeaders }))
vi.mock('@/lib/decrypt-workspace-secrets', () => ({ decryptMcpHeadersMap: mocks.decryptMcpHeadersMap }))

import { POST } from '../src/app/api/agents/generate/route'

const chatId = '11111111-1111-1111-1111-111111111111'
const workspaceId = '22222222-2222-2222-2222-222222222222'
const userId = '33333333-3333-3333-3333-333333333333'
const userMessageId = '44444444-4444-4444-4444-444444444444'
const assistantMessageId = '55555555-5555-5555-5555-555555555555'

function makeEntry(assistantMsgId: string) {
  const entry = {
    assistantMessageId: assistantMsgId,
    blocks: [] as unknown[],
    chatId,
    content: '',
    errorMessage: undefined as string | undefined,
    lastTouchedAt: Date.now(),
    status: 'STREAMING' as string,
    upstreamTask: null as Promise<void> | null,
    userMessageId,
    publishBlocks: vi.fn((b: unknown[]) => { entry.blocks = b }),
    publishCreated: vi.fn(),
    publishDelta: vi.fn((t: string) => { entry.content += t }),
    publishDone: vi.fn(),
    publishStatus: vi.fn((s: string, e?: string) => { entry.status = s; entry.errorMessage = e }),
    scheduleCleanup: vi.fn(),
    setUpstreamTask: vi.fn((t: Promise<void>) => { entry.upstreamTask = t }),
    subscribe: vi.fn((cb: (e: unknown) => void) => {
      cb({ type: 'message.delta', assistantMessageId: assistantMsgId, text: 'Hello' })
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
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('calls /agent/run with JWT auth and translates token event to publishDelta', async () => {
    let upstreamTask: Promise<void> | null = null
    const entry = makeEntry(assistantMessageId)
    entry.setUpstreamTask = vi.fn((t) => { upstreamTask = t })

    mocks.getSession.mockResolvedValue({ user: { id: userId } })
    mocks.prisma.chat.findFirst.mockResolvedValue({ id: chatId, title: 'Новый чат', workspaceId, parentId: null })
    mocks.prisma.workspaceMember.findUnique.mockResolvedValue({ role: 'OWNER' })
    mocks.prisma.workspaceAiSettings.findUnique.mockResolvedValue({
      temperature: 0.5,
      topP: 0.9,
      systemPrompt: 'sys',
      defaultModel: { slug: 'GigaChat-2-Pro', provider: { slug: 'gigachat', connection: {} } },
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
          create: vi.fn()
            .mockResolvedValueOnce({ id: userMessageId })
            .mockResolvedValueOnce({ id: assistantMessageId }),
        },
      }),
    )
    mocks.activeStreamRegistry.create.mockReturnValue(entry)

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        [
          'data: {"type":"token","text":"Hello"}',
          '',
          'data: {"type":"done"}',
          '',
        ].join('\n'),
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

  it('translates tool_status running/done into publishBlocks', async () => {
    let upstreamTask: Promise<void> | null = null
    const entry = makeEntry(assistantMessageId)
    entry.setUpstreamTask = vi.fn((t) => { upstreamTask = t })

    mocks.getSession.mockResolvedValue({ user: { id: userId } })
    mocks.prisma.chat.findFirst.mockResolvedValue({ id: chatId, title: 'Test', workspaceId, parentId: null })
    mocks.prisma.workspaceMember.findUnique.mockResolvedValue({ role: 'EDITOR' })
    mocks.prisma.workspaceAiSettings.findUnique.mockResolvedValue({
      temperature: null, topP: null, systemPrompt: null,
      defaultModel: { slug: 'gpt-4o-mini', provider: { slug: 'openai', connection: { apiKey: 'sk-test' } } },
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
          create: vi.fn()
            .mockResolvedValueOnce({ id: userMessageId })
            .mockResolvedValueOnce({ id: assistantMessageId }),
        },
      }),
    )
    mocks.activeStreamRegistry.create.mockReturnValue(entry)

    const fetchMock = vi.fn().mockResolvedValue(
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

    expect(entry.publishBlocks).toHaveBeenCalledTimes(2)
    const publishBlocksMock = vi.mocked(entry.publishBlocks)
    const firstCall = publishBlocksMock.mock.calls[0]![0]
    expect(firstCall[0]).toMatchObject({ id: 't1', kind: 'tool', state: 'running', title: 'Searching' })
    const secondCall = publishBlocksMock.mock.calls[1]![0]
    expect(secondCall[0]).toMatchObject({ id: 't1', kind: 'tool', state: 'done', detail: '3 results' })
  })

  it('publishes ERROR status when upstream returns non-200', async () => {
    let upstreamTask: Promise<void> | null = null
    const entry = makeEntry(assistantMessageId)
    entry.setUpstreamTask = vi.fn((t) => { upstreamTask = t })

    mocks.getSession.mockResolvedValue({ user: { id: userId } })
    mocks.prisma.chat.findFirst.mockResolvedValue({ id: chatId, title: 'Test', workspaceId, parentId: null })
    mocks.prisma.workspaceMember.findUnique.mockResolvedValue({ role: 'VIEWER' })
    mocks.prisma.workspaceAiSettings.findUnique.mockResolvedValue({
      temperature: null, topP: null, systemPrompt: null,
      defaultModel: { slug: 'gpt-4o-mini', provider: { slug: 'openai', connection: {} } },
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
          create: vi.fn()
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
})
