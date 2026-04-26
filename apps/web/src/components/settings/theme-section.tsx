'use client'

import { Box, Stack, Typography } from '@repo/ui/components'
import { useThemeMode } from '@repo/ui/providers'

import { trpc } from '@/trpc/client'

type Theme = 'light' | 'dark' | 'system'

const options: Array<{ value: Theme; label: string; preview: React.CSSProperties }> = [
  {
    value: 'light',
    label: 'Светлая',
    preview: { background: '#fff', border: '1px solid #e5e7eb' },
  },
  {
    value: 'dark',
    label: 'Тёмная',
    preview: { background: '#0c0d10', border: '1px solid #1e2024' },
  },
  {
    value: 'system',
    label: 'Системная',
    preview: {
      background: 'linear-gradient(90deg,#fff 50%,#0c0d10 50%)',
      border: '1px solid #d1d5db',
    },
  },
]

export function ThemeSection() {
  const { preference, setPreference } = useThemeMode()
  const setTheme = trpc.user.setTheme.useMutation()

  const choose = (theme: Theme) => {
    setPreference(theme)
    document.cookie = `theme=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`
    setTheme.mutate({ theme })
  }

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
        Тема оформления
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Выберите светлую, тёмную или автоматическую тему
      </Typography>
      <Stack direction="row" spacing={1.5}>
        {options.map((opt) => {
          const active = preference === opt.value
          return (
            <Box
              key={opt.value}
              onClick={() => choose(opt.value)}
              sx={{
                flex: 1,
                p: 1.5,
                borderRadius: 1.5,
                border: active ? '2px solid' : '1px solid',
                borderColor: active ? 'primary.main' : 'divider',
                cursor: 'pointer',
                textAlign: 'center',
              }}
            >
              <Box sx={{ height: 36, borderRadius: 1, mb: 1, ...opt.preview }} />
              <Typography variant="caption" fontWeight={active ? 700 : 400}>
                {opt.label}
              </Typography>
            </Box>
          )
        })}
      </Stack>
    </Box>
  )
}
