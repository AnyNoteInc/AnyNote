"use client"

import { Box, Button, Paper, Typography, useTheme } from "@mui/material"
import RefreshIcon from "@mui/icons-material/Refresh"
import type { ReactElement } from "react"
import type { ChatMessage } from "../types/index"
import { chatTokens } from "../theme/tokens"
import { AttachmentRow } from "./attachment-row"
import { MarkdownRenderer } from "./markdown-renderer"
import { MessagePart } from "./message-bubble-parts"
import { StreamingCursor } from "./streaming-cursor"
import { ToolCallRow } from "./tool-call-row"

export interface MessageBubbleProps {
  message: ChatMessage
  onRetry?: (messageId: string) => void
}

export function MessageBubble({ message, onRetry }: MessageBubbleProps): ReactElement {
  const theme = useTheme()
  const isUser = message.role === "user"
  const isAssistant = message.role === "assistant"
  const isError = message.status === "error"

  const bg = isUser
    ? theme.palette.primary.main
    : isError
      ? theme.palette.error.light
      : theme.palette.action.hover
  const fg = isUser ? theme.palette.primary.contrastText : theme.palette.text.primary

  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        my: chatTokens.bubbleSpacing / 2,
      }}
    >
      <Paper
        elevation={0}
        aria-live={isAssistant && message.status === "streaming" ? "polite" : undefined}
        sx={{
          maxWidth: "85%",
          px: 2,
          py: 1.25,
          borderRadius: `${chatTokens.bubbleRadius}px`,
          bgcolor: bg,
          color: fg,
        }}
      >
        {message.parts && message.parts.length > 0 ? (
          message.parts.map((part, i) => <MessagePart key={i} part={part} />)
        ) : message.content ? (
          isUser ? (
            <Typography variant="body1" sx={{ whiteSpace: "pre-wrap" }}>
              {message.content}
            </Typography>
          ) : (
            <MarkdownRenderer text={message.content} />
          )
        ) : null}

        {message.toolCalls?.map((tc) => <ToolCallRow key={tc.id} toolCall={tc} />)}
        {message.attachments?.map((a) => <AttachmentRow key={a.id} attachment={a} />)}

        {message.status === "streaming" && <StreamingCursor />}

        {isError && (
          <Box sx={{ mt: 1, display: "flex", alignItems: "center", gap: 1 }}>
            <Typography variant="caption" color="error.dark">
              {message.errorMessage ?? "Произошла ошибка"}
            </Typography>
            {onRetry && (
              <Button
                size="small"
                startIcon={<RefreshIcon />}
                onClick={() => onRetry(message.id)}
                color="error"
              >
                Повторить
              </Button>
            )}
          </Box>
        )}
      </Paper>
    </Box>
  )
}
