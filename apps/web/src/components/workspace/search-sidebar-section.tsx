'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'

import {
  AddIcon,
  ChevronRightIcon,
  Box,
  Button,
  DeleteIcon,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  DriveFileRenameOutlineIcon,
  IconButton,
  ArrowDropDownIcon,
  ArrowDropUpIcon,
  Menu,
  MenuItem,
  MoreHorizIcon,
  Stack,
  StarBorderIcon,
  StarIcon,
  TextField,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { buildChatHref, navigateToChat } from './chat/navigation'

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
  favoriteChatIds,
  depth = 0,
}: {
  chat: ChatItem
  workspaceId: string
  allChats: ChatItem[]
  favoriteChatIds: Set<string>
  depth?: number
}) {
  const pathname = usePathname()
  const router = useRouter()
  const utils = trpc.useUtils()

  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [expanded, setExpanded] = useState(true)

  const isActive = pathname === `/workspaces/${workspaceId}/chats/${chat.id}`
  const isFavorite = favoriteChatIds.has(chat.id)

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
      await Promise.all([
        utils.chat.listChats.invalidate({ workspaceId }),
        utils.chat.listFavorites.invalidate({ workspaceId }),
      ])
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

  const addFavorite = trpc.chat.addFavorite.useMutation({
    onSuccess: async () => {
      await utils.chat.listFavorites.invalidate({ workspaceId })
    },
  })

  const removeFavorite = trpc.chat.removeFavorite.useMutation({
    onSuccess: async () => {
      await utils.chat.listFavorites.invalidate({ workspaceId })
    },
  })

  const toggleFavorite = () => {
    setMenuAnchor(null)
    if (isFavorite) {
      removeFavorite.mutate({ chatId: chat.id })
    } else {
      addFavorite.mutate({ chatId: chat.id })
    }
  }

  return (
    <>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          pr: 0.5,
          pl: 0.5 + depth * 1.5,
          borderRadius: 0.75,
          bgcolor: isActive ? 'action.selected' : 'transparent',
          '&:hover': { bgcolor: isActive ? 'action.selected' : 'action.hover' },
          '&:hover .chat-actions': { visibility: 'visible' },
        }}
      >
        {children.length > 0 ? (
          <IconButton
            size="small"
            onClick={() => setExpanded((v) => !v)}
            sx={{ p: 0, mr: 0.25, flexShrink: 0 }}
          >
            <ChevronRightIcon
              sx={{
                fontSize: 16,
                transform: expanded ? 'rotate(90deg)' : 'none',
                transition: 'transform 0.15s',
              }}
            />
          </IconButton>
        ) : null}
        <Link
          href={buildChatHref(workspaceId, chat.id)}
          scroll={false}
          style={{ textDecoration: 'none', flex: 1, minWidth: 0 }}
        >
          <Typography
            variant="body2"
            noWrap
            sx={{
              py: 0.5,
              pl: 0.5,
              color: isActive ? 'text.primary' : 'text.secondary',
            }}
          >
            {chat.title ?? 'Без названия'}
          </Typography>
        </Link>
        <Box
          className="chat-actions"
          sx={{
            display: 'flex',
            visibility: menuAnchor ? 'visible' : 'hidden',
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

      {expanded &&
        children.map((child) => (
          <ChatTreeItem
            key={child.id}
            chat={child}
            workspaceId={workspaceId}
            allChats={allChats}
            favoriteChatIds={favoriteChatIds}
            depth={depth + 1}
          />
        ))}

      {/* Context menu */}
      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem onClick={toggleFavorite} sx={{ gap: 1, fontSize: 13 }}>
          {isFavorite ? <StarIcon fontSize="small" /> : <StarBorderIcon fontSize="small" />}
          {isFavorite ? 'Убрать из избранного' : 'В избранное'}
        </MenuItem>

        <Divider />

        <MenuItem
          onClick={() => {
            setMenuAnchor(null)
            setRenameValue(chat.title ?? '')
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
          sx={{ gap: 1, fontSize: 13, color: 'error.main' }}
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
              if (e.key === 'Enter' && renameValue.trim()) {
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
            Чат «{chat.title ?? 'Без названия'}» и все дочерние чаты будут удалены навсегда.
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

function FavoriteChatsSection({
  workspaceId,
  allChats,
  favoriteChatIds,
}: {
  workspaceId: string
  allChats: ChatItem[]
  favoriteChatIds: Set<string>
}) {
  const [open, setOpen] = useState(true)
  const favorites = trpc.chat.listFavorites.useQuery({ workspaceId })
  const favChats = favorites.data ?? []
  const hasFavorites = favChats.length > 0 || favoriteChatIds.size > 0

  if (!hasFavorites && favorites.isFetched) return null

  return (
    <Box>
      <Box
        onClick={() => setOpen((prev) => !prev)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1,
          py: 0.75,
          cursor: 'pointer',
          color: 'text.secondary',
          '&:hover': { color: 'text.primary' },
        }}
      >
        <StarIcon sx={{ fontSize: 16 }} />
        <Typography
          variant="overline"
          sx={{ color: 'inherit', flex: 1, letterSpacing: '0.06em', lineHeight: 1.4 }}
        >
          ИЗБРАННОЕ
        </Typography>
        {open ? (
          <ArrowDropUpIcon sx={{ fontSize: 16 }} />
        ) : (
          <ArrowDropDownIcon sx={{ fontSize: 16 }} />
        )}
      </Box>

      {open ? (
        <Stack spacing={0.25} sx={{ maxHeight: 200, overflow: 'auto' }}>
          {favChats.map((chat) => (
            <ChatTreeItem
              key={chat.id}
              chat={allChats.find((item) => item.id === chat.id) ?? chat}
              workspaceId={workspaceId}
              allChats={allChats}
              favoriteChatIds={favoriteChatIds}
            />
          ))}
        </Stack>
      ) : null}
    </Box>
  )
}

export function SearchSidebarSection({ workspaceId }: Props) {
  const router = useRouter()
  const chats = trpc.chat.listChats.useQuery({ workspaceId })
  const favorites = trpc.chat.listFavorites.useQuery({ workspaceId })
  const favoriteChatIds = useMemo(
    () => new Set((favorites.data ?? []).map((chat) => chat.id)),
    [favorites.data],
  )

  const rootChats = useMemo(
    () =>
      (chats.data ?? [])
        .filter((c) => !c.parentId)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [chats.data],
  )

  return (
    <Box sx={{ display: 'flex', minHeight: 0, flex: 1, flexDirection: 'column', gap: 1 }}>
      <FavoriteChatsSection
        workspaceId={workspaceId}
        allChats={chats.data ?? []}
        favoriteChatIds={favoriteChatIds}
      />

      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
            gap: 1,
          }}
        >
          <Typography variant="overline" sx={{ color: 'text.secondary', letterSpacing: '0.06em' }}>
            Чаты
          </Typography>
          <IconButton
            aria-label="Новый чат"
            size="small"
            onClick={() => router.push(`/workspaces/${workspaceId}/chats/new`)}
          >
            <AddIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>

        <Stack spacing={0.25} sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {rootChats.map((chat) => (
            <ChatTreeItem
              key={chat.id}
              chat={chat}
              workspaceId={workspaceId}
              allChats={chats.data ?? []}
              favoriteChatIds={favoriteChatIds}
            />
          ))}
        </Stack>
      </Box>
    </Box>
  )
}
