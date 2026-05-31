# Chat UI Design Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply 9 presentation tweaks to the chat surface at `/workspaces/{workspaceId}/chats/{chatId}` — drop the user-message timeline, tighten part spacing, fix composer vertical centring, restructure the slash "Thinking" menu as a Switch + no-arrow dots stepper, swap the send icon, randomise the empty-state greeting, centre+slide the composer when empty, white-canvas all pages, and cap the confirmation box width.

**Architecture:** All chat presentation lives in `packages/ui/src/components/chat/*` (consumed by `apps/web` via `transpilePackages`, so it ships raw `src/` and uses direct `@mui/material/X` imports). The web app only wires data into `<ChatThread>`. One change is in the web layout (`workspace-layout-client.tsx`, the `page-content-scroll` canvas). Work is TDD against the existing `@repo/ui` vitest suite (`packages/ui/test/*.test.tsx`, jsdom + `@testing-library/react`), with the E2E chat specs kept green.

**Tech Stack:** React 19, TypeScript, MUI v7 (`@mui/material`, `@mui/lab` Timeline), `@mui/x-chat` compact composer, Vitest + Testing Library (jsdom), Playwright (E2E).

---

## Conventions (read once before starting)

- **Run tests for one file:** `pnpm --filter @repo/ui exec vitest run test/<file>.test.tsx`
- **Run a single test by name:** add `-t "<test name substring>"`.
- **Watch a file while iterating:** `pnpm --filter @repo/ui exec vitest test/<file>.test.tsx` (no `run`).
- These chat components import MUI **directly** (`import Box from '@mui/material/Box'`), not via the `@repo/ui` barrel. New imports follow that style.
- Prettier: no semicolons, single quotes, trailing commas, 100-col. Run `pnpm format` if unsure; the commit hook enforces it.
- `@repo/ui` tests render bare components (no ThemeProvider); MUI's default theme applies in jsdom. That's fine — assertions target DOM structure / `data-testid` / text, not computed theme colours.
- Commit after each task. Conventional Commits with scope `feat(chat:` / `fix(chat:` / `refactor(chat:` / `test(chat:`.
- Do **not** bypass the commit hook with `--no-verify`.

## File Structure

| File | Responsibility | Items |
|---|---|---|
| `packages/ui/src/components/chat/chat-message-content.tsx` | Render a message's parts; gains a `variant` to skip the timeline for user messages; tighter part spacing | 1, 2 |
| `packages/ui/src/components/chat/chat-message-list.tsx` | Pass `variant` based on `isUser` | 1 |
| `packages/ui/src/components/chat/chat-composer.tsx` | Composer row centring; new Switch + dots "Усилия" slash control; send icon | 3, 4, 5 |
| `packages/ui/src/components/chat/chat-empty-state.tsx` | Random greeting, no comment icon, large centred heading | 6, 7 |
| `packages/ui/src/components/chat/chat-thread.tsx` | Centre composer when empty; slide it down on first message | 7 |
| `packages/ui/src/components/chat/chat-confirm-inline.tsx` | Cap confirmation panel width | 9 |
| `apps/web/src/components/workspace/workspace-layout-client.tsx` | White (`background.paper`) canvas on all pages | 8 |
| `packages/ui/test/*.test.tsx` | Unit coverage for the above | all |
| `apps/e2e/chat-timeline.spec.ts` | Keep assistant timeline green; add user-message no-timeline assertion | 1 |

---

## Task 1: Remove the timeline from user messages (+ share one part renderer)

**Files:**
- Modify: `packages/ui/src/components/chat/chat-message-content.tsx`
- Modify: `packages/ui/src/components/chat/chat-message-list.tsx:104,145-149`
- Test: `packages/ui/test/chat-message-content.test.tsx`

The current component always wraps parts in `<Timeline>`. We add a `variant` prop: `'assistant'` (default) keeps the timeline; `'user'` renders the part bodies plainly. Both paths share one `renderPartBody(part)` helper so the four `part.type` branches never drift.

- [ ] **Step 1: Write the failing test**

Add to `packages/ui/test/chat-message-content.test.tsx` (inside the existing `describe('ChatMessageContent', …)` block, after the last `it`):

```tsx
  it('renders a user message without the timeline rail', () => {
    const { container } = render(
      <ChatMessageContent variant="user" parts={[{ type: 'text', text: 'Привет' }]} />,
    )
    expect(screen.getByText('Привет')).toBeTruthy()
    // No MUI Timeline scaffolding for user messages.
    expect(container.querySelector('.MuiTimeline-root')).toBeNull()
    expect(container.querySelector('.MuiTimelineDot-root')).toBeNull()
  })

  it('still renders the assistant timeline by default', () => {
    const { container } = render(
      <ChatMessageContent parts={[{ type: 'text', text: 'Ответ' }]} />,
    )
    expect(container.querySelector('.MuiTimeline-root')).toBeTruthy()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/ui exec vitest run test/chat-message-content.test.tsx -t "without the timeline rail"`
Expected: FAIL — `variant` is not a prop yet, so the `.MuiTimeline-root` is still present (the `toBeNull()` assertion fails).

- [ ] **Step 3: Add the `variant` prop and extract `renderPartBody`**

In `packages/ui/src/components/chat/chat-message-content.tsx`, replace the `ChatMessageContentProps` type and the whole `ChatMessageContent` function body with the version below. Keep the existing imports, `linkifyWorkspacePageReferences`, `dotColorForPart`, `dotVariantForPart`, and `TimelineDotColor` exactly as they are.

```tsx
type ChatMessageContentProps = Readonly<{
  parts: ChatMessagePart[]
  renderLink?: ChatRenderLink
  onConfirm?: ChatConfirmHandler
  variant?: 'assistant' | 'user'
}>

export function ChatMessageContent({
  parts,
  renderLink,
  onConfirm,
  variant = 'assistant',
}: ChatMessageContentProps) {
  const markdownComponents = renderLink
    ? {
        a: ({ href, children }: { href?: string; children?: ReactNode }) =>
          href ? <>{renderLink(href, children)}</> : <>{children}</>,
      }
    : undefined

  const renderPartBody = (part: ChatMessagePart, index: number): ReactNode => {
    if (part.type === 'thinking') return <ChatThinkingBlock text={part.text} />
    if (part.type === 'text') {
      return (
        <Box
          sx={{
            '& code': { bgcolor: 'action.hover', borderRadius: 1, px: 0.5, py: 0.125 },
            '& ol, & ul': { m: 0, pl: 3 },
            '& p': { m: 0 },
            '& p + p': { mt: 1 },
            '& pre': {
              bgcolor: 'grey.100',
              borderRadius: 2,
              m: 0,
              overflowX: 'auto',
              p: 1,
            },
            '& strong': { fontWeight: 600 },
            overflowWrap: 'anywhere',
          }}
        >
          <ReactMarkdown components={markdownComponents}>
            {linkifyWorkspacePageReferences(part.text)}
          </ReactMarkdown>
        </Box>
      )
    }
    if (part.type === 'attacment') {
      return (
        <ChatFileChip href={part.downloadUrl} name={part.name} secondaryLabel={part.fileSize} />
      )
    }
    if (part.type === 'tool') {
      return <ChatServiceBlock onConfirm={onConfirm} part={part} />
    }
    return null
  }

  const keyFor = (part: ChatMessagePart, index: number) =>
    part.type === 'tool' ? part.id : `${part.type}-${index}`

  if (variant === 'user') {
    return (
      <Box>
        {parts.map((part, index) => (
          <Box key={keyFor(part, index)}>{renderPartBody(part, index)}</Box>
        ))}
      </Box>
    )
  }

  return (
    <Timeline
      sx={{
        m: 0,
        p: 0,
        [`& .${timelineItemClasses.root}:before`]: { flex: 0, p: 0 },
      }}
    >
      {parts.map((part, index) => {
        const isLast = index === parts.length - 1
        return (
          <TimelineItem key={keyFor(part, index)}>
            <TimelineSeparator>
              <TimelineDot color={dotColorForPart(part)} variant={dotVariantForPart(part)} />
              {isLast ? null : <TimelineConnector />}
            </TimelineSeparator>
            <TimelineContent sx={{ pb: 1.25, pt: 0 }}>{renderPartBody(part, index)}</TimelineContent>
          </TimelineItem>
        )
      })}
    </Timeline>
  )
}
```

- [ ] **Step 4: Run the test file to verify it passes**

Run: `pnpm --filter @repo/ui exec vitest run test/chat-message-content.test.tsx`
Expected: PASS — all existing tests (timeline order, thinking, links) plus the two new ones.

- [ ] **Step 5: Pass `variant` from the message list**

In `packages/ui/src/components/chat/chat-message-list.tsx`, the `renderItem` callback already computes `const isUser = message.role === 'user'` (line ~104) and renders `<ChatMessageContent onConfirm={…} parts={…} renderLink={…} />` (lines ~145-149). Add the `variant` prop:

```tsx
                    <ChatMessageContent
                      onConfirm={onConfirm}
                      parts={message.parts}
                      renderLink={renderLink}
                      variant={isUser ? 'user' : 'assistant'}
                    />
```

- [ ] **Step 6: Run the message-list tests**

Run: `pnpm --filter @repo/ui exec vitest run test/chat-message-list.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/components/chat/chat-message-content.tsx \
        packages/ui/src/components/chat/chat-message-list.tsx \
        packages/ui/test/chat-message-content.test.tsx
git commit -m "feat(chat): drop the timeline rail from user messages"
```

---

## Task 2: Tighten the spacing between timeline parts

**Files:**
- Modify: `packages/ui/src/components/chat/chat-message-content.tsx` (the assistant `TimelineContent` `sx`)
- Test: `packages/ui/test/chat-message-content.test.tsx`

The inter-part gap is `TimelineContent`'s `pb: 1.25` (10px). Reduce to `pb: 0.5` (4px).

- [ ] **Step 1: Write the failing test**

Add to `packages/ui/test/chat-message-content.test.tsx` inside `describe('ChatMessageContent', …)`:

```tsx
  it('uses compact bottom padding on assistant timeline content', () => {
    const { container } = render(
      <ChatMessageContent
        parts={[
          { type: 'text', text: 'one' },
          { type: 'text', text: 'two' },
        ]}
      />,
    )
    const content = container.querySelector('.MuiTimelineContent-root') as HTMLElement
    expect(content).toBeTruthy()
    // pb: 0.5 => theme spacing(0.5) => 4px
    expect(getComputedStyle(content).paddingBottom).toBe('4px')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/ui exec vitest run test/chat-message-content.test.tsx -t "compact bottom padding"`
Expected: FAIL — current `pb: 1.25` renders `padding-bottom: 10px`, not `4px`.

- [ ] **Step 3: Reduce the padding**

In `chat-message-content.tsx`, change the assistant `TimelineContent`:

```tsx
            <TimelineContent sx={{ pb: 0.5, pt: 0 }}>{renderPartBody(part, index)}</TimelineContent>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @repo/ui exec vitest run test/chat-message-content.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/chat/chat-message-content.tsx \
        packages/ui/test/chat-message-content.test.tsx
git commit -m "feat(chat): tighten spacing between timeline parts"
```

---

## Task 3: Replace the send icon with ArrowUpwardIcon

**Files:**
- Modify: `packages/ui/src/components/chat/chat-composer.tsx:6,321-323`
- Test: `packages/ui/test/chat-composer.test.tsx`

(Done before the bigger slash-menu change so the composer diff stays readable.)

- [ ] **Step 1: Write the failing test**

Add to `packages/ui/test/chat-composer.test.tsx` inside `describe('ChatComposer', …)`:

```tsx
  it('renders the send button with the ArrowUpward icon', () => {
    render(
      <ChatComposer
        value=""
        attachments={[]}
        onValueChange={() => {}}
        onAttachmentsChange={() => {}}
        onSend={vi.fn()}
      />,
    )
    const sendButton = screen.getByRole('button', { name: /send/i })
    expect(sendButton.querySelector('[data-testid="ArrowUpwardIcon"]')).toBeTruthy()
    expect(sendButton.querySelector('[data-testid="SendRoundedIcon"]')).toBeNull()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/ui exec vitest run test/chat-composer.test.tsx -t "ArrowUpward icon"`
Expected: FAIL — the button still contains `SendRoundedIcon`.

- [ ] **Step 3: Swap the icon**

In `chat-composer.tsx`, line 6, replace the import:

```tsx
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
```

(delete the `import SendRoundedIcon from '@mui/icons-material/SendRounded'` line).

Then in the send button (lines ~321-323):

```tsx
      <ChatComposerSendButton aria-label="Send" disabled={disabled || !hasText}>
        <ArrowUpwardIcon />
      </ChatComposerSendButton>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @repo/ui exec vitest run test/chat-composer.test.tsx`
Expected: PASS (all existing composer tests + the new one).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/chat/chat-composer.tsx \
        packages/ui/test/chat-composer.test.tsx
git commit -m "feat(chat): use ArrowUpward for the send button icon"
```

---

## Task 4: Centre the compact composer row vertically

**Files:**
- Modify: `packages/ui/src/components/chat/chat-composer.tsx` (the `<MuiChatComposer>` element, line ~192)
- Test: `packages/ui/test/chat-composer.test.tsx`

`@mui/x-chat`'s compact composer root sets `align-items: flex-end`, so the round buttons hug the bottom. Override to `center` via `sx` scoped to the compact class.

- [ ] **Step 1: Write the failing test**

Add to `packages/ui/test/chat-composer.test.tsx`:

```tsx
  it('vertically centres the compact composer row', () => {
    const { container } = render(
      <ChatComposer
        value=""
        attachments={[]}
        onValueChange={() => {}}
        onAttachmentsChange={() => {}}
        onSend={vi.fn()}
      />,
    )
    const form = container.querySelector('.MuiChatComposer-variantCompact') as HTMLElement
    expect(form).toBeTruthy()
    expect(getComputedStyle(form).alignItems).toBe('center')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/ui exec vitest run test/chat-composer.test.tsx -t "centres the compact composer row"`
Expected: FAIL — `align-items` resolves to `flex-end` (from the package's styled root).

- [ ] **Step 3: Add the `sx` override**

In `chat-composer.tsx`, the composer opens with `<MuiChatComposer disabled={disabled} variant="compact">` (line ~192). Add an `sx`:

```tsx
    <MuiChatComposer
      disabled={disabled}
      variant="compact"
      sx={{ '&.MuiChatComposer-variantCompact': { alignItems: 'center' } }}
    >
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @repo/ui exec vitest run test/chat-composer.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/chat/chat-composer.tsx \
        packages/ui/test/chat-composer.test.tsx
git commit -m "fix(chat): vertically centre the compact composer row"
```

---

## Task 5: Restructure the slash "Thinking" menu — Switch + no-arrow dots "Усилия"

**Files:**
- Modify: `packages/ui/src/components/chat/chat-composer.tsx` (imports; the slash `Menu` body, lines ~280-319; `THINKING_EFFORTS`/labels region)
- Test: `packages/ui/test/chat-composer.test.tsx`

Replace the three stacked effort `MenuItem`s with two rows:
- **Row 1:** `Thinking` label + a `Switch` (`data-testid="chat-slash-thinking-toggle"`). On → `onSelectThinking(currentEffort ?? 'MEDIUM')`. Off → `onClearThinking()`.
- **Row 2 ("Усилия (<уровень>)"):** label (same font as Thinking) + a right-aligned `MobileStepper variant="dots"` with 3 steps, **no arrows** (empty `<span />` for `nextButton`/`backButton`), and 3 transparent `ButtonBase` hit-targets over the dots — `data-testid="chat-slash-thinking-{low|medium|high}"` — each calling `onSelectThinking(level)`. Dimmed + non-interactive when the switch is off.

The `reasoningSupported === false` branch keeps the single disabled row (`data-testid="chat-slash-thinking-disabled"`).

> **Test-contract preservation:** the existing tests select `chat-slash-thinking-high` (click → `onSelectThinking('HIGH')`) and `chat-slash-thinking-disabled` (`aria-disabled="true"`). The new dot hit-targets keep those test-ids and behaviour. The pre-existing test "shows the Thinking slash command … reasoning is supported" stays valid because clicking the HIGH dot still calls `onSelectThinking('HIGH')` and then clears the slash. **However**, that test renders with `value="/think"` and **no `thinking` prop** (switch starts off) — the effort row must still be present in the DOM (dimmed) and its hit-targets must still fire `onSelectThinking` so a user can switch reasoning on by directly picking a level. Implement the dot click to call `onSelectThinking(level)` regardless of current switch state (picking a level implies turning thinking on).

- [ ] **Step 1: Write the failing tests**

Add to `packages/ui/test/chat-composer.test.tsx`:

```tsx
  it('renders the Thinking switch and the Усилия dots stepper in the slash menu', async () => {
    render(
      <ChatComposer
        value="/"
        attachments={[]}
        onValueChange={() => {}}
        onAttachmentsChange={() => {}}
        onSend={vi.fn()}
        reasoningSupported
        thinking={{ effort: 'MEDIUM' }}
        onSelectThinking={vi.fn()}
        onClearThinking={vi.fn()}
      />,
    )
    expect(await screen.findByTestId('chat-slash-thinking-toggle')).toBeTruthy()
    // the dots stepper (canonical MUI) is present
    expect(document.querySelector('.MuiMobileStepper-dots')).toBeTruthy()
    // the level word is shown in the label
    expect(screen.getByText(/Усилия/)).toBeTruthy()
  })

  it('turns thinking OFF when the switch is toggled while active', async () => {
    const user = userEvent.setup()
    const onClearThinking = vi.fn()
    render(
      <ChatComposer
        value="/"
        attachments={[]}
        onValueChange={() => {}}
        onAttachmentsChange={() => {}}
        onSend={vi.fn()}
        reasoningSupported
        thinking={{ effort: 'MEDIUM' }}
        onSelectThinking={vi.fn()}
        onClearThinking={onClearThinking}
      />,
    )
    const toggle = await screen.findByTestId('chat-slash-thinking-toggle')
    await user.click(toggle)
    expect(onClearThinking).toHaveBeenCalledTimes(1)
  })

  it('turns thinking ON with MEDIUM when the switch is toggled while inactive', async () => {
    const user = userEvent.setup()
    const onSelectThinking = vi.fn()
    render(
      <ChatComposer
        value="/"
        attachments={[]}
        onValueChange={() => {}}
        onAttachmentsChange={() => {}}
        onSend={vi.fn()}
        reasoningSupported
        onSelectThinking={onSelectThinking}
        onClearThinking={vi.fn()}
      />,
    )
    const toggle = await screen.findByTestId('chat-slash-thinking-toggle')
    await user.click(toggle)
    expect(onSelectThinking).toHaveBeenCalledWith('MEDIUM')
  })

  it('selects an effort level by clicking its dot', async () => {
    const user = userEvent.setup()
    const onSelectThinking = vi.fn()
    render(
      <ChatComposer
        value="/"
        attachments={[]}
        onValueChange={() => {}}
        onAttachmentsChange={() => {}}
        onSend={vi.fn()}
        reasoningSupported
        thinking={{ effort: 'MEDIUM' }}
        onSelectThinking={onSelectThinking}
        onClearThinking={vi.fn()}
      />,
    )
    const high = await screen.findByTestId('chat-slash-thinking-high')
    await user.click(high)
    expect(onSelectThinking).toHaveBeenCalledWith('HIGH')
  })
```

The existing test "shows the Thinking slash command when the input starts with '/' and reasoning is supported" stays — it now exercises the dot hit-target (`chat-slash-thinking-high`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @repo/ui exec vitest run test/chat-composer.test.tsx -t "switch"`
Expected: FAIL — `chat-slash-thinking-toggle` / `.MuiMobileStepper-dots` don't exist yet.

- [ ] **Step 3: Add imports**

In `chat-composer.tsx`, add to the import block (keep direct-import style):

```tsx
import ButtonBase from '@mui/material/ButtonBase'
import MobileStepper from '@mui/material/MobileStepper'
import Switch from '@mui/material/Switch'
import Box from '@mui/material/Box'
```

(If `Box` is already imported, skip that line.)

- [ ] **Step 4: Add an ordered-effort constant and helpers**

Below the existing `THINKING_EFFORT_LABEL` map (line ~68), add:

```tsx
const THINKING_EFFORT_ORDER: ReadonlyArray<ChatComposerThinkingEffort> = ['LOW', 'MEDIUM', 'HIGH']
```

- [ ] **Step 5: Replace the slash `Menu` reasoning body**

In `ChatComposerInner`, replace the entire slash `<Menu>…</Menu>` block (the one anchored to `textAreaWrapRef`, lines ~280-319) with the version below. The `Menu` wrapper, its props, the `Команды` `ListSubheader`, and the `reasoningSupported === false` disabled branch are preserved; only the enabled reasoning section changes.

```tsx
      <Menu
        anchorEl={textAreaWrapRef.current}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        disableAutoFocus
        disableEnforceFocus
        id={slashMenuId}
        onClose={() => composer.setValue('')}
        open={slashOpen && thinkingMatchesQuery}
        slotProps={{ paper: { 'data-testid': 'chat-slash-menu' } as Record<string, unknown> }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <ListSubheader disableSticky>Команды</ListSubheader>
        {reasoningSupported ? (
          [
            <Stack
              alignItems="center"
              direction="row"
              justifyContent="space-between"
              key="thinking-row"
              sx={{ px: 2, py: 0.5 }}
            >
              <Stack alignItems="center" direction="row" spacing={1}>
                <PsychologyRoundedIcon fontSize="small" />
                <Box component="span" sx={{ fontWeight: 600 }}>
                  Thinking
                </Box>
              </Stack>
              <Switch
                checked={thinking != null}
                data-testid="chat-slash-thinking-toggle"
                edge="end"
                onChange={(event) => {
                  if (event.target.checked) {
                    onSelectThinking?.(thinking?.effort ?? 'MEDIUM')
                  } else {
                    onClearThinking?.()
                  }
                }}
                size="small"
              />
            </Stack>,
            <Stack
              alignItems="center"
              direction="row"
              justifyContent="space-between"
              key="effort-row"
              sx={{
                opacity: thinking != null ? 1 : 0.4,
                pointerEvents: thinking != null ? 'auto' : 'none',
                px: 2,
                py: 0.5,
              }}
            >
              <Box component="span" sx={{ fontWeight: 600 }}>
                Усилия{' '}
                <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400 }}>
                  ({THINKING_EFFORT_LABEL[thinking?.effort ?? 'MEDIUM'].toLowerCase()})
                </Box>
              </Box>
              <Box sx={{ position: 'relative' }}>
                <MobileStepper
                  activeStep={THINKING_EFFORT_ORDER.indexOf(thinking?.effort ?? 'MEDIUM')}
                  backButton={<span />}
                  nextButton={<span />}
                  position="static"
                  steps={THINKING_EFFORT_ORDER.length}
                  sx={{ background: 'transparent', p: 0, '& .MuiMobileStepper-dots': { gap: 0.5 } }}
                  variant="dots"
                />
                <Stack
                  direction="row"
                  spacing={0.5}
                  sx={{ inset: 0, position: 'absolute' }}
                >
                  {THINKING_EFFORT_ORDER.map((effort) => (
                    <ButtonBase
                      aria-label={THINKING_EFFORT_LABEL[effort]}
                      data-testid={`chat-slash-thinking-${effort.toLowerCase()}`}
                      key={effort}
                      onClick={() => handleSelectThinking(effort)}
                      sx={{ borderRadius: '50%', flex: 1 }}
                    />
                  ))}
                </Stack>
              </Box>
            </Stack>,
          ]
        ) : (
          <MenuItem disabled data-testid="chat-slash-thinking-disabled">
            <ListItemText primary="Thinking" secondary="Недоступно для текущей модели" />
          </MenuItem>
        )}
      </Menu>
```

Note: `handleSelectThinking` (already defined at line ~180) calls `onSelectThinking?.(effort)` then `composer.setValue('')` — clicking a dot both selects the level and closes the menu, matching the prior behaviour. The `THINKING_EFFORTS` array (line ~58) is now unused; delete it to satisfy lint (`THINKING_EFFORT_LABEL` and `THINKING_EFFORT_ORDER` remain).

- [ ] **Step 6: Run the composer tests**

Run: `pnpm --filter @repo/ui exec vitest run test/chat-composer.test.tsx`
Expected: PASS — the four new tests, the updated existing slash test, and every other composer test.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/components/chat/chat-composer.tsx \
        packages/ui/test/chat-composer.test.tsx
git commit -m "feat(chat): slash Thinking as a switch + no-arrow dots effort stepper"
```

---

## Task 6: Empty state — random greeting, no comment icon

**Files:**
- Modify: `packages/ui/src/components/chat/chat-empty-state.tsx` (full rewrite)
- Test: `packages/ui/test/chat-empty-state.test.tsx` (new file)

Drop the `ChatBubbleOutlineIcon` + circle. Show one of four phrases as a large heading, chosen once on mount (SSR-safe via the loading-phrases pattern: empty first paint, set in `useEffect`, `suppressHydrationWarning`).

- [ ] **Step 1: Write the failing test (new file)**

Create `packages/ui/test/chat-empty-state.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  CHAT_EMPTY_PHRASES,
  ChatEmptyState,
} from '../src/components/chat/chat-empty-state'

describe('ChatEmptyState', () => {
  it('renders one of the greeting phrases', async () => {
    render(<ChatEmptyState />)
    const heading = await screen.findByRole('heading')
    expect(CHAT_EMPTY_PHRASES).toContain(heading.textContent)
  })

  it('does not render a comment icon', () => {
    const { container } = render(<ChatEmptyState />)
    expect(container.querySelector('[data-testid="ChatBubbleOutlineIcon"]')).toBeNull()
  })

  it('exposes exactly the four agreed phrases', () => {
    expect(CHAT_EMPTY_PHRASES).toEqual([
      'Над чем ты работаешь?',
      'Что у тебя сегодня на уме?',
      'С чего начнём?',
      'Готов, когда ты готов',
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/ui exec vitest run test/chat-empty-state.test.tsx`
Expected: FAIL — `CHAT_EMPTY_PHRASES` is not exported; the component still renders the icon + fixed title.

- [ ] **Step 3: Rewrite the component**

Replace the entire contents of `packages/ui/src/components/chat/chat-empty-state.tsx` with:

```tsx
'use client'

import Typography from '@mui/material/Typography'
import { useEffect, useState } from 'react'

export const CHAT_EMPTY_PHRASES = [
  'Над чем ты работаешь?',
  'Что у тебя сегодня на уме?',
  'С чего начнём?',
  'Готов, когда ты готов',
] as const

function pickPhrase() {
  const index = Math.floor(Math.random() * CHAT_EMPTY_PHRASES.length)
  return CHAT_EMPTY_PHRASES[index]
}

export function ChatEmptyState() {
  // SSR-safe random: render empty on first paint, choose on mount (matches
  // ChatLoadingPhrases). Avoids a server/client text hydration mismatch.
  const [phrase, setPhrase] = useState<string>('')
  useEffect(() => {
    setPhrase(pickPhrase())
  }, [])

  return (
    <Typography
      align="center"
      component="h2"
      suppressHydrationWarning
      sx={{ fontWeight: 400, px: 3 }}
      variant="h5"
    >
      {phrase}
    </Typography>
  )
}
```

Note: the `title`/`description` props are removed. Task 7 updates the only call sites (`chat-thread.tsx`); `chat-message-list.tsx` also renders `<ChatEmptyState>` in its `overlay` (line ~94) but only when `showEmptyState` is true, and `ChatThread` passes `showEmptyState={false}` — so that overlay path is dormant. Update both call sites to drop the now-removed props in Step 4.

- [ ] **Step 4: Drop the removed props at the message-list call site**

`<ChatEmptyState>` no longer accepts `title`/`description`. In `packages/ui/src/components/chat/chat-message-list.tsx` (~line 94), change the overlay to render it with no props:

```tsx
        overlay={
          showEmptyState && messages.length === 0 ? <ChatEmptyState /> : null
        }
```

Leave the `emptyTitle` / `emptyDescription` fields on `ChatMessageListProps` as-is — they're optional, the web layer still passes them harmlessly, and removing them from the prop chain is out of scope for this polish. Do **not** touch `chat-thread.tsx` here; its empty-state render is replaced wholesale in Task 7.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @repo/ui exec vitest run test/chat-empty-state.test.tsx test/chat-message-list.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/chat/chat-empty-state.tsx \
        packages/ui/src/components/chat/chat-message-list.tsx \
        packages/ui/test/chat-empty-state.test.tsx
git commit -m "feat(chat): randomise empty-state greeting, drop the comment icon"
```

---

## Task 7: Centre the composer when empty, slide it down on first message

**Files:**
- Modify: `packages/ui/src/components/chat/chat-thread.tsx`
- Test: `packages/ui/test/chat-thread.test.tsx` (update two existing tests + add new ones)

When `messages.length === 0`: render a centred column `[greeting] [composer] [disclaimer]` (greeting = `<ChatEmptyState>`), vertically centred, composer **not** sticky. When populated: today's layout (list + sticky composer + disclaimer). On first send the greeting collapses (MUI `Collapse`) and the composer settles to the bottom; honour `prefers-reduced-motion`.

> **Two existing tests change.** `chat-thread.test.tsx` currently asserts (a) the empty hint text "Отправьте первое сообщение…" lives inside `chat-composer-shell` and (b) in empty mode `data-sticky` is still `true`. Under the new design the empty state shows a greeting (one of four phrases, no fixed hint) and the composer is **not** sticky when empty. Update those tests as below.

- [ ] **Step 1: Update the two existing tests + add new ones**

In `packages/ui/test/chat-thread.test.tsx`:

Replace the test `renders the empty hint next to the composer instead of the top message area` (lines ~103-120) with:

```tsx
  it('centres the composer and shows a greeting when there are no messages', () => {
    render(
      <ChatThread
        composerAttachments={[]}
        composerValue=""
        messages={[]}
        onComposerAttachmentsChange={() => {}}
        onComposerValueChange={() => {}}
        onSend={() => {}}
        scrollContainerSelector=".page-content-scroll"
        scrollKey="chat-empty"
      />,
    )

    // greeting heading present (one of the four phrases is chosen on mount)
    expect(screen.getByTestId('chat-empty-greeting')).toBeTruthy()
    // composer is NOT sticky in the empty/centred layout
    expect(screen.getByTestId('chat-composer-shell').getAttribute('data-sticky')).toBe('false')
    // the AI disclaimer is still shown
    expect(screen.getByText(/AnyNote это ИИ/)).toBeTruthy()
  })

  it('drops the centred greeting once a message exists', () => {
    render(
      <ChatThread
        composerAttachments={[]}
        composerValue=""
        messages={[
          { id: 'm1', role: 'assistant', parts: [{ type: 'text', text: 'hi' }] },
        ]}
        onComposerAttachmentsChange={() => {}}
        onComposerValueChange={() => {}}
        onSend={() => {}}
        scrollContainerSelector=".page-content-scroll"
        scrollKey="chat-1"
      />,
    )
    expect(screen.queryByTestId('chat-empty-greeting')).toBeNull()
    expect(screen.getByTestId('chat-composer-shell').getAttribute('data-sticky')).toBe('true')
  })
```

The other two existing tests (page-scroll/sticky with a seeded message; `fills the available height …` with `messages={[]}`) — the height test renders with `messages={[]}`, so it now hits the empty branch. Keep it but relax it to the empty layout: replace its body's assertions with a check that the thread still fills height:

```tsx
  it('fills the available height in page scroll mode', () => {
    render(
      <ChatThread
        composerAttachments={[]}
        composerValue=""
        messages={[
          { id: 'm1', role: 'assistant', parts: [{ type: 'text', text: 'hi' }] },
        ]}
        onComposerAttachmentsChange={() => {}}
        onComposerValueChange={() => {}}
        onSend={() => {}}
        scrollContainerSelector=".page-content-scroll"
        scrollKey="chat-1"
      />,
    )

    const thread = screen.getByTestId('chat-thread')
    const styles = getComputedStyle(thread)
    expect(styles.flexGrow).toBe('1')
    expect(styles.minHeight).toBe('0')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @repo/ui exec vitest run test/chat-thread.test.tsx`
Expected: FAIL — `chat-empty-greeting` test-id doesn't exist; `data-sticky` is `true` in empty mode.

- [ ] **Step 3: Rewrite the `ChatThread` return to branch on empty**

In `packages/ui/src/components/chat/chat-thread.tsx`:

(a) Add imports at the top (keep existing ones):

```tsx
import Collapse from '@mui/material/Collapse'
import useMediaQuery from '@mui/material/useMediaQuery'
```

(b) Replace the `import { ChatEmptyState } from './chat-empty-state'` line — it now takes no props (already updated in Task 6), so the import stays the same.

(c) Inside the `ChatThread` component body, after `const usesPageScroll = Boolean(scrollContainerSelector)`, add:

```tsx
  const isEmpty = messages.length === 0
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
```

(d) Replace the entire `return ( <Stack …> … </Stack> )` block with:

```tsx
  const disclaimer = (
    <Typography
      color="text.secondary"
      component="p"
      sx={{ fontSize: 11, mt: 0.75, textAlign: 'center' }}
    >
      AnyNote это ИИ и может ошибаться. Проверяйте ответ дважды
    </Typography>
  )

  const composer = (
    <ChatComposer
      attachments={composerAttachments}
      disabled={disabled}
      onAttachRecent={onComposerAttachRecent}
      onAttachmentsChange={onComposerAttachmentsChange}
      onClearThinking={onComposerClearThinking}
      onSelectThinking={onComposerSelectThinking}
      onSend={onSend}
      onValueChange={onComposerValueChange}
      placeholder={composerPlaceholder}
      reasoningSupported={composerReasoningSupported}
      recentFiles={composerRecentFiles}
      thinking={composerThinking}
      value={composerValue}
    />
  )

  return (
    <Stack
      data-testid="chat-thread"
      flex={usesPageScroll ? 1 : undefined}
      height={usesPageScroll ? undefined : '100%'}
      minHeight={0}
      spacing={0}
      sx={{ position: 'relative' }}
    >
      {isEmpty ? null : (
        <ChatMessageList
          emptyDescription={emptyDescription}
          emptyTitle={emptyTitle}
          messages={messages}
          onConfirm={onConfirm}
          renderLink={renderLink}
          showEmptyState={false}
          scrollMode={usesPageScroll ? 'page' : 'internal'}
        />
      )}
      <Box
        data-sticky={!isEmpty && usesPageScroll ? 'true' : 'false'}
        data-testid="chat-composer-shell"
        sx={(theme) => ({
          bottom: 0,
          display: 'flex',
          flexDirection: 'column',
          mt: 'auto',
          ...(isEmpty
            ? { justifyContent: 'center', flex: 1, mt: 0 }
            : null),
          pb: { xs: 1.5, sm: 2 },
          position: !isEmpty && usesPageScroll ? 'sticky' : 'static',
          pt: 2,
          px: 2,
          transition: prefersReducedMotion
            ? 'none'
            : theme.transitions.create(['flex-grow'], {
                duration: theme.transitions.duration.standard,
              }),
          zIndex: theme.zIndex.appBar - 1,
          ...(!isEmpty && usesPageScroll
            ? {
                background: `linear-gradient(180deg, ${alpha(
                  theme.palette.background.default,
                  0,
                )} 0%, ${alpha(theme.palette.background.default, 0.96)} 30%, ${
                  theme.palette.background.default
                } 100%)`,
              }
            : null),
        })}
      >
        <Collapse in={isEmpty} unmountOnExit>
          <Box data-testid="chat-empty-greeting" sx={{ mb: 2 }}>
            <ChatEmptyState />
          </Box>
        </Collapse>
        {!isEmpty && usesPageScroll ? (
          <Fade in={showScrollDown} unmountOnExit>
            <Fab
              aria-label="Прокрутить вниз"
              color="primary"
              onClick={handleScrollDown}
              size="small"
              sx={{
                left: '50%',
                position: 'absolute',
                top: -18,
                transform: 'translateX(-50%)',
              }}
            >
              <KeyboardArrowDownRoundedIcon />
            </Fab>
          </Fade>
        ) : null}
        {composer}
        {disclaimer}
      </Box>
    </Stack>
  )
```

This keeps the composer in a single DOM position across both modes (so the browser can tween it), centres the shell when empty (`flex: 1; justify-content: center`), and collapses the greeting away on first message.

- [ ] **Step 4: Run the thread tests**

Run: `pnpm --filter @repo/ui exec vitest run test/chat-thread.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the whole chat suite to catch regressions**

Run: `pnpm --filter @repo/ui exec vitest run test/chat-thread.test.tsx test/chat-message-list.test.tsx test/chat-empty-state.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/chat/chat-thread.tsx \
        packages/ui/test/chat-thread.test.tsx
git commit -m "feat(chat): centre composer when empty, slide it down on first message"
```

---

## Task 8: Cap the confirmation panel width

**Files:**
- Modify: `packages/ui/src/components/chat/chat-confirm-inline.tsx:22-32` (outer `Box` `sx`)
- Test: `packages/ui/test/chat-confirm-inline.test.tsx`

The panel stretches to the full assistant column. Add `maxWidth` so it sizes to content; keep it left-aligned.

- [ ] **Step 1: Write the failing test**

Add to `packages/ui/test/chat-confirm-inline.test.tsx` inside `describe('ChatConfirmInline', …)`:

```tsx
  it('caps the panel width so it does not stretch the full column', () => {
    renderInline()
    const panel = screen.getByTestId('chat-confirm-inline')
    expect(getComputedStyle(panel).maxWidth).toBe('440px')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @repo/ui exec vitest run test/chat-confirm-inline.test.tsx -t "caps the panel width"`
Expected: FAIL — no `max-width` set (`getComputedStyle` returns `none` / empty).

- [ ] **Step 3: Add `maxWidth` to the outer Box**

In `chat-confirm-inline.tsx`, the outer `Box` `sx` (lines ~24-31) — add `maxWidth: 440`:

```tsx
      sx={{
        bgcolor: (theme) => alpha(theme.palette.warning.light, 0.12),
        border: 1,
        borderColor: 'warning.light',
        borderRadius: 2.5,
        maxWidth: 440,
        my: 1,
        p: 1.75,
      }}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @repo/ui exec vitest run test/chat-confirm-inline.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/chat/chat-confirm-inline.tsx \
        packages/ui/test/chat-confirm-inline.test.tsx
git commit -m "fix(chat): cap the confirmation panel width to its content"
```

---

## Task 9: White (paper) canvas on all workspace pages

**Files:**
- Modify: `apps/web/src/components/workspace/workspace-layout-client.tsx:178-184`

The `<Box component="main" className="page-content-scroll">` inherits the cream `background.default`. Set it to `background.paper` (white in light mode, dark surface in dark mode — theme-aware, not hardcoded `#fff`).

There is no web unit test for this layout box; verify by reading the rendered route (the gate is `pnpm dev` + curl, per CLAUDE.md's RSC note). The change is a single style prop.

- [ ] **Step 1: Add the background to the main box**

In `apps/web/src/components/workspace/workspace-layout-client.tsx`, the `<Box component="main" …>` (lines ~178-184) currently has:

```tsx
          sx={{ flex: 1, minHeight: 0, minWidth: 0, overflowY: 'auto', overflowX: 'hidden' }}
```

Change to:

```tsx
          sx={{
            bgcolor: 'background.paper',
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            overflowX: 'hidden',
            overflowY: 'auto',
          }}
```

- [ ] **Step 2: Type-check the web app**

Run: `pnpm --filter web check-types`
Expected: PASS (no type errors). If it reports a stale `.next/types` error for an unrelated deleted route, `rm -rf apps/web/.next/types` and re-run (per CLAUDE.md).

- [ ] **Step 3: Manually verify the route renders white**

Run (background): `pnpm --filter web dev` (needs `docker compose up -d` first).
Then load a workspace chat route in the browser and confirm the main content area is white in light mode. Stop the dev server when done.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/workspace/workspace-layout-client.tsx
git commit -m "feat(workspace): white (paper) canvas on all workspace pages"
```

---

## Task 10: Extend the E2E timeline spec (user message has no rail)

**Files:**
- Modify: `apps/e2e/chat-timeline.spec.ts`

The spec already seeds a chat with a USER message ("Найди страницы про roadmap…") and an ASSISTANT message with interleaved parts, then asserts the assistant timeline. Add one assertion that the **user** message renders **without** a timeline dot, proving item 1 end-to-end while confirming the assistant timeline still works.

- [ ] **Step 1: Add the user-message assertion**

In `apps/e2e/chat-timeline.spec.ts`, at the end of the existing `test('assistant timeline renders interleaved parts …')` (after the `filledError` assertion, line ~157), add:

```ts
  // Item 1: the USER message renders WITHOUT a timeline rail. The user bubble holds
  // its text but no MUI timeline dot. Assistant dots exist (asserted above); scope the
  // "no dot" check to the user bubble by locating its text and walking to its bubble.
  const userText = page.getByText('Найди страницы про roadmap и сделай сводку')
  await expect(userText).toBeVisible()
  const userHasDot = await userText.evaluate((el) => {
    const bubble = el.closest('[class*="MuiChatMessage"]') ?? el.parentElement
    return Boolean(bubble?.querySelector('.MuiTimelineDot-root'))
  })
  expect(userHasDot).toBe(false)
```

- [ ] **Step 2: Run the spec (warm the dev server first)**

Run: `docker compose up -d` then
`pnpm exec playwright test apps/e2e/chat-timeline.spec.ts --retries=1`
Expected: PASS. (The chats route compiles slowly on a cold dev server; `--retries=1` warms the shared server on attempt 1 — dev-only, per the project's cold-compile note. The spec's own timeouts are already generous.)

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/chat-timeline.spec.ts
git commit -m "test(e2e): assert user messages render without a timeline rail"
```

---

## Task 11: Full gates + visual sweep

- [ ] **Step 1: Run the full `@repo/ui` suite**

Run: `pnpm --filter @repo/ui test`
Expected: PASS (all chat tests + the rest of the package).

- [ ] **Step 2: Type-check + lint the touched packages**

Run: `pnpm --filter @repo/ui exec tsc --noEmit && pnpm --filter @repo/ui lint && pnpm --filter web check-types`
Expected: PASS, zero warnings (`--max-warnings 0` is the repo lint policy).

- [ ] **Step 3: Manual visual confirmation against the real app**

With `pnpm dev` (and `docker compose up -d`) running, open a workspace chat and confirm each item against the agreed mockups:
1. user messages have no dot/rail;
2. assistant timeline parts sit closer together;
3. composer ＋ / send buttons are vertically centred with the placeholder;
4. typing `/` shows Thinking + a Switch on row 1 and "Усилия (уровень)" + right-aligned dots (no arrows) on row 2; toggling the switch enables/disables the effort row; clicking a dot picks the level;
5. the send button shows an up-arrow;
6. an empty chat shows one of the four greetings, no comment icon;
7. the empty-chat composer is vertically centred with the disclaimer below, and slides down after the first message;
8. the main content area is white;
9. a tool-confirmation panel is capped in width, not edge-to-edge.

- [ ] **Step 4: Final commit (if any formatting drift)**

```bash
pnpm format
git add -A
git commit -m "chore(chat): formatting after design polish" || echo "nothing to format"
```

---

## Self-review notes (resolved during planning)

- **Spec coverage:** items 1-9 → Tasks 1/2 (1,2), 3-5 (5,3,4 → send/centre/slash), 6 (empty greeting), 7 (centre+slide), 8 (confirm width → Task 8), 9 white canvas → Task 9 (web). E2E for item 1 → Task 10. (Spec item numbering ≠ task numbering; the mapping table at the top is authoritative.)
- **`chat-thread.test.tsx` breakage is intentional and handled** in Task 7 Step 1 (two existing tests rewritten for the new empty layout).
- **Test-id contract** for the slash menu (`chat-slash-thinking-{low,medium,high}`, `-disabled`) is preserved so prior tests and any E2E that depends on them keep working; `-toggle` is added for the Switch.
- **`@mui/material/MobileStepper`, `/Switch`, `/ButtonBase`, `@mui/icons-material/ArrowUpward`** all confirmed resolvable from `@repo/ui` during spec research.
- **Item 8 = `background.paper`** (theme-aware), not hardcoded white, so dark mode stays correct — matches the spec's verified-facts note.
