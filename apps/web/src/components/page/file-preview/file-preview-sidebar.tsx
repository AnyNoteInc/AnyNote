// apps/web/src/components/page/file-preview/file-preview-sidebar.tsx
'use client'

import { useEffect, useRef } from 'react'

import { Box, Collapse } from '@repo/ui/components'

import { PanelResizeHandle } from '@/components/workspace/panel-resize-handle'

import { FILE_PREVIEW_MIN_WIDTH, useFilePreview } from './file-preview-context'
import { FilePreviewContent, previewContentKey } from './file-preview-content'
import { FilePreviewHeader } from './file-preview-header'

/** Докованная сплит-панель (спека §4): flex-сосед контента страницы, справа,
 *  как PageChatSidebar. Живой ресайз — императивно (style.width), коммит — в
 *  контекст + localStorage. */
export function FilePreviewSidebar() {
  const ctx = useFilePreview()
  const panelRef = useRef<HTMLDivElement | null>(null)
  const shown = Boolean(ctx?.payload) && ctx?.effectiveMode === 'split'
  const close = ctx?.close

  // Esc в сплите закрывает просмотр (Esc фуллскрина обрабатывает Dialog).
  useEffect(() => {
    if (!shown || !close) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [shown, close])

  if (!ctx) return null
  const maxWidth =
    typeof window === 'undefined'
      ? 900
      : Math.max(FILE_PREVIEW_MIN_WIDTH, Math.round(window.innerWidth * 0.7))

  return (
    <Collapse
      in={shown}
      orientation="horizontal"
      unmountOnExit
      sx={{
        flexShrink: 0,
        height: '100%',
        position: 'relative',
        zIndex: 10,
        '& .MuiCollapse-wrapper, & .MuiCollapse-wrapperInner': { height: '100%' },
      }}
    >
      <Box
        ref={panelRef}
        data-testid="file-preview-sidebar"
        style={{ width: ctx.sidebarWidth }}
        sx={{
          bgcolor: 'background.default',
          borderLeft: 1,
          borderColor: 'divider',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          position: 'relative',
          contain: 'layout style',
        }}
      >
        {ctx.payload ? (
          <>
            <FilePreviewHeader payload={ctx.payload} />
            <FilePreviewContent key={previewContentKey(ctx.payload)} payload={ctx.payload} />
          </>
        ) : null}
        <PanelResizeHandle
          edge="left"
          width={ctx.sidebarWidth}
          min={FILE_PREVIEW_MIN_WIDTH}
          max={maxWidth}
          onWidth={(next) => {
            panelRef.current?.style.setProperty('width', `${next}px`)
          }}
          onCommit={ctx.commitSidebarWidth}
          ariaLabel="Изменить ширину просмотра"
          testId="file-preview-sidebar-resize"
        />
      </Box>
    </Collapse>
  )
}
