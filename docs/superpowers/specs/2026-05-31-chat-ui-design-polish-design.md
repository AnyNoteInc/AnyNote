# Chat UI design polish — design

**Date:** 2026-05-31
**Route:** `/workspaces/{workspaceId}/chats/{chatId}`
**Scope:** 9 focused visual/UX tweaks to the chat surface. No behavioural/streaming
changes — purely presentation, plus one new structured slash-menu control.

## Context

The chat UI was rebuilt in the recent "chat timeline + true streaming" cycle
(merged to `main` as `cb89fa5c` / final commits `fef82706`…). It renders every
assistant message as an `@mui/lab` `Timeline` of interleaved parts (text ↔ tool ↔
thinking), with a sticky composer, a slash-command menu for reasoning effort, and
an empty state.

All chat presentation lives in `packages/ui/src/components/chat/`. The web app
(`apps/web`) only wires data into `<ChatThread>` via
`workspace-chat-client.tsx`. The scroll container (`page-content-scroll`) is
defined one level up in `apps/web/src/components/workspace/workspace-layout-client.tsx`
and wraps **every** workspace route (chat, editor, kanban, diagrams…), not just chat.

These components import MUI directly (`import X from '@mui/material/X'`) rather than
through the `@repo/ui` barrel, because `@repo/ui` ships its `src/` through Next's
`transpilePackages` and the chat folder follows that local convention. New MUI
imports in this folder follow the same direct-import style.

### Verified facts (checked against installed packages / theme)

- `@mui/material/MobileStepper` — **present** (`MobileStepper.js`, `mobileStepperClasses.js`).
- `@mui/material/Switch` — present; also already re-exported from `@repo/ui/components`.
- `@mui/icons-material/ArrowUpward` — resolves (this is the default import behind the
  name `ArrowUpwardIcon`). We will import it as `ArrowUpwardIcon`.
- Theme (`packages/ui/src/theme/theme.ts`): this is the **Claude brand palette**, not a
  white app. Light mode `background.default` is **cream `#faf9f5`**; `background.paper`
  is **white `#ffffff`**. Dark mode: canvas `#262624`, paper `#2f2f2c`. So "white
  background" = the **paper** token, applied theme-aware (not a hardcoded `#fff`).

## The 9 changes

### 1. Remove the timeline from user messages

**File:** `packages/ui/src/components/chat/chat-message-content.tsx`

Today `ChatMessageContent` wraps **all** parts — user and assistant — in a
`Timeline` with a `TimelineDot` + `TimelineConnector` rail. For a user message
(always a single text part, already inside a rounded bubble) the dot+rail is pure
noise.

**Design:** give `ChatMessageContent` a `variant: 'user' | 'assistant'` prop
(default `'assistant'`). When `'user'`, render the parts **without** the
`Timeline`/`TimelineItem`/`TimelineSeparator`/dot/connector scaffolding — just the
part bodies in a plain `Box`/`Stack`. The assistant path keeps the timeline exactly
as-is. The branch logic for each `part.type` (text/thinking/attacment/tool) is
extracted into a small `renderPartBody(part)` helper so both the timeline path and
the plain path share one renderer and never drift.

`chat-message-list.tsx` passes `variant={isUser ? 'user' : 'assistant'}` (it already
computes `isUser` at line 104).

### 2. Tighter spacing between timeline parts

**File:** `chat-message-content.tsx`

`TimelineContent` currently uses `sx={{ pb: 1.25, pt: 0 }}` — the `pb: 1.25` (10px)
is the inter-part gap and reads as too airy. Reduce to `pb: 0.5` (4px). The dot
column min-height is driven by content, so this also tightens the visual rhythm of
the rail. (Tunable; `0.5` is the target.)

### 3. Fix the composer input row not being vertically centred

**File:** `packages/ui/src/components/chat/chat-composer.tsx` (consumes
`@mui/x-chat` `ChatComposer variant="compact"`)

**Root cause (verified in the installed package):** `@mui/x-chat`'s compact composer
root sets `alignItems: 'flex-end'` on the flex row
(`@mui/x-chat/ChatComposer/ChatComposer.js`). With a single-line, empty textarea the
round Add (＋) and Send buttons hug the **bottom** edge, sitting visibly below the
placeholder's optical centre — this is the "что-то с ней не так".

**Design:** override the compact root to `align-items: center` via the `sx` prop on
`<MuiChatComposer>`. This is the minimal, predictable fix — no JS measurement of the
textarea, no layout thrash. The trade-off: for a tall multiline draft the round
buttons centre vertically against the textarea instead of pinning to the last line.
That is acceptable here — the composer caps at 12 rows and centred buttons read fine —
and it's worth it to keep the fix to a single static style rule.

`sx` target on `MuiChatComposer`:
`{ '&.MuiChatComposer-variantCompact': { alignItems: 'center' } }` (class confirmed in
the installed package: `chatComposerClasses.variantCompact`).

### 4. Slash "Thinking" → Switch + "Усилия" row with a dots MobileStepper

**File:** `chat-composer.tsx` (the slash `Menu`, currently lines ~280-319)

Today the reasoning menu is a `ListSubheader` + three stacked `MenuItem`s
(Низкое/Среднее/Высокое). Replace the reasoning section with a compact two-row
control (the `ListSubheader "Команды"` header stays):

- **Row 1 — Thinking + Switch.** Left: `PsychologyRoundedIcon` + bold label
  "Thinking" (existing styling). Right: a MUI `Switch` bound to "is reasoning on".
  - On → reasoning enabled; effort defaults to the current effort or `MEDIUM`.
  - Off → reasoning disabled.
- **Row 2 — Усилия + dots stepper.** Left: bold label, same font/size/weight as the
  "Thinking" label (theme default, `fontWeight: 600`, 14px), text
  **`Усилия (<уровень>)`** where `<уровень>` is the lowercased current level word
  (низкое/среднее/высокое) rendered slightly lighter (`color: text.secondary`,
  regular weight) inside the same label. Right (pushed to the right edge): a
  `MobileStepper variant="dots"` with **3 steps** (LOW/MED/HIGH) and **no arrow
  buttons** — `nextButton`/`backButton` are required props, so pass empty
  `<span />`s; the dots are made directly clickable to jump to a level.
  - When the Switch is **off**, Row 2 is **dimmed** (`opacity .4`) and
    non-interactive (`pointerEvents: 'none'`), but stays mounted so the menu height
    doesn't jump.

**Clickable dots — the one non-trivial detail.** `MobileStepper variant="dots"`
renders its dots as non-interactive presentation spans; it has no per-dot click API.
The plan must make each dot select its level. Recommended concrete approach: render
the real `MobileStepper` (so the look is the canonical MUI dots and we honour the
"use MobileStepper" requirement), set its `steps={3}` and `activeStep={effortIndex}`,
pass empty `<span />` for `nextButton`/`backButton`, and attach click handling to the
dots via the dot class selector — i.e. render 3 absolutely-overlaid transparent
`<ButtonBase>` hit-targets sized/positioned over the dot row, each calling
`onSelectThinking(level)` with `data-testid="chat-slash-thinking-{level}"`. This keeps
the MUI visual while making the dots behave as a 3-way selector. The **contract** the
plan must satisfy: 3 dots, active = current effort, click a dot → select that effort,
no arrows.

This replaces the three `chat-slash-thinking-{low,medium,high}` `MenuItem`s. **E2E
note:** existing specs/tests select `[data-testid="chat-slash-thinking-low|medium|high"]`
and `[data-testid="chat-thinking-chip"]`. We preserve those `data-testid`s on the new
controls (the Switch carries `chat-slash-thinking-toggle`; each dot carries
`chat-slash-thinking-{level}`) so the reasoning-selection behaviour and its tests keep
working. The disabled-model branch (`reasoningSupported === false`) still shows a
single disabled "Thinking — Недоступно для текущей модели" row.

**Wiring:** the menu already calls `onSelectThinking(effort)` / `onClearThinking()`
(props from `workspace-chat-client.tsx`). The Switch's off→`onClearThinking`,
on→`onSelectThinking(currentOrMedium)`; dots→`onSelectThinking(level)`. No new props
to the web layer; `thinking` (`{ effort } | null`) already tells us on/off + level.

### 5. Replace the Send icon with ArrowUpwardIcon

**File:** `chat-composer.tsx`

Swap `import SendRoundedIcon from '@mui/icons-material/SendRounded'` →
`import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'`, and the
`<SendRoundedIcon />` inside `<ChatComposerSendButton>` → `<ArrowUpwardIcon />`.
`aria-label="Send"` stays.

### 6. Empty state: drop the comment icon, randomise the greeting phrase

**File:** `packages/ui/src/components/chat/chat-empty-state.tsx`

- Remove the `ChatBubbleOutlineIcon` and its circular container entirely.
- Replace the fixed title with a **random** phrase chosen from:
  - «Над чем ты работаешь?»
  - «Что у тебя сегодня на уме?»
  - «С чего начнём?»
  - «Готов, когда ты готов»
- The phrase is picked once per mount. To stay SSR-safe (the project uses
  `suppressHydrationWarning` for client-random content elsewhere, e.g.
  `chat-loading-phrases.tsx`), select the phrase in a `useEffect`/`useState`
  (empty on first paint, set on mount) and render the wrapper with
  `suppressHydrationWarning`, matching the existing loading-phrases pattern. This
  avoids a server/client text mismatch.
- The greeting becomes the large centred heading used by the new empty-state layout
  (item 7), not a small `h6` above an icon.

This component no longer takes a meaningful `title` default; the random phrase is the
title. `description` is dropped from the centred greeting (the AI disclaimer below the
composer — item 7 — carries the secondary line instead).

### 7. Empty state: centre the composer vertically, slide down after first send

**Files:** `chat-thread.tsx` (layout owner), `workspace-chat-client.tsx`
(already centres its outer Box with `minHeight: 100%`).

**Current:** `ChatThread` is a column — message list (flex) on top, sticky composer
shell at the bottom. When `messages.length === 0` it renders `<ChatEmptyState>` *above*
the composer inside the bottom shell, so the composer is already at the bottom.

**Target (confirmed via mockups, variant A):** when there are **no messages**, the
whole stack is vertically centred:

```
        ┌─────────────────────────────┐
        │                             │
        │        С чего начнём?        │   ← large greeting (random phrase, item 6)
        │  ┌───────────────────────┐  │
        │  │ ＋  Спросите…       ↑ │  │   ← composer, vertically centred
        │  └───────────────────────┘  │
        │  AnyNote это ИИ и может…     │   ← AI disclaimer kept here too
        │                             │
        └─────────────────────────────┘
```

After the first message is sent (`messages.length > 0`), the composer animates
**down** to its normal sticky-bottom position and the message list fills above it.

**Design:**

- Introduce an `isEmpty = messages.length === 0` layout mode in `ChatThread`.
- **Empty mode:** the message list is hidden/zero-height; a centred column holds
  `[greeting] [composer] [disclaimer]`, vertically centred in the available height
  (`justify-content: center`, `flex: 1`). The composer shell loses its sticky
  positioning and bottom gradient in this mode.
- **Populated mode:** exactly today's layout — list (flex, scrolls in
  `page-content-scroll`) + sticky composer + disclaimer.
- **The slide-down animation:** the transition happens once, when `isEmpty` flips
  `true→false` on first send. Approach: wrap the greeting in MUI `Collapse` so it
  animates height→0 + opacity→0 as it leaves, and keep the composer settling to the
  bottom via `mt: auto` with a `transition` on its transform so the move is smooth
  (~240ms, from `theme.transitions`). The composer stays in a single DOM position
  across both modes (it is not unmounted/remounted), so the browser can tween it.
  Respect `prefers-reduced-motion` (skip the transition), matching the composer's own
  reduced-motion handling.
- The empty greeting must not appear once any message exists (including while the
  first assistant response streams) — gate purely on `messages.length === 0`.

This is the most involved item; the plan will treat it as its own phase with an E2E
check (empty chat centres the composer; after send it's at the bottom).

### 8. White background on the main content area, all pages

**File:** `apps/web/src/components/workspace/workspace-layout-client.tsx`

The `<Box component="main" className="page-content-scroll">` (lines ~178-184)
currently has no background and inherits the cream canvas (`background.default`).

**Design:** set `bgcolor: 'background.paper'` on that Box. Because the theme's paper
token is white in light mode and `#2f2f2c` in dark mode, this gives a white surface in
light mode (the request) while staying correct in dark mode — **do not** hardcode
`#fff`. This affects **all** workspace pages (chat, editor, kanban, diagrams), which
matches the request ("на всех страницах"). Page renderers that set their own
background continue to override locally; this only changes the default canvas behind
them.

### 9. Confirmation box width — fit the content, not the full column

**File:** `packages/ui/src/components/chat/chat-confirm-inline.tsx`

The inline tool-confirmation (`ChatConfirmInline`, "⚠️ Требуется подтверждение" +
summary + optional args preview + Разрешить/Отклонить buttons) is rendered as a tool
part inside the assistant timeline. Its outer `Box` has no width constraint, so it
stretches to the **full width** of the assistant content column (assistant messages
use `maxWidth: '100%'`). On a wide window the warning panel runs edge-to-edge and
reads as oversized for the little text it holds.

**Design:** cap the panel width so it sizes to its content rather than the full
column. Set a `maxWidth` on the outer `Box` (~`440px`, tunable; expressed via the
theme spacing/`maxWidth` token) and keep it left-aligned (no `mx: auto`). The panel
still grows down to the container width on narrow/mobile screens — the cap only bites
when there's room to spare — so the existing `flexWrap` button row still wraps
gracefully. The `argsPreview` `<pre>` keeps `overflow: auto`, so long JSON scrolls
inside the capped width instead of forcing the panel wider.

No change to the confirm/deny wiring or the `data-testid="chat-confirm-inline"` hook.

## Out of scope / non-goals

- No changes to streaming, SSE, persistence, tool execution, or confirmation flow.
- No changes to message bubble shape/colours beyond removing the user-message
  timeline (item 1).
- No new web→server props; reasoning on/off/level continues to flow through the
  existing `onSelectThinking`/`onClearThinking`/`thinking` contract.
- Dark-mode visual audit beyond using the correct `background.paper` token.

## Testing

- **Unit (`@repo/ui`, vitest):** the chat component tests live alongside; update/extend
  for: user-message rendering has no `Timeline`/dot; empty state renders one of the 4
  phrases and no comment icon; the slash control renders a Switch + dots and selecting
  a dot calls `onSelectThinking(level)`, toggling the Switch off calls
  `onClearThinking`.
- **E2E (Playwright, `apps/e2e`):** the chat timeline spec from the last cycle asserts
  assistant timeline order + tool dots — keep it green (item 1/2 must not break the
  assistant timeline). Add assertions: empty chat centres the composer and shows a
  greeting; after sending, composer is at the bottom and greeting is gone; the new
  reasoning Switch + dots are reachable via the preserved `data-testid`s.
  - Note (`feedback_e2e_no_yjs_persistence`): the Playwright webServer is just
    `next dev` with no yjs server — assert the in-page empty→populated transition
    without relying on reload persistence.
- **Gates:** `pnpm --filter @repo/ui test`, `pnpm --filter web test`, plus
  `pnpm check-types && pnpm lint`. Run the chat E2E spec warm/isolated
  (`feedback_e2e_cold_compile_retries`).

## Files touched (summary)

| File | Items |
|---|---|
| `packages/ui/src/components/chat/chat-message-content.tsx` | 1, 2 |
| `packages/ui/src/components/chat/chat-message-list.tsx` | 1 (pass `variant`) |
| `packages/ui/src/components/chat/chat-composer.tsx` | 3, 4, 5 |
| `packages/ui/src/components/chat/chat-empty-state.tsx` | 6, 7 (greeting) |
| `packages/ui/src/components/chat/chat-thread.tsx` | 7 (centred layout + slide-down) |
| `apps/web/.../workspace/workspace-layout-client.tsx` | 8 |
| `packages/ui/src/components/chat/chat-confirm-inline.tsx` | 9 |
| `packages/ui/src/components/index.ts` | add `MobileStepper` re-export iff needed by tests |
| chat unit tests + chat E2E spec | all |
