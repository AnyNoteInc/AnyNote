import { redirect } from 'next/navigation'

import { firstPageInTreeOrder } from '@/components/workspace/types'
import { getServerTRPC } from '@/trpc/server'

type Props = { params: Promise<{ workspaceId: string }> }

export default async function WorkspaceRootPage({ params }: Props) {
  const { workspaceId } = await params
  const trpc = await getServerTRPC()
  const pages = await trpc.page.listByWorkspace({ workspaceId })
  const firstPage = firstPageInTreeOrder(pages)
  if (firstPage) {
    redirect(`/workspaces/${workspaceId}/pages/${firstPage.id}`)
  }
  redirect(`/workspaces/${workspaceId}/chats`)
}
