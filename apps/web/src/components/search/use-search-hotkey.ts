'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

import { isMac } from '@/lib/platform'

import { useSearchDialog } from './search-dialog-provider'

export function useSearchHotkey(workspaceId: string) {
  const { open } = useSearchDialog()
  const router = useRouter()

  useEffect(() => {
    const mac = isMac()
    const handler = (event: KeyboardEvent) => {
      if (event.repeat) return

      const modifier =
        (mac && event.metaKey && !event.ctrlKey && !event.altKey) ||
        (!mac && event.altKey && !event.metaKey && !event.ctrlKey)
      if (!modifier) return

      const key = event.key.toLowerCase()
      if (key === 'k') {
        event.preventDefault()
        open()
        return
      }
      if (key === 's') {
        event.preventDefault()
        router.push(`/workspaces/${workspaceId}/settings`)
      }
    }

    globalThis.addEventListener('keydown', handler, { capture: true })
    return () => globalThis.removeEventListener('keydown', handler, { capture: true })
  }, [open, router, workspaceId])
}
