"use client"

import { Box } from "@mui/material"
import type { ReactElement, ReactNode } from "react"

export interface ChatShellProps {
  children: ReactNode
}

export function ChatShell({ children }: ChatShellProps): ReactElement {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        bgcolor: "background.default",
      }}
    >
      {children}
    </Box>
  )
}
