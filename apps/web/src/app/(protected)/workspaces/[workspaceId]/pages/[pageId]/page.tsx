import { notFound, redirect } from 'next/navigation'
import { TRPCError } from '@trpc/server'

import { getServerTRPC } from '@/trpc/server'

function isNotFoundTrpcError(error: unknown): boolean {
  if (error instanceof TRPCError) return error.code === 'NOT_FOUND'
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'NOT_FOUND'
  )
}

export default async function LegacyPage({
  params,
}: {
  params: Promise<{ workspaceId: string; pageId: string }>
}) {
  const { workspaceId, pageId } = await params
  const trpc = await getServerTRPC()
  let page
  try {
    page = await trpc.page.getById({ id: pageId })
  } catch (error) {
    if (isNotFoundTrpcError(error)) notFound()
    throw error
  }
  if (page.workspaceId !== workspaceId) notFound()
  await trpc.workspace.setActive({ workspaceId })
  redirect(`/pages/${pageId}`)
}
