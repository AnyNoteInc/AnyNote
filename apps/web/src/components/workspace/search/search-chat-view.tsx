"use client"

import { Box, Paper, Stack, Typography } from "@repo/ui/components"

import { trpc } from "@/trpc/client"

import { SearchChatInput } from "./search-chat-input"

type Props = { chatId: string; workspaceId: string }

function MessageBubble({ role, content }: { role: string; content: string }) {
  const isUser = role === "USER"
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        alignSelf: isUser ? "flex-end" : "flex-start",
        bgcolor: isUser ? "action.selected" : "background.paper",
        maxWidth: "80%",
      }}
    >
      <Typography variant="body1" sx={{ whiteSpace: "pre-wrap" }}>
        {content}
      </Typography>
    </Paper>
  )
}

type SimpleMessage = { id: string; role: string; content: string }

export function SearchChatView({ chatId, workspaceId }: Props) {
  const chat = trpc.chat.getChat.useQuery({ chatId })
  const messages: SimpleMessage[] = chat.data?.messages ?? []

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <Box sx={{ flex: 1, overflowY: "auto", px: 3, py: 4 }}>
        <Stack spacing={2} sx={{ maxWidth: 720, mx: "auto" }}>
          {messages.length === 0 ? (
            <Typography color="text.secondary" textAlign="center">
              Начните новый поиск — напишите, что хотите найти
            </Typography>
          ) : null}
          {messages.map((message) => (
            <MessageBubble key={message.id} role={message.role} content={message.content} />
          ))}
        </Stack>
      </Box>
      <SearchChatInput chatId={chatId} workspaceId={workspaceId} />
    </Box>
  )
}
