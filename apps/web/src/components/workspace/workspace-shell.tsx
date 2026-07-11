'use client'

import { useRef, useState, type CSSProperties, type ReactNode } from 'react'

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
  /** Final width on drag end — persist here. Presence enables the handle. */
  readonly onSidebarWidthCommit?: (width: number) => void
}

export function WorkspaceShell({
  sidebar,
  main,
  mode,
  sidebarWidth = SIDEBAR_WIDTH,
  onSidebarWidthCommit,
}: Props) {
  // The show/hide animation must not fight the drag: while resizing, the live
  // width is written straight to the CSS variable every frame and the 150ms
  // ease would rubber-band.
  const [resizing, setResizing] = useState(false)
  const gridRef = useRef<HTMLDivElement>(null)
  const resizable = Boolean(onSidebarWidthCommit)

  return (
    <Box
      ref={gridRef}
      // Live drag writes this variable imperatively (no React state per frame);
      // the committed width re-renders it to the same value on drag end.
      style={{ '--ws-sidebar-w': `${sidebarWidth}px` } as CSSProperties}
      sx={{
        display: 'grid',
        gridTemplateColumns: mode === 'hidden' ? '1fr' : 'var(--ws-sidebar-w) minmax(0, 1fr)',
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
          sx={{
            height: '100%',
            minHeight: 0,
            display: 'flex',
            position: 'relative',
            contain: 'layout style',
          }}
        >
          {sidebar}
          {resizable ? (
            <PanelResizeHandle
              edge="right"
              width={sidebarWidth}
              min={SIDEBAR_MIN_WIDTH}
              max={SIDEBAR_MAX_WIDTH}
              onDragStart={() => setResizing(true)}
              onWidth={(next) => {
                gridRef.current?.style.setProperty('--ws-sidebar-w', `${next}px`)
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
