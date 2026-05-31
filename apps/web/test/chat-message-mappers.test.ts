import { describe, expect, it } from 'vitest'

import type { ChatThreadMessage } from '@repo/ui/components'

import {
  appendAssistantThinking,
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

function makeThreadMessage(overrides: Partial<ChatThreadMessage> = {}): ChatThreadMessage {
  const now = new Date('2026-05-31T00:00:00.000Z').toISOString()
  return {
    id: 'a1',
    role: 'assistant',
    status: 'streaming',
    createdAt: now,
    updatedAt: now,
    parts: [],
    ...overrides,
  }
}

describe('appendAssistantThinking', () => {
  it('upserts a thinking part before text on the assistant message', () => {
    const msgs = [makeThreadMessage({ parts: [{ type: 'text', text: 'hi' }] })]

    const out = appendAssistantThinking(msgs, 'a1', 'reasoning')
    const assistant = out.find((message) => message.id === 'a1')

    const thinking = assistant?.parts.find((part) => part.type === 'thinking')
    expect(thinking).toEqual({ type: 'thinking', text: 'reasoning' })

    // thinking is placed before text (matching the persisted createAssistantParts order)
    const thinkingIndex = assistant?.parts.findIndex((part) => part.type === 'thinking') ?? -1
    const textIndex = assistant?.parts.findIndex((part) => part.type === 'text') ?? -1
    expect(thinkingIndex).toBeLessThan(textIndex)
  })

  it('accumulates thinking text across calls (matching the registry append semantics)', () => {
    let msgs = [makeThreadMessage({ parts: [] })]

    msgs = appendAssistantThinking(msgs, 'a1', 'foo')
    msgs = appendAssistantThinking(msgs, 'a1', 'bar')

    const assistant = msgs.find((message) => message.id === 'a1')
    expect(assistant?.parts.find((part) => part.type === 'thinking')).toEqual({
      type: 'thinking',
      text: 'foobar',
    })
    // exactly one thinking part (no duplicates)
    expect(assistant?.parts.filter((part) => part.type === 'thinking')).toHaveLength(1)
  })

  it('is a no-op when the assistant message id is not present', () => {
    const msgs = [makeThreadMessage({ id: 'other', parts: [{ type: 'text', text: 'hi' }] })]

    const out = appendAssistantThinking(msgs, 'a1', 'reasoning')
    expect(out).toBe(msgs)
  })
})
