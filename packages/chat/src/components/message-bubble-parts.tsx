"use client"

import { Box, Typography } from "@mui/material"
import type { ReactElement } from "react"
import type { ChatMessagePart } from "../types/index"
import { MarkdownRenderer } from "./markdown-renderer"

export interface MessagePartProps {
  part: ChatMessagePart
}

export function MessagePart({ part }: MessagePartProps): ReactElement {
  switch (part.type) {
    case "text":
      return (
        <Typography variant="body1" sx={{ whiteSpace: "pre-wrap" }}>
          {part.text}
        </Typography>
      )
    case "markdown":
      return <MarkdownRenderer text={part.text} />
    case "code":
      return (
        <Box
          component="pre"
          sx={{
            my: 1,
            p: 1.5,
            borderRadius: 1,
            bgcolor: "action.hover",
            overflowX: "auto",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: "0.85em",
          }}
        >
          <code>{part.code}</code>
        </Box>
      )
    case "tool_call":
      return (
        <Typography variant="caption" color="text.secondary">
          tool_call: {part.toolCallId}
        </Typography>
      )
    case "attachment":
      return (
        <Typography variant="caption" color="text.secondary">
          attachment: {part.attachmentId}
        </Typography>
      )
  }
}
