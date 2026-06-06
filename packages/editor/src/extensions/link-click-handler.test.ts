// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { findClickedLink, shouldOpenLink } from './link-click-handler'

function mouseEvent(props: Partial<MouseEvent>): MouseEvent {
  return { button: 0, metaKey: false, ctrlKey: false, altKey: false, ...props } as MouseEvent
}

describe('shouldOpenLink', () => {
  it('opens on a plain left click in view mode', () => {
    expect(shouldOpenLink(mouseEvent({ button: 0 }), false)).toBe(true)
  })

  it('does not open on a non-left click in view mode', () => {
    expect(shouldOpenLink(mouseEvent({ button: 2 }), false)).toBe(false)
    expect(shouldOpenLink(mouseEvent({ button: 1 }), false)).toBe(false)
  })

  it('does not open on a plain left click in edit mode', () => {
    expect(shouldOpenLink(mouseEvent({ button: 0 }), true)).toBe(false)
  })

  it('opens on a modified click in edit mode', () => {
    expect(shouldOpenLink(mouseEvent({ metaKey: true }), true)).toBe(true)
    expect(shouldOpenLink(mouseEvent({ ctrlKey: true }), true)).toBe(true)
    expect(shouldOpenLink(mouseEvent({ altKey: true }), true)).toBe(true)
  })
})

describe('findClickedLink', () => {
  it('returns the anchor when the target is an anchor inside the root', () => {
    const root = document.createElement('div')
    const anchor = document.createElement('a')
    root.appendChild(anchor)
    expect(findClickedLink(anchor, root)).toBe(anchor)
  })

  it('returns the closest anchor when the target is nested inside one', () => {
    const root = document.createElement('div')
    const anchor = document.createElement('a')
    const inner = document.createElement('span')
    anchor.appendChild(inner)
    root.appendChild(anchor)
    expect(findClickedLink(inner, root)).toBe(anchor)
  })

  it('returns null when the anchor is outside the root', () => {
    const root = document.createElement('div')
    const orphan = document.createElement('a')
    expect(findClickedLink(orphan, root)).toBeNull()
  })

  it('returns null when there is no anchor', () => {
    const root = document.createElement('div')
    const plain = document.createElement('span')
    root.appendChild(plain)
    expect(findClickedLink(plain, root)).toBeNull()
  })
})
