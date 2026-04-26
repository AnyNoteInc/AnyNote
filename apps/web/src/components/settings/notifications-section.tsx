'use client'

import { useState } from 'react'

import { Box, Stack, Switch, Typography } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

type NotificationSettings = {
  email: { mentions: boolean; comments: boolean; weeklyDigest: boolean }
}

const defaultSettings: NotificationSettings = {
  email: { mentions: true, comments: true, weeklyDigest: false },
}

export function NotificationsSection({ initial }: { initial: NotificationSettings | null }) {
  const [value, setValue] = useState<NotificationSettings>(initial ?? defaultSettings)
  const mutate = trpc.user.setNotificationSettings.useMutation()

  const toggle =
    (key: keyof NotificationSettings['email']) => async (_: unknown, checked: boolean) => {
      const next: NotificationSettings = {
        email: { ...value.email, [key]: checked },
      }
      setValue(next)
      await mutate.mutateAsync(next)
    }

  const rows = [
    {
      key: 'mentions' as const,
      title: 'Упоминания',
      desc: 'Когда вас упоминают в странице или комментарии',
    },
    {
      key: 'comments' as const,
      title: 'Комментарии',
      desc: 'Новые комментарии в документах, где вы участник',
    },
    {
      key: 'weeklyDigest' as const,
      title: 'Еженедельный дайджест',
      desc: 'Сводка активности раз в неделю',
    },
  ]

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        p: { xs: 2.5, md: 3 },
        backgroundColor: 'background.paper',
      }}
    >
      <Typography variant="subtitle1" fontWeight={700}>
        Уведомления
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Когда присылать email, push и in-app
      </Typography>
      <Stack spacing={1.5}>
        {rows.map((row, i) => (
          <Stack
            key={row.key}
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            sx={{
              py: 1,
              borderBottom: i < rows.length - 1 ? '1px solid' : 'none',
              borderColor: 'divider',
            }}
          >
            <Stack spacing={0.25}>
              <Typography variant="body2" fontWeight={600}>
                {row.title}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {row.desc}
              </Typography>
            </Stack>
            <Switch checked={value.email[row.key]} onChange={toggle(row.key)} />
          </Stack>
        ))}
      </Stack>
    </Box>
  )
}
