"use client"

import type { ReactNode } from "react"

import { Box } from "@repo/ui/components"

type Props = {
  sidebar: ReactNode
  main: ReactNode
  sidebarWidth: number
}

export function WorkspaceShell({ sidebar, main, sidebarWidth }: Props) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: `${sidebarWidth}px minmax(0, 1fr)`,
        height: "100vh",
        bgcolor: "background.default",
        color: "text.primary",
        overflow: "hidden",
      }}
    >
      {sidebar}
      <Box component="main" sx={{ overflow: "auto" }}>
        {main}
      </Box>
    </Box>
  )
}
