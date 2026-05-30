import { redirect } from 'next/navigation'

import { getServerTRPC } from '@/trpc/server'
import { firstPageInTreeOrder } from '@/components/workspace/types'

type Props = { params: Promise<{ workspaceId: string }> }

export default async function WorkspaceRootPage({ params }: Props) {
  const { workspaceId } = await params
  const trpc = await getServerTRPC()
  const pages = await trpc.page.listByWorkspace({ workspaceId })
  const first = firstPageInTreeOrder(pages)
  redirect(
    first
      ? `/workspaces/${workspaceId}/pages/${first.id}`
      : `/workspaces/${workspaceId}/chats/new`,
  )
}
