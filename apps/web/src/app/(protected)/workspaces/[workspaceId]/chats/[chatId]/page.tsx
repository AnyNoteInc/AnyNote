import { notFound } from "next/navigation"
import { TRPCError } from "@trpc/server"

import { getServerTRPC } from "@/trpc/server"
import { WorkspaceChatClient } from "@/components/workspace/chat/workspace-chat-client"

type Props = { params: Promise<{ workspaceId: string; chatId: string }> }

function isNotFoundTrpcError(error: unknown): boolean {
  if (error instanceof TRPCError) {
    return error.code === "NOT_FOUND"
  }

  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "NOT_FOUND"
  )
}

export default async function SearchChatPage({ params }: Props) {
  const { workspaceId, chatId } = await params
  const trpc = await getServerTRPC()
  let chat
  try {
    chat = await trpc.chat.getChat({ chatId })
  } catch (error) {
    if (isNotFoundTrpcError(error)) {
      notFound()
    }

    throw error
  }

  return (
    <WorkspaceChatClient
      chatId={chatId}
      initialMessages={chat.messages}
      workspaceId={workspaceId}
    />
  )
}
