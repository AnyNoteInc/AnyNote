"use client"

import type { ReactNode } from "react"

import { Box } from "@repo/ui/components"

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
        gridTemplateColumns: sidebarHidden ? "1fr" : "240px minmax(0, 1fr)",
        height: "100vh",
        bgcolor: "background.default",
        color: "text.primary",
        overflow: "hidden",
        transition: "grid-template-columns 150ms ease",
      }}
    >
      {sidebarHidden ? null : sidebar}
      <Box component="main" sx={{ overflow: "auto" }}>
        {main}
      </Box>
    </Box>
  )
}
