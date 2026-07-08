'use client'

import { useState } from 'react'

import { Alert, Box, Button, Chip, Stack, Typography } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

function formatDate(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Personal Telegram account link card (settings → integrations). Linking
 * happens in the bot chat: the user sends `/link CODE` to the workspace bot;
 * the one-time code is shown here exactly once.
 */
export function TelegramLinkCard() {
  const utils = trpc.useUtils()
  const linkQ = trpc.telegram.getMyLink.useQuery()
  const [issuedCode, setIssuedCode] = useState<string | null>(null)

  const createCode = trpc.telegram.createLinkCode.useMutation({
    onSuccess: (data) => setIssuedCode(data.code),
  })
  const unlink = trpc.telegram.unlinkMe.useMutation({
    onSuccess: () => {
      setIssuedCode(null)
      utils.telegram.getMyLink.invalidate()
    },
  })

  const link = linkQ.data ?? null
  const error = createCode.error ?? unlink.error

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        p: 2.5,
        backgroundColor: 'background.paper',
        height: '100%',
      }}
    >
      <Stack spacing={1.5} sx={{ height: '100%' }}>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}
        >
          <Stack spacing={0.5}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Телеграм
            </Typography>
            <Chip size="small" label="Личный аккаунт" />
          </Stack>
          {link ? <Chip size="small" label="Привязан" color="success" /> : null}
        </Stack>

        {error ? <Alert severity="error">{error.message}</Alert> : null}

        {link ? (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
              {link.username ? `@${link.username}` : 'Аккаунт Телеграм'} привязан{' '}
              {formatDate(link.linkedAt)}. Команды бота /search и /get доступны вам в чатах
              пространства.
            </Typography>
            <Button
              variant="outlined"
              color="error"
              size="small"
              onClick={() => unlink.mutate()}
              loading={unlink.isPending}
              sx={{ alignSelf: 'flex-start' }}
            >
              Отвязать
            </Button>
          </>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary">
              Привяжите свой аккаунт Телеграм, чтобы пользоваться командами бота вашего
              пространства.
            </Typography>
            {issuedCode ? (
              <Stack spacing={1} sx={{ flex: 1 }}>
                <Box
                  data-testid="telegram-link-code"
                  sx={{
                    fontFamily: 'monospace',
                    fontSize: 18,
                    letterSpacing: 2,
                    textAlign: 'center',
                    p: 1.5,
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1,
                    bgcolor: 'action.hover',
                  }}
                >
                  {issuedCode}
                </Box>
                <Typography variant="body2">
                  Отправьте боту вашего пространства:{' '}
                  <Box component="code" sx={{ fontFamily: 'monospace' }}>
                    /link {issuedCode}
                  </Box>
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Код действует 15 минут и показывается только один раз.
                </Typography>
              </Stack>
            ) : (
              <Box sx={{ flex: 1 }} />
            )}
            <Button
              variant="contained"
              size="small"
              onClick={() => createCode.mutate()}
              loading={createCode.isPending}
              sx={{ alignSelf: 'flex-start' }}
            >
              {issuedCode ? 'Получить новый код' : 'Получить код'}
            </Button>
          </>
        )}
      </Stack>
    </Box>
  )
}
