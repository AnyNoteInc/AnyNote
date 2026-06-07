'use client'

import type { PageType } from '@repo/db'

import { PageEditorProvider } from './editor-context'
import { PageCommentsProvider } from './comments/comments-context'
import { PageRenderer } from './page-renderer'

type PageInput = {
  id: string
  type: PageType
  contentYjs: string | null
}

type Props = {
  workspaceId: string
  page: PageInput
  user: { id: string; name: string; color: string }
  editable?: boolean
}

/**
 * Self-contained page surface: wraps PageRenderer in the editor + comments
 * providers it needs. Use this when you want to embed a collaborative page
 * editor outside the normal /pages/[pageId] route (e.g. the template editor),
 * where WorkspaceLayoutClient's own providers don't apply.
 */
export function PageView({ workspaceId, page, user, editable = true }: Props) {
  return (
    <PageCommentsProvider
      target={{ pageId: page.id }}
      pageType={page.type}
      canComment={editable}
      canDeleteComments={editable}
      workspaceId={workspaceId}
    >
      <PageEditorProvider>
        {/*
         * editable={false} makes the client read-only; the yjs server (apps/yjs)
         * still grants write to any origin-workspace member at the protocol level —
         * full server-side template-edit enforcement on the realtime layer is out of
         * scope for this pass (the spec kept the yjs auth model unchanged).
         */}
        <PageRenderer
          page={page}
          workspaceId={workspaceId}
          user={user}
          editable={editable}
        />
      </PageEditorProvider>
    </PageCommentsProvider>
  )
}
