# Space-triggered AI + free-form selection AI + page chats — Design

**Status:** approved (design locked via AskUserQuestion 2026-07-08; revised same day to match Notion's actual mechanics after a sourced UX research pass — see §11)
**Builds on:** Phase 9D inline AI (`2026-06-18-inline-ai-editor-design.md`, merged d25c322e) — this feature deliberately un-defers two of 9D's explicit non-goals (the empty-line **Space** trigger and free-form instructions) and adds page-scoped chats.
**Branch:** `feat/space-ai-page-chats` off `main`.

## 1. Goal

Three AI surfaces on TEXT pages, all riding the workspace's own AI provider settings (never a hidden global provider), modeled on Notion's mechanics:

1. **Space AI** — pressing Space on an empty line opens a floating AI input bar at the caret (Notion's "press 'space' for AI"). The user types an instruction («сделай базу данных для хранения пользователей в формате mermaid») or picks a suggestion; the draft **streams directly into the document** as a pending (uncommitted) block; the bar stays attached below for follow-up refinements («добавь поле email») until the user accepts or discards.
2. **Free-form selection instruction** — the existing «Спросить AI» popover is reshaped Notion-style: a free-form prompt input **at the top**, the six presets below; the result preview gains «Вставить ниже» alongside replace, plus a follow-up field to iterate.
3. **Page chats** — a circular FAB at the bottom-right of a page (Notion's agent-face placement) opens a right-side docked panel (~400px) hosting **multiple** agent chats attached to that page. The current page — or only the current selection, when one exists at send time — is injected into the prompt automatically, surfaced as a context chip in the composer.

**Deliberate divergence from Notion** (product decision, re-confirmed 2026-07-08): chat threads are **page-scoped** («на странице может быть много чатов», Codex-style), not Notion's global thread history with auto page context. Everything else about the chat mechanics follows Notion: auto page/selection context, auto-titled threads, recency-ordered thread list, docked sidebar.

## 2. Scope (locked)

**In scope:**
- Space trigger (bare Space only — **Shift+Space types a plain space**, Notion's documented bypass) + floating input bar + suggestions menu + in-document streaming pending draft + accept/refine/discard loop.
- Empty-line placeholder advertising the trigger (Notion: "Write, press space for AI, or '/' for commands") — «Нажмите «пробел» для AI, «/» — для команд» — shown only when the capability is active (editable TEXT page).
- `custom` free-form action + `generate` drafting action in `/api/ai/inline`, both supporting refinement history.
- «Вставить ниже» accept mode + follow-up refinement field on the selection-AI result toolbar.
- `ChatKind.PAGE` + `Chat.pageId`; `chat.listByPage`; page-context injection in `/api/agents/generate`; FAB + `PageChatSidebar` + `PageChatProvider`; context chip in the page-chat composer.
- Plan gating on **existing** flags (`aiSettingsEnabled` for surfaces 1–2, `chatsEnabled` for page chats; both ПРО+МАКС — the «ПРО и выше» decision), surfaced **Notion-style: visible but paywalled** (§8.2). No new plan flags, no seed changes.

**Explicitly OUT of scope (decided, not oversights):**
- Non-TEXT page types (comments are TEXT-only today; same precedent). The Space trigger, placeholder, and FAB render only on TEXT pages.
- Notion's complimentary-response trial quota (no quota mechanism exists in anynote; the paywall message appears immediately on non-eligible plans).
- Persisting the Space-bar refinement history (closing discards it; the hidden INLINE_AI chat row is transport, not storage).
- Page chats in the global `/chats` list (`listChats`/`listFavorites` keep filtering `kind: 'NORMAL'`).
- MCP tools / RAG in the Space and selection flows (single-shot prompt→llm rails — matches Notion, whose classic inline writer is also a pure writer). Page chats keep the **full** agent (tools, RAG, memories).
- Rendering the streaming draft as formatted blocks (Notion streams formatted content; v1 streams styled raw markdown into the pending widget and formats on accept — honest limitation, §10).
- Mermaid **preview** inside TEXT-page code blocks (Notion renders mermaid in code blocks with Code/Preview/Split modes; anynote inserts the fenced code block only — a MERMAID page or a future code-block preview can render it).
- Token quotas; multi-instance rate limiting (same single-instance limiter as 9D).

## 3. Space AI — editor surface (Notion-style: draft in document, bar below)

### 3.1 Trigger extension
New `packages/editor/src/extensions/space-ai.ts` — `Extension.create` with `addKeyboardShortcuts({ Space })` (bare Space only; `Shift-Space` is not bound, so it types a space naturally — the Notion bypass for free). Nothing else in the editor handles Space (verified: markdown input rules never fire on an empty paragraph; the bookmark node-view handler is DOM-internal). Guard, in order:
- capability injected (`editor.storage.ai?.onSpaceAi` set);
- selection is a caret (`empty`);
- parent is a **paragraph** with `content.size === 0`;
- **top-level** (`$from.depth === 1`) — never fires inside details/callout/table cells/blockquotes. (Notion's behavior inside nested blocks is undocumented; we choose the conservative guard.)

On match: consume the keypress (return `true`), capture the block position + caret rect (`view.coordsAtPos`), call `onSpaceAi({ pos, getRect })`. Otherwise return `false`.

### 3.2 Input bar + suggestions
`packages/editor/src/components/space-ai-bar.tsx` — a floating input bar anchored under the trigger block (virtual-anchorEl at the caret rect, the slash-menu pattern; **not** a click-away-closing modal — see 3.4). Anatomy, mirroring Notion:
- Free-form prompt input, autofocused, placeholder «Напишите, что сгенерировать…».
- While the input is empty: a small suggestions dropdown (Notion's "Draft with AI" pattern) — static v1 list: «Продолжить текст», «Мозговой штурм идей на тему…», «План документа на тему…», «Написать текст о…». Picking one **pre-fills the editable prompt** (Notion-verified behavior), it does not fire immediately (except «Продолжить текст», which is self-sufficient and submits directly).
- Enter submits; the bar switches to streaming state (stop button → abort).

### 3.3 Pending draft — streamed into the document
The draft renders **inside the document below the trigger block**, not in a popup — Notion-verified. Implementation: the 9D local-decoration machinery reused wholesale — a widget decoration at the trigger position fed by the `start/appendToken/finish/fail/clear` plugin metas (`inline-ai.ts`), drift-guarded through transaction mapping, styled as a tinted "pending AI draft" block showing the streaming markdown text. Yjs is never touched while streaming (9D invariant).

When generation finishes, the bar (still attached below the draft) shows, Notion-style:
- **«Принять»** (Notion 2026 label "Accept") — parse the accumulated markdown and replace the empty trigger paragraph with the formatted content in **one transaction** (one collaborative-undo step), via the same markdown→Tiptap path the «Markdown» slash item uses (a fenced ` ```mermaid ` block becomes a code block naturally), wrapped in `deferModalInsert` (the async-insert Yjs-sync trap).
- **«Повторить»** — regenerate with the same instruction (replaces the pending draft).
- **«Отклонить»** — clear the decoration; the document is untouched.
- **The follow-up input stays active** («Скажите AI, что сделать дальше…», Notion's "enter a specific prompt in the chat bar"): submitting a refinement re-calls the backend with the accumulated history; the new draft **replaces** the pending one. History lives only in component state.

A monotonic run token drops late tokens from superseded runs (the 9D session-token pattern).

### 3.4 Dismissal semantics (Notion leaves these undocumented; we define ours)
- **Esc**: abort any in-flight stream, discard the pending draft, close the bar, return focus to the (still empty) paragraph. No confirmation dialog.
- **Click-away**: does **not** silently discard — the bar and pending draft stay (a long draft should not die to a stray click). Explicit «Отклонить»/Esc discards; navigating away from the page discards (nothing was ever in Yjs).
- Read-only flips / editor destroy: abort + clear (guard `view.isDestroyed`, 9D pattern).

### 3.5 Injection thread
`AnyNoteEditorProps.generateAI?: GenerateAICallback` (new, `packages/editor/src/types.ts`) → `buildExtensions` → the SpaceAI extension exposes `onSpaceAi` on `editor.storage.ai` (merged, not clobbered — the 9D `onCreate` merge gotcha) → `anynote-editor.tsx` renders `<SpaceAiBar>` as a sibling of `EditorContent` (the `InlineAiPopover` precedent) → `page-renderer.tsx` builds the closure via `createGenerateAi({ pageId, workspaceId })` in `apps/web/src/components/page/inline-ai-bridge.ts`, injected when the page is **editable** (plan is NOT checked client-side — §8.2 visible-but-paywalled).

### 3.6 Placeholder
`packages/editor/src/extensions/placeholder.ts`: when the Space capability is active, empty top-level paragraphs read «Нажмите «пробел» для AI, «/» — для команд»; otherwise the current «Введите '/' для команд» stays.

## 4. Space AI + custom action — backend (extend `/api/ai/inline`)

Same rails as 9D — hidden `Chat(kind=INLINE_AI)` per (user, page), plan gate `aiSettingsEnabled`, shared 10/60s per-(user,workspace) rate limit, `assertPageEditable` uniform-404, workspace `defaultModel` required (400 `NO_MODEL`), direct SSE passthrough with real cancellation (`req.signal`), no MCP servers, audit row per run. Two new allow-listed actions in `apps/web/src/lib/ai/inline-prompts.ts`:

- **`generate`** (Space bar): body `{ action: 'generate', instruction: string (1..2000), history: {role: 'user'|'assistant', content: string}[] (≤10 turns, each ≤16k chars, ≤48k total), contextBefore?: string (≤8k chars), pageId, workspaceId }`. `contextBefore` is the (client-capped) page text preceding the trigger line — always sent; it makes «Продолжить текст» work exactly like Notion's "Continue writing" and grounds free prompts in the document. Same trust class as 9D's `selectedText`: text from the user's own open, editable page. The server template: here is the page context above the cursor (may be empty) + the instruction; produce **only** the final markdown to insert, no explanations, fenced code blocks for diagrams (mermaid etc.), answer in the instruction's language. `history` maps onto the existing `chat_history` field of `buildAgentRunPayload`.
- **`custom`** (selection popover): body `{ action: 'custom', instruction: string (1..500), selectedText, history (same shape/caps as above), pageId, workspaceId }`. Template wraps the capped selection in triple quotes (the existing `buildInlinePrompt` shape) + the user instruction + «выведи только результат без пояснений». `history` carries follow-up refinement turns («Tell AI what to do next», §5).

Posture note (an intentional, documented change from 9D §7.3): the client still cannot supply a **system** prompt — templates stay server-side — but `instruction`, `history`, and `contextBefore` are free-form **user** content embedded in the user message. That is the feature, not a leak: the user is prompting their own workspace model, exactly as they already can in chats.

Zod validation and length caps live in the handler schema; unknown actions still 400. `writeInlineAiAudit` metadata records `preset: 'generate' | 'custom'` (instruction/context text is NOT audited — same privacy stance as selections today).

## 5. Selection popover — Notion-shaped

`packages/editor/src/components/inline-ai-popover.tsx`, reshaped to Notion's co-primary layout:
- **Free-form prompt input at the top** («Спросите AI изменить или создать…»), the six existing presets listed below (their vocabulary already matches Notion's classic set: кратко/переписать/грамматика/перевод/короче/подробнее). Typing + Enter submits `action: 'custom'`.
- The result preview (existing 9D decoration) keeps its toolbar but gains, Notion-style:
  - **«Заменить»** (existing accept — replaces `[from, to]`),
  - **«Вставить ниже»** (new — the existing insert-at-`to` apply path that `expand` already uses; original text stays),
  - **«Повторить»**, **«Отклонить»** (existing),
  - a **follow-up input** («Скажите AI, что сделать дальше…»): submits `custom` again with `history = [{user: prev instruction}, {assistant: prev result}, ...]`; the new result replaces the preview.
- The drift-guarded range mapping and retry-token machinery are untouched.

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
- Page hard-delete tx + trash purge (`pages.repository.ts`) delete `Chat where pageId = <page>` alongside the existing INLINE_AI pruning.
- One migration. Feature branch owns it; if the shared dev DB drifts, apply via the established diff→`psql --single-transaction`→`migrate resolve --applied` flow.

### 6.2 tRPC (`packages/trpc/src/routers/chat.ts`)
- `createChat` gains optional `pageId`; when present the server verifies **page visibility** (`buildPageVisibilityWhere`) and creates the chat with `kind: 'PAGE'` (client cannot set `kind` directly). Plan gate: `chatsEnabled` FORBIDDEN check.
- New `listByPage({ workspaceId, pageId })` → PAGE chats for that page, `orderBy updatedAt desc` (Notion: recency-ordered history), page-visibility-checked.
- `assertChatAccess` extended: for `kind === 'PAGE'` chats it additionally requires current page visibility — otherwise a workspace member who cannot see a private page could read its chat (and its injected page content) by id. Applies to `getChat`/`renameChat`/`deleteChat`/generate.
- `listChats`/`listFavorites` keep `kind: 'NORMAL'` — page chats never leak into the sidebar.

### 6.3 Page context injection (`/api/agents/generate`)
Request body gains optional `pageContext: { content: string, isSelection: boolean }`, accepted **only** when the target chat is `kind === 'PAGE'` (400 otherwise). The **client** serializes the live editor content to markdown (the `@repo/editor` serializer shipped with «Копировать текст») — fresher than the server's `Page.content` snapshot (Hocuspocus debounce) and requires no server-side Tiptap→markdown converter. When a non-empty selection exists at send time, the client sends **only** the selected text with `isSelection: true` (Notion-verified: selected blocks narrow the agent's focus; also the user's original rule).

Server: validate chat kind + page visibility, cap `content` at 200k chars (truncate the tail with an explicit «…контент обрезан» marker), then inject as a **synthetic attachment** `{ id: 'page-context', name: `${page.title}.md` | 'Выделенный фрагмент.md', mime: 'text/markdown', included: true, content }` — riding the proven attachments channel (`_attachments.j2` already wraps it in a prompt-injection guard in both planner and executor prompts). Everything else — MCP tools, RAG, memories, thinking settings, stream registry, resume — is the unchanged normal-chat pipeline.

Trust note: client-supplied content is not a new privilege — the user can paste anything into a message today; the server still independently verifies the user can see the page the chat is bound to.

### 6.4 Auto-titling
The generate route's existing first-message auto-rename («Новый чат» → first text) applies to page chats unchanged (Notion parity: "chats will be named based on what the conversation was about").

## 7. Page chats — UI

- **`Fab` re-export** added to `packages/ui/src/components/index.ts` (repo rule: never `@mui/material` directly from app code).
- **FAB**: a **circular** button (Notion's agent-face placement) fixed at the bottom-right of the main content column on TEXT pages, `right` offset accounting for whichever right panels are open (the `EditorOutline.rightOffset` coordination pattern). Rendered whenever a workspace plan context exists (`usePlanFeaturesOptional() != null`) — **including** non-eligible plans (§8.2). Click toggles the chat panel. Tooltip «Чат по странице».
- **`PageChatProvider`** (`apps/web/src/components/page/page-chat/`): clone of the comments-context shape — `panelOpen/togglePanel/closePanel` + `activeChatId`, reset-on-page-change without provider remount. Mounted in `workspace-layout-client.tsx` beside `PageCommentsProvider`. v1: layout only; PageView-embedded surfaces skip the FAB.
- **`PageChatSidebar`**: third `activePageId`-gated sibling column (plain Box, `width: 400`, `borderLeft`, `flexShrink: 0` — the comments-sidebar docked pattern; Notion's "Sidebar" display mode. Notion's "Floating" mode is out of scope). Header: chat switcher (Select over `chat.listByPage`, newest first) + «Новый чат» + overflow menu (переименовать/удалить via existing procedures). Body: `WorkspaceChatClient` with a new `variant: 'page'` prop that (a) suppresses `history.replaceState`/`buildChatHref` navigation, (b) passes `pageId` to `createChat`, (c) supplies a `getPageContext()` callback read at send time from the existing `PageEditorProvider`.
- **Context chip** in the composer (Notion's automatic context, surfaced explicitly): a small read-only chip showing «Контекст: Текущая страница», switching to «Контекст: Выделение» live while a non-empty editor selection exists. It tells the user exactly what will ride along with the next message.
- `EditorOutline.rightOffset` (and comments/history offset math) accounts for the 400px chat panel, following whatever coexistence rule comments/history already implement (verified in the plan phase; if they stack, chat stacks the same way).

## 8. Security / correctness invariants

1. **Provider**: both endpoints keep resolving the workspace `defaultModel`, 400 `NO_MODEL` when unset — never a global fallback.
2. **Plan gating — Notion-style "visible but paywalled", server-authoritative.** Notion keeps AI entry points visible on every plan and shows an upgrade message at the moment of use; anynote adopts the same surfacing: the Space trigger, placeholder, selection input, and FAB render regardless of plan; the **server** rejects non-eligible plans (403 `PLAN` on the inline route — already implemented; FORBIDDEN on page-chat create/generate), and the client maps that to an upsell — «Доступно на тарифе ПРО и выше» + «Перейти на тариф» → `/pricing` (the `current-plan-card` link precedent) — rendered inline in the Space bar / popover / chat panel. This replaces the repo's hide-pattern for these three surfaces; hiding remains only where no workspace plan context exists (public-share renderer). No trial quota (out of scope).
3. **Page access**: Space/custom require **edit** access (they mutate the page); page chats require **visibility** both at chat creation and on every subsequent access (`assertChatAccess` extension) — private-page content must not leak through a chat handle.
4. **System prompt stays server-side**; free-form instructions, history, and `contextBefore` are user-message content only.
5. **The document is mutated exactly once** per accepted Space/custom result (one transaction, one collaborative-undo step); streaming never touches Yjs (pending drafts are local decorations).
6. **Real cancellation** on the inline route (`req.signal`); page chats keep the registry/resume semantics of normal chats (documented: client abort there is cosmetic).
7. **PAGE and INLINE_AI chats never appear in the global chat list**; both are pruned on page hard-delete/purge.
8. **Rate limit** (shared 10/60s per user+workspace) guards the inline route including the new actions — each «Повторить» and each refinement turn counts as one request (Notion parity: "anytime you click Try again, that counts as an additional AI response"); page chats inherit normal-chat throttling (none today — unchanged).

## 9. Testing

- **Editor (vitest)**: Space-trigger guard matrix — fires only on empty top-level paragraph with caret + capability; does NOT fire on non-empty paragraph / inside details/table / with selection / read-only; **Shift+Space inserts a plain space**. Bar/draft state machine: submit→stream (decoration grows)→refine (history grows, draft replaced)→accept parses markdown and mutates the doc once; Esc aborts and leaves the doc byte-identical; click-away does NOT discard; late tokens after supersede are dropped (run token). Suggestion pre-fill populates the input without submitting (except «Продолжить текст»). Reuses the `slash-items.details-insert.test.ts` harness style and the 9D decoration tests.
- **Web unit (vitest)**: handler schema — `generate` history caps (11 turns → 400, oversize → 400), `contextBefore` cap, `custom` instruction cap + history, unknown action still 400; prompt builders produce expected shapes (contextBefore embedded when present, empty-context branch); plan/rate-limit/NO_MODEL paths unchanged.
- **tRPC (vitest)**: `createChat({pageId})` → kind PAGE + FORBIDDEN when `chatsEnabled` off + 404-style denial when page invisible; `listByPage` excludes other pages'/kinds' chats; `listChats` still excludes PAGE; `assertChatAccess` denies a PAGE chat whose page became invisible; generate-route `pageContext` rejected for NORMAL chats, truncated over cap, injected as attachment for PAGE chats.
- **E2E (Playwright)**: `space-ai.spec.ts` — seed `WorkspaceAiSettings.defaultModel` via Prisma, mock `/api/ai/inline` with a browser-side SSE `page.route` fulfill (the 9D pattern); press Space on the empty line → bar opens + pending draft streams into the document; «Принять» → formatted content in the editor (in-session assertion only — no yjs server under Playwright); Esc → document untouched; Shift+Space → a space character, no bar. A paywall case: seeded personal-plan workspace → Space bar opens, submit → upsell message with the /pricing link (mock 403 PLAN). `page-chat.spec.ts` — FAB visible on a TEXT page, opens the panel, «Новый чат» creates a PAGE chat, context chip shows «Текущая страница» and flips to «Выделение» when text is selected, send with mocked `/api/agents/generate`, chat absent from `/chats` list, second chat coexists.

**Merge gate**: `pnpm gates` (run manually — the pre-commit hook does not run gates in this checkout) + the Playwright specs above.

## 10. Honest limitations (v1)

- TEXT pages only (all three surfaces).
- The pending draft streams as styled **raw markdown** text; it becomes formatted blocks only on «Принять» (Notion streams formatted blocks — deferred).
- Space-bar refinement history is ephemeral — closing/discarding loses the thread.
- Page context comes from the client's live editor (fresh, but client-supplied; server caps + access-checks it). Content over 200k chars is tail-truncated with a visible marker.
- Mermaid code blocks insert as plain code blocks (no in-block preview on TEXT pages).
- No trial quota for non-eligible plans — the paywall message appears on first use (Notion gives ~20 complimentary responses; we have no quota infra).
- Rate limiter remains in-memory single-instance (operator concern, unchanged from 9D).
- Docked sidebar only for page chats (no Notion "Floating" window mode).
- No token quotas; audit only (9D stance).

## 11. Notion parity notes (research summary, 2026-07-08)

Sourced from notion.com help center/releases + 2026-updated walkthroughs, with a second verification pass on low-confidence claims:

- **Space trigger** (notion.com/help/guides/notion-ai-for-docs; Zapier guide upd. Apr 2026): Space on any new/empty line opens the AI prompt field; Shift+Space bypasses; empty-line placeholder advertises it. Draft renders **inline in the document** (verified), the bar stays below; post-generation actions are accept («Accept», 2026 label) / try again / discard, plus a follow-up prompt in the same bar. Suggestions menu with "Draft with AI" items pre-fills an editable prompt. Esc/click-away semantics are undocumented — §3.4 defines ours. Notion AI emits mermaid in code blocks on request.
- **Selection AI** (notion.com/help/guides/notion-ai-for-docs; notion.com/releases/2024-09-25): "Ask AI" opens a free-form prompt + context-aware suggestions ("pick an option from the dropdown or write a custom prompt"); result renders in a preview leaving the original untouched, applied via **Replace selection / Insert below** / Try again / Discard, with iterative follow-ups until applied.
- **AI chat** (notion.com/help/notion-agent): circular agent-face button fixed bottom-right; docked "Sidebar" or "Floating" display modes; **global** auto-titled thread history (recency-ordered); current page is automatic context, narrowed to selected blocks when a selection exists; @-mentions, model picker, direct page edits with undo. anynote adopts the placement, docked panel, auto context + selection narrowing, and auto-titling — and **deliberately diverges** to page-scoped threads (locked product decision).
- **Plan gating** (notion.com/help/notion-ai-faqs, /help/complimentary-ai-responses): AI is Business/Enterprise-only; entry points stay **visible** on lower plans and show an upgrade message at the point of use ("Try again counts as an additional AI response" against the trial). anynote adopts visible-but-paywalled (server-authoritative 403 → upsell with /pricing link), without the trial quota.
