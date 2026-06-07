import { notFound } from 'next/navigation'

import { getServerTRPC } from '@/trpc/server'
import { TemplatesPage } from '@/components/templates/templates-page'

type Props = { params: Promise<{ workspaceId: string }> }

export default async function WorkspaceTemplatesPage({ params }: Props) {
  const { workspaceId } = await params
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getById({ id: workspaceId })
  if (!workspace) notFound()
  return <TemplatesPage workspaceId={workspaceId} />
}
