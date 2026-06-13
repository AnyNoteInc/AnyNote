import { describe, expect, it, vi } from 'vitest'

import { createSlashItems, type SlashMediaHandlers } from './slash-items'

const handlers: SlashMediaHandlers = {
  openDatePopover: vi.fn(),
  openDatetimePopover: vi.fn(),
  openFilePopover: vi.fn(),
  openMediaPopover: vi.fn(),
  openMarkdownPopover: vi.fn(),
  openPageLinkPopover: vi.fn(),
  openBookmarkPopover: vi.fn(),
  openEmbedPopover: vi.fn(),
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

  it('exposes video and audio under the media group, wired to openMediaPopover', () => {
    const openMediaPopover = vi.fn()
    const slashItems = createSlashItems({ ...handlers, openMediaPopover })
    const items = slashItems('')
    const video = items.find((it) => it.id === 'video')
    const audio = items.find((it) => it.id === 'audio')
    expect(video?.group).toBe('media')
    expect(audio?.group).toBe('media')

    const range = { from: 1, to: 2 }
    video?.run({ editor: {} as never, range })
    audio?.run({ editor: {} as never, range })
    expect(openMediaPopover).toHaveBeenCalledWith(range, 'video')
    expect(openMediaPopover).toHaveBeenCalledWith(range, 'audio')
  })

  it('finds video and audio by keyword', () => {
    const slashItems = createSlashItems(handlers)
    expect(slashItems('видео').map((it) => it.id)).toContain('video')
    expect(slashItems('mp3').map((it) => it.id)).toContain('audio')
  })

  it('exposes bookmark and embed under the embedding group, wired to their popovers', () => {
    const openBookmarkPopover = vi.fn()
    const openEmbedPopover = vi.fn()
    const slashItems = createSlashItems({ ...handlers, openBookmarkPopover, openEmbedPopover })
    const items = slashItems('')
    const bookmark = items.find((it) => it.id === 'bookmark')
    const embed = items.find((it) => it.id === 'embed')
    expect(bookmark?.group).toBe('embedding')
    expect(embed?.group).toBe('embedding')

    const range = { from: 1, to: 2 }
    bookmark?.run({ editor: {} as never, range })
    embed?.run({ editor: {} as never, range })
    expect(openBookmarkPopover).toHaveBeenCalledWith(range)
    expect(openEmbedPopover).toHaveBeenCalledWith(range)
  })

  it('finds bookmark and embed by keyword', () => {
    const slashItems = createSlashItems(handlers)
    expect(slashItems('закладка').map((it) => it.id)).toContain('bookmark')
    expect(slashItems('youtube').map((it) => it.id)).toContain('embed')
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
