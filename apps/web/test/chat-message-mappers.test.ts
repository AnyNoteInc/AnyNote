import { describe, expect, it } from 'vitest'

import {
  mapServerMessageToThreadMessage,
  type ServerChatMessage,
} from '../src/components/workspace/chat/chat-message-mappers'

function makeServerMessage(overrides: Partial<ServerChatMessage> = {}): ServerChatMessage {
  const now = new Date('2026-05-31T00:00:00.000Z').toISOString()
  return {
    id: 'm1',
    role: 'ASSISTANT',
    status: 'DONE',
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    parts: [],
    ...overrides,
  }
}

describe('thinking part mapping', () => {
  it('maps a thinking part through to the thread message', () => {
    const msg = mapServerMessageToThreadMessage(
      makeServerMessage({
        parts: [
          { type: 'thinking', text: 'reasoning…' },
          { type: 'text', text: 'answer' },
        ],
      }),
    )

    const thinkingPart = msg.parts.find((part) => part.type === 'thinking')
    expect(thinkingPart).toEqual({ type: 'thinking', text: 'reasoning…' })
  })

  it('preserves server order (thinking before text)', () => {
    const msg = mapServerMessageToThreadMessage(
      makeServerMessage({
        parts: [
          { type: 'thinking', text: 'reasoning…' },
          { type: 'text', text: 'answer' },
        ],
      }),
    )

    expect(msg.parts.map((part) => part.type)).toEqual(['thinking', 'text'])
  })
})
