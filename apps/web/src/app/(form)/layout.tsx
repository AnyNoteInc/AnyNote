import type { ReactNode } from 'react'

import { Box } from '@repo/ui/components'

import { RecaptchaProvider } from '@/components/recaptcha-provider'
import { TRPCReactProvider } from '@/trpc/client'

export { NOINDEX_METADATA as metadata } from '@/lib/seo/build-metadata'

export default function FormLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <RecaptchaProvider
      siteKey={process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY}
      testMode={process.env.NODE_ENV !== 'production' && process.env.PLAYWRIGHT === 'true'}
    >
      <TRPCReactProvider>
        <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', color: 'text.primary' }}>
          {children}
        </Box>
      </TRPCReactProvider>
    </RecaptchaProvider>
  )
}
