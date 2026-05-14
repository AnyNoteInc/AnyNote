'use client'

import { useEffect, useRef, useState, type MouseEvent } from 'react'

import { useRouter } from 'next/navigation'

import type { NotificationEvent } from '@repo/db'
import {
  Box,
  Button,
  DeleteIcon,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
  MoreHorizIcon,
  Stack,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { NotificationRow } from './notification-row'
import { formatNotification } from './format-notification'

type EventForFormat = Pick<NotificationEvent, 'type' | 'payload' | 'resourceUrl'>

export function NotificationsList() {
  const router = useRouter()
  const utils = trpc.useUtils()
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const list = trpc.notification.list.useInfiniteQuery(
    { limit: 20 },
    { getNextPageParam: (page) => page.nextCursor ?? undefined },
  )
  const markRead = trpc.notification.markRead.useMutation({
    onSuccess: () => {
      utils.notification.list.invalidate()
      utils.notification.unreadCount.invalidate()
    },
  })
  const markAllRead = trpc.notification.markAllRead.useMutation({
    onSuccess: () => {
      utils.notification.list.invalidate()
      utils.notification.unreadCount.invalidate()
    },
  })
  const deleteAll = trpc.notification.deleteAll.useMutation({
    onSuccess: () => {
      setDeleteConfirmOpen(false)
      utils.notification.list.invalidate()
      utils.notification.unreadCount.invalidate()
    },
  })

  const openMenu = (event: MouseEvent<HTMLElement>) => setMenuAnchor(event.currentTarget)
  const closeMenu = () => setMenuAnchor(null)

  const handleMarkAllRead = () => {
    markAllRead.mutate()
    closeMenu()
  }

  const handleOpenDeleteConfirm = () => {
    setDeleteConfirmOpen(true)
    closeMenu()
  }

  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const hasNextPage = list.hasNextPage
  const isFetchingNextPage = list.isFetchingNextPage
  const fetchNextPage = list.fetchNextPage
  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !hasNextPage) return
    const obs = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !isFetchingNextPage) {
        fetchNextPage()
      }
    })
    obs.observe(node)
    return () => obs.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const items = list.data?.pages.flatMap((p) => p.items) ?? []

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h5" fontWeight={700}>
          Уведомления
        </Typography>
        <IconButton size="small" onClick={openMenu} aria-label="Действия с уведомлениями">
          <MoreHorizIcon fontSize="small" />
        </IconButton>
      </Stack>
      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        <MenuItem onClick={handleMarkAllRead} disabled={markAllRead.isPending}>
          Отметить все как прочитанное
        </MenuItem>
        <MenuItem
          onClick={handleOpenDeleteConfirm}
          disabled={deleteAll.isPending}
          sx={{ color: 'error.main' }}
        >
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} />
          Удалить все уведомления
        </MenuItem>
      </Menu>
      {items.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Здесь будут ваши уведомления
        </Typography>
      ) : (
        <Stack spacing={0.5}>
          {items.map((item) => {
            const event = item.event as unknown as EventForFormat
            return (
              <NotificationRow
                key={item.id}
                formatted={formatNotification(event)}
                unread={item.readAt === null}
                createdAt={new Date(item.createdAt)}
                onClick={async () => {
                  if (item.readAt === null) await markRead.mutateAsync({ ids: [item.id] })
                  if (event.resourceUrl) router.push(event.resourceUrl)
                }}
              />
            )
          })}
        </Stack>
      )}
      <Box ref={sentinelRef} sx={{ height: 1 }} />
      {list.isFetchingNextPage ? (
        <Typography variant="caption" color="text.secondary" textAlign="center">
          Загрузка…
        </Typography>
      ) : null}
      <Dialog
        open={deleteConfirmOpen}
        onClose={deleteAll.isPending ? undefined : () => setDeleteConfirmOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Удалить все уведомления?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Все уведомления будут удалены из списка. Это действие нельзя отменить.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmOpen(false)} disabled={deleteAll.isPending}>
            Отмена
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => deleteAll.mutate()}
            disabled={deleteAll.isPending}
          >
            Удалить все
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
