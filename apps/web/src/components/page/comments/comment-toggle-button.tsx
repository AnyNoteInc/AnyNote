'use client'

import { Badge, CommentIcon, IconButton, Tooltip } from '@repo/ui/components'

import { usePageCommentsContext } from './comments-context'

export function CommentToggleButton() {
  const { enabled, activeCount, panelOpen, togglePanel } = usePageCommentsContext()
  if (!enabled) return null
  return (
    <Tooltip title="Комментарии">
      <IconButton
        size="small"
        onClick={togglePanel}
        aria-label="Комментарии"
        aria-pressed={panelOpen}
        sx={{ color: 'text.secondary' }}
      >
        <Badge badgeContent={activeCount} color="primary">
          <CommentIcon sx={{ fontSize: 20 }} />
        </Badge>
      </IconButton>
    </Tooltip>
  )
}
