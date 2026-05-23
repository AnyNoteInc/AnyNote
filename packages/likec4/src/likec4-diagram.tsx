'use client'

import { useEffect, useRef, useState } from 'react'
import { Box, CircularProgress, Typography } from '@mui/material'
import { LikeC4ModelProvider, ReactLikeC4 } from '@likec4/diagram'
import type { ColorMode } from '@repo/diagram-board/render-types'

import { formatLikec4Errors, resolveSelectedViewId, type ViewLike } from './view-utils'

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
  const [viewId, setViewId] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const genRef = useRef(0)
  // Latest views list for event handlers (onNavigateTo) so they never read a stale snapshot.
  // ReactLikeC4 renders the diagram and its own view navigation, so no view-picker UI lives here.
  const viewsRef = useRef<ViewLike[]>([])

  useEffect(() => {
    const trimmed = source.trim()
    const gen = ++genRef.current

    if (!trimmed) {
      setModel(null)
      viewsRef.current = []
      setError(null)
      setLoading(false)
      return
    }

    // Debounce: each source change reschedules; the generation counter drops
    // superseded renders. Deliberately NO source-equality short-circuit — under
    // React StrictMode the effect is re-run after a setup/cleanup pair, and a
    // ref-based "same source, skip" guard would clear the scheduled timer on the
    // cleanup and then skip rescheduling, leaving the preview stuck on a spinner.
    setLoading(true)
    const timer = window.setTimeout(async () => {
      try {
        // Dynamic import keeps the Langium parser + graphviz-wasm out of the
        // initial chunk — only loaded when a diagram actually renders.
        const { fromSource } = await import('@likec4/language-services/browser')
        const likec4 = await fromSource(trimmed)
        if (genRef.current !== gen) return // superseded by a newer source

        // fromSource RESOLVES even when the source is invalid (throwIfInvalid
        // defaults to false — it only console-logs), so a parse error never
        // reaches the catch below. Surface it from getErrors() instead: feeding
        // the broken model to layoutedModel()/ReactLikeC4 throws during render
        // and, with no error boundary above, takes down the whole page.
        if (likec4.hasErrors()) {
          setError(formatLikec4Errors(likec4.getErrors()) ?? 'Invalid LikeC4 model') // keep last good model mounted
          return
        }

        const layouted = (await likec4.layoutedModel()) as unknown as LayoutedModel
        if (genRef.current !== gen) return // superseded by a newer source
        const list = [...layouted.views()].map((v) => ({ id: String(v.id), title: v.title }))
        setModel(layouted)
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
      {model && viewId ? (
        <LikeC4ModelProvider likec4model={model as never}>
          <ReactLikeC4
            viewId={viewId as never}
            colorScheme={mode}
            pannable
            zoomable
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
