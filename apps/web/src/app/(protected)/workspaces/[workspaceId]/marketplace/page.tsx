import { MarketplacePage } from '@/components/marketplace/marketplace-page'

export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  return <MarketplacePage workspaceId={workspaceId} />
}
