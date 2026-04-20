import { notFound } from "next/navigation"

import { WorkspaceAiSection } from "@/components/workspace/settings/ai-section"
import { getServerTRPC } from "@/trpc/server"

type Props = { params: Promise<{ workspaceId: string }> }

export default async function WorkspaceSettingsAiPage({ params }: Props) {
  const { workspaceId } = await params
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getById({ id: workspaceId })
  if (!workspace) notFound()

  return <WorkspaceAiSection workspaceId={workspaceId} />
}
