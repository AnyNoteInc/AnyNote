'use client'

import { useEffect } from 'react'

import { Box, Button, Stack, Typography } from '@repo/ui/components'

export default function PageErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
        p: 4,
      }}
    >
      <Stack spacing={2} alignItems="center" sx={{ maxWidth: 480, textAlign: 'center' }}>
        <Typography variant="h6">Не удалось открыть страницу</Typography>
        <Typography variant="body2" color="text.secondary">
          Произошла ошибка при отображении содержимого. Попробуйте обновить.
        </Typography>
        <Button onClick={reset} variant="outlined">
          Обновить
        </Button>
      </Stack>
    </Box>
  )
}
