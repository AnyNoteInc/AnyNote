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
import type { PlantumlRenderAuth } from '@repo/plantuml/render-plantuml'

import { BlockBackground } from './block-background'
import { BlockIndexAttributes } from './block-index-attributes'
import { Audio } from './audio'
import { Bookmark } from './bookmark'
import { Callout } from './callout'
import { CodeBlock } from './code-block'
import { ChatContextHighlight } from './chat-context-highlight'
import { buildCollaboration } from './collaboration'
import { Comments } from './comments'
import { Column, ColumnLayout } from './column-layout'
import { DropPlacement } from './drop-placement'
import { Drawio } from './drawio'
import { Embed } from './embed'
import { EmbeddedDatabase, type EmbeddedDatabaseRenderer } from './embedded-database'
import { FileAttachment } from './file-attachment'
import { buildFileUpload } from './file-upload'
import { buildImagePaste } from './image-paste'
import { buildUrlPaste, type PreviewFetch } from './url-paste'
import { HiddenText } from './hidden-text'
import { InlineAI, type InlineAiRenderPreview } from './inline-ai'
import { SpaceAI } from './space-ai'
import { MeetingNotesBlock, type MeetingNotesBlockRenderer } from './meeting-notes-block'
import { PageLink } from './page-link'
import { Reminder } from './reminder'
import { DateNode } from './date'
import { buildPlaceholder } from './placeholder'
import { ResizableImage } from './resizable-image'
import { SlashMenu, type SlashMenuRender } from './slash-menu'
import { SyncedBlock, type SyncedBlockRenderer } from './synced-block'
import { Tab, Tabs } from './tabs'
import { Video } from './video'
import { TaskItemWithCheckbox } from './task-item-view'
import { AnynoteTextColor } from './text-color'
import { LINK_HTML_ATTRIBUTES } from '../link-href'
import type {
  AnyNoteEditorUser,
  AskAICallback,
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
  onOpenThread: (threadId: string) => void
  plantumlRenderAuth?: PlantumlRenderAuth
  // apps/web injects the live `DatabaseTableView` renderer for the embedded
  // database node here (it can't be imported from @repo/editor). When absent,
  // the node renders its own placeholder card.
  renderEmbeddedDatabase?: EmbeddedDatabaseRenderer
  // apps/web injects the live nested-editor / snapshot / access-placeholder
  // renderer for the synced-block node here (it can't import apps/web's tRPC). When
  // absent, the node renders its own «Синхронизированный блок» placeholder.
  renderSyncedBlock?: SyncedBlockRenderer
  // apps/web injects the live access-checked meeting summary card renderer for
  // the meeting-notes-block node here (it can't import apps/web's tRPC). When
  // absent, the node renders its own «Запись встречи» placeholder.
  renderMeetingBlock?: MeetingNotesBlockRenderer
  // The current pageId — used as the localStorage key for the per-page rich-embed
  // toggle (the Embed node reads it). Optional; defaults to always-on.
  pageId?: string | null
  // apps/web injects a thin `fetch('/api/bookmark/preview')` wrapper (Task 4) so
  // a «Закладка» paste can async-fill its title/description/image. Tolerated
  // absent — the bookmark stays a bare card until wired.
  bookmarkPreview?: PreviewFetch
  // apps/web injects the inline-AI streaming bridge (spec §4.3). The InlineAI
  // extension exposes it on editor.storage.ai for the bubble-menu button + drives
  // the local streaming-preview decoration. Absent → the button is hidden.
  askAI?: AskAICallback
  // The widget renderer for the inline-AI streaming preview (the MUI-light DOM
  // toolbar). Lives in the React layer (components/inline-ai-popover) so the
  // schema-only extensions barrel stays free of UI imports; anynote-editor passes
  // it in. Absent → the plugin falls back to a bare text span.
  inlineAiRenderPreview?: InlineAiRenderPreview
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
  Link.configure({
    openOnClick: false,
    enableClickSelection: true,
    HTMLAttributes: LINK_HTML_ATTRIBUTES,
  }),
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
  Video.configure({ uploadHandler: opts.uploadHandler }),
  Audio.configure({ uploadHandler: opts.uploadHandler }),
  TaskList,
  TaskItemWithCheckbox.configure({ nested: true }),
  Table.configure({ resizable: true }),
  TableRow,
  TableHeader,
  TableCell,
  CodeBlock.configure({ lowlight, plantumlRenderAuth: opts.plantumlRenderAuth }),
  Callout,
  HiddenText,
  FileAttachment,
  Bookmark,
  Embed.configure({ pageId: opts.pageId ?? null }),
  Drawio.configure({ drawioUrl: opts.drawioUrl }),
  EmbeddedDatabase.configure({ renderEmbed: opts.renderEmbeddedDatabase ?? null }),
  SyncedBlock.configure({
    renderSyncedBlock: opts.renderSyncedBlock ?? null,
    onNavigateToPage: opts.onNavigateToPage,
  }),
  MeetingNotesBlock.configure({
    renderMeetingBlock: opts.renderMeetingBlock ?? null,
    onNavigateToPage: opts.onNavigateToPage,
  }),
  PageLink.configure({ onNavigate: opts.onNavigateToPage }),
  Reminder,
  DateNode,
  ...buildCollaboration({ ydoc: opts.ydoc, provider: opts.provider, user: opts.user }),
  buildImagePaste(opts.uploadHandler),
  buildFileUpload(opts.uploadHandler),
  buildUrlPaste(opts.bookmarkPreview),
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
  Tabs,
  Tab,
  DropPlacement,
  Comments.configure({ onOpenThread: opts.onOpenThread }),
  SpaceAI,
  InlineAI.configure({
    askAI: opts.askAI ?? null,
    renderPreview: opts.inlineAiRenderPreview ?? null,
  }),
  ChatContextHighlight,
]
