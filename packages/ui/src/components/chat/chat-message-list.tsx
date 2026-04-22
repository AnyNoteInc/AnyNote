"use client"

import { ChatMessage, ChatMessageContent as MuiChatMessageContent, ChatMessageList as MuiChatMessageList } from "@mui/x-chat"
import Avatar from "@mui/material/Avatar"
import Box from "@mui/material/Box"
import Stack from "@mui/material/Stack"
import Typography from "@mui/material/Typography"
import { ChatProvider } from "@mui/x-chat-headless"
import { useMemo } from "react"

import { ChatEmptyState } from "./chat-empty-state"
import {
  buildProviderMessages,
  CHAT_CONVERSATION_ID,
  CHAT_CONVERSATIONS,
  CHAT_MEMBERS,
  chatPartRenderers,
  noopChatAdapter,
} from "./chat-provider-utils"
import type { ChatThreadMessage } from "./chat-types"

type ChatMessageListProps = {
  messages: ChatThreadMessage[]
  emptyTitle?: string
  emptyDescription?: string
}

function formatTimestamp(value: ChatThreadMessage["createdAt"]) {
  if (!value) {
    return null
  }

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  const hours = String(date.getUTCHours()).padStart(2, "0")
  const minutes = String(date.getUTCMinutes()).padStart(2, "0")

  return `${hours}:${minutes}`
}

function getAuthorLabel(message: ChatThreadMessage) {
  return message.authorName?.trim() || null
}

function getStatusLabel(message: ChatThreadMessage) {
  if (!message.status) {
    return null
  }

  return message.status[0]?.toUpperCase() + message.status.slice(1)
}

function getInitials(label: string) {
  return label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((token) => token[0]?.toUpperCase())
    .join("")
}

export function ChatMessageList({
  messages,
  emptyTitle,
  emptyDescription,
}: ChatMessageListProps) {
  const providerMessages = useMemo(() => buildProviderMessages(messages), [messages])

  return (
    <ChatProvider
      activeConversationId={CHAT_CONVERSATION_ID}
      adapter={noopChatAdapter}
      conversations={CHAT_CONVERSATIONS}
      members={CHAT_MEMBERS}
      messages={providerMessages}
      partRenderers={chatPartRenderers}
    >
      <MuiChatMessageList
        autoScroll
        items={providerMessages.map((message) => message.id)}
        overlay={
          messages.length === 0 ? (
            <ChatEmptyState description={emptyDescription} title={emptyTitle} />
          ) : null
        }
        renderItem={({ id, index }) => {
          const message = messages[index]

          if (!message || message.id !== id) {
            return null
          }

          const isUser = message.role === "user"
          const timestamp = formatTimestamp(message.createdAt)
          const status = getStatusLabel(message)
          const label = getAuthorLabel(message)
          const showAvatar = !isUser && Boolean(message.avatarUrl || label)

          return (
            <ChatMessage key={message.id} messageId={message.id}>
              <Stack
                alignItems={isUser ? "flex-end" : "flex-start"}
                direction="row"
                justifyContent={isUser ? "flex-end" : "flex-start"}
                spacing={1.5}
                width="100%"
              >
                {showAvatar ? (
                  <Avatar alt={label ?? ""} src={message.avatarUrl} sx={{ width: 32, height: 32 }}>
                    {label ? getInitials(label) : null}
                  </Avatar>
                ) : null}
                <Box maxWidth={{ xs: "100%", sm: "85%", md: "76%" }}>
                  {label ? (
                    <Typography color="text.secondary" gutterBottom variant="caption">
                      {label}
                    </Typography>
                  ) : null}
                  <Box
                    sx={{
                      bgcolor: isUser ? "primary.main" : "background.paper",
                      border: 1,
                      borderColor: isUser ? "primary.main" : "divider",
                      borderRadius: 3,
                      boxShadow: 1,
                      color: isUser ? "primary.contrastText" : "text.primary",
                      px: 1.5,
                      py: 1.25,
                    }}
                  >
                    <MuiChatMessageContent />
                  </Box>
                  {timestamp || status ? (
                    <Typography color="text.secondary" mt={0.75} variant="caption">
                      {[timestamp, status].filter(Boolean).join(" • ")}
                    </Typography>
                  ) : null}
                </Box>
              </Stack>
            </ChatMessage>
          )
        }}
        sx={{
          flex: 1,
          minHeight: 0,
          px: 2,
          py: 2,
        }}
      />
    </ChatProvider>
  )
}
