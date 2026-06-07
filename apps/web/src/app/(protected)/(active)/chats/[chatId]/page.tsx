import { notFound, redirect } from 'next/navigation'
import { TRPCError } from '@trpc/server'

import { getServerTRPC } from '@/trpc/server'
import { WorkspaceChatClient } from '@/components/workspace/chat/workspace-chat-client'

function isNotFoundTrpcError(error: unknown): boolean {
  if (error instanceof TRPCError) return error.code === 'NOT_FOUND'
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'NOT_FOUND'
  )
}

export default async function ChatRoute({ params }: { params: Promise<{ chatId: string }> }) {
  const { chatId } = await params
  const trpc = await getServerTRPC()

  let chat
  try {
    chat = await trpc.chat.getChat({ chatId })
  } catch (error) {
    if (isNotFoundTrpcError(error)) notFound()
    throw error
  }

  const active = await trpc.workspace.getActive()
  if (!active || active.id !== chat.chat.workspaceId) {
    await trpc.workspace.setActive({ workspaceId: chat.chat.workspaceId })
    redirect(`/chats/${chatId}`)
  }

  return (
    <WorkspaceChatClient
      chatId={chatId}
      initialMessages={chat.messages}
      workspaceId={chat.chat.workspaceId}
    />
  )
}
