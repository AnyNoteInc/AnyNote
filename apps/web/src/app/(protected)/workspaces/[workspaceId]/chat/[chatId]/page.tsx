import { notFound } from "next/navigation"

import { ChatPageClient } from "../chat-page-client"
import { getServerTRPC } from "@/trpc/server"

type Props = { params: Promise<{ workspaceId: string; chatId: string }> }

export default async function WorkspaceChatPage({ params }: Props) {
  const { workspaceId, chatId } = await params
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getById({ id: workspaceId })
  if (!workspace) notFound()
  const settings = await trpc.aiSettings.get({ workspaceId })
  const { messages } = await trpc.chat.getChat({ chatId })

  return (
    <ChatPageClient
      workspaceName={workspace.name}
      chatId={chatId}
      hasModelConfigured={settings.defaultModelId !== null}
      initialMessages={messages.map((m) => ({
        id: m.id,
        role: m.role === "USER" ? "user" : m.role === "ASSISTANT" ? "assistant" : "system",
        content: m.content,
        status: "done" as const,
        createdAt: m.createdAt,
      }))}
    />
  )
}
