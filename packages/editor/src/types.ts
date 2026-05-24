import type { ReactNode } from 'react'
import type { Editor } from '@tiptap/core'

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

export type SlashCommandGroup = 'base' | 'code' | 'media' | 'embedding'

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
  editable?: boolean
  className?: string
  placeholder?: string
  onReady?: (editor: Editor) => void
  onRequestBlockMove?: (pos: number) => void
  loadingFallback?: ReactNode
  onReminderClick?: (reminderId: string, anchor: HTMLElement) => void
  onReminderCreate?: (reminderId: string) => void
}

export type SlashCommandItem = {
  id: string
  label: string
  description?: string
  keywords?: string[]
  icon?: ReactNode
  group: SlashCommandGroup
  run: (args: { editor: Editor; range: SlashRange }) => void
}
