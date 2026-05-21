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

import { renderMermaid } from './render-mermaid'
import { downloadFilename, svgStringToDataUrl, svgToPngBlob, triggerDownload } from './export'
import type { ColorMode } from './mermaid-theme'

type Props = {
  ytext: Y.Text
  mode: ColorMode
}

export function MermaidPreview({ ytext, mode }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef<ReactZoomPanPinchRef>(null)
  const [error, setError] = useState<string | null>(null)
  const lastGoodSvg = useRef<string>('')

  const draw = useCallback(
    async (source: string) => {
      const id = `mermaid-svg-${Math.random().toString(36).slice(2)}`
      const result = await renderMermaid(id, source, mode)
      if (result.ok) {
        setError(null)
        lastGoodSvg.current = result.svg
        if (containerRef.current) containerRef.current.innerHTML = result.svg
      } else {
        setError(result.error)
      }
    },
    [mode],
  )

  useEffect(() => {
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

  const exportSvg = () => {
    if (!lastGoodSvg.current) return
    triggerDownload(svgStringToDataUrl(lastGoodSvg.current), downloadFilename('svg'))
  }

  const exportPng = async () => {
    const svgEl = currentSvgEl()
    if (!svgEl || !lastGoodSvg.current) return
    const rect = svgEl.getBoundingClientRect()
    const blob = await svgToPngBlob(lastGoodSvg.current, rect.width, rect.height)
    triggerDownload(URL.createObjectURL(blob), downloadFilename('png'))
  }

  const copyPng = async () => {
    const svgEl = currentSvgEl()
    if (!svgEl || !lastGoodSvg.current) return
    const rect = svgEl.getBoundingClientRect()
    const blob = await svgToPngBlob(lastGoodSvg.current, rect.width, rect.height)
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
          <IconButton size="small" onClick={exportSvg} data-testid="mermaid-export-svg"><DownloadIcon fontSize="small" /></IconButton>
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
            data-testid="mermaid-preview"
            sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2, '& svg': { maxWidth: 'none' } }}
          />
        </TransformComponent>
      </TransformWrapper>

      {error && (
        <Box
          data-testid="mermaid-error"
          sx={{ position: 'absolute', bottom: 8, left: 8, right: 8, zIndex: 2, bgcolor: 'error.main', color: 'error.contrastText', borderRadius: 1, p: 1 }}
        >
          <Typography variant="caption" sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>{error}</Typography>
        </Box>
      )}
    </Box>
  )
}
