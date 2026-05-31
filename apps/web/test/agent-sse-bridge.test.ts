import { afterEach, describe, expect, it, vi } from 'vitest'

const updateMock = vi.hoisted(() => vi.fn())

vi.mock('@repo/db', () => ({
  prisma: { chatMessage: { update: updateMock } },
}))

import { createActiveStreamRegistry } from '../src/lib/chat/active-stream-registry'
import {
  createAssistantParts,
  createDebouncedPersist,
  handleAgentEvent,
  streamAgentSseToRegistry,
  translateAgentEvent,
} from '../src/lib/chat/agent-sse-bridge'

// createDebouncedPersist touches prisma; stub schedule/flush to no-ops for unit scope.
function fakePersist() {
  return { schedule() {}, async flush() {} }
}

function makeEntry() {
  return createActiveStreamRegistry().create({
    assistantMessageId: 'a1',
    chatId: 'c1',
    userMessageId: 'u1',
  })
}

function sseResponse(lines: string[]) {
  return new Response(lines.join('\n'), {
    headers: { 'content-type': 'text/event-stream' },
    status: 200,
  })
}

describe('agent-sse-bridge translates upstream events to ordered segments', () => {
  it('interleaves token → tool → token', () => {
    const entry = makeEntry()
    const flush = fakePersist() as ReturnType<typeof createDebouncedPersist>

    handleAgentEvent({ type: 'token', text: 'Looking… ' }, entry, flush)
    handleAgentEvent(
      { type: 'tool_status', id: 't1', tool: 'search', state: 'running', title: 'search' },
      entry,
      flush,
    )
    handleAgentEvent(
      { type: 'tool_status', id: 't1', tool: 'search', state: 'done', title: 'search', detail: 'ok' },
      entry,
      flush,
    )
    handleAgentEvent({ type: 'token', text: 'Found.' }, entry, flush)

    expect(entry.segments.map((s) => s.type)).toEqual(['text', 'tool', 'text'])
    expect(entry.segments[0]).toMatchObject({ type: 'text', text: 'Looking… ' })
    expect(entry.segments[1]).toMatchObject({ type: 'tool', id: 't1', state: 'done' })
    expect(entry.segments[2]).toMatchObject({ type: 'text', text: 'Found.' })
  })
})

describe('thinking bridge', () => {
  it('maps upstream thinking to message.thinking', () => {
    const out = translateAgentEvent({ type: 'thinking', text: 'hmm' } as never, 'asst-1')
    expect(out).toEqual([{ type: 'message.thinking', assistantMessageId: 'asst-1', text: 'hmm' }])
  })

  it('returns no browser events for non-thinking upstream events', () => {
    expect(translateAgentEvent({ type: 'token', text: 'hi' } as never, 'asst-1')).toEqual([])
    expect(translateAgentEvent({ type: 'done' } as never, 'asst-1')).toEqual([])
  })

  it('accumulates thinking deltas into one thinking segment and publishes message.thinking', () => {
    const entry = makeEntry()

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
    expect(entry.segments).toEqual([{ type: 'thinking', text: 'Размышляю' }])
  })

  it('persists the accumulated thinking as a segment placed before text segments', () => {
    const entry = makeEntry()

    entry.publishThinking('reasoning')
    entry.publishDelta('answer')

    const parts = createAssistantParts(entry)

    expect(parts[0]).toEqual({ type: 'thinking', text: 'reasoning' })
    expect(parts[1]).toEqual({ type: 'text', text: 'answer' })
  })

  it('omits the thinking segment when no thinking was streamed', () => {
    const entry = makeEntry()

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

  it('consumes an upstream thinking event and persists it before the text segment', async () => {
    const entry = makeEntry()

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
      assistantMessageId: 'a1',
      chatId: 'c1',
      entry,
      jwt: 'jwt',
      upstreamUrl: 'http://agents/agent/run',
      upstreamBody: {},
    })

    // upstream thinking forwarded to the browser as message.thinking
    expect(thinkingEvents).toEqual(['let me think'])

    // persisted segments lead with the thinking segment, then the streamed text
    const lastUpdate = updateMock.mock.calls.at(-1)?.[0] as {
      data: { parts: Array<{ type: string; text?: string }> }
    }
    expect(lastUpdate.data.parts[0]).toEqual({ type: 'thinking', text: 'let me think' })
    expect(lastUpdate.data.parts[1]).toEqual({ type: 'text', text: 'Hello' })
  })
})
