import { Box } from '@repo/ui/components'

import { TRPCReactProvider } from '@/trpc/client'

export default function ShareLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <Box sx={{ minHeight: '100vh', color: 'text.primary' }}>
      <TRPCReactProvider>{children}</TRPCReactProvider>
    </Box>
  )
}
