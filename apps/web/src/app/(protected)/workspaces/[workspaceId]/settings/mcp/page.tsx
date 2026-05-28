import { notFound } from 'next/navigation'

import { getWorkspaceFeatures } from '@repo/trpc'
import { WorkspaceMcpSection } from '@/components/workspace/settings/mcp-section'
import { getServerTRPC } from '@/trpc/server'

type Props = { params: Promise<{ workspaceId: string }> }

export default async function WorkspaceSettingsMcpPage({ params }: Props) {
  const { workspaceId } = await params
  const features = await getWorkspaceFeatures(workspaceId)
  if (!features.aiSettingsEnabled) notFound()
  const trpc = await getServerTRPC()
  const [workspace, myRole] = await Promise.all([
    trpc.workspace.getById({ id: workspaceId }),
    trpc.workspace.getMyRole({ workspaceId }),
  ])
  if (!workspace) notFound()

  return (
    <WorkspaceMcpSection
      workspaceId={workspaceId}
      isOwner={myRole === 'OWNER'}
      customMcpEnabled={features.customMcpEnabled}
    />
  )
}
