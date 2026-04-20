import { notFound } from "next/navigation"

import { ChatListClient } from "./chat-list-client"
import { getServerTRPC } from "@/trpc/server"

type Props = { params: Promise<{ workspaceId: string }> }

export default async function WorkspaceChatsListPage({ params }: Props) {
  const { workspaceId } = await params
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getById({ id: workspaceId })
  if (!workspace) notFound()

  return <ChatListClient workspaceId={workspaceId} workspaceName={workspace.name} />
}
