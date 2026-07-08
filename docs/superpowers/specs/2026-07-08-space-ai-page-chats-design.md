# Space-triggered AI + free-form selection AI + page chats — Design

**Status:** approved (design decisions locked via AskUserQuestion 2026-07-08)
**Builds on:** Phase 9D inline AI (`2026-06-18-inline-ai-editor-design.md`, merged d25c322e) — this feature deliberately un-defers two of 9D's explicit non-goals (the empty-line **Space** trigger and free-form instructions) and adds page-scoped chats.
**Branch:** `feat/space-ai-page-chats` off `main`.

## 1. Goal

Three AI surfaces on TEXT pages, all riding the workspace's own AI provider settings (never a hidden global provider):

1. **Space AI** — pressing Space on an empty top-level line opens a caret-anchored mini-dialog: type an instruction («сделай базу данных для хранения пользователей в формате mermaid»), watch the streaming proposal, refine it with follow-ups («добавь поле email»), then insert the final markdown/code into that line.
2. **Free-form selection instruction** — the existing «Спросить AI» popover (six presets) gains a custom-instruction field («сделай списком», «исправь термины»…), reusing the 9D preview/accept/discard machinery unchanged.
3. **Page chats** — a MUI FAB at the bottom-right of a page opens a right-side panel (~400px, the comments-sidebar pattern) hosting **multiple** full-featured agent chats attached to that page (Codex-style context threads). The whole page — or only the current selection, when one exists at send time — is injected into the prompt.

## 2. Scope (locked)

**In scope:**
- Space trigger + caret-anchored overlay mini-dialog with ephemeral refinement history and «Вставить»/«Отмена».
- `custom` free-form action added to the existing selection popover and `/api/ai/inline` allow-list.
- `ChatKind.PAGE` + `Chat.pageId`; `chat.listByPage`; page-context injection in `/api/agents/generate`; FAB + `PageChatSidebar` + `PageChatProvider` in the workspace layout.
- Plan gating on **existing** flags: `aiSettingsEnabled` for surfaces 1–2 (already enforced by `/api/ai/inline`), `chatsEnabled` for page chats. Both are ПРО+МАКС — the user's «ПРО и выше» decision. **No new plan flags, no seed changes.**

**Explicitly OUT of scope (decided, not oversights):**
- Non-TEXT page types (KANBAN/DATABASE/boards…). Comments are TEXT-only today; same precedent. The FAB and Space trigger render only on TEXT pages.
- Persisting the Space-overlay refinement history (closing the overlay discards it; the hidden INLINE_AI chat row is transport, not storage).
- Page chats in the global `/chats` list (locked: page chats live **only** in their page's panel; `listChats`/`listFavorites` keep filtering `kind: 'NORMAL'`).
- MCP tools / RAG in the Space overlay and selection actions (single-shot prompt→llm rails, fast). Page chats keep the **full** agent (tools, RAG, memories) — that's their point.
- Token quotas; multi-instance rate limiting (same single-instance limiter as 9D).
- Page context in the Space overlay prompt (standalone generation; the user edits the result in place anyway).

## 3. Space AI — editor surface

### 3.1 Trigger extension
New `packages/editor/src/extensions/space-ai.ts` — `Extension.create` with `addKeyboardShortcuts({ Space })`. Nothing else in the editor handles Space (verified: only markdown input rules, which never fire on an empty paragraph, and a bookmark node-view DOM handler). Guard, in order:
- capability injected (`editor.storage.ai?.onSpaceAi` set — apps/web injects it only when the plan allows and the page is editable);
- selection is a caret (`empty`);
- parent is a **paragraph** with `content.size === 0`;
- **top-level** (`$from.depth === 1`) — never fires inside details/callout/table cells/blockquotes.

On match: consume the keypress (return `true`), compute the caret rect (`view.coordsAtPos`), call `onSpaceAi({ pos, getRect })`. Otherwise return `false` and let the space insert normally.

### 3.2 Overlay component
`packages/editor/src/components/space-ai-overlay.tsx` — MUI Popover on a virtual anchorEl at the caret (the slash-menu `slashClientRectRef` trick). Layout: instruction input (autofocus) → streaming proposal preview → refinement input + «Отмена» / «Вставить». Behaviour:
- First submit calls the injected `generateAi({ instruction, history: [] })` (an `AskAIHandle`-shaped stream: `onToken`/`onError`/`done`/`abort`). Tokens accumulate into the proposal.
- Each refinement re-calls `generateAi` with the accumulated `history` (`[{role:'user'|'assistant', content}...]`); the new proposal **replaces** the preview. History lives only in component state.
- Preview rendering: rendered markdown if a suitable lightweight renderer already exists in the chat kit (`@repo/ui` text-part renderer) and can be reused without layering violations; otherwise v1 renders raw markdown in a monospace scroll box (for the mermaid use-case raw code is the more honest preview anyway). Decided during implementation; both are acceptable v1.
- «Вставить» → markdown → Tiptap content via the **same markdown→content path the existing «Markdown» slash item uses** (a fenced ` ```mermaid ` block becomes a code block naturally). Insertion targets the trigger paragraph (position re-resolved through transaction mapping, not the captured offset) and MUST go through `deferModalInsert` — direct insertion after an async dialog produces transactions y-prosemirror never syncs (documented repo trap).
- Esc / «Отмена» / click-away → abort any in-flight stream, close, discard. The document is never touched before «Вставить»; insertion is one transaction (one collaborative-undo step).
- A monotonic run token guards against a superseded refinement leaking late tokens (the `inline-ai-popover.tsx` session-token pattern).

### 3.3 Injection thread
`AnyNoteEditorProps.generateAI?: GenerateAICallback` (new, `packages/editor/src/types.ts`) → `buildExtensions` → the SpaceAI extension exposes `onSpaceAi` on `editor.storage.ai` (merged, not clobbered — the 9D `onCreate` merge gotcha) → `anynote-editor.tsx` renders `<SpaceAiOverlay>` as a sibling of `EditorContent` (the `InlineAiPopover` precedent) → `page-renderer.tsx` builds the closure via a new `createGenerateAi({ pageId, workspaceId })` in `apps/web/src/components/page/inline-ai-bridge.ts`, passed only when `editable && planFeatures.aiSettingsEnabled`.

## 4. Space AI + custom action — backend (extend `/api/ai/inline`)

Same rails as 9D — hidden `Chat(kind=INLINE_AI)` per (user, page), plan gate `aiSettingsEnabled`, shared 10/60s per-(user,workspace) rate limit, `assertPageEditable` uniform-404, workspace `defaultModel` required (400 `NO_MODEL`), direct SSE passthrough with real cancellation (`req.signal`), no MCP servers, audit row per run. Two new allow-listed actions in `apps/web/src/lib/ai/inline-prompts.ts`:

- **`generate`** (Space overlay): body `{ action: 'generate', instruction: string (1..2000), history: {role: 'user'|'assistant', content: string}[] (≤10 turns, each ≤16k chars, ≤48k total), pageId, workspaceId }`. The server builds the user message from a server-side template: produce **only** the final markdown to insert, no explanations, fenced code blocks for diagrams (mermaid etc.), answer in the instruction's language. `history` maps onto the existing `chat_history` field of `buildAgentRunPayload` (single-shot thread otherwise unchanged).
- **`custom`** (selection popover): body `{ action: 'custom', instruction: string (1..500), selectedText, pageId, workspaceId }`. Template wraps the capped selection in triple quotes (the existing `buildInlinePrompt` shape) + the user instruction + «выведи только результат без пояснений». Accept semantics = replace `[from, to]`, identical to presets.

Posture note (an intentional, documented change from 9D §7.3): the client still cannot supply a **system** prompt — templates stay server-side — but `instruction` is free-form **user** content embedded in the user message. That is the feature, not a leak: the user is prompting their own workspace model, exactly as they already can in chats.

Zod validation and length caps live in the handler schema; unknown actions still 400. `writeInlineAiAudit` metadata records `preset: 'generate' | 'custom'` (instruction text is NOT audited — same privacy stance as selections today).

## 5. Selection popover — free-form field

`packages/editor/src/components/inline-ai-popover.tsx`: below the six presets, a TextField «Своя инструкция…» + submit (Enter / send IconButton). Submits `runInlineAi` with `action: 'custom'` and the captured selection; the preview decoration, Принять/Повторить/Отклонить toolbar, drift-guarded range mapping, and retry-token machinery are untouched. Retry re-runs the same custom instruction.

## 6. Page chats — data model & API

### 6.1 Prisma
```prisma
enum ChatKind { NORMAL INLINE_AI PAGE }

model Chat {
  // ... existing ...
  pageId String? @db.Uuid           // PAGE chats only; NOT reused: inlineAiPageId
  page   Page?   @relation("PageChats", fields: [pageId], references: [id], onDelete: SetNull)
  @@index([pageId])
}
```
- `inlineAiPageId` is **not** reused — it carries `@@unique([createdById, inlineAiPageId])` (one-per-user+page), which contradicts many-chats-per-page.
- Page hard-delete tx + trash purge (`pages.repository.ts`) delete `Chat where pageId = <page>` alongside the existing INLINE_AI pruning (the FK alone would orphan them as SetNull rows invisible to any UI).
- One migration. Feature branch owns it; if the shared dev DB drifts, apply via the established diff→`psql --single-transaction`→`migrate resolve --applied` flow.

### 6.2 tRPC (`packages/trpc/src/routers/chat.ts`)
- `createChat` gains optional `pageId`; when present the server verifies **page visibility** (`buildPageVisibilityWhere`) and creates the chat with `kind: 'PAGE'` (client cannot set `kind` directly). Plan gate: `chatsEnabled` FORBIDDEN check (same tier the normal chat UI requires).
- New `listByPage({ workspaceId, pageId })` → PAGE chats for that page, `orderBy updatedAt desc`, page-visibility-checked.
- `assertChatAccess` extended: for `kind === 'PAGE'` chats it additionally requires current page visibility — otherwise a workspace member who cannot see a private page could read its chat (and its injected page content) by id. Applies to `getChat`/`renameChat`/`deleteChat`/generate.
- `listChats`/`listFavorites` keep `kind: 'NORMAL'` — page chats never leak into the sidebar.

### 6.3 Page context injection (`/api/agents/generate`)
Request body gains optional `pageContext: { content: string, isSelection: boolean }`, accepted **only** when the target chat is `kind === 'PAGE'` (400 otherwise). The **client** serializes the live editor content to markdown (the `@repo/editor` serializer shipped with «Копировать текст») — fresher than the server's `Page.content` snapshot (Hocuspocus debounce) and requires no server-side Tiptap→markdown converter. When a non-empty selection exists at send time, the client sends **only** the selected text with `isSelection: true` (the user's rule: selection replaces the whole page).

Server: validate chat kind + page visibility, cap `content` at 200k chars (truncate the tail with an explicit «…контент обрезан» marker — an honest, documented limitation), then inject as a **synthetic attachment** `{ id: 'page-context', name: `${page.title}.md` | 'Выделенный фрагмент.md', mime: 'text/markdown', included: true, content }` — riding the proven attachments channel (`_attachments.j2` already wraps it in a prompt-injection guard in both planner and executor prompts). Everything else — MCP tools, RAG, memories, thinking settings, stream registry, resume — is the unchanged normal-chat pipeline.

Trust note: client-supplied content is not a new privilege — the user can paste anything into a message today; the server still independently verifies the user can see the page the chat is bound to.

### 6.4 Auto-titling
The generate route's existing first-message auto-rename («Новый чат» → first text) applies to page chats unchanged.

## 7. Page chats — UI

- **`Fab` re-export** added to `packages/ui/src/components/index.ts` (repo rule: never `@mui/material` directly from app code).
- **FAB**: rendered for TEXT pages when `usePlanFeaturesOptional()?.chatsEnabled` (hidden otherwise — the meetings hide-pattern), fixed at the bottom-right of the main content column, `right` offset accounting for whichever right panels are open (the `EditorOutline.rightOffset` coordination pattern). Click toggles the chat panel. Icon: a chat/sparkle MUI icon; tooltip «Чат по странице».
- **`PageChatProvider`** (`apps/web/src/components/page/page-chat/`): clone of the comments-context shape — `panelOpen/togglePanel/closePanel` + `activeChatId`, reset-on-page-change without provider remount. Mounted in `workspace-layout-client.tsx` beside `PageCommentsProvider` (and, like comments, in `page-view.tsx` if page chats should exist on embedded surfaces — v1: layout only, PageView surfaces skip the FAB).
- **`PageChatSidebar`**: third `activePageId`-gated sibling column (plain Box, `width: 400`, `borderLeft`, `flexShrink: 0` — the comments-sidebar pattern, NOT a Drawer). Header: chat switcher (Select over `chat.listByPage`, newest first) + «Новый чат» + overflow menu (переименовать/удалить via existing procedures). Body: `WorkspaceChatClient` with a new `variant: 'page'` prop that (a) suppresses `history.replaceState`/`buildChatHref` navigation, (b) passes `pageId` to `createChat`, (c) supplies a `getPageContext()` callback read at send time from the existing `PageEditorProvider` (live editor → markdown; selection → `{content: selectedText, isSelection: true}`).
- `EditorOutline.rightOffset` (and comments/history offset math) accounts for the 400px chat panel; only one right panel is open at a time is NOT enforced today for comments vs history — the chat panel follows whatever coexistence rule those two already implement (verified in the plan phase; if they stack, chat stacks the same way).

## 8. Security / correctness invariants

1. **Provider**: both endpoints keep resolving the workspace `defaultModel`, 400 `NO_MODEL` when unset — never a global fallback.
2. **Plan gates server-side** before any upstream call: `aiSettingsEnabled` (inline route, unchanged) / `chatsEnabled` (page-chat create + generate); client hiding is UX, not authority.
3. **Page access**: Space/custom require **edit** access (they mutate the page); page chats require **visibility** both at chat creation and on every subsequent access (`assertChatAccess` extension) — private-page content must not leak through a chat handle.
4. **System prompt stays server-side**; free-form instructions are user-message content only.
5. **The document is mutated exactly once** per accepted Space/custom result (one transaction, one collaborative-undo step); streaming never touches Yjs.
6. **Real cancellation** on the inline route (`req.signal`); page chats keep the registry/resume semantics of normal chats (documented: client abort there is cosmetic).
7. **PAGE and INLINE_AI chats never appear in the global chat list**; both are pruned on page hard-delete/purge.
8. **Rate limit** (shared 10/60s per user+workspace) guards the inline route including the new actions; page chats inherit whatever throttling normal chats have (none today — unchanged).

## 9. Testing

- **Editor (vitest)**: Space-trigger guard matrix — fires only on empty top-level paragraph with caret + capability; does NOT fire on non-empty paragraph / inside details/table / with selection / read-only. Overlay state machine: submit→stream→refine (history grows, preview replaced)→insert calls the markdown-insert path once; Esc aborts; late tokens after supersede are dropped (run token). Reuses the `slash-items.details-insert.test.ts` harness style.
- **Web unit (vitest)**: handler schema — `generate` history caps (11 turns → 400, oversize → 400), `custom` instruction cap, unknown action still 400; prompt builders produce expected shapes; plan/rate-limit/NO_MODEL paths unchanged (existing tests keep passing).
- **tRPC (vitest)**: `createChat({pageId})` → kind PAGE + FORBIDDEN when `chatsEnabled` off + 404-style denial when page invisible; `listByPage` excludes other pages'/kinds' chats; `listChats` still excludes PAGE; `assertChatAccess` denies a PAGE chat whose page became invisible; generate-route `pageContext` rejected for NORMAL chats, truncated over cap, injected as attachment for PAGE chats.
- **E2E (Playwright)**: `space-ai.spec.ts` — seed `WorkspaceAiSettings.defaultModel` via Prisma, mock `/api/ai/inline` with a browser-side SSE `page.route` fulfill (the 9D pattern); press Space on the empty line → overlay opens; type instruction → preview streams; «Вставить» → content in the editor (in-session assertion only — no yjs server under Playwright); Esc → document untouched. `page-chat.spec.ts` — FAB visible on a TEXT page (and absent when the seeded plan lacks `chatsEnabled`), opens the panel, «Новый чат» creates a PAGE chat, send with mocked `/api/agents/generate`, chat absent from `/chats` list, second chat coexists.

**Merge gate**: `pnpm gates` (run manually — the pre-commit hook does not run gates in this checkout) + the Playwright specs above.

## 10. Honest limitations (v1)

- TEXT pages only (all three surfaces).
- Space-overlay refinement history is ephemeral — closing the overlay loses the thread.
- Page context comes from the client's live editor (fresh, but it *is* client-supplied; server caps + access-checks it). Content over 200k chars is tail-truncated with a visible marker.
- Rate limiter remains in-memory single-instance (operator concern, unchanged from 9D).
- Markdown preview in the overlay may be raw (monospace) in v1 depending on renderer availability.
- No token quotas; audit only (9D stance).
