import Link from '@tiptap/extension-link'
import Code from '@tiptap/extension-code'
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import Highlight from '@tiptap/extension-highlight'
import Mention from '@tiptap/extension-mention'
import { Table } from '@tiptap/extension-table'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TableRow from '@tiptap/extension-table-row'
import TaskList from '@tiptap/extension-task-list'
import { TextStyleKit } from '@tiptap/extension-text-style'
import Typography from '@tiptap/extension-typography'
import Underline from '@tiptap/extension-underline'
import StarterKit from '@tiptap/starter-kit'
import type { SuggestionOptions } from '@tiptap/suggestion'
import type { HocuspocusProvider } from '@hocuspocus/provider'
import { common, createLowlight } from 'lowlight'
import type * as Y from 'yjs'

import { BlockBackground } from './block-background'
import { BlockIndexAttributes } from './block-index-attributes'
import { Callout } from './callout'
import { CodeBlock } from './code-block'
import { buildCollaboration } from './collaboration'
import { Column, ColumnLayout } from './column-layout'
import { DropPlacement } from './drop-placement'
import { Drawio } from './drawio'
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
import type {
  AnyNoteEditorUser,
  MentionLookupItem,
  SlashCommandItem,
  UploadHandler,
} from '../types'

const lowlight = createLowlight(common)

type MentionRender = NonNullable<SuggestionOptions<MentionLookupItem, MentionLookupItem>['render']>

export type BuildExtensionsOptions = {
  ydoc: Y.Doc
  provider: HocuspocusProvider
  user: AnyNoteEditorUser
  uploadHandler: UploadHandler
  placeholder: string
  slashItems: (query: string) => SlashCommandItem[]
  slashRender: () => SlashMenuRender
  mentionItems: (query: string) => Promise<MentionLookupItem[]> | MentionLookupItem[]
  mentionRender: MentionRender
  onNavigateToPage: (pageId: string) => void
  drawioUrl: string
}

export const buildExtensions = (opts: BuildExtensionsOptions) => [
  StarterKit.configure({
    undoRedo: false,
    dropcursor: false,
    codeBlock: false,
    code: false,
    link: false,
    underline: false,
  }),
  buildPlaceholder(opts.placeholder),
  Link.configure({ openOnClick: false }),
  Code,
  Highlight.configure({ multicolor: true }),
  Underline,
  TextStyleKit.configure({
    backgroundColor: false,
    color: false,
    lineHeight: false,
    fontFamily: { types: ['textStyle'] },
    fontSize: { types: ['textStyle'] },
  }),
  Details.configure({
    persist: true,
    HTMLAttributes: { class: 'anynote-details' },
    renderToggleButton: ({ element, isOpen }) => {
      element.className = 'anynote-details__toggle'
      element.setAttribute('aria-label', isOpen ? 'Свернуть' : 'Развернуть')
      element.textContent = '▸'
    },
  }),
  DetailsSummary.configure({ HTMLAttributes: { class: 'anynote-details__summary' } }),
  DetailsContent.configure({ HTMLAttributes: { class: 'anynote-details__content' } }),
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
  CodeBlock.configure({ lowlight }),
  Callout,
  HiddenText,
  FileAttachment,
  Drawio.configure({ drawioUrl: opts.drawioUrl }),
  PageLink.configure({ onNavigate: opts.onNavigateToPage }),
  Reminder,
  ...buildCollaboration({ ydoc: opts.ydoc, provider: opts.provider, user: opts.user }),
  buildFileUpload(opts.uploadHandler),
  SlashMenu.configure({
    items: opts.slashItems,
    render: opts.slashRender,
  }),
  Mention.configure({
    HTMLAttributes: { class: 'mention' },
    renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
    renderHTML: ({ node }) => [
      'span',
      {
        class: 'mention',
        'data-type': 'mention',
        'data-id': node.attrs.id,
        'data-label': node.attrs.label,
      },
      `@${node.attrs.label ?? node.attrs.id}`,
    ],
    suggestion: {
      char: '@',
      items: ({ query }) => opts.mentionItems(query),
      command: ({ editor, range, props }) => {
        editor
          .chain()
          .focus()
          .insertContentAt(range, [
            {
              type: 'mention',
              attrs: { id: props.id, label: props.label },
            },
            { type: 'text', text: ' ' },
          ])
          .run()
      },
      render: opts.mentionRender,
    },
  }),
  BlockIndexAttributes,
  ColumnLayout,
  Column,
  DropPlacement,
]
