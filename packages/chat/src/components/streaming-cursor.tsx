"use client"

import { Box, keyframes } from "@mui/material"
import type { ReactElement } from "react"

const blink = keyframes`
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0; }
`

export function StreamingCursor(): ReactElement {
  return (
    <Box
      component="span"
      aria-hidden
      sx={{
        display: "inline-block",
        width: "0.5em",
        height: "1em",
        ml: 0.25,
        verticalAlign: "text-bottom",
        bgcolor: "text.primary",
        animation: `${blink} 1s step-end infinite`,
      }}
    />
  )
}
