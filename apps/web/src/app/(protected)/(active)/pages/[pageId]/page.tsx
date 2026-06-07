import { notFound, redirect } from 'next/navigation'

import { Box } from '@repo/ui/components'

import { requireSession } from '@/lib/get-session'
import { getServerTRPC } from '@/trpc/server'
import { PageRenderer } from '@/components/page/page-renderer'
import { PageHeader } from '@/components/page/page-header'
import { PAGE_COLUMN_CLASS, pageColumnSx } from '@/components/page/column-sx'

const COLORS = ['#1976d2', '#9c27b0', '#2e7d32', '#ed6c02', '#0288d1', '#d32f2f']

function colorFor(userId: string): string {
  let hash = 0
  for (const ch of userId) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return COLORS[Math.abs(hash) % COLORS.length]!
}

export default async function PageRoute({ params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params
  const session = await requireSession()
  const trpc = await getServerTRPC()
  const page = await trpc.page.getById({ id: pageId })
  if (!page) notFound()

  const active = await trpc.workspace.getActive()
  if (!active || active.id !== page.workspaceId) {
    await trpc.workspace.setActive({ workspaceId: page.workspaceId })
    redirect(`/pages/${pageId}`)
  }

  const displayName =
    [session.user.firstName, session.user.lastName].filter(Boolean).join(' ').trim() ||
    session.user.email

  const isFullBleed =
    page.type === 'EXCALIDRAW' ||
    page.type === 'GENOGRAM' ||
    page.type === 'MERMAID' ||
    page.type === 'PLANTUML' ||
    page.type === 'LIKEC4' ||
    page.type === 'DRAWIO' ||
    page.type === 'KANBAN'

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {!isFullBleed && (
        <Box className={PAGE_COLUMN_CLASS} sx={{ ...pageColumnSx, pt: 4, pb: 1 }}>
          <PageHeader
            id={page.id}
            workspaceId={page.workspaceId}
            initialTitle={page.title}
            initialIcon={page.icon}
          />
        </Box>
      )}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <PageRenderer
          page={{ id: page.id, type: page.type, contentYjs: page.contentYjs }}
          workspaceId={page.workspaceId}
          user={{ id: session.user.id, name: displayName, color: colorFor(session.user.id) }}
        />
      </Box>
    </Box>
  )
}
