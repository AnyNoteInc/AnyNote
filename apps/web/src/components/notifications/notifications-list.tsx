'use client'

import { useEffect, useRef } from 'react'

import { useRouter } from 'next/navigation'

import type { NotificationEvent } from '@repo/db'
import { Box, Button, Stack, Typography } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { NotificationRow } from './notification-row'
import { formatNotification } from './format-notification'

type EventForFormat = Pick<NotificationEvent, 'type' | 'payload' | 'resourceUrl'>

export function NotificationsList() {
  const router = useRouter()
  const utils = trpc.useUtils()
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
        <Button size="small" onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending}>
          Отметить всё прочитанным
        </Button>
      </Stack>
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
    </Stack>
  )
}
