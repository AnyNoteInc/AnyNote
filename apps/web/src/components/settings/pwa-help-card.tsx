'use client'

import { Box, Button, InstallDesktopIcon, Typography } from '@repo/ui/components'

import { usePwaInstall } from '@/components/pwa/pwa-install-context'

/**
 * Honest help card for the installable app. Copy rule: never promise offline
 * editing — the installed shell opens without a network, the data does not.
 */
export function PwaHelpCard() {
  const { canInstall, isInstalled, promptInstall } = usePwaInstall()

  return (
    <Box
      data-testid="pwa-help-card"
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        p: { xs: 2.5, md: 3 },
        backgroundColor: 'background.paper',
      }}
    >
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
        Приложение AnyNote
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {isInstalled
          ? 'AnyNote установлен как приложение и открывается в отдельном окне.'
          : 'Сейчас вы работаете в браузере. AnyNote можно установить как приложение: отдельное окно, иконка на рабочем столе и быстрый запуск.'}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        Установленное приложение открывается без сети, но страницы и данные требуют подключения —
        офлайн-редактирование не поддерживается.
      </Typography>
      {canInstall && (
        <Button
          variant="outlined"
          size="small"
          startIcon={<InstallDesktopIcon />}
          onClick={() => void promptInstall()}
          sx={{ mt: 2 }}
        >
          Установить приложение
        </Button>
      )}
    </Box>
  )
}
