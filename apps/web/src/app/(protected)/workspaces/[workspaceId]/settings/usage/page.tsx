import { notFound } from 'next/navigation'

import { getServerTRPC } from '@/trpc/server'
import { UsageSection } from '@/components/workspace/settings/usage-section'

type Props = { params: Promise<{ workspaceId: string }> }

export default async function WorkspaceUsagePage({ params }: Props) {
  const { workspaceId } = await params
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getById({ id: workspaceId })
  if (!workspace) notFound()
  const usage = await trpc.workspace.getUsage({ workspaceId })
  return <UsageSection {...usage} />
}
