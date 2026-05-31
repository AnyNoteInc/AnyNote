import { describe, expect, it } from 'vitest'

import type { ChatThreadMessage } from '@repo/ui/components'

import {
  appendAssistantTextDelta,
  appendAssistantThinking,
  mapServerMessageToThreadMessage,
  replaceAssistantSegments,
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

describe('segment order is preserved (no type grouping)', () => {
  it('keeps an interleaved text/tool/text message in array order', () => {
    const msg = mapServerMessageToThreadMessage(
      makeServerMessage({
        parts: [
          { type: 'text', text: 'first' },
          { type: 'tool', id: 't1', kind: 'tool', state: 'done', title: 'search' },
          { type: 'text', text: 'second' },
        ],
      }),
    )
    expect(msg.parts.map((p) => p.type)).toEqual(['text', 'tool', 'text'])
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

describe('appendAssistantTextDelta', () => {
  it('appends into the text segment at the given index, creating it if absent', () => {
    const msgs = [makeThreadMessage({ parts: [] })]
    const afterFirst = appendAssistantTextDelta(msgs, 'a1', 0, 'Hello ')
    const afterSecond = appendAssistantTextDelta(afterFirst, 'a1', 0, 'world')
    expect(afterSecond[0]?.parts).toEqual([{ type: 'text', text: 'Hello world' }])
  })

  it('targets a later segment index without touching earlier ones', () => {
    const msgs = [
      makeThreadMessage({
        parts: [
          { type: 'text', text: 'intro' },
          { type: 'tool', id: 't1', kind: 'tool', state: 'done', title: 'x' },
        ],
      }),
    ]
    const next = appendAssistantTextDelta(msgs, 'a1', 2, 'after tool')
    expect(next[0]?.parts).toEqual([
      { type: 'text', text: 'intro' },
      { type: 'tool', id: 't1', kind: 'tool', state: 'done', title: 'x' },
      { type: 'text', text: 'after tool' },
    ])
  })
})

describe('replaceAssistantSegments', () => {
  it('replaces parts wholesale from a snapshot', () => {
    const msgs = [makeThreadMessage({ parts: [{ type: 'text', text: 'stale' }] })]
    const next = replaceAssistantSegments(msgs, 'a1', [
      { type: 'text', text: 'fresh' },
      { type: 'tool', id: 't1', kind: 'tool', state: 'running', title: 'x' },
    ])
    expect(next[0]?.parts).toEqual([
      { type: 'text', text: 'fresh' },
      { type: 'tool', id: 't1', kind: 'tool', state: 'running', title: 'x' },
    ])
  })
})
