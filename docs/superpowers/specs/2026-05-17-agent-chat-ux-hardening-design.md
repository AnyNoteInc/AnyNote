# Agent chat UX hardening — design

Date: 2026-05-17
Status: approved (brainstorm)

Three small, mostly-independent fixes uncovered while smoke-testing the
Plan-Execute-Critic graph against GigaChat-2 Pro:

1. Service blocks (plan steps, tool calls, confirmations) ellipsize their title
   on a single line and force the row to grow wider than the message bubble.
2. When the executor pauses on a destructive tool (`anynote__createPage`,
   etc.) the chat shows a "warning" Alert that reads "Action required" — but
   there is **no button** to allow or deny. The only way to resume today is to
   hand-`fetch('/api/agent/resume', …)` from the devtools console.
3. The planner only picks an MCP tool when the user names it literally
   ("Используй инструмент anynote__getWorkspaceStats …"). Tool descriptions
   are so terse ("Workspace members, pages-by-type, total pages") that the
   planner can't link a natural-language request to a tool.

## Non-goals

- No changes to the agent graph itself (router / planner / executor / critic /
  memory_writer remain as-is).
- No new SSE event types — the existing `confirmation_required` /
  `plan_step` / `token` / `done` / `error` taxonomy is enough.
- No changes to `/api/agent/resume` route or backend authentication.
- No prompt-template edits for planner/executor/critic — only **tool**
  descriptions change.

## 1. Service-block wrapping

File: [packages/ui/src/components/chat/chat-service-block.tsx](../../packages/ui/src/components/chat/chat-service-block.tsx)

Today the inner row is:

```tsx
<Box display="flex" flexWrap="nowrap" gap={1} minWidth={0}>
  <Typography component="span" noWrap variant="body2">{part.title}</Typography>
  <Typography …>{' • '}</Typography>
  <Typography …>{getStateLabel(part.state)}</Typography>
  …
</Box>
```

`noWrap` on the title plus `flexWrap="nowrap"` on the row make the title
ellipsize and the row stretch outside the message bubble.

Replace with:

- `flexWrap="wrap"`, `rowGap: 0.25` on the row
- drop `noWrap` from the title `Typography`
- add `sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}` on the title
  so embedded `\n` render and long unbroken slugs (Cyrillic keys, URLs)
  still break.

Pure CSS; no API change.

## 2. Inline confirmation action

Same component. Add a branch when `part.kind === 'confirmation'` and
`part.state === 'required'`:

```
┌─ 🟡 Создать страницу «Smoke #2» ──────────────────┐
│ ▸ tool: anynote__createPage  ·  Подробнее ▾       │
│                                                   │
│ [ ✓ Разрешить ]   [ ✗ Отклонить ]                 │
└───────────────────────────────────────────────────┘
```

- Severity stays `warning` (current behaviour).
- "Подробнее" toggles a `<Box component="pre">` with the parsed
  `detail.args_preview` JSON (current `detail` field already carries
  `{"confirmation_id": "…", "tool": "…"}` — we just need to also propagate
  `args_preview` from the backend).
- Backend change in [apps/agents/agents/apps/agent/use_cases/\_streaming.py](../../apps/agents/agents/apps/agent/use_cases/_streaming.py)
  and [apps/web/src/app/api/agents/generate/route.ts](../../apps/web/src/app/api/agents/generate/route.ts):
  include the full Interrupt value (`confirmation_id`, `tool`, `summary`,
  `args_preview`) in the `ServiceBlock.detail` JSON string. Today only
  `confirmation_id` + `tool` are included.
- Click "Разрешить" / "Отклонить":
  - optimistic local update: state → `running` for allow, `done` for deny
  - call new prop `onConfirm(confirmationId, action)` exposed by
    [packages/ui/src/components/chat/chat-provider-utils.tsx](../../packages/ui/src/components/chat/chat-provider-utils.tsx)
    via the existing `chatPartRenderers.tool` slot
  - chat client (`use-chat-stream`) implements `confirmResume(confirmationId, action)`:
    - POSTs to `/api/agent/resume` with `{chatId, confirmationId, action}`
    - re-opens the existing assistant message (`isStreaming=true`,
      `activeAssistantMessageIdRef.current` kept) and pipes the SSE response
      through the **same** `decodeWebSseEvents` + state-merge functions as
      the original run stream. The assistant continues talking inside the
      same article — no new message bubble.
- Edge cases:
  - **deny** → confirmation block stays as state=`done` with caption
    "Отклонено пользователем" (rendered in `ChatServiceBlock` from the
    optimistic state); backend sends no more events after the executor
    short-circuits.
  - **stale confirmation** (user already clicked, or interrupt expired) →
    backend returns `CONFIRMATION_MISMATCH` error event; the stream-merge
    flips the block back to state=`error` with `result` text from the
    error message. No new message bubble.
  - **navigation during interrupt** → user leaves the chat and returns;
    the persisted `chatMessage` (DB) already has the `confirmation` block
    with state=`required`. The block re-renders, buttons re-attach, click
    flows identically to the live case. No SSE replay needed.

### Wiring touchpoints (read-only summary, file paths only)

- [packages/ui/src/components/chat/chat-service-block.tsx](../../packages/ui/src/components/chat/chat-service-block.tsx) — UI change, new props
- [packages/ui/src/components/chat/chat-provider-utils.tsx](../../packages/ui/src/components/chat/chat-provider-utils.tsx) — pass `onConfirm` through `chatPartRenderers.tool`
- [packages/ui/src/components/chat/chat-types.ts](../../packages/ui/src/components/chat/chat-types.ts) — extend `ChatToolPart.detail` shape doc (still a string; just enriched)
- [apps/web/src/components/workspace/chat/use-chat-stream.ts](../../apps/web/src/components/workspace/chat/use-chat-stream.ts) — add `confirmResume(confirmationId, action)` returned from the hook
- [apps/web/src/components/workspace/chat/workspace-chat-client.tsx](../../apps/web/src/components/workspace/chat/workspace-chat-client.tsx) — thread `confirmResume` into the renderer context
- [apps/web/src/app/api/agents/generate/route.ts](../../apps/web/src/app/api/agents/generate/route.ts) — write full Interrupt payload into `ServiceBlock.detail`
- [apps/agents/agents/apps/agent/use_cases/\_streaming.py](../../apps/agents/agents/apps/agent/use_cases/_streaming.py) — already emits the full Interrupt payload, no change

## 3. Intent-first tool descriptions

Rewrite every MCP tool description in [apps/engines/src/apps/mcp/tools/](../../apps/engines/src/apps/mcp/tools/)
and every internal tool description in
[apps/agents/agents/apps/agent/services/internal\_tools.py](../../apps/agents/agents/apps/agent/services/internal_tools.py)
following this template (Russian, 2-3 sentences):

```
<one-sentence "что делает">. <"когда вызывать" с триггерными формулировками>.
<"что возвращает"/"что меняет">.
```

Also tighten Zod schemas — every parameter gets `.describe('…')` so the planner
sees what each argument means. For Python `StructuredTool` (internal tools)
the same applies via the pydantic `Field(..., description='…')` form.

### Tool inventory (14 total)

**Engines MCP — workspace.tools.ts (4)**
- `getWorkspaceStats` — счётчики страниц по типам, число членов
- `listWorkspaceFiles` — список файлов в воркспейсе
- `listSkills` — навыки (ownership=SKILL)
- `listAgentPages` — agent-страницы (ownership=AGENT)

**Engines MCP — page.tools.ts (5)**
- `createPage` — создать страницу (destructive → confirmation)
- `updatePage` — поменять title/icon/content (destructive → confirmation)
- `movePage` — перенести/переупорядочить (destructive → confirmation)
- `renderPageMarkdown` — отрендерить содержимое в markdown
- `getPageMetadata` — автор, дата, тип, ownership

**Engines MCP — search.tools.ts (2)**
- semantic search
- lexical search

**Internal — internal\_tools.py (3)**
- `save_memory` — сохранить долгосрочный факт
- `recall_memory` — найти ранее сохранённый факт
- `search_pages` — semantic RAG по страницам

### Example transformation (workspace.tools.ts)

```diff
- description: 'Workspace members, pages-by-type, total pages',
+ description:
+   'Возвращает счётчики и состав рабочего пространства: число страниц по ' +
+   'типам (TEXT/KANBAN/EXCALIDRAW), общее число страниц и список участников. ' +
+   'Вызывай когда пользователь спрашивает "сколько страниц", "сколько ' +
+   'заметок", "кто в команде", "статистика воркспейса" или просит общий ' +
+   'обзор. Без параметров.',
```

## Testing

### 1. Wrapping
Manual Playwright re-run of Scenario 1 (workspace stats); assert plan-step
block visually wraps inside the bubble (no horizontal scroll, no ellipsis).

### 2. Confirmation
Re-run Scenario 2 (createPage) via Playwright but **click** the
"Разрешить" button instead of POSTing to `/api/agent/resume` directly. Verify:
- block transitions to `running` then `done`
- assistant continues streaming inside the same message bubble
- page row appears in `pages` table

Add unit test for `ChatServiceBlock` confirmation branch (button render +
onConfirm dispatch).

### 3. Tool descriptions
Re-run all three smoke scenarios with **no** "Используй инструмент …"
prefix:

- «Сколько страниц в этом воркспейсе?» → must call `anynote__getWorkspaceStats`
- «Создай страницу "Smoke без префикса"» → must call `anynote__createPage`
  (confirmation flow)
- «Запомни на будущее: команда любит чай» → must call
  `save_memory(scope=workspace)`

Acceptance: all three runs succeed and the planner emits the expected tool
call without asking for clarification. If any picks the wrong tool, that
description gets another pass.

## Build sequence

1. **CSS-only**: chat-service-block wrapping → manual visual check
2. **Confirm UX**: chat-service-block buttons + use-chat-stream resume + web
   route enriches `detail` → Playwright Scenario 2 (click "Разрешить")
3. **Tool description sweep**: 4 files (3 .ts + 1 .py) → Playwright re-run
   of all 3 smoke prompts without explicit tool naming.

Each step is independently shippable; failures in step 3 don't block 1-2.
