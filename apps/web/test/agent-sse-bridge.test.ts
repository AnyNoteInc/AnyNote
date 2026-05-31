import { afterEach, describe, expect, it, vi } from 'vitest'

const updateMock = vi.hoisted(() => vi.fn())

vi.mock('@repo/db', () => ({
  prisma: { chatMessage: { update: updateMock } },
}))

import { createActiveStreamRegistry } from '../src/lib/chat/active-stream-registry'
import {
  createAssistantParts,
  streamAgentSseToRegistry,
  translateAgentEvent,
} from '../src/lib/chat/agent-sse-bridge'

function sseResponse(lines: string[]) {
  return new Response(lines.join('\n'), {
    headers: { 'content-type': 'text/event-stream' },
    status: 200,
  })
}

describe('thinking bridge', () => {
  it('maps upstream thinking to message.thinking', () => {
    const out = translateAgentEvent({ type: 'thinking', text: 'hmm' } as never, 'asst-1')
    expect(out).toEqual([{ type: 'message.thinking', assistantMessageId: 'asst-1', text: 'hmm' }])
  })

  it('returns no browser events for non-thinking upstream events', () => {
    expect(translateAgentEvent({ type: 'token', text: 'hi' } as never, 'asst-1')).toEqual([])
    expect(translateAgentEvent({ type: 'done' } as never, 'asst-1')).toEqual([])
  })

  it('accumulates thinking deltas on the registry entry and publishes message.thinking', () => {
    const registry = createActiveStreamRegistry()
    const entry = registry.create({
      assistantMessageId: 'asst-1',
      chatId: 'chat-1',
      userMessageId: 'user-1',
    })

    const seen: Array<{ type: string; text?: string }> = []
    entry.subscribe((event) => {
      if (event.type === 'message.thinking') seen.push({ type: event.type, text: event.text })
    })

    entry.publishThinking('Раз')
    entry.publishThinking('мышляю')

    expect(seen).toEqual([
      { type: 'message.thinking', text: 'Раз' },
      { type: 'message.thinking', text: 'мышляю' },
    ])
    expect(entry.thinking).toBe('Размышляю')
  })

  it('persists the accumulated thinking as a part placed before text parts', () => {
    const registry = createActiveStreamRegistry()
    const entry = registry.create({
      assistantMessageId: 'asst-1',
      chatId: 'chat-1',
      userMessageId: 'user-1',
    })

    entry.publishThinking('reasoning')
    entry.publishDelta('answer')

    const parts = createAssistantParts(entry)

    expect(parts[0]).toEqual({ type: 'thinking', text: 'reasoning' })
    expect(parts[1]).toEqual({ type: 'text', text: 'answer' })
  })

  it('omits the thinking part when no thinking was streamed', () => {
    const registry = createActiveStreamRegistry()
    const entry = registry.create({
      assistantMessageId: 'asst-1',
      chatId: 'chat-1',
      userMessageId: 'user-1',
    })

    entry.publishDelta('answer')

    const parts = createAssistantParts(entry)

    expect(parts.some((part) => part.type === 'thinking')).toBe(false)
  })
})

describe('streamAgentSseToRegistry — thinking end-to-end', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    updateMock.mockReset()
  })

  it('consumes an upstream thinking event and persists it before the text part', async () => {
    const registry = createActiveStreamRegistry()
    const entry = registry.create({
      assistantMessageId: 'asst-1',
      chatId: 'chat-1',
      userMessageId: 'user-1',
    })

    const thinkingEvents: string[] = []
    entry.subscribe((event) => {
      if (event.type === 'message.thinking') thinkingEvents.push(event.text)
    })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        sseResponse([
          'data: {"type":"thinking","text":"let me think"}',
          '',
          'data: {"type":"token","text":"Hello"}',
          '',
          'data: {"type":"done"}',
          '',
        ]),
      ),
    )

    await streamAgentSseToRegistry({
      assistantMessageId: 'asst-1',
      chatId: 'chat-1',
      entry,
      jwt: 'jwt',
      upstreamUrl: 'http://agents/agent/run',
      upstreamBody: {},
    })

    // upstream thinking forwarded to the browser as message.thinking
    expect(thinkingEvents).toEqual(['let me think'])

    // persisted parts lead with the thinking part, then the streamed text
    const lastUpdate = updateMock.mock.calls.at(-1)?.[0] as {
      data: { parts: Array<{ type: string; text?: string }> }
    }
    expect(lastUpdate.data.parts[0]).toEqual({ type: 'thinking', text: 'let me think' })
    expect(lastUpdate.data.parts[1]).toEqual({ type: 'text', text: 'Hello' })
  })
})
