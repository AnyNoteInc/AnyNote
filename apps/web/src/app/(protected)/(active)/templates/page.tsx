import { redirect } from 'next/navigation'

import { getServerTRPC } from '@/trpc/server'
import { TemplatesPage } from '@/components/templates/templates-page'

export default async function TemplatesRoute() {
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getActive()
  if (!workspace) redirect('/workspaces/new')
  return <TemplatesPage workspaceId={workspace.id} />
}
