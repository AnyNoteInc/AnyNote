import { notFound, redirect } from 'next/navigation'

import { getServerTRPC } from '@/trpc/server'

export default async function LegacyWorkspaceRoot({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  const trpc = await getServerTRPC()
  const ws = await trpc.workspace.getById({ id: workspaceId })
  if (!ws) notFound()
  await trpc.workspace.setActive({ workspaceId })
  redirect('/app')
}
