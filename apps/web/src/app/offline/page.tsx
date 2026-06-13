import type { Metadata } from 'next'

import { Stack, Typography } from '@repo/ui/components'

import { RetryButton } from './retry-button'

// The service worker precaches this page and serves it as the fallback for
// failed navigations, so it must render without a session (outside
// `(protected)`) and stay tiny: no tRPC, no data fetching.
export const metadata: Metadata = {
  title: 'Нет подключения к интернету',
  robots: { index: false, follow: false },
}

export default function OfflinePage() {
  return (
    <Stack
      component="main"
      spacing={2}
      sx={{
        minHeight: '100dvh',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        px: 3,
      }}
    >
      <Typography variant="h4" component="h1">
        Нет подключения к интернету
      </Typography>
      <Typography color="text.secondary">
        Проверьте сеть и попробуйте ещё раз — страницы и данные AnyNote требуют подключения.
      </Typography>
      <RetryButton />
    </Stack>
  )
}
