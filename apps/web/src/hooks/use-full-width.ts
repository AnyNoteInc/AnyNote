'use client'

import { useCallback, useEffect, useState } from 'react'

const KEY = (pageId: string) => `anynote.page-full-width.${pageId}`
const EVENT = 'anynote:full-width-change'

type EventDetail = { pageId: string; value: boolean }

function readStored(pageId: string): boolean {
  try {
    return localStorage.getItem(KEY(pageId)) === 'true'
  } catch {
    return false
  }
}

// localStorage's `storage` event only fires cross-tab. We dispatch a custom
// event on same-tab writes so subscribers in other components (e.g. the
// workspace layout) can react without polling.
export function useFullWidth(pageId: string) {
  const [fullWidth, setFullWidthState] = useState(() => readStored(pageId))

  useEffect(() => {
    setFullWidthState(readStored(pageId))
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<EventDetail>).detail
      if (detail?.pageId === pageId) setFullWidthState(detail.value)
    }
    window.addEventListener(EVENT, onChange)
    return () => window.removeEventListener(EVENT, onChange)
  }, [pageId])

  const setFullWidth = useCallback(
    (next: boolean) => {
      setFullWidthState(next)
      try {
        localStorage.setItem(KEY(pageId), String(next))
      } catch {
        /* ignore */
      }
      window.dispatchEvent(new CustomEvent<EventDetail>(EVENT, { detail: { pageId, value: next } }))
    },
    [pageId],
  )

  return [fullWidth, setFullWidth] as const
}
