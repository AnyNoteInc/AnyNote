import type { ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import type { PlantumlRenderAuth } from '@repo/plantuml/render-plantuml'
import type { EmbeddedDatabaseRenderer } from './extensions/embedded-database'

export type { EmbeddedDatabaseRenderer, EmbeddedDatabaseRenderArgs } from './extensions/embedded-database'

/** The source/view chosen in the apps/web database picker dialog. */
export type EmbeddedDatabasePick = { sourceId: string; viewId: string | null }

export type UploadedFile = {
  id: string
  src: string
}

export type UploadHandler = (args: { blob: Blob; filename: string }) => Promise<UploadedFile>

export type AnyNoteEditorUser = {
  id: string
  name: string
  color: string
}

export type PageLookupItem = {
  id: string
  title: string
  icon: string | null
}

export type MentionLookupItem = {
  id: string
  label: string
  email: string | null
}

export type SlashCommandGroup = 'base' | 'inline' | 'code' | 'media' | 'embedding'

export type SlashRange = { from: number; to: number }

// Minimal virtual anchor accepted by MUI Popover. We don't have a real DOM
// node for the slash cursor position, so we synthesize one with the
// selection's client rect.
export type VirtualAnchor = {
  getBoundingClientRect: () => DOMRect
  nodeType?: number
}

export type AnyNoteEditorProps = {
  pageId: string
  workspaceId: string
  initialContentYjs?: string | null
  yjsUrl: string
  yjsToken: () => Promise<string>
  user: AnyNoteEditorUser
  uploadHandler: UploadHandler
  pageSearch: (query: string) => Promise<PageLookupItem[]>
  mentionSearch: (query: string) => Promise<MentionLookupItem[]>
  onNavigateToPage: (pageId: string) => void
  drawioUrl: string
  editable?: boolean
  className?: string
  placeholder?: string
  onReady?: (editor: Editor) => void
  onRequestBlockMove?: (pos: number) => void
  loadingFallback?: ReactNode
  onReminderClick?: (reminderId: string, anchor: HTMLElement) => void
  onReminderCreate?: (reminderId: string) => void
  commentThreads?: import('./types-comments').CommentThreadAnchor[]
  onCreateComment?: (anchor: { anchorStart: string; anchorEnd: string; quotedText: string }) => void
  onOpenThread?: (threadId: string) => void
  activeCommentAnchor?: { anchorStart: string; anchorEnd: string } | null
  canComment?: boolean
  plantumlRenderAuth?: PlantumlRenderAuth
  // Live renderer for the embedded-database node, injected by apps/web (the rich
  // `DatabaseTableView` + tRPC query can't be imported from @repo/editor).
  renderEmbeddedDatabase?: EmbeddedDatabaseRenderer
  // Opens an apps/web picker of the user's DATABASE sources. Resolves to the
  // chosen source/view, or null if the user cancels; the editor then inserts the
  // node. When omitted, the `/база данных` slash item is hidden.
  onPickEmbeddedDatabase?: () => Promise<EmbeddedDatabasePick | null>
  // apps/web injects a thin `fetch('/api/bookmark/preview')` wrapper (Task 4) so
  // a «Закладка» insert/paste can async-fill its og:title/description/image.
  // Tolerated absent — the bookmark stays a bare card until wired.
  bookmarkPreview?: import('./extensions/url-paste').PreviewFetch
}

export type { CommentThreadAnchor } from './types-comments'

export type SlashCommandItem = {
  id: string
  label: string
  description?: string
  keywords?: string[]
  icon?: ReactNode
  group: SlashCommandGroup
  run: (args: { editor: Editor; range: SlashRange }) => void
}
