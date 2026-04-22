"use client"

import Box from "@mui/material/Box"
import Typography from "@mui/material/Typography"

import { ChatFileChip } from "./chat-file-chip"
import { ChatServiceBlock } from "./chat-service-block"
import type { ChatMessagePart } from "./chat-types"

type ChatMessageContentProps = {
  parts: ChatMessagePart[]
}

function getPartOrder(part: ChatMessagePart) {
  switch (part.type) {
    case "text":
      return 0
    case "service-status":
      return 1
    case "file":
      return 2
    default:
      return 3
  }
}

export function ChatMessageContent({ parts }: ChatMessageContentProps) {
  const sortedParts = [...parts].sort((left, right) => getPartOrder(left) - getPartOrder(right))

  return (
    <Box display="flex" flexDirection="column" gap={1.25}>
      {sortedParts.map((part, index) => {
        if (part.type === "text") {
          return (
            <Typography key={`${part.type}-${index}`} sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }} variant="body2">
              {part.text}
            </Typography>
          )
        }

        if (part.type === "file") {
          return (
            <ChatFileChip
              key={part.fileId}
              href={part.downloadUrl}
              name={part.name}
              secondaryLabel={part.fileSize}
            />
          )
        }

        return <ChatServiceBlock key={part.id} part={part} />
      })}
    </Box>
  )
}
