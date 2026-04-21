import { redirect } from "next/navigation"

import { getServerTRPC } from "@/trpc/server"

type Props = { params: Promise<{ workspaceId: string }> }

export default async function WorkspaceRootPage({ params }: Props) {
  const { workspaceId } = await params
  const trpc = await getServerTRPC()
  const pages = await trpc.page.listByWorkspace({ workspaceId })
  if (pages.length > 0) {
    redirect(`/workspaces/${workspaceId}/pages/${pages[0]!.id}`)
  }
  redirect(`/workspaces/${workspaceId}/chats`)
}
