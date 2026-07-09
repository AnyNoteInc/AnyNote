# Space AI + Free-form Selection AI + Page Chats — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notion-style AI in the TEXT editor (Space on an empty line → streaming in-document draft with refine/insert; free-form instruction + «Вставить ниже» on selection) plus page-scoped agent chats behind a FAB, per spec `docs/superpowers/specs/2026-07-08-space-ai-page-chats-design.md`.

**Architecture:** Surfaces 1–2 extend the existing Phase-9D rails: two new server-side actions (`generate`, `custom`) in `/api/ai/inline`, the existing local-decoration streaming plugin for the pending draft, and a new caret-anchored bar component. Page chats add `ChatKind.PAGE` + `Chat.pageId`, a `chat.listByPage` procedure, client-serialized page/selection context injected as a synthetic attachment in `/api/agents/generate`, and a comments-sidebar-pattern right panel reusing `WorkspaceChatClient`.

**Tech Stack:** Next.js 16 App Router, Tiptap 3 / ProseMirror, tRPC v11, Prisma 7, MUI, vitest, Playwright.

---

## Read these first

1. The spec: `docs/superpowers/specs/2026-07-08-space-ai-page-chats-design.md` (§ references below point there).
2. The 9D spec for the rails being reused: `docs/superpowers/specs/2026-06-18-inline-ai-editor-design.md`.

## Execution environment — IMPORTANT

- Branch: `feat/space-ai-page-chats` (already exists, carries the spec commits). **The main checkout currently has foreign dependency-upgrade commits and ~20 uncommitted `package.json` changes from a parallel session.** Execute this plan in a **fresh worktree**:
  ```bash
  git worktree add ../anynote-space-ai feat/space-ai-page-chats
  cd ../anynote-space-ai
  ln -s /Users/victor/Projects/anynote/.env .env
  pnpm install
  pnpm --filter @repo/db prisma:generate
  pnpm --filter @repo/eslint-config build 2>/dev/null || true   # only if the package has a build script
  docker compose up -d   # postgres/minio/qdrant must be up (uses the ROOT compose — shared dev DB)
  ```
- Commit ONLY the explicit paths listed in each task's commit step (`git add <paths>`), never `git add -A` — the shared-stash contamination trap.
- Husky does NOT run gates on commit in this checkout. Run the commands in each task yourself; run `pnpm gates` at the end (Task 18).
- The dev Postgres is SHARED across worktrees. The migration in Task 11 runs `prisma migrate dev` from a branch based on current `main` — that is the owning branch, so it is safe. Never `migrate reset` / `db push`.

## File map (what gets created/modified)

**Phase A — inline backend (`generate`/`custom` actions):**
- Modify: `apps/web/src/lib/ai/inline-prompts.ts` (+ caps, `buildGeneratePrompt`, `buildCustomPrompt`, `isExtendedInlineAiAction`)
- Modify: `apps/web/src/app/api/ai/inline/handler.ts` (schema + per-action validation + history/contextBefore)
- Modify: `packages/editor/src/types.ts` (`AskAIArgs` extension, `GenerateAICallback`)
- Modify: `apps/web/src/components/page/inline-ai-bridge.ts` (shared stream core, `createGenerateAi`, PLAN upsell copy)
- Tests: `apps/web/test/ai-inline-prompts.test.ts`, `apps/web/test/ai-inline-handler.test.ts` (extend both)

**Phase B — selection popover (custom + insert-below + follow-up):**
- Modify: `packages/editor/src/extensions/inline-ai.ts` (`InlineAiApplyMode`)
- Modify: `packages/editor/src/components/inline-ai-popover.tsx` (instruction field, widget «Вставить ниже» + follow-up input, `generate` branch)
- Modify: the editor stylesheet that holds `.anynote-inline-ai-preview` styles (locate via grep, see Task 5)
- Tests: `packages/editor/src/extensions/inline-ai.test.ts` (extend), `apps/e2e/inline-ai.spec.ts` (extend)

**Phase C — Space AI:**
- Create: `packages/editor/src/extensions/space-ai.ts`, `packages/editor/src/extensions/space-ai.test.ts`
- Create: `packages/editor/src/lib/markdown-to-html.ts` (extracted from markdown-upload-popover)
- Create: `packages/editor/src/components/space-ai-bar.tsx`
- Modify: `packages/editor/src/extensions/index.ts`, `packages/editor/src/anynote-editor.tsx`, `packages/editor/src/components/markdown-upload-popover.tsx`
- Modify: `apps/web/src/components/page/page-renderer.tsx`
- Create: `apps/e2e/space-ai.spec.ts`

**Phase D — page chats backend:**
- Modify: `packages/db/prisma/schema.prisma` (+ migration `page_chats`)
- Modify: `packages/domain/src/pages/repositories/pages.repository.ts` (purge PAGE chats)
- Modify: `packages/trpc/src/routers/chat.ts` (createChat pageId, listByPage, assertChatAccess page-visibility)
- Modify: `packages/trpc/src/index.ts` (re-export `buildPageVisibilityWhere`)
- Create: `apps/web/src/lib/chat/page-context.ts`
- Modify: `apps/web/src/lib/chat/types.ts`, `apps/web/src/app/api/agents/generate/route.ts`
- Tests: `packages/trpc/test/page-chat.test.ts` (new, real-DB), `apps/web/test/page-context.test.ts` (new)

**Phase E — page chats UI:**
- Modify: `packages/ui/src/components/index.ts` (Fab), `packages/ui/src/components/chat/chat-thread.tsx`, `packages/ui/src/components/chat/chat-composer.tsx` (context chip)
- Modify: `apps/web/src/components/workspace/chat/use-chat-stream.ts`, `apps/web/src/components/workspace/chat/workspace-chat-client.tsx` (page variant)
- Create: `apps/web/src/components/page/page-chat/page-chat-context.tsx`, `page-chat-fab.tsx`, `page-chat-sidebar.tsx`
- Modify: `apps/web/src/components/workspace/workspace-layout-client.tsx`, `apps/web/src/components/page/page-renderer.tsx` (outline offset)
- Create: `apps/e2e/page-chat.spec.ts`

---

## Phase A — inline backend

### Task 1: Prompt builders for `generate` and `custom`

**Files:**
- Modify: `apps/web/src/lib/ai/inline-prompts.ts`
- Test: `apps/web/test/ai-inline-prompts.test.ts`

The existing test asserts the preset allow-list is EXACTLY the six presets — we do NOT touch `INLINE_AI_ACTIONS`. The two new actions live beside it.

- [ ] **Step 1: Write the failing tests** — append to `apps/web/test/ai-inline-prompts.test.ts`:

```ts
import {
  buildCustomPrompt,
  buildGeneratePrompt,
  isExtendedInlineAiAction,
  MAX_CONTEXT_BEFORE_CHARS,
  MAX_CUSTOM_INSTRUCTION_CHARS,
  MAX_INSTRUCTION_CHARS,
} from '../src/lib/ai/inline-prompts'

describe('extended inline AI actions', () => {
  it('recognises only custom and generate', () => {
    expect(isExtendedInlineAiAction('custom')).toBe(true)
    expect(isExtendedInlineAiAction('generate')).toBe(true)
    expect(isExtendedInlineAiAction('summarize')).toBe(false)
    expect(isExtendedInlineAiAction('__proto__')).toBe(false)
    expect(isExtendedInlineAiAction('')).toBe(false)
  })

  it('buildGeneratePrompt embeds instruction and demands markdown-only output', () => {
    const prompt = buildGeneratePrompt('сделай базу данных в mermaid', {})
    expect(prompt).toContain('сделай базу данных в mermaid')
    expect(prompt).toContain('ТОЛЬКО итоговый markdown')
    expect(prompt).not.toContain('Контекст страницы')
  })

  it('buildGeneratePrompt embeds trimmed page context when present', () => {
    const prompt = buildGeneratePrompt('продолжи текст', { contextBefore: 'Русская баня — это...' })
    expect(prompt).toContain('Контекст страницы')
    expect(prompt).toContain('Русская баня — это...')
  })

  it('buildGeneratePrompt keeps the TAIL of an over-long context', () => {
    const context = 'A'.repeat(MAX_CONTEXT_BEFORE_CHARS) + 'TAIL'
    const prompt = buildGeneratePrompt('продолжи', { contextBefore: context })
    expect(prompt).toContain('TAIL')
    expect(prompt.length).toBeLessThan(MAX_CONTEXT_BEFORE_CHARS + 1_000)
  })

  it('buildGeneratePrompt caps the instruction', () => {
    const prompt = buildGeneratePrompt('И'.repeat(MAX_INSTRUCTION_CHARS + 500), {})
    expect(prompt.length).toBeLessThan(MAX_INSTRUCTION_CHARS + 1_000)
  })

  it('buildCustomPrompt wraps selection in triple quotes with the instruction', () => {
    const prompt = buildCustomPrompt('сделай списком', 'один два три')
    expect(prompt).toContain('сделай списком')
    expect(prompt).toContain('"""\nодин два три\n"""')
    expect(prompt).toContain('Выведи только результат без пояснений.')
  })

  it('buildCustomPrompt caps instruction and selection', () => {
    const prompt = buildCustomPrompt('X'.repeat(MAX_CUSTOM_INSTRUCTION_CHARS + 100), 'Y'.repeat(9_000))
    expect(prompt).not.toContain('X'.repeat(MAX_CUSTOM_INSTRUCTION_CHARS + 1))
    expect(prompt).not.toContain('Y'.repeat(8_001))
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web test -- ai-inline-prompts`
Expected: FAIL — `buildGeneratePrompt` etc. are not exported.

- [ ] **Step 3: Implement** — append to `apps/web/src/lib/ai/inline-prompts.ts`:

```ts
/** Caps for the space-bar `generate` and free-form `custom` actions (spec §4). */
export const MAX_INSTRUCTION_CHARS = 2_000
export const MAX_CUSTOM_INSTRUCTION_CHARS = 500
export const MAX_CONTEXT_BEFORE_CHARS = 8_000
export const MAX_HISTORY_TURNS = 10
export const MAX_HISTORY_TURN_CHARS = 16_000
export const MAX_HISTORY_TOTAL_CHARS = 48_000

/** Free-form actions beside the preset allow-list. Prompt templates stay server-side. */
const EXTENDED_ACTIONS = new Set(['custom', 'generate'])

export type ExtendedInlineAiAction = 'custom' | 'generate'

export function isExtendedInlineAiAction(value: string): value is ExtendedInlineAiAction {
  return EXTENDED_ACTIONS.has(value)
}

/**
 * Space-bar drafting prompt (spec §4). `contextBefore` is the page text above
 * the cursor — kept tail-first so «продолжи текст» continues the nearest text.
 */
export function buildGeneratePrompt(
  instruction: string,
  opts: { contextBefore?: string },
): string {
  const cappedInstruction = instruction.slice(0, MAX_INSTRUCTION_CHARS)
  const context = (opts.contextBefore ?? '').slice(-MAX_CONTEXT_BEFORE_CHARS).trim()
  const contextBlock = context
    ? `Контекст страницы над курсором (для продолжения и стиля):\n"""\n${context}\n"""\n\n`
    : ''
  return (
    `${contextBlock}Инструкция: ${cappedInstruction}\n\n` +
    'Сгенерируй ТОЛЬКО итоговый markdown для вставки в документ, без пояснений и вступлений. ' +
    'Для диаграмм используй fenced-блоки кода (например ```mermaid). Отвечай на языке инструкции.'
  )
}

/** Free-form transform of the selection (spec §4) — same shape as the presets. */
export function buildCustomPrompt(instruction: string, selectedText: string): string {
  const cappedInstruction = instruction.slice(0, MAX_CUSTOM_INSTRUCTION_CHARS)
  const cappedText = selectedText.slice(0, MAX_SELECTION_CHARS)
  return `${cappedInstruction}\n\nВыведи только результат без пояснений.\n\nТекст:\n"""\n${cappedText}\n"""`
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter web test -- ai-inline-prompts`
Expected: PASS (existing six-preset assertions must still pass — we did not modify `INLINE_AI_ACTIONS`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/ai/inline-prompts.ts apps/web/test/ai-inline-prompts.test.ts
git commit -m "feat(web): add generate/custom inline-AI prompt builders"
```

### Task 2: Handler — accept `generate` and `custom` actions

**Files:**
- Modify: `apps/web/src/app/api/ai/inline/handler.ts`
- Test: `apps/web/test/ai-inline-handler.test.ts`

The handler pipeline stays identical (session → zod → allow-list → page-edit-access → plan → rate-limit → model → chat → JWT → payload → proxy). Only the schema, allow-list check, and prompt/history construction change.

- [ ] **Step 1: Write the failing tests** — append to `apps/web/test/ai-inline-handler.test.ts` (reuse the file's existing `makeDeps`, `makeRequest`, `drain`, `happyUpstream` helpers and constants):

```ts
describe('generate action (space AI)', () => {
  it('accepts generate without selectedText and sends history + generate prompt', async () => {
    const deps = makeDeps()
    const res = await handleInlineAi(
      makeRequest({
        action: 'generate',
        instruction: 'сделай базу данных пользователей в mermaid',
        history: [
          { role: 'user', content: 'сделай базу данных' },
          { role: 'assistant', content: '```mermaid\nerDiagram\n```' },
        ],
        contextBefore: 'Проект про учёт пользователей.',
        pageId,
        workspaceId,
      }),
      deps,
    )
    expect(res.status).toBe(200)
    const [, init] = (deps.upstreamFetch as ReturnType<typeof vi.fn>).mock.calls[0]!
    const sent = JSON.parse((init as RequestInit).body as string)
    expect(sent.chat_history).toEqual([
      { role: 'user', content: 'сделай базу данных' },
      { role: 'assistant', content: '```mermaid\nerDiagram\n```' },
    ])
    expect(sent.user_message).toContain('сделай базу данных пользователей в mermaid')
    expect(sent.user_message).toContain('Контекст страницы')
    expect(sent.mcp_servers).toEqual([])
  })

  it('rejects generate without instruction', async () => {
    const deps = makeDeps()
    const res = await handleInlineAi(
      makeRequest({ action: 'generate', pageId, workspaceId }),
      deps,
    )
    expect(res.status).toBe(400)
    expect(deps.upstreamFetch).not.toHaveBeenCalled()
  })

  it('rejects history with more than 10 turns', async () => {
    const deps = makeDeps()
    const history = Array.from({ length: 11 }, (_, i) => ({
      role: 'user' as const,
      content: `turn ${i}`,
    }))
    const res = await handleInlineAi(
      makeRequest({ action: 'generate', instruction: 'x', history, pageId, workspaceId }),
      deps,
    )
    expect(res.status).toBe(400)
  })

  it('rejects history exceeding the total char budget', async () => {
    const deps = makeDeps()
    const history = Array.from({ length: 4 }, () => ({
      role: 'assistant' as const,
      content: 'A'.repeat(15_000),
    }))
    const res = await handleInlineAi(
      makeRequest({ action: 'generate', instruction: 'x', history, pageId, workspaceId }),
      deps,
    )
    expect(res.status).toBe(400)
  })
})

describe('custom action (free-form selection instruction)', () => {
  it('accepts custom with instruction + selectedText', async () => {
    const deps = makeDeps()
    const res = await handleInlineAi(
      makeRequest({
        action: 'custom',
        instruction: 'сделай маркированным списком',
        selectedText: 'один два три',
        pageId,
        workspaceId,
      }),
      deps,
    )
    expect(res.status).toBe(200)
    const [, init] = (deps.upstreamFetch as ReturnType<typeof vi.fn>).mock.calls[0]!
    const sent = JSON.parse((init as RequestInit).body as string)
    expect(sent.user_message).toContain('сделай маркированным списком')
    expect(sent.user_message).toContain('один два три')
  })

  it('rejects custom without selectedText', async () => {
    const deps = makeDeps()
    const res = await handleInlineAi(
      makeRequest({ action: 'custom', instruction: 'сделай списком', pageId, workspaceId }),
      deps,
    )
    expect(res.status).toBe(400)
    expect(deps.upstreamFetch).not.toHaveBeenCalled()
  })

  it('rejects custom with an over-long instruction', async () => {
    const deps = makeDeps()
    const res = await handleInlineAi(
      makeRequest({
        action: 'custom',
        instruction: 'X'.repeat(501),
        selectedText: 'текст',
        pageId,
        workspaceId,
      }),
      deps,
    )
    expect(res.status).toBe(400)
  })

  it('presets still require selectedText', async () => {
    const deps = makeDeps()
    const res = await handleInlineAi(
      makeRequest({ action: 'summarize', pageId, workspaceId }),
      deps,
    )
    expect(res.status).toBe(400)
  })

  it('still rejects unknown actions with BAD_ACTION', async () => {
    const deps = makeDeps()
    const res = await handleInlineAi(
      makeRequest({ action: 'hack', selectedText: 'x', pageId, workspaceId }),
      deps,
    )
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('BAD_ACTION')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web test -- ai-inline-handler`
Expected: FAIL — `generate` returns 400 BAD_ACTION today; new fields are stripped by zod.

- [ ] **Step 3: Implement.** In `apps/web/src/app/api/ai/inline/handler.ts`:

(a) Extend the imports from `inline-prompts`:

```ts
import {
  buildCustomPrompt,
  buildGeneratePrompt,
  buildInlinePrompt,
  isExtendedInlineAiAction,
  isInlineAiAction,
  MAX_CONTEXT_BEFORE_CHARS,
  MAX_CUSTOM_INSTRUCTION_CHARS,
  MAX_HISTORY_TOTAL_CHARS,
  MAX_HISTORY_TURN_CHARS,
  MAX_HISTORY_TURNS,
  MAX_INSTRUCTION_CHARS,
} from '@/lib/ai/inline-prompts'
```

(b) Replace `bodySchema` with:

```ts
const historyTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(MAX_HISTORY_TURN_CHARS),
})

const bodySchema = z
  .object({
    action: z.string().min(1).max(32),
    // Required for presets and `custom`; absent for `generate` (validated below).
    selectedText: z.string().min(1).max(50_000).optional(),
    instruction: z.string().min(1).max(MAX_INSTRUCTION_CHARS).optional(),
    history: z.array(historyTurnSchema).max(MAX_HISTORY_TURNS).optional(),
    contextBefore: z.string().max(MAX_CONTEXT_BEFORE_CHARS * 2).optional(),
    pageId: z.string().regex(UUID_RE),
    workspaceId: z.string().regex(UUID_RE),
    targetLang: z.string().max(64).optional(),
  })
  .superRefine((val, ctx) => {
    const total = (val.history ?? []).reduce((n, t) => n + t.content.length, 0)
    if (total > MAX_HISTORY_TOTAL_CHARS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'history too large' })
    }
  })
```

(c) Update the destructuring after `parsed.success`:

```ts
const { action, selectedText, instruction, history, contextBefore, pageId, workspaceId, targetLang } =
  parsed.data
```

(d) Replace step 3 (action allow-list) with allow-list + per-action requirements:

```ts
  // 3. Action allow-list (400) — the preset/action authority lives server-side.
  const isPreset = isInlineAiAction(action)
  if (!isPreset && !isExtendedInlineAiAction(action)) {
    return NextResponse.json({ error: 'Unknown action', code: 'BAD_ACTION' }, { status: 400 })
  }
  // Per-action required fields (spec §4): presets/custom transform a selection;
  // generate drafts from an instruction alone.
  if ((isPreset || action === 'custom') && !selectedText) {
    return NextResponse.json({ error: 'Invalid request', code: 'BAD_REQUEST' }, { status: 400 })
  }
  if ((action === 'custom' || action === 'generate') && !instruction) {
    return NextResponse.json({ error: 'Invalid request', code: 'BAD_REQUEST' }, { status: 400 })
  }
  if (action === 'custom' && (instruction?.length ?? 0) > MAX_CUSTOM_INSTRUCTION_CHARS) {
    return NextResponse.json({ error: 'Invalid request', code: 'BAD_REQUEST' }, { status: 400 })
  }
```

(e) Replace the prompt/payload block (step 9 in the pipeline):

```ts
  // 9. Server-side prompt + agent-run payload (no MCP; history only for the
  //    refinement loop of generate/custom — spec §4).
  let prompt: string
  if (action === 'generate') {
    prompt = buildGeneratePrompt(instruction as string, { contextBefore })
  } else if (action === 'custom') {
    prompt = buildCustomPrompt(instruction as string, selectedText as string)
  } else {
    prompt = buildInlinePrompt(action, selectedText as string, { targetLang })
  }
  const payload = buildAgentRunPayload({
    chatId: chat.id,
    userMessage: prompt,
    chatHistory: history ?? [],
    settings: {
      temperature: settings.temperature,
      topP: settings.topP,
      systemPrompt: settings.systemPrompt,
      defaultModel: {
        slug: modelSlug,
        provider: { kind: providerKind, connection: providerConnection },
      },
      embeddingsModel: null,
    },
    mcpServers: [],
    longTermMemories: [],
  })
```

Note: `buildInlinePrompt(action, ...)` needs `action` narrowed to `InlineAiAction` — the `isPreset` boolean from step (d) does not narrow in the `else` branch. Restructure as `if (action === 'generate') {...} else if (action === 'custom') {...} else if (isInlineAiAction(action)) { prompt = buildInlinePrompt(action, ...) } else { /* unreachable, already 400d */ return NextResponse.json({ error: 'Unknown action', code: 'BAD_ACTION' }, { status: 400 }) }` if TypeScript complains.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter web test -- ai-inline-handler`
Expected: PASS, including all pre-existing tests (gates order unchanged; `expect(deps.upstreamFetch).not.toHaveBeenCalled()` assertions on early-exit paths must still hold).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/ai/inline/handler.ts apps/web/test/ai-inline-handler.test.ts
git commit -m "feat(web): accept generate/custom actions with history in /api/ai/inline"
```

### Task 3: Editor types + streaming bridge (`createGenerateAi`, upsell copy)

**Files:**
- Modify: `packages/editor/src/types.ts`
- Modify: `apps/web/src/components/page/inline-ai-bridge.ts`

No unit test here (browser streaming glue — covered by the existing and new E2E specs); verified by `check-types`.

- [ ] **Step 1: Extend `packages/editor/src/types.ts`.** Below the existing `AskAIArgs` block, add the history type and extend `AskAIArgs`; below `AskAICallback`, add the generate contract:

```ts
/** One turn of the inline-AI refinement history (client-held, ephemeral). */
export type AskAiHistoryTurn = {
  role: 'user' | 'assistant'
  content: string
}
```

Add to `AskAIArgs` (after `targetLang?: string`):

```ts
  /** Free-form instruction — required for action 'custom'. */
  instruction?: string
  /** Prior refinement turns, oldest first (spec §4/§5). */
  history?: AskAiHistoryTurn[]
```

After `AskAICallback`, add:

```ts
/** Space-bar drafting request (spec §3): instruction + refinement history +
 *  the page text above the cursor. Returns the same streaming handle as askAI. */
export type GenerateAiArgs = {
  instruction: string
  history: AskAiHistoryTurn[]
  contextBefore?: string
}

export type GenerateAICallback = (args: GenerateAiArgs) => AskAIHandle
```

Add to `AnyNoteEditorProps` (next to `askAI?: AskAICallback`):

```ts
  // apps/web injects the space-bar drafting bridge here (spec §3). When present,
  // Space on an empty top-level paragraph opens the AI bar and the empty-line
  // placeholder advertises it.
  generateAI?: GenerateAICallback
```

Also export the new types from the barrel: open `packages/editor/src/index.ts`, find the line exporting `AskAIArgs`/`AskAICallback`/`AskAIHandle` and add `AskAiHistoryTurn`, `GenerateAiArgs`, `GenerateAICallback` to it.

- [ ] **Step 2: Rework `apps/web/src/components/page/inline-ai-bridge.ts`.** Extract the streaming core so both callbacks share it, and split the PLAN error copy (spec §8.2 — plan upsell text, distinct from the configure hint):

Replace the constants block at the top:

```ts
const CONFIGURE_AI = 'Настройте AI-агента в настройках'
const PLAN_UPSELL = 'Доступно на тарифе ПРО и выше'
const TOO_MANY = 'Слишком много запросов, попробуйте позже'
const GENERIC = 'Не удалось получить ответ ИИ. Попробуйте ещё раз.'

/** Map a non-OK `/api/ai/inline` response `{error, code}` to user-facing copy. */
function messageForErrorResponse(status: number, code: string | undefined): string {
  if (code === 'PLAN') return PLAN_UPSELL
  // 400 (no default model / bad action / bad request) → "configure".
  if (code === 'NO_MODEL' || status === 400 || status === 403) return CONFIGURE_AI
  if (code === 'RATE_LIMIT' || status === 429) return TOO_MANY
  return GENERIC
}
```

Then refactor `createAskAI` so its body-building is parameterized. The `run`/`decodeFrames`/callback plumbing stays byte-identical; only the fetch body changes. Final shape:

```ts
import type {
  AskAIArgs,
  AskAICallback,
  AskAIHandle,
  GenerateAiArgs,
  GenerateAICallback,
} from '@repo/editor'

// ... constants + messageForErrorResponse + decodeFrames unchanged (above) ...

/** Shared SSE streaming core: POST the given body to /api/ai/inline and expose
 *  the AskAIHandle contract (done never rejects, onError at most once). */
function streamInlineAi(body: Record<string, unknown>): AskAIHandle {
  // <the ENTIRE existing closure body of createAskAI's returned function,
  //  with the fetch body replaced by: body: JSON.stringify(body)>
}

export function createAskAI(ctx: { pageId: string; workspaceId: string }): AskAICallback {
  return (args: AskAIArgs): AskAIHandle =>
    streamInlineAi({
      action: args.action,
      selectedText: args.selectedText,
      pageId: ctx.pageId,
      workspaceId: ctx.workspaceId,
      ...(args.targetLang ? { targetLang: args.targetLang } : {}),
      ...(args.instruction ? { instruction: args.instruction } : {}),
      ...(args.history?.length ? { history: args.history } : {}),
    })
}

export function createGenerateAi(ctx: { pageId: string; workspaceId: string }): GenerateAICallback {
  return (args: GenerateAiArgs): AskAIHandle =>
    streamInlineAi({
      action: 'generate',
      instruction: args.instruction,
      history: args.history,
      ...(args.contextBefore ? { contextBefore: args.contextBefore } : {}),
      pageId: ctx.pageId,
      workspaceId: ctx.workspaceId,
    })
}
```

Concretely: move everything from `const controller = new AbortController()` through the final `return { onToken, onError, done, abort }` into `streamInlineAi(body)`, replacing the object literal inside `JSON.stringify({...})` with the `body` parameter.

- [ ] **Step 3: Type-check**

Run: `pnpm --filter web exec tsc --noEmit -p .` (or `pnpm check-types` filtered: `pnpm --filter web check-types`) and `pnpm --filter @repo/editor check-types` if the package has the script (else `pnpm --filter @repo/editor exec tsc --noEmit`).
Expected: clean.

- [ ] **Step 4: Run the existing web tests** (guard against accidental bridge regressions picked up by handler tests):

Run: `pnpm --filter web test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/types.ts packages/editor/src/index.ts apps/web/src/components/page/inline-ai-bridge.ts
git commit -m "feat(editor,web): generate-AI bridge contract + plan upsell copy"
```

## Phase B — selection popover: custom instruction, «Вставить ниже», follow-up

### Task 4: `InlineAiApplyMode` — insert-below accept path

**Files:**
- Modify: `packages/editor/src/extensions/inline-ai.ts`
- Test: `packages/editor/src/extensions/inline-ai.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `packages/editor/src/extensions/inline-ai.test.ts` (reuse the file's `schema`, `stateFrom`, `apply` helpers; note the test schema has only `doc/paragraph/text`):

```ts
describe('insertBelow apply mode', () => {
  it('inserts the result as a new paragraph after the selection block, keeping the original', () => {
    let state = stateFrom('Привет мир')
    state = apply(state, (tr) =>
      tr.setMeta(inlineAiPluginKey, inlineAiStartMeta({ from: 1, to: 11, action: 'rewrite' })),
    )
    state = apply(state, (tr) => tr.setMeta(inlineAiPluginKey, inlineAiAppendTokenMeta('Новый абзац')))
    state = apply(state, (tr) => tr.setMeta(inlineAiPluginKey, inlineAiFinishMeta()))

    const tr = buildInlineAiAcceptTransaction(state, 'insertBelow')
    expect(tr).not.toBeNull()
    const next = state.apply(tr!)
    expect(next.doc.childCount).toBe(2)
    expect(next.doc.child(0).textContent).toBe('Привет мир')
    expect(next.doc.child(1).textContent).toBe('Новый абзац')
    // Preview cleared atomically in the same transaction.
    expect(inlineAiPluginKey.getState(next)?.active).toBe(false)
  })

  it('replace mode is the default and unchanged', () => {
    let state = stateFrom('Привет мир')
    state = apply(state, (tr) =>
      tr.setMeta(inlineAiPluginKey, inlineAiStartMeta({ from: 1, to: 11, action: 'rewrite' })),
    )
    state = apply(state, (tr) => tr.setMeta(inlineAiPluginKey, inlineAiAppendTokenMeta('Замена')))
    const next = state.apply(buildInlineAiAcceptTransaction(state)!)
    expect(next.doc.childCount).toBe(1)
    expect(next.doc.child(0).textContent).toBe('Замена')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @repo/editor test -- inline-ai`
Expected: FAIL — `buildInlineAiAcceptTransaction` takes one argument.

- [ ] **Step 3: Implement** — in `packages/editor/src/extensions/inline-ai.ts`, extend the accept API:

```ts
export type InlineAiApplyMode = 'replace' | 'insertBelow'

export const buildInlineAiAcceptTransaction = (
  state: EditorState,
  mode: InlineAiApplyMode = 'replace',
): Transaction | null => {
  const preview = inlineAiPluginKey.getState(state)
  if (!preview?.active) return null
  const { from, to, action, text } = preview
  const tr = state.tr
  if (mode === 'insertBelow') {
    // Keep the original; add the result as a sibling paragraph after the
    // selection's top-level block (Notion's «Вставить ниже», spec §5).
    const $to = tr.doc.resolve(Math.min(to, tr.doc.content.size))
    const insertPos = $to.depth >= 1 ? $to.after(1) : tr.doc.content.size
    const paragraph = state.schema.nodes.paragraph
    tr.insert(insertPos, paragraph.create(null, text ? state.schema.text(text) : undefined))
  } else if (action === 'expand') {
    tr.insertText(text, to) // append after selection
  } else {
    tr.replaceWith(from, to, text ? state.schema.text(text) : []) // replace
  }
  tr.setMeta(inlineAiPluginKey, inlineAiClearMeta()) // dismiss atomically
  return tr
}

export const applyInlineAiResult = (editor: Editor, mode: InlineAiApplyMode = 'replace'): boolean => {
  if (editor.isDestroyed) return false
  const tr = buildInlineAiAcceptTransaction(editor.state, mode)
  if (!tr) return false
  editor.view.dispatch(tr.scrollIntoView())
  return true
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @repo/editor test -- inline-ai`
Expected: PASS, including all pre-existing accept/drift tests.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/extensions/inline-ai.ts packages/editor/src/extensions/inline-ai.test.ts
git commit -m "feat(editor): insert-below apply mode for inline-AI results"
```

### Task 5: Popover — instruction field on top; widget — «Вставить ниже» + follow-up input; `generate` widget branch

**Files:**
- Modify: `packages/editor/src/components/inline-ai-popover.tsx`
- Modify: the stylesheet holding `.anynote-inline-ai-preview` (find it: `grep -rn "anynote-inline-ai-preview" packages/editor/src --include='*.css' --include='*.scss' --include='*.ts' -l` — apply the CSS where the existing preview classes are styled)

No editor unit test for the DOM widget (the existing widget has none either); behavior is covered by the E2E extension in Task 6. Verified via check-types + E2E.

- [ ] **Step 1: Instruction field in `InlineAiPopover`** (Notion layout: free-form input on top, presets below — spec §5). Inside the popover component, above the actions `List`, add a text field + submit that dispatches action `custom`:

```tsx
// New state at the top of InlineAiPopover:
const [instruction, setInstruction] = useState('')

// Reset when the popover opens for a new capture:
useEffect(() => {
  if (open) setInstruction('')
}, [open, captured])

// Submit handler beside the existing pick():
const submitCustom = () => {
  const trimmed = instruction.trim()
  if (!trimmed || !captured || !askAI) return
  onClose()
  runInlineAi(editor, askAI, {
    action: 'custom',
    from: captured.from,
    to: captured.to,
    selectedText: captured.selectedText,
    instruction: trimmed,
  })
}
```

JSX above the presets list (MUI imports follow the file's existing direct-MUI import style):

```tsx
<Box sx={{ px: 1, pt: 1 }}>
  <TextField
    autoFocus
    fullWidth
    size="small"
    placeholder="Спросите AI изменить или создать…"
    value={instruction}
    onChange={(e) => setInstruction(e.target.value)}
    onKeyDown={(e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        submitCustom()
      }
    }}
    inputProps={{ 'data-testid': 'inline-ai-custom-input' }}
  />
</Box>
```

`runInlineAi` already stores `args` in the session — «Повторить» re-runs the custom instruction with no further change.

- [ ] **Step 2: Widget toolbar — «Вставить ниже» + follow-up input + `generate` branch.** In `inlineAiRenderPreview` (same file):

(a) `generate` branch — the space-bar draft renders WITHOUT the toolbar (the Space bar owns the controls, spec §3.3). At the top of the renderer:

```ts
if (state.action === 'generate') {
  const host = document.createElement('div')
  host.className = 'anynote-inline-ai-preview anynote-inline-ai-preview--draft'
  host.contentEditable = 'false'
  host.dataset.status = state.status
  const body = document.createElement('div')
  body.className = 'anynote-inline-ai-preview__body'
  host.appendChild(body)
  const paint = (s: InlineAiPreviewState) => {
    host.dataset.status = s.status
    if (s.status === 'error') {
      body.textContent = s.error || 'Ошибка ИИ'
      body.dataset.error = 'true'
    } else {
      body.textContent = s.text
      delete body.dataset.error
    }
  }
  paint(state)
  const onTransaction = () => {
    if (editor.isDestroyed) return unsubscribe()
    const current = getInlineAiPreview(editor)
    if (!current.active) return unsubscribe()
    paint(current)
  }
  const unsubscribe = () => editor.off('transaction', onTransaction)
  editor.on('transaction', onTransaction)
  return host
}
```

(mirror the exact live-update/self-unsubscribe idiom already used further down in this function — reuse its helper if one exists rather than duplicating).

(b) In the regular (selection) branch, add the insert-below button between «Принять» and «Повторить»:

```ts
const insertBelowBtn = makeButton('Вставить ниже')
insertBelowBtn.addEventListener('mousedown', (e) => e.preventDefault())
insertBelowBtn.addEventListener('click', () => {
  if (editor.isDestroyed) return
  sessions.get(editor)?.handle.abort()
  sessions.delete(editor)
  applyInlineAiResult(editor, 'insertBelow')
})
```

Append it to the toolbar right after `acceptBtn`; apply the same disabled/hidden state logic as `acceptBtn` (`canAccept` toggling, hidden on error).

(c) Follow-up input in the toolbar (shown only when `status === 'done'`; spec §5). Add after the buttons:

```ts
const followup = document.createElement('input')
followup.className = 'anynote-inline-ai-preview__followup'
followup.placeholder = 'Скажите AI, что сделать дальше…'
followup.addEventListener('mousedown', (e) => e.stopPropagation())
followup.addEventListener('keydown', (e) => {
  e.stopPropagation()
  if (e.key !== 'Enter') return
  const value = followup.value.trim()
  if (!value || editor.isDestroyed || !askAI) return
  const session = sessions.get(editor)
  const current = getInlineAiPreview(editor)
  if (!session || !current.active) return
  // Build the refinement history: prior turns + the just-finished exchange.
  const prevInstruction =
    session.args.instruction ?? ACTIONS.find((a) => a.id === session.args.action)?.label ?? session.args.action
  const history = [
    ...(session.args.history ?? []),
    { role: 'user' as const, content: prevInstruction },
    { role: 'assistant' as const, content: current.text },
  ]
  runInlineAi(editor, askAI, {
    action: 'custom',
    from: current.from,
    to: current.to,
    selectedText: session.args.selectedText,
    instruction: value,
    history,
  })
})
```

Toggle its visibility in the paint routine: visible only when `s.status === 'done'` (like `canAccept`).

- [ ] **Step 3: CSS.** In the stylesheet found by the grep above, append:

```css
/* Space-AI pending draft (block-level, no toolbar — the bar owns controls). */
.anynote-inline-ai-preview--draft {
  display: block;
  white-space: pre-wrap;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.875em;
}

.anynote-inline-ai-preview__followup {
  display: block;
  width: 100%;
  margin-top: 4px;
  padding: 4px 8px;
  border: 1px solid rgba(128, 128, 128, 0.35);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 0.85em;
}
```

Match the file's existing formatting/variables — if the existing preview styles use theme CSS variables for borders, reuse those instead of the fallback above.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @repo/editor exec tsc --noEmit && pnpm --filter @repo/editor test && pnpm --filter web exec tsc --noEmit`
Expected: clean/PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/components/inline-ai-popover.tsx <the-css-file>
git commit -m "feat(editor): custom instruction, insert-below and follow-up in inline-AI popover"
```

### Task 6: E2E — custom instruction + «Вставить ниже»

**Files:**
- Modify: `apps/e2e/inline-ai.spec.ts`

The spec already has: Prisma-driven `setupPage()`, `dragSelectEditorText`, `openAskAi`, `mockOk`, preview locators, and «Принять» flows — extend it.

- [ ] **Step 1: Append two tests** (reuse the file's helpers verbatim; `preview`/`previewBody` are the existing locator helpers, `STREAMED = 'Краткое резюме.'`):

```ts
test('свободная инструкция трансформирует выделение через превью', async ({ page }) => {
  await mockOk(page)
  await openPageWithText(page)          // the file's existing "seed text + select" path
  await dragSelectEditorText(page)
  await page.getByRole('button', { name: 'Спросить AI' }).click()
  const input = page.getByTestId('inline-ai-custom-input')
  await expect(input).toBeVisible()
  await input.fill('сделай список')
  await input.press('Enter')
  await expect(previewBody(page)).toHaveText(STREAMED, { timeout: 15_000 })
  await page.getByRole('button', { name: 'Принять' }).click()
  const editor = page.locator('.anynote-editor .ProseMirror')
  await expect(editor).toContainText(STREAMED)
  await expect(preview(page)).toHaveCount(0)
})

test('«Вставить ниже» сохраняет оригинал и добавляет результат ниже', async ({ page }) => {
  await mockOk(page)
  const originalText = await openPageWithText(page) // whatever the setup typed, e.g. the file's SOURCE constant
  await dragSelectEditorText(page)
  await openAskAi(page, 'Переписать')
  await expect(previewBody(page)).toHaveText(STREAMED, { timeout: 15_000 })
  await page.getByRole('button', { name: 'Вставить ниже' }).click()
  const editor = page.locator('.anynote-editor .ProseMirror')
  await expect(editor).toContainText(STREAMED)
  await expect(editor).toContainText(originalText ?? '') // original text still present
  await expect(preview(page)).toHaveCount(0)
})
```

Adapt the two setup calls to the file's ACTUAL helper names/signatures (read the file first — `openPageWithText` and `openAskAi` exist per the current spec; if `openPageWithText` doesn't return the seeded text, use the file's source-text constant directly).

- [ ] **Step 2: Run**

Run: `pnpm exec playwright test apps/e2e/inline-ai.spec.ts --retries=1`
Expected: PASS (retries=1 absorbs cold-compile flakiness — dev-only known issue).

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/inline-ai.spec.ts
git commit -m "test(e2e): custom instruction and insert-below inline-AI flows"
```

## Phase C — Space AI

### Task 7: SpaceAI extension + trigger guard

**Files:**
- Create: `packages/editor/src/extensions/space-ai.ts`
- Create: `packages/editor/src/extensions/space-ai.test.ts`
- Modify: `packages/editor/src/extensions/index.ts`

- [ ] **Step 1: Write the failing tests** — `packages/editor/src/extensions/space-ai.test.ts` (node env, bare ProseMirror — the inline-ai.test.ts idiom):

```ts
import { describe, expect, it } from 'vitest'
import { Schema } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'

import { findSpaceAiTrigger } from './space-ai'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    text: { group: 'inline' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      parseDOM: [{ tag: 'p' }],
      toDOM: () => ['p', 0],
    },
    blockquote: {
      group: 'block',
      content: 'block+',
      parseDOM: [{ tag: 'blockquote' }],
      toDOM: () => ['blockquote', 0],
    },
  },
})

const para = (text = '') => schema.nodes.paragraph.create(null, text ? schema.text(text) : null)

function stateWithSelection(doc: ReturnType<typeof schema.nodes.doc.create>, pos: number): EditorState {
  const base = EditorState.create({ schema, doc })
  return base.apply(base.tr.setSelection(TextSelection.create(base.doc, pos)))
}

describe('findSpaceAiTrigger', () => {
  it('fires on an empty top-level paragraph with a caret', () => {
    const doc = schema.nodes.doc.create(null, [para('Текст выше'), para('')])
    // Caret inside the empty paragraph: after "Текст выше" (size 12 = 1+10+1), pos 13.
    const state = stateWithSelection(doc, 13)
    expect(findSpaceAiTrigger(state)).toEqual({ pos: 13 })
  })

  it('does not fire in a non-empty paragraph', () => {
    const doc = schema.nodes.doc.create(null, [para('Привет')])
    const state = stateWithSelection(doc, 3)
    expect(findSpaceAiTrigger(state)).toBeNull()
  })

  it('does not fire with a non-empty selection', () => {
    const doc = schema.nodes.doc.create(null, [para('Привет')])
    const base = EditorState.create({ schema, doc })
    const state = base.apply(base.tr.setSelection(TextSelection.create(base.doc, 1, 4)))
    expect(findSpaceAiTrigger(state)).toBeNull()
  })

  it('does not fire inside a nested block (depth > 1)', () => {
    const doc = schema.nodes.doc.create(null, [schema.nodes.blockquote.create(null, [para('')])])
    // Empty paragraph inside blockquote: caret pos 2 → depth 2.
    const state = stateWithSelection(doc, 2)
    expect(findSpaceAiTrigger(state)).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @repo/editor test -- space-ai`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement** — `packages/editor/src/extensions/space-ai.ts`:

```ts
import { Extension } from '@tiptap/core'
import type { EditorState } from '@tiptap/pm/state'

/** Args handed to the host when the space trigger fires (spec §3.1). */
export type SpaceAiTriggerArgs = {
  /** Caret position inside the empty paragraph at trigger time. */
  pos: number
  /** Caret rect resolver for anchoring the AI bar (re-read at render time). */
  getRect: () => DOMRect
}

type SpaceAiStorageAi = {
  onSpaceAi?: (args: SpaceAiTriggerArgs) => void
}

/**
 * Pure guard: Space opens the AI bar ONLY on an empty top-level paragraph with
 * a caret (spec §3.1). Shift+Space is not bound — it types a plain space
 * (Notion's documented bypass). Nested blocks (details/callout/table cells)
 * never trigger (depth !== 1).
 */
export function findSpaceAiTrigger(state: EditorState): { pos: number } | null {
  const { selection } = state
  if (!selection.empty) return null
  const $from = selection.$from
  if ($from.depth !== 1) return null
  const parent = $from.parent
  if (parent.type.name !== 'paragraph') return null
  if (parent.content.size !== 0) return null
  return { pos: $from.pos }
}

export const SpaceAI = Extension.create({
  name: 'spaceAi',

  addKeyboardShortcuts() {
    return {
      // Bare Space only — prosemirror-keymap matches modifiers exactly, so
      // Shift+Space falls through to the default space insertion.
      Space: () => {
        const editor = this.editor
        if (!editor.isEditable) return false
        const ai = (editor.storage as unknown as { ai?: SpaceAiStorageAi }).ai
        const onSpaceAi = ai?.onSpaceAi
        if (!onSpaceAi) return false
        const trigger = findSpaceAiTrigger(editor.state)
        if (!trigger) return false
        const getRect = () => {
          try {
            const coords = editor.view.coordsAtPos(trigger.pos)
            return new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top)
          } catch {
            return new DOMRect(0, 0, 0, 0)
          }
        }
        onSpaceAi({ pos: trigger.pos, getRect })
        return true // consume the keypress — no space is typed
      },
    }
  },
})
```

- [ ] **Step 4: Register the extension** — in `packages/editor/src/extensions/index.ts`, add the import next to the InlineAI import:

```ts
import { SpaceAI } from './space-ai'
```

and add `SpaceAI,` to the `buildExtensions` array right before the `InlineAI.configure({...})` entry (the extension is options-free — it reads `editor.storage.ai.onSpaceAi` at keypress time, so gating = whether the host injected the callback).

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @repo/editor test -- space-ai && pnpm --filter @repo/editor exec tsc --noEmit`
Expected: PASS / clean.

- [ ] **Step 6: Commit**

```bash
git add packages/editor/src/extensions/space-ai.ts packages/editor/src/extensions/space-ai.test.ts packages/editor/src/extensions/index.ts
git commit -m "feat(editor): space-bar AI trigger extension with empty-paragraph guard"
```

### Task 8: Markdown helper extraction + `SpaceAiBar` + editor wiring

**Files:**
- Create: `packages/editor/src/lib/markdown-to-html.ts`
- Modify: `packages/editor/src/components/markdown-upload-popover.tsx`
- Create: `packages/editor/src/components/space-ai-bar.tsx`
- Modify: `packages/editor/src/anynote-editor.tsx`

- [ ] **Step 1: Extract the markdown→HTML parser** so the Space bar and the Markdown popover share it. Create `packages/editor/src/lib/markdown-to-html.ts`:

```ts
import { marked } from 'marked'

/** Markdown → HTML for editor.insertContent(). Synchronous by contract. */
export function markdownToHtml(source: string): string {
  const out = marked.parse(source, { async: false, gfm: true })
  return typeof out === 'string' ? out : ''
}
```

In `markdown-upload-popover.tsx`: delete the local `parseMarkdown` + its `marked` import; `import { markdownToHtml } from '../lib/markdown-to-html'` and replace the one call site (`insertContent(parseMarkdown(text))` → `insertContent(markdownToHtml(text))`).

Run: `pnpm --filter @repo/editor test` — expected PASS (no behavior change).

- [ ] **Step 2: Create `packages/editor/src/components/space-ai-bar.tsx`.** Full component:

```tsx
'use client'

import CloseIcon from '@mui/icons-material/Close'
import SendIcon from '@mui/icons-material/Send'
import StopIcon from '@mui/icons-material/Stop'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Paper from '@mui/material/Paper'
import Popper from '@mui/material/Popper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import type { Editor } from '@tiptap/core'
import { useEffect, useRef, useState } from 'react'

import {
  clearInlineAiPreview,
  getInlineAiPreview,
  startInlineAiPreview,
  appendInlineAiToken,
  finishInlineAiPreview,
  failInlineAiPreview,
} from '../extensions/inline-ai'
import type { SpaceAiTriggerArgs } from '../extensions/space-ai'
import { markdownToHtml } from '../lib/markdown-to-html'
import type { AskAIHandle, AskAiHistoryTurn, GenerateAICallback } from '../types'

const CONTEXT_BEFORE_CHARS = 8_000

/** Empty-input suggestions (Notion's Draft-with-AI pattern, spec §3.2). */
const SUGGESTIONS: Array<{
  id: string
  label: string
  prefill?: string
  instruction?: string // self-sufficient → submits directly
}> = [
  { id: 'continue', label: 'Продолжить текст', instruction: 'Продолжи текст, сохраняя стиль и тему.' },
  { id: 'brainstorm', label: 'Мозговой штурм идей на тему…', prefill: 'Составь список идей на тему ' },
  { id: 'outline', label: 'План документа на тему…', prefill: 'Составь план документа на тему ' },
  { id: 'write', label: 'Написать текст о…', prefill: 'Напиши текст о ' },
]

type Phase = 'input' | 'streaming' | 'done' | 'error'

type Props = Readonly<{
  editor: Editor
  open: boolean
  anchor: SpaceAiTriggerArgs | null
  generateAI: GenerateAICallback | null
  onClose: () => void
}>

/** Two nested rAFs — the deferModalInsert contract from anynote-editor.tsx:
 *  inserting synchronously after async UI produces transactions y-prosemirror
 *  never syncs to Yjs. Duplicated here because anynote-editor's copy is local. */
function deferInsert(run: () => void): void {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => requestAnimationFrame(run))
  } else {
    setTimeout(run, 0)
  }
}

export function SpaceAiBar({ editor, open, anchor, generateAI, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>('input')
  const [instruction, setInstruction] = useState('')
  const [followup, setFollowup] = useState('')
  const [error, setError] = useState<string | null>(null)
  const historyRef = useRef<AskAiHistoryTurn[]>([])
  const lastInstructionRef = useRef('')
  const handleRef = useRef<AskAIHandle | null>(null)
  const runTokenRef = useRef(0)

  // Reset per open.
  useEffect(() => {
    if (!open) return
    setPhase('input')
    setInstruction('')
    setFollowup('')
    setError(null)
    historyRef.current = []
    lastInstructionRef.current = ''
  }, [open, anchor])

  const abortRun = () => {
    runTokenRef.current += 1
    handleRef.current?.abort()
    handleRef.current = null
  }

  const discardAndClose = () => {
    abortRun()
    if (!editor.isDestroyed) clearInlineAiPreview(editor)
    onClose()
  }

  const currentDraftPos = (): number => {
    const preview = getInlineAiPreview(editor)
    if (preview.active) return preview.from
    return anchor?.pos ?? 0
  }

  const run = (nextInstruction: string, history: AskAiHistoryTurn[]) => {
    if (!generateAI || editor.isDestroyed) return
    const pos = currentDraftPos()
    const contextBefore = editor.state.doc
      .textBetween(0, Math.max(0, Math.min(pos, editor.state.doc.content.size)), '\n')
      .slice(-CONTEXT_BEFORE_CHARS)

    abortRun()
    const myToken = runTokenRef.current
    const isCurrent = () => runTokenRef.current === myToken

    // (Re)start the in-document pending draft at the mapped position.
    clearInlineAiPreview(editor)
    startInlineAiPreview(editor, { from: pos, to: pos, action: 'generate' })
    setPhase('streaming')
    setError(null)
    lastInstructionRef.current = nextInstruction

    const handle = generateAI({ instruction: nextInstruction, history, contextBefore })
    handleRef.current = handle
    handle.onToken((delta) => {
      if (editor.isDestroyed || !isCurrent()) return
      appendInlineAiToken(editor, delta)
    })
    handle.onError((message) => {
      if (editor.isDestroyed || !isCurrent()) return
      failInlineAiPreview(editor, message)
      setError(message)
      setPhase('error')
    })
    void handle.done.then(() => {
      if (editor.isDestroyed || !isCurrent()) return
      const current = getInlineAiPreview(editor)
      if (current.active && current.status === 'streaming') {
        finishInlineAiPreview(editor)
        setPhase('done')
      }
    })
  }

  const submitInstruction = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return
    run(trimmed, historyRef.current)
  }

  const submitFollowup = () => {
    const trimmed = followup.trim()
    if (!trimmed) return
    const preview = getInlineAiPreview(editor)
    historyRef.current = [
      ...historyRef.current,
      { role: 'user', content: lastInstructionRef.current },
      { role: 'assistant', content: preview.text },
    ]
    setFollowup('')
    run(trimmed, historyRef.current)
  }

  const retry = () => run(lastInstructionRef.current, historyRef.current)

  const accept = () => {
    const preview = getInlineAiPreview(editor)
    if (!preview.active || !preview.text || editor.isDestroyed) return
    const html = markdownToHtml(preview.text)
    const from = preview.from
    abortRun()
    clearInlineAiPreview(editor)
    onClose()
    deferInsert(() => {
      if (editor.isDestroyed) return
      const doc = editor.state.doc
      const $pos = doc.resolve(Math.max(0, Math.min(from, doc.content.size)))
      // Replace the (still empty) trigger paragraph with the parsed blocks.
      const start = $pos.depth >= 1 ? $pos.before(1) : 0
      const end = $pos.depth >= 1 ? $pos.after(1) : doc.content.size
      editor.chain().focus().insertContentAt({ from: start, to: end }, html).run()
    })
  }

  if (!open || !anchor || !generateAI) return null

  const anchorEl = { getBoundingClientRect: () => anchor.getRect() }
  const showSuggestions = phase === 'input' && instruction.trim().length === 0

  return (
    <Popper
      open
      anchorEl={anchorEl as never}
      placement="bottom-start"
      style={{ zIndex: 12 }}
      modifiers={[{ name: 'offset', options: { offset: [0, 6] } }]}
    >
      <Paper
        elevation={6}
        sx={{ width: 480, maxWidth: '90vw', p: 1 }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            discardAndClose()
          }
        }}
        data-testid="space-ai-bar"
      >
        {phase === 'input' || phase === 'error' ? (
          <Stack direction="row" spacing={0.5} alignItems="center">
            <TextField
              autoFocus
              fullWidth
              size="small"
              placeholder="Напишите, что сгенерировать…"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submitInstruction(instruction)
                }
              }}
              inputProps={{ 'data-testid': 'space-ai-input' }}
            />
            <IconButton
              size="small"
              aria-label="Сгенерировать"
              onClick={() => submitInstruction(instruction)}
            >
              <SendIcon fontSize="small" />
            </IconButton>
            <IconButton size="small" aria-label="Закрыть" onClick={discardAndClose}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Stack>
        ) : null}

        {error ? (
          <Typography variant="caption" color="error" sx={{ px: 1 }} data-testid="space-ai-error">
            {error}
          </Typography>
        ) : null}

        {showSuggestions ? (
          <List dense disablePadding sx={{ mt: 0.5 }}>
            {SUGGESTIONS.map((s) => (
              <ListItemButton
                key={s.id}
                dense
                onClick={() => {
                  if (s.instruction) submitInstruction(s.instruction)
                  else setInstruction(s.prefill ?? '')
                }}
                data-testid={`space-ai-suggestion-${s.id}`}
              >
                <ListItemText primary={s.label} />
              </ListItemButton>
            ))}
          </List>
        ) : null}

        {phase === 'streaming' ? (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 1, py: 0.5 }}>
            <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
              Генерация…
            </Typography>
            <IconButton
              size="small"
              aria-label="Остановить"
              onClick={() => {
                abortRun()
                if (!editor.isDestroyed) {
                  const current = getInlineAiPreview(editor)
                  if (current.active) finishInlineAiPreview(editor)
                }
                setPhase('done')
              }}
            >
              <StopIcon fontSize="small" />
            </IconButton>
          </Stack>
        ) : null}

        {phase === 'done' ? (
          <Box sx={{ mt: 0.5 }}>
            <TextField
              fullWidth
              size="small"
              placeholder="Скажите AI, что сделать дальше…"
              value={followup}
              onChange={(e) => setFollowup(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submitFollowup()
                }
              }}
              inputProps={{ 'data-testid': 'space-ai-followup' }}
            />
            <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 0.5 }}>
              <Button size="small" onClick={discardAndClose}>
                Отклонить
              </Button>
              <Button size="small" onClick={retry}>
                Повторить
              </Button>
              <Button size="small" variant="contained" onClick={accept} data-testid="space-ai-accept">
                Вставить
              </Button>
            </Stack>
          </Box>
        ) : null}
      </Paper>
    </Popper>
  )
}
```

Notes for the implementer:
- `Popper` (not `Popover`) is deliberate: no backdrop → click-away does NOT discard (spec §3.4).
- The pending draft lives in the document via the inline-AI plugin; the bar never renders the draft text itself.
- On error the input phase returns so the user can edit the instruction; the preview shows the error state (widget `--draft` branch paints it).

- [ ] **Step 3: Wire into `anynote-editor.tsx`:**

(a) Imports:

```ts
import { SpaceAiBar } from './components/space-ai-bar'
import type { SpaceAiTriggerArgs } from './extensions/space-ai'
```

(b) State next to `aiCapture`:

```ts
const [spaceAi, setSpaceAi] = useState<SpaceAiTriggerArgs | null>(null)
```

(c) Extend the `editor.storage.ai` effect (it currently REPLACES `storage.ai` with `{askAI, onAskAi}` — keep it a single writer, add the two new keys):

```ts
useEffect(() => {
  if (!editor) return
  ;(editor.storage as unknown as Record<string, unknown>).ai = {
    askAI: props.askAI ?? null,
    onAskAi: (captured: InlineAiCapturedRange) => setAiCapture(captured),
    generateAI: props.generateAI ?? null,
    onSpaceAi: props.generateAI ? (args: SpaceAiTriggerArgs) => setSpaceAi(args) : undefined,
  }
}, [editor, props.askAI, props.generateAI])
```

(d) Placeholder — find the `placeholder:` option in the `buildExtensions({...})` call and make it capability-aware (spec §3.6). First check what is passed today: `grep -n "placeholder" packages/editor/src/anynote-editor.tsx`. Change the expression to:

```ts
placeholder:
  props.placeholder ??
  (props.generateAI ? 'Нажмите «пробел» для AI, «/» — для команд' : "Введите '/' для команд"),
```

(preserving whatever the current default literal is for the non-AI branch — if it differs from `"Введите '/' для команд"`, keep the existing literal).

IMPORTANT: `buildExtensions` runs once per `[ydoc, provider]` — `props.generateAI` is stable per page mount (a `useMemo` in page-renderer), so this is fine; do NOT add it to the `useEditor` deps.

(e) Mount the bar next to `<InlineAiPopover …/>`:

```tsx
<SpaceAiBar
  editor={editor}
  open={spaceAi != null}
  anchor={spaceAi}
  generateAI={props.generateAI ?? null}
  onClose={() => setSpaceAi(null)}
/>
```

- [ ] **Step 4: Verify**

Run: `pnpm --filter @repo/editor exec tsc --noEmit && pnpm --filter @repo/editor test`
Expected: clean / PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/lib/markdown-to-html.ts packages/editor/src/components/markdown-upload-popover.tsx packages/editor/src/components/space-ai-bar.tsx packages/editor/src/anynote-editor.tsx
git commit -m "feat(editor): space-AI bar with in-document streaming draft and markdown insert"
```

### Task 9: apps/web wiring — `createGenerateAi` into PageRenderer

**Files:**
- Modify: `apps/web/src/components/page/page-renderer.tsx`

- [ ] **Step 1:** Next to the existing `askAI` useMemo (~line 339):

```ts
const generateAI = useMemo(() => createGenerateAi({ pageId: page.id, workspaceId }), [page.id, workspaceId])
```

(extend the existing `import { createAskAI } from './inline-ai-bridge'` to also import `createGenerateAi`).

- [ ] **Step 2:** In the `<AnyNoteEditor …/>` prop list (next to `askAI={editable ? askAI : undefined}`):

```tsx
generateAI={editable ? generateAI : undefined}
```

Plan gate is server-side (visible-but-paywalled, spec §8.2) — do NOT gate on plan features here.

- [ ] **Step 3: Verify**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: clean. Then smoke it live: `pnpm dev` (with docker up), open a TEXT page, press Space on an empty line → the bar opens; Shift+Space types a space; Esc closes. (No AI provider needed to verify the bar/trigger mechanics; submit will show the configure/plan error path, which is also correct behavior to observe.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/page/page-renderer.tsx
git commit -m "feat(web): inject space-AI drafting bridge into the page editor"
```

### Task 10: E2E — space-ai.spec.ts

**Files:**
- Create: `apps/e2e/space-ai.spec.ts`

Copy the structural skeleton of `apps/e2e/inline-ai.spec.ts` (Prisma-driven setup: user via `signUpAndAuthAs`, subscription upgrade, workspace+member+page via Prisma, `userPreference.activeWorkspaceId`, ai-provider/model/workspaceAiSettings seed, `page.goto('/pages/<id>')`). Reuse its constants/mocks verbatim where noted.

- [ ] **Step 1: Write the spec:**

```ts
import { expect, test, type Page } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

// ── copy from inline-ai.spec.ts: password const, prisma dynamic-import setup,
//    setupPage()-style fixture (workspace + OWNER member + TEXT page + activeWorkspaceId +
//    aiProvider/aiModel/workspaceAiSettings seed + plan upgrade via
//    prisma.plan.findFirst({ where: { aiSettingsEnabled: true } }) + expire/create subscription).
//    Name the fixture setupSpacePage(page) and have it return { pageId }.

const DRAFT_TOKEN_A = '## Русская баня\n\n'
const DRAFT_TOKEN_B = 'Тёплый пар и берёзовые веники.'
const OK_SSE_BODY =
  `data: {"type":"token","text":${JSON.stringify(DRAFT_TOKEN_A)}}\n\n` +
  `data: {"type":"token","text":${JSON.stringify(DRAFT_TOKEN_B)}}\n\n` +
  `data: {"type":"done"}\n\n`

const mockOk = (page: Page) =>
  page.route('**/api/ai/inline', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'cache-control': 'no-cache' },
      body: OK_SSE_BODY,
    }),
  )

const editorLocator = (page: Page) => page.locator('.anynote-editor .ProseMirror')

async function focusEmptyLine(page: Page) {
  const editor = editorLocator(page)
  await expect(editor).toBeVisible({ timeout: 15_000 })
  await editor.click()
}

test('пробел на пустой строке открывает AI-бар, черновик стримится и вставляется', async ({ page }) => {
  await setupSpacePage(page)
  await mockOk(page)
  await focusEmptyLine(page)
  await page.keyboard.press('Space')

  const bar = page.getByTestId('space-ai-bar')
  await expect(bar).toBeVisible()

  await page.getByTestId('space-ai-input').fill('сгенерируй текст про русскую баню')
  await page.keyboard.press('Enter')

  // The pending draft streams INTO the document (decoration).
  const draft = page.locator('.anynote-inline-ai-preview--draft')
  await expect(draft).toContainText('Тёплый пар', { timeout: 15_000 })

  await page.getByTestId('space-ai-accept').click()

  // Inserted as formatted content: the markdown heading became an h2.
  await expect(editorLocator(page).locator('h2')).toContainText('Русская баня', { timeout: 15_000 })
  await expect(editorLocator(page)).toContainText('Тёплый пар и берёзовые веники.')
  await expect(page.locator('.anynote-inline-ai-preview--draft')).toHaveCount(0)
  await expect(bar).toBeHidden()
})

test('Esc отклоняет черновик, документ не изменён', async ({ page }) => {
  await setupSpacePage(page)
  await mockOk(page)
  await focusEmptyLine(page)
  await page.keyboard.press('Space')
  await page.getByTestId('space-ai-input').fill('черновик')
  await page.keyboard.press('Enter')
  await expect(page.locator('.anynote-inline-ai-preview--draft')).toContainText('Тёплый пар', {
    timeout: 15_000,
  })
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('space-ai-bar')).toHaveCount(0)
  await expect(page.locator('.anynote-inline-ai-preview--draft')).toHaveCount(0)
  await expect(editorLocator(page)).not.toContainText('Тёплый пар')
})

test('Shift+Space вставляет обычный пробел и не открывает бар', async ({ page }) => {
  await setupSpacePage(page)
  await focusEmptyLine(page)
  await page.keyboard.press('Shift+Space')
  await expect(page.getByTestId('space-ai-bar')).toHaveCount(0)
})

test('подсказка предзаполняет промпт', async ({ page }) => {
  await setupSpacePage(page)
  await focusEmptyLine(page)
  await page.keyboard.press('Space')
  await page.getByTestId('space-ai-suggestion-brainstorm').click()
  await expect(page.getByTestId('space-ai-input')).toHaveValue(/Составь список идей/)
})

test('на тарифе без AI показывается апселл', async ({ page }) => {
  await setupSpacePage(page) // page/editor need to exist; the mock below simulates the server plan gate
  await page.route('**/api/ai/inline', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'AI is not available on this plan', code: 'PLAN' }),
    }),
  )
  await focusEmptyLine(page)
  await page.keyboard.press('Space')
  await page.getByTestId('space-ai-input').fill('что-нибудь')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('space-ai-error')).toHaveText('Доступно на тарифе ПРО и выше', {
    timeout: 15_000,
  })
})
```

Fill in `setupSpacePage` by copying `inline-ai.spec.ts`'s fixture code (same Prisma calls, unique email suffix `space-ai+${Date.now()}@example.com`).

- [ ] **Step 2: Run**

Run: `pnpm exec playwright test apps/e2e/space-ai.spec.ts --retries=1`
Expected: PASS. (Playwright starts its own dev server on 3100 — no `pnpm dev` needed, but docker compose must be up; ensure nothing else holds port 3100.)

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/space-ai.spec.ts
git commit -m "test(e2e): space-AI drafting flow"
```

## Phase D — page chats backend

### Task 11: Prisma — `ChatKind.PAGE` + `Chat.pageId` + purge

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Modify: `packages/domain/src/pages/repositories/pages.repository.ts`
- Create: migration `packages/db/prisma/migrations/<timestamp>_page_chats/`

- [ ] **Step 1: Schema.** In `packages/db/prisma/schema.prisma`:

(a) `ChatKind` enum (~line 358) — add `PAGE`:

```prisma
enum ChatKind {
  NORMAL
  INLINE_AI
  PAGE
}
```

(b) `Chat` model (~line 735) — after the `inlineAiPageId` field, add:

```prisma
  // Set only on PAGE chats (page-scoped chat panel, many per page). SetNull on
  // page delete; the page hard-delete tx purges these rows like INLINE_AI ones.
  pageId         String?        @map("page_id") @db.Uuid
```

and in the relations block (after `inlineAiPage`):

```prisma
  page         Page?          @relation("ChatPage", fields: [pageId], references: [id], onDelete: SetNull)
```

and after the existing `@@index([aiModelId])`:

```prisma
  @@index([pageId])
```

(c) `Page` model (~line 561, next to `inlineAiChats`):

```prisma
  pageChats            Chat[]                       @relation("ChatPage")
```

- [ ] **Step 2: Migration.** The dev DB is shared; this branch is main-based so plain `migrate dev` is correct:

Run: `pnpm --filter @repo/db exec prisma migrate dev --name page_chats`
Expected: a new migration folder with `ALTER TYPE "ChatKind" ADD VALUE 'PAGE';`, `ALTER TABLE "chats" ADD COLUMN "page_id" UUID;`, an FK to `pages(id) ON DELETE SET NULL`, and `CREATE INDEX "chats_page_id_idx"`. Client regenerates automatically.

If migrate reports drift (another worktree touched the shared DB): STOP, do not reset — use the diff→psql→resolve flow from the memory notes (`prisma migrate diff --to-schema`, apply via `psql --single-transaction`, `prisma migrate resolve --applied <name>`).

- [ ] **Step 3: Purge PAGE chats with the page.** In `packages/domain/src/pages/repositories/pages.repository.ts`, replace the two INLINE_AI `deleteMany` calls:

`hardDeletePageTx` (~line 945):

```ts
    // Prune the page's hidden INLINE_AI chats (Phase 9D) and its PAGE chats
    // (page chat panel). The FKs are SetNull; a permanent purge must remove
    // them outright — they have no meaning without their page.
    await this.uow.client().chat.deleteMany({
      where: {
        OR: [
          { kind: 'INLINE_AI', inlineAiPageId: page.id },
          { kind: 'PAGE', pageId: page.id },
        ],
      },
    })
```

`emptyTrashTx` (~line 971):

```ts
    if (trashed.length > 0) {
      const trashedIds = trashed.map((p) => p.id)
      await this.uow.client().chat.deleteMany({
        where: {
          OR: [
            { kind: 'INLINE_AI', inlineAiPageId: { in: trashedIds } },
            { kind: 'PAGE', pageId: { in: trashedIds } },
          ],
        },
      })
    }
```

- [ ] **Step 4: Cross-consumer check** (shared-model-change trap): run `grep -rn "ChatKind\|kind: 'NORMAL'\|kind: 'INLINE_AI'" packages apps --include='*.ts' -l` and eyeball each hit — the additive enum value must not break exhaustive switches. `apps/engines` does not consume Chat today, but verify: `grep -rn "chat" apps/engines/src --include='*.ts' -il`.

- [ ] **Step 5: Verify + commit**

Run: `pnpm --filter @repo/db exec tsc --noEmit 2>/dev/null || true && pnpm --filter @repo/domain test 2>/dev/null; pnpm check-types`
Expected: clean (domain tests may not cover the repo — the tRPC test in Task 12 exercises it).

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations packages/domain/src/pages/repositories/pages.repository.ts
git commit -m "feat(db,domain): ChatKind.PAGE + Chat.pageId with page-delete purge"
```

### Task 12: tRPC — `createChat({pageId})`, `listByPage`, page-visibility in `assertChatAccess`

**Files:**
- Modify: `packages/trpc/src/routers/chat.ts`
- Test: `packages/trpc/test/page-chat.test.ts` (new, real DB — requires `docker compose up -d`)

- [ ] **Step 1: Write the failing test** — `packages/trpc/test/page-chat.test.ts`, mirroring `chat-inline-ai.test.ts` (self-contained fixtures, unique email suffix, cleanup in beforeEach+afterAll) and `meeting-router.test.ts` (plan subscription helper). Full file:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@repo/db'

import { chatRouter } from '../src/routers/chat'
import { createCallerFactory } from '../src/trpc'

// Self-contained (creates its own users / workspace / pages / plans-via-seed inline)
// so it passes on a fresh CI DB. Requires `docker compose up -d`.
const EMAIL_SUFFIX = '+page-chat-test@anynote.dev'

async function cleanFixtures() {
  const users = await prisma.user.findMany({
    where: { email: { contains: EMAIL_SUFFIX } },
    select: { id: true },
  })
  const userIds = users.map((u) => u.id)
  if (userIds.length === 0) return
  const workspaces = await prisma.workspace.findMany({
    where: { createdById: { in: userIds } },
    select: { id: true },
  })
  const wsIds = workspaces.map((w) => w.id)
  await prisma.chat.deleteMany({ where: { workspaceId: { in: wsIds } } })
  await prisma.page.deleteMany({ where: { workspaceId: { in: wsIds } } })
  await prisma.collection.deleteMany({ where: { workspaceId: { in: wsIds } } })
  await prisma.workspaceMember.deleteMany({ where: { workspaceId: { in: wsIds } } })
  await prisma.subscription.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.workspace.deleteMany({ where: { id: { in: wsIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
}

function caller(userId: string) {
  return createCallerFactory(chatRouter)({
    prisma,
    user: { id: userId, email: 'x', firstName: 'T', lastName: 'U', emailVerified: true } as never,
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {} as never,
    returnUrlBase: 'http://localhost',
  })
}

async function makeUser(tag: string) {
  return prisma.user.create({
    data: {
      email: `${tag}-${Date.now()}${EMAIL_SUFFIX}`,
      firstName: 'Тест',
      lastName: tag,
      emailVerified: true,
    },
    select: { id: true },
  })
}

async function subscribeTo(userId: string, slug: 'pro' | 'personal') {
  const plan = await prisma.plan.findUniqueOrThrow({ where: { slug } })
  const now = new Date()
  const end = new Date(now)
  end.setMonth(end.getMonth() + 1)
  await prisma.subscription.create({
    data: {
      userId,
      planId: plan.id,
      status: 'ACTIVE',
      billingPeriod: 'MONTHLY',
      currentPeriodStart: now,
      currentPeriodEnd: end,
    },
  })
}

type Fixture = {
  ownerId: string
  memberId: string
  workspaceId: string
  visiblePageId: string
  privatePageId: string
}

async function makeFixture(opts: { plan: 'pro' | 'personal' }): Promise<Fixture> {
  const owner = await makeUser('owner')
  const member = await makeUser('member')
  await subscribeTo(owner.id, opts.plan)
  const ws = await prisma.workspace.create({
    data: { name: 'PageChat WS', createdById: owner.id },
    select: { id: true },
  })
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: ws.id, userId: owner.id, role: 'OWNER' },
      { workspaceId: ws.id, userId: member.id, role: 'EDITOR' },
    ],
  })
  // Visible to every member: collectionId null (buildPageVisibilityWhere OR-branch).
  const visible = await prisma.page.create({
    data: { workspaceId: ws.id, type: 'TEXT', title: 'Видимая', createdById: owner.id },
    select: { id: true },
  })
  // Invisible to `member`: PERSONAL collection owned by `owner`.
  const personal = await prisma.collection.create({
    data: { workspaceId: ws.id, kind: 'PERSONAL', ownerId: owner.id, title: 'Личное' },
    select: { id: true },
  })
  const priv = await prisma.page.create({
    data: {
      workspaceId: ws.id,
      type: 'TEXT',
      title: 'Личная',
      createdById: owner.id,
      collectionId: personal.id,
    },
    select: { id: true },
  })
  return {
    ownerId: owner.id,
    memberId: member.id,
    workspaceId: ws.id,
    visiblePageId: visible.id,
    privatePageId: priv.id,
  }
}

beforeEach(cleanFixtures)
afterAll(cleanFixtures)

describe('page chats (tRPC)', () => {
  it('createChat with pageId creates a PAGE chat bound to the page', async () => {
    const f = await makeFixture({ plan: 'pro' })
    const chat = await caller(f.ownerId).createChat({
      workspaceId: f.workspaceId,
      pageId: f.visiblePageId,
    })
    expect(chat.kind).toBe('PAGE')
    expect(chat.pageId).toBe(f.visiblePageId)
  })

  it('createChat with pageId is FORBIDDEN when the plan lacks chatsEnabled', async () => {
    const f = await makeFixture({ plan: 'personal' })
    await expect(
      caller(f.ownerId).createChat({ workspaceId: f.workspaceId, pageId: f.visiblePageId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('createChat with an invisible pageId is NOT_FOUND (no oracle)', async () => {
    const f = await makeFixture({ plan: 'pro' })
    await expect(
      caller(f.memberId).createChat({ workspaceId: f.workspaceId, pageId: f.privatePageId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('listByPage returns only that page PAGE chats, newest first', async () => {
    const f = await makeFixture({ plan: 'pro' })
    const own = caller(f.ownerId)
    const a = await own.createChat({ workspaceId: f.workspaceId, pageId: f.visiblePageId })
    const b = await own.createChat({ workspaceId: f.workspaceId, pageId: f.visiblePageId })
    await own.createChat({ workspaceId: f.workspaceId }) // NORMAL — must not appear
    const list = await own.listByPage({ workspaceId: f.workspaceId, pageId: f.visiblePageId })
    expect(list.map((c) => c.id).sort()).toEqual([a.id, b.id].sort())
  })

  it('listChats still excludes PAGE chats', async () => {
    const f = await makeFixture({ plan: 'pro' })
    const own = caller(f.ownerId)
    const pageChat = await own.createChat({ workspaceId: f.workspaceId, pageId: f.visiblePageId })
    const normal = await own.createChat({ workspaceId: f.workspaceId })
    const list = await own.listChats({ workspaceId: f.workspaceId })
    const ids = list.map((c) => c.id)
    expect(ids).toContain(normal.id)
    expect(ids).not.toContain(pageChat.id)
  })

  it('getChat denies a PAGE chat whose page is invisible to the caller', async () => {
    const f = await makeFixture({ plan: 'pro' })
    const chat = await caller(f.ownerId).createChat({
      workspaceId: f.workspaceId,
      pageId: f.privatePageId,
    })
    await expect(caller(f.memberId).getChat({ chatId: chat.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    // The owner still sees it.
    const got = await caller(f.ownerId).getChat({ chatId: chat.id })
    expect(got.chat.id).toBe(chat.id)
  })
})
```

Note: if `prisma.workspace.create` requires more fields (e.g. a slug) or the member-role enum name differs, mirror EXACTLY what `chat-inline-ai.test.ts` / `meeting-router.test.ts` do — they are the working fixtures.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @repo/trpc test -- page-chat`
Expected: FAIL — `createChat` rejects `pageId` (zod strips/unknown), `listByPage` doesn't exist.

- [ ] **Step 3: Implement** in `packages/trpc/src/routers/chat.ts`:

(a) Imports:

```ts
import { buildPageVisibilityWhere } from '@repo/domain'
import { getAvailableAiModels, getWorkspaceFeatures } from '../helpers/plan'
```

(check how `getAvailableAiModels` is currently imported and extend that line; check the `@repo/domain` import style used by `synced-block.ts` — `import { buildPageVisibilityWhere } from '@repo/domain'` — and match it).

(b) Page-visibility helper next to `assertChatAccess`:

```ts
async function assertPageVisible(
  ctx: { prisma: PrismaClient; user: { id: string } },
  args: { workspaceId: string; pageId: string },
) {
  const page = await ctx.prisma.page.findFirst({
    where: {
      id: args.pageId,
      workspaceId: args.workspaceId,
      deletedAt: null,
      AND: [buildPageVisibilityWhere(ctx.user.id)],
    },
    select: { id: true },
  })
  if (!page) throw new TRPCError({ code: 'NOT_FOUND' })
}
```

(c) Extend `assertChatAccess` — after the `if (!chat) throw` line:

```ts
  // PAGE chats carry injected page content — require CURRENT page visibility,
  // or a member who can't see a private page could read it via the chat.
  if (chat.kind === 'PAGE' && chat.pageId) {
    const page = await ctx.prisma.page.findFirst({
      where: {
        id: chat.pageId,
        deletedAt: null,
        AND: [buildPageVisibilityWhere(ctx.user.id)],
      },
      select: { id: true },
    })
    if (!page) throw new TRPCError({ code: 'NOT_FOUND' })
  }
```

(d) `createChat` — add `pageId: z.string().uuid().optional()` to the input object, and in the mutation body after the existing `assertWorkspaceMember`/`parentId`/`aiModelId` checks:

```ts
      if (input.pageId) {
        await assertPageVisible(ctx, { workspaceId: input.workspaceId, pageId: input.pageId })
        // Server-side plan gate (spec §8.2) — the FAB is visible on every plan,
        // the server is the authority.
        const features = await getWorkspaceFeatures(input.workspaceId)
        if (!features.chatsEnabled) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Чаты недоступны на вашем тарифе' })
        }
      }
```

and extend the `data:` object:

```ts
          ...(input.pageId ? { pageId: input.pageId, kind: 'PAGE' as const } : {}),
```

(e) New `listByPage` procedure after `listChats`:

```ts
  listByPage: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid(), pageId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      await assertPageVisible(ctx, input)
      return ctx.prisma.chat.findMany({
        where: { workspaceId: input.workspaceId, pageId: input.pageId, kind: 'PAGE' },
        orderBy: { updatedAt: 'desc' },
        take: 50,
        select: {
          id: true,
          title: true,
          updatedAt: true,
          createdAt: true,
          createdById: true,
        },
      })
    }),
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @repo/trpc test -- page-chat && pnpm --filter @repo/trpc test`
Expected: new suite PASS + the full trpc suite stays green (esp. `chat-inline-ai.test.ts`, `chat-router.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/routers/chat.ts packages/trpc/test/page-chat.test.ts
git commit -m "feat(trpc): page-scoped chats — createChat pageId, listByPage, visibility gate"
```

### Task 13: `pageContext` in `/api/agents/generate`

**Files:**
- Create: `apps/web/src/lib/chat/page-context.ts`
- Modify: `apps/web/src/lib/chat/types.ts`, `apps/web/src/app/api/agents/generate/route.ts`, `packages/trpc/src/index.ts`
- Test: `apps/web/test/page-context.test.ts` (new)

- [ ] **Step 1: Write the failing test** — `apps/web/test/page-context.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
  buildPageContextAttachment,
  MAX_PAGE_CONTEXT_CHARS,
  parsePageContext,
} from '../src/lib/chat/page-context'

describe('parsePageContext', () => {
  it('returns null for absent input', () => {
    expect(parsePageContext(undefined)).toBeNull()
    expect(parsePageContext(null)).toBeNull()
  })

  it('accepts a valid object', () => {
    expect(parsePageContext({ content: '# Тест', isSelection: false })).toEqual({
      content: '# Тест',
      isSelection: false,
    })
  })

  it.each([
    'string',
    42,
    { content: '', isSelection: false },
    { content: '   ', isSelection: true },
    { content: 'x', isSelection: 'yes' },
    { isSelection: true },
  ])('rejects invalid input %#', (raw) => {
    expect(parsePageContext(raw)).toEqual({ error: expect.any(String) })
  })
})

describe('buildPageContextAttachment', () => {
  it('builds a markdown attachment named after the page', () => {
    const att = buildPageContextAttachment({ content: '# Тело', isSelection: false }, 'Моя страница')
    expect(att).toMatchObject({
      id: 'page-context',
      name: 'Моя страница.md',
      mime: 'text/markdown',
      included: true,
      content: '# Тело',
    })
    expect(att.sizeBytes).toBeGreaterThan(0)
  })

  it('names selection context distinctly', () => {
    const att = buildPageContextAttachment({ content: 'кусок', isSelection: true }, 'Моя страница')
    expect(att.name).toBe('Выделенный фрагмент.md')
  })

  it('truncates over-cap content with a visible marker', () => {
    const att = buildPageContextAttachment(
      { content: 'A'.repeat(MAX_PAGE_CONTEXT_CHARS + 100), isSelection: false },
      'P',
    )
    expect(att.content!.length).toBeLessThanOrEqual(MAX_PAGE_CONTEXT_CHARS + 50)
    expect(att.content).toContain('…контент обрезан')
  })

  it('falls back to a generic name when the title is empty', () => {
    const att = buildPageContextAttachment({ content: 'x', isSelection: false }, '')
    expect(att.name).toBe('Страница.md')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web test -- page-context`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `apps/web/src/lib/chat/page-context.ts`:**

```ts
import type { ResolvedAttachment } from './file-content'

/** Hard cap on injected page/selection context (spec §6.3). */
export const MAX_PAGE_CONTEXT_CHARS = 200_000
export const PAGE_CONTEXT_ATTACHMENT_ID = 'page-context'
const TRUNCATION_MARKER = '\n\n…контент обрезан'

export type PageContextInput = {
  content: string
  isSelection: boolean
}

/** Validate the client-supplied pageContext. Returns null when absent,
 *  the parsed value, or `{error}` on malformed input. */
export function parsePageContext(
  raw: unknown,
): PageContextInput | null | { error: string } {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'pageContext must be an object' }
  }
  const v = raw as Record<string, unknown>
  if (typeof v.content !== 'string' || v.content.trim().length === 0) {
    return { error: 'pageContext.content must be a non-empty string' }
  }
  if (typeof v.isSelection !== 'boolean') {
    return { error: 'pageContext.isSelection must be a boolean' }
  }
  return { content: v.content, isSelection: v.isSelection }
}

/** Page/selection context → synthetic attachment riding the proven attachments
 *  channel (the agents `_attachments.j2` prompt-injection guard wraps it). */
export function buildPageContextAttachment(
  ctx: PageContextInput,
  pageTitle: string,
): ResolvedAttachment {
  let content = ctx.content
  if (content.length > MAX_PAGE_CONTEXT_CHARS) {
    content = content.slice(0, MAX_PAGE_CONTEXT_CHARS) + TRUNCATION_MARKER
  }
  const name = ctx.isSelection ? 'Выделенный фрагмент.md' : `${pageTitle.trim() || 'Страница'}.md`
  return {
    id: PAGE_CONTEXT_ATTACHMENT_ID,
    name,
    mime: 'text/markdown',
    sizeBytes: Buffer.byteLength(content, 'utf8'),
    included: true,
    content,
  }
}
```

Run: `pnpm --filter web test -- page-context` → PASS.

- [ ] **Step 4: Re-export the visibility predicate from @repo/trpc** (apps/web must not deep-import @repo/domain). In `packages/trpc/src/index.ts`, next to the existing `PlanFeatures`/`getWorkspaceFeatures` re-exports (~line 38-40), add:

```ts
export { buildPageVisibilityWhere } from '@repo/domain'
```

- [ ] **Step 5: Extend the generate route.** In `apps/web/src/lib/chat/types.ts`, extend `StartChatGenerationBody`:

```ts
export type StartChatGenerationBody = {
  chatId: string
  text: string
  fileIds: string[]
  useThinking?: boolean
  thinkingEffort?: 'LOW' | 'MEDIUM' | 'HIGH'
  /** PAGE chats only: client-serialized page markdown or the current selection (spec §6.3). */
  pageContext?: { content: string; isSelection: boolean }
}
```

In `apps/web/src/app/api/agents/generate/route.ts`:

(a) Imports:

```ts
import { buildPageVisibilityWhere, getWorkspaceFeatures } from '@repo/trpc'
import { buildPageContextAttachment, parsePageContext } from '@/lib/chat/page-context'
```

(check whether `getWorkspaceFeatures` is already imported; `@repo/trpc` is already a dependency).

(b) In `parseBody`, before the `return`:

```ts
  const pageContext = parsePageContext(body.pageContext)
  if (pageContext && 'error' in pageContext) throw new Error(pageContext.error)
```

and add to the returned object:

```ts
    ...(pageContext ? { pageContext } : {}),
```

(c) Extend the chat `select` (chat load, ~line 90) with `kind: true, pageId: true`.

(d) After the `if (!chat) return ... 404` guard, add the PAGE-chat gates:

```ts
  // PAGE chats: plan gate (server authority, spec §8.2) + context validation.
  let pageContextAttachment: ReturnType<typeof buildPageContextAttachment> | null = null
  if (chat.kind === 'PAGE') {
    const features = await getWorkspaceFeatures(chat.workspaceId)
    if (!features.chatsEnabled) {
      return NextResponse.json(
        { error: 'Чаты недоступны на вашем тарифе', code: 'PLAN' },
        { status: 403 },
      )
    }
  }
  if (body.pageContext) {
    if (chat.kind !== 'PAGE' || !chat.pageId) {
      return NextResponse.json(
        { error: 'pageContext is only allowed for page chats' },
        { status: 400 },
      )
    }
    const contextPage = await prisma.page.findFirst({
      where: {
        id: chat.pageId,
        deletedAt: null,
        AND: [buildPageVisibilityWhere(session.user.id)],
      },
      select: { id: true, title: true },
    })
    if (!contextPage) return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    pageContextAttachment = buildPageContextAttachment(body.pageContext, contextPage.title)
  }
```

(e) In the `buildAgentRunPayload` call, change the attachments arg:

```ts
    attachments: [
      ...(pageContextAttachment ? [pageContextAttachment] : []),
      ...resolvedAttachments,
    ],
```

- [ ] **Step 6: Verify**

Run: `pnpm --filter web test && pnpm --filter web exec tsc --noEmit && pnpm --filter @repo/trpc test -- page-chat`
Expected: PASS / clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/chat/page-context.ts apps/web/test/page-context.test.ts apps/web/src/lib/chat/types.ts apps/web/src/app/api/agents/generate/route.ts packages/trpc/src/index.ts
git commit -m "feat(web): inject page/selection context into page-chat generation"
```

## Phase E — page chats UI

### Task 14: @repo/ui — `Fab` export + composer context chip

**Files:**
- Modify: `packages/ui/src/components/index.ts`
- Modify: `packages/ui/src/components/chat/chat-thread.tsx`
- Modify: `packages/ui/src/components/chat/chat-composer.tsx`

- [ ] **Step 1: Fab export.** In `packages/ui/src/components/index.ts`, after the Drawer line (~26):

```ts
export { default as Fab, type FabProps } from '@mui/material/Fab'
```

- [ ] **Step 2: Context chip prop.** Exactly the `composerThinking` threading pattern:

`chat-thread.tsx` — add to `ChatThreadProps`:

```ts
  composerContextChip?: { label: string } | null
```

and pass it to `<ChatComposer …/>` as `contextChip={composerContextChip ?? null}`.

`chat-composer.tsx` — add to `ChatComposerProps`:

```ts
  contextChip?: { label: string } | null
```

Thread it into `ChatComposerInner` alongside `thinking`. In the chips row: extend the gate

```ts
const showChipsRow = showThinkingChip || contextChip != null || composer.attachments.length > 0
```

and render before the thinking chip:

```tsx
          {contextChip ? (
            <Chip
              color="info"
              data-testid="chat-context-chip"
              icon={<ArticleRoundedIcon fontSize="small" />}
              label={contextChip.label}
              size="small"
              variant="outlined"
            />
          ) : null}
```

with `import ArticleRoundedIcon from '@mui/icons-material/ArticleRounded'` (direct MUI imports are allowed inside packages/ui).

- [ ] **Step 3: Verify + commit**

Run: `pnpm --filter @repo/ui exec tsc --noEmit 2>/dev/null || pnpm check-types`
Expected: clean.

```bash
git add packages/ui/src/components/index.ts packages/ui/src/components/chat/chat-thread.tsx packages/ui/src/components/chat/chat-composer.tsx
git commit -m "feat(ui): Fab export and chat composer context chip"
```

### Task 15: `useChatStream` pageContext + `WorkspaceChatClient` page variant

**Files:**
- Modify: `apps/web/src/components/workspace/chat/use-chat-stream.ts`
- Modify: `apps/web/src/components/workspace/chat/workspace-chat-client.tsx`

- [ ] **Step 1: `use-chat-stream.ts`.** Extend `SendOptions`:

```ts
type SendOptions = {
  useThinking?: boolean
  thinkingEffort?: ThinkingEffort
  pageContext?: { content: string; isSelection: boolean }
}
```

In `send()`, destructure `pageContext` and add to the POST body:

```ts
            ...(pageContext ? { pageContext } : {}),
```

- [ ] **Step 2: `workspace-chat-client.tsx`.** Extend the props:

```ts
type WorkspaceChatClientProps = {
  chatId: string | null
  workspaceId: string
  initialMessages: ServerChatMessage[]
  /** Page-panel mode (spec §7): binds new chats to the page, suppresses URL
   *  navigation, injects page/selection context on every send. */
  variant?: 'workspace' | 'page'
  pageId?: string
  getPageContext?: () => { content: string; isSelection: boolean } | null
  onChatCreated?: (chatId: string) => void
  contextChipLabel?: string | null
}
```

Destructure with `variant = 'workspace'`. Changes, each mirroring an existing line:

(a) `ensureChat` — createChat with the page binding; page variant skips URL mutation and invalidates the page list instead:

```ts
      const created = await createChat.mutateAsync({
        workspaceId,
        ...(variant === 'page' && pageId ? { pageId } : {}),
        ...(settings?.useThinking !== undefined ? { useThinking: settings.useThinking } : {}),
        ...(settings?.thinkingEffort !== undefined
          ? { thinkingEffort: settings.thinkingEffort }
          : {}),
      })
      setActiveChatId(created.id)
      if (variant === 'page') {
        if (pageId) await utils.chat.listByPage.invalidate({ workspaceId, pageId })
        onChatCreated?.(created.id)
      } else {
        const href = buildChatHref(created.id)
        window.history.replaceState(null, '', href)
        await utils.chat.listChats.invalidate({ workspaceId })
      }
      return created.id
```

(b) `handleSend` — pass the context with each send:

```ts
    const started = await send({
      attachments: draftAttachments.uploadedAttachments,
      text,
      useThinking: thinking !== null,
      ...(thinking ? { thinkingEffort: thinking.effort } : {}),
      ...(variant === 'page' ? { pageContext: getPageContext?.() ?? undefined } : {}),
    })
```

(c) `handleStreamSettled` — invalidate the right list (`listByPage` for the page variant, `listChats` otherwise; keep the `getChat` invalidation in both).

(d) `ChatThread` render — internal scroll + chip in the panel, and drop the wide-centered layout:

```tsx
          scrollContainerSelector={variant === 'page' ? undefined : '.page-content-scroll'}
          composerContextChip={
            variant === 'page' ? { label: contextChipLabel ?? 'Контекст: Текущая страница' } : null
          }
```

and on the outer `Box` `sx`, make the width/height variant-aware:

```ts
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100%',
        ...(variant === 'page'
          ? { height: '100%', px: 1 }
          : { maxWidth: 960, mx: 'auto', px: { xs: 1.5, sm: 2.5 }, pt: 2 }),
      }}
```

(`ChatThread` without `scrollContainerSelector` scrolls internally — exactly the panel behavior, no new plumbing.)

- [ ] **Step 3: Verify + commit**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: clean. Existing `/chats` behavior unchanged (default variant).

```bash
git add apps/web/src/components/workspace/chat/use-chat-stream.ts apps/web/src/components/workspace/chat/workspace-chat-client.tsx
git commit -m "feat(web): page variant of the workspace chat client with context injection"
```

### Task 16: PageChatProvider + FAB + sidebar + layout mounts

**Files:**
- Create: `apps/web/src/components/page/page-chat/page-chat-context.tsx`
- Create: `apps/web/src/components/page/page-chat/page-chat-fab.tsx`
- Create: `apps/web/src/components/page/page-chat/page-chat-sidebar.tsx`
- Modify: `apps/web/src/components/workspace/workspace-layout-client.tsx`
- Modify: `apps/web/src/components/page/page-renderer.tsx` (outline offset)

- [ ] **Step 1: `page-chat-context.tsx`** (clone of the comments-context shape incl. the render-time reset pattern):

```tsx
'use client'

import type { PageType } from '@repo/db'
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export const PAGE_CHAT_SIDEBAR_WIDTH = 400

type PageChatContextValue = {
  enabled: boolean
  panelOpen: boolean
  togglePanel: () => void
  closePanel: () => void
  activeChatId: string | null
  setActiveChatId: (id: string | null) => void
}

const PageChatContext = createContext<PageChatContextValue | null>(null)

/** Non-throwing — the FAB/sidebar also render on surfaces without the provider
 *  (PageView, non-page routes) and must simply disappear there. */
export function usePageChatContext(): PageChatContextValue | null {
  return useContext(PageChatContext)
}

export function PageChatProvider({
  pageId,
  pageType,
  children,
}: {
  pageId: string
  pageType: PageType | undefined
  children: ReactNode
}) {
  const enabled = pageType === 'TEXT'
  const [panelOpen, setPanelOpen] = useState(false)
  const [activeChatId, setActiveChatId] = useState<string | null>(null)

  // Reset transient chat UI when navigating to a different page WITHOUT
  // remounting the provider (the comments-context render-time pattern).
  const [prevPageId, setPrevPageId] = useState(pageId)
  if (pageId !== prevPageId) {
    setPrevPageId(pageId)
    setPanelOpen(false)
    setActiveChatId(null)
  }

  const togglePanel = useCallback(() => setPanelOpen((v) => !v), [])
  const closePanel = useCallback(() => setPanelOpen(false), [])

  const value = useMemo(
    () => ({ enabled, panelOpen, togglePanel, closePanel, activeChatId, setActiveChatId }),
    [enabled, panelOpen, togglePanel, closePanel, activeChatId],
  )

  return <PageChatContext.Provider value={value}>{children}</PageChatContext.Provider>
}
```

(If `PageType` is not exported from `@repo/db`, import it the way `comments-context.tsx` does.)

- [ ] **Step 2: `page-chat-fab.tsx`:**

```tsx
'use client'

import ForumRoundedIcon from '@mui/icons-material/ForumRounded'
import { Fab, Tooltip } from '@repo/ui/components'

import { usePageCommentsContext } from '@/components/page/comments/comments-context'
import { COMMENTS_SIDEBAR_WIDTH } from '@/components/page/comments/comments-sidebar'
import { usePlanFeaturesOptional } from '@/components/workspace/plan-features-context'

import { PAGE_CHAT_SIDEBAR_WIDTH, usePageChatContext } from './page-chat-context'

/** Circular bottom-right entry point (Notion's agent-face placement, spec §7).
 *  Visible on EVERY plan — the paywall lives in the panel + server (spec §8.2). */
export function PageChatFab() {
  const chat = usePageChatContext()
  const features = usePlanFeaturesOptional()
  const { panelOpen: commentsOpen } = usePageCommentsContext()

  if (!chat?.enabled || !features) return null

  const rightOffset =
    (commentsOpen ? COMMENTS_SIDEBAR_WIDTH : 0) + (chat.panelOpen ? PAGE_CHAT_SIDEBAR_WIDTH : 0)

  return (
    <Tooltip title="Чат по странице">
      <Fab
        color="primary"
        size="medium"
        onClick={chat.togglePanel}
        data-testid="page-chat-fab"
        sx={{
          position: 'fixed',
          bottom: 24,
          right: 24 + rightOffset,
          zIndex: (theme) => theme.zIndex.appBar,
          transition: 'right 0.15s ease',
        }}
      >
        <ForumRoundedIcon />
      </Fab>
    </Tooltip>
  )
}
```

(Check that `Tooltip` is exported from `@repo/ui/components`; if not, add its re-export like Fab's. If apps/web convention imports icons differently, match it — grep `@mui/icons-material` in apps/web/src for the established style.)

- [ ] **Step 3: `page-chat-sidebar.tsx`:**

```tsx
'use client'

import AddRoundedIcon from '@mui/icons-material/AddRounded'
import CloseIcon from '@mui/icons-material/Close'
import {
  Box,
  Button,
  IconButton,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@repo/ui/components'
import { useCallback, useEffect, useState } from 'react'

import { usePageEditor } from '@/components/page/editor-context'
import { usePlanFeaturesOptional } from '@/components/workspace/plan-features-context'
import { WorkspaceChatClient } from '@/components/workspace/chat/workspace-chat-client'
import { trpc } from '@/trpc/client'
import { htmlToMarkdown } from '@repo/editor/lib/html-to-markdown'

import { PAGE_CHAT_SIDEBAR_WIDTH, usePageChatContext } from './page-chat-context'

type Props = {
  workspaceId: string
  pageId: string
}

export function PageChatSidebar({ workspaceId, pageId }: Props) {
  const ctx = usePageChatContext()
  const features = usePlanFeaturesOptional()
  const { getEditor, hasEditor } = usePageEditor()
  const [hasSelection, setHasSelection] = useState(false)

  const chatsEnabled = features?.chatsEnabled ?? false
  const open = Boolean(ctx?.enabled && ctx.panelOpen)

  const list = trpc.chat.listByPage.useQuery(
    { workspaceId, pageId },
    { enabled: open && chatsEnabled },
  )
  const activeChatId = ctx?.activeChatId ?? null
  const chatQuery = trpc.chat.getChat.useQuery(
    { chatId: activeChatId ?? '' },
    { enabled: open && chatsEnabled && activeChatId != null },
  )

  // Live selection → context chip (Notion: selection narrows the context).
  useEffect(() => {
    if (!open) return
    const editor = getEditor()
    if (!editor) return
    const update = () => setHasSelection(!editor.state.selection.empty)
    update()
    editor.on('selectionUpdate', update)
    return () => {
      editor.off('selectionUpdate', update)
    }
  }, [open, hasEditor, getEditor])

  const getPageContext = useCallback((): { content: string; isSelection: boolean } | null => {
    const editor = getEditor()
    if (!editor) return null
    const { from, to, empty } = editor.state.selection
    if (!empty) {
      return { content: editor.state.doc.textBetween(from, to, '\n'), isSelection: true }
    }
    return { content: htmlToMarkdown(editor.getHTML()), isSelection: false }
  }, [getEditor])

  if (!ctx || !open) return null

  return (
    <Box
      className="page-chat-sidebar"
      data-testid="page-chat-sidebar"
      sx={{
        width: PAGE_CHAT_SIDEBAR_WIDTH,
        flexShrink: 0,
        position: 'relative',
        zIndex: 10,
        bgcolor: 'background.default',
        borderLeft: 1,
        borderColor: 'divider',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{ p: 1.5, pb: 1, flexShrink: 0 }}
      >
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          Чат по странице
        </Typography>
        {chatsEnabled ? (
          <>
            {(list.data?.length ?? 0) > 0 ? (
              <Select
                size="small"
                value={activeChatId ?? 'new'}
                onChange={(e) => {
                  const v = e.target.value as string
                  ctx.setActiveChatId(v === 'new' ? null : v)
                }}
                sx={{ maxWidth: 160 }}
                data-testid="page-chat-switcher"
              >
                <MenuItem value="new">Новый чат</MenuItem>
                {(list.data ?? []).map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.title}
                  </MenuItem>
                ))}
              </Select>
            ) : null}
            <IconButton
              size="small"
              aria-label="Новый чат"
              onClick={() => ctx.setActiveChatId(null)}
              data-testid="page-chat-new"
            >
              <AddRoundedIcon fontSize="small" />
            </IconButton>
          </>
        ) : null}
        <IconButton size="small" aria-label="Закрыть чат" onClick={ctx.closePanel}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>

      {chatsEnabled ? (
        <Box sx={{ flex: 1, minHeight: 0 }}>
          <WorkspaceChatClient
            key={activeChatId ?? 'new'}
            chatId={activeChatId}
            workspaceId={workspaceId}
            initialMessages={activeChatId ? (chatQuery.data?.messages ?? []) : []}
            variant="page"
            pageId={pageId}
            getPageContext={getPageContext}
            onChatCreated={(id) => ctx.setActiveChatId(id)}
            contextChipLabel={hasSelection ? 'Контекст: Выделение' : 'Контекст: Текущая страница'}
          />
        </Box>
      ) : (
        <Stack spacing={1.5} sx={{ p: 2 }} data-testid="page-chat-upsell">
          <Typography variant="body2">
            Чат с AI по странице доступен на тарифе ПРО и выше.
          </Typography>
          <Button variant="contained" size="small" href="/pricing">
            Перейти на тариф
          </Button>
        </Stack>
      )}
    </Box>
  )
}
```

Notes:
- `key={activeChatId ?? 'new'}` remounts the chat client on thread switch — its internal state (draft, thinking) is per-thread.
- `initialMessages` for an existing chat come from `getChat`; while loading, the empty array renders and `replaceFromServer` inside the client reconciles (mirror how `chats/[chatId]/page.tsx` passes server messages — if the client does not auto-reconcile from `initialMessages` prop changes, gate the render on `chatQuery.isSuccess` for non-null `activeChatId`).
- Check `Select`/`MenuItem` are exported from `@repo/ui/components`; add re-exports if missing.
- Rename/delete of threads is available via the existing chat actions; v1 keeps the switcher minimal (spec header UX satisfied by Select + new + close).

- [ ] **Step 4: Layout mounts.** In `apps/web/src/components/workspace/workspace-layout-client.tsx`:

(a) Imports:

```ts
import { PageChatProvider } from '@/components/page/page-chat/page-chat-context'
import { PageChatFab } from '@/components/page/page-chat/page-chat-fab'
import { PageChatSidebar } from '@/components/page/page-chat/page-chat-sidebar'
```

(b) In `mainContent`, after `{activePageId ? <HistorySidebar /> : null}` (~line 272):

```tsx
      {activePageId ? <PageChatSidebar workspaceId={workspace.id} pageId={activePageId} /> : null}
      {activePageId ? <PageChatFab /> : null}
```

(c) In `pageMain`, wrap `<PageEditorProvider>{mainContent}</PageEditorProvider>` with the provider:

```tsx
        <PageChatProvider pageId={activePageId ?? ''} pageType={activePageType}>
          <PageEditorProvider>{mainContent}</PageEditorProvider>
        </PageChatProvider>
```

WAIT — `mainContent` references `PageChatSidebar`/`PageChatFab`, which need the provider; the provider must wrap `mainContent`. The structure above does exactly that (provider → PageEditorProvider → mainContent). The sidebar also needs `usePageEditor` — `PageEditorProvider` wraps `mainContent` too, so both contexts are available inside. ✔

(d) `PageView`-embedded surfaces (template editor) have no provider — the FAB/sidebar hooks return null there by design (non-throwing context hook).

- [ ] **Step 5: Outline offset.** In `apps/web/src/components/page/page-renderer.tsx` (~line 731):

```tsx
        <EditorOutline
          editor={editor}
          rightOffset={
            (panelOpen ? COMMENTS_SIDEBAR_WIDTH : 0) +
            (pageChat?.panelOpen ? PAGE_CHAT_SIDEBAR_WIDTH : 0)
          }
        />
```

with, near the other context hooks (~line 175):

```ts
const pageChat = usePageChatContext()
```

and imports:

```ts
import { PAGE_CHAT_SIDEBAR_WIDTH, usePageChatContext } from './page-chat/page-chat-context'
```

- [ ] **Step 6: Verify**

Run: `pnpm --filter web exec tsc --noEmit && pnpm --filter web lint`
Expected: clean. Then live smoke (`pnpm dev`): open a TEXT page → FAB bottom-right; click → 400px panel; on the free plan the panel shows the upsell; on ПРО+ «Новый чат» works and the context chip flips to «Контекст: Выделение» while text is selected.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/page/page-chat apps/web/src/components/workspace/workspace-layout-client.tsx apps/web/src/components/page/page-renderer.tsx
git commit -m "feat(web): page chat panel with FAB, thread switcher and context chip"
```

### Task 17: E2E — page-chat.spec.ts

**Files:**
- Create: `apps/e2e/page-chat.spec.ts`

Fixture: same Prisma-driven setup as `space-ai.spec.ts` / `inline-ai.spec.ts`, but the plan must have `chatsEnabled: true` → `prisma.plan.findFirst({ where: { chatsEnabled: true } })` (pro). A second describe uses the default personal plan for the paywall.

- [ ] **Step 1: Write the spec:**

```ts
import { expect, test, type Page } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

// setupChatPage(page, { plan: 'pro' | 'personal' }) — copy the inline-ai.spec.ts fixture:
// signUpAndAuthAs → prisma user lookup → (pro only) expire subs + subscribe to the
// chatsEnabled plan → create workspace + OWNER member + userPreference.activeWorkspaceId
// → prisma.page.create({ type: 'TEXT', title: 'Чат-страница' }) → page.goto(`/pages/${id}`).
// Returns { pageId, chatTitleProbe: `пробное сообщение ${Date.now()}` }.

test('FAB открывает панель, новый чат создаётся и не попадает в общий список', async ({ page }) => {
  const { chatTitleProbe } = await setupChatPage(page, { plan: 'pro' })

  // Мокаем генерацию: реального LLM в E2E нет; достаточно валидного SSE-завершения.
  // (Клиент рисует оптимистичное сообщение пользователя сам.)
  await page.route('**/api/agents/generate', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'cache-control': 'no-cache' },
      body: 'data: {"type":"done"}\n\n',
    }),
  )

  const fab = page.getByTestId('page-chat-fab')
  await expect(fab).toBeVisible({ timeout: 15_000 })
  await fab.click()

  const panel = page.getByTestId('page-chat-sidebar')
  await expect(panel).toBeVisible()

  // Отправляем сообщение — чат создастся лениво (ensureChat с pageId).
  const composer = panel.getByRole('textbox')
  await composer.fill(chatTitleProbe)
  await composer.press('Enter')

  // Оптимистичное сообщение пользователя видно в треде.
  await expect(panel).toContainText(chatTitleProbe, { timeout: 15_000 })

  // Контекст-чип показывает контекст страницы.
  await expect(page.getByTestId('chat-context-chip')).toContainText('Текущая страница')

  // Чат существует в списке страницы...
  await expect(page.getByTestId('page-chat-switcher')).toBeVisible({ timeout: 15_000 })

  // ...но НЕ в общем списке /chats (auto-rename назвал его по первому сообщению).
  await page.goto('/chats')
  await expect(page.locator('body')).not.toContainText(chatTitleProbe.slice(0, 20))
})

test('панель показывает апселл на тарифе без чатов, FAB виден', async ({ page }) => {
  await setupChatPage(page, { plan: 'personal' })

  const fab = page.getByTestId('page-chat-fab')
  await expect(fab).toBeVisible({ timeout: 15_000 })
  await fab.click()

  const upsell = page.getByTestId('page-chat-upsell')
  await expect(upsell).toBeVisible()
  await expect(upsell).toContainText('на тарифе ПРО и выше')
  await expect(upsell.getByRole('link', { name: 'Перейти на тариф' })).toHaveAttribute(
    'href',
    '/pricing',
  )
})
```

Implementation notes for the spec author:
- If the mocked `data: {"type":"done"}` frame leaves the client in a visible error state (the web route emits `message.*` events, not raw agents events — check `apps/web/src/lib/chat/agent-sse-bridge.ts` / the stream registry for the exact initial frames), replace the mock body with the two initial events the real route sends (`message.created` + `message.status`) followed by a done/status event, copying the exact JSON shapes from `createEntryResponse`/`active-stream-registry.ts`. The assertion set stays the same — the optimistic user message and the chip do not depend on the stream contents.
- The upsell button renders as an anchor because of `href` — if MUI renders `role="link"` differently, assert via `upsell.locator('a[href="/pricing"]')`.

- [ ] **Step 2: Run**

Run: `pnpm exec playwright test apps/e2e/page-chat.spec.ts --retries=1`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/page-chat.spec.ts
git commit -m "test(e2e): page chat panel, context chip and plan paywall"
```

## Phase F — merge gate

### Task 18: Full gates + stale-test sweep

- [ ] **Step 1:** `pnpm gates` (check-types + lint + build + test + check-architecture). Known likely fallout to fix, not silence:
  - `apps/web/test/ai-inline-handler.test.ts` — any pre-existing test asserting a 400 for a now-valid action shape.
  - Mocked-tRPC unit tests (`chat-router.test.ts`) — `createChat`'s new input key is optional, so existing calls stay valid; if a fake prisma object lacks `page.findFirst`, add it to the mock.
  - `pnpm check-architecture` — the new `@repo/domain` re-export from `@repo/trpc` and `@repo/editor/lib/html-to-markdown` deep import from apps/web must respect the layering rules (both patterns already exist in the graph; if the checker flags the new edge, mirror how the existing `htmlToMarkdown` consumer in `apps/web/src/server/page-export/html-to-markdown.ts` is whitelisted).
- [ ] **Step 2:** Full Playwright suite for the touched specs: `pnpm exec playwright test apps/e2e/inline-ai.spec.ts apps/e2e/space-ai.spec.ts apps/e2e/page-chat.spec.ts --retries=1`.
- [ ] **Step 3:** Verify the live app end-to-end once (`pnpm dev` + docker): Space-draft → refine → Вставить on a real page; selection → custom instruction → Вставить ниже; FAB chat with a configured provider if one is available in the workspace settings.
- [ ] **Step 4: Commit any fixes**

```bash
git add <specific fixed paths>
git commit -m "test: align stale expectations with generate/custom actions and page chats"
```

---

## Self-review notes (spec coverage)

| Spec section | Task(s) |
| --- | --- |
| §2 Space trigger + Shift+Space + placeholder | 7, 8 |
| §3.1–3.6 bar/draft/dismissal/injection | 7, 8, 9, 10 |
| §4 generate/custom backend + caps + history | 1, 2, 3 |
| §5 popover input, Вставить ниже, follow-up | 4, 5, 6 |
| §6.1 Prisma + purge | 11 |
| §6.2 tRPC | 12 |
| §6.3–6.4 pageContext + auto-title | 13 (auto-title: existing route behavior, asserted implicitly in Task 17) |
| §7 FAB/panel/chip/offset | 14, 15, 16 |
| §8 invariants | server gates in 2, 12, 13; client copy in 3, 16 |
| §9 testing | 1, 2, 4, 6, 10, 12, 13, 17, 18 |
| §10 limitations | encoded as-is (no extra work) |

Known intentional deviation from spec §8.2: the «Перейти на тариф» /pricing link renders only in the page-chat panel (apps/web-owned); the Space bar and selection popover show the plan-upsell TEXT without a link — `AskAIHandle.onError` is string-only and the editor package stays route-agnostic. Documented here; revisit if product wants the link inside the editor surfaces.


