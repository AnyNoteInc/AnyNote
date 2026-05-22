# Tiptap «Код» slash group + Mermaid preview toggle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a «Код» slash group (Код / Mermaid / PlantUML / d2) and give the Mermaid code block an in-place Код↔Просмотр toggle with client-side rendering, keeping the copy button on every block.

**Architecture:** Extend the existing `CodeBlock` extension (`CodeBlockLowlight` + React node view). The node view becomes language-aware: `language === 'mermaid'` adds a toolbar toggle + a rendered SVG pane (via `renderMermaid` reused from `@repo/mermaid`), while the editable `NodeViewContent` stays mounted (hidden in preview). Other languages keep the current code+copy view.

**Tech Stack:** Tiptap v3, `@tiptap/extension-code-block-lowlight`, MUI v7 (`ToggleButtonGroup`), `mermaid@^11` (via `@repo/mermaid/render-mermaid`), Playwright. Spec: [`docs/superpowers/specs/2026-05-22-tiptap-code-block-diagrams-design.md`](../specs/2026-05-22-tiptap-code-block-diagrams-design.md).

**Conventions:** Prettier — `semi: false`, single quotes, trailing commas, 100-char width. Run `pnpm format` if unsure. Conventional Commits with scope; do **not** use `--no-verify`. Commit frequently.

**Note on `@repo/mermaid` reuse:** `@repo/mermaid/package.json` already exposes a `"./*": "./src/*"` wildcard export, so `import { renderMermaid } from '@repo/mermaid/render-mermaid'` resolves to the Monaco-free `src/render-mermaid.ts` directly. **No change to `@repo/mermaid` is needed** (spec §4's explicit `./render` alias is unnecessary).

---

## File Structure

**Modified:**
- `packages/editor/package.json` — add `@repo/mermaid: workspace:*`
- `packages/editor/src/types.ts` — `'code'` in `SlashCommandGroup`
- `packages/editor/src/components/slash-menu-popover.tsx` — group order + «Код» title
- `packages/editor/src/slash-items.ts` — move «Код», add Mermaid / PlantUML / d2
- `packages/editor/src/extensions/code-block.tsx` — language-aware node view (mermaid toggle + render)
- `packages/editor/src/styles/content.css` — preview / error styles
- `apps/e2e/code-block.spec.ts` — fix «Код» selector, add Mermaid preview-toggle test
- `pnpm-lock.yaml` — workspace dependency sync

---

## Task 1: Editor depends on `@repo/mermaid`

**Files:**
- Modify: `packages/editor/package.json` (dependencies block)

- [ ] **Step 1: Add the workspace dependency**

In `packages/editor/package.json`, add to `dependencies` (alphabetically near the other `@repo/*` entry `@repo/ui`):

```jsonc
"@repo/mermaid": "workspace:*",
```

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: lockfile updates; `@repo/mermaid` linked into `packages/editor/node_modules`. Exit 0.

- [ ] **Step 3: Verify the workspace link**

Run: `ls -l packages/editor/node_modules/@repo/mermaid`
Expected: a symlink pointing at `../../mermaid` (workspace package linked).

The actual `@repo/mermaid/render-mermaid` import resolution is proven by `check-types` in Task 3 (tsc `moduleResolution: Bundler` resolves the `.ts` through the `./*` wildcard export — plain `node`/`require.resolve` would *not*, since it ignores `.ts`, so don't verify that way). If Task 3 `check-types` reports the import unresolved, fall back to adding `"mermaid": "^11.4.0"` to the editor and a local `renderMermaidInline` (spec §4 fallback).

- [ ] **Step 4: Commit**

```bash
git add packages/editor/package.json pnpm-lock.yaml
git commit -m "build(editor): depend on @repo/mermaid for inline render"
```

---

## Task 2: «Код» slash group

**Files:**
- Modify: `packages/editor/src/types.ts`
- Modify: `packages/editor/src/components/slash-menu-popover.tsx`
- Modify: `packages/editor/src/slash-items.ts`

- [ ] **Step 1: Add the `'code'` group to the union**

In `packages/editor/src/types.ts`, change:

```ts
export type SlashCommandGroup = 'base' | 'media'
```

to:

```ts
export type SlashCommandGroup = 'base' | 'code' | 'media'
```

- [ ] **Step 2: Order and title the group**

In `packages/editor/src/components/slash-menu-popover.tsx`:

```ts
const GROUP_ORDER: SlashCommandGroup[] = ['base', 'code', 'media']

const GROUP_TITLES: Record<SlashCommandGroup, string> = {
  base: 'Базовые блоки',
  code: 'Код',
  media: 'Медиа',
}
```

- [ ] **Step 3: Move «Код» and add the three diagram items**

In `packages/editor/src/slash-items.ts`, replace the existing `id: 'code'` item with the following four items (all `group: 'code'`, all using `CodeIcon`). The plain «Код» keeps `toggleCodeBlock()`; the others use `setCodeBlock({ language })` (keeps the cursor inside the new block):

```ts
  {
    id: 'code',
    group: 'code',
    label: 'Код',
    keywords: ['code', 'pre', 'код'],
    icon: createElement(CodeIcon),
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    id: 'mermaid',
    group: 'code',
    label: 'Mermaid',
    keywords: ['mermaid', 'diagram', 'диаграмма', 'схема'],
    icon: createElement(CodeIcon),
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setCodeBlock({ language: 'mermaid' }).run(),
  },
  {
    id: 'plantuml',
    group: 'code',
    label: 'PlantUML',
    keywords: ['plantuml', 'uml', 'диаграмма'],
    icon: createElement(CodeIcon),
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setCodeBlock({ language: 'plantuml' }).run(),
  },
  {
    id: 'd2',
    group: 'code',
    label: 'd2',
    keywords: ['d2', 'diagram', 'диаграмма'],
    icon: createElement(CodeIcon),
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setCodeBlock({ language: 'd2' }).run(),
  },
```

(Do not add `description` fields — keeps the slash items' accessible names equal to their labels, which the E2E selectors rely on.)

- [ ] **Step 4: Type-check + lint**

Run: `pnpm --filter @repo/editor check-types && pnpm --filter @repo/editor lint`
Expected: both pass (exit 0).

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/types.ts packages/editor/src/components/slash-menu-popover.tsx packages/editor/src/slash-items.ts
git commit -m "feat(editor): «Код» slash group with Mermaid/PlantUML/d2 items"
```

---

## Task 3: Language-aware code block node view + styles

**Files:**
- Modify (replace whole file): `packages/editor/src/extensions/code-block.tsx`
- Modify: `packages/editor/src/styles/content.css`

- [ ] **Step 1: Rewrite `code-block.tsx`**

Replace the entire file with:

```tsx
'use client'

import CheckIcon from '@mui/icons-material/Check'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { Box, IconButton, ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { renderMermaid } from '@repo/mermaid/render-mermaid'

function CopyButton({ source }: { source: string }) {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(() => {
    void navigator.clipboard.writeText(source).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [source])
  return (
    <Tooltip title={copied ? 'Скопировано' : 'Копировать'} placement="left">
      {/* contentEditable=false + preventDefault keep the editor selection put when clicking */}
      <IconButton
        size="small"
        contentEditable={false}
        onMouseDown={(event) => event.preventDefault()}
        onClick={copy}
        aria-label="Копировать код"
        data-testid="code-block-copy"
        sx={{ color: 'text.secondary' }}
      >
        {copied ? <CheckIcon fontSize="inherit" /> : <ContentCopyIcon fontSize="inherit" />}
      </IconButton>
    </Tooltip>
  )
}

function CodeBlockView({ node }: NodeViewProps) {
  const isMermaid = node.attrs.language === 'mermaid'
  const mode = useTheme().palette.mode
  const [view, setView] = useState<'code' | 'preview'>('code')
  const [svg, setSvg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const idRef = useRef(`cb-mermaid-${Math.random().toString(36).slice(2)}`)
  const source = node.textContent
  const showPreview = isMermaid && view === 'preview'

  useEffect(() => {
    if (!showPreview) return
    let cancelled = false
    void renderMermaid(idRef.current, source, mode).then((result) => {
      if (cancelled) return
      if (result.ok) {
        setSvg(result.svg)
        setError(null)
      } else {
        setError(result.error)
      }
    })
    return () => {
      cancelled = true
    }
  }, [showPreview, source, mode])

  return (
    <NodeViewWrapper className="anynote-code-block" data-language={node.attrs.language ?? undefined}>
      <Box
        className="anynote-code-block__toolbar"
        contentEditable={false}
        sx={{
          position: 'absolute',
          top: 6,
          right: 6,
          zIndex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          opacity: 0.6,
          transition: 'opacity 0.15s ease',
          '&:focus-within': { opacity: 1 },
          '.anynote-code-block:hover &': { opacity: 1 },
        }}
      >
        {isMermaid && (
          <ToggleButtonGroup
            size="small"
            exclusive
            value={view}
            onChange={(_event, next: 'code' | 'preview' | null) => {
              if (next) setView(next)
            }}
            sx={{
              bgcolor: 'background.paper',
              '& .MuiToggleButton-root': {
                px: 1,
                py: 0.25,
                fontSize: '0.7rem',
                lineHeight: 1.4,
                textTransform: 'none',
              },
            }}
          >
            <ToggleButton value="code">Код</ToggleButton>
            <ToggleButton value="preview">Просмотр</ToggleButton>
          </ToggleButtonGroup>
        )}
        <CopyButton source={source} />
      </Box>

      <pre style={showPreview ? { display: 'none' } : undefined}>
        <NodeViewContent<'code'> as="code" />
      </pre>

      {showPreview && (
        <Box className="anynote-code-block__preview" contentEditable={false}>
          {error ? (
            <Box className="anynote-code-block__error">{error}</Box>
          ) : (
            <Box
              sx={{ width: '100%', display: 'flex', justifyContent: 'center' }}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          )}
        </Box>
      )}
    </NodeViewWrapper>
  )
}

/**
 * CodeBlockLowlight + a React node view: a copy button on every block, and for
 * `language === 'mermaid'` a Код↔Просмотр toggle that renders the diagram
 * client-side (renderMermaid). lowlight auto-detects plain blocks (highlightAuto
 * over `common`), so no language picker is needed.
 */
export const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView)
  },
})
```

- [ ] **Step 2: Add preview / error styles to `content.css`**

In `packages/editor/src/styles/content.css`, after the `.anynote-code-block` / `.hljs-*` block added previously, append:

```css
.anynote-editor .anynote-code-block__preview {
  display: flex;
  justify-content: center;
  padding: 12px;
  overflow: auto;
}
.anynote-editor .anynote-code-block__preview svg {
  max-width: 100%;
  height: auto;
}
.anynote-editor .anynote-code-block__error {
  width: 100%;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--editor-code-bg, rgba(0, 0, 0, 0.04));
  color: #d73a49;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8rem;
  white-space: pre-wrap;
}
```

- [ ] **Step 3: Type-check + lint**

Run: `pnpm --filter @repo/editor check-types && pnpm --filter @repo/editor lint`
Expected: both pass (exit 0). If `NodeViewContent<'code'>` errors, confirm the explicit generic is present (the `as` prop is typed `NoInfer<T>` with `T = 'div'` default).

- [ ] **Step 4: Commit**

```bash
git add packages/editor/src/extensions/code-block.tsx packages/editor/src/styles/content.css
git commit -m "feat(editor): Mermaid code block Код↔Просмотр toggle + render"
```

---

## Task 4: E2E

**Files:**
- Modify: `apps/e2e/code-block.spec.ts`

- [ ] **Step 1: Fix the «Код» selector and add the Mermaid test**

In `apps/e2e/code-block.spec.ts`, change the plain-code selection from `getByText('Код', { exact: true })` to a role-based selector (the group header «Код» is now also text, so `getByText` would be ambiguous):

```ts
  await page.getByRole('button', { name: 'Код', exact: true }).click()
```

Then add this test below the existing one:

```ts
test('mermaid code block toggles to a rendered preview', async ({ page }) => {
  const editor = await setupTextPage(page)
  await editor.click()
  await editor.press('/')
  await page.keyboard.type('mermaid')
  await page.getByRole('button', { name: 'Mermaid' }).click()
  await page.keyboard.type('graph TD; A-->B;')

  // toolbar toggle switches the block from source to a rendered diagram
  await page.getByRole('button', { name: 'Просмотр' }).click()
  await expect(page.locator('.anynote-code-block__preview svg').first()).toBeVisible({
    timeout: 15_000,
  })
})
```

- [ ] **Step 2: Run the spec (serialized, Docker must be up)**

Run: `docker compose up -d && pnpm exec playwright test apps/e2e/code-block.spec.ts --workers=1`
Expected: 2 passed. If the `/chats` redirect times out under load, the helper already uses a 30s timeout; re-run.

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/code-block.spec.ts
git commit -m "test(e2e): mermaid preview toggle + «Код» group selector"
```

---

## Task 5: Gates

- [ ] **Step 1: Full merge gate**

Run: `pnpm check-types && pnpm lint && pnpm --filter @repo/editor test && pnpm --filter @repo/mermaid test && pnpm build`
Expected: all green — including the `web` production build (confirms `@repo/mermaid/render-mermaid` bundles into the editor chunk under webpack without pulling Monaco) and `@repo/mermaid` tests (the wildcard import must not have disturbed its build).

- [ ] **Step 2: Commit any fixes**

```bash
git add -A
git commit -m "fix(editor): green gates for code-block diagrams"
```

---

## Self-Review Notes (for the executor)

- **Spec coverage:** Tasks 1–4 cover spec §3–§7. §4's `./render` alias is intentionally dropped — the existing `./*` wildcard already exposes `@repo/mermaid/render-mermaid`.
- **ProseMirror invariant:** `NodeViewContent` is always mounted; in preview the `<pre>` is `display:none` (not unmounted). Do not conditionally render the `<pre>`/`NodeViewContent` out of the tree.
- **Selector consistency:** slash items have no `description`, so accessible names equal labels — `getByRole('button', { name: 'Код' | 'Mermaid' })` is unambiguous. The group header «Код» is a `ListSubheader` (no button role), so it won't collide.
- **Type gotcha:** `NodeViewContent<'code'>` needs the explicit generic (the `as` prop is `NoInfer<T>`, `T` defaults to `'div'`).
- **Known third-party verification point:** Task 1 Step 3 confirms the `@repo/mermaid/render-mermaid` wildcard import resolves before any node-view code depends on it; documented fallback if not.
