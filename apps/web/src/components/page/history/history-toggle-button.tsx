'use client'

import { HistoryIcon, IconButton, Tooltip } from '@repo/ui/components'

import { usePageHistoryContext } from './history-context'

export function HistoryToggleButton() {
  const { enabled, panelOpen, togglePanel } = usePageHistoryContext()
  if (!enabled) return null
  return (
    <Tooltip title="История">
      <IconButton
        size="small"
        onClick={togglePanel}
        aria-label="История"
        aria-pressed={panelOpen}
        sx={{ color: 'text.secondary' }}
      >
        <HistoryIcon sx={{ fontSize: 20 }} />
      </IconButton>
    </Tooltip>
  )
}
