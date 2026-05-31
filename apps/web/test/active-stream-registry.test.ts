import { describe, expect, it } from 'vitest'

import { createActiveStreamRegistry } from '../src/lib/chat/active-stream-registry'

function makeEntry() {
  const registry = createActiveStreamRegistry()
  return registry.create({
    assistantMessageId: 'a1',
    chatId: 'c1',
    userMessageId: 'u1',
  })
}

describe('active-stream-registry ordered segments', () => {
  it('opens a new text segment after a tool event', () => {
    const entry = makeEntry()
    entry.publishDelta('Looking… ')
    entry.publishToolStatus({ id: 't1', kind: 'tool', state: 'running', title: 'search' })
    entry.publishToolStatus({ id: 't1', kind: 'tool', state: 'done', title: 'search', result: 'ok' })
    entry.publishDelta('Found it.')

    expect(entry.segments).toEqual([
      { type: 'text', text: 'Looking… ' },
      { type: 'tool', id: 't1', kind: 'tool', state: 'done', title: 'search', result: 'ok' },
      { type: 'text', text: 'Found it.' },
    ])
  })

  it('appends consecutive text deltas into the same open segment', () => {
    const entry = makeEntry()
    entry.publishDelta('Hello ')
    entry.publishDelta('world')
    expect(entry.segments).toEqual([{ type: 'text', text: 'Hello world' }])
  })

  it('upserts a tool segment in place by id', () => {
    const entry = makeEntry()
    entry.publishToolStatus({ id: 't1', kind: 'tool', state: 'running', title: 'x' })
    entry.publishToolStatus({ id: 't1', kind: 'tool', state: 'done', title: 'x' })
    expect(entry.segments).toEqual([
      { type: 'tool', id: 't1', kind: 'tool', state: 'done', title: 'x' },
    ])
  })

  it('emits message.delta with the index of the open text segment', () => {
    const entry = makeEntry()
    const events: unknown[] = []
    entry.subscribe((e) => events.push(e))
    entry.publishToolStatus({ id: 't1', kind: 'tool', state: 'done', title: 'x' })
    entry.publishDelta('after tool')

    const delta = events.find(
      (e): e is { type: 'message.delta'; segmentIndex: number; text: string } =>
        typeof e === 'object' && e !== null && (e as { type?: string }).type === 'message.delta',
    )
    expect(delta?.segmentIndex).toBe(1)
    expect(delta?.text).toBe('after tool')
  })

  it('broadcasts deltas to multiple subscribers', () => {
    const entry = makeEntry()
    const left: string[] = []
    const right: string[] = []

    entry.subscribe((event) => {
      if (event.type === 'message.delta') {
        left.push(event.text)
      }
    })
    entry.subscribe((event) => {
      if (event.type === 'message.delta') {
        right.push(event.text)
      }
    })

    entry.publishDelta('При')
    entry.publishDelta('вет')

    expect(left).toEqual(['При', 'вет'])
    expect(right).toEqual(['При', 'вет'])
  })
})
