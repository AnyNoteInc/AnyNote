import type { ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import type { PlantumlRenderAuth } from '@repo/plantuml/render-plantuml'
import type { EmbeddedDatabaseRenderer } from './extensions/embedded-database'
import type { SyncedBlockRenderer } from './extensions/synced-block'

export type {
  EmbeddedDatabaseRenderer,
  EmbeddedDatabaseRenderArgs,
} from './extensions/embedded-database'
export type { SyncedBlockRenderer, SyncedBlockRenderArgs } from './extensions/synced-block'

/** The source/view chosen in the apps/web database picker dialog. */
export type EmbeddedDatabasePick = { sourceId: string; viewId: string | null }

/** The synced block chosen/created in the apps/web synced-block picker dialog. */
export type SyncedBlockPick = { blockId: string }

// --- Inline AI («Спросить AI») injection (spec §4.3) -----------------------
//
// The editor package owns NO tRPC/fetch. apps/web injects an `askAI` closure
// (page-renderer → AnyNoteEditor → InlineAI extension → editor.storage.ai) that
// turns a preset action + the current selection into the `/api/ai/inline` SSE
// stream. The popover calls it and wires the returned handle's callbacks to the
// InlineAI plugin metas (onToken → appendToken, done → finish, onError → fail);
// «Принять» applies the accumulated text in one transaction; «Повторить» aborts
// + re-calls; «Отклонить» clears.

/** What the popover sends when the user picks a preset action on the selection. */
export type AskAIArgs = {
  /** The preset action id (the server-side allow-list authority validates it). */
  action: string
  /** Start of the selection in the editor doc (informational; range lives in the plugin). */
  from: number
  /** End of the selection in the editor doc. */
  to: number
  /** The plain text of the selection — the ONLY model context (spec §7.2). */
  selectedText: string
  /** Target language for the `translate` action (e.g. 'English'); ignored otherwise. */
  targetLang?: string
}

/**
 * The streaming handle apps/web's bridge returns for one inline-AI request.
 *
 * CONTRACT — Task 4 (apps/web `createAskAI`) MUST honor this shape verbatim:
 *   - `onToken(cb)` registers a callback invoked with each text delta as it
 *     streams (multiple deltas; the popover folds each into `appendToken`).
 *     Registering after a delta has already arrived is allowed; the bridge may
 *     replay or simply emit subsequent deltas — the popover registers
 *     synchronously before the stream is consumed.
 *   - `onError(cb)` registers a callback invoked once with a user-facing message
 *     on a transport / non-OK response (400/403/429 → the spec §4.2 copy). After
 *     `onError` fires, `done` still resolves (it never rejects) so the popover
 *     has a single completion path.
 *   - `done` is a Promise that resolves when the stream has fully ended (success
 *     OR error OR abort). It NEVER rejects — errors surface via `onError`.
 *   - `abort()` cancels the in-flight request (real cancellation — it aborts the
 *     fetch, tearing down the upstream agents generation per spec §7.4). Safe to
 *     call after completion (no-op). Used by «Повторить»/«Отклонить» and unmount.
 */
export type AskAIHandle = {
  onToken: (cb: (delta: string) => void) => void
  onError: (cb: (message: string) => void) => void
  done: Promise<void>
  abort: () => void
}

/** apps/web injects this — one call per action-pick, returns a stream handle. */
export type AskAICallback = (args: AskAIArgs) => AskAIHandle

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
  // Live renderer for the synced-block node, injected by apps/web (the nested
  // collaborative editor + access-checked tRPC query can't be imported from
  // @repo/editor). When omitted, the node renders its own placeholder.
  renderSyncedBlock?: SyncedBlockRenderer
  // Opens an apps/web picker that either CREATES a new synced block (tRPC
  // `syncedBlock.create`) or selects an existing one (`syncedBlock.list`).
  // Resolves to the chosen/created `{ blockId }`, or null on cancel; the editor
  // then inserts the `syncedBlock` node. When omitted, the `/синхронизированный
  // блок` slash item is hidden.
  onPickSyncedBlock?: () => Promise<SyncedBlockPick | null>
  // Opens an apps/web picker of the user's DATABASE sources. Resolves to the
  // chosen source/view, or null if the user cancels; the editor then inserts the
  // node. When omitted, the `/база данных` slash item is hidden.
  onPickEmbeddedDatabase?: () => Promise<EmbeddedDatabasePick | null>
  // apps/web injects a thin `fetch('/api/bookmark/preview')` wrapper (Task 4) so
  // a «Закладка» insert/paste can async-fill its og:title/description/image.
  // Tolerated absent — the bookmark stays a bare card until wired.
  bookmarkPreview?: import('./extensions/url-paste').PreviewFetch
  // apps/web injects the inline-AI streaming bridge here (spec §4.3). When
  // present, the «Спросить AI» bubble-menu button appears over a selection and
  // the action popover streams a preset transform into a local preview. When
  // absent (public share / read-only / unwired), the button is hidden.
  askAI?: AskAICallback
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
