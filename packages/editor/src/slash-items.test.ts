import { describe, expect, it, vi } from 'vitest'

import { createSlashItems, type SlashMediaHandlers } from './slash-items'

const handlers: SlashMediaHandlers = {
  openDatePopover: vi.fn(),
  openDatetimePopover: vi.fn(),
  openFilePopover: vi.fn(),
  openMarkdownPopover: vi.fn(),
  openPageLinkPopover: vi.fn(),
}

describe('createSlashItems', () => {
  it('uses Tiptap details for the toggle command instead of the legacy toggle node', () => {
    const slashItems = createSlashItems(handlers)
    const ids = slashItems('').map((item) => item.id)

    expect(ids).toContain('details')
    expect(ids).not.toContain('toggle')
  })

  it('does not expose LikeC4 or d2 diagram commands', () => {
    const slashItems = createSlashItems(handlers)

    expect(slashItems('').map((item) => item.id)).not.toEqual(
      expect.arrayContaining(['likec4', 'd2']),
    )
    expect(slashItems('likec4')).toEqual([])
    expect(slashItems('d2')).toEqual([])
  })

  it('groups date, datetime, pageLink and reminder under the inline group', () => {
    const slashItems = createSlashItems(handlers)
    const items = slashItems('')
    const groupOf = (id: string) => items.find((it) => it.id === id)?.group
    expect(groupOf('date')).toBe('inline')
    expect(groupOf('datetime')).toBe('inline')
    expect(groupOf('pageLink')).toBe('inline')
    expect(groupOf('reminder')).toBe('inline')
  })
})
