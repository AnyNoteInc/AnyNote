"use client"

import { Box, Typography } from "@mui/material"
import type { ReactElement, ReactNode } from "react"
import { chatTokens } from "../theme/tokens"

export interface ChatHeaderProps {
  title?: ReactNode
  actions?: ReactNode
}

export function ChatHeader({ title, actions }: ChatHeaderProps): ReactElement {
  return (
    <Box
      component="header"
      sx={{
        position: "sticky",
        top: 0,
        zIndex: 1,
        px: { xs: 2, sm: 3 },
        py: 1.5,
        borderBottom: 1,
        borderColor: "divider",
        bgcolor: "background.default",
      }}
    >
      <Box
        sx={{
          maxWidth: chatTokens.maxContentWidth,
          mx: "auto",
          display: "flex",
          alignItems: "center",
          gap: 1,
        }}
      >
        <Typography variant="subtitle1" sx={{ flexGrow: 1, fontWeight: 600 }}>
          {title}
        </Typography>
        {actions}
      </Box>
    </Box>
  )
}
