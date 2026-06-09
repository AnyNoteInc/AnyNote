import { describe, expect, it } from 'vitest'

import {
  groupNotifications,
  type InAppItemLike,
} from '@/components/notifications/group-notifications'

function item(id: string, payload?: Record<string, unknown>): InAppItemLike {
  return { id, event: { payload: payload ?? {} } }
}

describe('groupNotifications', () => {
  it('merges consecutive items that share a pageId into one bucket', () => {
    const groups = groupNotifications([
      item('a', { pageId: 'p1' }),
      item('b', { pageId: 'p1' }),
      item('c', { pageId: 'p2' }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0]!.pageId).toBe('p1')
    expect(groups[0]!.items.map((i) => i.id)).toEqual(['a', 'b'])
    expect(groups[1]!.pageId).toBe('p2')
    expect(groups[1]!.items.map((i) => i.id)).toEqual(['c'])
  })

  it('keys a page bucket by pageId (+threadId when present)', () => {
    const groups = groupNotifications([
      item('a', { pageId: 'p1', threadId: 't1' }),
      item('b', { pageId: 'p1', threadId: 't1' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.key).toBe('p1:t1')
    expect(groups[0]!.threadId).toBe('t1')
  })

  it('does NOT merge two different threads on the same page', () => {
    const groups = groupNotifications([
      item('a', { pageId: 'p1', threadId: 't1' }),
      item('b', { pageId: 'p1', threadId: 't2' }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.key)).toEqual(['p1:t1', 'p1:t2'])
  })

  it('a page-level (no-thread) item joins the running page bucket', () => {
    const groups = groupNotifications([
      item('a', { pageId: 'p1', threadId: 't1' }),
      item('b', { pageId: 'p1' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.items.map((i) => i.id)).toEqual(['a', 'b'])
  })

  it('items without a pageId become singleton buckets keyed by id', () => {
    const groups = groupNotifications([
      item('a'),
      item('b', { pageId: 'p1' }),
      item('c'),
    ])
    expect(groups).toHaveLength(3)
    expect(groups[0]!.key).toBe('a')
    expect(groups[0]!.pageId).toBeNull()
    expect(groups[1]!.pageId).toBe('p1')
    expect(groups[2]!.key).toBe('c')
  })

  it('does NOT merge same-page items separated by a different page (order preserved)', () => {
    const groups = groupNotifications([
      item('a', { pageId: 'p1' }),
      item('b', { pageId: 'p2' }),
      item('c', { pageId: 'p1' }),
    ])
    expect(groups.map((g) => g.pageId)).toEqual(['p1', 'p2', 'p1'])
  })

  it('returns an empty array for no items', () => {
    expect(groupNotifications([])).toEqual([])
  })
})
