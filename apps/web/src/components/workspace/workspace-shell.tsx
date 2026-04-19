"use client"

import type { ReactNode } from "react"

import { Box } from "@repo/ui/components"

import { SIDEBAR_WIDTH } from "./workspace-layout-client"

type Props = {
  sidebar: ReactNode
  main: ReactNode
  sidebarHidden: boolean
}

export function WorkspaceShell({ sidebar, main, sidebarHidden }: Props) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: sidebarHidden ? "1fr" : `${SIDEBAR_WIDTH}px minmax(0, 1fr)`,
        height: "100vh",
        bgcolor: "background.default",
        color: "text.primary",
        overflow: "hidden",
        transition: "grid-template-columns 150ms ease",
      }}
    >
      {sidebarHidden ? null : (
        <Box className="workspace-sidebar" sx={{ height: "100%", minHeight: 0, display: "flex" }}>
          {sidebar}
        </Box>
      )}
      <Box component="main" sx={{ overflow: "auto" }}>
        {main}
      </Box>
    </Box>
  )
}
