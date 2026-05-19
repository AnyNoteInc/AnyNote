import { WorkspaceChatClient } from '@/components/workspace/chat/workspace-chat-client'

type Props = { params: Promise<{ workspaceId: string }> }

export default async function NewChatPage({ params }: Props) {
  const { workspaceId } = await params
  return <WorkspaceChatClient chatId={null} initialMessages={[]} workspaceId={workspaceId} />
}
