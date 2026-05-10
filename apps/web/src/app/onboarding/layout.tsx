import type { ReactNode } from 'react'

import { Container, Paper, Stack } from '@repo/ui/components'

import { TRPCReactProvider } from '@/trpc/client'
import { requireSession } from '@/lib/get-session'

export default async function OnboardingLayout({ children }: { children: ReactNode }) {
  await requireSession()
  return (
    <TRPCReactProvider>
      <Container
        component="main"
        maxWidth="sm"
        sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', py: { xs: 6, md: 10 } }}
      >
        <Paper
          elevation={0}
          sx={{
            width: '100%',
            p: { xs: 3, md: 4 },
            borderRadius: 2,
            border: '1px solid',
            borderColor: 'divider',
            backgroundColor: 'background.paper',
          }}
        >
          <Stack spacing={3}>{children}</Stack>
        </Paper>
      </Container>
    </TRPCReactProvider>
  )
}
