import { redirect } from 'next/navigation'

import { getServerTRPC } from '@/trpc/server'
import { TrashPageBody } from '@/components/workspace/trash-page-body'

export default async function TrashPage() {
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getActive()
  if (!workspace) redirect('/workspaces/new')
  return <TrashPageBody workspaceId={workspace.id} />
}
