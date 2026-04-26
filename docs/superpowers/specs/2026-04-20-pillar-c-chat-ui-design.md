# Pillar C — `packages/chat` Chat UI Library Design

**Date:** 2026-04-20
**Author:** brainstormed with Claude
**Status:** Draft → pending user review

## Context

Pillars A (DB), B1 (`apps/agents`), and D (indexing pipeline) are
merged. Users still cannot chat with their workspace from the web app:
there is no UI surface that talks to `apps/agents`, and no reusable
chat shell to drop into other contexts (sidebar, modal, embedded
"explain this page" affordance).

Pillar C builds the UI half: a reusable React package
(`packages/chat`, scoped `@repo/chat`) that provides a complete chat
shell — message list, composer, markdown rendering, streaming-aware
bubble — without coupling to any specific transport. The host
application (initially `apps/web`) is responsible for fetching, SSE
parsing, and persistence; the package only renders.

## Goals

1. New workspace package `packages/chat` (`@repo/chat`) following
   project conventions: TypeScript NodeNext source, MUI v6, exported
   via `@repo/chat/components` / `@repo/chat/hooks` / `@repo/chat/types`
   subpaths (no `*` re-export from the package root, per CLAUDE.md
   tree-shaking guidance).
2. Public component surface (UI-first):
   - **`<ChatShell>`** — root container that arranges header / list /
     composer with the recommended max-width and centered layout.
   - **`<ChatHeader>`** — slot-based top bar (title, actions slot).
   - **`<MessageList>`** — virtualized-friendly vertical list with
     auto-scroll behavior + grouping.
   - **`<MessageBubble>`** — single message; switches on `parts[]` /
     `content`, role, status, attachments, tool calls.
   - **`<Composer>`** — Tiptap-backed lightweight input (Document +
     Paragraph + Text + HardBreak + Placeholder + History) with
     auto-grow, send button, enter/shift+enter handling, IME-safe.
   - **`<ChatEmptyState>`** — title + subtitle + optional suggestion
     chips for empty thread.
   - **`<TypingIndicator>` / `<StreamingCursor>`** — composable visual
     bits for assistant streaming.
   - **`<MarkdownRenderer>`** — wrapper around `react-markdown` +
     `remark-gfm` + `rehype-highlight` for code (matches the rest of
     the workspace's markdown choices in `packages/ui` if any; a fresh
     dep tree is fine if not).
3. Public hook surface:
   - **`useAutoScroll(ref)`** — sticky-bottom logic with manual
     scroll-up override and a `scrollToBottom()` returnable.
   - **`useMessageGroups(messages)`** — groups consecutive same-role
     messages.
   - **`useChatStream({ submit })`** — convenience: takes a
     host-provided `submit(text) → AsyncIterable<TokenChunk>` and
     manages local `messages` state + streaming append. Host is free
     to skip this hook and drive the controlled API directly.
4. Public type surface (`@repo/chat/types`):
   ```ts
   export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'
   export type MessageStatus = 'sending' | 'streaming' | 'done' | 'error'
   export type ChatMessagePart =
     | { type: 'text'; text: string }
     | { type: 'markdown'; text: string }
     | { type: 'code'; language?: string; code: string }
     | { type: 'tool_call'; toolCallId: string }
     | { type: 'attachment'; attachmentId: string }
   export interface ChatAttachment {
     /* per agent.md */
   }
   export interface ChatToolCall {
     /* per agent.md */
   }
   export interface ChatMessage {
     id: string
     role: MessageRole
     content?: string
     parts?: ChatMessagePart[]
     attachments?: ChatAttachment[]
     toolCalls?: ChatToolCall[]
     status?: MessageStatus
     errorMessage?: string
     createdAt?: string | Date
   }
   ```
5. Storybook-free isolated dev story: a thin `apps/web` route at
   `/app/chat-demo` (gated to dev: 404 when `NODE_ENV=production`)
   that renders `ChatShell` against an in-memory message list +
   simulated streaming so the UI can be QA'd without the agents
   service.
6. Vitest unit tests for hooks (`useAutoScroll`, `useMessageGroups`,
   `useChatStream`) and contract-level component tests
   (`MessageBubble` switches on parts; `Composer` enter/shift+enter
   semantics).
7. Repo green: `pnpm check-types`, `pnpm lint`, `pnpm build` across
   the workspace.

## Non-Goals

- **No SSE transport inside the package.** Host calls the agents
  service and feeds tokens via the controlled API (`onChange` of last
  assistant message) or via `useChatStream`'s `submit` callback.
- **No backend persistence in this pillar.** Persisting messages to
  `Chat` / `ChatMessage` tables (Pillar A) is wired in a follow-up
  pillar that integrates the chat into the web app proper.
- **No agents-side streaming SSE consumer in `apps/web`.** Pillar C
  ships only the `chat-demo` page (simulated stream). A real
  integration that calls `apps/agents` is a separate pillar.
- **No file/voice attachment upload UX.** The types support
  `ChatAttachment` so a future pillar can wire MinIO/S3 upload, but
  the composer in C doesn't ship a file picker.
- **No real Tiptap RTE features.** The composer is intentionally
  plain-text + hard breaks; rich formatting belongs to the page
  editor (`packages/editor`), not to chat input.
- **No tool-call execution.** `<MessageBubble>` renders the tool-call
  status row, but the actual call is the agents service's job
  (Pillar B2 / E).
- **No virtualization.** A native scrolling `<div>` is sufficient at
  the conversation lengths users will hit before the search-and-summary
  affordances land. Virtualization can be added later behind the same
  `<MessageList>` API.
- **No re-export of MUI from `@repo/chat` root.** Same rationale as
  `@repo/ui`: kills tree-shaking.

## Architecture

### Package layout

```
packages/chat/
  package.json
  tsconfig.json
  vitest.config.ts
  README.md
  src/
    index.ts              # narrow re-exports of subpaths
    components/
      index.ts            # barrel
      chat-shell.tsx
      chat-header.tsx
      message-list.tsx
      message-bubble.tsx
      message-bubble-parts.tsx
      composer.tsx
      chat-empty-state.tsx
      typing-indicator.tsx
      streaming-cursor.tsx
      markdown-renderer.tsx
      tool-call-row.tsx
      attachment-row.tsx
    hooks/
      index.ts
      use-auto-scroll.ts
      use-message-groups.ts
      use-chat-stream.ts
    types/
      index.ts
    theme/
      tokens.ts           # spacing + radius constants
  test/
    use-auto-scroll.test.ts
    use-message-groups.test.ts
    use-chat-stream.test.tsx
    composer.test.tsx
    message-bubble.test.tsx
```

### Public API discipline

- Root `src/index.ts` exports nothing; consumers import from subpaths.
- `package.json` `exports` map:
  ```json
  {
    ".": "./src/index.ts",
    "./components": "./src/components/index.ts",
    "./hooks": "./src/hooks/index.ts",
    "./types": "./src/types/index.ts",
    "./theme": "./src/theme/tokens.ts"
  }
  ```
- All files under `components/` use `"use client"` (forwardRef + MUI +
  Tiptap are client-only). The package is configured in
  `apps/web/next.config.js` `transpilePackages` array so Next.js
  consumes the source directly (matches `@repo/ui` / `@repo/editor`).

### Layout

`<ChatShell>` is `display: flex; flex-direction: column;
height: 100%`. Header at top (sticky), `<MessageList>` flex-grow with
`overflowY: auto`, `<Composer>` pinned at bottom with auto-grow up to
~40 % viewport height. Max content width 720 px, centered. Mobile (<
600 px) full-bleed with composer keyboard-safe inset.

### Streaming model

The package never owns the stream. Host updates `messages` state in
two ways:

1. **Controlled append** — host receives a token, calls
   `setMessages(ms => updateLast(ms, t => t + token))`.
2. **`useChatStream` convenience** — host implements `submit(prompt) →
AsyncIterable<{ delta: string }>`, the hook adds the user message,
   creates an assistant message with `status: "streaming"`, and
   appends `delta`s as they arrive. On `for await` completion the
   assistant message gets `status: "done"`.

`<MessageBubble>` reads `status`. While `streaming`, it appends a
`<StreamingCursor>` (blinking caret). When `done`, the cursor is
removed.

### Composer (Tiptap)

Minimal extension set:

- `Document`, `Paragraph`, `Text`, `HardBreak`
- `Placeholder` (with text from props)
- `History` (so undo/redo works)

Behavior:

- Enter → `onSubmit(plainText())` and clear.
- Shift+Enter → insert `HardBreak`.
- IME composition: do NOT submit while `compositionstart` is active
  (track via React ref).
- `editor.getText({ blockSeparator: "\n" })` is the canonical
  serialization to plain text.
- Auto-grow: editor's natural height up to `maxHeight: 40vh`, then
  internal scroll.
- Disabled state when `submitting` true; send button shows MUI
  `<CircularProgress>` instead of icon.

### Auto-scroll hook

```ts
const { containerRef, isPinned, scrollToBottom } = useAutoScroll({
  threshold: 80, // px from bottom counts as "pinned"
})
```

- Listens to `scroll` on the container; updates `isPinned`.
- When `messages` change AND `isPinned`, calls `scrollToBottom()`.
- When `messages` change and not pinned, leaves scroll alone but
  exposes `scrollToBottom` so the host can show a "jump to bottom"
  FAB.

### Message grouping

```ts
const groups = useMessageGroups(messages)
// → [{ key, role, messages: ChatMessage[] }, …]
```

Pure function under the hood; just memoizes via `useMemo`. Bubbles in
the same group share the role badge / avatar; only the last bubble
shows the timestamp.

### Markdown renderer

`react-markdown` + `remark-gfm` + `rehype-highlight` (or
`shiki-renderer-html` if perf becomes a problem). Code blocks render
with copy button. Inline code uses MUI `<Typography>` mono. Links open
in new tab with `rel="noopener"`.

### Theme tokens

`theme/tokens.ts` exposes a small constants module (radii, spacing,
gradients) so consumers can reuse them when extending. The components
themselves consume MUI `useTheme()` for palette + typography so they
respect the host's theme.

### Testing strategy

- **Vitest + @testing-library/react** for components and hooks
  (matches `apps/web` test stack — verify by reading
  `apps/web/package.json` during T1).
- Unit tests cover:
  - `useAutoScroll` — pinned vs unpinned; appended messages don't
    scroll when user is reading history.
  - `useMessageGroups` — consecutive-role grouping; role boundaries.
  - `useChatStream` — happy-path streaming append, error handling.
  - `<Composer>` — enter submits, shift+enter inserts break, IME
    composition does not submit.
  - `<MessageBubble>` — switches on `parts[]` (markdown vs code vs
    tool_call); falls back to `content`.
- No Storybook (out of scope). The dev story is the `chat-demo` page.

### Dev integration: `/app/chat-demo`

A protected route in `apps/web/src/app/(protected)/chat-demo/page.tsx`
that returns 404 in production:

```tsx
import { notFound } from 'next/navigation'
import { ChatDemoClient } from './chat-demo-client'

export default function ChatDemoPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <ChatDemoClient />
}
```

The client component imports `<ChatShell>` and uses `useChatStream`
with a fake `submit` that yields tokens from a hardcoded markdown
response on a `setTimeout` schedule. This is enough for QA without
touching `apps/agents`.

## Failure model

| Scenario                                          | Behavior                                                                                                                                                  |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host throws inside `submit`                       | `useChatStream` flips last assistant message to `status: "error"` with `errorMessage`; bubble renders inline error + retry button (host wires `onRetry`). |
| Empty `messages`                                  | `<ChatEmptyState>` renders centered.                                                                                                                      |
| Tiptap initialization fails (SSR import)          | All composer code is `"use client"`; host renders `<ChatShell>` only inside a client boundary. The `chat-demo` page wraps in a Client Component.          |
| User submits while previous response is streaming | `useChatStream` queues the new message; submission is gated on `lastStatus !== "streaming"`. Host can override via `allowConcurrent: true` prop.          |
| Markdown renderer chokes on malformed input       | `react-markdown` already handles arbitrary input safely; we don't sanitize HTML further (no `rehype-raw`).                                                |

## Open questions resolved during brainstorm

- **Where do we put the demo?** A dev-gated route under
  `(protected)/`. No new app, no Storybook setup; consistent with how
  the editor is dogfooded.
- **Do we own the SSE consumer?** No. Spec D's worker decides what
  goes into Qdrant; agents service yields tokens; the chat package
  only renders. This separation makes the package reusable in
  non-streaming contexts (e.g. surfacing static assistant explanations
  in admin tools).
- **Markdown library?** `react-markdown` + `remark-gfm` is the
  smallest reasonable choice. If shiki ends up better-suited for code
  highlighting, swap it later behind the same `<MarkdownRenderer>`
  surface.
- **Virtualization?** Not in C. Long-thread perf is a separate concern;
  the API of `<MessageList>` already takes `messages: ChatMessage[]`
  so a virtualized impl can drop in transparently.

## Out of scope for C

- Real `apps/web` integration (sidebar surface, modal, header button)
- Persisting Chat / ChatMessage rows
- Tool execution
- Attachment upload UX
- Voice input
- Workspace / model picker UI (Pillar F)

## Success criteria

- `pnpm install && pnpm build` passes; new package picked up by
  Turborepo.
- `pnpm --filter @repo/chat test` passes (≥10 specs covering hooks +
  composer + bubble).
- `pnpm dev`, navigate to `http://localhost:3000/chat-demo`: see the
  empty state, send a message, see streaming tokens render with
  markdown, see grouping for consecutive assistant messages.
- `pnpm check-types` and `pnpm lint` green workspace-wide.
