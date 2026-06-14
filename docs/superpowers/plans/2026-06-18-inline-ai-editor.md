# Inline AI in the editor (Phase 9D) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a selection bubble-menu «Спросить AI» that runs preset transform actions (summarize/rewrite/grammar/translate/shorten/expand) against the workspace AI provider, streams a preview into the editor, and lets the user accept/retry/discard — plan-gated, rate-limited, cancellable, audited.

**Architecture:** A new `POST /api/ai/inline` Next route is a direct SSE proxy to the existing agents `/agent/run`, reusing a hidden ephemeral `Chat (kind=INLINE_AI)` per (user,page); it reuses the chat route's provider resolution verbatim (the "never a hidden global provider" guarantee). The editor exposes the capability via the established render-prop / `editor.storage` injection (comments/synced-block precedent); the streaming preview is a LOCAL ProseMirror Decoration (never written to Yjs until accept).

**Tech Stack:** Next.js 16 route handlers (nodejs runtime), Prisma 7 (shared-dev-DB diff→psql→resolve), Tiptap v3 + ProseMirror decorations, MUI v6, vitest + Playwright.

**Spec:** `docs/superpowers/specs/2026-06-18-inline-ai-editor-design.md` (read it; §§3–7 are normative).

**Conventions (all tasks):** prettier `semi:false`, single quotes, 100-col. NEVER `git add -A` — stage explicit paths. Editor package = Bundler resolution, extensionless imports, NO tRPC/web deps. MUI via `@repo/ui/components` in app code; `@mui/material` direct is OK inside `packages/editor` (15-file precedent). TDD for pure logic. After each task: `pnpm format` the touched files.

---

## Task 1: ChatKind schema + ephemeral-chat plumbing (chat-list exclusion + page-delete prune)

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (Chat model + ChatKind enum)
- Create: `packages/db/prisma/migrations/<ts>_inline_ai_chat/migration.sql`
- Modify: `packages/trpc/src/routers/chat.ts` (exclude INLINE_AI from list)
- Find & modify: the page hard-delete tx (grep `hardDeletePageTx` / `hard` in `packages/domain/src/pages/**` and `packages/trpc`) to prune INLINE_AI chats
- Test: `packages/trpc/test/chat-inline-ai.test.ts` (or extend an existing chat test) — real-DB, fixture-scoped

- [ ] **Step 1: Add the enum + columns to schema.prisma**

In `packages/db/prisma/schema.prisma`, add the enum near the other enums:

```prisma
enum ChatKind {
  NORMAL
  INLINE_AI
}
```

In `model Chat`, add (after `topP`):

```prisma
  kind            ChatKind       @default(NORMAL)
  inlineAiPageId  String?        @map("inline_ai_page_id") @db.Uuid
```

In the relations block, add:

```prisma
  inlineAiPage Page? @relation("ChatInlineAiPage", fields: [inlineAiPageId], references: [id], onDelete: SetNull)
```

Add a partial unique index in the `@@`-block area:

```prisma
  @@unique([createdById, inlineAiPageId], name: "chat_inline_ai_user_page")
```

(Prisma's `@@unique` is a full unique constraint; we want it to apply only to INLINE_AI rows. A plain `@@unique([createdById, inlineAiPageId])` treats NULLs as distinct in Postgres, so NORMAL chats — which have `inlineAiPageId = NULL` — never collide. That is exactly the desired behavior: only rows with a non-null `inlineAiPageId` (i.e. INLINE_AI rows) participate in the constraint. No partial-index DDL needed; document this in a schema comment.)

On `model Page`, add the back-relation (find the Page model, add to its relations):

```prisma
  inlineAiChats Chat[] @relation("ChatInlineAiPage")
```

- [ ] **Step 2: Generate the migration via the shared-DB flow (NO migrate dev / NO reset)**

Get the committed schema and diff against the working copy:

```bash
cd /Users/victor/.config/superpowers/worktrees/anynote/notion-phase-9d-inline-ai
git show HEAD:packages/db/prisma/schema.prisma > /tmp/9d_old_schema.prisma
mkdir -p packages/db/prisma/migrations/20260618120000_inline_ai_chat
pnpm --filter @repo/db exec prisma migrate diff \
  --from-schema /tmp/9d_old_schema.prisma \
  --to-schema packages/db/prisma/schema.prisma \
  --script > packages/db/prisma/migrations/20260618120000_inline_ai_chat/migration.sql
```

Strip any leaked dotenv banner lines from the top of `migration.sql` so it is pure SQL (Read the file; if line 1 isn't SQL/`--`, delete the noise lines).

- [ ] **Step 3: Apply the migration to the shared dev DB + record it**

```bash
docker exec -i anynote-postgres-1 psql -U user -d anynote --single-transaction -v ON_ERROR_STOP=1 < packages/db/prisma/migrations/20260618120000_inline_ai_chat/migration.sql
pnpm --filter @repo/db exec prisma migrate resolve --applied 20260618120000_inline_ai_chat
pnpm --filter @repo/db prisma:generate
```

Verify:

```bash
docker exec -i anynote-postgres-1 psql -U user -d anynote -c "\d chats" | grep -E "kind|inline_ai_page_id|chat_inline_ai"
```

Expected: `kind` column (ChatKind, default NORMAL), `inline_ai_page_id uuid`, the unique index `chats_created_by_id_inline_ai_page_id_key` (or the named constraint), and the FK to pages ON DELETE SET NULL.

- [ ] **Step 4: Exclude INLINE_AI from the chat-list query (write the failing test first)**

Read `packages/trpc/src/routers/chat.ts` and find the `list` procedure (and any chat-count / sidebar query). Read an existing real-DB trpc test (e.g. `packages/trpc/test/synced-block-router.test.ts`) for the fixture-scoped pattern (inline users/workspaces, `EMAIL_SUFFIX`-scoped cleanup, `testTimeout: 30_000` if needed).

Write `packages/trpc/test/chat-inline-ai.test.ts`:

```ts
// Fixture-scoped: create a workspace + user, one NORMAL chat, one INLINE_AI chat (kind+inlineAiPageId set).
// Assert chat.list returns the NORMAL chat and NOT the INLINE_AI one.
```

Run: `pnpm --filter @repo/trpc test chat-inline-ai` → Expected: FAIL (list returns both).

- [ ] **Step 5: Implement the list exclusion**

In `chat.ts` `list` (and any sidebar/count query that returns chats to the UI), add `kind: 'NORMAL'` to the `where` (or `kind: { not: 'INLINE_AI' }`). Re-run the test → PASS.

- [ ] **Step 6: Prune INLINE_AI chats on page hard-delete (failing test first)**

Grep for the page hard-delete transaction: `grep -rn "hardDelete\|deleteMany.*page\|onDelete.*page" packages/domain/src/pages packages/trpc/src/routers` — identify where a page is permanently removed (trash → hard delete). Read it.

Add to the same test file a case: create an INLINE_AI chat for a page, hard-delete the page, assert the INLINE_AI chat is gone (and that the existing SetNull FK isn't relied on to leave orphans — we want them DELETED, not detached).

Run → Expected: FAIL (chat survives, just `inlineAiPageId` nulled by SetNull).

- [ ] **Step 7: Implement the prune**

In the page hard-delete tx, before/within the page delete, add `tx.chat.deleteMany({ where: { kind: 'INLINE_AI', inlineAiPageId: pageId } })`. (If the hard-delete lives in `@repo/domain`, add it there inside the UnitOfWork tx; if in trpc, in that tx.) Re-run → PASS.

- [ ] **Step 8: Run gates for touched packages + commit**

```bash
pnpm --filter @repo/db check-types && pnpm --filter @repo/trpc test && pnpm --filter @repo/trpc check-types && pnpm check-types
pnpm format packages/db/prisma/schema.prisma packages/trpc/src/routers/chat.ts packages/trpc/test/chat-inline-ai.test.ts
```

Commit (explicit paths):

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260618120000_inline_ai_chat/migration.sql packages/trpc/src/routers/chat.ts packages/trpc/test/chat-inline-ai.test.ts <page-hard-delete-file>
git commit -m "feat(db): ChatKind.INLINE_AI ephemeral chats — list-excluded, page-delete-pruned"
```

---

## Task 2: The `/api/ai/inline` route — prompts, rate-limit, audit, provider resolution, ephemeral-chat get-or-create, direct-proxy stream

**Files:**
- Create: `apps/web/src/lib/ai/inline-prompts.ts` (preset → prompt template; the action allow-list authority)
- Create: `apps/web/src/lib/ai/inline-rate-limit.ts` (per-(user,workspace) limiter)
- Create: `apps/web/src/lib/ai/inline-audit.ts` (AI_AUDIT_ACTIONS + writeInlineAiAudit)
- Create: `apps/web/src/lib/ai/inline-chat.ts` (get-or-create the INLINE_AI chat for (user,page), race-safe)
- Create: `apps/web/src/app/api/ai/inline/handler.ts` (the testable handler: auth→access→gate→limit→provider→action→chat→proxy-stream→audit)
- Create: `apps/web/src/app/api/ai/inline/route.ts` (thin: `export const runtime='nodejs'`; `export async function POST(req){ return handleInlineAi(req) }`)
- Test: `apps/web/test/ai-inline-prompts.test.ts`, `apps/web/test/ai-inline-rate-limit.test.ts`, `apps/web/test/ai-inline-handler.test.ts`

Read first: `apps/web/src/app/api/agents/generate/route.ts` (provider resolution lines ~124-233, payload build, JWT mint), `apps/web/src/lib/chat/provider-connection.ts` (`resolveProviderConnection`), `apps/web/src/lib/chat/agents-payload.ts` (`buildAgentRunPayload` / `AgentRunPayload`), `apps/web/src/lib/agents-token.ts` (`signAgentsJwt`, `scopesForRole`), `apps/web/src/app/api/bookmark/preview/handler.ts` (rate-limit shape + auth-first ordering + the testable-handler split + injectable fetch), `packages/trpc/src/helpers/plan.ts` (`getWorkspaceFeatures`), the page-access helper used by chat (grep `assertActivePageEditAccess` / the member+block+not-trashed query).

- [ ] **Step 1: Prompts module + test (TDD)**

Write `apps/web/test/ai-inline-prompts.test.ts` first:

```ts
import { INLINE_AI_ACTIONS, buildInlinePrompt, isInlineAiAction } from '../src/lib/ai/inline-prompts'

test('action allow-list is the six presets', () => {
  expect(Object.keys(INLINE_AI_ACTIONS).sort()).toEqual(
    ['expand','grammar','rewrite','shorten','summarize','translate'].sort(),
  )
})
test('isInlineAiAction rejects unknown', () => {
  expect(isInlineAiAction('summarize')).toBe(true)
  expect(isInlineAiAction('hack')).toBe(false)
})
test('buildInlinePrompt embeds the selected text and the preset instruction', () => {
  const p = buildInlinePrompt('summarize', 'Длинный текст про котов.', {})
  expect(p).toContain('Длинный текст про котов.')
  expect(p.toLowerCase()).toMatch(/сократ|кратк|summar|резюм/)
})
test('translate requires/uses targetLang', () => {
  const p = buildInlinePrompt('translate', 'Привет', { targetLang: 'English' })
  expect(p).toContain('English')
  expect(p).toContain('Привет')
})
test('selected text is length-capped', () => {
  const huge = 'я'.repeat(50_000)
  const p = buildInlinePrompt('rewrite', huge, {})
  expect(p.length).toBeLessThan(20_000) // MAX_SELECTION_CHARS enforced
})
```

Run → FAIL (module missing).

- [ ] **Step 2: Implement `inline-prompts.ts`**

```ts
export const MAX_SELECTION_CHARS = 8000

export type InlineAiAction = keyof typeof INLINE_AI_ACTIONS

export const INLINE_AI_ACTIONS = {
  summarize: 'Сократи следующий текст до краткого резюме, сохранив главные мысли.',
  rewrite: 'Перепиши следующий текст более ясно и естественно, сохранив смысл.',
  grammar: 'Исправь грамматику, орфографию и стиль следующего текста. Верни только исправленный текст.',
  translate: 'Переведи следующий текст на {targetLang}. Верни только перевод.',
  shorten: 'Сделай следующий текст короче, сохранив суть.',
  expand: 'Дополни и расширь следующий текст, добавив полезные детали в том же стиле.',
} as const

export function isInlineAiAction(x: string): x is InlineAiAction {
  return Object.prototype.hasOwnProperty.call(INLINE_AI_ACTIONS, x)
}

export function buildInlinePrompt(
  action: InlineAiAction,
  selectedText: string,
  opts: { targetLang?: string },
): string {
  const capped = selectedText.slice(0, MAX_SELECTION_CHARS)
  const instruction = INLINE_AI_ACTIONS[action].replace(
    '{targetLang}',
    opts.targetLang?.trim() || 'English',
  )
  // Return ONLY the transformed text, no preamble — keep output paste-ready.
  return `${instruction}\n\nВыведи только результат без пояснений.\n\nТекст:\n"""\n${capped}\n"""`
}
```

Run → PASS.

- [ ] **Step 3: Rate-limit module + test (TDD)**

Write `apps/web/test/ai-inline-rate-limit.test.ts`:

```ts
import { isInlineAiRateLimited, __resetInlineAiRateLimit } from '../src/lib/ai/inline-rate-limit'

beforeEach(() => __resetInlineAiRateLimit())

test('allows up to the limit then blocks', () => {
  const key = { userId: 'u1', workspaceId: 'w1' }
  for (let i = 0; i < 10; i++) expect(isInlineAiRateLimited(key)).toBe(false)
  expect(isInlineAiRateLimited(key)).toBe(true) // 11th in-window
})
test('separate keys are independent', () => {
  expect(isInlineAiRateLimited({ userId: 'u1', workspaceId: 'w1' })).toBe(false)
  expect(isInlineAiRateLimited({ userId: 'u2', workspaceId: 'w1' })).toBe(false)
})
```

Run → FAIL.

- [ ] **Step 4: Implement `inline-rate-limit.ts`** (mirror `bookmark/preview/handler.ts` sliding window, keyed `userId:workspaceId`)

```ts
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 10
const hits = new Map<string, number[]>()

export function isInlineAiRateLimited(key: { userId: string; workspaceId: string }): boolean {
  const k = `${key.userId}:${key.workspaceId}`
  const now = Date.now()
  const arr = (hits.get(k) ?? []).filter((t) => now - t < WINDOW_MS)
  if (arr.length >= MAX_PER_WINDOW) {
    hits.set(k, arr)
    return true
  }
  arr.push(now)
  hits.set(k, arr)
  return false
}

export function __resetInlineAiRateLimit() {
  hits.clear()
}
```

(Note: `Date.now()` is fine in app runtime code; only workflow scripts forbid it. The test calls within one window.) Run → PASS.

- [ ] **Step 5: Audit module**

`apps/web/src/lib/ai/inline-audit.ts`:

```ts
import type { PrismaClient } from '@repo/db'

export const AI_AUDIT_ACTIONS = { inlineAiRun: 'ai.inline.run' } as const

export async function writeInlineAiAudit(
  prisma: PrismaClient,
  entry: {
    workspaceId: string
    userId: string
    preset: string
    provider: string
    model: string
    pageId: string
    promptTokens?: number | null
    completionTokens?: number | null
    totalTokens?: number | null
  },
): Promise<void> {
  try {
    await prisma.workspaceAuditLog.create({
      data: {
        workspaceId: entry.workspaceId,
        actorId: entry.userId,
        action: AI_AUDIT_ACTIONS.inlineAiRun,
        metadata: {
          preset: entry.preset,
          provider: entry.provider,
          model: entry.model,
          pageId: entry.pageId,
          promptTokens: entry.promptTokens ?? null,
          completionTokens: entry.completionTokens ?? null,
          totalTokens: entry.totalTokens ?? null,
        },
      },
    })
  } catch {
    // audit must never break the user-facing action
  }
}
```

(Verify the `WorkspaceAuditLog` field names against schema — `actorId`, `action`, `metadata`. Adjust if the import path for `PrismaClient` differs; use the repo's prisma singleton type.)

- [ ] **Step 6: Ephemeral-chat get-or-create (race-safe)**

`apps/web/src/lib/ai/inline-chat.ts`:

```ts
import type { PrismaClient } from '@repo/db'

// One INLINE_AI chat per (user, page). Race-safe via the partial-unique constraint:
// try findFirst, else create, converging on P2002 to a re-find (Prisma 7 upsert emulates
// read-then-create so a plain upsert still races — catch the unique violation).
export async function getOrCreateInlineAiChat(
  prisma: PrismaClient,
  args: { userId: string; workspaceId: string; pageId: string },
): Promise<{ id: string }> {
  const existing = await prisma.chat.findFirst({
    where: { kind: 'INLINE_AI', createdById: args.userId, inlineAiPageId: args.pageId },
    select: { id: true },
  })
  if (existing) return existing
  try {
    return await prisma.chat.create({
      data: {
        kind: 'INLINE_AI',
        createdById: args.userId,
        workspaceId: args.workspaceId,
        inlineAiPageId: args.pageId,
        title: 'Inline AI',
      },
      select: { id: true },
    })
  } catch (e: unknown) {
    if (isUniqueViolation(e)) {
      const row = await prisma.chat.findFirst({
        where: { kind: 'INLINE_AI', createdById: args.userId, inlineAiPageId: args.pageId },
        select: { id: true },
      })
      if (row) return row
    }
    throw e
  }
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && (e as { code?: string }).code === 'P2002'
}
```

- [ ] **Step 7: The handler — failing test first (injectable upstream fetch)**

Write `apps/web/test/ai-inline-handler.test.ts`. Mirror the bookmark handler's injectable-dependency style — the handler should accept its session/prisma/upstream-fetch via an options arg so it's testable without a live server. Test cases (mock the deps):
- no session → 401
- unknown action → 400
- no `WorkspaceAiSettings.defaultModel` → 400 with the configure message
- plan gate off (`aiSettingsEnabled=false`) → 403
- rate-limited → 429
- happy path → calls upstream `/agent/run` with a payload whose `model.provider` = the workspace provider kind (lowercased) and `user_message` contains the selected text + the preset instruction; passes `signal`; streams the upstream body through; writes an audit row.

Use a fake upstream `fetch` returning a small `ReadableStream` of SSE `data:` frames (a token then done). Run → FAIL.

- [ ] **Step 8: Implement `handler.ts`** (compose the modules; mirror `generate/route.ts` for provider resolution + payload + JWT, mirror `bookmark/preview/handler.ts` for the testable split + guarded SSE controller)

Order exactly per spec §3.1: session → parse+validate body (zod: `{action, selectedText, pageId, workspaceId, targetLang?}`) → action allow-list (`isInlineAiAction`) → page edit-access check → `getWorkspaceFeatures` plan gate → rate limit → load `workspaceAiSettings` (400 if no defaultModel) → `resolveProviderConnection` → `getOrCreateInlineAiChat` → `signAgentsJwt` → `buildInlinePrompt` → build the agent-run payload (reuse `buildAgentRunPayload` with `user_message`=prompt, empty `chat_history`, `mcp_servers: []`, the model snapshot) → `fetch(AGENTS_URL + '/agent/run', { signal: req.signal, ... })` → return a `ReadableStream` that pipes the upstream body, accumulating any `usage` event for the audit, guarding enqueue/close against a closed controller, with a real `cancel()` that aborts the upstream. After the stream ends, `writeInlineAiAudit`.

`route.ts`:

```ts
import { handleInlineAi } from './handler'
export const runtime = 'nodejs'
export async function POST(req: Request) {
  return handleInlineAi(req)
}
```

Run the handler test → PASS.

- [ ] **Step 9: Best-effort usage wiring (cheap only)**

Read `apps/agents/.../agent/use_cases/run_agent.py` + `graph_streaming` to see if a `usage` event can be emitted cheaply from the streamed LLM response metadata (`usage_metadata`/`response_metadata`). If a one-spot emit is clean (the LLM's final chunk carries token counts), add it + ensure the web bridge/inline handler captures it. If it is NOT a small change, SKIP it (the audit persists null tokens — spec §6 sanctions this) and note the skip in the commit body. Do not expand scope here.

- [ ] **Step 10: Gates + commit**

```bash
pnpm --filter web test ai-inline && pnpm --filter web lint && pnpm check-types
pnpm format apps/web/src/lib/ai/*.ts apps/web/src/app/api/ai/inline/*.ts apps/web/test/ai-inline-*.test.ts
git add apps/web/src/lib/ai apps/web/src/app/api/ai apps/web/test/ai-inline-prompts.test.ts apps/web/test/ai-inline-rate-limit.test.ts apps/web/test/ai-inline-handler.test.ts <agents-usage-file-if-touched>
git commit -m "feat(web): /api/ai/inline route — preset transforms, plan gate, rate limit, ephemeral-chat proxy stream, audit"
```

---

## Task 3: The InlineAI editor extension + streaming-preview decoration plugin (pure-testable core)

**Files:**
- Create: `packages/editor/src/extensions/inline-ai.ts` (the Extension + the ProseMirror decoration plugin + `editor.storage.ai` + the apply/clear command helpers)
- Create: `packages/editor/src/extensions/inline-ai.test.ts` (pure tests)
- Modify: `packages/editor/src/types.ts` (the `AskAICallback` type + `AnyNoteEditorProps.askAI`)
- Modify: `packages/editor/src/extensions/index.ts` (register `InlineAI.configure({ askAI })`)

Read first: `packages/editor/src/extensions/collapsible-headings.ts` (the LOCAL decoration plugin: PluginKey, plugin state, `setMeta` toggles, `props.decorations`, re-map on every tr — the exact streaming-preview model), `packages/editor/src/extensions/synced-block.tsx` (lazy `getPos` apply, `view.isDestroyed` guard, `chain().deleteRange().insertContentAt().run()`), `packages/editor/src/extensions/collaboration.ts` (undo is Yjs UndoManager; StarterKit undo is off — accept must be ONE transaction).

- [ ] **Step 1: Define the preview state shape + types (write the failing test first)**

The plugin holds local state: `{ active: boolean, from: number, to: number, action, text: string, status: 'streaming'|'done'|'error', error?: string }` keyed by a `PluginKey`. Decisions:
- The preview is rendered as a **widget decoration** at `to` (a DOM box showing `text` + the accept/retry/discard toolbar), plus an inline decoration over `[from,to]` to dim/mark the source range while a transform is pending.
- The range `{from,to}` is **mapped through every transaction** (`decorationSet.map(tr.mapping, tr.doc)` equivalent — but since we store raw numbers, map them via `tr.mapping.map(from)` in `apply`).

Write `inline-ai.test.ts` (pure — construct an `EditorState` with the InlineAI plugin via the schema; no React, node env). Cases:
- a `start` meta sets active state with the given range + empty text;
- an `appendToken` meta concatenates text;
- the stored `{from,to}` re-maps when an unrelated insertion happens before `from` (insert N chars at 0 → from/to shift by N) — the drift guard;
- a `clear` meta resets to inactive;
- `status: 'done'` after a `finish` meta.

Run → FAIL.

- [ ] **Step 2: Implement the plugin core in `inline-ai.ts`**

```ts
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const inlineAiPluginKey = new PluginKey('inlineAi')

export type InlineAiPreviewState = {
  active: boolean
  from: number
  to: number
  action: string
  text: string
  status: 'streaming' | 'done' | 'error'
  error?: string
}
// ... meta action union: start | appendToken | finish | fail | clear
// apply(): on each tr, if active map from/to via tr.mapping.map(...); then fold in the meta.
// decorations: when active, a Decoration.widget(to, () => renderToolbar(...)) + Decoration.inline(from,to,{class}).
```

Implement `addProseMirrorPlugins` returning the plugin; `addStorage` returns `{ askAI: null, render: null }` (set by `configure`); `addOptions` declares `{ askAI, renderPreview }`. Add command helpers (callable from the popover/apps/web) to dispatch the metas and to **apply** the accepted text:

```ts
// applyInlineAiResult(editor, { from, to, action, text }): re-resolve nothing stale — use the CURRENT mapped from/to from plugin state; one chain:
//   replace actions: chain().deleteRange({from,to}).insertContentAt(from, text).run()
//   expand:          chain().insertContentAt(to, text).run()  (append after selection)
// then dispatch clear meta.
```

Run → PASS.

- [ ] **Step 3: Test accept produces exactly one transaction with the right shape**

Add tests: given an active preview with text `"X"`, `applyInlineAiResult` for a replace action removes `[from,to]` and inserts `X` at `from`; for `expand` it inserts at `to` leaving the original; after apply the plugin state is inactive; a `discard` (clear) yields a byte-identical doc to before `start`. Run → PASS.

- [ ] **Step 4: Wire types + registration**

In `types.ts`:

```ts
export type AskAIArgs = { action: string; from: number; to: number; selectedText: string; targetLang?: string }
export type AskAIHandle = { onToken: (cb: (t: string) => void) => void; done: Promise<void>; abort: () => void } // or an async-iterator shape — match what apps/web provides
export type AskAICallback = (args: AskAIArgs) => AskAIHandle
// add to AnyNoteEditorProps: askAI?: AskAICallback
```

In `extensions/index.ts`: import `InlineAI`, add `askAI` to `BuildExtensionsOptions`, and `InlineAI.configure({ askAI: opts.askAI ?? null })` in the extension list (only meaningful when askAI provided; the bubble button is gated on it).

- [ ] **Step 5: Gates + commit**

```bash
pnpm --filter @repo/editor test inline-ai && pnpm --filter @repo/editor check-types && pnpm --filter @repo/editor lint
pnpm format packages/editor/src/extensions/inline-ai.ts packages/editor/src/extensions/inline-ai.test.ts packages/editor/src/types.ts packages/editor/src/extensions/index.ts
git add packages/editor/src/extensions/inline-ai.ts packages/editor/src/extensions/inline-ai.test.ts packages/editor/src/types.ts packages/editor/src/extensions/index.ts
git commit -m "feat(editor): InlineAI extension — local streaming-preview decoration, undo-safe accept, position re-map"
```

---

## Task 4: The popover + bubble-menu button + injection thread + apps/web askAI bridge

**Files:**
- Create: `packages/editor/src/components/inline-ai-popover.tsx` (action list + target-lang sub-choice + streaming preview body + accept/retry/discard toolbar — driven by the InlineAI storage/commands)
- Modify: `packages/editor/src/components/floating-toolbar.tsx` (the «Спросить AI» button)
- Modify: `packages/editor/src/anynote-editor.tsx` (thread `props.askAI` → buildExtensions; expose on `editor.storage.ai`; mount the popover; capture selection before click)
- Create: `apps/web/src/components/page/inline-ai-bridge.ts` (the `askAI` closure: fetch `/api/ai/inline`, read the SSE stream, expose onToken/done/abort)
- Modify: `apps/web/src/components/page/page-renderer.tsx` (build the askAI closure with current pageId/workspaceId/user; pass `askAI` to `<AnyNoteEditor>`)

Read first: `floating-toolbar.tsx:287-303` (comment button — the gated-button + `onMouseDown preventDefault` + `lastCommentAnchorRef` precedent), `anynote-editor.tsx:418-424` (the `editor.storage.comments` injection), `packages/editor/src/components/embed-url-popover.tsx` (popover anchoring), `apps/web/src/components/workspace/chat/use-chat-stream.ts:196-248` (`consumeResponse` — the fetch→getReader→TextDecoder→decode loop to mirror), `apps/web/src/lib/chat/sse.ts` (`decodeWebSseEvents`), `page-renderer.tsx:369-389` (the renderSyncedBlock closure precedent + how props are passed to AnyNoteEditor).

- [ ] **Step 1: The apps/web bridge (`inline-ai-bridge.ts`)**

A factory `createAskAI({ pageId, workspaceId })` returning an `AskAICallback`. On call it opens an `AbortController`, `fetch('/api/ai/inline', { method:'POST', body: JSON.stringify({action, selectedText, pageId, workspaceId, targetLang}), signal })`, then runs the `getReader()/TextDecoder/decode` loop (extract/reuse the chat decode util) emitting each text delta to registered `onToken` callbacks; resolves `done` at stream end; on non-OK response reads `{error, code}` and rejects/`onError`. Returns `{ onToken, onError, done, abort }`. Keep it framework-light (no React) so it can be created in page-renderer.

(If a shared decode util doesn't exist standalone, write a tiny local SSE line-parser here — the inline stream is simple text deltas + a done marker; do NOT depend on the chat hook.)

- [ ] **Step 2: The popover component (`inline-ai-popover.tsx`)**

A MUI popover anchored to the selection. Shows: the six action buttons (with icons + Russian labels), and for `translate` a small language sub-menu (RU/EN/DE/FR/ES or a free input). Picking an action: dispatch the InlineAI `start` meta with the captured `{from,to,action}`, call the injected `askAI(args)`, wire `onToken` → `appendToken` meta, `done` → `finish` meta, `onError` → `fail` meta. The preview text + the accept/retry/discard toolbar render from the InlineAI plugin's widget decoration (the toolbar buttons call the extension commands: accept → `applyInlineAiResult`; retry → clear + re-call askAI; discard → clear). Handle the error states (400/403/429 messages from spec §4.2). Use `@mui/material` directly (editor-package precedent).

- [ ] **Step 3: The bubble-menu button**

In `floating-toolbar.tsx`, after the comment button, add a gated «Спросить AI» `IconButton` (sparkle/`AutoAwesome` icon) shown only when `editor.storage.ai?.askAI`. `onMouseDown preventDefault`. On click: capture `editor.state.selection.{from,to}` + `editor.state.doc.textBetween(from,to,' ')` into a ref and open the popover (set an anchor + the captured range). (Mirror `lastCommentAnchorRef`.)

- [ ] **Step 4: Thread the injection in `anynote-editor.tsx`**

Pass `props.askAI` into `buildExtensions({ ..., askAI: props.askAI })`; after editor creation set `editor.storage.ai = { askAI: props.askAI }` (mirror the `comments` storage block); render `<InlineAiPopover editor={editor} .../>` as a sibling (like the slash/mention popovers), fed by the captured-selection ref + anchor state. Ensure `view.isDestroyed` guards on any async token application (already in the plugin, but the popover's async callbacks must check too).

- [ ] **Step 5: Wire page-renderer**

In `page-renderer.tsx`, build `const askAI = useMemo(() => createAskAI({ pageId, workspaceId }), [pageId, workspaceId])` and pass `askAI={askAI}` to `<AnyNoteEditor>`. Only pass it when the page is editable (not public/readOnly) — gate like the other editable-only props. (The button is also gated by storage, so a readOnly editor simply never shows it.)

- [ ] **Step 6: Build + lint + commit (no new pure tests here — covered by Task 3 unit + Task 5 E2E)**

```bash
pnpm --filter @repo/editor check-types && pnpm --filter @repo/editor lint && pnpm --filter web check-types && pnpm --filter web lint
# env sourced, FOREGROUND:
set -a && source /Users/victor/Projects/anynote/.env; set +a && pnpm --filter web build
pnpm format packages/editor/src/components/inline-ai-popover.tsx packages/editor/src/components/floating-toolbar.tsx packages/editor/src/anynote-editor.tsx apps/web/src/components/page/inline-ai-bridge.ts apps/web/src/components/page/page-renderer.tsx
git add packages/editor/src/components/inline-ai-popover.tsx packages/editor/src/components/floating-toolbar.tsx packages/editor/src/anynote-editor.tsx apps/web/src/components/page/inline-ai-bridge.ts apps/web/src/components/page/page-renderer.tsx
git commit -m "feat(web): inline-AI bubble-menu button, action popover, streaming bridge — wired through page-renderer"
```

---

## Task 5: E2E + changelog

**Files:**
- Create: `apps/e2e/inline-ai.spec.ts`
- Modify: `docs/changelog.md`

Read first: `apps/e2e/helpers/auth.ts` (`signUpAndAuthAs`, `writeConsentsForUserId`), a recent editor spec for the selection + bubble-menu interaction pattern (grep apps/e2e for `floating`/bubble/`setSelection`/highlight), `apps/e2e/create-page-from-chat-banya.spec.ts:107-124` (seeding `WorkspaceAiSettings.defaultModel` via Prisma), the E2E constraints (no yjs server under `next dev` — assert in-session, no reload; drag-handle/overlay clicks need `el.evaluate(e=>e.click())`; run with `--retries` for cold-compile warm-up).

- [ ] **Step 1: Write `inline-ai.spec.ts`**

`signUpAndAuthAs` → seed via Prisma: create an `AiProvider` (any kind, with a connection) + an `AiModel` + set the workspace's `WorkspaceAiSettings.defaultModel` to it (so the route passes the 400 guard). Create a page with some text. Open it.

**Mock the agents response** with `page.route('**/api/ai/inline', async route => route.fulfill({ status: 200, contentType: 'text/event-stream', headers: {'cache-control':'no-cache'}, body: 'data: {"type":"token","text":"Краткое "}\n\ndata: {"type":"token","text":"резюме."}\n\ndata: {"type":"done"}\n\n' }))` — match the SSE event shape the bridge actually parses (align with Task 2's output format; adjust the JSON to whatever the route emits).

Tests (all in-session, no reload):
1. Select text in the editor (set a selection via the editor API or triple-click a paragraph), the «Спросить AI» button appears in the floating toolbar; click it (use `el.evaluate(e=>e.click())` if an overlay intercepts), pick «Сократить» (summarize); the streaming preview shows «Краткое резюме.»; click **Принять**; assert the page text now contains «Краткое резюме.».
2. Repeat to the discard step: pick an action, then click **Отклонить**; assert the original text is unchanged.
3. Retry: pick an action, click **Повторить**; assert the preview restreams (the mock fires again) and accepting once inserts the text exactly once (no duplication).
4. No-provider path: in a fresh workspace with no `defaultModel`, mock the route to return `400 {"error":"...","code":"NO_MODEL"}` (or let the real route 400 by not seeding) → assert the popover shows the configure hint.

- [ ] **Step 2: Run the spec (warm the server; retries)**

```bash
docker compose up -d
cd /Users/victor/.config/superpowers/worktrees/anynote/notion-phase-9d-inline-ai
set -a && source /Users/victor/Projects/anynote/.env; set +a
pnpm exec playwright test apps/e2e/inline-ai.spec.ts --retries=2 --reporter=line
```

If a poisoned `.next` wedges the compile (sign-in 500/hang), `rm -rf apps/web/.next` and rerun. Treat only a deterministic attempt-2+ failure as real; debug via the trace.

- [ ] **Step 3: Changelog**

Read `docs/changelog.md` (the hand-curated public /changelog MDX). Add a Phase 9D entry in the same style: inline AI in the editor — select text, «Спросить AI», preset transforms with streaming preview + accept/retry/discard; honest about scope (selection transforms; uses your workspace AI provider; no new content-from-blank/research mode). Don't promise offline or Notion-exact parity.

- [ ] **Step 4: Commit**

```bash
pnpm format apps/e2e/inline-ai.spec.ts docs/changelog.md
git add apps/e2e/inline-ai.spec.ts docs/changelog.md
git commit -m "test(e2e): inline AI — preset transform, accept/discard/retry, no-provider path

docs(changelog): phase 9d inline AI"
```

---

## Self-review notes (plan author)

- **Spec coverage:** §2 surface → T4; §3 backend (route/ephemeral-chat/provider/gate/limit/proxy/cancel) → T1+T2; §4 editor injection + preview → T3+T4; §5 data model → T1; §6 audit → T2; §7 invariants distributed (provider 400 T2, context-is-selection T2, preset-server-side T2, real-cancel T2, out-of-Yjs preview T3, ephemeral-hidden T1, plan/limit T2, SSE-lifecycle T2); §8 tests in each task.
- **Type consistency:** `INLINE_AI_ACTIONS`/`InlineAiAction`/`isInlineAiAction`/`buildInlinePrompt` (T2) used by T2 handler; `AskAICallback`/`AskAIArgs`/`AskAIHandle` (T3 types) produced by `createAskAI` (T4) and consumed by the popover (T4) and the extension (T3) — the AskAIHandle shape (onToken/done/abort) must match between `inline-ai-bridge.ts` and the popover wiring; finalize the shape in T3 Step 4 and honor it in T4 Step 1.
- **Migration:** schema-to-schema diff (no DB reset); the plain `@@unique([createdById, inlineAiPageId])` relies on Postgres treating NULLs as distinct → only INLINE_AI rows (non-null pageId) collide; verified by the `\d chats` check and the get-or-create test.
- **Group review** after T3 (editor core) + a final whole-branch review after T5. The route's security (provider-400, plan, limit, cancel, no-system-prompt-injection) gets adversarial attention in the final review.
