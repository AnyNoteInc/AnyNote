import { describe, expect, it, vi } from 'vitest'

import { createSlashItems, type SlashMediaHandlers } from './slash-items'

const handlers: SlashMediaHandlers = {
  openDatePopover: vi.fn(),
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
})
