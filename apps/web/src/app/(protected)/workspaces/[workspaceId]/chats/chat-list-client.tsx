"use client"

import Link from "next/link"
import { useState } from "react"
import {
  Box,
  Button,
  Container,
  DeleteIcon,
  EditIcon,
  IconButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@repo/ui/components"
import { trpc } from "@/trpc/client"

type Props = {
  workspaceId: string
  workspaceName: string
}

const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
})

export function ChatListClient({ workspaceId, workspaceName }: Props) {
  const utils = trpc.useUtils()
  const chatsQuery = trpc.chat.listChats.useQuery({ workspaceId })
  const renameMutation = trpc.chat.renameChat.useMutation({
    onSuccess: () => utils.chat.listChats.invalidate({ workspaceId }),
  })
  const deleteMutation = trpc.chat.deleteChat.useMutation({
    onSuccess: () => utils.chat.listChats.invalidate({ workspaceId }),
  })

  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null)

  const onRenameSave = () => {
    if (!editing || !editing.value.trim()) return
    renameMutation.mutate(
      { chatId: editing.id, title: editing.value.trim().slice(0, 48) },
      { onSuccess: () => setEditing(null) },
    )
  }

  const onDelete = (id: string, title: string) => {
    if (!window.confirm(`Удалить чат «${title}»? Это действие необратимо.`)) return
    deleteMutation.mutate({ chatId: id })
  }

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

        {chatsQuery.isLoading ? (
          <Typography variant="body2" color="text.secondary">
            Загружаем…
          </Typography>
        ) : (chatsQuery.data ?? []).length === 0 ? (
          <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
            <Typography color="text.secondary">
              Пока ни одного чата. Нажмите «Новый чат», чтобы начать.
            </Typography>
          </Paper>
        ) : (
          <Stack spacing={1}>
            {(chatsQuery.data ?? []).map((chat) => {
              const isEditing = editing?.id === chat.id
              return (
                <Paper
                  key={chat.id}
                  variant="outlined"
                  sx={{
                    p: 2,
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                  }}
                >
                  {isEditing ? (
                    <TextField
                      autoFocus
                      size="small"
                      value={editing!.value}
                      onChange={(e) => setEditing({ id: chat.id, value: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") onRenameSave()
                        if (e.key === "Escape") setEditing(null)
                      }}
                      onBlur={() => setEditing(null)}
                      sx={{ flexGrow: 1 }}
                    />
                  ) : (
                    <Box
                      component={Link}
                      href={`/workspaces/${workspaceId}/chat/${chat.id}`}
                      sx={{
                        flexGrow: 1,
                        minWidth: 0,
                        textDecoration: "none",
                        color: "inherit",
                      }}
                    >
                      <Typography variant="body1" sx={{ fontWeight: 500 }} noWrap>
                        {chat.title}
                      </Typography>
                    </Box>
                  )}
                  <Typography variant="caption" color="text.secondary">
                    {dateFormat.format(new Date(chat.updatedAt))}
                  </Typography>
                  <Tooltip title="Переименовать">
                    <IconButton
                      size="small"
                      onMouseDown={(e) => {
                        // Prevent the TextField onBlur from firing before we set state.
                        e.preventDefault()
                        setEditing({ id: chat.id, value: chat.title })
                      }}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Удалить">
                    <IconButton
                      size="small"
                      onClick={() => onDelete(chat.id, chat.title)}
                      disabled={deleteMutation.isPending}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Paper>
              )
            })}
          </Stack>
        )}
      </Stack>
    </Container>
  )
}
