import Link from '@tiptap/extension-link'
import { Table } from '@tiptap/extension-table'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TableRow from '@tiptap/extension-table-row'
import TaskList from '@tiptap/extension-task-list'
import Typography from '@tiptap/extension-typography'
import StarterKit from '@tiptap/starter-kit'
import type { HocuspocusProvider } from '@hocuspocus/provider'
import type * as Y from 'yjs'

import { BlockBackground } from './block-background'
import { BlockIndexAttributes } from './block-index-attributes'
import { buildCodeBlockPro } from './code-block-pro'
import { Callout } from './callout'
import { buildCollaboration } from './collaboration'
import { Column, ColumnLayout } from './column-layout'
import { DropPlacement } from './drop-placement'
import { FileAttachment } from './file-attachment'
import { buildFileUpload } from './file-upload'
import { HiddenText } from './hidden-text'
import { PageLink } from './page-link'
import { Reminder } from './reminder'
import { buildPlaceholder } from './placeholder'
import { ResizableImage } from './resizable-image'
import { SlashMenu, type SlashMenuRender } from './slash-menu'
import { TaskItemWithCheckbox } from './task-item-view'
import { AnynoteTextColor } from './text-color'
import { Toggle } from './toggle'
import type { ColorMode } from '../theme-mode'
import type { AnyNoteEditorUser, SlashCommandItem, UploadHandler } from '../types'

export type BuildExtensionsOptions = {
  ydoc: Y.Doc
  provider: HocuspocusProvider
  user: AnyNoteEditorUser
  uploadHandler: UploadHandler
  placeholder: string
  slashItems: (query: string) => SlashCommandItem[]
  slashRender: () => SlashMenuRender
  onNavigateToPage: (pageId: string) => void
  mode: ColorMode
}

export const buildExtensions = (opts: BuildExtensionsOptions) => [
  StarterKit.configure({ undoRedo: false, dropcursor: false, codeBlock: false }),
  buildPlaceholder(opts.placeholder),
  Link.configure({ openOnClick: false }),
  Typography,
  AnynoteTextColor,
  BlockBackground,
  ResizableImage.configure({ uploadHandler: opts.uploadHandler }),
  TaskList,
  TaskItemWithCheckbox.configure({ nested: true }),
  Table.configure({ resizable: true }),
  TableRow,
  TableHeader,
  TableCell,
  buildCodeBlockPro(opts.mode),
  Callout,
  Toggle,
  HiddenText,
  FileAttachment,
  PageLink.configure({ onNavigate: opts.onNavigateToPage }),
  Reminder,
  ...buildCollaboration({ ydoc: opts.ydoc, provider: opts.provider, user: opts.user }),
  buildFileUpload(opts.uploadHandler),
  SlashMenu.configure({
    items: opts.slashItems,
    render: opts.slashRender,
  }),
  BlockIndexAttributes,
  ColumnLayout,
  Column,
  DropPlacement,
]
