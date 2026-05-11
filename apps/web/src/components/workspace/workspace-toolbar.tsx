'use client'

import Link from 'next/link'

import { Box, Stack, Typography } from '@repo/ui/components'

import type { ReactNode } from 'react'

type Breadcrumb = { label: string; href?: string }

type Props = {
  breadcrumbs: Breadcrumb[]
  rightSlot?: ReactNode
}

export function WorkspaceToolbar({ breadcrumbs, rightSlot }: Props) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1.25}
      className="workspace-toolbar"
      sx={{
        px: 2,
        py: 1.25,
        borderBottom: '1px solid',
        borderColor: 'divider',
      }}
    >
      {breadcrumbs.map((crumb, i) => {
        const isLast = i === breadcrumbs.length - 1
        return (
          <Stack key={i} direction="row" alignItems="center" spacing={1.25}>
            {i > 0 && (
              <Typography variant="body2" color="text.disabled">
                /
              </Typography>
            )}
            {crumb.href && !isLast ? (
              <Typography
                component={Link}
                href={crumb.href}
                variant="body2"
                noWrap
                sx={{
                  color: 'text.secondary',
                  textDecoration: 'none',
                  '&:hover': { color: 'text.primary', textDecoration: 'underline' },
                }}
              >
                {crumb.label}
              </Typography>
            ) : (
              <Typography variant="body2" noWrap color={isLast ? 'text.primary' : 'text.secondary'}>
                {crumb.label}
              </Typography>
            )}
          </Stack>
        )
      })}
      <Box sx={{ flex: 1 }} />
      {rightSlot}
    </Stack>
  )
}
