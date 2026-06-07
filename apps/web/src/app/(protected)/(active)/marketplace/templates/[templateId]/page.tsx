import { notFound, redirect } from 'next/navigation'
import { TRPCError } from '@trpc/server'

import { requireSession } from '@/lib/get-session'
import { getServerTRPC } from '@/trpc/server'
import { TemplateEditor } from '@/components/templates/template-editor'
import { colorFor } from '@/lib/user-color'

function isNotFoundTrpcError(error: unknown): boolean {
  return error instanceof TRPCError && error.code === 'NOT_FOUND'
}

export default async function TemplateEditorRoute({
  params,
}: {
  params: Promise<{ templateId: string }>
}) {
  const { templateId } = await params
  const session = await requireSession()
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getActive()
  if (!workspace) redirect('/workspaces/new')
  const workspaceId = workspace.id

  let template
  let backingPage
  try {
    template = await trpc.template.getById({ templateId, workspaceId })
    backingPage = await trpc.template.getBackingPage({ templateId, workspaceId })
  } catch (error) {
    if (isNotFoundTrpcError(error)) notFound()
    throw error
  }

  const displayName =
    [session.user.firstName, session.user.lastName].filter(Boolean).join(' ').trim() ||
    session.user.email

  return (
    <TemplateEditor
      workspaceId={workspaceId}
      backingPage={{
        id: backingPage.id,
        type: backingPage.type,
        contentYjs: backingPage.contentYjs,
      }}
      user={{ id: session.user.id, name: displayName, color: colorFor(session.user.id) }}
      editable={backingPage.editable && template.canEdit}
    />
  )
}
