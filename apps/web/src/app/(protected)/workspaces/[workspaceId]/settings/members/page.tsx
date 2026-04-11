import { notFound } from "next/navigation"

import { requireSession } from "@/lib/get-session"
import { getServerTRPC } from "@/trpc/server"
import { WorkspaceMembersSection } from "@/components/workspace/settings/members-section"

type Props = { params: Promise<{ workspaceId: string }> }

export default async function WorkspaceSettingsMembersPage({ params }: Props) {
  const { workspaceId } = await params
  const session = await requireSession()
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getById({ id: workspaceId })
  if (!workspace) notFound()
  const { plan } = await trpc.subscription.getCurrent()

  return (
    <WorkspaceMembersSection
      workspaceId={workspace.id}
      locked={plan.slug === "free"}
      currentUserId={session.user.id}
    />
  )
}
