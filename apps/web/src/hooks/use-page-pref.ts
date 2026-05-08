'use client'

import { useCallback, useEffect, useState } from 'react'

type EventDetail<T> = { pageId: string; value: T }

export type UsePagePrefOptions<T> = {
  storageKeyPrefix: string
  eventName: string
  defaultValue: T
  parse: (raw: string | null) => T
  serialize: (value: T) => string
}

// Per-page preference backed by localStorage with a custom in-tab event.
// localStorage's native `storage` event only fires cross-tab, so we dispatch
// a CustomEvent for same-tab subscribers (multiple components reading the
// same pref can stay in sync without polling).
//
// Initial state is the static `defaultValue` rather than a localStorage read
// so the SSR markup matches the first client render. Without that, React
// hits a hydration mismatch on data attributes derived from the pref and
// silently refuses to patch the DOM, leaving the UI permanently stuck on
// the default.
export function usePagePref<T>(
  pageId: string,
  options: UsePagePrefOptions<T>,
): readonly [T, (value: T) => void] {
  const { storageKeyPrefix, eventName, defaultValue, parse, serialize } = options
  const [value, setValueState] = useState<T>(defaultValue)

  useEffect(() => {
    const storageKey = `anynote.${storageKeyPrefix}.${pageId}`
    try {
      setValueState(parse(localStorage.getItem(storageKey)))
    } catch {
      /* ignore */
    }
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<EventDetail<T>>).detail
      if (detail?.pageId === pageId) setValueState(detail.value)
    }
    window.addEventListener(eventName, onChange)
    return () => window.removeEventListener(eventName, onChange)
  }, [pageId, storageKeyPrefix, eventName, parse])

  const setValue = useCallback(
    (next: T) => {
      setValueState(next)
      const storageKey = `anynote.${storageKeyPrefix}.${pageId}`
      try {
        localStorage.setItem(storageKey, serialize(next))
      } catch {
        /* ignore */
      }
      window.dispatchEvent(
        new CustomEvent<EventDetail<T>>(eventName, { detail: { pageId, value: next } }),
      )
    },
    [pageId, storageKeyPrefix, eventName, serialize],
  )

  return [value, setValue] as const
}
