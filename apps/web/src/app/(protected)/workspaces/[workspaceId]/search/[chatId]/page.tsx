import { notFound } from "next/navigation"

import { getServerTRPC } from "@/trpc/server"
import { SearchChatView } from "@/components/workspace/search/search-chat-view"

type Props = { params: Promise<{ workspaceId: string; chatId: string }> }

export default async function SearchChatPage({ params }: Props) {
  const { workspaceId, chatId } = await params
  const trpc = await getServerTRPC()
  try {
    await trpc.search.getChat({ chatId })
  } catch {
    notFound()
  }
  return <SearchChatView chatId={chatId} workspaceId={workspaceId} />
}
