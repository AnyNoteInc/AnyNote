// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { useSearchHotkey } from '@/components/search/use-search-hotkey'

const mocks = vi.hoisted(() => ({
  openSearch: vi.fn(),
  push: vi.fn(),
}))

vi.mock('@/components/search/search-dialog-provider', () => ({
  useSearchDialog: () => ({ open: mocks.openSearch, close: vi.fn(), isOpen: false }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}))

function setPlatform(platform: string) {
  Object.defineProperty(window.navigator, 'platform', {
    value: platform,
    configurable: true,
  })
}

function dispatchShortcut(init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', {
    key: init.key,
    metaKey: init.metaKey,
    altKey: init.altKey,
    ctrlKey: init.ctrlKey,
    bubbles: true,
    cancelable: true,
  })
  act(() => {
    window.dispatchEvent(event)
  })
  return event
}

describe('useSearchHotkey', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  test('opens search on Command+K for macOS', () => {
    setPlatform('MacIntel')
    renderHook(() => useSearchHotkey('workspace-1'))

    const event = dispatchShortcut({ key: 'k', metaKey: true })

    expect(mocks.openSearch).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(true)
  })

  test('opens workspace settings on Command+S for macOS', () => {
    setPlatform('MacIntel')
    renderHook(() => useSearchHotkey('workspace-1'))

    const event = dispatchShortcut({ key: 's', metaKey: true })

    expect(mocks.push).toHaveBeenCalledWith('/workspaces/workspace-1/settings')
    expect(event.defaultPrevented).toBe(true)
  })

  test('opens workspace settings on Alt+S outside macOS', () => {
    setPlatform('Win32')
    renderHook(() => useSearchHotkey('workspace-1'))

    const event = dispatchShortcut({ key: 's', altKey: true })

    expect(mocks.push).toHaveBeenCalledWith('/workspaces/workspace-1/settings')
    expect(event.defaultPrevented).toBe(true)
  })
})
