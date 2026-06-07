'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { Box, IconButton, MenuIcon, Paper, Popper, Stack, Typography } from '@repo/ui/components'

import { SIDEBAR_WIDTH } from './workspace-layout-client'

type Breadcrumb = { label: string; href?: string; icon?: ReactNode }

type Props = {
  readonly breadcrumbs: Breadcrumb[]
  readonly sidebarHidden: boolean
  readonly onOpenSidebar: () => void
  readonly sidebarContent: ReactNode
  readonly rightSlot?: ReactNode
}

export function WorkspaceToolbar({
  breadcrumbs,
  sidebarHidden,
  onOpenSidebar,
  sidebarContent,
  rightSlot,
}: Props) {
  const [popperOpen, setPopperOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suppressUntil = useRef(0)

  useEffect(() => {
    if (sidebarHidden) {
      suppressUntil.current = Date.now() + 500
      setPopperOpen(false)
    }
  }, [sidebarHidden])

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current)
    }
  }, [])

  const scheduleClose = useCallback(() => {
    closeTimer.current = setTimeout(() => setPopperOpen(false), 120)
  }, [])

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])

  const handleMouseEnter = useCallback(() => {
    if (Date.now() < suppressUntil.current) return
    cancelClose()
    setPopperOpen(true)
  }, [cancelClose])

  const handleMouseLeave = useCallback(() => {
    scheduleClose()
  }, [scheduleClose])

  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1.25}
      className="workspace-toolbar"
      sx={{
        px: 2,
        py: 0.5,
        minHeight: 44,
        borderBottom: '1px solid',
        borderColor: 'divider',
      }}
    >
      {sidebarHidden ? (
        <>
          <IconButton
            ref={anchorRef}
            size="small"
            onClick={onOpenSidebar}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            aria-label="Открыть сайдбар"
            sx={{ color: 'text.secondary' }}
          >
            <MenuIcon sx={{ fontSize: 20 }} />
          </IconButton>
          {popperOpen ? (
            <Popper
              open
              anchorEl={anchorRef.current}
              placement="bottom-start"
              sx={{ zIndex: 1300 }}
            >
              <Paper
                elevation={8}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                sx={{
                  width: SIDEBAR_WIDTH,
                  maxHeight: 'calc(100vh - 80px)',
                  overflow: 'auto',
                  borderRadius: 2,
                  mt: 0.5,
                }}
              >
                {sidebarContent}
              </Paper>
            </Popper>
          ) : null}
        </>
      ) : null}
      {breadcrumbs.map((crumb, i) => {
        const isLast = i === breadcrumbs.length - 1
        return (
          <Stack key={i} direction="row" alignItems="center" spacing={1.25}>
            {i > 0 && (
              <Typography variant="body2" color="text.disabled">
                /
              </Typography>
            )}
            {crumb.href && !isLast ? (
              <Stack
                component={Link}
                href={crumb.href}
                direction="row"
                alignItems="center"
                spacing={0.5}
                sx={{
                  color: 'text.secondary',
                  textDecoration: 'none',
                  '&:hover': { color: 'text.primary', textDecoration: 'underline' },
                }}
              >
                {crumb.icon}
                <Typography variant="body2" noWrap color="inherit">
                  {crumb.label}
                </Typography>
              </Stack>
            ) : (
              <Stack direction="row" alignItems="center" spacing={0.5}>
                {crumb.icon}
                <Typography
                  variant="body2"
                  noWrap
                  color={isLast ? 'text.primary' : 'text.secondary'}
                >
                  {crumb.label}
                </Typography>
              </Stack>
            )}
          </Stack>
        )
      })}
      <Box sx={{ flex: 1 }} />
      {rightSlot}
    </Stack>
  )
}
