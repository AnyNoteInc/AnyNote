import { describe, expect, it } from 'vitest'

import { getDrawioClickTarget } from './drawio-interaction'

describe('getDrawioClickTarget', () => {
  it('opens the draw.io editor on click when the Tiptap editor is editable', () => {
    expect(getDrawioClickTarget({ isEditable: true })).toBe('editor')
  })

  it('opens the viewer on click when the Tiptap editor is read-only', () => {
    expect(getDrawioClickTarget({ isEditable: false })).toBe('viewer')
  })
})
