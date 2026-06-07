import { redirect } from 'next/navigation'

import { getServerTRPC } from '@/trpc/server'
import { firstPageInTreeOrder } from '@/components/workspace/types'

export default async function AppIndexPage() {
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getActive()
  if (!workspace) redirect('/workspaces/new')

  const pages = await trpc.page.listByWorkspace({ workspaceId: workspace.id })
  const first = firstPageInTreeOrder(pages)
  redirect(first ? `/pages/${first.id}` : '/chats/new')
}
