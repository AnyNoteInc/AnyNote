import { Box, Button, Stack, Typography } from '@repo/ui/components'

export type FormUnavailableState =
  | { status: 'SCHEDULED'; opensAt: Date }
  | {
      status: 'CLOSED' | 'CAPPED' | 'AUTH_REQUIRED' | 'POLICY_DISABLED' | 'UNAVAILABLE'
    }

const COPY: Record<
  Exclude<FormUnavailableState['status'], 'SCHEDULED'>,
  { eyebrow: string; title: string; body: string }
> = {
  CLOSED: {
    eyebrow: 'Приём закрыт',
    title: 'Приём ответов завершён',
    body: 'Организация больше не принимает ответы через эту форму.',
  },
  CAPPED: {
    eyebrow: 'Форма заполнена',
    title: 'Лимит ответов достигнут',
    body: 'Все доступные ответы уже собраны. Спасибо за интерес.',
  },
  AUTH_REQUIRED: {
    eyebrow: 'Требуется вход',
    title: 'Форма доступна после входа',
    body: 'Войдите в AnyNote, чтобы подтвердить доступ и продолжить заполнение.',
  },
  POLICY_DISABLED: {
    eyebrow: 'Политика пространства',
    title: 'Публичный доступ отключён',
    body: 'Администратор пространства отключил публичные формы.',
  },
  UNAVAILABLE: {
    eyebrow: 'Нет доступа',
    title: 'Форма недоступна',
    body: 'Проверьте ссылку или обратитесь к автору формы.',
  },
}

export function FormUnavailable({
  locator,
  state,
}: {
  locator: string
  state: FormUnavailableState
}) {
  const content =
    state.status === 'SCHEDULED'
      ? {
          eyebrow: 'Запланировано',
          title: 'Форма откроется позже',
          body: `Начало приёма: ${new Intl.DateTimeFormat('ru-RU', {
            dateStyle: 'long',
            timeStyle: 'short',
          }).format(state.opensAt)}.`,
        }
      : COPY[state.status]

  return (
    <Box
      component="main"
      sx={{
        minHeight: '100vh',
        display: 'grid',
        gridTemplateRows: 'minmax(180px, 32vh) 1fr',
        bgcolor: 'background.default',
        color: 'text.primary',
      }}
    >
      <Box
        aria-hidden
        sx={{
          position: 'relative',
          overflow: 'hidden',
          background:
            'linear-gradient(120deg, rgba(21,101,192,0.96), rgba(80,54,160,0.92) 58%, rgba(0,150,136,0.8))',
          '&::after': {
            content: '""',
            position: 'absolute',
            width: 360,
            height: 360,
            right: '-6%',
            top: '-70%',
            borderRadius: '50%',
            border: '72px solid rgba(255,255,255,0.1)',
          },
        }}
      />
      <Stack
        spacing={2}
        sx={{
          width: 'min(100% - 40px, 760px)',
          mx: 'auto',
          py: { xs: 5, md: 8 },
          alignItems: 'flex-start',
        }}
      >
        <Typography variant="overline" color="primary.main" sx={{ fontWeight: 800 }}>
          {content.eyebrow}
        </Typography>
        <Typography component="h1" variant="h3" sx={{ fontWeight: 780, letterSpacing: '-0.035em' }}>
          {content.title}
        </Typography>
        <Typography color="text.secondary" sx={{ maxWidth: 580, fontSize: '1.05rem' }}>
          {content.body}
        </Typography>
        {state.status === 'AUTH_REQUIRED' ? (
          <Button
            component="a"
            variant="contained"
            href={`/sign-in?redirect=${encodeURIComponent(`/f/${encodeURIComponent(locator)}`)}`}
            sx={{ mt: 1, minHeight: 44, px: 3, borderRadius: 999 }}
          >
            Войти и продолжить
          </Button>
        ) : null}
        <Typography variant="caption" color="text.secondary" sx={{ pt: 4 }}>
          Создано в AnyNote
        </Typography>
      </Stack>
    </Box>
  )
}
