'use client'

import type { ReactNode } from 'react'

import { Box, Paper, Stack, Typography } from '@repo/ui/components'

type Props = {
  title: string
  description?: ReactNode
  tone?: 'default' | 'danger'
  children: ReactNode
}

export function SettingsCard({ title, description, tone = 'default', children }: Props) {
  const isDanger = tone === 'danger'
  return (
    <Paper
      variant="outlined"
      sx={{ p: 3, ...(isDanger ? { borderColor: 'error.main' } : null) }}
    >
      <Stack spacing={2}>
        <Box>
          <Typography variant="h6" color={isDanger ? 'error' : undefined}>
            {title}
          </Typography>
          {description ? (
            <Typography variant="body2" color="text.secondary">
              {description}
            </Typography>
          ) : null}
        </Box>
        {children}
      </Stack>
    </Paper>
  )
}
