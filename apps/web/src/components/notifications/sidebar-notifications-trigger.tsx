'use client'

import { useState } from 'react'

import { Badge, Box, NotificationsIcon, Popover, Stack } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { NotificationsPopoverCard } from './notifications-popover-card'

export function SidebarNotificationsTrigger() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const unread = trpc.notification.unreadCount.useQuery(undefined, { refetchInterval: 30_000 })

  return (
    <>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={{
          px: 1,
          py: 0.75,
          borderRadius: 0.75,
          cursor: 'pointer',
          color: 'text.secondary',
          fontSize: 13,
          '&:hover': { backgroundColor: 'action.hover' },
        }}
      >
        <Badge badgeContent={unread.data ?? 0} max={99} color="error">
          <NotificationsIcon sx={{ fontSize: 16 }} />
        </Badge>
        <Box component="span" sx={{ flex: 1 }}>
          Уведомления
        </Box>
      </Stack>
      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <NotificationsPopoverCard onNavigate={() => setAnchor(null)} />
      </Popover>
    </>
  )
}
