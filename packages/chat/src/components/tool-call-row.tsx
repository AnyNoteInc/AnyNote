"use client"

import { Box, Chip, Typography } from "@mui/material"
import BuildIcon from "@mui/icons-material/Build"
import CheckCircleIcon from "@mui/icons-material/CheckCircle"
import ErrorIcon from "@mui/icons-material/Error"
import HourglassEmptyIcon from "@mui/icons-material/HourglassEmpty"
import type { ReactElement } from "react"
import type { ChatToolCall } from "../types/index"

export interface ToolCallRowProps {
  toolCall: ChatToolCall
}

const statusIcon: Record<ChatToolCall["status"], ReactElement> = {
  queued: <HourglassEmptyIcon fontSize="small" />,
  running: <BuildIcon fontSize="small" />,
  success: <CheckCircleIcon fontSize="small" color="success" />,
  error: <ErrorIcon fontSize="small" color="error" />,
}

export function ToolCallRow({ toolCall }: ToolCallRowProps): ReactElement {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        my: 0.5,
        px: 1.25,
        py: 0.75,
        borderRadius: 1,
        bgcolor: "action.hover",
      }}
    >
      {statusIcon[toolCall.status]}
      <Typography variant="body2" sx={{ flexGrow: 1 }}>
        {toolCall.title ?? toolCall.toolName}
      </Typography>
      <Chip label={toolCall.status} size="small" variant="outlined" />
    </Box>
  )
}
