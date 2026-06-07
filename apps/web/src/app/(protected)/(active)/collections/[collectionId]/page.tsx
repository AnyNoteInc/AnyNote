import { notFound, redirect } from 'next/navigation'
import { TRPCError } from '@trpc/server'

import { requireSession } from '@/lib/get-session'
import { getServerTRPC } from '@/trpc/server'
import { CollectionHomeBody } from '@/components/workspace/collection-home-body'

export default async function CollectionRoute({
  params,
}: {
  params: Promise<{ collectionId: string }>
}) {
  const { collectionId } = await params
  const session = await requireSession()
  const trpc = await getServerTRPC()

  const active = await trpc.workspace.getActive()
  if (!active) redirect('/workspaces/new')

  let collection
  try {
    collection = await trpc.collection.getById({ collectionId, workspaceId: active.id })
  } catch (error) {
    if (error instanceof TRPCError && error.code === 'NOT_FOUND') notFound()
    throw error
  }

  const allPages = await trpc.page.listByWorkspace({ workspaceId: active.id })
  const pagesInCollection = allPages
    .filter((p) => p.collectionId === collectionId)
    .map((p) => ({
      id: p.id,
      title: p.title,
      icon: p.icon,
      createdById: p.createdById,
    }))

  return (
    <CollectionHomeBody
      collection={{
        id: collection.id,
        title: collection.title,
        icon: collection.icon,
        homePageId: collection.homePageId,
      }}
      pages={pagesInCollection}
      currentUserId={session.user.id}
    />
  )
}
