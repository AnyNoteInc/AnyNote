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

export default async function LegacyChat({
  params,
}: {
  params: Promise<{ workspaceId: string; chatId: string }>
}) {
  const { workspaceId, chatId } = await params
  const trpc = await getServerTRPC()
  let chat
  try {
    chat = await trpc.chat.getChat({ chatId })
  } catch (error) {
    if (isNotFoundTrpcError(error)) notFound()
    throw error
  }
  if (chat.chat.workspaceId !== workspaceId) notFound()
  await trpc.workspace.setActive({ workspaceId })
  redirect(`/chats/${chatId}`)
}
