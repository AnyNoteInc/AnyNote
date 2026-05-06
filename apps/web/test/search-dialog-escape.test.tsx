// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { useSearchDialogEscapeGuard } from '@/components/search/use-search-dialog-escape-guard'

function dispatchEscape() {
  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  })
  act(() => {
    window.dispatchEvent(event)
  })
  return event
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

test('prevents Escape from reaching the browser while closing search dialog', () => {
  const onClose = vi.fn()
  renderHook(() => useSearchDialogEscapeGuard(onClose))

  const event = dispatchEscape()

  expect(onClose).toHaveBeenCalledOnce()
  expect(event.defaultPrevented).toBe(true)
})
