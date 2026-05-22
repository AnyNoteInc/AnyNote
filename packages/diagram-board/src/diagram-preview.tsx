'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Box, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import RemoveIcon from '@mui/icons-material/Remove'
import FitScreenIcon from '@mui/icons-material/FitScreen'
import DownloadIcon from '@mui/icons-material/Download'
import ImageIcon from '@mui/icons-material/Image'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { TransformWrapper, TransformComponent, type ReactZoomPanPinchRef } from 'react-zoom-pan-pinch'
import type * as Y from 'yjs'

import { downloadFilename, svgStringToDataUrl, svgToPngBlob, triggerDownload } from './export'
import type { ColorMode, DiagramRenderer } from './render-types'

type Props = {
  ytext: Y.Text
  mode: ColorMode
  render: DiagramRenderer
  idPrefix: string
}

export function DiagramPreview({ ytext, mode, render, idPrefix }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef<ReactZoomPanPinchRef>(null)
  const [error, setError] = useState<string | null>(null)
  const lastGoodSvg = useRef<string>('')
  const lastSource = useRef<string | null>(null)
  const genRef = useRef(0)

  const draw = useCallback(
    async (source: string) => {
      if (source === lastSource.current) return // skip no-op updates (remote sync, undo-to-same)
      lastSource.current = source
      const gen = ++genRef.current
      const id = `${idPrefix}-svg-${Math.random().toString(36).slice(2)}`
      const result = await render(id, source, mode)
      if (genRef.current !== gen) return // superseded by a newer render
      if (result.ok) {
        setError(null)
        lastGoodSvg.current = result.svg
        if (containerRef.current) containerRef.current.innerHTML = result.svg
      } else {
        setError(result.error)
      }
    },
    [mode, render, idPrefix],
  )

  useEffect(() => {
    lastSource.current = null // force a render on (re)subscribe and on mode change
    let timer: number | null = null
    const schedule = () => {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => void draw(ytext.toString()), 300)
    }
    void draw(ytext.toString()) // initial
    ytext.observe(schedule)
    return () => {
      ytext.unobserve(schedule)
      if (timer) window.clearTimeout(timer)
    }
  }, [ytext, draw])

  const currentSvgEl = () => containerRef.current?.querySelector('svg') ?? null

  const renderPngBlob = async (): Promise<Blob | null> => {
    const svgEl = currentSvgEl()
    if (!svgEl || !lastGoodSvg.current) return null
    const rect = svgEl.getBoundingClientRect()
    return svgToPngBlob(lastGoodSvg.current, rect.width, rect.height)
  }

  const exportSvg = () => {
    if (!lastGoodSvg.current) return
    triggerDownload(svgStringToDataUrl(lastGoodSvg.current), downloadFilename(idPrefix, 'svg'))
  }

  const exportPng = async () => {
    const blob = await renderPngBlob()
    if (!blob) return
    const url = URL.createObjectURL(blob)
    triggerDownload(url, downloadFilename(idPrefix, 'png'))
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  const copyPng = async () => {
    const blob = await renderPngBlob()
    if (!blob) return
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
  }

  return (
    <Box sx={{ position: 'relative', height: '100%', width: '100%', overflow: 'hidden' }}>
      <Stack
        direction="row"
        spacing={0.5}
        sx={{ position: 'absolute', top: 8, right: 8, zIndex: 2, bgcolor: 'background.paper', borderRadius: 1, boxShadow: 1, p: 0.5 }}
      >
        <Tooltip title="Уменьшить">
          <IconButton size="small" onClick={() => zoomRef.current?.zoomOut()}><RemoveIcon fontSize="small" /></IconButton>
        </Tooltip>
        <Tooltip title="Увеличить">
          <IconButton size="small" onClick={() => zoomRef.current?.zoomIn()}><AddIcon fontSize="small" /></IconButton>
        </Tooltip>
        <Tooltip title="По размеру">
          <IconButton size="small" onClick={() => zoomRef.current?.resetTransform()}><FitScreenIcon fontSize="small" /></IconButton>
        </Tooltip>
        <Tooltip title="Скачать SVG">
          <IconButton size="small" onClick={exportSvg} data-testid={`${idPrefix}-export-svg`}><DownloadIcon fontSize="small" /></IconButton>
        </Tooltip>
        <Tooltip title="Скачать PNG">
          <IconButton size="small" onClick={() => void exportPng()}><ImageIcon fontSize="small" /></IconButton>
        </Tooltip>
        <Tooltip title="Копировать PNG">
          <IconButton size="small" onClick={() => void copyPng()}><ContentCopyIcon fontSize="small" /></IconButton>
        </Tooltip>
      </Stack>

      <TransformWrapper ref={zoomRef} minScale={0.2} maxScale={5} centerOnInit limitToBounds={false}>
        <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }} contentStyle={{ width: '100%', height: '100%' }}>
          <Box
            ref={containerRef}
            data-testid={`${idPrefix}-preview`}
            sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2, '& svg': { maxWidth: 'none' } }}
          />
        </TransformComponent>
      </TransformWrapper>

      {error && (
        <Box
          data-testid={`${idPrefix}-error`}
          sx={{ position: 'absolute', bottom: 8, left: 8, right: 8, zIndex: 2, bgcolor: 'error.main', color: 'error.contrastText', borderRadius: 1, p: 1 }}
        >
          <Typography variant="caption" sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>{error}</Typography>
        </Box>
      )}
    </Box>
  )
}
