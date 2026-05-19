import type { ReactNode } from 'react'

import { notFound } from 'next/navigation'
import { Box, Container } from '@repo/ui/components'

import { getServerTRPC } from '@/trpc/server'

type Props = {
  children: ReactNode
  params: Promise<{ workspaceId: string }>
}

export default async function WorkspaceSettingsLayout({ children, params }: Props) {
  const { workspaceId } = await params
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getById({ id: workspaceId })
  if (!workspace) notFound()

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
      <Box>{children}</Box>
    </Container>
  )
}
