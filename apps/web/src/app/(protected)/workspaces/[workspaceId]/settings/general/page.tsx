import { notFound } from "next/navigation"

import { getServerTRPC } from "@/trpc/server"
import { WorkspaceGeneralSection } from "@/components/workspace/settings/general-section"

type Props = { params: Promise<{ workspaceId: string }> }

export default async function WorkspaceSettingsGeneralPage({ params }: Props) {
  const { workspaceId } = await params
  const trpc = await getServerTRPC()
  const [workspace, myRole] = await Promise.all([
    trpc.workspace.getById({ id: workspaceId }),
    trpc.workspace.getMyRole({ workspaceId }),
  ])
  if (!workspace) notFound()

  return (
    <WorkspaceGeneralSection
      workspace={{ id: workspace.id, name: workspace.name, icon: workspace.icon }}
      isOwner={myRole === "OWNER"}
    />
  )
}
