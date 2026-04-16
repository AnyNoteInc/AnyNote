import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight"
import Image from "@tiptap/extension-image"
import Link from "@tiptap/extension-link"
import { Table } from "@tiptap/extension-table"
import TableCell from "@tiptap/extension-table-cell"
import TableHeader from "@tiptap/extension-table-header"
import TableRow from "@tiptap/extension-table-row"
import TaskItem from "@tiptap/extension-task-item"
import TaskList from "@tiptap/extension-task-list"
import Typography from "@tiptap/extension-typography"
import StarterKit from "@tiptap/starter-kit"
import type { HocuspocusProvider } from "@hocuspocus/provider"
import { common, createLowlight } from "lowlight"
import type * as Y from "yjs"

import { buildCollaboration } from "./collaboration.js"
import { buildFileUpload } from "./file-upload.js"
import { buildPlaceholder } from "./placeholder.js"
import { SlashMenu, type SlashMenuRender } from "./slash-menu.js"
import type { AnyNoteEditorUser, SlashCommandItem, UploadHandler } from "../types.js"

const lowlight = createLowlight(common)

export type BuildExtensionsOptions = {
  ydoc: Y.Doc
  provider: HocuspocusProvider
  user: AnyNoteEditorUser
  uploadHandler: UploadHandler
  placeholder: string
  slashItems: (query: string) => SlashCommandItem[]
  slashRender: () => SlashMenuRender
}

export const buildExtensions = (opts: BuildExtensionsOptions) => [
  StarterKit.configure({ undoRedo: false }),
  buildPlaceholder(opts.placeholder),
  Link.configure({ openOnClick: false }),
  Image,
  Typography,
  TaskList,
  TaskItem.configure({ nested: true }),
  Table.configure({ resizable: true }),
  TableRow,
  TableHeader,
  TableCell,
  CodeBlockLowlight.configure({ lowlight }),
  ...buildCollaboration({ ydoc: opts.ydoc, provider: opts.provider, user: opts.user }),
  buildFileUpload(opts.uploadHandler),
  SlashMenu.configure({
    items: opts.slashItems,
    render: opts.slashRender,
  }),
]
