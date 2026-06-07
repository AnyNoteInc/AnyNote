import { redirect } from 'next/navigation'

import { getServerTRPC } from '@/trpc/server'
import { ArchivePageBody } from '@/components/workspace/archive-page-body'

export default async function ArchivePage() {
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getActive()
  if (!workspace) redirect('/workspaces/new')
  return <ArchivePageBody workspaceId={workspace.id} />
}
