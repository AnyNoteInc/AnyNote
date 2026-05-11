// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Editor } from '@repo/editor'

import {
  collectReminderInputs,
  type DocLike,
  useReminderSync,
} from '@/components/page/use-reminder-sync'

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
}))

vi.mock('@/trpc/client', () => ({
  trpc: {
    reminder: {
      syncForPage: {
        useMutation: () => ({ mutate: mocks.mutate }),
      },
    },
  },
}))

type FakeEditor = {
  isEditable: boolean
  state: { doc: DocLike }
  on: (event: 'update', handler: () => void) => void
  off: (event: 'update', handler: () => void) => void
  emitUpdate: () => void
}

function reminderAttrs(id: string, dueAt = '2026-06-01T00:00:00Z') {
  return {
    id,
    dueAt,
    offsets: [0],
    audience: 'ME',
    label: 'x',
    recipients: [],
    doneAt: null,
  }
}

function makeDoc(nodes: Array<{ type: string; attrs?: Record<string, unknown> }>): DocLike {
  return {
    descendants(visit) {
      for (const node of nodes) {
        visit({ type: { name: node.type }, attrs: node.attrs ?? {} })
      }
    },
  }
}

function makeEditor(doc: DocLike): FakeEditor {
  const handlers = new Set<() => void>()
  return {
    isEditable: true,
    state: { doc },
    on: (_event, handler) => {
      handlers.add(handler)
    },
    off: (_event, handler) => {
      handlers.delete(handler)
    },
    emitUpdate: () => {
      for (const handler of handlers) handler()
    },
  }
}

describe('useReminderSync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.mutate.mockClear()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('does not sync when editor updates without reminder changes', () => {
    const editor = makeEditor(makeDoc([{ type: 'paragraph' }]))

    renderHook(() => useReminderSync(editor as unknown as Editor, 'page-1'))

    act(() => editor.emitUpdate())
    act(() => vi.advanceTimersByTime(1_000))

    expect(mocks.mutate).not.toHaveBeenCalled()
  })

  it('syncs an empty list when the last reminder is removed', () => {
    const editor = makeEditor(
      makeDoc([{ type: 'reminder', attrs: reminderAttrs('11111111-1111-1111-1111-111111111111') }]),
    )

    renderHook(() => useReminderSync(editor as unknown as Editor, 'page-1'))
    editor.state.doc = makeDoc([{ type: 'paragraph' }])

    act(() => editor.emitUpdate())
    act(() => vi.advanceTimersByTime(1_000))

    expect(mocks.mutate).toHaveBeenCalledWith(
      { pageId: 'page-1', reminders: [] },
      expect.anything(),
    )
  })

  it('retries the same reminder snapshot after a failed sync', () => {
    const editor = makeEditor(makeDoc([{ type: 'paragraph' }]))
    mocks.mutate.mockImplementation((_input, options?: { onError?: () => void }) => {
      options?.onError?.()
    })

    renderHook(() => useReminderSync(editor as unknown as Editor, 'page-1'))
    editor.state.doc = makeDoc([
      { type: 'reminder', attrs: reminderAttrs('11111111-1111-1111-1111-111111111111') },
    ])

    act(() => editor.emitUpdate())
    act(() => vi.advanceTimersByTime(1_000))
    act(() => editor.emitUpdate())
    act(() => vi.advanceTimersByTime(1_000))

    expect(mocks.mutate).toHaveBeenCalledTimes(2)
  })
})

describe('collectReminderInputs', () => {
  it('skips reminder nodes without an id or dueAt', () => {
    const fakeDoc: DocLike = {
      descendants(visit) {
        visit({ type: { name: 'paragraph' }, attrs: {} })
        visit({ type: { name: 'reminder' }, attrs: { id: '', dueAt: '2026-01-01T00:00:00Z' } })
        visit({ type: { name: 'reminder' }, attrs: { id: 'r1', dueAt: '' } })
        visit({
          type: { name: 'reminder' },
          attrs: {
            id: 'r2',
            dueAt: '2026-06-01T00:00:00Z',
            offsets: [0],
            audience: 'ME',
            label: 'x',
            recipients: [],
            doneAt: null,
          },
        })
      },
    }
    expect(collectReminderInputs(fakeDoc)).toEqual([
      {
        id: 'r2',
        dueAt: '2026-06-01T00:00:00Z',
        offsets: [0],
        audience: 'ME',
        label: 'x',
        recipients: [],
        doneAt: null,
      },
    ])
  })
})
