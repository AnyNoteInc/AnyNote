# Agent chat UX hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make three small, post-smoke-test improvements to the agent chat — wrap long block titles inside the message bubble, add inline Allow/Deny buttons for tool-confirmation interrupts, and rewrite tool descriptions so the planner picks the right MCP/internal tool from natural-language prompts.

**Architecture:** Pure UI + content changes — no graph/router/critic/checkpointer changes. Tasks layer in: (A) CSS-only wrap fix, (B) confirmation-button wiring that pipes `/api/agent/resume` SSE back into the same assistant message via a new `useChatStream.confirmResume(...)` method, (C) intent-first rewrite of 11 engines MCP descriptions + 3 Python internal tool descriptions. Backend already emits `args_preview` in the `confirmation_required` event — only the web translator drops it.

**Tech Stack:** React 19 + Next.js 16 (apps/web), MUI v6 + `@mui/x-chat-headless` (packages/ui), NestJS 11 + `@rekog/mcp-nest` (apps/engines), FastAPI 0.x + LangGraph 1.1.x + LangChain (apps/agents). Vitest for `packages/ui`, Jest for `apps/engines`, Pytest for `apps/agents`, Playwright MCP for browser E2E.

---

## File map

**Modify:**
- [packages/ui/src/components/chat/chat-service-block.tsx](../../packages/ui/src/components/chat/chat-service-block.tsx) — wrap CSS + confirmation branch with allow/deny + collapsible args preview
- [packages/ui/src/components/chat/chat-provider-utils.tsx](../../packages/ui/src/components/chat/chat-provider-utils.tsx) — replace const `chatPartRenderers` with builder accepting `onConfirm`
- [packages/ui/src/components/chat/chat-message-list.tsx](../../packages/ui/src/components/chat/chat-message-list.tsx) — accept `onConfirm` prop, build renderers via useMemo
- [packages/ui/src/components/chat/chat-thread.tsx](../../packages/ui/src/components/chat/chat-thread.tsx) — thread `onConfirm` prop through
- [packages/ui/src/components/chat/index.ts](../../packages/ui/src/components/chat/index.ts) — export `ChatConfirmHandler` type (if not already)
- [apps/web/src/components/workspace/chat/use-chat-stream.ts](../../apps/web/src/components/workspace/chat/use-chat-stream.ts) — new `confirmResume(confirmationId, action)` that POSTs and pipes SSE into the same assistant message
- [apps/web/src/components/workspace/chat/workspace-chat-client.tsx](../../apps/web/src/components/workspace/chat/workspace-chat-client.tsx) — wire `confirmResume` into `<ChatThread onConfirm={…}>`
- [apps/web/src/app/api/agents/generate/route.ts](../../apps/web/src/app/api/agents/generate/route.ts) — include full Interrupt payload in `ServiceBlock.detail`
- [apps/engines/src/apps/mcp/tools/workspace.tools.ts](../../apps/engines/src/apps/mcp/tools/workspace.tools.ts) — intent-first descriptions (4 tools)
- [apps/engines/src/apps/mcp/tools/page.tools.ts](../../apps/engines/src/apps/mcp/tools/page.tools.ts) — intent-first descriptions (5 tools)
- [apps/engines/src/apps/mcp/tools/search.tools.ts](../../apps/engines/src/apps/mcp/tools/search.tools.ts) — intent-first descriptions (2 tools)
- [apps/agents/agents/apps/agent/services/internal_tools.py](../../apps/agents/agents/apps/agent/services/internal_tools.py) — intent-first descriptions (3 tools) + `Field(..., description='…')` on params

**Create:**
- `packages/ui/test/chat-service-block.test.tsx` — Vitest unit suite for the component (wrap, allow/deny, collapsible args)

**Touch (tests only):**
- [apps/engines/src/apps/mcp/tools/workspace.tools.spec.ts](../../apps/engines/src/apps/mcp/tools/workspace.tools.spec.ts) — already exists, add an assertion that descriptions contain key trigger phrases
- [apps/agents/tests/apps/agent/test_internal_tools.py](../../apps/agents/tests/apps/agent/test_internal_tools.py) — add an assertion that `save_memory` description contains "запомни"

---

## Phase A — CSS-only wrap fix

### Task 1: Wrap block title inside the message bubble

**Files:**
- Modify: `packages/ui/src/components/chat/chat-service-block.tsx`
- Create: `packages/ui/test/chat-service-block.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/ui/test/chat-service-block.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ChatServiceBlock } from '../src/components/chat/chat-service-block'
import type { ChatToolPart } from '../src/components/chat/chat-types'

function part(overrides: Partial<ChatToolPart> = {}): ChatToolPart {
  return {
    type: 'tool',
    id: 'b1',
    kind: 'tool',
    state: 'pending',
    title: 'Очень длинный заголовок плана, который не должен схлопываться в одну строку',
    ...overrides,
  }
}

describe('ChatServiceBlock — wrapping', () => {
  it('does not apply MUI noWrap modifier on the title', () => {
    render(<ChatServiceBlock part={part()} />)
    const title = screen.getByText(/Очень длинный заголовок/)
    expect(title.className).not.toMatch(/noWrap/i)
  })

  it('lets the summary row wrap onto multiple lines', () => {
    render(<ChatServiceBlock part={part()} />)
    const row = screen.getByTestId('chat-service-block-summary')
    expect(row.style.flexWrap).not.toBe('nowrap')
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
pnpm --filter @repo/ui test -- chat-service-block
```

Expected: both `it(...)` cases fail (title currently has `MuiTypography-noWrap`, row has `flex-wrap: nowrap`).

- [ ] **Step 3: Apply the CSS change**

In `packages/ui/src/components/chat/chat-service-block.tsx` replace the inner `<Box>` + `<Typography>` block (currently lines 47-63) with:

```tsx
<Box
  alignItems="center"
  data-testid="chat-service-block-summary"
  display="flex"
  flexWrap="wrap"
  gap={1}
  minWidth={0}
  rowGap={0.25}
>
  <Typography
    component="span"
    sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
    variant="body2"
  >
    {part.title}
  </Typography>
  <Typography color="text.secondary" component="span" variant="body2">
    {' • '}
  </Typography>
  <Typography color="text.secondary" component="span" variant="body2">
    {getStateLabel(part.state)}
  </Typography>
  {part.result ? (
    <Typography color="text.secondary" component="span" variant="body2">
      {' • '}
    </Typography>
  ) : null}
  {part.result ? (
    <Button onClick={() => setResultOpen(true)} size="small" variant="outlined">
      Результат
    </Button>
  ) : null}
</Box>
```

(Removed: `flexWrap="nowrap"` → `flexWrap="wrap"` + `rowGap={0.25}`; removed `noWrap` from title and added `sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}`.)

- [ ] **Step 4: Re-run the test and confirm it passes**

```bash
pnpm --filter @repo/ui test -- chat-service-block
```

Expected: both `wrapping` cases PASS. The existing `chat-message-content` test still asserts `toolSummary.textContent === 'Поиск по базе • Done • Результат'` — wrapping does not change textContent, so it should still pass.

- [ ] **Step 5: Run the full UI test suite to be sure we didn't break neighbours**

```bash
pnpm --filter @repo/ui test
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/chat/chat-service-block.tsx packages/ui/test/chat-service-block.test.tsx
git commit -m "$(cat <<'EOF'
fix(ui): wrap chat-service-block titles inside the message bubble

The plan-step / tool / confirmation Alert used noWrap + flex-wrap: nowrap,
forcing long Cyrillic titles to ellipsize and the row to grow wider than
the bubble. Drop noWrap, allow flex wrap with rowGap=0.25, and add
whiteSpace: pre-wrap + wordBreak: break-word so embedded newlines render
and long unbroken slugs (Cyrillic keys, URLs) still break.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase B — Confirmation buttons

### Task 2: Carry full Interrupt payload through to the UI block detail

**Files:**
- Modify: `apps/web/src/app/api/agents/generate/route.ts:251-262`

- [ ] **Step 1: Replace the truncated detail JSON**

At line 258 (inside `if (event.type === 'confirmation_required') { … }`) replace:

```ts
detail: JSON.stringify({ confirmation_id: event.confirmation_id, tool: event.tool }),
```

with:

```ts
detail: JSON.stringify({
  confirmation_id: event.confirmation_id,
  tool: event.tool,
  summary: event.summary,
  args_preview: event.args_preview,
}),
```

(`event.summary` and `event.args_preview` are already on the upstream type — see [route.ts:123](../../apps/web/src/app/api/agents/generate/route.ts#L123).)

- [ ] **Step 2: Type-check the web package**

```bash
pnpm --filter web check-types
```

Expected: PASS. The upstream event type at line 123 already declares `summary: string` and `args_preview: unknown`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/agents/generate/route.ts
git commit -m "$(cat <<'EOF'
feat(web): include tool summary and args_preview in confirmation block

The agents service already emits summary + args_preview in the
confirmation_required SSE event. The web translator was dropping both
before serialising into ServiceBlock.detail, leaving the UI with only
{confirmation_id, tool}. Forward the full payload so the upcoming inline
Allow/Deny block can render an args preview without an extra round-trip.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 3: Add confirmation branch + onConfirm prop to ChatServiceBlock

**Files:**
- Modify: `packages/ui/src/components/chat/chat-service-block.tsx`
- Modify: `packages/ui/src/components/chat/chat-types.ts`
- Modify: `packages/ui/test/chat-service-block.test.tsx`

- [ ] **Step 1: Add the `ChatConfirmHandler` type**

Edit `packages/ui/src/components/chat/chat-types.ts` — add export after `ChatSendPayload`:

```ts
export type ChatConfirmHandler = (
  confirmationId: string,
  action: 'allow' | 'deny',
) => void | Promise<void>
```

- [ ] **Step 2: Write the failing tests**

Append to `packages/ui/test/chat-service-block.test.tsx`:

```tsx
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

function confirmationPart(): ChatToolPart {
  return {
    type: 'tool',
    id: 'c1',
    kind: 'confirmation',
    state: 'required',
    title: 'Создать страницу «Smoke»',
    detail: JSON.stringify({
      confirmation_id: 'c1',
      tool: 'anynote__createPage',
      summary: 'Создать страницу «Smoke»',
      args_preview: { title: 'Smoke', type: 'TEXT' },
    }),
  }
}

describe('ChatServiceBlock — confirmation', () => {
  it('renders Разрешить and Отклонить buttons when state is required', () => {
    render(<ChatServiceBlock part={confirmationPart()} onConfirm={() => {}} />)
    expect(screen.getByRole('button', { name: /разрешить/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /отклонить/i })).toBeTruthy()
  })

  it('calls onConfirm with action="allow" when Разрешить is clicked', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<ChatServiceBlock part={confirmationPart()} onConfirm={onConfirm} />)
    await user.click(screen.getByRole('button', { name: /разрешить/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledWith('c1', 'allow')
  })

  it('calls onConfirm with action="deny" when Отклонить is clicked', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<ChatServiceBlock part={confirmationPart()} onConfirm={onConfirm} />)
    await user.click(screen.getByRole('button', { name: /отклонить/i }))
    expect(onConfirm).toHaveBeenCalledWith('c1', 'deny')
  })

  it('toggles args preview when Подробнее is clicked', async () => {
    const user = userEvent.setup()
    render(<ChatServiceBlock part={confirmationPart()} onConfirm={() => {}} />)
    // collapsed by default
    expect(screen.queryByText(/"title": "Smoke"/)).toBeNull()
    await user.click(screen.getByRole('button', { name: /подробнее/i }))
    expect(screen.getByText(/"title": "Smoke"/)).toBeTruthy()
  })

  it('hides the buttons after the parent flips state to running', () => {
    const part: ChatToolPart = { ...confirmationPart(), state: 'running' }
    render(<ChatServiceBlock part={part} onConfirm={() => {}} />)
    expect(screen.queryByRole('button', { name: /разрешить/i })).toBeNull()
  })
})
```

- [ ] **Step 3: Run the tests and confirm they fail**

```bash
pnpm --filter @repo/ui test -- chat-service-block
```

Expected: the 5 new `confirmation` cases fail (no buttons rendered, no onConfirm prop on the component).

- [ ] **Step 4: Implement the confirmation branch**

Replace `packages/ui/src/components/chat/chat-service-block.tsx` with:

```tsx
'use client'

import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import Alert, { AlertColor } from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Collapse from '@mui/material/Collapse'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useState } from 'react'

import type { ChatConfirmHandler, ChatToolPart } from './chat-types'

type ChatServiceBlockProps = {
  part: ChatToolPart
  onConfirm?: ChatConfirmHandler
}

function getSeverity(state: ChatToolPart['state']): AlertColor {
  const state_maps: Record<ChatToolPart['state'], AlertColor> = {
    done: 'success',
    error: 'error',
    required: 'warning',
    running: 'info',
    pending: 'info',
  }
  return state_maps[state] || 'info'
}

function getStateLabel(state: ChatToolPart['state']) {
  const state_maps: Record<ChatToolPart['state'], string> = {
    done: 'Done',
    error: 'Error',
    required: 'Action required',
    running: 'Running',
    pending: 'Pending',
  }
  return state_maps[state] || 'Pending'
}

type ParsedDetail = {
  confirmation_id?: string
  tool?: string
  summary?: string
  args_preview?: unknown
}

function parseDetail(detail: string | undefined): ParsedDetail {
  if (!detail) return {}
  try {
    const value = JSON.parse(detail) as unknown
    return typeof value === 'object' && value !== null ? (value as ParsedDetail) : {}
  } catch {
    return {}
  }
}

export function ChatServiceBlock({ part, onConfirm }: ChatServiceBlockProps) {
  const [resultOpen, setResultOpen] = useState(false)
  const [argsOpen, setArgsOpen] = useState(false)
  const resultDialogTitle = `Результат: ${part.title}`
  const isConfirmation =
    part.kind === 'confirmation' && part.state === 'required' && onConfirm !== undefined
  const detail = isConfirmation ? parseDetail(part.detail) : {}
  const confirmationId = detail.confirmation_id ?? part.id
  const argsPreview =
    detail.args_preview && typeof detail.args_preview === 'object' ? detail.args_preview : null

  return (
    <>
      <Alert severity={getSeverity(part.state)} variant="outlined">
        <Stack spacing={1}>
          <Box
            alignItems="center"
            data-testid="chat-service-block-summary"
            display="flex"
            flexWrap="wrap"
            gap={1}
            minWidth={0}
            rowGap={0.25}
          >
            <Typography
              component="span"
              sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
              variant="body2"
            >
              {part.title}
            </Typography>
            <Typography color="text.secondary" component="span" variant="body2">
              {' • '}
            </Typography>
            <Typography color="text.secondary" component="span" variant="body2">
              {getStateLabel(part.state)}
            </Typography>
            {detail.tool ? (
              <>
                <Typography color="text.secondary" component="span" variant="body2">
                  {' • '}
                </Typography>
                <Typography color="text.secondary" component="span" variant="body2">
                  {detail.tool}
                </Typography>
              </>
            ) : null}
            {part.result ? (
              <Typography color="text.secondary" component="span" variant="body2">
                {' • '}
              </Typography>
            ) : null}
            {part.result ? (
              <Button onClick={() => setResultOpen(true)} size="small" variant="outlined">
                Результат
              </Button>
            ) : null}
            {argsPreview ? (
              <Link
                component="button"
                onClick={() => setArgsOpen((v) => !v)}
                sx={{ alignItems: 'center', display: 'inline-flex', gap: 0.25 }}
                type="button"
                underline="hover"
                variant="body2"
              >
                {argsOpen ? 'Скрыть' : 'Подробнее'}
                <ExpandMoreRoundedIcon
                  fontSize="small"
                  sx={{
                    transform: argsOpen ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.15s',
                  }}
                />
              </Link>
            ) : null}
          </Box>

          {argsPreview ? (
            <Collapse in={argsOpen} unmountOnExit>
              <Box
                sx={{
                  bgcolor: 'action.hover',
                  borderRadius: 1,
                  maxHeight: 240,
                  overflow: 'auto',
                  p: 1,
                  whiteSpace: 'pre-wrap',
                }}
              >
                <Typography component="pre" fontFamily="monospace" m={0} variant="caption">
                  {JSON.stringify(argsPreview, null, 2)}
                </Typography>
              </Box>
            </Collapse>
          ) : null}

          {isConfirmation ? (
            <Stack direction="row" spacing={1}>
              <Button
                color="success"
                onClick={() => void onConfirm?.(confirmationId, 'allow')}
                size="small"
                startIcon={<CheckRoundedIcon />}
                variant="contained"
              >
                Разрешить
              </Button>
              <Button
                color="inherit"
                onClick={() => void onConfirm?.(confirmationId, 'deny')}
                size="small"
                startIcon={<CloseRoundedIcon />}
                variant="outlined"
              >
                Отклонить
              </Button>
            </Stack>
          ) : null}
        </Stack>
      </Alert>

      {part.result ? (
        <Dialog
          aria-labelledby={`${part.id}-result-title`}
          fullWidth
          maxWidth="md"
          onClose={() => setResultOpen(false)}
          open={resultOpen}
        >
          <DialogTitle id={`${part.id}-result-title`}>{resultDialogTitle}</DialogTitle>
          <DialogContent>
            <Box
              sx={{
                bgcolor: 'action.hover',
                borderRadius: 1.5,
                maxHeight: '70vh',
                overflow: 'auto',
                p: 1.5,
                whiteSpace: 'pre-wrap',
              }}
            >
              <Typography component="pre" fontFamily="monospace" m={0} variant="body2">
                {part.result}
              </Typography>
            </Box>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
```

- [ ] **Step 5: Re-run the tests and confirm they pass**

```bash
pnpm --filter @repo/ui test -- chat-service-block
```

Expected: all 8 cases PASS (3 wrapping + 5 confirmation).

- [ ] **Step 6: Type-check + full UI suite**

```bash
pnpm --filter @repo/ui check-types && pnpm --filter @repo/ui test
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/components/chat/chat-service-block.tsx packages/ui/src/components/chat/chat-types.ts packages/ui/test/chat-service-block.test.tsx
git commit -m "$(cat <<'EOF'
feat(ui): inline Allow/Deny buttons for tool-confirmation blocks

Replaces the bare "Action required" Alert with two contained buttons and
a collapsible "Подробнее" link that shows the args_preview JSON. New
optional onConfirm prop is invoked with (confirmation_id, 'allow'|'deny')
so the chat client can POST to /api/agent/resume. Existing tool blocks
(non-confirmation) are unaffected.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 4: Pipe `onConfirm` through ChatMessageList + ChatThread

**Files:**
- Modify: `packages/ui/src/components/chat/chat-provider-utils.tsx`
- Modify: `packages/ui/src/components/chat/chat-message-list.tsx`
- Modify: `packages/ui/src/components/chat/chat-thread.tsx`

- [ ] **Step 1: Convert `chatPartRenderers` const into a builder**

Replace the bottom of `packages/ui/src/components/chat/chat-provider-utils.tsx` (currently lines 124-129):

```tsx
export const chatPartRenderers: ChatPartRendererMap = {
  attacment: ({ part }) => {
    return <ChatFileChip href={part.downloadUrl} name={part.name} secondaryLabel={part.fileSize} />
  },
  tool: ({ part }) => <ChatServiceBlock part={part as ChatToolPart} />,
}
```

with:

```tsx
import type { ChatConfirmHandler } from './chat-types'

export type BuildChatPartRenderersOptions = {
  onConfirm?: ChatConfirmHandler
}

export function buildChatPartRenderers(
  options: BuildChatPartRenderersOptions = {},
): ChatPartRendererMap {
  return {
    attacment: ({ part }) => (
      <ChatFileChip href={part.downloadUrl} name={part.name} secondaryLabel={part.fileSize} />
    ),
    tool: ({ part }) => (
      <ChatServiceBlock onConfirm={options.onConfirm} part={part as ChatToolPart} />
    ),
  }
}
```

- [ ] **Step 2: Update `ChatMessageList` to build renderers from props**

In `packages/ui/src/components/chat/chat-message-list.tsx`:

Replace the import `chatPartRenderers,` (line 19) with `buildChatPartRenderers,`.

Add `onConfirm?: ChatConfirmHandler` to `ChatMessageListProps` (after `renderLink?: ChatRenderLink`).

Add `import type { ChatConfirmHandler, ChatThreadMessage } from './chat-types'` (extend the existing line 22 import).

In the component body, after `const providerMessages = useMemo(...)`:

```tsx
const partRenderers = useMemo(() => buildChatPartRenderers({ onConfirm }), [onConfirm])
```

Replace `partRenderers={chatPartRenderers}` on line 97 with `partRenderers={partRenderers}`.

Destructure `onConfirm` in the function signature alongside `renderLink`.

- [ ] **Step 3: Pass `onConfirm` through `ChatThread`**

In `packages/ui/src/components/chat/chat-thread.tsx`:

Extend the import `import type { ChatComposerAttachment, ChatSendPayload, ChatThreadMessage } from './chat-types'` to also bring in `ChatConfirmHandler`.

Add `onConfirm?: ChatConfirmHandler` to `ChatThreadProps` (next to `renderLink`).

Destructure `onConfirm` in the function signature.

In the `<ChatMessageList ... />` call (around line 141), pass `onConfirm={onConfirm}`.

- [ ] **Step 4: Run the existing test suite to catch breakage**

```bash
pnpm --filter @repo/ui test
```

Expected: all green. `chatPartRenderers` removal is local (only consumer was `chat-message-list.tsx`).

- [ ] **Step 5: Type-check**

```bash
pnpm --filter @repo/ui check-types
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/chat/chat-provider-utils.tsx packages/ui/src/components/chat/chat-message-list.tsx packages/ui/src/components/chat/chat-thread.tsx
git commit -m "$(cat <<'EOF'
feat(ui): thread onConfirm callback from ChatThread to ChatServiceBlock

Replace the const chatPartRenderers export with buildChatPartRenderers
factory so ChatMessageList can inject an onConfirm closure per render.
ChatThread and ChatMessageList grow a new optional onConfirm prop that
ultimately reaches the confirmation branch inside ChatServiceBlock.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 5: Implement `useChatStream.confirmResume`

**Files:**
- Modify: `apps/web/src/components/workspace/chat/use-chat-stream.ts`

- [ ] **Step 1: Inspect the existing stream-merge helpers**

```bash
grep -n "decodeWebSseEvents\|appendAssistantText\|replaceAssistantToolBlocks\|updateAssistantStatus" apps/web/src/components/workspace/chat/use-chat-stream.ts
```

Confirm the three helpers exist. They will be reused unchanged.

- [ ] **Step 2: Add the `confirmResume` method**

In `apps/web/src/components/workspace/chat/use-chat-stream.ts`, just before the hook `return` statement, add:

```ts
const confirmResume = useEffectEvent(async (confirmationId: string, action: 'allow' | 'deny') => {
  const assistantMessageId = activeAssistantMessageIdRef.current
  if (!assistantMessageId) {
    setError('Нет активного сообщения для подтверждения.')
    return
  }
  const controller = new AbortController()
  streamControllerRef.current = controller
  setError(null)
  setIsStreaming(true)
  setMessages((prev) =>
    updateAssistantStatus(prev, assistantMessageId, 'streaming'),
  )
  try {
    const response = await fetch('/api/agent/resume', {
      body: JSON.stringify({ chatId, confirmationId, action }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      signal: controller.signal,
    })
    if (!response.ok || !response.body) {
      throw new Error(`resume HTTP ${response.status}`)
    }
    for await (const event of decodeWebSseEvents(response.body)) {
      handleStreamEvent(event)
    }
  } catch (err) {
    if ((err as { name?: string } | undefined)?.name !== 'AbortError') {
      const message = getErrorMessage(err, 'Resume failed')
      setError(message)
      setMessages((prev) => updateAssistantStatus(prev, assistantMessageId, 'error'))
    }
  } finally {
    if (streamControllerRef.current === controller) {
      streamControllerRef.current = null
    }
    setIsStreaming(false)
    void onSettled?.()
  }
})
```

Also extract a `handleStreamEvent(event)` helper from the existing `for await` loop in `startSend` (the body that switches on `event.type`). The existing loop already lives in this file — refactor it to a shared inner function so both `startSend` and `confirmResume` call into the same dispatcher. Concretely:

1. Locate the existing `for await (const event of decodeWebSseEvents(response.body)) { … }` inside `startSend`.
2. Lift the entire switch / if-chain inside it into a new local function:

   ```ts
   const handleStreamEvent = useEffectEvent((event: WebChatSseEvent) => {
     // moved body verbatim — uses setMessages, activeAssistantMessageIdRef,
     // onPlanStep, onConfirmationRequired, etc.
   })
   ```

3. In `startSend`, replace the body of the loop with `handleStreamEvent(event)`.

Add `confirmResume` to the hook's return object:

```ts
return { confirmResume, error, isStreaming, messages, sendMessage }
```

(Keep the existing returned fields; just add `confirmResume`.)

- [ ] **Step 3: Type-check the web package**

```bash
pnpm --filter web check-types
```

Expected: PASS.

- [ ] **Step 4: Run web unit tests**

```bash
pnpm --filter web test
```

Expected: all green (existing tests don't touch `confirmResume` yet; this is a green-field addition).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/workspace/chat/use-chat-stream.ts
git commit -m "$(cat <<'EOF'
feat(web): add confirmResume to useChatStream

Splits the SSE event dispatcher out of startSend into a reusable
handleStreamEvent helper, then adds confirmResume(confirmationId, action)
which POSTs to /api/agent/resume and feeds the response stream into the
same assistant message — no new message bubble. Errors surface via the
existing `error` state; AbortController cleanup matches startSend.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 6: Wire `confirmResume` into `workspace-chat-client`

**Files:**
- Modify: `apps/web/src/components/workspace/chat/workspace-chat-client.tsx`

- [ ] **Step 1: Pull `confirmResume` out of the hook and pass it to `<ChatThread>`**

Find the destructure of `useChatStream(...)`. Add `confirmResume` to the destructure. Then on the `<ChatThread ... />` element (around line 169) add `onConfirm={confirmResume}`.

- [ ] **Step 2: Type-check + run web tests**

```bash
pnpm --filter web check-types && pnpm --filter web test
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/workspace/chat/workspace-chat-client.tsx
git commit -m "$(cat <<'EOF'
feat(web): wire confirmResume into the workspace chat client

ChatThread now receives onConfirm=confirmResume. The confirmation block
buttons in the assistant message dispatch /api/agent/resume and stream
the result back into the same bubble.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase C — Intent-first tool descriptions

### Task 7: Rewrite workspace.tools.ts descriptions

**Files:**
- Modify: `apps/engines/src/apps/mcp/tools/workspace.tools.ts`
- Modify: `apps/engines/src/apps/mcp/tools/workspace.tools.spec.ts`

- [ ] **Step 1: Write the failing assertions**

In `workspace.tools.spec.ts`, append a new `describe`:

```ts
describe('WorkspaceTools — intent-first descriptions', () => {
  // The Tool decorator stores metadata on the prototype via reflect-metadata.
  // We assert against the source descriptors by reading the @Tool() arg.
  // Simplest portable check: ensure each method's @Tool description contains
  // a Russian trigger phrase so the planner can match natural language.
  const source = require('fs').readFileSync(
    require('path').join(__dirname, 'workspace.tools.ts'),
    'utf8',
  ) as string

  it('getWorkspaceStats description mentions "сколько страниц" or "статистик"', () => {
    const match = source.match(/name: 'getWorkspaceStats'[\s\S]*?description:\s*([\s\S]*?),\s*parameters:/)
    expect(match).not.toBeNull()
    const desc = match![1]!
    expect(desc).toMatch(/сколько страниц|статистик/i)
  })

  it('listWorkspaceFiles description mentions "файл" or "вложен"', () => {
    const match = source.match(/name: 'listWorkspaceFiles'[\s\S]*?description:\s*([\s\S]*?),\s*parameters:/)
    expect(match![1]).toMatch(/файл|вложен/i)
  })

  it('listSkills description mentions "навык" or "skill"', () => {
    const match = source.match(/name: 'listSkills'[\s\S]*?description:\s*([\s\S]*?),\s*parameters:/)
    expect(match![1]).toMatch(/навык|skill/i)
  })

  it('listAgentPages description mentions "агент" or "agent"', () => {
    const match = source.match(/name: 'listAgentPages'[\s\S]*?description:\s*([\s\S]*?),\s*parameters:/)
    expect(match![1]).toMatch(/агент|agent/i)
  })
})
```

- [ ] **Step 2: Run and confirm the four new cases fail**

```bash
pnpm --filter engines test -- workspace.tools
```

Expected: 4 new tests FAIL (current descriptions are English-only and don't include the trigger phrases).

- [ ] **Step 3: Rewrite the four descriptions**

In `workspace.tools.ts`:

```diff
   @Tool({
     name: 'getWorkspaceStats',
-    description: 'Workspace members, pages-by-type, total pages',
+    description:
+      'Возвращает счётчики и состав рабочего пространства: число страниц ' +
+      'по типам (TEXT/KANBAN/EXCALIDRAW), общее число страниц и список ' +
+      'участников. Вызывай когда пользователь спрашивает "сколько страниц", ' +
+      '"сколько заметок", "кто в команде", "статистика воркспейса" или ' +
+      'просит общий обзор. Без параметров.',
     parameters: z.object({}),
   })
```

```diff
   @Tool({
     name: 'listWorkspaceFiles',
-    description: 'List all files in a workspace',
+    description:
+      'Возвращает список загруженных файлов рабочего пространства ' +
+      '(имя, mime, размер, дата загрузки) с пагинацией. Вызывай когда ' +
+      'пользователь просит показать вложения, файлы, аплоады, документы ' +
+      'воркспейса. Поддерживает limit (1-100) и offset.',
     parameters: PaginationInput,
   })
```

```diff
   @Tool({
     name: 'listSkills',
-    description: 'List skill pages (ownership=SKILL) in a workspace',
+    description:
+      'Возвращает страницы-навыки (ownership=SKILL) рабочего пространства. ' +
+      'Вызывай когда пользователь спрашивает про доступные навыки, скиллы, ' +
+      'промпт-страницы или просит показать "что умеет агент в этом ' +
+      'воркспейсе". Параметр limit (1-100).',
     parameters: LimitInput,
   })
```

```diff
   @Tool({
     name: 'listAgentPages',
-    description: 'List agent pages (ownership=AGENT) in a workspace',
+    description:
+      'Возвращает страницы-агенты (ownership=AGENT) рабочего пространства. ' +
+      'Вызывай когда пользователь спрашивает про доступных агентов, ' +
+      'персонажей, ассистентов или просит "список агентов". Параметр ' +
+      'limit (1-100).',
     parameters: LimitInput,
   })
```

- [ ] **Step 4: Re-run engines tests**

```bash
pnpm --filter engines test -- workspace.tools
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/engines/src/apps/mcp/tools/workspace.tools.ts apps/engines/src/apps/mcp/tools/workspace.tools.spec.ts
git commit -m "$(cat <<'EOF'
feat(engines): intent-first descriptions for workspace MCP tools

Rewrites getWorkspaceStats, listWorkspaceFiles, listSkills, listAgentPages
descriptions in Russian with explicit trigger phrases ("сколько страниц",
"кто в команде", "файлы", "навыки", "агенты") so the planner picks the
right tool from natural-language requests instead of requiring "Используй
инструмент <name>" prefixes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 8: Rewrite page.tools.ts descriptions

**Files:**
- Modify: `apps/engines/src/apps/mcp/tools/page.tools.ts`

- [ ] **Step 1: Rewrite all 5 descriptions**

```diff
   @Tool({
     name: 'createPage',
-    description: 'Create a new page in a workspace',
+    description:
+      'Создаёт новую страницу в рабочем пространстве (TEXT, KANBAN, ' +
+      'EXCALIDRAW). Вызывай когда пользователь просит "создай страницу", ' +
+      '"добавь заметку", "новый канбан", "новая доска" и т.п. Требует ' +
+      'подтверждения пользователя через UI confirmation. Параметры: title ' +
+      '(string), type (TEXT|KANBAN|EXCALIDRAW), parentId (uuid, optional).',
     parameters: CreatePageInput,
   })
```

```diff
   @Tool({
     name: 'updatePage',
-    description: 'Update page title/icon/content',
+    description:
+      'Меняет существующую страницу: title, icon, content. Вызывай когда ' +
+      'пользователь просит "переименуй страницу", "обнови заголовок", ' +
+      '"измени содержимое страницы X". Требует подтверждения. Сначала ' +
+      'прочитай страницу через renderPageMarkdown — никогда не пиши ' +
+      'содержимое вслепую.',
     parameters: UpdatePageInput,
   })
```

```diff
   @Tool({
     name: 'movePage',
-    description: 'Move a page to a new parent or reorder',
+    description:
+      'Перемещает страницу к новому родителю или меняет её порядок в ' +
+      'списке. Вызывай когда пользователь просит "перенеси страницу", ' +
+      '"переставь", "сделай дочерней для". Требует подтверждения.',
     parameters: MovePageInput,
   })
```

```diff
   @Tool({
     name: 'renderPageMarkdown',
-    description: 'Render page content as Markdown',
+    description:
+      'Возвращает содержимое страницы целиком как Markdown. Вызывай ' +
+      'когда нужно прочитать страницу — для пересказа, цитирования, ' +
+      'поиска фактов или перед updatePage. Не модифицирует данные.',
     parameters: PageIdInput,
   })
```

```diff
   @Tool({
     name: 'getPageMetadata',
-    description: 'Return page metadata (creator, creation date, type, ownership)',
+    description:
+      'Возвращает метаданные страницы: автор, дата создания, тип, ' +
+      'ownership, иконка. Вызывай когда пользователь спрашивает "кто ' +
+      'создал страницу", "когда сделали заметку", "какой тип у страницы X".',
     parameters: PageIdInput,
   })
```

- [ ] **Step 2: Type-check and run engines tests**

```bash
pnpm --filter engines check-types && pnpm --filter engines test
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/engines/src/apps/mcp/tools/page.tools.ts
git commit -m "$(cat <<'EOF'
feat(engines): intent-first descriptions for page MCP tools

Russian descriptions with trigger phrases ("создай страницу", "переименуй",
"перенеси", "прочитай страницу", "когда создали") for createPage,
updatePage, movePage, renderPageMarkdown, getPageMetadata. Mentions the
confirmation requirement so the planner doesn't try to skip it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 9: Rewrite search.tools.ts descriptions

**Files:**
- Modify: `apps/engines/src/apps/mcp/tools/search.tools.ts`

- [ ] **Step 1: Read the current file to confirm tool names**

```bash
cat apps/engines/src/apps/mcp/tools/search.tools.ts
```

There are 2 tools — semantic and lexical search. Note their exact names from the file.

- [ ] **Step 2: Rewrite both descriptions**

For each `@Tool({...})` block, replace the description in the style of Task 7:

- Semantic search: `'Семантический поиск по страницам рабочего пространства через embeddings. Вызывай когда пользователь спрашивает по смыслу — "найди заметки про X", "что мы писали о Y", "где упоминается Z". Возвращает релевантные блоки с pageId, blockNumber, заголовком. Параметры: query (string), k (1-30, default 10).'`
- Lexical search: `'Лексический (полнотекстовый) поиск по точным словам и фразам в страницах рабочего пространства. Вызывай когда нужны точные совпадения — имена, ID, специальные термины. Менее терпим к опечаткам, чем семантический поиск. Параметры: query (string), k (1-30, default 10).'`

- [ ] **Step 3: Type-check + tests**

```bash
pnpm --filter engines check-types && pnpm --filter engines test
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/engines/src/apps/mcp/tools/search.tools.ts
git commit -m "$(cat <<'EOF'
feat(engines): intent-first descriptions for search MCP tools

Distinguish semantic vs lexical search in the description so the planner
picks the right one — semantic for "найди по смыслу", lexical for точные
имена/ID/термины. Both list parameter ranges so args are filled correctly.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 10: Rewrite internal Python tool descriptions

**Files:**
- Modify: `apps/agents/agents/apps/agent/services/internal_tools.py`
- Modify: `apps/agents/tests/apps/agent/test_internal_tools.py`

- [ ] **Step 1: Write the failing assertion**

Append to `apps/agents/tests/apps/agent/test_internal_tools.py`:

```python
def test_save_memory_description_mentions_remember_keyword() -> None:
    pending: list = []
    tool = make_save_memory_tool(pending)
    description = (tool.description or '').lower()
    assert 'запомни' in description or 'сохрани' in description, description


def test_recall_memory_description_mentions_recall_keyword() -> None:
    from unittest.mock import AsyncMock
    from tests.apps.agent.factories import make_state
    tool = make_recall_memory_tool(make_state(), repo=AsyncMock())
    description = (tool.description or '').lower()
    assert 'вспомни' in description or 'найди' in description, description


def test_search_pages_description_mentions_workspace_search() -> None:
    from unittest.mock import AsyncMock
    tool = make_search_pages_tool(workspace_id='w', embedding=object(), rag_service=AsyncMock())
    description = (tool.description or '').lower()
    assert 'страниц' in description, description
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
pnpm --filter agents test -- -k test_save_memory_description or test_recall_memory_description or test_search_pages_description
```

Expected: 3 new cases FAIL.

- [ ] **Step 3: Rewrite the three descriptions**

In `apps/agents/agents/apps/agent/services/internal_tools.py`:

```diff
     return StructuredTool.from_function(
         coroutine=call,
         name='save_memory',
         description=(
-            'Record a durable fact for this workspace or user (visible across '
-            'future chats). scope is "workspace" or "user". key is a short '
-            'slug; content is the fact in markdown (up to 2000 chars).'
+            'Сохраняет долгосрочный факт о пользователе или рабочем '
+            'пространстве (виден во всех будущих чатах). Вызывай когда '
+            'пользователь говорит "запомни", "сохрани на будущее", '
+            '"запиши факт", "не забывай что". scope="workspace" — общий '
+            'для всех участников; scope="user" — личный для текущего '
+            'пользователя. key — короткий слаг (≤120 симв.), content — '
+            'факт в markdown (≤2000 симв.).'
         ),
         args_schema=_SaveMemoryArgs,
     )
```

```diff
     return StructuredTool.from_function(
         coroutine=call,
         name='recall_memory',
-        description='Look up durable workspace/user facts by lexical query.',
+        description=(
+            'Ищет ранее сохранённые факты воркспейса/пользователя по '
+            'лексическому запросу. Вызывай когда нужно "вспомни что я '
+            'говорил про X", "найди мой ранее сохранённый факт", "что мы '
+            'знаем о Y". Возвращает до k=5 совпадений (1-20). Не путать '
+            'со search_pages — здесь только короткие факты-памятки, не '
+            'содержимое страниц.'
+        ),
         args_schema=_RecallMemoryArgs,
     )
```

```diff
     return StructuredTool.from_function(
         coroutine=call,
         name='search_pages',
         description=(
-            'Semantic RAG search over the workspace. Returns matching '
-            'block excerpts with pageId, blockNumber, title.'
+            'Семантический RAG-поиск по содержимому страниц рабочего '
+            'пространства через embeddings. Вызывай когда пользователь '
+            'спрашивает по смыслу — "найди заметки про X", "что я писал '
+            'о Y", "где упоминается Z". Возвращает релевантные блоки с '
+            'pageId, blockNumber, заголовком. Параметры: query (string), '
+            'k (1-30, default 10).'
         ),
         args_schema=_SearchPagesArgs,
     )
```

Also tighten the pydantic args (better LLM-facing parameter docs):

```diff
 class _SaveMemoryArgs(BaseModel):
-    scope: Literal['workspace', 'user'] = Field(...)
-    key: str = Field(..., min_length=1, max_length=120)
-    content: str = Field(..., min_length=1, max_length=2000)
+    scope: Literal['workspace', 'user'] = Field(
+        ..., description='workspace — общий для всех; user — личный для текущего пользователя',
+    )
+    key: str = Field(
+        ..., min_length=1, max_length=120,
+        description='Короткий уникальный слаг для факта, например "tone-formal" или "любимый-напиток"',
+    )
+    content: str = Field(
+        ..., min_length=1, max_length=2000,
+        description='Сам факт в Markdown, до 2000 символов',
+    )
```

```diff
 class _RecallMemoryArgs(BaseModel):
-    query: str
-    k: int = Field(default=5, ge=1, le=20)
+    query: str = Field(..., description='Поисковая фраза по сохранённым фактам')
+    k: int = Field(default=5, ge=1, le=20, description='Сколько фактов вернуть (1-20)')
```

```diff
 class _SearchPagesArgs(BaseModel):
-    query: str
-    k: int = Field(default=10, ge=1, le=30)
+    query: str = Field(..., description='Поисковый запрос по смыслу содержимого страниц')
+    k: int = Field(default=10, ge=1, le=30, description='Сколько блоков вернуть (1-30)')
```

- [ ] **Step 4: Re-run all internal_tools tests**

```bash
pnpm --filter agents test -- -k internal_tools
```

Expected: all green (3 new + the 3 pre-existing tests).

- [ ] **Step 5: Run full agents suite + gates**

```bash
pnpm --filter agents test && pnpm --filter agents lint && pnpm --filter agents check-types
```

Expected: PASS, no warnings.

- [ ] **Step 6: Commit**

```bash
git add apps/agents/agents/apps/agent/services/internal_tools.py apps/agents/tests/apps/agent/test_internal_tools.py
git commit -m "$(cat <<'EOF'
feat(agents): intent-first descriptions for internal tools

Russian descriptions with trigger phrases for save_memory ("запомни",
"сохрани"), recall_memory ("вспомни", "найди"), and search_pages ("найди
заметки про"). Also adds Field(description=...) to every pydantic
parameter so the LLM sees per-argument docs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase D — End-to-end verification

### Task 11: Re-run the 3 Playwright smoke scenarios without explicit tool naming

**Files:** none (verification only)

- [ ] **Step 1: Confirm services are up**

```bash
lsof -i :3000 -i :8080 -i :8090 -P -n 2>/dev/null | grep LISTEN
```

Expected: three lines for ports 3000 (web), 8080 (agents), 8090 (engines).

If any are missing, start with `pnpm --filter web dev`, `pnpm --filter agents dev`, `pnpm --filter engines dev` (each in its own terminal — the dev script is persistent).

- [ ] **Step 2: Switch the dev workspace to GigaChat-2 Pro**

```bash
docker exec -e PGPASSWORD=password anynote-postgres-1 psql -U user -d anynote -c \
  "UPDATE workspace_ai_settings SET default_model_id='019e1287-0924-74e6-ab77-8095f64343d3', embeddings_model_id='019e1287-0935-74c2-bdd9-d0d586332c13', updated_at=NOW() WHERE workspace_id='72e63c4b-3090-44bb-9f28-d3000a1f8c23' RETURNING workspace_id;"
```

Expected: `UPDATE 1`.

- [ ] **Step 3: Open the chats page in Playwright MCP**

Drive the Playwright MCP browser to `http://localhost:3000/workspaces/72e63c4b-3090-44bb-9f28-d3000a1f8c23/chats` and authenticate (the dev session is pre-authenticated for that workspace owner — `smoke-test@example.com`).

- [ ] **Step 4: Scenario 1 — workspace stats without prefix**

In a fresh chat, send: `Сколько страниц в этом воркспейсе?`

Wait up to 30 s. Inspect the response.

Expected:
- service block "Pending → Done" for a call to `anynote__getWorkspaceStats`
- final assistant text mentions counts by type (TEXT / KANBAN / EXCALIDRAW)
- service-block title wraps inside the message bubble (visual check — no horizontal overflow)

If the planner asks "какой именно инструмент использовать" or picks the wrong tool — Task 7's description for `getWorkspaceStats` needs another pass.

- [ ] **Step 5: Scenario 2 — createPage with click-through confirm**

In a fresh chat, send: `Создай страницу "Smoke без префикса"`

Wait for the confirmation block to appear (`state=required`, tool `anynote__createPage`). Verify:
- Two buttons visible: `Разрешить` and `Отклонить`
- "Подробнее" link present; clicking it expands an args-preview JSON containing `"title": "Smoke без префикса"` and `"type": "TEXT"`
- Click `Разрешить`
- Block transitions to `Running` (and eventually `Done`)
- Assistant continues streaming inside the same bubble (no second message)
- Final text mentions success
- Query DB: `docker exec -e PGPASSWORD=password anynote-postgres-1 psql -U user -d anynote -c "SELECT id, title FROM pages WHERE title = 'Smoke без префикса';"` — expect 1 row.

- [ ] **Step 6: Scenario 3 — save_memory without prefix**

In a fresh chat, send: `Запомни на будущее: команда любит чай по средам.`

Wait for assistant response.

Expected:
- Tool call to `save_memory` with `scope="workspace"` and a slug-style key
- Final text confirms the memory was saved
- DB row: `docker exec -e PGPASSWORD=password anynote-postgres-1 psql -U user -d anynote -c "SELECT scope, key, content, source FROM workspace_agent_memories WHERE content LIKE '%чай%' ORDER BY created_at DESC LIMIT 1;"` — expect 1 WORKSPACE row.

- [ ] **Step 7: Capture results and commit a short note**

If all three scenarios pass without any "Используй инструмент …" hint, write a one-paragraph verification note to the chat / PR description ("3 smoke scenarios passed with GigaChat-2 Pro: <chat ids> · <page id> · <memory id>"). Nothing to commit (or, if results documentation is desired, append to `docs/superpowers/specs/2026-05-17-agent-chat-ux-hardening-design.md` and commit `docs:` with the verification note).

If any scenario fails or hits a wrong tool: re-open Task 7 / 8 / 9 / 10 for the relevant tool description and iterate. Add the failing prompt as a "must trigger" test fixture in the corresponding `*.spec.ts` / `test_*.py`.

---

## Final gate

- [ ] **Step 1: Run the full monorepo gate**

```bash
pnpm gates
```

Expected: 25/25 turbo tasks green, no lint/type-check failures across web/ui/engines/agents.

- [ ] **Step 2: Push and open PR**

(User-driven — wait for explicit instruction before opening a PR or pushing.)
