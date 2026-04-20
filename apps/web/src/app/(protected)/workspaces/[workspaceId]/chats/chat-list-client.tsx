"use client"

import Link from "next/link"
import { Box, Button, Container, Paper, Stack, Typography } from "@repo/ui/components"

type ChatRow = {
  id: string
  title: string
  updatedAt: string
}

type Props = {
  workspaceId: string
  workspaceName: string
  chats: ChatRow[]
}

const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
})

export function ChatListClient({ workspaceId, workspaceName, chats }: Props) {
  return (
    <Container maxWidth="md" sx={{ py: { xs: 3, md: 5 } }}>
      <Stack spacing={3}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="h5" sx={{ fontWeight: 600 }}>
              Чаты · {workspaceName}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              История разговоров с AnyNote AI в этом workspace.
            </Typography>
          </Box>
          <Button
            component={Link}
            href={`/workspaces/${workspaceId}/chat`}
            variant="contained"
          >
            Новый чат
          </Button>
        </Box>

        {chats.length === 0 ? (
          <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
            <Typography color="text.secondary">
              Пока ни одного чата. Нажмите «Новый чат», чтобы начать.
            </Typography>
          </Paper>
        ) : (
          <Stack spacing={1}>
            {chats.map((chat) => (
              <Paper
                key={chat.id}
                variant="outlined"
                component={Link}
                href={`/workspaces/${workspaceId}/chat/${chat.id}`}
                sx={{
                  p: 2,
                  display: "flex",
                  alignItems: "center",
                  gap: 2,
                  textDecoration: "none",
                  color: "inherit",
                  transition: "background-color 0.15s",
                  "&:hover": { bgcolor: "action.hover" },
                }}
              >
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="body1" sx={{ fontWeight: 500 }} noWrap>
                    {chat.title}
                  </Typography>
                </Box>
                <Typography variant="caption" color="text.secondary">
                  {dateFormat.format(new Date(chat.updatedAt))}
                </Typography>
              </Paper>
            ))}
          </Stack>
        )}
      </Stack>
    </Container>
  )
}
