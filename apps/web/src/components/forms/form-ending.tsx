'use client'

import { Box, Button, Stack, Typography } from '@repo/ui/components'
import type { FormEnding } from '@repo/domain/database/forms'

export function FormEnding({ ending, preview = false }: { ending: FormEnding; preview?: boolean }) {
  return (
    <Stack spacing={2} sx={{ py: { xs: 5, md: 8 }, alignItems: 'flex-start' }}>
      <Box
        aria-hidden
        sx={{
          width: 48,
          height: 4,
          borderRadius: 99,
          background: 'linear-gradient(90deg, primary.main, secondary.main)',
        }}
      />
      <Typography component="h2" variant="h4" sx={{ fontWeight: 800, letterSpacing: '-0.025em' }}>
        {ending.title}
      </Typography>
      {ending.body ? (
        <Typography color="text.secondary" sx={{ maxWidth: 620, whiteSpace: 'pre-wrap' }}>
          {ending.body}
        </Typography>
      ) : null}
      {ending.button ? (
        <Button
          component="a"
          href={ending.button.href}
          variant="outlined"
          tabIndex={preview ? -1 : 0}
          rel="noopener noreferrer"
        >
          {ending.button.label}
        </Button>
      ) : null}
    </Stack>
  )
}
