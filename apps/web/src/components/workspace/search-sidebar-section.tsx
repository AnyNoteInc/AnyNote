"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useState } from "react"

import {
  ArrowDropDownIcon,
  ArrowDropUpIcon,
  Box,
  Button,
  DeleteIcon,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  DriveFileRenameOutlineIcon,
  Menu,
  MenuItem,
  MoreHorizIcon,
  SearchIcon,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@repo/ui/components"

import { trpc } from "@/trpc/client"

type Props = { workspaceId: string; collapsed: boolean }

type ChatItem = { id: string; title: string | null }

function ChatListItem({ chat, workspaceId }: { chat: ChatItem; workspaceId: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const utils = trpc.useUtils()

  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState("")
  const [deleteOpen, setDeleteOpen] = useState(false)

  const isActive = pathname === `/workspaces/${workspaceId}/search/${chat.id}`

  const rename = trpc.search.renameChat.useMutation({
    onSuccess: async () => {
      await utils.search.listChats.invalidate({ workspaceId })
      setRenameOpen(false)
    },
  })

  const deleteChat = trpc.search.deleteChat.useMutation({
    onSuccess: async () => {
      await utils.search.listChats.invalidate({ workspaceId })
      setDeleteOpen(false)
      if (isActive) router.push(`/workspaces/${workspaceId}/search`)
    },
  })

  return (
    <>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          pr: 0.5,
          borderRadius: 0.75,
          bgcolor: isActive ? "action.selected" : "transparent",
          "&:hover": { bgcolor: isActive ? "action.selected" : "action.hover" },
          "&:hover .more-btn": { visibility: "visible" },
        }}
      >
        <Link
          href={`/workspaces/${workspaceId}/search/${chat.id}`}
          style={{ textDecoration: "none", flex: 1, minWidth: 0 }}
        >
          <Typography
            variant="body2"
            noWrap
            sx={{
              py: 0.5,
              pl: 0.5,
              color: isActive ? "text.primary" : "text.secondary",
            }}
          >
            {chat.title ?? "Без названия"}
          </Typography>
        </Link>
        <Box
          className="more-btn"
          component="button"
          onClick={(e) => {
            e.stopPropagation()
            setMenuAnchor(e.currentTarget as HTMLElement)
          }}
          sx={{
            display: "flex",
            alignItems: "center",
            border: "none",
            background: "none",
            cursor: "pointer",
            color: "text.secondary",
            p: 0.25,
            borderRadius: 0.5,
            flexShrink: 0,
            visibility: menuAnchor ? "visible" : "hidden",
            "&:hover": { color: "text.primary", bgcolor: "action.hover" },
          }}
        >
          <MoreHorizIcon sx={{ fontSize: 16 }} />
        </Box>
      </Box>

      {/* Context menu */}
      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem
          onClick={() => {
            setMenuAnchor(null)
            setRenameValue(chat.title ?? "")
            setRenameOpen(true)
          }}
          sx={{ gap: 1, fontSize: 13 }}
        >
          <DriveFileRenameOutlineIcon fontSize="small" />
          Переименовать
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMenuAnchor(null)
            setDeleteOpen(true)
          }}
          sx={{ gap: 1, fontSize: 13, color: "error.main" }}
        >
          <DeleteIcon fontSize="small" />
          Удалить
        </MenuItem>
      </Menu>

      {/* Rename dialog */}
      <Dialog open={renameOpen} onClose={() => setRenameOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Переименовать чат</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && renameValue.trim()) {
                rename.mutate({ chatId: chat.id, title: renameValue.trim() })
              }
            }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setRenameOpen(false)}>
            Отмена
          </Button>
          <Button
            onClick={() => rename.mutate({ chatId: chat.id, title: renameValue.trim() })}
            disabled={!renameValue.trim() || rename.isPending}
          >
            Сохранить
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Удалить чат?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Чат «{chat.title ?? "Без названия"}» и все его сообщения будут удалены навсегда.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setDeleteOpen(false)}>
            Отмена
          </Button>
          <Button
            onClick={() => deleteChat.mutate({ chatId: chat.id })}
            disabled={deleteChat.isPending}
          >
            Удалить
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

export function SearchSidebarSection({ workspaceId, collapsed }: Props) {
  const [open, setOpen] = useState(true)
  const router = useRouter()
  const utils = trpc.useUtils()
  const chats = trpc.search.listChats.useQuery({ workspaceId })
  const create = trpc.search.createChat.useMutation({
    onSuccess: async (data) => {
      await utils.search.listChats.invalidate({ workspaceId })
      router.push(`/workspaces/${workspaceId}/search/${data.id}`)
    },
  })

  if (collapsed) {
    return (
      <Tooltip title="Поиск" placement="right">
        <Link href={`/workspaces/${workspaceId}/search`} style={{ textDecoration: "none" }}>
          <Box
            sx={{
              display: "flex",
              justifyContent: "center",
              py: 0.75,
              color: "text.secondary",
              "&:hover": { color: "text.primary" },
            }}
          >
            <SearchIcon sx={{ fontSize: 18 }} />
          </Box>
        </Link>
      </Tooltip>
    )
  }

  return (
    <Box>
      <Box
        onClick={() => setOpen((prev) => !prev)}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1,
          py: 0.75,
          cursor: "pointer",
          color: "text.secondary",
          "&:hover": { color: "text.primary" },
        }}
      >
        <SearchIcon sx={{ fontSize: 16 }} />
        <span style={{ fontSize: 13, flex: 1 }}>Поиск</span>
        {open ? (
          <ArrowDropUpIcon sx={{ fontSize: 16 }} />
        ) : (
          <ArrowDropDownIcon sx={{ fontSize: 16 }} />
        )}
      </Box>
      {open ? (
        <Stack spacing={0.25} sx={{ pl: 3 }}>
          {chats.data?.map((chat) => (
            <ChatListItem key={chat.id} chat={chat} workspaceId={workspaceId} />
          ))}
          <Box
            onClick={() => create.mutate({ workspaceId })}
            sx={{
              cursor: "pointer",
              py: 0.5,
              color: "text.disabled",
              "&:hover": { color: "text.primary" },
              fontSize: 13,
            }}
          >
            ＋ Новый чат
          </Box>
        </Stack>
      ) : null}
    </Box>
  )
}
