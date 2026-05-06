'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

import { useSearchDialog } from './search-dialog-provider'

export function useSearchHotkey(workspaceId: string) {
  const { open } = useSearchDialog()
  const router = useRouter()

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.repeat) return

      const platform = typeof navigator !== 'undefined' ? navigator.platform : ''
      const isMac = /Mac|iPhone|iPad/.test(platform)
      const key = event.key.toLowerCase()
      const matchSearch =
        key === 'k' &&
        ((isMac && event.metaKey && !event.ctrlKey && !event.altKey) ||
          (!isMac && event.altKey && !event.metaKey && !event.ctrlKey))
      const matchSettings =
        key === 's' &&
        ((isMac && event.metaKey && !event.ctrlKey && !event.altKey) ||
          (!isMac && event.altKey && !event.metaKey && !event.ctrlKey))

      if (!matchSearch && !matchSettings) return
      event.preventDefault()
      if (matchSearch) {
        open()
        return
      }

      router.push(`/workspaces/${workspaceId}/settings`)
    }

    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [open, router, workspaceId])
}
