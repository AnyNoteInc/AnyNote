'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Box, CircularProgress } from '@mui/material'
import { useTheme } from '@mui/material/styles'

import { useDiagramYjs } from './use-diagram-yjs'
import { DiagramSourceEditor } from './source-editor'
import { DiagramPreview } from './diagram-preview'
import type { DiagramBoardProps, DiagramConfig } from './types'

export function DiagramBoardInner({
  config,
  pageId,
  yjsUrl,
  yjsToken,
  initialContentYjs,
  user,
  editable = true,
  className,
}: DiagramBoardProps & { config: DiagramConfig }) {
  const theme = useTheme()
  const mode = theme.palette.mode
  const resources = useDiagramYjs({ pageId, yjsUrl, yjsToken, initialContentYjs, docName: config.docName })

  // Publish this user's identity so collaborators see name/color on the Monaco
  // cursor. Depend on primitive fields, not the `user` object (built inline upstream).
  const userName = user?.name
  const userColor = user?.color
  useEffect(() => {
    if (!resources || !userName || !userColor) return
    resources.provider.awareness?.setLocalStateField('user', { name: userName, color: userColor })
  }, [resources, userName, userColor])

  const wrapRef = useRef<HTMLDivElement>(null)
  const [leftPct, setLeftPct] = useState(30)
  // Divider drag: window listeners only for the gesture (AbortController signal),
  // with Escape/blur fallbacks + rAF throttle, torn down on unmount.
  const stopDragRef = useRef<(() => void) | null>(null)
  const rafRef = useRef<number | null>(null)

  const startDrag = useCallback(() => {
    if (stopDragRef.current) return
    const ctrl = new AbortController()
    const stop = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      ctrl.abort()
      stopDragRef.current = null
    }
    stopDragRef.current = stop
    const { signal } = ctrl
    window.addEventListener(
      'mousemove',
      (e) => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(() => {
          if (!wrapRef.current) return
          const rect = wrapRef.current.getBoundingClientRect()
          const pct = ((e.clientX - rect.left) / rect.width) * 100
          setLeftPct(Math.min(70, Math.max(15, pct)))
        })
      },
      { signal },
    )
    window.addEventListener('mouseup', stop, { signal })
    window.addEventListener('blur', stop, { signal })
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape') stop()
      },
      { signal },
    )
  }, [])

  useEffect(() => () => stopDragRef.current?.(), [])

  if (!resources) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box ref={wrapRef} className={className} sx={{ display: 'flex', height: '100%', width: '100%', minHeight: 0 }}>
      <Box sx={{ width: `${leftPct}%`, minWidth: 0, borderRight: 1, borderColor: 'divider' }}>
        <DiagramSourceEditor
          ytext={resources.ytext}
          provider={resources.provider}
          mode={mode}
          editable={editable}
          languageId={config.languageId}
          registerLanguage={config.registerLanguage}
          placeholder={config.placeholder}
        />
      </Box>
      <Box
        role="separator"
        aria-orientation="vertical"
        aria-label="Изменить ширину панелей"
        onMouseDown={startDrag}
        data-testid={`${config.idPrefix}-divider`}
        sx={{ width: '6px', cursor: 'col-resize', flexShrink: 0, bgcolor: 'divider', '&:hover': { bgcolor: 'primary.main' } }}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <DiagramPreview ytext={resources.ytext} mode={mode} render={config.render} idPrefix={config.idPrefix} />
      </Box>
    </Box>
  )
}
