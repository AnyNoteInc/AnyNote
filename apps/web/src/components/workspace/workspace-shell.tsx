"use client"

import type { ReactNode } from "react"

import { Box, CssBaseline, ThemeProvider } from "@repo/ui/components"
import { createAppTheme } from "@repo/ui/theme"

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const theme = createAppTheme("dark")
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "240px minmax(0, 1fr) 340px",
          height: "100vh",
          backgroundColor: "#0c0d10",
          color: "#e7e8ea",
          overflow: "hidden",
        }}
      >
        {children}
      </Box>
    </ThemeProvider>
  )
}
