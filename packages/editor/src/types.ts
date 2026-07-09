import type { ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import type { PlantumlRenderAuth } from '@repo/plantuml/render-plantuml'
import type { EmbeddedDatabaseRenderer } from './extensions/embedded-database'
import type { SyncedBlockRenderer } from './extensions/synced-block'
import type { MeetingNotesBlockRenderer } from './extensions/meeting-notes-block'

export type {
  EmbeddedDatabaseRenderer,
  EmbeddedDatabaseRenderArgs,
} from './extensions/embedded-database'
export type { SyncedBlockRenderer, SyncedBlockRenderArgs } from './extensions/synced-block'
export type {
  MeetingNotesBlockRenderer,
  MeetingNotesBlockRenderArgs,
} from './extensions/meeting-notes-block'

/** The source/view chosen in the apps/web database picker dialog. */
export type EmbeddedDatabasePick = { sourceId: string; viewId: string | null }

/** The synced block chosen/created in the apps/web synced-block picker dialog. */
export type SyncedBlockPick = { blockId: string }

/** The meeting artifact chosen in the apps/web meeting-block picker dialog. */
export type MeetingNotesBlockPick = { meetingArtifactId: string }

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
  /** Free-form instruction — required for action 'custom'. */
  instruction?: string
  /** Prior refinement turns, oldest first (spec §4/§5). */
  history?: AskAiHistoryTurn[]
}

/** One turn of the inline-AI refinement history (client-held, ephemeral). */
export type AskAiHistoryTurn = {
  role: 'user' | 'assistant'
  content: string
}

/**
 * The streaming handle apps/web's bridge returns for one inline-AI request.
 *
 * CONTRACT — apps/web's `streamInlineAi` bridge (`createAskAI` /
 * `createGenerateAi`) MUST honor this shape verbatim:
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

/** Space-bar drafting request (spec §3): instruction + refinement history +
 *  the page text above the cursor. Returns the same streaming handle as askAI. */
export type GenerateAiArgs = {
  instruction: string
  history: AskAiHistoryTurn[]
  contextBefore?: string
}

export type GenerateAICallback = (args: GenerateAiArgs) => AskAIHandle

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
  // Live renderer for the meeting-notes-block node, injected by apps/web (the
  // access-checked `meeting.getById` query + the MUI summary card can't be
  // imported from @repo/editor). When omitted, the node renders its own
  // «Запись встречи» placeholder.
  renderMeetingBlock?: MeetingNotesBlockRenderer
  // Opens an apps/web picker that selects an existing meeting (`meeting.list`)
  // or launches the upload dialog for a new one. Resolves to the chosen
  // `{ meetingArtifactId }`, or null on cancel / when the user uploads a new
  // meeting (which navigates to the new MEETING page instead of inserting a
  // node). When omitted, the `/запись встречи` slash item is hidden.
  onPickMeetingBlock?: () => Promise<MeetingNotesBlockPick | null>
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
  // apps/web injects the space-bar drafting bridge here (spec §3). When present,
  // Space on an empty top-level paragraph opens the AI bar and the empty-line
  // placeholder advertises it.
  generateAI?: GenerateAICallback
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
