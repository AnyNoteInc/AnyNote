import { redirect } from 'next/navigation'

import { getServerTRPC } from '@/trpc/server'
import { WorkspaceChatClient } from '@/components/workspace/chat/workspace-chat-client'

export default async function NewChatRoute() {
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getActive()
  if (!workspace) redirect('/workspaces/new')
  return <WorkspaceChatClient chatId={null} initialMessages={[]} workspaceId={workspace.id} />
}
