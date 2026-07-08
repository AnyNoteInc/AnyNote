'use client'

import { useEffect, useState } from 'react'

import {
  Button,
  CloseIcon,
  IconButton,
  InstallDesktopIcon,
  Paper,
  Stack,
  Typography,
} from '@repo/ui/components'

import { PWA_INSTALL_BANNER_DISMISS_KEY } from '@/lib/pwa'

import { usePwaInstall } from './pwa-install-context'

/**
 * One-time install suggestion shown in the protected app shell. Hidden until
 * the browser fires `beforeinstallprompt`; a dismissal is persisted forever.
 */
export function InstallPromptBanner() {
  const { canInstall, promptInstall } = usePwaInstall()
  // Start dismissed so the SSR/first client render never flashes the banner;
  // the effect re-reads the persisted choice after mount.
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(PWA_INSTALL_BANNER_DISMISS_KEY) === '1')
    } catch {
      setDismissed(false)
    }
  }, [])

  const dismiss = () => {
    setDismissed(true)
    try {
      window.localStorage.setItem(PWA_INSTALL_BANNER_DISMISS_KEY, '1')
    } catch {
      // Private mode: the banner stays hidden for this session only.
    }
  }

  if (!canInstall || dismissed) return null

  return (
    <Paper
      data-testid="pwa-install-banner"
      elevation={6}
      sx={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        zIndex: (theme) => theme.zIndex.snackbar,
        p: 2,
        maxWidth: 360,
        borderRadius: 2,
      }}
    >
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start' }}>
        <InstallDesktopIcon color="primary" sx={{ mt: 0.25 }} />
        <Stack spacing={1} sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            Установите AnyNote как приложение
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Отдельное окно и быстрый запуск с рабочего стола. Для работы по-прежнему нужно
            подключение к сети.
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant="contained"
              onClick={() => {
                void promptInstall().then((accepted) => {
                  if (accepted) dismiss()
                })
              }}
            >
              Установить
            </Button>
            <Button size="small" color="inherit" onClick={dismiss}>
              Не сейчас
            </Button>
          </Stack>
        </Stack>
        <IconButton size="small" aria-label="Скрыть" onClick={dismiss}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>
    </Paper>
  )
}
