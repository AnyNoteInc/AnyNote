'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Box, CircularProgress } from '@mui/material'
import { useTheme } from '@mui/material/styles'

import { useMermaidYjs } from './use-mermaid-yjs'
import { MermaidSourceEditor } from './mermaid-source-editor'
import { MermaidPreview } from './mermaid-preview'
import type { MermaidBoardProps } from './types'

export function MermaidBoardInner({
  pageId,
  yjsUrl,
  yjsToken,
  initialContentYjs,
  user,
  editable = true,
  className,
}: MermaidBoardProps) {
  const theme = useTheme()
  const mode = theme.palette.mode === 'dark' ? 'dark' : 'light'
  const resources = useMermaidYjs({ pageId, yjsUrl, yjsToken, initialContentYjs })

  // Publish this user's identity so collaborators see name/color on the Monaco
  // cursor (y-monaco renders remote selections from the awareness 'user' field).
  useEffect(() => {
    if (!resources || !user) return
    resources.provider.awareness?.setLocalStateField('user', { name: user.name, color: user.color })
  }, [resources, user])

  const wrapRef = useRef<HTMLDivElement>(null)
  const [leftPct, setLeftPct] = useState(30)
  const dragging = useRef(false)

  const onDown = useCallback(() => {
    dragging.current = true
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !wrapRef.current) return
      const rect = wrapRef.current.getBoundingClientRect()
      const pct = ((e.clientX - rect.left) / rect.width) * 100
      setLeftPct(Math.min(70, Math.max(15, pct)))
    }
    const onUp = () => {
      dragging.current = false
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

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
        <MermaidSourceEditor ytext={resources.ytext} provider={resources.provider} mode={mode} editable={editable} />
      </Box>
      <Box
        onMouseDown={onDown}
        data-testid="mermaid-divider"
        sx={{ width: '6px', cursor: 'col-resize', flexShrink: 0, bgcolor: 'divider', '&:hover': { bgcolor: 'primary.main' } }}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <MermaidPreview ytext={resources.ytext} mode={mode} />
      </Box>
    </Box>
  )
}
