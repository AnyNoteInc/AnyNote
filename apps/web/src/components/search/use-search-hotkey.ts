'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

import { isMac } from '@/lib/platform'

import { useSettingsDialog } from '@/components/workspace/settings/settings-dialog-provider'

import { useSearchDialog } from './search-dialog-provider'

type WorkspaceHotkeyHandlers = {
  onPages?: () => void
}

export function useSearchHotkey(workspaceId: string, handlers: WorkspaceHotkeyHandlers = {}) {
  const { open } = useSearchDialog()
  const settings = useSettingsDialog()
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
      if (key === 'p') {
        event.preventDefault()
        router.push(`/workspaces/${workspaceId}/chats/new`)
        return
      }
      if (key === 'd') {
        event.preventDefault()
        handlers.onPages?.()
        return
      }
      if (event.key === ',') {
        event.preventDefault()
        settings.open('general')
      }
    }

    globalThis.addEventListener('keydown', handler, { capture: true })
    return () => globalThis.removeEventListener('keydown', handler, { capture: true })
  }, [handlers, open, router, settings, workspaceId])
}
