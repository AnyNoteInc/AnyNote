import { notFound } from "next/navigation"

import { getServerTRPC } from "@/trpc/server"
import { WorkspaceGeneralSection } from "@/components/workspace/settings/general-section"

type Props = { params: Promise<{ workspaceId: string }> }

export default async function WorkspaceSettingsGeneralPage({ params }: Props) {
  const { workspaceId } = await params
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getById({ id: workspaceId })
  if (!workspace) notFound()
  const { plan } = await trpc.subscription.getCurrent()

  return (
    <WorkspaceGeneralSection
      workspace={{ id: workspace.id, name: workspace.name, icon: workspace.icon }}
      locked={plan.slug === "free"}
    />
  )
}
