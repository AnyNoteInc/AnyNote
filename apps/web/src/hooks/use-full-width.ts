"use client"

import { useCallback, useEffect, useState } from "react"

const KEY = (pageId: string) => `anynote.page-full-width.${pageId}`

export function useFullWidth(pageId: string) {
  const [fullWidth, setFullWidthState] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY(pageId))
      setFullWidthState(raw === "true")
    } catch {
      // SSR or localStorage blocked — stay with default
    }
  }, [pageId])

  const setFullWidth = useCallback(
    (next: boolean) => {
      setFullWidthState(next)
      try {
        localStorage.setItem(KEY(pageId), String(next))
      } catch {
        /* ignore */
      }
    },
    [pageId],
  )

  return [fullWidth, setFullWidth] as const
}
