// apps/web/src/components/page/file-preview/zoom-pan-viewport.tsx
'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import {
  Box,
  FitScreenIcon,
  IconButton,
  Paper,
  Tooltip,
  ZoomInIcon,
  ZoomOutIcon,
} from '@repo/ui/components'

const MIN_SCALE = 0.2
const MAX_SCALE = 8

type Transform = { scale: number; tx: number; ty: number }
const IDENTITY: Transform = { scale: 1, tx: 0, ty: 0 }

type Props = {
  children: ReactNode
  /** Масштаб «100%» (naturalWidth / отображаемая ширина при fit). Null пока
   *  неизвестен (картинка не загрузилась) — кнопка 1:1 скрыта. */
  getNaturalScale?: () => number | null
}

/** Зум колесом (к курсору), пан драгом, кнопки −/+/вписать/1:1, dblclick —
 *  toggle вписать↔увеличить. Identity-масштаб = «вписать»: контент внутри
 *  центрирован и ограничен maxWidth/maxHeight 100%. */
export function ZoomPanViewport({ children, getNaturalScale }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [t, setT] = useState<Transform>(IDENTITY)
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)

  const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    setT((prev) => {
      const rect = containerRef.current?.getBoundingClientRect()
      const px = cx ?? (rect ? rect.width / 2 : 0)
      const py = cy ?? (rect ? rect.height / 2 : 0)
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale * factor))
      const k = scale / prev.scale
      return { scale, tx: px - k * (px - prev.tx), ty: py - k * (py - prev.ty) }
    })
  }, [])

  // Колесо должно гасить прокрутку страницы; React onWheel — passive, поэтому
  // вешаем нативный слушатель.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      zoomAt(Math.exp(-e.deltaY * 0.002), e.clientX - rect.left, e.clientY - rect.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  const naturalScale = () => {
    const natural = getNaturalScale?.()
    if (!natural || !Number.isFinite(natural)) return
    setT({ scale: clampScale(natural), tx: 0, ty: 0 })
  }

  const isIdentity = t.scale === 1 && t.tx === 0 && t.ty === 0

  return (
    <Box
      ref={containerRef}
      data-testid="zoom-pan-viewport"
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('[data-zoom-toolbar]')) return
        dragRef.current = { x: e.clientX, y: e.clientY, tx: t.tx, ty: t.ty }
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          // synthetic events without an active pointer — drag still works
        }
      }}
      onPointerMove={(e) => {
        const drag = dragRef.current
        if (!drag) return
        setT((prev) => ({
          ...prev,
          tx: drag.tx + (e.clientX - drag.x),
          ty: drag.ty + (e.clientY - drag.y),
        }))
      }}
      onPointerUp={(e) => {
        dragRef.current = null
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId)
        }
      }}
      onPointerCancel={() => {
        dragRef.current = null
      }}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('[data-zoom-toolbar]')) return
        if (isIdentity) {
          const rect = containerRef.current?.getBoundingClientRect()
          zoomAt(
            2,
            rect ? e.clientX - rect.left : undefined,
            rect ? e.clientY - rect.top : undefined,
          )
        } else {
          setT(IDENTITY)
        }
      }}
      sx={{
        position: 'relative',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        cursor: 'grab',
        touchAction: 'none',
        '&:active': { cursor: 'grabbing' },
      }}
    >
      <Box
        sx={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: `translate(${t.tx}px, ${t.ty}px) scale(${t.scale})`,
          transformOrigin: '0 0',
        }}
      >
        {children}
      </Box>
      <Paper
        data-zoom-toolbar
        elevation={3}
        sx={{
          position: 'absolute',
          bottom: 12,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: 0.25,
          px: 0.5,
          py: 0.25,
          borderRadius: 2,
        }}
      >
        <Tooltip title="Уменьшить">
          <IconButton size="small" onClick={() => zoomAt(1 / 1.25)}>
            <ZoomOutIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Увеличить">
          <IconButton size="small" onClick={() => zoomAt(1.25)}>
            <ZoomInIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Вписать">
          <IconButton size="small" onClick={() => setT(IDENTITY)}>
            <FitScreenIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        {getNaturalScale ? (
          <Tooltip title="100%">
            <IconButton
              size="small"
              onClick={naturalScale}
              sx={{ fontSize: 11, fontWeight: 700, width: 32, borderRadius: 1 }}
            >
              1:1
            </IconButton>
          </Tooltip>
        ) : null}
      </Paper>
    </Box>
  )
}
