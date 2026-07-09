'use client'

import { Box, BrandIcon, Stack, Typography } from '@repo/ui/components'

export type AuthHeaderProps = {
  title: string
}

export function AuthHeader({ title }: AuthHeaderProps) {
  return (
    <Stack spacing={1.5} sx={{ alignItems: 'center' }}>
      <Box
        component="a"
        href="/"
        aria-label="На главную"
        sx={{ display: 'inline-flex', textDecoration: 'none' }}
      >
        <BrandIcon size={56} />
      </Box>
      <Typography variant="h5" sx={{ textAlign: 'center', fontWeight: 700 }}>
        {title}
      </Typography>
    </Stack>
  )
}
