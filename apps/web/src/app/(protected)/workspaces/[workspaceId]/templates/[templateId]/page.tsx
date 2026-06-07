import { notFound } from 'next/navigation'

import { getServerTRPC } from '@/trpc/server'
import { TemplateEditor } from '@/components/templates/template-editor'

type Props = { params: Promise<{ workspaceId: string; templateId: string }> }

export default async function WorkspaceTemplateEditorPage({ params }: Props) {
  const { workspaceId, templateId } = await params
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getById({ id: workspaceId })
  if (!workspace) notFound()
  return <TemplateEditor workspaceId={workspaceId} templateId={templateId} />
}
