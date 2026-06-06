# Sidebar & Page UX Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship five independent UX changes: a templates management page, an always-mini page outline with a hover popover, a datetime-node time-edit fix, restyled sidebar section buttons, and a space menu backed by a full-screen settings modal.

**Architecture:** All work is in `apps/web` plus one editor fix in `@repo/editor` and three additive tRPC/domain procedures in `@repo/trpc`/`@repo/domain`. The template editor reuses the existing `AnyNotePlainEditor` (single-user, JSON in/out — no Hocuspocus); `contentYjs` for templates is derived server-side. The settings modal reuses the existing section components, fed by client tRPC queries and the existing `usePlanFeatures()` context.

**Tech Stack:** Next.js 16 App Router, React 19, MUI v6, tRPC v11, Prisma 7, `@repo/domain` (inversify DI + UnitOfWork), Tiptap, vitest.

**Spec:** `docs/superpowers/specs/2026-06-06-sidebar-and-page-ux-improvements-design.md`

**Conventions:** Prettier (`semi: false`, single quotes, 100-col). Commit per logical step (Conventional Commits with scope). Run `pnpm --filter <ws> test`/`check-types` as noted. Final gate: `pnpm gates`.

**Ordering note:** Parts 3 (datetime), 2 (outline), 1 (templates), 4 (sidebar buttons), 5 (space menu + settings modal). Parts 4 and 5 both edit `workspace-sidebar.tsx`; do 4 before 5. Each part is independently shippable.

---

## Part 3 — DateTime node time-edit fix

Smallest, fully isolated. Do first.

### Task 3.1: Fix the datetime picker initialization race

**Files:**
- Modify: `packages/editor/src/extensions/date.tsx:73-80` (Popover open condition)
- Modify: `packages/editor/src/components/date-picker-body.tsx:38-56` (picker `key`)

- [ ] **Step 1: Gate the Popover so it never mounts the picker with a null draft**

In `packages/editor/src/extensions/date.tsx`, change the `Popover` `open` prop. Current:

```tsx
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
```

Change to:

```tsx
      <Popover
        open={Boolean(anchor) && draft !== null}
        anchorEl={anchor}
```

Rationale: `setDraft(current)` runs in the same click handler as `setAnchor`, but the picker must never mount with `value={null}` or `StaticDateTimePicker` fails to wire up its time controls. Gating on `draft !== null` guarantees the picker's first render has a real `Date`.

- [ ] **Step 2: Force a clean picker mount per mode**

In `packages/editor/src/components/date-picker-body.tsx`, add a `key` to each conditional picker so MUI re-mounts cleanly. Current:

```tsx
        {mode === 'datetime' ? (
          <StaticDateTimePicker
            value={value}
```

Change to:

```tsx
        {mode === 'datetime' ? (
          <StaticDateTimePicker
            key="datetime"
            value={value}
```

And the date branch:

```tsx
        ) : (
          <StaticDatePicker
            key="date"
            value={value}
```

- [ ] **Step 3: Type-check the editor package**

Run: `pnpm --filter @repo/editor exec tsc --noEmit` (or `pnpm --filter web check-types` if the editor has no standalone tsc script)
Expected: PASS (no type errors).

- [ ] **Step 4: Manual browser verification**

This bug is not reproducible in unit tests (MUI static picker internals). Verify in the running app:
1. `docker compose up -d` then `pnpm --filter web dev`.
2. Open a TEXT page, type `/` and insert a datetime (date+time) node.
3. Click the node → the popover opens with the calendar AND clock.
4. Change the **time** (hours/minutes) and the date; click "Сохранить".
5. Reopen the node — both date and time are preserved.
6. Repeat with a plain **date** node — still works, no time controls.
7. Also check the slash-insert flow if it uses `DatePickerBody` (`DateInsertPopover`).

Expected: time is editable; both values persist.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/extensions/date.tsx packages/editor/src/components/date-picker-body.tsx
git commit -m "fix(editor): allow editing time in datetime node

StaticDateTimePicker mounted with a null value before draft state
settled, leaving its time controls inert. Gate the Popover on a
non-null draft and key the pickers per mode for a clean mount.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Part 2 — Always-mini page outline + hover popover

Removes the outline-mode toggle entirely and makes the mini outline reveal the full list on hover.

### Task 2.1: Remove the outline-mode toggle from the page actions menu

**Files:**
- Modify: `apps/web/src/components/page/page-actions-menu.tsx`

- [ ] **Step 1: Remove the ButtonGroup block**

In `apps/web/src/components/page/page-actions-menu.tsx`, delete the entire `pageType === 'TEXT'` outline block (lines ~190-245, the `<Box component="li">` containing "Навигация" + the three-button `ButtonGroup`). Delete from this opening:

```tsx
        {pageType === 'TEXT' ? (
          <Box
            component="li"
            sx={{
              listStyle: 'none',
```

through its closing `) : null}` that ends the ButtonGroup block (the one immediately before `<Divider />` and the "Экспортировать" MenuItem). Do NOT remove the `<Divider />` or the Export MenuItem that follow.

- [ ] **Step 2: Remove now-unused imports and the hook**

Remove `useOutlineMode` import and its usage. Delete this line near the top:

```tsx
import { useOutlineMode } from '@/hooks/use-outline-mode'
```

Delete this line inside the component:

```tsx
  const [outlineMode, setOutlineMode] = useOutlineMode(pageId)
```

Remove now-unused icon/component imports from the `@repo/ui/components` import block: `ButtonGroup`, `DehazeIcon`, `TocIcon`, `VisibilityOffIcon`. (Keep `Tooltip` and `Button` only if still used elsewhere in the file — `Tooltip` is not used elsewhere here, `Button` is not used elsewhere here, so remove both too. Verify by searching the file for each identifier before removing.)

- [ ] **Step 3: Type-check**

Run: `pnpm --filter web check-types`
Expected: PASS. If you see `'X' is declared but never read`, remove that import.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/page/page-actions-menu.tsx
git commit -m "refactor(web): remove page outline mode toggle from actions menu

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 2.2: Make EditorOutline always-mini with a hover popover

**Files:**
- Modify: `apps/web/src/components/page/editor-outline.tsx`

This rewrites `editor-outline.tsx`. The component drops its `mode` prop, always renders the mini bars, and reveals the full list in a `Popover` on hover (with a close delay; the delay cancels if the pointer enters the panel — a hover bridge).

- [ ] **Step 1: Replace the file contents**

Write `apps/web/src/components/page/editor-outline.tsx` with:

```tsx
'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { Editor } from '@repo/editor'
import { Box, Popover, Tooltip, Typography } from '@repo/ui/components'

const SCROLL_CONTAINER_CLASS = 'page-content-scroll'
const ACTIVE_OFFSET_PX = 96
// Smooth scroll typically settles in 200–400ms. Wait beyond that before
// placing the editor cursor — focusing earlier dispatches the browser's
// "scroll into view on focus" which interrupts the smooth animation and
// leaves the page parked at the wrong position.
const FOCUS_DEFER_MS = 450
// Grace period before the hover popover closes, so the pointer can travel
// from the mini bars to the panel without it vanishing (a hover bridge).
const HOVER_CLOSE_MS = 150

const LEVEL_INDENT_PX: Record<1 | 2 | 3, number> = {
  1: 0,
  2: 14,
  3: 28,
}

const MINI_BAR_WIDTH_PX: Record<1 | 2 | 3, number> = {
  1: 48,
  2: 36,
  3: 24,
}

type Heading = {
  level: 1 | 2 | 3
  text: string
  pos: number
}

function extractHeadings(editor: Editor): Heading[] {
  const items: Heading[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return true
    const level = node.attrs.level as number
    if (level === 1 || level === 2 || level === 3) {
      items.push({
        level: level as 1 | 2 | 3,
        text: node.textContent.trim(),
        pos,
      })
    }
    return true
  })
  return items
}

function sameHeadings(a: Heading[], b: Heading[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (x.pos !== y.pos || x.level !== y.level || x.text !== y.text) return false
  }
  return true
}

function getScrollContainer(editor: Editor): HTMLElement | null {
  const el = editor.view.dom.closest(`.${SCROLL_CONTAINER_CLASS}`)
  return el instanceof HTMLElement ? el : null
}

type Props = {
  editor: Editor | null
  // Extra px to shift the outline left from the right edge (e.g. when the
  // comments sidebar is open, so the fixed outline clears the panel).
  rightOffset?: number
}

export function EditorOutline({ editor, rightOffset = 0 }: Props) {
  const [headings, setHeadings] = useState<Heading[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const panelScrollRef = useRef<HTMLElement | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  // Cached query of the editor's heading DOM nodes. Refreshed only when the
  // outline structure actually changes; the scroll handler reads it on every
  // frame and shouldn't pay for a fresh querySelectorAll each time.
  const domHeadingsRef = useRef<HTMLElement[]>([])

  useEffect(() => {
    if (!editor) {
      setHeadings([])
      domHeadingsRef.current = []
      return
    }
    const sync = () => {
      const next = extractHeadings(editor)
      setHeadings((prev) => (sameHeadings(prev, next) ? prev : next))
      domHeadingsRef.current = Array.from(
        editor.view.dom.querySelectorAll<HTMLElement>('h1, h2, h3'),
      )
    }
    sync()
    editor.on('update', sync)
    return () => {
      editor.off('update', sync)
    }
  }, [editor])

  useEffect(() => {
    if (!editor) {
      setActiveIndex(0)
      return
    }
    const container = getScrollContainer(editor)
    if (!container) return

    let raf: number | null = null
    const compute = () => {
      raf = null
      const all = domHeadingsRef.current
      if (all.length === 0) {
        setActiveIndex(0)
        return
      }
      const threshold = container.getBoundingClientRect().top + ACTIVE_OFFSET_PX
      let active = 0
      for (let i = 0; i < all.length; i++) {
        const el = all[i]
        if (!el) continue
        if (el.getBoundingClientRect().top - threshold <= 1) {
          active = i
        } else {
          break
        }
      }
      setActiveIndex(active)
    }
    const onScroll = () => {
      if (raf !== null) return
      raf = window.requestAnimationFrame(compute)
    }
    compute()
    container.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      container.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (raf !== null) window.cancelAnimationFrame(raf)
    }
  }, [editor])

  // Keep the active item visible inside the popover's own scroll viewport.
  useLayoutEffect(() => {
    const container = panelScrollRef.current
    if (!container) return
    const target = container.querySelector<HTMLElement>(`[data-outline-index="${activeIndex}"]`)
    if (!target) return
    const containerRect = container.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const padding = 8
    if (targetRect.top < containerRect.top + padding) {
      container.scrollTop += targetRect.top - containerRect.top - padding
    } else if (targetRect.bottom > containerRect.bottom - padding) {
      container.scrollTop += targetRect.bottom - containerRect.bottom + padding
    }
  }, [activeIndex, anchorEl, headings.length])

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
    }
  }, [])

  if (!editor) return null

  const cancelClose = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }

  const openPanel = (event: React.MouseEvent<HTMLElement>) => {
    cancelClose()
    setAnchorEl(event.currentTarget)
  }

  const scheduleClose = () => {
    cancelClose()
    closeTimerRef.current = window.setTimeout(() => {
      setAnchorEl(null)
      closeTimerRef.current = null
    }, HOVER_CLOSE_MS)
  }

  // Drives the scroll explicitly on `.page-content-scroll` so we never rely on
  // the browser walking up to find the right scrolling ancestor. Focusing mid-
  // animation fights the smooth scroll, so defer it past the animation budget.
  const handleClick = (index: number, heading: Heading) => {
    const target = domHeadingsRef.current[index]
    if (!target) return
    const scrollContainer = getScrollContainer(editor)
    if (scrollContainer) {
      const targetRect = target.getBoundingClientRect()
      const containerRect = scrollContainer.getBoundingClientRect()
      const top = scrollContainer.scrollTop + (targetRect.top - containerRect.top) - 16
      scrollContainer.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
    } else {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    window.setTimeout(() => {
      if (editor.isDestroyed) return
      editor.commands.focus(heading.pos + 1, { scrollIntoView: false })
    }, FOCUS_DEFER_MS)
  }

  const isEmpty = headings.length === 0
  if (isEmpty) return null

  const open = Boolean(anchorEl)

  return (
    <>
      <Box
        component="nav"
        aria-label="Содержание страницы"
        onMouseEnter={openPanel}
        onMouseLeave={scheduleClose}
        sx={{
          position: 'fixed',
          top: 80,
          right: 16 + rightOffset,
          transition: 'right 0.15s ease',
          zIndex: 5,
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          gap: 0.75,
          alignItems: 'flex-end',
          py: 1,
          maxHeight: 'calc(100vh - 96px)',
          overflowY: 'auto',
          pointerEvents: 'auto',
        }}
      >
        {headings.map((heading, index) => {
          const isActive = index === activeIndex
          const label = heading.text || 'Без названия'
          return (
            <Tooltip
              key={`${heading.pos}-${index}`}
              title={label}
              placement="left"
              enterDelay={120}
            >
              <Box
                component="button"
                type="button"
                data-outline-index={index}
                onClick={() => handleClick(index, heading)}
                aria-current={isActive ? 'true' : undefined}
                aria-label={label}
                sx={{
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  p: 0.5,
                  display: 'flex',
                  justifyContent: 'flex-end',
                  alignItems: 'center',
                  minWidth: 32,
                  transition: 'opacity 120ms ease',
                  '&:hover .anynote-outline-bar': {
                    bgcolor: 'text.primary',
                    opacity: 1,
                  },
                  '&:focus-visible .anynote-outline-bar': {
                    bgcolor: 'primary.main',
                    opacity: 1,
                  },
                }}
              >
                <Box
                  className="anynote-outline-bar"
                  sx={{
                    width: MINI_BAR_WIDTH_PX[heading.level],
                    height: 3,
                    borderRadius: 1.5,
                    bgcolor: isActive ? 'primary.main' : 'text.secondary',
                    opacity: isActive ? 1 : 0.45,
                    transition:
                      'background-color 120ms ease, opacity 120ms ease, width 120ms ease',
                  }}
                />
              </Box>
            </Tooltip>
          )
        })}
      </Box>

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        disableRestoreFocus
        sx={{ pointerEvents: 'none' }}
        slotProps={{
          paper: {
            onMouseEnter: cancelClose,
            onMouseLeave: scheduleClose,
            sx: {
              pointerEvents: 'auto',
              width: 264,
              maxHeight: 'calc(100vh - 120px)',
              overflowY: 'auto',
              p: 1,
              mr: 1,
            },
          },
        }}
      >
        <Box ref={panelScrollRef}>
          <Typography
            component="h2"
            sx={{
              color: 'text.secondary',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              px: 1,
              mb: 0.75,
            }}
          >
            Содержание
          </Typography>
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {headings.map((heading, index) => {
              const isActive = index === activeIndex
              const text = heading.text
              const label = text || 'Без названия'
              return (
                <Box component="li" key={`${heading.pos}-${index}`} sx={{ m: 0 }}>
                  <Box
                    component="button"
                    type="button"
                    data-outline-index={index}
                    onClick={() => handleClick(index, heading)}
                    aria-current={isActive ? 'true' : undefined}
                    aria-label={label}
                    sx={{
                      width: '100%',
                      textAlign: 'left',
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      font: 'inherit',
                      color: isActive ? 'text.primary' : 'text.secondary',
                      fontSize: 13,
                      lineHeight: 1.4,
                      py: 0.625,
                      pr: 1,
                      pl: `${10 + LEVEL_INDENT_PX[heading.level]}px`,
                      borderLeft: '2px solid',
                      borderLeftColor: isActive ? 'primary.main' : 'transparent',
                      borderTopRightRadius: 6,
                      borderBottomRightRadius: 6,
                      fontWeight: isActive ? 600 : 400,
                      display: 'block',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      transition:
                        'background-color 120ms ease, color 120ms ease, border-color 120ms ease',
                      '&:hover': {
                        bgcolor: 'action.hover',
                        color: 'text.primary',
                      },
                      '&:focus-visible': {
                        outline: 'none',
                        bgcolor: 'action.hover',
                        color: 'text.primary',
                        boxShadow: (theme) => `inset 0 0 0 2px ${theme.palette.primary.main}`,
                      },
                    }}
                  >
                    {text || (
                      <Box component="span" sx={{ fontStyle: 'italic', opacity: 0.7 }}>
                        Без названия
                      </Box>
                    )}
                  </Box>
                </Box>
              )
            })}
          </Box>
        </Box>
      </Popover>
    </>
  )
}
```

- [ ] **Step 2: Update the caller in page-renderer.tsx**

In `apps/web/src/components/page/page-renderer.tsx`, find:

```tsx
      <EditorOutline
        editor={editor}
        mode={outlineMode}
        rightOffset={panelOpen ? COMMENTS_SIDEBAR_WIDTH : 0}
      />
```

Change to (drop the `mode` prop):

```tsx
      <EditorOutline
        editor={editor}
        rightOffset={panelOpen ? COMMENTS_SIDEBAR_WIDTH : 0}
      />
```

Then remove the now-unused `outlineMode` read and import in that file:
- Delete the import line `import { useOutlineMode } from '@/hooks/use-outline-mode'`.
- Delete `const [outlineMode] = useOutlineMode(page.id)` (around line 124).

- [ ] **Step 3: Remove outline-mode wiring from workspace-layout-client.tsx**

In `apps/web/src/components/workspace/workspace-layout-client.tsx`:
- Delete the import `import { useOutlineMode } from '@/hooks/use-outline-mode'`.
- Delete `const [outlineMode] = useOutlineMode(activePageId ?? '')` (around line 164).
- Remove the `data-outline-mode={activePageId ? outlineMode : undefined}` attribute (around line 198) from the element it's on.

- [ ] **Step 4: Delete the now-orphaned hook and check for CSS keyed on it**

```bash
git rm apps/web/src/hooks/use-outline-mode.ts
grep -rn "use-outline-mode\|useOutlineMode\|OutlineMode\|data-outline-mode\|outline-mode" apps/web/src packages/ui/src
```

Expected: no remaining references (other than this plan). If any CSS in `apps/web` or `@repo/ui` selects `[data-outline-mode=...]`, remove those rules (mini is now always present).

- [ ] **Step 5: Type-check**

Run: `pnpm --filter web check-types`
Expected: PASS.

- [ ] **Step 6: Manual browser verification**

1. Open a TEXT page with several h1/h2/h3 headings.
2. Mini bars appear top-right and always stay (no toggle in the ⋯ menu).
3. Hover the mini bars → full outline popover appears to the left.
4. Move the pointer onto the popover → it stays open; click a heading → page scrolls to it.
5. Move the pointer away → popover closes after a moment.
6. A page with no headings shows nothing.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/page/editor-outline.tsx apps/web/src/components/page/page-renderer.tsx apps/web/src/components/workspace/workspace-layout-client.tsx
git rm --cached apps/web/src/hooks/use-outline-mode.ts 2>/dev/null || true
git commit -m "feat(web): always-mini page outline with hover popover

Removes the off/mini/full outline mode toggle. The mini bars are
always shown and reveal the full table of contents in a hover
popover with a close-delay bridge. Deletes use-outline-mode.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Part 1 — Templates management page

Backend: three additive procedures (`create`, `getById`, `updateContent`). Frontend: a sidebar item, a list page, a single-user editor page (`AnyNotePlainEditor`), and a metadata dialog.

### Task 1.1: Add domain DTOs/inputs for create, getById, updateContent

**Files:**
- Modify: `packages/domain/src/templates/dto/templates.dto.ts`

- [ ] **Step 1: Add input schemas and a content DTO**

In `packages/domain/src/templates/dto/templates.dto.ts`, after the `deleteTemplateInput` block (line ~52), add:

```typescript
export const createTemplateInput = z.object({
  workspaceId: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  icon: z.string().nullable().optional(),
  category: z.string().max(100).nullable().optional(),
})
export type CreateTemplateInput = z.infer<typeof createTemplateInput>

export const getTemplateInput = z.object({
  templateId: z.string().uuid(),
  workspaceId: z.string().uuid(),
})
export type GetTemplateInput = z.infer<typeof getTemplateInput>

export const updateTemplateContentInput = z.object({
  templateId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  // ProseMirror/Tiptap JSON document snapshot. contentYjs is derived from this
  // server-side, so the client only sends JSON.
  content: z.any(),
})
export type UpdateTemplateContentInput = z.infer<typeof updateTemplateContentInput>
```

- [ ] **Step 2: Add a detail DTO for the editor (metadata + content JSON)**

In the same file, after the `TemplateContentDto` interface (end of file), add:

```typescript
/**
 * Template detail used by the management editor: metadata plus the JSON
 * content snapshot (never the Yjs bytes, which the client doesn't read).
 */
export interface TemplateDetailDto {
  id: string
  workspaceId: string | null
  scope: PageTemplateScope
  title: string
  description: string | null
  icon: string | null
  category: string | null
  type: PageType
  content: Prisma.JsonValue | null
}
```

- [ ] **Step 3: Type-check the domain package**

Run: `pnpm --filter @repo/domain exec tsc --noEmit -p tsconfig.json` (or `pnpm --filter @repo/domain check-types` if defined)
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/domain/src/templates/dto/templates.dto.ts
git commit -m "feat(domain): add template create/getById/updateContent DTOs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 1.2: Add repository methods (create, findDetail, updateContent)

**Files:**
- Modify: `packages/domain/src/templates/repositories/templates.repository.ts`

The repo derives `contentYjs` from the JSON content using `TiptapTransformer.toYdoc` + `Y.encodeStateAsUpdate`, mirroring `packages/trpc/src/helpers/welcome-page-content.ts` and `apps/engines/.../page-writer.service.ts`.

- [ ] **Step 1: Add imports for Yjs serialization**

At the top of `packages/domain/src/templates/repositories/templates.repository.ts`, add (match existing import style; the repo currently imports from `@repo/db` and local DTOs):

```typescript
import { TiptapTransformer } from '@hocuspocus/transformer'
import StarterKit from '@tiptap/starter-kit'
import * as Y from 'yjs'
```

NOTE: confirm these three packages are already dependencies of `@repo/domain` (`packages/domain/package.json`). If not present, add them: `pnpm --filter @repo/domain add @hocuspocus/transformer @tiptap/starter-kit yjs`. (They are already used elsewhere in the repo, so versions are pinned in the workspace.) If `@repo/domain` must stay NodeNext-clean with minimal deps (see CLAUDE.md), prefer doing the Yjs derivation in the tRPC layer instead — see the fallback note at the end of this task.

- [ ] **Step 2: Add a content-bytes helper**

Above the `TemplateRepository` class (after imports), add:

```typescript
// Derive Yjs bytes from a Tiptap JSON doc so templates created via the editor
// stay byte-compatible with how pages store content (createPageFromTemplate
// copies both columns into the new page). Returns null for non-doc shapes.
function deriveContentYjs(content: unknown): Uint8Array<ArrayBuffer> | null {
  if (!content || typeof content !== 'object' || (content as { type?: unknown }).type !== 'doc') {
    return null
  }
  try {
    const ydoc = TiptapTransformer.toYdoc(content, 'default', [StarterKit])
    const src = Y.encodeStateAsUpdate(ydoc)
    const out = new Uint8Array(new ArrayBuffer(src.byteLength))
    out.set(src)
    return out
  } catch {
    return null
  }
}
```

- [ ] **Step 3: Add `create`, `findDetail`, `updateContent` methods**

Inside the `TemplateRepository` class, after `softDelete` (line ~214), add:

```typescript
  async create(
    actorUserId: string,
    input: { workspaceId: string; title: string; description?: string | null; icon?: string | null; category?: string | null },
  ): Promise<{ id: string }> {
    return this.uow.client().pageTemplate.create({
      data: {
        scope: PageTemplateScope.WORKSPACE,
        workspaceId: input.workspaceId,
        title: input.title,
        description: input.description ?? null,
        icon: input.icon ?? null,
        category: input.category ?? null,
        type: PageType.TEXT,
        createdById: actorUserId,
        updatedById: actorUserId,
      },
      select: { id: true },
    })
  }

  async findDetail(templateId: string): Promise<TemplateDetailDto | null> {
    const row = await this.uow.client().pageTemplate.findFirst({
      where: { id: templateId, deletedAt: null },
      select: {
        id: true,
        workspaceId: true,
        scope: true,
        title: true,
        description: true,
        icon: true,
        category: true,
        type: true,
        content: true,
      },
    })
    return row as TemplateDetailDto | null
  }

  async updateContent(
    actorUserId: string,
    templateId: string,
    content: Prisma.InputJsonValue,
  ): Promise<{ id: string }> {
    const contentYjs = deriveContentYjs(content)
    return this.uow.client().pageTemplate.update({
      where: { id: templateId },
      data: {
        content,
        contentYjs: contentYjs ?? undefined,
        updatedById: actorUserId,
      },
      select: { id: true },
    })
  }
```

Add `TemplateDetailDto` to the existing type-only import from the DTO file at the top of the repository (find the `import type { ... } from '../dto/templates.dto.ts'` block and add `TemplateDetailDto`). Also ensure `PageType` and `Prisma` are imported from `@repo/db` (the repo already imports `PageTemplateScope` and `Prisma`; add `PageType` if absent).

- [ ] **Step 4: Type-check the domain package**

Run: `pnpm --filter @repo/domain exec tsc --noEmit -p tsconfig.json`
Expected: PASS.

**Fallback (if keeping `@repo/domain` dependency-light):** skip the Yjs imports/helper here; have `updateContent` write only `content` (set `contentYjs: undefined`), and do the `deriveContentYjs` step in the tRPC procedure (Task 1.4) where `@hocuspocus/transformer` is already a dependency, passing the derived bytes into a repo method signature `updateContent(actorUserId, templateId, content, contentYjs)`. Pick one approach and keep it consistent. This plan's primary path puts derivation in the domain repo.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/templates/repositories/templates.repository.ts packages/domain/package.json
git commit -m "feat(domain): template repo create/findDetail/updateContent

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 1.3: Add service methods (TDD)

**Files:**
- Modify: `packages/domain/src/templates/services/templates.service.ts`
- Test: `packages/domain/test/templates/service.test.ts`

- [ ] **Step 1: Write failing tests**

In `packages/domain/test/templates/service.test.ts`, add (adapt the existing `makeRepo`/`makeUow`/`makePages` helpers in that file; add the new repo methods to whatever object `makeRepo` returns):

```typescript
describe('TemplateService.create', () => {
  it('creates an empty workspace template for a writable member', async () => {
    const repo = makeRepo({
      findMembership: vi.fn(async () => ({ role: 'EDITOR' })),
      create: vi.fn(async () => ({ id: 't-new' })),
    })
    const svc = new TemplateService(repo, makeUow(), makePages())
    const res = await svc.create('u1', { workspaceId: 'w1', title: 'Blank' })
    expect(res).toEqual({ id: 't-new' })
    expect(repo.create).toHaveBeenCalledOnce()
  })

  it('rejects a non-member', async () => {
    const repo = makeRepo({ findMembership: vi.fn(async () => null) })
    const svc = new TemplateService(repo, makeUow(), makePages())
    await expect(svc.create('u1', { workspaceId: 'w1', title: 'Blank' })).rejects.toMatchObject({
      name: 'DomainError',
      httpStatus: 403,
    })
  })
})

describe('TemplateService.getById', () => {
  it('returns a workspace template detail for a member', async () => {
    const detail = {
      id: 't1',
      workspaceId: 'w1',
      scope: PageTemplateScope.WORKSPACE,
      title: 'T',
      description: null,
      icon: null,
      category: null,
      type: PageType.TEXT,
      content: { type: 'doc', content: [] },
    }
    const repo = makeRepo({
      findMembership: vi.fn(async () => ({ role: 'EDITOR' })),
      findDetail: vi.fn(async () => detail),
    })
    const svc = new TemplateService(repo, makeUow(), makePages())
    await expect(svc.getById('u1', { templateId: 't1', workspaceId: 'w1' })).resolves.toEqual(detail)
  })

  it('404s when the template is missing', async () => {
    const repo = makeRepo({
      findMembership: vi.fn(async () => ({ role: 'EDITOR' })),
      findDetail: vi.fn(async () => null),
    })
    const svc = new TemplateService(repo, makeUow(), makePages())
    await expect(
      svc.getById('u1', { templateId: 't1', workspaceId: 'w1' }),
    ).rejects.toMatchObject({ httpStatus: 404 })
  })
})

describe('TemplateService.updateContent', () => {
  it('updates content for a writable member', async () => {
    const repo = makeRepo({
      findForWrite: vi.fn(async () => ({ id: 't1', scope: PageTemplateScope.WORKSPACE, workspaceId: 'w1' })),
      findMembership: vi.fn(async () => ({ role: 'EDITOR' })),
      updateContent: vi.fn(async () => ({ id: 't1' })),
    })
    const svc = new TemplateService(repo, makeUow(), makePages())
    const res = await svc.updateContent('u1', {
      templateId: 't1',
      workspaceId: 'w1',
      content: { type: 'doc', content: [] },
    })
    expect(res).toEqual({ id: 't1' })
    expect(repo.updateContent).toHaveBeenCalledOnce()
  })

  it('forbids editing a GLOBAL template', async () => {
    const repo = makeRepo({
      findForWrite: vi.fn(async () => ({ id: 't1', scope: PageTemplateScope.GLOBAL, workspaceId: null })),
    })
    const svc = new TemplateService(repo, makeUow(), makePages())
    await expect(
      svc.updateContent('u1', { templateId: 't1', workspaceId: 'w1', content: {} }),
    ).rejects.toMatchObject({ httpStatus: 403 })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @repo/domain test -- service.test.ts`
Expected: FAIL (methods `create`/`getById`/`updateContent` don't exist).

- [ ] **Step 3: Implement the service methods**

In `packages/domain/src/templates/services/templates.service.ts`:

Add to the type-only DTO import block at the top: `CreateTemplateInput`, `GetTemplateInput`, `UpdateTemplateContentInput`, `TemplateDetailDto`.

Add these methods to the `TemplateService` class. Put `create` and `updateContent` after `update` (line ~149), and `getById` in the reads section after `listGlobal` (line ~73):

```typescript
  async getById(
    actorUserId: string,
    input: GetTemplateInput,
  ): Promise<TemplateDetailDto> {
    await this.assertMembership(actorUserId, input.workspaceId)
    const template = await this.repo.findDetail(input.templateId)
    if (!template) throw notFound('Шаблон не найден')
    if (template.scope === 'WORKSPACE' && template.workspaceId !== input.workspaceId) {
      throw notFound('Шаблон не найден')
    }
    return template
  }
```

```typescript
  async create(
    actorUserId: string,
    input: CreateTemplateInput,
  ): Promise<CreateTemplateResultDto> {
    const member = await this.assertMembership(actorUserId, input.workspaceId)
    if (!canCreateWorkspaceTemplate({ isPageCreator: false, role: member.role })) {
      throw forbidden('Недостаточно прав для создания шаблона')
    }
    return this.uow.transaction(() => this.repo.create(actorUserId, input))
  }

  async updateContent(
    actorUserId: string,
    input: UpdateTemplateContentInput,
  ): Promise<CreateTemplateResultDto> {
    const template = await this.repo.findForWrite(input.templateId)
    if (!template) throw notFound('Шаблон не найден')
    await this.assertWriteAccess(actorUserId, template, input.workspaceId)
    return this.uow.transaction(() =>
      this.repo.updateContent(actorUserId, input.templateId, input.content),
    )
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @repo/domain test -- service.test.ts`
Expected: PASS (all new tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/templates/services/templates.service.ts packages/domain/test/templates/service.test.ts
git commit -m "feat(domain): template service create/getById/updateContent

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 1.4: Expose tRPC procedures (TDD)

**Files:**
- Modify: `packages/trpc/src/routers/template.ts`
- Test: `packages/trpc/test/template-router.test.ts`

- [ ] **Step 1: Write failing integration tests**

In `packages/trpc/test/template-router.test.ts`, add (reuse the file's `makeUser`/`makeWorkspaceWithOwner`/`makeCaller` helpers):

```typescript
it('create makes an empty WORKSPACE template', async () => {
  const owner = await makeUser('c1')
  const ws = await makeWorkspaceWithOwner(owner.id)
  const caller = makeCaller(owner.id)

  const { id } = await caller.create({ workspaceId: ws.id, title: 'Blank doc' })
  const row = await prisma.pageTemplate.findUniqueOrThrow({ where: { id } })
  expect(row.scope).toBe(PageTemplateScope.WORKSPACE)
  expect(row.workspaceId).toBe(ws.id)
  expect(row.title).toBe('Blank doc')
  expect(row.type).toBe(PageType.TEXT)
})

it('getById returns the template detail with content', async () => {
  const owner = await makeUser('c2')
  const ws = await makeWorkspaceWithOwner(owner.id)
  const caller = makeCaller(owner.id)
  const { id } = await caller.create({ workspaceId: ws.id, title: 'Read me' })

  const detail = await caller.getById({ templateId: id, workspaceId: ws.id })
  expect(detail.id).toBe(id)
  expect(detail.title).toBe('Read me')
})

it('updateContent persists JSON and derives contentYjs', async () => {
  const owner = await makeUser('c3')
  const ws = await makeWorkspaceWithOwner(owner.id)
  const caller = makeCaller(owner.id)
  const { id } = await caller.create({ workspaceId: ws.id, title: 'Editable' })

  const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] }
  await caller.updateContent({ templateId: id, workspaceId: ws.id, content })

  const row = await prisma.pageTemplate.findUniqueOrThrow({ where: { id } })
  expect(row.content).toEqual(content)
  expect(row.contentYjs).not.toBeNull()
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @repo/trpc test -- template-router.test.ts`
Expected: FAIL (`caller.create` etc. not functions). Requires a DB — `docker compose up -d` must be running.

- [ ] **Step 3: Add the procedures**

In `packages/trpc/src/routers/template.ts`, add inside the `router({ ... })` (after `delete`):

```typescript
  create: protectedProcedure
    .input(domain.createTemplateInput)
    .mutation(async ({ ctx, input }): Promise<{ id: string }> => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      await requireWritableWorkspace(input.workspaceId)
      return mapDomain(() => domainSvc.templates.create(ctx.user.id, input))
    }),

  getById: protectedProcedure
    .input(domain.getTemplateInput)
    .query(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      return mapDomain(() => domainSvc.templates.getById(ctx.user.id, input))
    }),

  updateContent: protectedProcedure
    .input(domain.updateTemplateContentInput)
    .mutation(async ({ ctx, input }): Promise<{ id: string }> => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      await requireWritableWorkspace(input.workspaceId)
      return mapDomain(() => domainSvc.templates.updateContent(ctx.user.id, input))
    }),
```

(The DTO inputs `createTemplateInput`, `getTemplateInput`, `updateTemplateContentInput` are re-exported through `@repo/domain`'s barrel, so `domain.createTemplateInput` resolves — same pattern as `domain.updateTemplateInput`.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @repo/trpc test -- template-router.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/routers/template.ts packages/trpc/test/template-router.test.ts
git commit -m "feat(trpc): template create/getById/updateContent procedures

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 1.5: Add `DashboardCustomizeIcon` to the UI barrel + "Шаблоны" sidebar item

**Files:**
- Modify: `packages/ui/src/components/index.ts`
- Modify: `apps/web/src/components/workspace/workspace-sidebar.tsx`

- [ ] **Step 1: Export the icon**

In `packages/ui/src/components/index.ts`, near the other icon re-exports (e.g. the `DescriptionIcon` line ~135), add:

```typescript
export { default as DashboardCustomizeIcon } from '@mui/icons-material/DashboardCustomize'
```

- [ ] **Step 2: Add the sidebar item above "Корзина"**

In `apps/web/src/components/workspace/workspace-sidebar.tsx`, add `DashboardCustomizeIcon` to the `@repo/ui/components` import block. Then in the `pages` section, update the trailing `<Stack>` (currently holds only the Корзина `NavItem`) to put Шаблоны first:

```tsx
            <Stack spacing={0.25} sx={{ pb: 1 }}>
              <NavItem
                icon={<DashboardCustomizeIcon sx={{ fontSize: 16 }} />}
                label="Шаблоны"
                href={`/workspaces/${workspace.id}/templates`}
                matchPrefix={`/workspaces/${workspace.id}/templates`}
                pathname={pathname}
              />
              <NavItem
                icon={<DeleteIcon sx={{ fontSize: 16 }} />}
                label="Корзина"
                href={`/workspaces/${workspace.id}/trash`}
                matchPrefix={`/workspaces/${workspace.id}/trash`}
                pathname={pathname}
              />
            </Stack>
```

- [ ] **Step 3: Type-check**

Run: `pnpm --filter web check-types`
Expected: PASS (route doesn't exist yet — that's fine, `NavItem` href is a plain string).

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/index.ts apps/web/src/components/workspace/workspace-sidebar.tsx
git commit -m "feat(web): add Templates sidebar item above Trash

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 1.6: Template metadata dialog (create + edit)

**Files:**
- Create: `apps/web/src/components/templates/template-metadata-dialog.tsx`
- Modify: `apps/web/src/components/templates/index.ts`

- [ ] **Step 1: Create the dialog**

Write `apps/web/src/components/templates/template-metadata-dialog.tsx`. It supports two modes: create (calls `template.create`) and edit (calls `template.update`). Mirrors `save-as-template-dialog.tsx` fields.

```tsx
'use client'

import { useEffect, useState } from 'react'

import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  EmojiIconButton,
  Stack,
  TextField,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

type Mode =
  | { kind: 'create' }
  | {
      kind: 'edit'
      templateId: string
      initialTitle: string
      initialDescription: string | null
      initialIcon: string | null
      initialCategory: string | null
    }

type Props = {
  open: boolean
  onClose: () => void
  workspaceId: string
  mode: Mode
  onSaved?: (id: string) => void
}

const TITLE_ID = 'template-metadata-dialog-title'

export function TemplateMetadataDialog({ open, onClose, workspaceId, mode, onSaved }: Props) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState<string | null>(null)
  const [category, setCategory] = useState('')

  useEffect(() => {
    if (!open) return
    if (mode.kind === 'edit') {
      setTitle(mode.initialTitle)
      setDescription(mode.initialDescription ?? '')
      setIcon(mode.initialIcon)
      setCategory(mode.initialCategory ?? '')
    } else {
      setTitle('')
      setDescription('')
      setIcon(null)
      setCategory('')
    }
  }, [open, mode])

  const utils = trpc.useUtils()
  const invalidate = () => {
    utils.template.listByWorkspace.invalidate({ workspaceId }).catch(() => undefined)
    utils.template.search.invalidate().catch(() => undefined)
  }

  const createMut = trpc.template.create.useMutation({
    onSuccess: ({ id }) => {
      invalidate()
      onSaved?.(id)
      onClose()
    },
  })
  const updateMut = trpc.template.update.useMutation({
    onSuccess: ({ id }) => {
      invalidate()
      onSaved?.(id)
      onClose()
    },
  })

  const pending = createMut.isPending || updateMut.isPending
  const isError = createMut.isError || updateMut.isError
  const trimmedTitle = title.trim()
  const canSubmit = trimmedTitle.length > 0 && !pending

  const handleSubmit = () => {
    if (!canSubmit) return
    if (mode.kind === 'create') {
      createMut.mutate({
        workspaceId,
        title: trimmedTitle,
        description: description.trim() || null,
        icon,
        category: category.trim() || null,
      })
    } else {
      updateMut.mutate({
        templateId: mode.templateId,
        workspaceId,
        title: trimmedTitle,
        description: description.trim() || null,
        icon,
        category: category.trim() || null,
      })
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth aria-labelledby={TITLE_ID}>
      <DialogTitle id={TITLE_ID}>
        {mode.kind === 'create' ? 'Новый шаблон' : 'Изменить шаблон'}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <EmojiIconButton
              value={icon}
              onChange={setIcon}
              onRemove={() => setIcon(null)}
              aria-label="Изменить иконку шаблона"
              sx={{ width: 40, height: 40, p: 0.5, borderRadius: 1 }}
              emojiSize={28}
            />
            <TextField
              autoFocus
              fullWidth
              size="small"
              label="Название шаблона"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleSubmit()
                }
              }}
            />
          </Stack>
          <TextField
            fullWidth
            size="small"
            label="Описание"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            multiline
            minRows={2}
          />
          <TextField
            fullWidth
            size="small"
            label="Категория"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
          {isError ? (
            <Alert severity="error">Не удалось сохранить шаблон. Попробуйте ещё раз.</Alert>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={onClose}>
          Отмена
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={!canSubmit}>
          {mode.kind === 'create' ? 'Создать' : 'Сохранить'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
```

NOTE: confirm `EmojiIconButton` is exported from `@repo/ui/components` (it is used by `save-as-template-dialog.tsx`). If the import there is from a different path, match it.

- [ ] **Step 2: Export it from the templates barrel**

In `apps/web/src/components/templates/index.ts`, add:

```typescript
export { TemplateMetadataDialog } from './template-metadata-dialog'
```

- [ ] **Step 3: Type-check**

Run: `pnpm --filter web check-types`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/templates/template-metadata-dialog.tsx apps/web/src/components/templates/index.ts
git commit -m "feat(web): template metadata create/edit dialog

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 1.7: Templates list page (component + route)

**Files:**
- Create: `apps/web/src/components/templates/templates-page.tsx`
- Create: `apps/web/src/app/(protected)/workspaces/[workspaceId]/templates/page.tsx`

- [ ] **Step 1: Create the list client component**

Write `apps/web/src/components/templates/templates-page.tsx`:

```tsx
'use client'

import { useState } from 'react'

import Link from 'next/link'

import {
  AddIcon,
  Box,
  Button,
  DeleteIcon,
  EditIcon,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { TemplateMetadataDialog } from './template-metadata-dialog'

type Props = { workspaceId: string }

export function TemplatesPage({ workspaceId }: Props) {
  const utils = trpc.useUtils()
  const list = trpc.template.listByWorkspace.useQuery({ workspaceId })
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<{
    templateId: string
    initialTitle: string
    initialDescription: string | null
    initialIcon: string | null
    initialCategory: string | null
  } | null>(null)

  const deleteMut = trpc.template.delete.useMutation({
    onSuccess: () => {
      utils.template.listByWorkspace.invalidate({ workspaceId }).catch(() => undefined)
      utils.template.search.invalidate().catch(() => undefined)
    },
  })

  const templates = list.data ?? []

  return (
    <Box sx={{ maxWidth: 880, mx: 'auto', p: { xs: 2, md: 4 } }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 3 }}>
        <Typography variant="h5" component="h1">
          Шаблоны
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
          Создать шаблон
        </Button>
      </Stack>

      {list.isLoading ? (
        <Typography color="text.secondary">Загрузка…</Typography>
      ) : templates.length === 0 ? (
        <Typography color="text.secondary">
          Пока нет шаблонов. Создайте первый, чтобы быстро начинать новые страницы.
        </Typography>
      ) : (
        <Stack spacing={1}>
          {templates.map((t) => (
            <Stack
              key={t.id}
              direction="row"
              alignItems="center"
              spacing={1.5}
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                p: 1.5,
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Box sx={{ fontSize: 22, width: 32, textAlign: 'center', flexShrink: 0 }}>
                {t.icon ?? '📄'}
              </Box>
              <Box
                component={Link}
                href={`/workspaces/${workspaceId}/templates/${t.id}`}
                sx={{ flex: 1, minWidth: 0, textDecoration: 'none', color: 'inherit' }}
              >
                <Typography variant="body1" noWrap>
                  {t.title}
                </Typography>
                {t.description ? (
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {t.description}
                  </Typography>
                ) : null}
              </Box>
              {t.category ? (
                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                  {t.category}
                </Typography>
              ) : null}
              <Tooltip title="Изменить">
                <IconButton
                  size="small"
                  onClick={() =>
                    setEditTarget({
                      templateId: t.id,
                      initialTitle: t.title,
                      initialDescription: t.description,
                      initialIcon: t.icon,
                      initialCategory: t.category,
                    })
                  }
                  aria-label={`Изменить шаблон ${t.title}`}
                >
                  <EditIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Удалить">
                <IconButton
                  size="small"
                  onClick={() => {
                    if (window.confirm(`Удалить шаблон «${t.title}»?`)) {
                      deleteMut.mutate({ templateId: t.id, workspaceId })
                    }
                  }}
                  aria-label={`Удалить шаблон ${t.title}`}
                  sx={{ color: 'error.main' }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          ))}
        </Stack>
      )}

      <TemplateMetadataDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        workspaceId={workspaceId}
        mode={{ kind: 'create' }}
      />
      {editTarget ? (
        <TemplateMetadataDialog
          open
          onClose={() => setEditTarget(null)}
          workspaceId={workspaceId}
          mode={{ kind: 'edit', ...editTarget }}
        />
      ) : null}
    </Box>
  )
}
```

NOTE: confirm `AddIcon` and `EditIcon` are exported from `@repo/ui/components`. If `EditIcon` is missing, add `export { default as EditIcon } from '@mui/icons-material/Edit'` to `packages/ui/src/components/index.ts`; same for `AddIcon` → `@mui/icons-material/Add`.

- [ ] **Step 2: Create the route page (server)**

Write `apps/web/src/app/(protected)/workspaces/[workspaceId]/templates/page.tsx`:

```tsx
import { notFound } from 'next/navigation'

import { getServerTRPC } from '@/trpc/server'
import { TemplatesPage } from '@/components/templates/templates-page'

type Props = { params: Promise<{ workspaceId: string }> }

export default async function WorkspaceTemplatesPage({ params }: Props) {
  const { workspaceId } = await params
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getById({ id: workspaceId })
  if (!workspace) notFound()
  return <TemplatesPage workspaceId={workspaceId} />
}
```

- [ ] **Step 3: Type-check + lint**

Run: `pnpm --filter web check-types && pnpm --filter web lint`
Expected: PASS.

- [ ] **Step 4: Manual verification**

`pnpm --filter web dev`, open `/workspaces/<id>/templates`: the list renders, "Создать шаблон" opens the dialog, creating adds a row, Edit opens the dialog pre-filled, Delete (after confirm) removes the row.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/components/templates/templates-page.tsx" "apps/web/src/app/(protected)/workspaces/[workspaceId]/templates/page.tsx" packages/ui/src/components/index.ts
git commit -m "feat(web): templates management list page

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 1.8: Template content editor (single-user, AnyNotePlainEditor)

**Files:**
- Create: `apps/web/src/components/templates/template-editor.tsx`
- Create: `apps/web/src/app/(protected)/workspaces/[workspaceId]/templates/[templateId]/page.tsx`

- [ ] **Step 1: Create the editor client component**

Write `apps/web/src/components/templates/template-editor.tsx`. It loads the template detail, edits the JSON content with `AnyNotePlainEditor`, and saves via `template.updateContent`. The editor is loaded with `next/dynamic` + `ssr: false` (consistent with how editor components are mounted in this app).

```tsx
'use client'

import { useMemo, useState } from 'react'

import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'

import type { JSONContent } from '@repo/editor'
import {
  ArrowBackIcon,
  Box,
  Button,
  CircularProgress,
  Stack,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

const AnyNotePlainEditor = dynamic(
  () => import('@repo/editor').then((m) => m.AnyNotePlainEditor),
  { ssr: false },
)

type Props = { workspaceId: string; templateId: string }

export function TemplateEditor({ workspaceId, templateId }: Props) {
  const router = useRouter()
  const detail = trpc.template.getById.useQuery({ templateId, workspaceId })
  const [draft, setDraft] = useState<JSONContent | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const updateMut = trpc.template.updateContent.useMutation({
    onSuccess: () => setSavedAt(Date.now()),
  })

  // Seed the draft from the loaded content once.
  const initialContent = useMemo(
    () => (detail.data?.content as JSONContent | null) ?? null,
    [detail.data?.content],
  )

  if (detail.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
        <CircularProgress />
      </Box>
    )
  }
  if (detail.isError || !detail.data) {
    return (
      <Box sx={{ p: 4 }}>
        <Typography color="error">Шаблон не найден.</Typography>
      </Box>
    )
  }

  const handleSave = () => {
    const content = draft ?? initialContent ?? { type: 'doc', content: [] }
    updateMut.mutate({ templateId, workspaceId, content })
  }

  return (
    <Box sx={{ maxWidth: 820, mx: 'auto', p: { xs: 2, md: 4 } }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
        <Button
          size="small"
          startIcon={<ArrowBackIcon />}
          onClick={() => router.push(`/workspaces/${workspaceId}/templates`)}
        >
          К шаблонам
        </Button>
        <Box sx={{ fontSize: 24 }}>{detail.data.icon ?? '📄'}</Box>
        <Typography variant="h6" component="h1" sx={{ flex: 1, minWidth: 0 }} noWrap>
          {detail.data.title}
        </Typography>
        {savedAt && !updateMut.isPending ? (
          <Typography variant="caption" color="text.secondary">
            Сохранено
          </Typography>
        ) : null}
        <Button variant="contained" onClick={handleSave} disabled={updateMut.isPending}>
          Сохранить
        </Button>
      </Stack>

      <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 2 }}>
        <AnyNotePlainEditor
          value={initialContent}
          editable
          onBlurSave={(value) => setDraft(value)}
        />
      </Box>
    </Box>
  )
}
```

NOTE: confirm `ArrowBackIcon` is exported from `@repo/ui/components`; if not, add `export { default as ArrowBackIcon } from '@mui/icons-material/ArrowBack'`. `AnyNotePlainEditor`'s `onBlurSave` fires on blur with the current JSON — we capture it into `draft` and persist on the explicit "Сохранить" click (per the spec's explicit-save decision).

- [ ] **Step 2: Create the route page (server)**

Write `apps/web/src/app/(protected)/workspaces/[workspaceId]/templates/[templateId]/page.tsx`:

```tsx
import { notFound } from 'next/navigation'

import { getServerTRPC } from '@/trpc/server'
import { TemplateEditor } from '@/components/templates/template-editor'

type Props = { params: Promise<{ workspaceId: string; templateId: string }> }

export default async function WorkspaceTemplateEditorPage({ params }: Props) {
  const { workspaceId, templateId } = await params
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getById({ id: workspaceId })
  if (!workspace) notFound()
  return <TemplateEditor workspaceId={workspaceId} templateId={templateId} />
}
```

- [ ] **Step 3: Type-check + lint**

Run: `pnpm --filter web check-types && pnpm --filter web lint`
Expected: PASS.

- [ ] **Step 4: Manual verification**

Open a template from the list → editor loads with its content → type, then "Сохранить" → reload the page → content persisted. Then in the create-page flow (existing CreatePageDialog), creating a page from this template carries the content (validates `contentYjs` derivation).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/components/templates/template-editor.tsx" "apps/web/src/app/(protected)/workspaces/[workspaceId]/templates/[templateId]/page.tsx" packages/ui/src/components/index.ts
git commit -m "feat(web): single-user template content editor

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Part 4 — Sidebar section icons & active pill

Do before Part 5 (both edit `workspace-sidebar.tsx`).

### Task 4.1: Restyle WorkspaceSectionSwitcher (pill active / icon inactive), new icons, remove Settings

**Files:**
- Modify: `packages/ui/src/components/index.ts` (add `HomeIcon`)
- Modify: `apps/web/src/components/workspace/workspace-sidebar.tsx`

- [ ] **Step 1: Export HomeIcon**

In `packages/ui/src/components/index.ts`, add:

```typescript
export { default as HomeIcon } from '@mui/icons-material/Home'
```

- [ ] **Step 2: Rewrite WorkspaceSectionSwitcher**

In `apps/web/src/components/workspace/workspace-sidebar.tsx`, replace the entire `WorkspaceSectionSwitcher` function (lines ~248-311) with:

```tsx
export function WorkspaceSectionSwitcher({
  activeSection,
  chatsEnabled,
  onChats,
  onPages,
  onSearch,
}: {
  activeSection: WorkspaceSidebarSection
  chatsEnabled: boolean
  onChats: () => void
  onPages: () => void
  onSearch: () => void
}) {
  const mac = isMac()
  const shortcut = (macLabel: string, otherLabel: string) => (mac ? macLabel : otherLabel)

  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
      <SectionButton
        active={activeSection === 'pages'}
        icon={<HomeIcon fontSize="small" />}
        label="Домашняя"
        ariaLabel="Домашняя"
        tooltip={`Домашняя (${shortcut('⌘D', 'Alt+D')})`}
        onClick={onPages}
      />
      {chatsEnabled ? (
        <SectionButton
          active={activeSection === 'chats'}
          icon={<ChatBubbleOutlineIcon fontSize="small" />}
          label="Чаты"
          ariaLabel="Чаты"
          tooltip={`Чаты (${shortcut('⌘P', 'Alt+P')})`}
          onClick={onChats}
        />
      ) : null}
      <SectionButton
        active={false}
        icon={<SearchIcon fontSize="small" />}
        label="Поиск"
        ariaLabel="Поиск"
        tooltip={`Поиск (${shortcut('⌘K', 'Alt+K')})`}
        onClick={onSearch}
      />
    </Stack>
  )
}

const SECTION_ACTIVE_SX = {
  backgroundColor: 'rgba(201, 100, 66, 0.14)',
  color: '#c96442',
} as const

function SectionButton({
  active,
  icon,
  label,
  ariaLabel,
  tooltip,
  onClick,
}: {
  active: boolean
  icon: ReactNode
  label: string
  ariaLabel: string
  tooltip: string
  onClick: () => void
}) {
  if (active) {
    return (
      <Button
        onClick={onClick}
        aria-label={ariaLabel}
        aria-pressed
        startIcon={icon}
        size="medium"
        sx={{
          flex: 1,
          minWidth: 0,
          justifyContent: 'flex-start',
          textTransform: 'none',
          ...SECTION_ACTIVE_SX,
          '&:hover': SECTION_ACTIVE_SX,
        }}
      >
        {label}
      </Button>
    )
  }
  return (
    <Tooltip title={tooltip}>
      <IconButton onClick={onClick} aria-label={ariaLabel} size="medium" sx={{ flexShrink: 0 }}>
        {icon}
      </IconButton>
    </Tooltip>
  )
}
```

- [ ] **Step 3: Update the switcher usage (drop onSettings)**

In the same file, the `<WorkspaceSectionSwitcher ... />` usage (lines ~176-188) currently passes `onSettings`. Remove that prop:

```tsx
      <WorkspaceSectionSwitcher
        activeSection={activeSection}
        chatsEnabled={features.chatsEnabled}
        onChats={() => {
          onSectionChange('chats')
        }}
        onPages={() => onSectionChange('pages')}
        onSearch={searchDialog.open}
      />
```

(The `router` import may now be unused in this file if it was only used by the removed `onSettings` handler. Part 5 reintroduces a settings action via the space menu; if you're doing Part 4 in isolation and `router` becomes unused, leave the import — Part 5 uses it. If shipping Part 4 alone, remove the unused `router` to satisfy lint.)

- [ ] **Step 4: Fix imports**

In the `@repo/ui/components` import block of `workspace-sidebar.tsx`: add `HomeIcon`. Remove `ButtonGroup` if it's no longer used anywhere in the file (the switcher no longer uses it; verify no other usage). Remove `SettingsIcon` if unused after Part 4 — BUT Part 5 will use it in the space menu, so if doing both, keep it; if shipping Part 4 alone, remove it.

- [ ] **Step 5: Type-check + lint**

Run: `pnpm --filter web check-types && pnpm --filter web lint`
Expected: PASS.

- [ ] **Step 6: Manual verification**

Sidebar shows 🏠 Домашняя / 💬 Чаты / 🔍 Поиск. The active section (Домашняя or Чаты) is a wide pill with icon+label and accent color; the others are compact icons with tooltips. Поиск opens the search dialog and never appears active. No Settings button in this row.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/components/index.ts apps/web/src/components/workspace/workspace-sidebar.tsx
git commit -m "feat(web): sidebar section buttons as active-pill / inactive-icon

Home/Chats/Search with new icons; active section renders as a labeled
pill, inactive as icon-only. Removes the Settings section button
(moves to the space menu).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Part 5 — Space menu + full-screen settings modal

Always-open space menu; owner-only Settings/Invite open a full-screen settings modal that reuses the existing section components. Removes the sidebar settings section and the `/settings/*` page UIs.

### Task 5.1: Build the full-screen WorkspaceSettingsDialog

**Files:**
- Create: `apps/web/src/components/workspace/settings/workspace-settings-dialog.tsx`

The dialog fetches shared data once via client tRPC and feeds the existing section components. Feature gating uses the client `usePlanFeatures()` context (already mounted in the protected subtree).

- [ ] **Step 1: Create the dialog**

Write `apps/web/src/components/workspace/settings/workspace-settings-dialog.tsx`:

```tsx
'use client'

import { useState, type ReactNode } from 'react'

import {
  BarChartIcon,
  Box,
  CloseIcon,
  CircularProgress,
  Dialog,
  GroupIcon,
  HubIcon,
  IconButton,
  SettingsIcon,
  SmartToyIcon,
  Stack,
  StorageIcon,
  Typography,
  WarningAmberIcon,
} from '@repo/ui/components'

import { usePlanFeatures } from '@/components/workspace/plan-features-context'
import { trpc } from '@/trpc/client'

import { WorkspaceGeneralSection } from './general-section'
import { WorkspaceMembersSection } from './members-section'
import { WorkspaceAiSection } from './ai-section'
import { WorkspaceMcpSection } from './mcp-section'
import { WorkspaceFilesSection } from './files-section'
import { UsageSection } from './usage-section'
import { WorkspaceDangerSection } from './danger-section'

export type SettingsSectionSlug =
  | 'general'
  | 'members'
  | 'ai'
  | 'mcp'
  | 'files'
  | 'usage'
  | 'danger'

type Props = {
  open: boolean
  onClose: () => void
  workspaceId: string
  currentUserId: string
  initialSection?: SettingsSectionSlug
}

export function WorkspaceSettingsDialog({
  open,
  onClose,
  workspaceId,
  currentUserId,
  initialSection = 'general',
}: Props) {
  const features = usePlanFeatures()
  const [section, setSection] = useState<SettingsSectionSlug>(initialSection)

  const workspaceQ = trpc.workspace.getById.useQuery({ id: workspaceId }, { enabled: open })
  const roleQ = trpc.workspace.getMyRole.useQuery({ workspaceId }, { enabled: open })
  const planQ = trpc.subscription.getCurrent.useQuery(undefined, { enabled: open })

  const items: Array<{ slug: SettingsSectionSlug; label: string; icon: ReactNode; show: boolean }> = [
    { slug: 'general', label: 'Общее', icon: <SettingsIcon fontSize="small" />, show: true },
    { slug: 'members', label: 'Участники', icon: <GroupIcon fontSize="small" />, show: features.membersSettingsEnabled },
    { slug: 'ai', label: 'AI агент', icon: <SmartToyIcon fontSize="small" />, show: features.aiSettingsEnabled },
    { slug: 'mcp', label: 'MCP серверы', icon: <HubIcon fontSize="small" />, show: features.customMcpEnabled },
    { slug: 'files', label: 'Библиотека', icon: <StorageIcon fontSize="small" />, show: true },
    { slug: 'usage', label: 'Использование', icon: <BarChartIcon fontSize="small" />, show: true },
    { slug: 'danger', label: 'Опасная зона', icon: <WarningAmberIcon fontSize="small" />, show: true },
  ].filter((i) => i.show)

  const workspace = workspaceQ.data
  const isOwner = roleQ.data === 'OWNER'
  const planSlug = planQ.data?.plan.slug ?? null
  const ready = workspace && roleQ.isSuccess && planQ.isSuccess

  return (
    <Dialog open={open} onClose={onClose} fullScreen>
      <Stack direction="row" sx={{ height: '100%', minHeight: 0 }}>
        <Box
          sx={{
            width: 248,
            flexShrink: 0,
            borderRight: '1px solid',
            borderColor: 'divider',
            p: 2,
            overflowY: 'auto',
          }}
        >
          <Typography variant="subtitle2" sx={{ mb: 1.5, px: 1 }}>
            Настройки
          </Typography>
          <Stack spacing={0.5} component="nav">
            {items.map((item) => {
              const active = item.slug === section
              return (
                <Box
                  key={item.slug}
                  component="button"
                  type="button"
                  onClick={() => setSection(item.slug)}
                  aria-current={active ? 'page' : undefined}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.25,
                    p: '6px 10px',
                    borderRadius: 0.75,
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    width: '100%',
                    font: 'inherit',
                    fontSize: 14,
                    color: active ? 'text.primary' : 'text.secondary',
                    fontWeight: active ? 600 : 400,
                    bgcolor: active ? 'action.selected' : 'transparent',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </Box>
              )
            })}
          </Stack>
        </Box>

        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}
          >
            <Typography variant="h6">{workspace?.name ?? 'Настройки'}</Typography>
            <IconButton onClick={onClose} aria-label="Закрыть">
              <CloseIcon />
            </IconButton>
          </Stack>

          <Box sx={{ flex: 1, minWidth: 0, overflowY: 'auto', p: { xs: 2, md: 4 } }}>
            {!ready ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
                <CircularProgress />
              </Box>
            ) : (
              <Box sx={{ maxWidth: 880, mx: 'auto' }}>
                {section === 'general' && workspace ? (
                  <WorkspaceGeneralSection
                    workspace={{ id: workspace.id, name: workspace.name, icon: workspace.icon }}
                    isOwner={isOwner}
                  />
                ) : null}
                {section === 'members' ? (
                  <WorkspaceMembersSection
                    workspaceId={workspaceId}
                    locked={planSlug === 'personal'}
                    currentUserId={currentUserId}
                  />
                ) : null}
                {section === 'ai' ? (
                  <WorkspaceAiSection
                    workspaceId={workspaceId}
                    isOwner={isOwner}
                    customProvidersEnabled={features.customAiProvidersEnabled}
                  />
                ) : null}
                {section === 'mcp' ? (
                  <WorkspaceMcpSection
                    workspaceId={workspaceId}
                    isOwner={isOwner}
                    customMcpEnabled={features.customMcpEnabled}
                  />
                ) : null}
                {section === 'files' ? (
                  <WorkspaceFilesSection workspaceId={workspaceId} currentUserId={currentUserId} />
                ) : null}
                {section === 'usage' ? <UsageDialogSection workspaceId={workspaceId} /> : null}
                {section === 'danger' && workspace ? (
                  <WorkspaceDangerSection
                    workspace={{ id: workspace.id, name: workspace.name }}
                    isOwner={isOwner}
                  />
                ) : null}
              </Box>
            )}
          </Box>
        </Box>
      </Stack>
    </Dialog>
  )
}

// Usage needs its own query (workspace.getUsage). Kept inline so the dialog
// stays a single coordination point.
function UsageDialogSection({ workspaceId }: { workspaceId: string }) {
  const usageQ = trpc.workspace.getUsage.useQuery({ workspaceId })
  if (!usageQ.data) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    )
  }
  return <UsageSection {...usageQ.data} />
}
```

NOTES on section props (verified against the section files):
- `WorkspaceAiSection` accepts `initialModels`/`initialEmbeddingModels` as **optional** — omitting them is fine; the section fetches via its own queries when absent. Confirm by reading `ai-section.tsx`; if a model list is required and not fetched internally, add `getAvailableAiModels`/`getAvailableEmbeddingModels` — but these are server-only helpers, so instead rely on the section's internal `trpc` queries. If the section has no internal fetch, render it without the initial props (it defaults `isOwner=false`, `customProvidersEnabled=false`) and accept that the model dropdowns populate via its own client queries.
- `CloseIcon` must be exported from `@repo/ui/components` (it is used elsewhere, e.g. create-page-dialog). Confirm.

- [ ] **Step 2: Type-check**

Run: `pnpm --filter web check-types`
Expected: PASS. Resolve any missing icon exports by adding them to `packages/ui/src/components/index.ts`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/workspace/settings/workspace-settings-dialog.tsx
git commit -m "feat(web): full-screen workspace settings dialog

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 5.2: Space menu always opens; owner-only Settings/Invite open the dialog

**Files:**
- Modify: `apps/web/src/components/workspace/workspace-sidebar.tsx`

- [ ] **Step 1: Add role query, dialog state, and current user id**

`WorkspaceSidebar` needs `currentUserId` for the dialog. The `Props` already include `userMenu` but not the user id. Add a `currentUserId: string` prop to `WorkspaceSidebar`'s `Props` and thread it from the caller (`workspace-layout-client.tsx` has `user.id` — pass `currentUserId={user.id}`).

In `workspace-sidebar.tsx`, inside `WorkspaceSidebar`, add:

```tsx
  const myRole = trpc.workspace.getMyRole.useQuery({ workspaceId: workspace.id })
  const isOwner = myRole.data === 'OWNER'
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsInitial, setSettingsInitial] = useState<'general' | 'members'>('general')

  const openSettings = (initial: 'general' | 'members') => {
    setSettingsInitial(initial)
    setSettingsOpen(true)
    closeSwitcher()
  }
```

Add the import:

```tsx
import { WorkspaceSettingsDialog } from './settings/workspace-settings-dialog'
```

And add `GroupAddIcon` (for the invite action) and keep `SettingsIcon` in the `@repo/ui/components` import block. If `GroupAddIcon` isn't exported, add `export { default as GroupAddIcon } from '@mui/icons-material/GroupAdd'` to the UI barrel.

- [ ] **Step 2: Make the space header always open the menu**

Change the header `Box` `onClick`/`cursor`/hover and the arrow to be unconditional (remove the `hasMultiple` guards). The header `<Box>` currently is:

```tsx
        <Box
          onClick={hasMultiple ? (event) => setSwitcherAnchor(event.currentTarget) : undefined}
          sx={{
            ...
            cursor: hasMultiple ? 'pointer' : 'default',
            '&:hover': hasMultiple ? { bgcolor: 'action.hover' } : undefined,
          }}
        >
```

Change to:

```tsx
        <Box
          onClick={(event) => setSwitcherAnchor(event.currentTarget)}
          sx={{
            ...
            cursor: 'pointer',
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
```

And the arrow (currently `{hasMultiple && (<ArrowDropDownIcon .../>)}`) → always render it:

```tsx
          <ArrowDropDownIcon sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />
```

- [ ] **Step 3: Replace the menu with the new layout**

Replace the entire `{hasMultiple && (<Menu>...</Menu>)}` block with an always-rendered `Menu` that has: the space name header (line 1), an owner-only row of Settings/Invite small buttons (line 2), a divider, then the space-switch list, then an optional "Создать пространство" item:

```tsx
      <Menu
        anchorEl={switcherAnchor}
        open={!!switcherAnchor}
        onClose={closeSwitcher}
        slotProps={{ paper: { sx: { minWidth: 260 } } }}
      >
        <Box sx={{ px: 1.5, py: 1 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Box
              sx={{
                width: 24,
                height: 24,
                borderRadius: 0.75,
                background: 'linear-gradient(135deg,#0f766e,#155e75)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 14,
                flexShrink: 0,
              }}
            >
              {workspace.icon ?? '📒'}
            </Box>
            <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
              {workspace.name}
            </Typography>
          </Stack>
          {isOwner ? (
            <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<SettingsIcon fontSize="small" />}
                onClick={() => openSettings('general')}
                sx={{ textTransform: 'none', flex: 1 }}
              >
                Настройки
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<GroupAddIcon fontSize="small" />}
                onClick={() => openSettings('members')}
                sx={{ textTransform: 'none', flex: 1 }}
              >
                Пригласить
              </Button>
            </Stack>
          ) : null}
        </Box>

        <Divider />

        {(allWorkspaces.data ?? []).map((w) => (
          <MenuItem
            key={w.id}
            component={Link}
            href={`/workspaces/${w.id}`}
            onClick={closeSwitcher}
            selected={w.id === workspace.id}
            sx={{ gap: 1 }}
          >
            <Box
              sx={{
                width: 22,
                height: 22,
                borderRadius: 0.5,
                background: 'linear-gradient(135deg,#0f766e,#155e75)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 13,
                flexShrink: 0,
              }}
            >
              {w.icon ?? '📒'}
            </Box>
            <Typography variant="body2" noWrap>
              {w.name}
            </Typography>
          </MenuItem>
        ))}

        <Divider />
        <MenuItem component={Link} href="/workspaces/new" onClick={closeSwitcher} sx={{ gap: 1 }}>
          <AddIcon fontSize="small" />
          <Typography variant="body2">Создать пространство</Typography>
        </MenuItem>
      </Menu>
```

Add `Divider` and `AddIcon` to the `@repo/ui/components` import block if not already present. (`Divider` likely needs adding; `AddIcon` was added in Part 1 to the UI barrel — confirm it's exported.)

- [ ] **Step 4: Render the settings dialog**

Just before the closing `</Box>` of the `WorkspaceSidebar` aside (after the bottom user-menu `Box`), add:

```tsx
      <WorkspaceSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        workspaceId={workspace.id}
        currentUserId={currentUserId}
        initialSection={settingsInitial}
      />
```

- [ ] **Step 5: Type-check + lint**

Run: `pnpm --filter web check-types && pnpm --filter web lint`
Expected: PASS. The `hasMultiple` variable may now be unused — remove its declaration (`const hasMultiple = ...`) and the `allWorkspaces` query stays (used by the list). If `hasMultiple` is referenced nowhere else, delete it.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/workspace/workspace-sidebar.tsx apps/web/src/components/workspace/workspace-layout-client.tsx
git commit -m "feat(web): space menu with owner settings/invite + switch list

Clicking the space always opens a menu: name, owner-only Settings and
Пригласить (opening the full-screen settings dialog), the workspace
switch list, and Create space.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 5.3: Remove the sidebar settings section and the /settings/* page UIs

**Files:**
- Modify: `apps/web/src/components/workspace/workspace-sidebar.tsx`
- Modify: `apps/web/src/components/workspace/workspace-layout-client.tsx`
- Delete: `apps/web/src/components/workspace/workspace-settings-nav.tsx`
- Replace: settings route pages with a redirect

- [ ] **Step 1: Remove the settings section render from the sidebar**

In `workspace-sidebar.tsx`, delete:

```tsx
        {activeSection === 'settings' ? <WorkspaceSettingsNav workspaceId={workspace.id} /> : null}
```

and the import `import { WorkspaceSettingsNav } from './workspace-settings-nav'`.

- [ ] **Step 2: Drop 'settings' from the section type and path mapping**

In `workspace-layout-client.tsx`:
- Change `export type WorkspaceSidebarSection = 'chats' | 'pages' | 'settings'` to `export type WorkspaceSidebarSection = 'chats' | 'pages'`.
- In `sidebarSectionFromPathname`, remove the line `if (pathname.includes('/settings')) return 'settings'`.

Search for any other reference to `'settings'` as a `WorkspaceSidebarSection` and remove/adjust (e.g. an `onSectionChange('settings')` left anywhere — there should be none after Part 4 removed `onSettings`).

- [ ] **Step 3: Delete the settings nav component**

```bash
git rm apps/web/src/components/workspace/workspace-settings-nav.tsx
```

- [ ] **Step 4: Replace settings route pages with a redirect**

Delete the per-section page UIs and the layout, and make the settings index redirect to the workspace root (the modal is now the only settings UI). Run:

```bash
git rm "apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/layout.tsx" \
  "apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/general/page.tsx" \
  "apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/members/page.tsx" \
  "apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/ai/page.tsx" \
  "apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/mcp/page.tsx" \
  "apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/files/page.tsx" \
  "apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/usage/page.tsx" \
  "apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/danger/page.tsx"
```

Then overwrite `apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/page.tsx` with a redirect to the workspace root (so any old bookmark lands somewhere valid):

```tsx
import { redirect } from 'next/navigation'

type Props = { params: Promise<{ workspaceId: string }> }

export default async function WorkspaceSettingsIndex({ params }: Props) {
  const { workspaceId } = await params
  redirect(`/workspaces/${workspaceId}`)
}
```

- [ ] **Step 5: Clear stale Next route types and type-check**

```bash
rm -rf apps/web/.next/types
pnpm --filter web check-types
```

Expected: PASS. If you see `TS2307 cannot find module '.../settings/general/route.js'`, it's a stale `.next/types` artifact — the `rm -rf` above clears it.

- [ ] **Step 6: Verify no dangling references**

```bash
grep -rn "workspace-settings-nav\|WorkspaceSettingsNav\|activeSection === 'settings'\|'settings'" apps/web/src/components/workspace apps/web/src/components/page
```

Expected: no references to the removed nav or the `'settings'` section (matches inside the new settings dialog's section slugs are fine — those are `SettingsSectionSlug` strings like `'general'`, not the sidebar section).

- [ ] **Step 7: Manual verification**

- Click the space → menu opens (even with one workspace). Owner sees Настройки + Пригласить on line 2.
- Click Настройки → full-screen dialog opens on Общее; left nav switches sections; right pane renders each section; × closes.
- Click Пригласить → dialog opens on Участники.
- Non-owner: menu shows only the name + switch list (no settings row). Verify by temporarily testing with a non-owner member if available, or trust the `isOwner` gate.
- Visiting `/workspaces/<id>/settings` redirects to the workspace root.

- [ ] **Step 8: Commit**

```bash
git add -A apps/web/src/components/workspace apps/web/src/app/\(protected\)/workspaces
git commit -m "refactor(web): remove sidebar settings section and /settings pages

Settings now live in the full-screen dialog opened from the space
menu. Deletes WorkspaceSettingsNav and the per-section settings
routes; the settings index redirects to the workspace root.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final gate

- [ ] **Run the full merge gate**

Run: `pnpm gates`
Expected: check-types + lint + build + test all PASS across the workspace. This also runs `pnpm check-architecture` (dependency-cruiser) — confirm the new web → `@repo/editor` (`AnyNotePlainEditor`) and web → templates imports don't violate layering (they follow existing patterns, so they should pass).

- [ ] **Shared-model sanity check**

The template DTO/procedure additions are pure additions and templates aren't consumed by `apps/engines`/`apps/agents`, so no cross-app breakage is expected. `pnpm gates` fans out to all packages and will catch any regression.

---

## Self-review notes (addressed)

- **Spec coverage:** §1 → Tasks 1.1–1.8; §2 → Tasks 2.1–2.2; §3 → Task 3.1; §4 → Task 4.1; §5 → Tasks 5.1–5.3. All five covered.
- **`contentYjs` derivation:** spec said `updateContent` writes both columns. The plan derives `contentYjs` from the JSON `content` server-side (Task 1.2), keeping `createPageFromTemplate` working. A documented fallback puts derivation in the tRPC layer if `@repo/domain` must stay dependency-light.
- **Single-user editor:** spec said "single editor with explicit save, no Hocuspocus." The plan uses the already-exported `AnyNotePlainEditor` (JSON in/out) — no new Yjs/provider wiring on the client.
- **Settings data:** sections are server-fed today; the dialog supplies the same props via client queries (`getById`, `getMyRole`, `getCurrent`, `getUsage`) + the client `usePlanFeatures()` context. The one uncertainty (AI section's `initialModels`) is flagged with a concrete fallback in Task 5.1.
- **Type consistency:** new symbols (`createTemplateInput`, `getTemplateInput`, `updateTemplateContentInput`, `TemplateDetailDto`, `SettingsSectionSlug`, `SectionButton`) are defined before use; repo method names (`create`, `findDetail`, `updateContent`) match service calls and test mocks.
