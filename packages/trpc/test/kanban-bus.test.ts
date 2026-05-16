import { describe, expect, it, vi } from 'vitest'

import { KanbanBus, type KanbanEvent } from '../src/realtime/kanban-bus'

const PAGE_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const PAGE_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const EVENT: KanbanEvent = { kind: 'task.created', taskId: '00000000-0000-0000-0000-000000000001' }

describe('KanbanBus', () => {
  it('delivers an event only to listeners of the same pageId', () => {
    const bus = new KanbanBus()
    const a = vi.fn()
    const b = vi.fn()
    bus.on(PAGE_A, a)
    bus.on(PAGE_B, b)

    bus.emit(PAGE_A, EVENT)

    expect(a).toHaveBeenCalledWith(EVENT)
    expect(b).not.toHaveBeenCalled()
  })

  it('returns an unsubscribe function that stops further delivery', () => {
    const bus = new KanbanBus()
    const listener = vi.fn()
    const off = bus.on(PAGE_A, listener)

    off()
    bus.emit(PAGE_A, EVENT)

    expect(listener).not.toHaveBeenCalled()
  })

  it('removes the pageId entry when the last listener unsubscribes', () => {
    const bus = new KanbanBus()
    const off = bus.on(PAGE_A, vi.fn())
    off()

    expect(bus.listenerCount(PAGE_A)).toBe(0)
  })
})
