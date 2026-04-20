"use client"

import { Box, keyframes } from "@mui/material"
import type { ReactElement } from "react"

const bounce = keyframes`
  0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
  40% { transform: translateY(-3px); opacity: 1; }
`

export function TypingIndicator(): ReactElement {
  return (
    <Box
      role="status"
      aria-label="Ассистент печатает"
      sx={{ display: "inline-flex", gap: 0.5, alignItems: "center", py: 1 }}
    >
      {[0, 1, 2].map((i) => (
        <Box
          key={i}
          sx={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            bgcolor: "text.secondary",
            animation: `${bounce} 1.2s ease-in-out infinite`,
            animationDelay: `${i * 0.15}s`,
          }}
        />
      ))}
    </Box>
  )
}
