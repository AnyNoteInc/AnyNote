import { describe, expect, it, vi, beforeEach } from 'vitest'

import { buildChatHistoryMessages } from '../src/lib/chat/chat-history'

type ChatRow = { id: string; parentId: string | null; workspaceId: string }
type MessageRow = {
  id: string
  role: 'USER' | 'ASSISTANT'
  status: 'STREAMING' | 'DONE' | 'ERROR'
  parts: unknown
  createdAt: Date
}

function textPart(text: string) {
  return { type: 'text', text }
}

function makeMessages(count: number, role: 'USER' | 'ASSISTANT' = 'USER'): MessageRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `msg-${index}`,
    role,
    status: 'DONE' as const,
    parts: [textPart(`m${index}`)],
    createdAt: new Date(2026, 3, 1, 0, index),
  }))
}

function createPrismaMock(args: {
  chats: ChatRow[]
  messagesByChat: Record<string, MessageRow[]>
}) {
  return {
    chat: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; workspaceId?: string } }) => {
        return args.chats.find((c) => c.id === where.id) ?? null
      }),
    },
    chatMessage: {
      findMany: vi.fn(
        async ({
          where,
          orderBy,
          take,
        }: {
          where: { chatId: string; status?: string }
          orderBy?: { createdAt?: 'asc' | 'desc' }
          take?: number
        }) => {
          const all = args.messagesByChat[where.chatId] ?? []
          let rows = where.status ? all.filter((m) => m.status === where.status) : all
          rows = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          if (orderBy?.createdAt === 'desc') {
            rows.reverse()
          }
          if (typeof take === 'number') {
            rows = rows.slice(0, take)
          }
          return rows
        },
      ),
    },
  }
}

describe('buildChatHistoryMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty array when chat has no messages', async () => {
    const prisma = createPrismaMock({
      chats: [{ id: 'c1', parentId: null, workspaceId: 'w' }],
      messagesByChat: { c1: [] },
    })

    const result = await buildChatHistoryMessages({
      prisma: prisma as never,
      chatId: 'c1',
      workspaceId: 'w',
    })

    expect(result).toEqual([])
  })

  it('returns the single message for a 1-message chat', async () => {
    const messages = makeMessages(1, 'USER')
    const prisma = createPrismaMock({
      chats: [{ id: 'c1', parentId: null, workspaceId: 'w' }],
      messagesByChat: { c1: messages },
    })

    const result = await buildChatHistoryMessages({
      prisma: prisma as never,
      chatId: 'c1',
      workspaceId: 'w',
    })

    expect(result).toEqual([{ role: 'user', content: 'm0' }])
  })

  it('returns all messages when count <= 1 + lastN (no parent, count = 5)', async () => {
    const messages = makeMessages(5, 'USER')
    const prisma = createPrismaMock({
      chats: [{ id: 'c1', parentId: null, workspaceId: 'w' }],
      messagesByChat: { c1: messages },
    })

    const result = await buildChatHistoryMessages({
      prisma: prisma as never,
      chatId: 'c1',
      workspaceId: 'w',
    })

    expect(result.map((m) => m.content)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4'])
  })

  it('returns first + last 10 with no overlap (no parent, count = 15)', async () => {
    const messages = makeMessages(15, 'USER')
    const prisma = createPrismaMock({
      chats: [{ id: 'c1', parentId: null, workspaceId: 'w' }],
      messagesByChat: { c1: messages },
    })

    const result = await buildChatHistoryMessages({
      prisma: prisma as never,
      chatId: 'c1',
      workspaceId: 'w',
    })

    expect(result.map((m) => m.content)).toEqual([
      'm0',
      'm5',
      'm6',
      'm7',
      'm8',
      'm9',
      'm10',
      'm11',
      'm12',
      'm13',
      'm14',
    ])
  })

  it('walks parent chain root → current with correct slicing per chat', async () => {
    const root = makeMessages(8, 'USER').map((m, i) => ({
      ...m,
      id: `root-${i}`,
      parts: [textPart(`root${i}`)],
    }))
    const middle = makeMessages(8, 'USER').map((m, i) => ({
      ...m,
      id: `mid-${i}`,
      parts: [textPart(`mid${i}`)],
    }))
    const current = makeMessages(15, 'USER').map((m, i) => ({
      ...m,
      id: `cur-${i}`,
      parts: [textPart(`cur${i}`)],
    }))

    const prisma = createPrismaMock({
      chats: [
        { id: 'root', parentId: null, workspaceId: 'w' },
        { id: 'mid', parentId: 'root', workspaceId: 'w' },
        { id: 'cur', parentId: 'mid', workspaceId: 'w' },
      ],
      messagesByChat: { root, mid: middle, cur: current },
    })

    const result = await buildChatHistoryMessages({
      prisma: prisma as never,
      chatId: 'cur',
      workspaceId: 'w',
    })

    // root: first + last 4 = root0, root4, root5, root6, root7
    // mid: first + last 4 = mid0, mid4, mid5, mid6, mid7
    // cur: first + last 10 = cur0, cur5, cur6, cur7, cur8, cur9, cur10, cur11, cur12, cur13, cur14
    expect(result.map((m) => m.content)).toEqual([
      'root0',
      'root4',
      'root5',
      'root6',
      'root7',
      'mid0',
      'mid4',
      'mid5',
      'mid6',
      'mid7',
      'cur0',
      'cur5',
      'cur6',
      'cur7',
      'cur8',
      'cur9',
      'cur10',
      'cur11',
      'cur12',
      'cur13',
      'cur14',
    ])
  })

  it('maps role USER → user, ASSISTANT → assistant', async () => {
    const messages: MessageRow[] = [
      {
        id: 'u',
        role: 'USER',
        status: 'DONE',
        parts: [textPart('hi')],
        createdAt: new Date(2026, 3, 1, 0, 0),
      },
      {
        id: 'a',
        role: 'ASSISTANT',
        status: 'DONE',
        parts: [textPart('hello')],
        createdAt: new Date(2026, 3, 1, 0, 1),
      },
    ]
    const prisma = createPrismaMock({
      chats: [{ id: 'c', parentId: null, workspaceId: 'w' }],
      messagesByChat: { c: messages },
    })

    const result = await buildChatHistoryMessages({
      prisma: prisma as never,
      chatId: 'c',
      workspaceId: 'w',
    })

    expect(result).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ])
  })

  it('keeps tool-only assistant turns as a summary line, skips truly empty ones', async () => {
    const messages: MessageRow[] = [
      {
        id: '1',
        role: 'USER',
        status: 'DONE',
        parts: [textPart('real')],
        createdAt: new Date(2026, 3, 1, 0, 0),
      },
      {
        id: '2',
        role: 'ASSISTANT',
        status: 'DONE',
        parts: [
          // detail.tool (the machine name) wins over the human title…
          {
            type: 'tool',
            id: 't1',
            kind: 'tool',
            state: 'done',
            title: 'Добавляю текст',
            detail: JSON.stringify({ tool: 'appendToPage' }),
          },
          // …and a detail-less part falls back to its title.
          { type: 'tool', id: 't2', kind: 'tool', state: 'done', title: 'ran' },
        ],
        createdAt: new Date(2026, 3, 1, 0, 1),
      },
      {
        id: '3',
        role: 'USER',
        status: 'DONE',
        parts: [textPart('   ')],
        createdAt: new Date(2026, 3, 1, 0, 2),
      },
    ]
    const prisma = createPrismaMock({
      chats: [{ id: 'c', parentId: null, workspaceId: 'w' }],
      messagesByChat: { c: messages },
    })

    const result = await buildChatHistoryMessages({
      prisma: prisma as never,
      chatId: 'c',
      workspaceId: 'w',
    })

    expect(result).toEqual([
      { role: 'user', content: 'real' },
      { role: 'assistant', content: '[Выполнены инструменты: appendToPage, ran]' },
    ])
  })

  it('fullCurrentChat returns the whole thread instead of the last-10 window', async () => {
    const messages = makeMessages(15, 'USER')
    const prisma = createPrismaMock({
      chats: [{ id: 'c1', parentId: null, workspaceId: 'w' }],
      messagesByChat: { c1: messages },
    })

    const result = await buildChatHistoryMessages({
      prisma: prisma as never,
      chatId: 'c1',
      workspaceId: 'w',
      fullCurrentChat: true,
    })

    expect(result.map((m) => m.content)).toEqual(
      Array.from({ length: 15 }, (_, i) => `m${i}`),
    )
  })

  it('fullCurrentChat keeps ancestor chats bounded', async () => {
    const root = makeMessages(8, 'USER').map((m, i) => ({
      ...m,
      id: `root-${i}`,
      parts: [textPart(`root${i}`)],
    }))
    const current = makeMessages(15, 'USER').map((m, i) => ({
      ...m,
      id: `cur-${i}`,
      parts: [textPart(`cur${i}`)],
    }))
    const prisma = createPrismaMock({
      chats: [
        { id: 'root', parentId: null, workspaceId: 'w' },
        { id: 'cur', parentId: 'root', workspaceId: 'w' },
      ],
      messagesByChat: { root, cur: current },
    })

    const result = await buildChatHistoryMessages({
      prisma: prisma as never,
      chatId: 'cur',
      workspaceId: 'w',
      fullCurrentChat: true,
    })

    // root stays first + last 4; current is complete.
    expect(result.map((m) => m.content)).toEqual([
      'root0',
      'root4',
      'root5',
      'root6',
      'root7',
      ...Array.from({ length: 15 }, (_, i) => `cur${i}`),
    ])
  })

  it('only loads DONE messages from prisma (filters STREAMING / ERROR)', async () => {
    const prisma = createPrismaMock({
      chats: [{ id: 'c', parentId: null, workspaceId: 'w' }],
      messagesByChat: { c: [] },
    })

    await buildChatHistoryMessages({
      prisma: prisma as never,
      chatId: 'c',
      workspaceId: 'w',
    })

    expect(prisma.chatMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ chatId: 'c', status: 'DONE' }),
      }),
    )
  })

  it('scopes ancestor lookups to the same workspaceId', async () => {
    const prisma = createPrismaMock({
      chats: [
        { id: 'root', parentId: null, workspaceId: 'w' },
        { id: 'cur', parentId: 'root', workspaceId: 'w' },
      ],
      messagesByChat: { root: [], cur: [] },
    })

    await buildChatHistoryMessages({
      prisma: prisma as never,
      chatId: 'cur',
      workspaceId: 'w',
    })

    expect(prisma.chat.findFirst).toHaveBeenCalledWith({
      where: { id: 'root', workspaceId: 'w' },
      select: { id: true, parentId: true },
    })
  })

  it('bounds the per-chat fetch with take and returns first + last 10 for a 30-message chat', async () => {
    const messages = makeMessages(30, 'USER')
    const prisma = createPrismaMock({
      chats: [{ id: 'c1', parentId: null, workspaceId: 'w' }],
      messagesByChat: { c1: messages },
    })

    const result = await buildChatHistoryMessages({
      prisma: prisma as never,
      chatId: 'c1',
      workspaceId: 'w',
    })

    // The fetch must be bounded: at least one findMany call carries a `take`.
    const calls = prisma.chatMessage.findMany.mock.calls as Array<[{ take?: number }]>
    expect(calls.some(([arg]) => typeof arg.take === 'number')).toBe(true)

    // Output is still exactly [first message] + [last 10], no duplication, length 11.
    expect(result).toHaveLength(11)
    expect(result.map((m) => m.content)).toEqual([
      'm0',
      'm20',
      'm21',
      'm22',
      'm23',
      'm24',
      'm25',
      'm26',
      'm27',
      'm28',
      'm29',
    ])
  })

  it('concatenates the last 10 messages including first when count = 11', async () => {
    const messages = makeMessages(11, 'USER')
    const prisma = createPrismaMock({
      chats: [{ id: 'c1', parentId: null, workspaceId: 'w' }],
      messagesByChat: { c1: messages },
    })

    const result = await buildChatHistoryMessages({
      prisma: prisma as never,
      chatId: 'c1',
      workspaceId: 'w',
    })

    expect(result.map((m) => m.content)).toEqual([
      'm0',
      'm1',
      'm2',
      'm3',
      'm4',
      'm5',
      'm6',
      'm7',
      'm8',
      'm9',
      'm10',
    ])
  })
})
