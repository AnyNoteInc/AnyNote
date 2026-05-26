'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { Editor } from '@repo/editor'
import { Box, Tooltip, Typography } from '@repo/ui/components'

import type { OutlineMode } from '@/hooks/use-outline-mode'

const SCROLL_CONTAINER_CLASS = 'page-content-scroll'
const ACTIVE_OFFSET_PX = 96
// Smooth scroll typically settles in 200–400ms. Wait beyond that before
// placing the editor cursor — focusing earlier dispatches the browser's
// "scroll into view on focus" which interrupts the smooth animation and
// leaves the page parked at the wrong position.
const FOCUS_DEFER_MS = 450

const LEVEL_INDENT_PX: Record<1 | 2 | 3, number> = {
  1: 0,
  2: 14,
  3: 28,
}

const MINI_BAR_WIDTH_PX: Record<1 | 2 | 3, number> = {
  1: 48,
  2: 36,
  3: 24,
}

type Heading = {
  level: 1 | 2 | 3
  text: string
  pos: number
}

function extractHeadings(editor: Editor): Heading[] {
  const items: Heading[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return true
    const level = node.attrs.level as number
    if (level === 1 || level === 2 || level === 3) {
      items.push({
        level: level as 1 | 2 | 3,
        text: node.textContent.trim(),
        pos,
      })
    }
    return true
  })
  return items
}

function sameHeadings(a: Heading[], b: Heading[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (x.pos !== y.pos || x.level !== y.level || x.text !== y.text) return false
  }
  return true
}

function getScrollContainer(editor: Editor): HTMLElement | null {
  const el = editor.view.dom.closest(`.${SCROLL_CONTAINER_CLASS}`)
  return el instanceof HTMLElement ? el : null
}

type Props = {
  editor: Editor | null
  mode: OutlineMode
  // Extra px to shift the outline left from the right edge (e.g. when the
  // comments sidebar is open, so the fixed outline clears the panel).
  rightOffset?: number
}

export function EditorOutline({ editor, mode, rightOffset = 0 }: Props) {
  const [headings, setHeadings] = useState<Heading[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const scrollContainerRef = useRef<HTMLElement | null>(null)
  // Cached query of the editor's heading DOM nodes. Refreshed only when the
  // outline structure actually changes; the scroll handler reads it on every
  // frame and shouldn't pay for a fresh querySelectorAll each time.
  const domHeadingsRef = useRef<HTMLElement[]>([])

  useEffect(() => {
    if (!editor || mode === 'off') {
      setHeadings([])
      domHeadingsRef.current = []
      return
    }
    const sync = () => {
      const next = extractHeadings(editor)
      setHeadings((prev) => (sameHeadings(prev, next) ? prev : next))
      domHeadingsRef.current = Array.from(
        editor.view.dom.querySelectorAll<HTMLElement>('h1, h2, h3'),
      )
    }
    sync()
    editor.on('update', sync)
    return () => {
      editor.off('update', sync)
    }
  }, [editor, mode])

  useEffect(() => {
    if (!editor || mode === 'off') {
      setActiveIndex(0)
      return
    }
    const container = getScrollContainer(editor)
    if (!container) return

    let raf: number | null = null
    const compute = () => {
      raf = null
      const all = domHeadingsRef.current
      if (all.length === 0) {
        setActiveIndex(0)
        return
      }
      const threshold = container.getBoundingClientRect().top + ACTIVE_OFFSET_PX
      let active = 0
      for (let i = 0; i < all.length; i++) {
        const el = all[i]
        if (!el) continue
        if (el.getBoundingClientRect().top - threshold <= 1) {
          active = i
        } else {
          break
        }
      }
      setActiveIndex(active)
    }
    const onScroll = () => {
      if (raf !== null) return
      raf = window.requestAnimationFrame(compute)
    }
    compute()
    container.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      container.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (raf !== null) window.cancelAnimationFrame(raf)
    }
  }, [editor, mode])

  // Keep the active item visible inside the outline's own scroll viewport.
  // We adjust scrollTop manually instead of `scrollIntoView` so the page's
  // outer scroll container (page-content-scroll) is never affected.
  useLayoutEffect(() => {
    if (mode === 'off') return
    const container = scrollContainerRef.current
    if (!container) return
    const target = container.querySelector<HTMLElement>(`[data-outline-index="${activeIndex}"]`)
    if (!target) return
    const containerRect = container.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const padding = 8
    if (targetRect.top < containerRect.top + padding) {
      container.scrollTop += targetRect.top - containerRect.top - padding
    } else if (targetRect.bottom > containerRect.bottom - padding) {
      container.scrollTop += targetRect.bottom - containerRect.bottom + padding
    }
  }, [activeIndex, mode, headings.length])

  if (!editor || mode === 'off') return null

  // Drives the scroll explicitly on `.page-content-scroll` so we never rely on
  // the browser walking up to find the right scrolling ancestor — earlier we
  // saw the wrong container scroll on some pages. Calling `editor.commands.focus`
  // mid-animation also fights the smooth scroll, so we defer it past the
  // animation budget.
  const handleClick = (index: number, heading: Heading) => {
    const target = domHeadingsRef.current[index]
    if (!target) return
    const scrollContainer = getScrollContainer(editor)
    if (scrollContainer) {
      const targetRect = target.getBoundingClientRect()
      const containerRect = scrollContainer.getBoundingClientRect()
      const top = scrollContainer.scrollTop + (targetRect.top - containerRect.top) - 16
      scrollContainer.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
    } else {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    window.setTimeout(() => {
      if (editor.isDestroyed) return
      editor.commands.focus(heading.pos + 1, { scrollIntoView: false })
    }, FOCUS_DEFER_MS)
  }

  const isEmpty = headings.length === 0

  if (mode === 'mini') {
    return (
      <Box
        component="nav"
        ref={scrollContainerRef}
        aria-label="Содержание страницы"
        sx={{
          position: 'fixed',
          top: 80,
          right: 16 + rightOffset,
          transition: 'right 0.15s ease',
          zIndex: 5,
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          gap: 0.75,
          alignItems: 'flex-end',
          py: 1,
          maxHeight: 'calc(100vh - 96px)',
          overflowY: 'auto',
          pointerEvents: 'auto',
        }}
      >
        {isEmpty ? (
          <Tooltip title="Добавьте заголовки, чтобы увидеть навигацию" placement="left">
            <Box
              aria-hidden
              sx={{
                width: 18,
                height: 3,
                borderRadius: 1.5,
                bgcolor: 'action.disabledBackground',
              }}
            />
          </Tooltip>
        ) : (
          headings.map((heading, index) => {
            const isActive = index === activeIndex
            const label = heading.text || 'Без названия'
            return (
              <Tooltip
                key={`${heading.pos}-${index}`}
                title={label}
                placement="left"
                enterDelay={120}
              >
                <Box
                  component="button"
                  type="button"
                  data-outline-index={index}
                  onClick={() => handleClick(index, heading)}
                  aria-current={isActive ? 'true' : undefined}
                  aria-label={label}
                  sx={{
                    border: 'none',
                    outline: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    p: 0.5,
                    display: 'flex',
                    justifyContent: 'flex-end',
                    alignItems: 'center',
                    minWidth: 32,
                    transition: 'opacity 120ms ease',
                    '&:hover .anynote-outline-bar': {
                      bgcolor: 'text.primary',
                      opacity: 1,
                    },
                    '&:focus-visible .anynote-outline-bar': {
                      bgcolor: 'primary.main',
                      opacity: 1,
                    },
                  }}
                >
                  <Box
                    className="anynote-outline-bar"
                    sx={{
                      width: MINI_BAR_WIDTH_PX[heading.level],
                      height: 3,
                      borderRadius: 1.5,
                      bgcolor: isActive ? 'primary.main' : 'text.secondary',
                      opacity: isActive ? 1 : 0.45,
                      transition:
                        'background-color 120ms ease, opacity 120ms ease, width 120ms ease',
                    }}
                  />
                </Box>
              </Tooltip>
            )
          })
        )}
      </Box>
    )
  }

  return (
    <Box
      component="nav"
      ref={scrollContainerRef}
      aria-label="Содержание страницы"
      sx={{
        position: 'fixed',
        top: 80,
        right: 24 + rightOffset,
        transition: 'right 0.15s ease',
        width: 248,
        maxHeight: 'calc(100vh - 96px)',
        overflowY: 'auto',
        zIndex: 5,
        display: { xs: 'none', lg: 'block' },
        pointerEvents: 'auto',
      }}
    >
      <Typography
        component="h2"
        sx={{
          color: 'text.secondary',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          px: 1,
          mb: 0.75,
        }}
      >
        Содержание
      </Typography>
      {isEmpty ? (
        <Typography
          variant="caption"
          sx={{
            color: 'text.disabled',
            display: 'block',
            px: 1,
            py: 0.75,
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          Добавьте заголовки, чтобы увидеть навигацию
        </Typography>
      ) : (
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {headings.map((heading, index) => {
            const isActive = index === activeIndex
            const text = heading.text
            const label = text || 'Без названия'
            return (
              <Box component="li" key={`${heading.pos}-${index}`} sx={{ m: 0 }}>
                <Box
                  component="button"
                  type="button"
                  data-outline-index={index}
                  onClick={() => handleClick(index, heading)}
                  aria-current={isActive ? 'true' : undefined}
                  aria-label={label}
                  sx={{
                    width: '100%',
                    textAlign: 'left',
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    font: 'inherit',
                    color: isActive ? 'text.primary' : 'text.secondary',
                    fontSize: 13,
                    lineHeight: 1.4,
                    py: 0.625,
                    pr: 1,
                    pl: `${10 + LEVEL_INDENT_PX[heading.level]}px`,
                    borderLeft: '2px solid',
                    borderLeftColor: isActive ? 'primary.main' : 'transparent',
                    borderTopRightRadius: 6,
                    borderBottomRightRadius: 6,
                    fontWeight: isActive ? 600 : 400,
                    display: 'block',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    transition:
                      'background-color 120ms ease, color 120ms ease, border-color 120ms ease',
                    '&:hover': {
                      bgcolor: 'action.hover',
                      color: 'text.primary',
                    },
                    '&:focus-visible': {
                      outline: 'none',
                      bgcolor: 'action.hover',
                      color: 'text.primary',
                      boxShadow: (theme) => `inset 0 0 0 2px ${theme.palette.primary.main}`,
                    },
                  }}
                >
                  {text || (
                    <Box component="span" sx={{ fontStyle: 'italic', opacity: 0.7 }}>
                      Без названия
                    </Box>
                  )}
                </Box>
              </Box>
            )
          })}
        </Box>
      )}
    </Box>
  )
}
