'use client'

import { useState, type ReactNode } from 'react'

import { Box } from '@repo/ui/components'

import { PanelResizeHandle } from './panel-resize-handle'
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_WIDTH } from './workspace-layout-client'

export type SidebarMode = 'hidden' | 'full'

type Props = {
  readonly sidebar: ReactNode
  readonly main: ReactNode
  readonly mode: SidebarMode
  /** Current sidebar column width; defaults to the classic fixed width. */
  readonly sidebarWidth?: number
  /** Live width while dragging the resize handle. */
  readonly onSidebarWidthChange?: (width: number) => void
  /** Final width on drag end — persist here. */
  readonly onSidebarWidthCommit?: (width: number) => void
}

export function WorkspaceShell({
  sidebar,
  main,
  mode,
  sidebarWidth = SIDEBAR_WIDTH,
  onSidebarWidthChange,
  onSidebarWidthCommit,
}: Props) {
  const columns = mode === 'hidden' ? '1fr' : `${sidebarWidth}px minmax(0, 1fr)`
  // The show/hide animation must not fight the drag: while resizing, width
  // updates every pointer move and the 150ms ease would rubber-band.
  const [resizing, setResizing] = useState(false)
  const resizable = Boolean(onSidebarWidthChange && onSidebarWidthCommit)

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: columns,
        height: '100vh',
        bgcolor: 'background.default',
        color: 'text.primary',
        overflow: 'hidden',
        transition: resizing ? 'none' : 'grid-template-columns 150ms ease',
      }}
    >
      {mode === 'hidden' ? null : (
        <Box
          className="workspace-sidebar"
          sx={{ height: '100%', minHeight: 0, display: 'flex', position: 'relative' }}
        >
          {sidebar}
          {resizable ? (
            <PanelResizeHandle
              edge="right"
              width={sidebarWidth}
              min={SIDEBAR_MIN_WIDTH}
              max={SIDEBAR_MAX_WIDTH}
              onWidth={(next) => {
                setResizing(true)
                onSidebarWidthChange?.(next)
              }}
              onCommit={(final) => {
                setResizing(false)
                onSidebarWidthCommit?.(final)
              }}
              ariaLabel="Изменить ширину сайдбара"
              testId="workspace-sidebar-resize"
            />
          ) : null}
        </Box>
      )}
      <Box component="main" sx={{ overflow: 'auto' }}>
        {main}
      </Box>
    </Box>
  )
}
