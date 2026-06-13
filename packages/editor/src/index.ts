export { AnyNoteEditor } from './anynote-editor'
export { AnyNotePlainEditor, type AnyNotePlainEditorProps } from './plain-editor'
export {
  SyncedBlockNestedEditor,
  type SyncedBlockNestedEditorProps,
} from './synced-block-nested-editor'
export {
  SYNCED_BLOCK_LABEL,
  createSyncedBlockNode,
  emptySyncedBlockDoc,
} from './extensions/synced-block'
export { EditorThemeBridge } from './theme-bridge'
export { createSlashItems } from './slash-items'
export { filterMentionItems } from './mentions'
export type { SlashMediaHandlers } from './slash-items'
export { BlockMoveDialog } from './components/block-move-dialog'
export { moveBlockToPage } from './lib/block-move'
export type { MoveBlockResult } from './lib/block-move'
export { scrollToBlockIndex } from './block-anchor'
export type { Editor, JSONContent } from '@tiptap/core'
export type {
  AnyNoteEditorProps,
  AnyNoteEditorUser,
  CommentThreadAnchor,
  MentionLookupItem,
  PageLookupItem,
  SlashCommandGroup,
  SlashCommandItem,
  SlashRange,
  SyncedBlockPick,
  SyncedBlockRenderArgs,
  SyncedBlockRenderer,
  UploadHandler,
  UploadedFile,
} from './types'
