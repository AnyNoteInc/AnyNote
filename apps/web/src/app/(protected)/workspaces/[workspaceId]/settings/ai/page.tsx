import { notFound } from 'next/navigation'

import { getWorkspaceFeatures, getAvailableAiModels } from '@repo/trpc'
import { WorkspaceAiSection } from '@/components/workspace/settings/ai-section'
import { getServerTRPC } from '@/trpc/server'

type Props = { params: Promise<{ workspaceId: string }> }

export default async function WorkspaceSettingsAiPage({ params }: Props) {
  const { workspaceId } = await params
  const features = await getWorkspaceFeatures(workspaceId)
  if (!features.aiSettingsEnabled) notFound()
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getById({ id: workspaceId })
  if (!workspace) notFound()
  const models = await getAvailableAiModels(workspaceId)

  return <WorkspaceAiSection workspaceId={workspaceId} initialModels={models} />
}
