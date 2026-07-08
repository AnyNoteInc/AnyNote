import { describe, expect, it } from 'vitest'

import {
  createServerMessagesSyncKey,
  findResumableAssistantMessageId,
  mapServerMessagesToThreadMessages,
  type ServerChatMessage,
} from '../src/components/workspace/chat/chat-message-mappers'

describe('workspace chat client mappers', () => {
  it('maps persisted chat DTOs into @repo/ui thread messages', () => {
    const messages = mapServerMessagesToThreadMessages([
      {
        id: '11111111-1111-4111-9111-111111111111',
        role: 'USER',
        status: 'DONE',
        errorMessage: null,
        createdAt: '2026-04-22T10:00:00.000Z',
        updatedAt: '2026-04-22T10:00:00.000Z',
        parts: [
          { type: 'text', text: 'Привет' },
          {
            type: 'attacment',
            fileId: '22222222-2222-4222-9222-222222222222',
            name: 'brief.pdf',
            mimeType: 'application/pdf',
            fileSize: '12',
            downloadUrl: '/api/files/22222222-2222-4222-9222-222222222222',
          },
        ],
      },
    ])

    expect(messages).toEqual([
      {
        id: '11111111-1111-4111-9111-111111111111',
        role: 'user',
        status: 'sent',
        createdAt: '2026-04-22T10:00:00.000Z',
        updatedAt: '2026-04-22T10:00:00.000Z',
        parts: [
          { type: 'text', text: 'Привет' },
          {
            type: 'attacment',
            fileId: '22222222-2222-4222-9222-222222222222',
            name: 'brief.pdf',
            mimeType: 'application/pdf',
            fileSize: '12',
            downloadUrl: '/api/files/22222222-2222-4222-9222-222222222222',
          },
        ],
      },
    ])
  })

  it('treats the latest streaming assistant message as resumable', () => {
    const assistantMessageId = findResumableAssistantMessageId([
      {
        id: '33333333-3333-4333-9333-333333333333',
        role: 'USER',
        status: 'DONE',
        errorMessage: null,
        createdAt: '2026-04-22T10:00:00.000Z',
        updatedAt: '2026-04-22T10:00:00.000Z',
        parts: [{ type: 'text', text: 'Вопрос' }],
      },
      {
        id: '44444444-4444-4444-9444-444444444444',
        role: 'ASSISTANT',
        status: 'STREAMING',
        errorMessage: null,
        createdAt: '2026-04-22T10:00:01.000Z',
        updatedAt: '2026-04-22T10:00:02.000Z',
        parts: [{ type: 'text', text: 'Ответ' }],
      },
    ])

    expect(assistantMessageId).toBe('44444444-4444-4444-9444-444444444444')
  })

  it('reuses the same sync key for equivalent server messages', () => {
    const messages: ServerChatMessage[] = [
      {
        id: '55555555-5555-4555-9555-555555555555',
        role: 'ASSISTANT',
        status: 'DONE',
        errorMessage: null,
        createdAt: '2026-04-22T10:00:01.000Z',
        updatedAt: '2026-04-22T10:00:02.000Z',
        parts: [
          { type: 'text', text: 'Ответ' },
          {
            type: 'attacment',
            fileId: '66666666-6666-4666-9666-666666666666',
            name: 'reply.md',
            mimeType: 'text/markdown',
            fileSize: '128',
            downloadUrl: '/api/files/66666666-6666-4666-9666-666666666666',
          },
        ],
      },
    ]

    const clonedMessages = messages.map((message) => ({
      ...message,
      parts: message.parts.map((part) => ({ ...part })),
    }))

    expect(createServerMessagesSyncKey(clonedMessages)).toBe(createServerMessagesSyncKey(messages))
  })

  it('changes the sync key when the persisted assistant content changes', () => {
    const initialMessage: ServerChatMessage = {
      id: '77777777-7777-4777-9777-777777777777',
      role: 'ASSISTANT',
      status: 'DONE',
      errorMessage: null,
      createdAt: '2026-04-22T10:00:01.000Z',
      updatedAt: '2026-04-22T10:00:02.000Z',
      parts: [{ type: 'text', text: 'Первый ответ' }],
    }

    const initial: ServerChatMessage[] = [initialMessage]

    const updated: ServerChatMessage[] = [
      {
        ...initialMessage,
        updatedAt: '2026-04-22T10:00:03.000Z',
        parts: [{ type: 'text', text: 'Первый ответ. Дополнение' }],
      },
    ]

    expect(createServerMessagesSyncKey(updated)).not.toBe(createServerMessagesSyncKey(initial))
  })
})
