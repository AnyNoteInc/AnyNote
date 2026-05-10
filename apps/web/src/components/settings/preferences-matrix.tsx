'use client'

import { Box, Button, Stack, Switch, Tooltip, Typography } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { PushToggle } from '../notifications/push-toggle'

type Category = 'SECURITY' | 'COLLABORATION' | 'MARKETING'
type Channel = 'EMAIL' | 'IN_APP' | 'WEB_PUSH'

const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'SECURITY', label: 'Безопасность' },
  { key: 'COLLABORATION', label: 'Совместная работа' },
  { key: 'MARKETING', label: 'Маркетинг и дайджест' },
]
const CHANNELS: { key: Channel; label: string }[] = [
  { key: 'EMAIL', label: 'Email' },
  { key: 'IN_APP', label: 'In-app' },
  { key: 'WEB_PUSH', label: 'Web push' },
]

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

  if (!prefs.data) return null

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
          <Box key={cat.key} sx={{ display: 'contents' }}>
            <Typography variant="body2">{cat.label}</Typography>
            {CHANNELS.map((ch) => {
              const cell = prefs.data[cat.key][ch.key]
              if (ch.key === 'WEB_PUSH') {
                return (
                  <Box key={ch.key} sx={{ textAlign: 'center' }}>
                    <PushToggle
                      category={cat.key}
                      enabled={cell.enabled}
                      locked={cell.locked}
                      onAfterChange={refresh}
                      hasAnySubscription={(subs.data?.length ?? 0) > 0}
                    />
                  </Box>
                )
              }
              const tooltip = cell.locked ? 'Это уведомление обязательное' : ''
              return (
                <Box key={ch.key} sx={{ textAlign: 'center' }}>
                  <Tooltip title={tooltip}>
                    <span>
                      <Switch
                        checked={cell.enabled}
                        disabled={cell.locked || setPref.isPending}
                        onChange={async (_e, checked) => {
                          await setPref
                            .mutateAsync({
                              category: cat.key,
                              channel: ch.key,
                              enabled: checked,
                            })
                            .catch(() => undefined)
                        }}
                      />
                    </span>
                  </Tooltip>
                </Box>
              )
            })}
          </Box>
        ))}
      </Box>
      <Stack
        spacing={1}
        sx={{ mt: 3, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}
      >
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
