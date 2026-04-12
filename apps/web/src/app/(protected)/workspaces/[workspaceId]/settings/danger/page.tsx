import { notFound } from "next/navigation"

import { getServerTRPC } from "@/trpc/server"
import { WorkspaceDangerSection } from "@/components/workspace/settings/danger-section"

type Props = { params: Promise<{ workspaceId: string }> }

export default async function WorkspaceSettingsDangerPage({ params }: Props) {
  const { workspaceId } = await params
  const trpc = await getServerTRPC()
  const [workspace, myRole] = await Promise.all([
    trpc.workspace.getById({ id: workspaceId }),
    trpc.workspace.getMyRole({ workspaceId }),
  ])
  if (!workspace) notFound()

  return (
    <WorkspaceDangerSection
      workspace={{ id: workspace.id, name: workspace.name }}
      isOwner={myRole === "OWNER"}
    />
  )
}
