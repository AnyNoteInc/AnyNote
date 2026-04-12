"use client"

import { useCallback, useRef, useState, type ReactNode } from "react"

import { Box, IconButton, MenuIcon, Paper, Popper, Stack, Typography } from "@repo/ui/components"

type Breadcrumb = { label: string; href?: string }

type Props = {
  breadcrumbs: Breadcrumb[]
  sidebarHidden: boolean
  onOpenSidebar: () => void
  sidebarContent: ReactNode
}

export function WorkspaceToolbar({
  breadcrumbs,
  sidebarHidden,
  onOpenSidebar,
  sidebarContent,
}: Props) {
  const [popperOpen, setPopperOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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
      sx={{
        px: 2,
        py: 1.25,
        borderBottom: "1px solid",
        borderColor: "divider",
      }}
    >
      {sidebarHidden ? (
        <Box onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
          <IconButton
            ref={anchorRef}
            size="small"
            onClick={onOpenSidebar}
            sx={{ color: "text.secondary" }}
          >
            <MenuIcon sx={{ fontSize: 20 }} />
          </IconButton>
          <Popper
            open={popperOpen}
            anchorEl={anchorRef.current}
            placement="bottom-start"
            sx={{ zIndex: 1300 }}
          >
            <Paper
              elevation={8}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              sx={{
                width: 240,
                maxHeight: "calc(100vh - 80px)",
                overflow: "auto",
                borderRadius: 2,
                mt: 0.5,
              }}
            >
              {sidebarContent}
            </Paper>
          </Popper>
        </Box>
      ) : null}
      {breadcrumbs.map((crumb, i) => (
        <Stack key={i} direction="row" alignItems="center" spacing={1.25}>
          {i > 0 && (
            <Typography variant="body2" color="text.disabled">
              /
            </Typography>
          )}
          <Typography
            variant="body2"
            noWrap
            color={i === breadcrumbs.length - 1 ? "text.primary" : "text.secondary"}
          >
            {crumb.label}
          </Typography>
        </Stack>
      ))}
      <Box sx={{ flex: 1 }} />
    </Stack>
  )
}
