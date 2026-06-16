import type { ReactNode } from 'react'

import { Box } from '@repo/ui/components'

import { PublicHeader } from '@/components/public/public-header'
import { requireSession } from '@/lib/get-session'

export default async function NotificationsLayout({ children }: Readonly<{ children: ReactNode }>) {
  const session = await requireSession()

  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <PublicHeader session={session} />
      <Box component="main" sx={{ flex: 1 }}>
        {children}
      </Box>
    </Box>
  )
}
