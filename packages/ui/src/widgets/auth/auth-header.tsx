'use client'

import { BrandIcon, Stack, Typography } from '@repo/ui/components'

export type AuthHeaderProps = {
  title: string
}

export function AuthHeader({ title }: AuthHeaderProps) {
  return (
    <Stack spacing={1.5} alignItems="center">
      <BrandIcon size={56} />
      <Typography variant="h5" fontWeight={700} textAlign="center">
        {title}
      </Typography>
    </Stack>
  )
}
