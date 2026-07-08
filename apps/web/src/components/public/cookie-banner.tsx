'use client'

import { useEffect, useState } from 'react'

import { Box, Button, Stack, Typography } from '@repo/ui/components'

const COOKIE_NAME = 'cookie-consent'

function readConsent(): string | null {
  if (typeof document === 'undefined') return null
  const cookies = document.cookie.split(';').map((c) => c.trim())
  for (const c of cookies) {
    if (c.startsWith(`${COOKIE_NAME}=`)) {
      return c.slice(COOKIE_NAME.length + 1)
    }
  }
  return null
}

function setConsent(value: string) {
  document.cookie = `${COOKIE_NAME}=${value}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`
}

export function CookieBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (readConsent() === null) {
      setVisible(true)
    }
  }, [])

  if (!visible) return null

  const accept = () => {
    setConsent('accepted')
    setVisible(false)
  }

  const reject = () => {
    window.location.href = 'https://ya.ru'
  }

  return (
    <Box
      role="dialog"
      aria-live="polite"
      aria-label="Использование cookie"
      sx={{
        position: 'fixed',
        bottom: { xs: 12, md: 24 },
        left: { xs: 12, md: 24 },
        right: { xs: 12, md: 24 },
        maxWidth: 720,
        mx: { xs: 0, md: 'auto' },
        bgcolor: 'background.paper',
        color: 'text.primary',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        boxShadow: '0 24px 60px rgba(0,0,0,0.18)',
        zIndex: 1300,
        p: { xs: 2, md: 2.5 },
      }}
    >
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={{ xs: 1.5, sm: 2 }}
        sx={{ alignItems: { sm: 'center' } }}
      >
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontSize: 14, lineHeight: 1.55, color: 'text.primary' }}>
            Мы используем cookie, чтобы сайт работал корректно и улучшался. Продолжая, вы
            соглашаетесь с нашей{' '}
            <Box
              component="a"
              href="/terms/privacy-policy"
              sx={{ color: 'primary.main', textDecoration: 'underline' }}
            >
              политикой
            </Box>
            .
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button
            onClick={reject}
            variant="outlined"
            size="small"
            sx={{
              minWidth: 110,
              borderRadius: 1.25,
              color: 'text.primary',
              borderColor: 'divider',
            }}
          >
            Отклонить
          </Button>
          <Button
            onClick={accept}
            variant="contained"
            size="small"
            sx={{ minWidth: 110, borderRadius: 1.25 }}
          >
            Принять
          </Button>
        </Stack>
      </Stack>
    </Box>
  )
}
