'use client'

import type { NotificationCategory, NotificationChannel } from '@repo/notifications'
import { Box, Button, Stack, Switch, Tooltip, Typography } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { PushToggle } from '../notifications/push-toggle'

// Subset of categories surfaced in the matrix UI. SERVICE is hidden — its
// channels are all locked/required, so users have nothing to toggle.
type Category = Exclude<NotificationCategory, 'SERVICE'>
type Channel = NotificationChannel
type Cell = { enabled: boolean; locked: boolean }
type PrefsMatrix = Record<Category, Record<Channel, Cell>>

const CATEGORIES: ReadonlyArray<{ key: Category; label: string }> = [
  { key: 'SECURITY', label: 'Безопасность' },
  { key: 'COLLABORATION', label: 'Совместная работа' },
  { key: 'MARKETING', label: 'Маркетинг и дайджест' },
]
const CHANNELS: ReadonlyArray<{ key: Channel; label: string }> = [
  { key: 'EMAIL', label: 'Email' },
  { key: 'IN_APP', label: 'In-app' },
  { key: 'WEB_PUSH', label: 'Web push' },
]

type SwitchCellProps = Readonly<{
  cell: Cell
  onChange: (checked: boolean) => Promise<void>
  isPending: boolean
}>

function SwitchCell({ cell, onChange, isPending }: SwitchCellProps) {
  const tooltip = cell.locked ? 'Это уведомление обязательное' : ''
  return (
    <Box sx={{ textAlign: 'center' }}>
      <Tooltip title={tooltip}>
        <span>
          <Switch
            checked={cell.enabled}
            disabled={cell.locked || isPending}
            onChange={(_e, checked) => {
              void onChange(checked)
            }}
          />
        </span>
      </Tooltip>
    </Box>
  )
}

type CategoryRowProps = Readonly<{
  category: { key: Category; label: string }
  matrix: PrefsMatrix
  hasAnySubscription: boolean
  refresh: () => void
  onChangePreference: (category: Category, channel: Channel, enabled: boolean) => Promise<void>
  isPending: boolean
}>

function CategoryRow({
  category,
  matrix,
  hasAnySubscription,
  refresh,
  onChangePreference,
  isPending,
}: CategoryRowProps) {
  return (
    <Box sx={{ display: 'contents' }}>
      <Typography variant="body2">{category.label}</Typography>
      {CHANNELS.map((ch) => {
        const cell = matrix[category.key][ch.key]
        if (!cell) return null
        if (ch.key === 'WEB_PUSH') {
          return (
            <Box key={ch.key} sx={{ textAlign: 'center' }}>
              <PushToggle
                category={category.key}
                enabled={cell.enabled}
                locked={cell.locked}
                onAfterChange={refresh}
                hasAnySubscription={hasAnySubscription}
              />
            </Box>
          )
        }
        return (
          <SwitchCell
            key={ch.key}
            cell={cell}
            isPending={isPending}
            onChange={(checked) => onChangePreference(category.key, ch.key, checked)}
          />
        )
      })}
    </Box>
  )
}

export function PreferencesMatrix() {
  const utils = trpc.useUtils()
  const prefs = trpc.notification.getPreferences.useQuery()
  const subs = trpc.notification.listPushSubscriptions.useQuery()
  const setPref = trpc.notification.setPreference.useMutation({
    onSuccess: () => utils.notification.getPreferences.invalidate(),
  })
  const revoke = trpc.notification.revokePushSubscription.useMutation({
    onSuccess: () => utils.notification.listPushSubscriptions.invalidate(),
  })

  const refresh = () => {
    utils.notification.getPreferences.invalidate()
    utils.notification.listPushSubscriptions.invalidate()
  }

  const onChangePreference = async (category: Category, channel: Channel, enabled: boolean) => {
    await setPref.mutateAsync({ category, channel, enabled }).catch(() => undefined)
  }

  if (!prefs.data) return null

  const hasAnySubscription = (subs.data?.length ?? 0) > 0
  const matrix = prefs.data as PrefsMatrix

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        p: { xs: 2.5, md: 3 },
        bgcolor: 'background.paper',
      }}
    >
      <Typography variant="subtitle1" fontWeight={700}>
        Уведомления
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Когда присылать email, in-app и web push
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: '1fr repeat(3, 96px)',
          alignItems: 'center',
          rowGap: 1,
        }}
      >
        <div />
        {CHANNELS.map((c) => (
          <Typography key={c.key} variant="caption" color="text.secondary" textAlign="center">
            {c.label}
          </Typography>
        ))}
        {CATEGORIES.map((cat) => (
          <CategoryRow
            key={cat.key}
            category={cat}
            matrix={matrix}
            hasAnySubscription={hasAnySubscription}
            refresh={refresh}
            onChangePreference={onChangePreference}
            isPending={setPref.isPending}
          />
        ))}
      </Box>
      <Stack spacing={1} sx={{ mt: 3, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
        <Typography variant="subtitle2">Устройства для push</Typography>
        {(subs.data ?? []).length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            Нет зарегистрированных устройств
          </Typography>
        ) : (
          (subs.data ?? []).map((s) => (
            <Stack key={s.id} direction="row" alignItems="center" justifyContent="space-between">
              <Stack>
                <Typography variant="body2">{s.userAgent ?? 'Устройство'}</Typography>
                <Typography variant="caption" color="text.secondary">
                  Добавлено {new Date(s.createdAt).toLocaleDateString('ru-RU')}
                </Typography>
              </Stack>
              <Button size="small" onClick={() => revoke.mutate({ id: s.id })}>
                Отозвать
              </Button>
            </Stack>
          ))
        )}
      </Stack>
    </Box>
  )
}
