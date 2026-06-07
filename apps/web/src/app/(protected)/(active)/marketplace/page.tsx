import { redirect } from 'next/navigation'

import { getServerTRPC } from '@/trpc/server'
import { MarketplacePage } from '@/components/marketplace/marketplace-page'

export default async function MarketplaceRoute() {
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getActive()
  if (!workspace) redirect('/workspaces/new')
  return <MarketplacePage workspaceId={workspace.id} />
}
