'use client'

import type { PageType } from '@repo/db'
import { Box } from '@repo/ui/components'

import { PageView } from '@/components/page/page-view'

type Props = {
  workspaceId: string
  page: { id: string; type: PageType; contentYjs: string | null }
  user: { id: string; name: string; color: string }
  editable: boolean
}

/**
 * Renders the template's content using the same editor as real pages. A template
 * IS a page now, so this just mounts that page's content. The "Использовать"
 * action + three-dots menu + breadcrumbs live in the top WorkspaceToolbar (see
 * TemplateActionsToolbar), so there is no second header row here.
 */
export function TemplateEditor({ workspaceId, page, user, editable }: Readonly<Props>) {
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <PageView workspaceId={workspaceId} page={page} user={user} editable={editable} />
      </Box>
    </Box>
  )
}
