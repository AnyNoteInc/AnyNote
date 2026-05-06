'use client'

import { useEffect } from 'react'

// Capture-phase listener so Escape closes the dialog before TipTap suggestion
// menus or other inner components can swallow it. MUI Dialog's own onClose
// fires in the bubble phase and runs too late for editor extensions.
export function useSearchDialogEscapeGuard(onClose: () => void) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return

      event.preventDefault()
      event.stopImmediatePropagation()
      onClose()
    }

    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [onClose])
}
