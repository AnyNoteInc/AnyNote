'use client'

import { useState } from 'react'

import { Badge, IconButton, NotificationsIcon, Popover, Tooltip } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { NotificationsPopoverCard } from './notifications-popover-card'

type Props = {
  size?: 'small' | 'medium'
  tooltipPlacement?: 'top' | 'right' | 'bottom' | 'left'
}

export function NotificationsBell({ size = 'small', tooltipPlacement = 'top' }: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const unread = trpc.notification.unreadCount.useQuery(undefined, { refetchInterval: 30_000 })
  const close = () => setAnchor(null)

  return (
    <>
      <Tooltip title="Уведомления" placement={tooltipPlacement}>
        <IconButton
          size={size}
          onClick={(event) => setAnchor(event.currentTarget)}
          aria-label="Уведомления"
          sx={{
            width: 40,
            height: 40,
            borderRadius: 0.75,
            color: 'text.secondary',
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          <Badge badgeContent={unread.data ?? 0} max={99} color="error">
            <NotificationsIcon sx={{ fontSize: 18 }} />
          </Badge>
        </IconButton>
      </Tooltip>
      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <NotificationsPopoverCard onNavigate={close} />
      </Popover>
    </>
  )
}
