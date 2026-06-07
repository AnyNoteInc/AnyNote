'use client'

import { useEffect, useRef } from 'react'
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

  // The capture-phase global listener should be added once; reading the latest
  // values through a ref keeps it from being torn down/re-added on every host
  // re-render (handlers is a fresh literal, settings identity flips on toggle).
  const latest = useRef({ handlers, open, settings, router, workspaceId })
  latest.current = { handlers, open, settings, router, workspaceId }

  useEffect(() => {
    const mac = isMac()
    const handler = (event: KeyboardEvent) => {
      if (event.repeat) return

      const modifier =
        (mac && event.metaKey && !event.ctrlKey && !event.altKey) ||
        (!mac && event.altKey && !event.metaKey && !event.ctrlKey)
      if (!modifier) return

      const current = latest.current
      const key = event.key.toLowerCase()
      if (key === 'k') {
        event.preventDefault()
        current.open()
        return
      }
      if (key === 'p') {
        event.preventDefault()
        current.router.push('/chats/new')
        return
      }
      if (key === 'd') {
        event.preventDefault()
        current.handlers.onPages?.()
        return
      }
      if (event.key === ',') {
        event.preventDefault()
        current.settings.open('general')
      }
    }

    globalThis.addEventListener('keydown', handler, { capture: true })
    return () => globalThis.removeEventListener('keydown', handler, { capture: true })
  }, [])
}
