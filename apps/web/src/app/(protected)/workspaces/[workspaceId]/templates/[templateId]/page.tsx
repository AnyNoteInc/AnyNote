import { notFound, redirect } from 'next/navigation'

import { getServerTRPC } from '@/trpc/server'

export default async function LegacyTemplateEditor({
  params,
}: {
  params: Promise<{ workspaceId: string; templateId: string }>
}) {
  const { workspaceId, templateId } = await params
  const trpc = await getServerTRPC()
  const ws = await trpc.workspace.getById({ id: workspaceId })
  if (!ws) notFound()
  await trpc.workspace.setActive({ workspaceId })
  redirect(`/templates/${templateId}`)
}
