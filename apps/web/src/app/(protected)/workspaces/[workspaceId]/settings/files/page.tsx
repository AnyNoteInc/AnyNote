import { notFound } from "next/navigation"

import { WorkspaceFilesSection } from "@/components/workspace/settings/files-section"
import { requireSession } from "@/lib/get-session"
import { getServerTRPC } from "@/trpc/server"

type Props = { params: Promise<{ workspaceId: string }> }

export default async function WorkspaceSettingsFilesPage({ params }: Props) {
  const { workspaceId } = await params
  const session = await requireSession()
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getById({ id: workspaceId })
  if (!workspace) notFound()

  return <WorkspaceFilesSection workspaceId={workspaceId} currentUserId={session.user.id} />
}
