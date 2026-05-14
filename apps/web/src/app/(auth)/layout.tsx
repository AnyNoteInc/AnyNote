import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'

import { Container, Paper, Stack } from '@repo/ui/components'

import { getSession } from '@/lib/get-session'
import { RecaptchaProvider } from '@/components/recaptcha-provider'
import { TRPCReactProvider } from '@/trpc/client'

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const session = await getSession()
  if (session) {
    redirect('/app')
  }
  const recaptchaSiteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY

  return (
    <RecaptchaProvider siteKey={recaptchaSiteKey}>
      <TRPCReactProvider>
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
      </TRPCReactProvider>
    </RecaptchaProvider>
  )
}
