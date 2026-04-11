import { redirect } from "next/navigation"

import { getServerTRPC } from "@/trpc/server"

type Props = { params: Promise<{ workspaceId: string }> }

export default async function SearchIndexPage({ params }: Props) {
  const { workspaceId } = await params
  const trpc = await getServerTRPC()
  const chats = await trpc.search.listChats({ workspaceId })
  if (chats.length > 0) {
    redirect(`/workspaces/${workspaceId}/search/${chats[0]!.id}`)
  }
  const created = await trpc.search.createChat({ workspaceId })
  redirect(`/workspaces/${workspaceId}/search/${created.id}`)
}
