"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useMemo, useState } from "react"

import {
  AddIcon,
  ArrowDropDownIcon,
  ChatBubbleOutlineIcon,
  ChevronRightIcon,
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
  IconButton,
  Menu,
  MenuItem,
  MoreHorizIcon,
  Stack,
  TextField,
  Typography,
} from "@repo/ui/components"

import { trpc } from "@/trpc/client"

import { buildChatHref, navigateToChat } from "./chat/navigation"

type Props = { workspaceId: string }

type ChatItem = {
  id: string
  title: string | null
  parentId: string | null
  updatedAt: string | Date
  createdAt: string | Date
  createdById: string
}

function ChatTreeItem({
  chat,
  workspaceId,
  allChats,
}: {
  chat: ChatItem
  workspaceId: string
  allChats: ChatItem[]
}) {
  const pathname = usePathname()
  const router = useRouter()
  const utils = trpc.useUtils()

  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState("")
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [expanded, setExpanded] = useState(true)

  const isActive = pathname === `/workspaces/${workspaceId}/chats/${chat.id}`

  const children = useMemo(
    () =>
      allChats
        .filter((c) => c.parentId === chat.id)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [allChats, chat.id],
  )

  const rename = trpc.chat.renameChat.useMutation({
    onSuccess: async () => {
      await utils.chat.listChats.invalidate({ workspaceId })
      setRenameOpen(false)
    },
  })

  const deleteChat = trpc.chat.deleteChat.useMutation({
    onSuccess: async () => {
      await utils.chat.listChats.invalidate({ workspaceId })
      setDeleteOpen(false)
      if (isActive) router.push(`/workspaces/${workspaceId}/chats`)
    },
  })

  const createChild = trpc.chat.createChat.useMutation({
    onSuccess: async (data) => {
      await utils.chat.listChats.invalidate({ workspaceId })
      navigateToChat(router, workspaceId, data.id)
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
          "&:hover .chat-actions": { visibility: "visible" },
        }}
      >
        {children.length > 0 ? (
          <IconButton
            size="small"
            onClick={() => setExpanded((v) => !v)}
            sx={{ p: 0, flexShrink: 0 }}
          >
            <ChevronRightIcon
              sx={{
                fontSize: 16,
                transform: expanded ? "rotate(90deg)" : "none",
                transition: "transform 0.15s",
              }}
            />
          </IconButton>
        ) : null}
        <Link
          href={buildChatHref(workspaceId, chat.id)}
          scroll={false}
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
          className="chat-actions"
          sx={{
            display: "flex",
            visibility: menuAnchor ? "visible" : "hidden",
            flexShrink: 0,
          }}
        >
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation()
              createChild.mutate({ workspaceId, parentId: chat.id })
            }}
            sx={{ p: 0.25 }}
          >
            <AddIcon sx={{ fontSize: 16 }} />
          </IconButton>
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation()
              setMenuAnchor(e.currentTarget as HTMLElement)
            }}
            sx={{ p: 0.25 }}
          >
            <MoreHorizIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>
      </Box>

      {/* Children rendered indented */}
      {expanded && children.length > 0 && (
        <Stack spacing={0.25} sx={{ pl: 2 }}>
          {children.map((child) => (
            <ChatTreeItem
              key={child.id}
              chat={child}
              workspaceId={workspaceId}
              allChats={allChats}
            />
          ))}
        </Stack>
      )}

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
            Чат «{chat.title ?? "Без названия"}» и все дочерние чаты будут удалены навсегда.
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

export function SearchSidebarSection({ workspaceId }: Props) {
  const [open, setOpen] = useState(true)
  const router = useRouter()
  const utils = trpc.useUtils()
  const chats = trpc.chat.listChats.useQuery({ workspaceId })
  const create = trpc.chat.createChat.useMutation({
    onSuccess: async (data) => {
      await utils.chat.listChats.invalidate({ workspaceId })
      navigateToChat(router, workspaceId, data.id)
    },
  })

  const rootChats = useMemo(
    () =>
      (chats.data ?? [])
        .filter((c) => !c.parentId)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [chats.data],
  )

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
        <ChatBubbleOutlineIcon sx={{ fontSize: 16 }} />
        <span style={{ fontSize: 13, flex: 1 }}>Чаты</span>
        {open ? (
          <ArrowDropUpIcon sx={{ fontSize: 16 }} />
        ) : (
          <ArrowDropDownIcon sx={{ fontSize: 16 }} />
        )}
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation()
            create.mutate({ workspaceId })
          }}
          sx={{ p: 0.25, ml: 0.5 }}
        >
          <AddIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Box>
      {open ? (
        <Stack spacing={0.25} sx={{ pl: 3, maxHeight: 200, overflow: "auto" }}>
          {rootChats.map((chat) => (
            <ChatTreeItem
              key={chat.id}
              chat={chat}
              workspaceId={workspaceId}
              allChats={chats.data ?? []}
            />
          ))}
        </Stack>
      ) : null}
    </Box>
  )
}
