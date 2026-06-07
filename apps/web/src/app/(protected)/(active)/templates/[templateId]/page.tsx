import { notFound, redirect } from 'next/navigation'

import { requireSession } from '@/lib/get-session'
import { getServerTRPC } from '@/trpc/server'
import { TemplateEditor } from '@/components/templates/template-editor'
import { colorFor } from '@/lib/user-color'

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

  const template = await trpc.template.getById({ templateId, workspaceId })
  if (!template || !template.backingPageId) notFound()

  const backingPage = await trpc.template.getBackingPage({ templateId, workspaceId })
  if (!backingPage) notFound()

  const displayName =
    [session.user.firstName, session.user.lastName].filter(Boolean).join(' ').trim() ||
    session.user.email

  return (
    <TemplateEditor
      workspaceId={workspaceId}
      template={{ title: template.title, icon: template.icon ?? null }}
      backingPage={{
        id: backingPage.id,
        type: backingPage.type,
        contentYjs: backingPage.contentYjs,
      }}
      user={{ id: session.user.id, name: displayName, color: colorFor(session.user.id) }}
      editable={template.canEdit}
    />
  )
}
