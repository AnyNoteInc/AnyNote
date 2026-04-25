import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  return {
    activeStreamRegistry: {
      create: vi.fn(),
    },
    getSession: vi.fn(),
    prisma: {
      $transaction: vi.fn(),
      chat: { findFirst: vi.fn() },
      chatMessage: { update: vi.fn(), findMany: vi.fn() },
      file: { findMany: vi.fn() },
      workspaceAiSettings: { findUnique: vi.fn() },
    },
  }
})

vi.mock('@repo/db', () => ({
  FileStatus: { ACTIVE: 'ACTIVE' },
  prisma: mocks.prisma,
}))

vi.mock('@/lib/get-session', () => ({
  getSession: mocks.getSession,
}))

vi.mock('@/lib/chat/active-stream-registry', () => ({
  activeStreamRegistry: mocks.activeStreamRegistry,
}))


import { POST } from '../src/app/api/agents/generate/route'

describe('POST /api/agents/generate', () => {
  const chatId = '11111111-1111-1111-1111-111111111111'
  const workspaceId = '22222222-2222-2222-2222-222222222222'
  const userId = '33333333-3333-3333-3333-333333333333'
  const userMessageId = '44444444-4444-4444-4444-444444444444'
  const assistantMessageId = '55555555-5555-5555-5555-555555555555'
  const fileId = '77777777-7777-7777-7777-777777777777'

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns SSE events for a successful start flow', async () => {
    let upstreamTask: Promise<void> | null = null
    const entry = {
      assistantMessageId,
      blocks: [],
      chatId,
      content: '',
      errorMessage: undefined,
      lastTouchedAt: Date.now(),
      publishBlocks: vi.fn((blocks) => {
        entry.blocks = blocks
      }),
      publishCreated: vi.fn(),
      publishDelta: vi.fn((text) => {
        entry.content += text
      }),
      publishDone: vi.fn(),
      publishStatus: vi.fn((status, errorMessage) => {
        entry.status = status
        entry.errorMessage = errorMessage
      }),
      scheduleCleanup: vi.fn(),
      setUpstreamTask: vi.fn((task) => {
        upstreamTask = task
      }),
      status: 'STREAMING',
      subscribe: vi.fn((subscriber) => {
        subscriber({
          type: 'message.delta',
          assistantMessageId,
          text: 'Привет',
        })
        subscriber({
          type: 'message.status',
          assistantMessageId,
          status: 'DONE',
        })
        subscriber({
          type: 'message.done',
          assistantMessageId,
        })
        return () => {}
      }),
      upstreamTask: null,
      userMessageId,
    }

    mocks.getSession.mockResolvedValue({
      user: { id: userId },
    })
    mocks.prisma.chat.findFirst.mockResolvedValue({
      id: chatId,
      title: 'Новый чат',
      workspaceId,
      parentId: null,
    })
    mocks.prisma.chatMessage.findMany.mockResolvedValue([
      {
        id: 'prev-1',
        role: 'USER',
        parts: [{ type: 'text', text: 'previous question' }],
        createdAt: new Date('2026-04-25T10:00:00Z'),
      },
      {
        id: 'prev-2',
        role: 'ASSISTANT',
        parts: [{ type: 'text', text: 'previous answer' }],
        createdAt: new Date('2026-04-25T10:01:00Z'),
      },
    ])
    mocks.prisma.file.findMany.mockResolvedValue([
      {
        id: fileId,
        name: 'brief.pdf',
        mimeType: 'application/pdf',
        fileSize: BigInt(2048),
      },
    ])
    mocks.prisma.workspaceAiSettings.findUnique.mockResolvedValue({
      temperature: 0,
      topP: 0,
      systemPrompt: 'sys',
      defaultModel: {
        slug: 'GigaChat-2',
        provider: {
          slug: 'gigachat',
          connection: {},
        },
      },
    })
    const txChatMessageCreate = vi
      .fn()
      .mockResolvedValueOnce({ id: userMessageId })
      .mockResolvedValueOnce({ id: assistantMessageId })
    const txChatMessageFileCreateMany = vi.fn()
    mocks.prisma.$transaction.mockImplementation(async (callback) => {
      return callback({
        chat: { update: vi.fn() },
        chatMessage: {
          create: txChatMessageCreate,
        },
        chatMessageFile: { createMany: txChatMessageFileCreateMany },
      })
    })
    mocks.activeStreamRegistry.create.mockReturnValue(entry)
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        [
          'data: {"type":"status","id":"tool-1","kind":"tool","state":"running","title":"search_pages"}',
          '',
          'data: {"type":"token","text":"Привет"}',
          '',
          'data: {"type":"status","id":"tool-1","kind":"tool","state":"done","title":"search_pages","detail":"1 документ","result":"Найдена страница Roadmap"}',
          '',
          'data: {"type":"done"}',
          '',
        ].join('\n'),
        {
          headers: { 'content-type': 'text/event-stream' },
          status: 200,
        },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(
      new NextRequest('http://localhost/api/agents/generate', {
        method: 'POST',
        body: JSON.stringify({
          chatId,
          text: 'Привет',
          fileIds: [fileId],
        }),
      }),
    )

    expect(response.status).toBe(200)
    const body = await response.text()
    await upstreamTask

    expect(body).toContain('"type":"message.created"')
    expect(body).toContain('"type":"message.delta"')
    expect(txChatMessageCreate).toHaveBeenNthCalledWith(1, {
      data: {
        chatId,
        parts: [
          { type: 'text', text: 'Привет' },
          {
            type: 'attacment',
            fileId,
            name: 'brief.pdf',
            mimeType: 'application/pdf',
            fileSize: '2048',
          },
        ],
        role: 'USER',
        status: 'DONE',
      },
    })
    expect(txChatMessageCreate).toHaveBeenNthCalledWith(2, {
      data: {
        chatId,
        errorMessage: null,
        parts: [],
        role: 'ASSISTANT',
        status: 'STREAMING',
      },
    })
    expect(txChatMessageFileCreateMany).not.toHaveBeenCalled()
    expect(mocks.prisma.chatMessage.update).toHaveBeenCalledWith({
      where: { id: assistantMessageId },
      data: {
        errorMessage: null,
        parts: [
          { type: 'text', text: 'Привет' },
          {
            type: 'tool',
            id: 'tool-1',
            kind: 'tool',
            state: 'done',
            title: 'search_pages',
            detail: '1 документ',
            result: 'Найдена страница Roadmap',
          },
        ],
        status: 'DONE',
      },
    })

    const upstreamCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/chat/generate'),
    )
    expect(upstreamCall).toBeDefined()
    const sentBody = JSON.parse(upstreamCall![1].body as string)
    expect(sentBody.messages).toEqual([
      { role: 'user', content: 'previous question' },
      { role: 'assistant', content: 'previous answer' },
    ])
  })
})
