import type { ReactNode } from 'react'

import { Container, Paper, Stack } from '@repo/ui/components'

export { NOINDEX_METADATA as metadata } from '@/lib/seo/build-metadata'

/**
 * Public token-acceptance shell: no session requirement, no tRPC/React Query
 * providers — the segment stays RSC-pure (the accept mutation goes through
 * `/api/invite/accept`, see `@/components/invite/accept-button`).
 */
export default function InviteLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <Container
      component="main"
      maxWidth="sm"
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        py: { xs: 6, md: 10 },
      }}
    >
      <Paper
        elevation={0}
        sx={{
          width: '100%',
          p: { xs: 3, md: 4 },
          borderRadius: 2,
          border: '1px solid',
          borderColor: 'divider',
          boxShadow: '0 25px 80px rgba(15, 23, 42, 0.08)',
          backgroundColor: 'background.paper',
        }}
      >
        <Stack spacing={3}>{children}</Stack>
      </Paper>
    </Container>
  )
}
