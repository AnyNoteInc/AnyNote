import { describe, expect, it, vi } from 'vitest'

vi.mock('@repo/auth', () => ({
  getUserFromRequest: vi.fn(),
}))

vi.mock('@repo/db', () => ({
  prisma: {},
}))

import type { PrismaClient } from '@repo/db'

import { chatRouter } from '../src/routers/chat'
import { createCallerFactory } from '../src/trpc'

const createCaller = createCallerFactory(chatRouter)

function createContext(prisma: PrismaClient) {
  return {
    prisma,
    user: { id: 'user-1' },
    headers: new Headers(),
    resHeaders: new Headers(),
  }
}

describe('chatRouter', () => {
  it('returns persisted parts and enriches attacments with download URLs', async () => {
    const createdAt = new Date('2026-04-22T10:00:00.000Z')
    const updatedAt = new Date('2026-04-22T10:05:00.000Z')
    const chat = {
      id: '11111111-1111-1111-1111-111111111111',
      title: 'Новый чат',
      workspaceId: '22222222-2222-2222-2222-222222222222',
    }

    const prisma = {
      chat: {
        findFirst: vi.fn(async () => chat),
      },
      chatMessage: {
        findMany: vi.fn(async () => [
          {
            id: '33333333-3333-3333-3333-333333333333',
            role: 'USER',
            status: 'DONE',
            errorMessage: null,
            createdAt,
            updatedAt,
            parts: [
              { type: 'text', text: 'Привет' },
              {
                type: 'tool',
                id: 'tool-1',
                kind: 'tool',
                state: 'done',
                title: 'Поиск по базе',
                detail: '2 документа',
                result: 'Найдена страница Roadmap',
              },
              {
                type: 'attacment',
                fileId: '44444444-4444-4444-4444-444444444444',
                name: 'brief.pdf',
                mimeType: 'application/pdf',
                fileSize: '10',
              },
              {
                type: 'attacment',
                fileId: '55555555-5555-5555-5555-555555555555',
                name: 'image.png',
                mimeType: 'image/png',
                fileSize: '20',
              },
            ],
          },
        ]),
      },
    } as unknown as PrismaClient

    const caller = createCaller(createContext(prisma))
    const result = await caller.getChat({ chatId: chat.id })

    expect(prisma.chatMessage.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: 'asc' },
      where: { chatId: chat.id },
    })

    expect(result.messages).toEqual([
      {
        id: '33333333-3333-3333-3333-333333333333',
        role: 'USER',
        status: 'DONE',
        errorMessage: null,
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
        parts: [
          { type: 'text', text: 'Привет' },
          {
            type: 'tool',
            id: 'tool-1',
            kind: 'tool',
            state: 'done',
            title: 'Поиск по базе',
            detail: '2 документа',
            result: 'Найдена страница Roadmap',
          },
          {
            type: 'attacment',
            fileId: '44444444-4444-4444-4444-444444444444',
            name: 'brief.pdf',
            mimeType: 'application/pdf',
            fileSize: '10',
            downloadUrl: '/api/files/44444444-4444-4444-4444-444444444444',
          },
          {
            type: 'attacment',
            fileId: '55555555-5555-5555-5555-555555555555',
            name: 'image.png',
            mimeType: 'image/png',
            fileSize: '20',
            downloadUrl: '/api/files/55555555-5555-5555-5555-555555555555',
          },
        ],
      },
    ])
  })

  it('preserves a thinking part and keeps it before the text part', async () => {
    const createdAt = new Date('2026-05-31T10:00:00.000Z')
    const updatedAt = new Date('2026-05-31T10:05:00.000Z')
    const chat = {
      id: '11111111-1111-1111-1111-111111111111',
      title: 'Новый чат',
      workspaceId: '22222222-2222-2222-2222-222222222222',
    }

    const prisma = {
      chat: {
        findFirst: vi.fn(async () => chat),
      },
      chatMessage: {
        findMany: vi.fn(async () => [
          {
            id: '66666666-6666-6666-6666-666666666666',
            role: 'ASSISTANT',
            status: 'DONE',
            errorMessage: null,
            createdAt,
            updatedAt,
            parts: [
              { type: 'thinking', text: 'Размышляю над ответом' },
              { type: 'text', text: 'Готовый ответ' },
            ],
          },
        ]),
      },
    } as unknown as PrismaClient

    const caller = createCaller(createContext(prisma))
    const result = await caller.getChat({ chatId: chat.id })

    expect(result.messages[0]?.parts).toEqual([
      { type: 'thinking', text: 'Размышляю над ответом' },
      { type: 'text', text: 'Готовый ответ' },
    ])
  })

  it('drops a thinking part that has no text', async () => {
    const chat = {
      id: '11111111-1111-1111-1111-111111111111',
      title: 'Новый чат',
      workspaceId: '22222222-2222-2222-2222-222222222222',
    }

    const prisma = {
      chat: {
        findFirst: vi.fn(async () => chat),
      },
      chatMessage: {
        findMany: vi.fn(async () => [
          {
            id: '77777777-7777-7777-7777-777777777777',
            role: 'ASSISTANT',
            status: 'DONE',
            errorMessage: null,
            createdAt: new Date('2026-05-31T10:00:00.000Z'),
            updatedAt: new Date('2026-05-31T10:00:00.000Z'),
            parts: [
              { type: 'thinking', text: '' },
              { type: 'text', text: 'Ответ' },
            ],
          },
        ]),
      },
    } as unknown as PrismaClient

    const caller = createCaller(createContext(prisma))
    const result = await caller.getChat({ chatId: chat.id })

    expect(result.messages[0]?.parts).toEqual([{ type: 'text', text: 'Ответ' }])
  })

  it('does not expose the legacy sendMessage mutation anymore', () => {
    const caller = createCaller(
      createContext({
        chat: { findFirst: vi.fn() },
        chatMessage: { findMany: vi.fn() },
      } as unknown as PrismaClient),
    )

    expect('sendMessage' in caller).toBe(false)
  })

  it('adds, removes, and lists favorite chats for the current workspace user', async () => {
    const workspaceId = '22222222-2222-2222-2222-222222222222'
    const chatId = '11111111-1111-1111-1111-111111111111'
    const favorite = {
      chat: {
        id: chatId,
        title: 'Важный чат',
        parentId: null,
        updatedAt: new Date('2026-05-19T12:00:00.000Z'),
        createdAt: new Date('2026-05-19T10:00:00.000Z'),
        createdById: 'user-1',
      },
    }

    const prisma = {
      workspaceMember: {
        findUnique: vi.fn(async () => ({ role: 'OWNER' })),
      },
      chat: {
        findFirst: vi.fn(async () => ({ id: chatId, workspaceId })),
      },
      favoriteChat: {
        upsert: vi.fn(async () => ({ userId: 'user-1', chatId })),
        deleteMany: vi.fn(async () => ({ count: 1 })),
        findMany: vi.fn(async () => [favorite]),
      },
    } as unknown as PrismaClient

    const caller = createCaller(createContext(prisma))

    await caller.addFavorite({ chatId })
    await caller.removeFavorite({ chatId })
    const favorites = await caller.listFavorites({ workspaceId })

    expect(prisma.favoriteChat.upsert).toHaveBeenCalledWith({
      where: { userId_chatId: { userId: 'user-1', chatId } },
      create: { userId: 'user-1', chatId },
      update: {},
    })
    expect(prisma.favoriteChat.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', chatId },
    })
    expect(prisma.favoriteChat.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        chat: { workspaceId },
      },
      include: {
        chat: {
          select: {
            id: true,
            title: true,
            parentId: true,
            updatedAt: true,
            createdAt: true,
            createdById: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })
    expect(favorites).toEqual([favorite.chat])
  })
})
