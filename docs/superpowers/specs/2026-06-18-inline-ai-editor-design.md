# Phase 9D — Inline AI inside the editor — Design

**Status:** approved (design decisions locked via AskUserQuestion 2026-06-14)
**Roadmap:** cl9 Prompt 9.3 (`cl9.md:191-249`). Third of six cl9 sub-phases (9A pwa/appearance ✓, 9B media/embeds ✓, 9C tabs/synced ✓ — this is 9D). 9E meetings, 9F dashboards follow.
**Branch:** `feat/notion-phase-9d-inline-ai` off `main@f79d2f95`.

## 1. Goal

Bring AI actions **directly into the Tiptap editor**, native to editing rather than only the chat/RAG surface, while preserving AnyNote's provider model: **every request uses the workspace's own AI provider settings, never a hidden global provider** (the cl9 готовности criterion). Scope for 9D is deliberately tight — one surface, selection transforms only.

## 2. Scope (locked)

**In scope:**
- **One surface: the selection bubble-menu «Спросить AI».** Over selected inline text, an «Спросить AI» button opens a small popover offering six **preset transform actions** that act on the selection: **summarize, rewrite, grammar/style, translate, shorten, expand**.
- A **streaming preview** of the generated result with an **accept / retry / discard** toolbar.
- A **backend** that runs the action against the workspace AI provider, **plan-gated**, **rate-limited**, **cancellable**, with the **selected text** as the only model context (already authorized — it is in the user's open editor).
- An **audit** record per invocation: action, model, provider, pageId, and best-effort token counts.

**Explicitly OUT of scope for 9D** (decided, not oversights — keep the spec honest):
- No `/AI` slash item, no empty-line **Space** trigger, no AI **block** node. (Greenfield keymap territory; deferred.)
- No "new content from empty line" actions (continue/brainstorm/make-table/outline as standalone) — there is no selection to transform. (`expand` on a selection still lengthens it.)
- No research/report mode (even as a stub).
- No new agents-service endpoint — we reuse the existing `/agent/run` (see §4).
- No per-plan **token quota** (no quota mechanism exists; audit only).
- No web search; no external context. The model sees only the selected text.

## 3. Backend approach (locked): reuse `/agent/run` via a hidden ephemeral chat

The agents service has **no** one-shot completion endpoint; the only streaming LLM entry is `POST /agent/run`, which requires a chat-bound JWT (`cid`) and a real `Chat` row (it becomes the LangGraph `thread_id`). Rather than add a new agents endpoint (which would touch the security-sensitive JWT/guard contract), 9D **reuses `/agent/run`** with an **ephemeral chat**:

- **`Chat.kind` discriminant.** Add `ChatKind { NORMAL, INLINE_AI }` (or a boolean `Chat.ephemeral`; we use an enum `kind` for extensibility) defaulting to `NORMAL`. INLINE_AI chats are:
  - **One per `(userId, pageId)`**, reused across actions (NOT one-per-action) — keeps the LangGraph checkpointer/history from being spammed and avoids row churn. Resolved/created lazily on first inline action for that page.
  - **Excluded from the chat-list query** (`chat.list` / sidebar) and from any chat count — they never appear in the UI.
  - **Pruned when the page is deleted** (the page's hard-delete tx removes its INLINE_AI chats; trash is fine to leave until hard-delete).
- Because each action sends a single `user_message` (the action's prompt template + the selected text) to a fresh-thread-per-page chat, the planner/executor/critic graph still runs, but with **no MCP/tools needed** for a pure text transform — we send **no `mcp_servers`** (or an empty list) so the graph degrades to prompt→llm. (If the graph requires the engines MCP server unconditionally, we still pass it but the transform prompt won't invoke tools; verified during implementation.)

### 3.1 The web route — `POST /api/ai/inline` (direct SSE proxy, real cancellation)

A new Next route (`runtime = 'nodejs'`), NOT a tRPC procedure (tRPC can't stream SSE cleanly; chat uses a route for the same reason). It mirrors `api/agents/generate/route.ts` for auth + provider resolution, but **diverges deliberately**: it is a **direct upstream proxy**, not the detached-registry pattern. The chat route fire-and-forgets the upstream fetch into an in-memory registry (so client abort is cosmetic — agents keeps generating). For a one-shot inline action we want **real** cancellation, so the inline route:

1. `getSession()` → 401 if none.
2. Resolve `{workspaceId, pageId}` from the body; enforce **page read+edit access** (the user must be able to edit the page to apply AI output) via the existing page-access helper (`assertActivePageEditAccess`-equivalent: member + block check + not-trashed). 404 on failure (no oracle).
3. **Plan gate:** `getWorkspaceFeatures(workspaceId)` → require an AI feature flag. We reuse `aiSettingsEnabled` (the existing flag that already gates AI configuration) as the inline-AI gate — if a workspace can't configure AI, it can't use inline AI. 403 (FORBIDDEN) if off. (No new plan flag unless review prefers one.)
4. **Rate limit:** a per-`(userId, workspaceId)` sliding-window limiter (in-memory Map, mirroring `bookmark/preview/handler.ts`, keyed by user+workspace instead of IP). Auth-first-then-limit ordering. 429 on exceed. (Documented as single-instance; a shared store is an operator concern, same as the existing per-IP limiters.)
5. **Provider resolution (the готовности guarantee):** `prisma.workspaceAiSettings.findUnique({where:{workspaceId}, include:{defaultModel:{include:{provider:true}}}})`; **400 if no `defaultModel`** (`"Workspace AI default model is not configured"`) — never substitute a global/built-in default. Decrypt with `resolveProviderConnection(provider)` (prefers `connectionEnc` regardless of `workspaceId`-null — the established global-provider fix). The wire provider enum is `kind.toLowerCase()`.
6. **Validate the action** against the preset allow-list; reject unknown actions (400). Build the `user_message` from the action's server-side prompt template + the (length-capped) selected text. The prompt templates live server-side (the client sends only `{action, selectedText, pageId, workspaceId, targetLang?}`), so the client cannot inject an arbitrary system prompt — only choose a preset.
7. Resolve/create the INLINE_AI chat for `(userId, pageId)`; mint the agents JWT via `signAgentsJwt({userId, workspaceId, chatId, role})`.
8. `fetch(${AGENTS_URL}/agent/run, {..., signal: request.signal})` — **passing `request.signal`** so a client disconnect / `AbortController.abort()` tears down the upstream generation. Stream the upstream SSE **straight through** to the browser (translate the agents `token`/`done`/`error` events into a minimal text-delta SSE, or pass the existing `WebChatSseEvent` shape filtered to text). Guard the `ReadableStream` controller against enqueue-after-close (the SSE-controller-lifecycle memory: real `cancel()` + guarded enqueue/close).
9. On stream end, write the **audit** record (best-effort token usage if the upstream emitted it — see §6).

### 3.2 Why not the alternatives
- A new `/agent/inline` agents endpoint would be faster/cleaner but touches the agents JWT/guard contract — the user chose to avoid that.
- A tRPC procedure can't stream SSE; the inline UI needs token-by-token preview.

## 4. Editor surface (the injection thread, no tRPC in the editor package)

The editor package (`packages/editor`, Bundler resolution, no tRPC/web deps) exposes the AI capability via the **established render-prop / `editor.storage` injection** used by comments, embedded-database, and synced-block. apps/web owns the tRPC client + the streaming.

### 4.1 The bubble-menu button
- Add an **«Спросить AI»** `IconButton` (sparkle icon) to `floating-toolbar.tsx`, placed after the comment button, **conditionally rendered** only when an injected capability is present: `editor.storage.ai?.askAI` (the exact `editor.storage.comments?.canComment` / `onCreateComment` precedent at `floating-toolbar.tsx:287-303` + `anynote-editor.tsx:418-424`).
- It MUST use `onMouseDown={e => e.preventDefault()}` (like every toolbar button) and **capture the selection range + text into a ref before the click** (the `lastCommentAnchorRef` precedent) — Tiptap collapses the selection on click, and the selection is exactly the payload.
- On click it opens the **AI action popover** anchored to the selection, passing `{from, to, selectedText}`.

### 4.2 The AI action popover + streaming preview
- A local editor component (mirrors `EmbedUrlPopover` anchoring): a list of the six preset actions (+ a target-language sub-choice for translate). Choosing an action calls the injected `askAI({action, from, to, selectedText, targetLang?})`, which apps/web turns into the `/api/ai/inline` fetch and returns a stream handle (an async iterator / `onToken` callback + `abort()`).
- **Streaming preview is a LOCAL ProseMirror Decoration**, never written to Yjs while streaming (the `collapsible-headings.ts` local-decoration precedent + the rationale: token-by-token Yjs writes would pollute collab + the undo stack and stream partial tokens to every collaborator). The preview renders the accumulating text as a widget/inline decoration over (or just after) the selected range, visually distinct (e.g. a tinted inline box) with the **accept / retry / discard** toolbar attached.
  - Position is **re-resolved at apply time** (the synced-block lazy-`getPos` / image-paste content-addressed re-find pattern) — never trust a numeric offset captured at popover-open time, because remote Yjs edits drift positions (image-paste documents 4→204 drift). The decoration plugin re-maps its range on every transaction.
  - Guard against `view.isDestroyed` for late-arriving tokens after unmount.
- **Accept:** one transaction. For replace-style actions (rewrite/grammar/translate/shorten/summarize-in-place) → `chain().deleteRange({from,to}).insertContentAt(from, result).run()`. For `expand` (append) → `insertContentAt(to, result)`. Exactly one Yjs op = one collaborative-undo step (StarterKit undo is off; Yjs `UndoManager` owns undo). Then clear the decoration.
- **Retry:** clear the decoration state, restream the same action (a new request). **Retry must not duplicate accepted content** — retry only ever operates on the still-un-accepted preview; once accepted, the toolbar is gone. (Tested.)
- **Discard:** clear the decoration state; the doc is never touched.
- **"No provider configured" / errors:** if the route returns 400 (no default model), 403 (plan), or 429 (rate limit), the popover shows a graceful message («Настройте AI-агента в настройках» for 400/403; «Слишком много запросов, попробуйте позже» for 429) instead of a preview. The button may also be pre-disabled if apps/web already knows AI is unconfigured (it can read `aiSettings.get`), but the route remains the authority.

### 4.3 The injection thread (every hop, mirroring synced-block)
`AnyNoteEditorProps.askAI` (new, in `packages/editor/src/types.ts`) → passed into `buildExtensions` (`extensions/index.ts`) → a new `InlineAI` extension `.configure({ askAI })` that (a) registers the streaming-preview ProseMirror plugin and (b) exposes `askAI` on `editor.storage.ai` for the bubble-menu → `anynote-editor.tsx` passes `props.askAI` through (like `renderSyncedBlock`) → `page-renderer.tsx` provides the `askAI` closure that owns the tRPC/fetch + streaming and knows the current `pageId`/`workspaceId`/`user`.

## 5. Data model

```prisma
enum ChatKind {
  NORMAL
  INLINE_AI
}

model Chat {
  // ... existing fields ...
  kind ChatKind @default(NORMAL)
  // INLINE_AI chats: one per (createdById, pageId-via-? ) — see note
}
```

- The INLINE_AI chat must be keyed to a page. If `Chat` already has no `pageId`, add a nullable `Chat.inlineAiPageId` (FK → Page, SetNull) used only for INLINE_AI rows, with a partial unique index `(createdById, inlineAiPageId) WHERE kind='INLINE_AI'` to enforce one-per-(user,page) and make the get-or-create race-safe (P2002-around-tx convergence). (Exact column name/uniqueness finalized in the plan against the real Chat schema.)
- `chat.list` / sidebar query adds `where: { kind: 'NORMAL' }` (or `kind: { not: 'INLINE_AI' }`).
- Page hard-delete tx deletes `Chat where kind='INLINE_AI' AND inlineAiPageId=<page>`.
- Migration via the shared-DB diff→psql→resolve flow (Prisma 7: `--to-schema`, schema-to-schema diff, apply with `psql --single-transaction`, `migrate resolve --applied`).

## 6. Audit (best-effort tokens)

- **New AI action catalog** following the 8A/8C `*_AUDIT_ACTIONS as const` pattern, but located in **web** (`apps/web/src/lib/ai/inline-audit.ts`) since the writer is the Next route, not a domain repository: `AI_AUDIT_ACTIONS = { inlineAiRun: 'ai.inline.run' } as const` (one action string; the specific preset goes in metadata — cleaner than per-preset action strings).
- Written to **`WorkspaceAuditLog`** (`{workspaceId, actorId: userId, action, metadata}`) directly via `prisma.workspaceAuditLog.create`: `metadata = { preset: <action>, provider: <kind>, model: <slug>, pageId, promptTokens?, completionTokens?, totalTokens? }`. The `action` VarChar(64) holds the catalog string; the preset + token counts live in `metadata` Json.
- **Token counts are best-effort.** The agents `usage` SSE event exists in the protocol but is **never emitted** today and **dropped** by the web bridge. 9D will: (a) in the inline route, if the upstream stream yields a `usage` event, capture and persist it; (b) **cheap wiring only** — if LangChain's streamed response surfaces `usage_metadata`/`response_metadata` token counts for the configured provider, emit a `usage` event from the run pipeline so the inline route can capture it. If a provider doesn't return usage, persist null token counts. **No** new typed usage table, **no** quota. The spec is honest: tokens are recorded when the provider gives them, otherwise the audit captures action/model/provider/pageId only.

## 7. Security / correctness invariants

1. **Provider:** every inline-AI request resolves the workspace's `WorkspaceAiSettings.defaultModel` and 400s if unset — **never** a code-path global fallback. (`resolveProviderConnection` may decrypt a global provider's creds, but only because an owner explicitly selected that global model as their default; the route never auto-selects one.)
2. **Context:** the only model context is the **selected text** (already authorized — in the user's open, editable page). No page/block/database content is injected, so no new permission surface. The page must be **editable** by the caller (apply target).
3. **Prompt injection of system role:** the client picks a **preset action** by name; the action→prompt mapping is server-side. The client cannot supply a raw system prompt. Selected text is user content embedded as the user message (length-capped).
4. **Cancellation is real:** `request.signal` threads into the upstream fetch; abort tears down agents generation (the inline route is a direct proxy, not the detached registry).
5. **Streaming stays out of Yjs:** preview is a local decoration; the doc is mutated exactly once on accept (one undo step). Retry never duplicates accepted content (accept removes the toolbar). Discard never touches the doc.
6. **Ephemeral chats never leak into the UI** (excluded from list/count) and are pruned on page hard-delete.
7. **Plan + rate limit** enforced server-side before any upstream call.
8. **SSE controller lifecycle:** guarded enqueue/close + real `cancel()` (the prior controller-already-closed bug).

## 8. Testing

- **tRPC/unit (vitest):** the inline route's gating logic — plan gate denies when `aiSettingsEnabled` off; 400 when no default model; rate-limit returns 429 after N; action allow-list rejects unknown; the ephemeral-chat get-or-create is one-per-(user,page) and race-safe; the chat-list query excludes INLINE_AI. Prompt-template build for each preset action has the expected shape (the selected text embedded, the preset's instruction present). Audit row written with action/model/provider/pageId.
- **Editor (vitest, pure):** the streaming-preview decoration plugin — accumulate tokens → decoration reflects text; accept produces the right single transaction (replace vs append per action); discard yields a byte-identical doc; retry resets the preview; position re-maps under an intervening transaction (no drift). Selected-text capture survives the toolbar click.
- **E2E (Playwright):** `apps/e2e/inline-ai.spec.ts` — `signUpAndAuthAs`, seed `WorkspaceAiSettings.defaultModel` via Prisma (so the route passes the 400 guard), open a page, select text, click «Спросить AI», pick an action; **mock the agents response** via `page.route('**/api/ai/inline', route => route.fulfill({contentType:'text/event-stream', body: 'data:{...}\\n\\ndata:{...}\\n\\n'}))` (the lighter browser-side SSE mock — no live agents). Assert: streaming preview appears, **accept** inserts the text in-session, **discard** leaves the original, **retry** restreams without duplicating. (No reload assertions — no yjs server under `next dev`; assert in-session.) Also a no-provider path: with no default model, the popover shows the configure hint.

**Proof commands (from cl9.md):** `pnpm --filter @repo/trpc test`, `pnpm --filter web lint`, `pnpm check-types`, the Playwright inline-AI spec with mocked agents. Plus the phase's standard build-first-then-forced-uncached-sweep merge gate + `check-architecture`.

## 9. File structure (locked in the plan, summarized)

- `packages/db/prisma/schema.prisma` — `ChatKind` enum + `Chat.kind`/`Chat.inlineAiPageId` + migration.
- `apps/web/src/app/api/ai/inline/route.ts` + `handler.ts` (testable handler split, mirroring bookmark/preview) — auth, gate, rate-limit, provider resolution, ephemeral-chat get-or-create, direct-proxy stream, audit.
- `apps/web/src/lib/ai/inline-prompts.ts` — the server-side preset action → prompt-template map (the action allow-list authority).
- `apps/web/src/lib/ai/inline-rate-limit.ts` — per-(user,workspace) limiter.
- `packages/editor/src/extensions/inline-ai.ts` — the InlineAI extension + streaming-preview decoration plugin + `editor.storage.ai`.
- `packages/editor/src/components/inline-ai-popover.tsx` — the action popover + accept/retry/discard toolbar (editor-local, driven by injected `askAI`).
- `packages/editor/src/types.ts`, `extensions/index.ts`, `anynote-editor.tsx`, `components/floating-toolbar.tsx` — the injection thread + the bubble-menu button.
- `apps/web/src/components/page/page-renderer.tsx` + a new `apps/web/src/components/page/inline-ai-bridge.ts(x)` — the `askAI` closure owning the fetch/stream.
- `apps/web/src/lib/ai/inline-audit.ts` — the `AI_AUDIT_ACTIONS` catalog (the `*_AUDIT_ACTIONS as const` pattern) + a `writeInlineAiAudit(prisma, {...})` helper that inserts the `WorkspaceAuditLog` row. The inline route is a Next route (not tRPC/domain), so the audit write lives in web alongside the handler; it reuses the existing `WorkspaceAuditLog` model directly via `prisma`.
- `packages/trpc/src/routers/chat.ts` — exclude INLINE_AI from list; page hard-delete prune.
- `apps/e2e/inline-ai.spec.ts`, `docs/changelog.md`.

## 10. Honest limitations (state them; don't over-promise)
- Token counts are recorded only when the configured provider returns usage metadata; otherwise null. No usage dashboard, no quota.
- Rate limiting is single-instance in-memory (same as the existing per-IP limiters); not a distributed limiter.
- Only selection transforms; no generate-from-blank, no AI block, no Space trigger, no research mode (deferred — explicitly not promised in UI copy).
- Reusing `/agent/run` runs the full agent graph for a simple transform (heavier than a bespoke one-shot endpoint); acceptable for MVP, the chosen trade to avoid touching the agents auth contract.
