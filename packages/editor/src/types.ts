import type { ReactNode } from "react"
import type { Editor } from "@tiptap/core"

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

export type AnyNoteEditorProps = {
  pageId: string
  yjsUrl: string
  yjsToken: () => Promise<string>
  user: AnyNoteEditorUser
  uploadHandler: UploadHandler
  editable?: boolean
  className?: string
  placeholder?: string
}

export type SlashCommandItem = {
  id: string
  label: string
  description?: string
  keywords?: string[]
  icon?: ReactNode
  run: (args: { editor: Editor; range: { from: number; to: number } }) => void
}
