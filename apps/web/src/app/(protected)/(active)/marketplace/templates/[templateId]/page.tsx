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

  // The template IS a page now, so getById returns its own content directly —
  // there is no separate backing page to fetch.
  let detail
  try {
    detail = await trpc.template.getById({ templateId, workspaceId })
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
      page={{
        id: detail.id,
        type: detail.type,
        contentYjs: detail.contentYjs,
      }}
      user={{ id: session.user.id, name: displayName, color: colorFor(session.user.id) }}
      editable={detail.canEdit}
    />
  )
}
