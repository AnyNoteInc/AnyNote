'use client'

import { useEffect, useRef, useState } from 'react'
import { Box, CircularProgress, MenuItem, Select, Typography } from '@mui/material'
import { LikeC4ModelProvider, ReactLikeC4 } from '@likec4/diagram'
import type { ColorMode } from '@repo/diagram-board/render-types'

import { resolveSelectedViewId, viewLabel, type ViewLike } from './view-utils'

// LikeC4Model.Layouted (from @likec4/core). Typed loosely here to avoid pulling
// the heavy type graph through this component's public surface.
type LayoutedModel = { views(): Iterable<ViewLike> }

type Props = {
  source: string
  mode: ColorMode
  /** data-testid prefix; defaults to 'likec4'. */
  idPrefix?: string
}

/**
 * Parse + layout + render LikeC4 source entirely in the browser. Used by both
 * the page board (via Likec4PagePreview) and the editor code block. Keeps the
 * last good model on parse error and shows an error chip — same resilience as
 * @repo/diagram-board's DiagramPreview.
 */
export function Likec4Diagram({ source, mode, idPrefix = 'likec4' }: Props) {
  const [model, setModel] = useState<LayoutedModel | null>(null)
  const [views, setViews] = useState<ViewLike[]>([])
  const [viewId, setViewId] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const genRef = useRef(0)
  const lastSource = useRef<string | null>(null)
  // Mirror of `views` for event handlers (onNavigateTo) so they never read a stale snapshot.
  const viewsRef = useRef<ViewLike[]>([])

  useEffect(() => {
    const trimmed = source.trim()
    if (trimmed === lastSource.current) return
    lastSource.current = trimmed
    const gen = ++genRef.current

    if (!trimmed) {
      setModel(null)
      setViews([])
      viewsRef.current = []
      setError(null)
      setLoading(false)
      return
    }

    setLoading(true)
    const timer = window.setTimeout(async () => {
      try {
        // Dynamic import keeps the Langium parser + graphviz-wasm out of the
        // initial chunk — only loaded when a diagram actually renders.
        const { fromSource } = await import('@likec4/language-services/browser')
        const likec4 = await fromSource(trimmed)
        const layouted = (await likec4.layoutedModel()) as unknown as LayoutedModel
        if (genRef.current !== gen) return // superseded by a newer source
        const list = [...layouted.views()].map((v) => ({ id: String(v.id), title: v.title }))
        setModel(layouted)
        setViews(list)
        viewsRef.current = list
        setViewId((cur) => resolveSelectedViewId(list, cur))
        setError(null)
      } catch (err) {
        if (genRef.current !== gen) return
        setError(err instanceof Error ? err.message : String(err)) // keep last good model mounted
      } finally {
        if (genRef.current === gen) setLoading(false)
      }
    }, 300)

    return () => window.clearTimeout(timer)
  }, [source])

  return (
    <Box
      data-testid={`${idPrefix}-preview`}
      sx={{ position: 'relative', height: '100%', width: '100%', overflow: 'hidden' }}
    >
      {views.length > 1 && (
        <Select
          size="small"
          value={viewId ?? ''}
          onChange={(e) => setViewId(e.target.value)}
          data-testid={`${idPrefix}-view-select`}
          sx={{
            position: 'absolute',
            top: 8,
            left: 8,
            zIndex: 2,
            bgcolor: 'background.paper',
            minWidth: 160,
          }}
        >
          {views.map((v) => (
            <MenuItem key={v.id} value={v.id}>
              {viewLabel(v)}
            </MenuItem>
          ))}
        </Select>
      )}

      {model && viewId ? (
        <LikeC4ModelProvider likec4model={model as never}>
          <ReactLikeC4
            viewId={viewId as never}
            colorScheme={mode}
            pannable
            zoomable
            keepAspectRatio
            showNavigationButtons
            onNavigateTo={(to) =>
              setViewId((cur) => resolveSelectedViewId(viewsRef.current, String(to)) ?? cur)
            }
            background="dots"
            style={{ width: '100%', height: '100%' }}
          />
        </LikeC4ModelProvider>
      ) : (
        loading && (
          <Box
            sx={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}
          >
            <CircularProgress />
          </Box>
        )
      )}

      {error && (
        <Box
          data-testid={`${idPrefix}-error`}
          sx={{
            position: 'absolute',
            bottom: 8,
            left: 8,
            right: 8,
            zIndex: 3,
            bgcolor: 'error.main',
            color: 'error.contrastText',
            borderRadius: 1,
            p: 1,
          }}
        >
          <Typography variant="caption" sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
            {error}
          </Typography>
        </Box>
      )}
    </Box>
  )
}
