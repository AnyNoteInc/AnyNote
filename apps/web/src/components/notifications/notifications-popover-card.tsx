'use client'

import { useEffect, useLayoutEffect, useRef } from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import type { NotificationEvent } from '@repo/db'
import { Box, Button, Stack, Typography } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { NotificationRow } from './notification-row'
import { formatNotification } from './format-notification'
import { groupNotifications } from './group-notifications'

type EventForFormat = Pick<NotificationEvent, 'type' | 'payload' | 'resourceUrl'>

type Props = Readonly<{
  onNavigate: () => void
  onLayoutChange?: () => void
}>

export function NotificationsPopoverCard({ onNavigate, onLayoutChange }: Props) {
  const router = useRouter()
  const utils = trpc.useUtils()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const list = trpc.notification.list.useInfiniteQuery(
    { limit: 20 },
    { getNextPageParam: (p) => p.nextCursor ?? undefined },
  )
  const markRead = trpc.notification.markRead.useMutation({
    onSuccess: () => utils.notification.unreadCount.invalidate(),
  })

  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  const unreadIds = items.filter((i) => i.readAt === null).map((i) => i.id)
  const itemCount = items.length
  // Collapse a burst of activity on the same page/thread under one header.
  const groups = groupNotifications(items)

  useLayoutEffect(() => {
    onLayoutChange?.()
  }, [itemCount, list.isFetching, onLayoutChange])

  useEffect(() => {
    const node = containerRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => onLayoutChange?.())
    observer.observe(node)
    return () => observer.disconnect()
  }, [onLayoutChange])

  // Mark visible unread as read (debounced).
  const seenRef = useRef(new Set<string>())
  const unreadKey = unreadIds.join(',')
  useEffect(() => {
    const fresh = unreadIds.filter((id) => !seenRef.current.has(id))
    if (fresh.length === 0) return
    fresh.forEach((id) => seenRef.current.add(id))
    const t = setTimeout(() => {
      markRead.mutate({ ids: fresh.slice(0, 50) })
    }, 800)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadKey])

  return (
    <Box
      ref={containerRef}
      sx={{ width: 360, maxHeight: 480, display: 'flex', flexDirection: 'column' }}
    >
      <Stack
        direction="row"

        sx={{
          p: 1.5,
          borderBottom: 1,
          borderColor: 'divider',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          Уведомления
        </Typography>
        <Button size="small" component={Link} href="/notifications" onClick={onNavigate}>
          Все →
        </Button>
      </Stack>
      <Box sx={{ flex: 1, overflowY: 'auto', p: 0.5 }}>
        {items.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
            Здесь будут ваши уведомления
          </Typography>
        ) : (
          groups.map((group) => {
            const grouped = group.pageId !== null && group.items.length > 1
            return (
              <Box key={group.key}>
                {grouped ? (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ px: 1.5, pt: 1, display: 'block', fontWeight: 600 }}
                  >
                    На странице · {group.items.length} уведомлений
                  </Typography>
                ) : null}
                {group.items.map((item) => {
                  const event = item.event as unknown as EventForFormat
                  return (
                    <NotificationRow
                      key={item.id}
                      formatted={formatNotification(event)}
                      unread={item.readAt === null}
                      createdAt={new Date(item.createdAt)}
                      onClick={async () => {
                        if (item.readAt === null) await markRead.mutateAsync({ ids: [item.id] })
                        if (event.resourceUrl) {
                          router.push(event.resourceUrl)
                          onNavigate()
                        }
                      }}
                    />
                  )
                })}
              </Box>
            )
          })
        )}
      </Box>
    </Box>
  )
}
