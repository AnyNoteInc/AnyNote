import { notFound } from 'next/navigation'

import { getAvailableAiModels, getAvailableEmbeddingModels, getWorkspaceFeatures } from '@repo/trpc'
import { WorkspaceAiSection } from '@/components/workspace/settings/ai-section'
import { getServerTRPC } from '@/trpc/server'

type Props = { params: Promise<{ workspaceId: string }> }

export default async function WorkspaceSettingsAiPage({ params }: Props) {
  const { workspaceId } = await params
  const features = await getWorkspaceFeatures(workspaceId)
  if (!features.aiSettingsEnabled) notFound()
  const trpc = await getServerTRPC()
  const [workspace, myRole, models, embeddingModels] = await Promise.all([
    trpc.workspace.getById({ id: workspaceId }),
    trpc.workspace.getMyRole({ workspaceId }),
    getAvailableAiModels(workspaceId),
    getAvailableEmbeddingModels(workspaceId),
  ])
  if (!workspace) notFound()

  return (
    <WorkspaceAiSection
      workspaceId={workspaceId}
      initialModels={models}
      initialEmbeddingModels={embeddingModels}
      isOwner={myRole === 'OWNER'}
      customProvidersEnabled={features.customAiProvidersEnabled}
    />
  )
}
