'use client'

import { useCallback, useRef, useState } from 'react'

import { Badge, IconButton, NotificationsIcon, Popover, Tooltip } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { NotificationsPopoverCard } from './notifications-popover-card'

type Props = Readonly<{
  size?: 'small' | 'medium'
  tooltipPlacement?: 'top' | 'right' | 'bottom' | 'left'
}>

type PopoverAction = {
  updatePosition: () => void
}

export function NotificationsBell({ size = 'medium', tooltipPlacement = 'top' }: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const popoverActionRef = useRef<PopoverAction | null>(null)
  const unread = trpc.notification.unreadCount.useQuery(undefined, { refetchInterval: 30_000 })
  const close = () => setAnchor(null)
  const updatePopoverPosition = useCallback(() => {
    popoverActionRef.current?.updatePosition()
  }, [])

  return (
    <>
      <Tooltip title="Уведомления" placement={tooltipPlacement}>
        <IconButton
          size={size}
          onClick={(event) => setAnchor(event.currentTarget)}
          aria-label="Уведомления"
          sx={{
            width: 44,
            height: 44,
            borderRadius: 0.75,
            color: 'text.secondary',
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          <Badge badgeContent={unread.data ?? 0} max={99} color="error">
            <NotificationsIcon sx={{ fontSize: 26 }} />
          </Badge>
        </IconButton>
      </Tooltip>
      <Popover
        open={!!anchor}
        anchorEl={anchor}
        action={popoverActionRef}
        onClose={close}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <NotificationsPopoverCard onNavigate={close} onLayoutChange={updatePopoverPosition} />
      </Popover>
    </>
  )
}
