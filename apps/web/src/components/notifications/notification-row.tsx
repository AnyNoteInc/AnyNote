'use client'

import {
  AdminPanelSettingsIcon,
  AlternateEmailIcon,
  Box,
  CampaignIcon,
  ChatBubbleOutlineIcon,
  EmailIcon,
  PersonAddIcon,
  SecurityIcon,
  Stack,
  Typography,
} from '@repo/ui/components'

import type { FormattedNotification } from './format-notification'

const ICON_MAP = {
  invite: PersonAddIcon,
  security: SecurityIcon,
  role: AdminPanelSettingsIcon,
  mention: AlternateEmailIcon,
  comment: ChatBubbleOutlineIcon,
  marketing: CampaignIcon,
  system: EmailIcon,
} as const

type Props = Readonly<{
  formatted: FormattedNotification
  unread: boolean
  createdAt: Date
  onClick: () => void
}>

function timeAgo(d: Date): string {
  const sec = Math.round((Date.now() - d.getTime()) / 1000)
  if (sec < 60) return 'только что'
  if (sec < 3600) return `${Math.round(sec / 60)} мин назад`
  if (sec < 86400) return `${Math.round(sec / 3600)} ч назад`
  return d.toLocaleDateString('ru-RU')
}

export function NotificationRow({ formatted, unread, createdAt, onClick }: Props) {
  const Icon = ICON_MAP[formatted.icon] ?? EmailIcon
  return (
    <Stack
      direction="row"
      spacing={1.5}
      onClick={onClick}
      sx={{
        p: 1.5,
        cursor: 'pointer',
        borderRadius: 1,
        bgcolor: unread ? 'action.selected' : 'transparent',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Box sx={{ pt: 0.5 }}>
        <Icon fontSize="small" />
      </Box>
      <Stack spacing={0.25} sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" fontWeight={unread ? 600 : 400} noWrap>
          {formatted.title}
        </Typography>
        {formatted.body ? (
          <Typography variant="caption" color="text.secondary" noWrap>
            {formatted.body}
          </Typography>
        ) : null}
        <Typography variant="caption" color="text.disabled">
          {timeAgo(createdAt)}
        </Typography>
      </Stack>
      {unread ? (
        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'primary.main', mt: 1 }} />
      ) : null}
    </Stack>
  )
}
