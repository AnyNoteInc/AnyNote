import { notFound } from "next/navigation"

import { ChatPageClient } from "./chat-page-client"
import { getServerTRPC } from "@/trpc/server"

type Props = { params: Promise<{ workspaceId: string }> }

export default async function WorkspaceChatPage({ params }: Props) {
  const { workspaceId } = await params
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getById({ id: workspaceId })
  if (!workspace) notFound()
  const settings = await trpc.aiSettings.get({ workspaceId })
  return (
    <ChatPageClient
      workspaceId={workspaceId}
      workspaceName={workspace.name}
      hasModelConfigured={settings.defaultModelId !== null}
    />
  )
}
