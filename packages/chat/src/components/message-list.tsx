"use client"

import { Box, Fab } from "@mui/material"
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown"
import { useEffect, type ReactElement } from "react"
import type { ChatMessage } from "../types/index"
import { useAutoScroll } from "../hooks/use-auto-scroll"
import { useMessageGroups } from "../hooks/use-message-groups"
import { chatTokens } from "../theme/tokens"
import { MessageBubble } from "./message-bubble"

export interface MessageListProps {
  messages: ChatMessage[]
  onRetry?: (messageId: string) => void
}

export function MessageList({ messages, onRetry }: MessageListProps): ReactElement {
  const { containerRef, isPinned, scrollToBottom } = useAutoScroll<HTMLDivElement>()
  const groups = useMessageGroups(messages)

  useEffect(() => {
    if (isPinned) scrollToBottom("auto")
  }, [messages, isPinned, scrollToBottom])

  return (
    <Box sx={{ position: "relative", flexGrow: 1, minHeight: 0 }}>
      <Box
        ref={containerRef}
        sx={{
          position: "absolute",
          inset: 0,
          overflowY: "auto",
          px: { xs: 2, sm: 3 },
          py: 2,
        }}
      >
        <Box sx={{ maxWidth: chatTokens.maxContentWidth, mx: "auto" }}>
          {groups.map((group) => (
            <Box key={group.key} sx={{ mb: chatTokens.groupSpacing }}>
              {group.messages.map((m) => (
                <MessageBubble key={m.id} message={m} onRetry={onRetry} />
              ))}
            </Box>
          ))}
        </Box>
      </Box>
      {!isPinned && (
        <Fab
          color="primary"
          size="small"
          aria-label="Прокрутить вниз"
          onClick={() => scrollToBottom()}
          sx={{ position: "absolute", bottom: 16, right: 16 }}
        >
          <KeyboardArrowDownIcon />
        </Fab>
      )}
    </Box>
  )
}
