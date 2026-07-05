# Block "Copy as Markdown" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Копировать текст" item to the block hover menu on TEXT pages that copies the hovered block to the clipboard as Markdown.

**Architecture:** Move the existing turndown-based `htmlToMarkdown` from `apps/web` page-export into `@repo/editor` as a shared pure leaf (web re-exports it). A new `blockToMarkdown(schema, node)` serializes the ProseMirror node to HTML via `DOMSerializer` and feeds it through `htmlToMarkdown`. `DragHandleMenu` gets the new item with a ~0.9s "Скопировано ✓" flash before closing.

**Tech Stack:** TypeScript, Tiptap 3 / ProseMirror (`@tiptap/pm/model` `DOMSerializer`), turndown 7, MUI, vitest (happy-dom pragma for DOM tests).

**Spec:** `docs/superpowers/specs/2026-07-05-block-copy-markdown-design.md`

**Deviations from spec (all deliberate):**

1. Turndown stays in `apps/web` — the spec assumed it could *move*, but `apps/web/src/server/page-import/html-to-tiptap.ts` uses turndown directly with its own config (import chain, no blank-line collapse). So `turndown` + `@types/turndown` are **added** to `@repo/editor` and **kept** in `apps/web`.
2. `blockToMarkdown(schema, node)` takes a `Schema`, not the spec's `(editor, node)` — directly testable without an Editor instance; the call site passes `editor.schema`.
3. The Дубликат item's icon changes `ContentCopyIcon` → `ControlPointDuplicateIcon`, because the new item takes `ContentCopyIcon` (spec-named) and two identical icons in one menu would confuse.
4. The unit test builds `getSchema([StarterKit])`, not the editor's full extension set (which configures `codeBlock: false` and uses CodeBlockLowlight instead). The three spec-mandated cases (heading, bullet list, bold) use StarterKit nodes the live editor keeps unmodified; the bonus fenced-code test exercises stock `codeBlock`, whose `pre > code` toDOM shell matches what CodeBlockLowlight emits.

---

## Context for the implementer

- Repo: pnpm + Turborepo monorepo. Prettier: no semicolons, single quotes, 100-char width. Run `pnpm format` if unsure.
- `@repo/editor` (`packages/editor`) is consumed by Next via `transpilePackages` (raw TS from `src/`), compiled with `moduleResolution: "Bundler"`, **extensionless relative imports**.
- Editor tests: vitest, default node environment. Tests that need a DOM put `// @vitest-environment happy-dom` as the **first line** of the file (see `packages/editor/src/extensions/link-click-handler.test.ts:1`).
- Husky runs lint-staged + gates on every commit — commits are slow; don't bypass with `--no-verify`.
- Existing block menu: `packages/editor/src/components/drag-handle-menu.tsx` (MUI `Menu`, items: Превратить в / Цвет / Divider / Дубликат / Переместить / Удалить). It already receives `editor`, resolves `node` from `pos`.
- `htmlToMarkdown` currently lives at `apps/web/src/server/page-export/html-to-markdown.ts` and has 3 web consumers: `jobs/process-export-job.ts` imports `@/server/page-export/html-to-markdown` directly, the export route imports the `@/server/page-export` barrel, and `page-export/index.ts` re-exports it via a relative `./html-to-markdown` import. All three resolve through the file being replaced, so the re-export keeps them untouched.

## File map

| File | Action | Responsibility |
| --- | --- | --- |
| `packages/editor/package.json` | Modify | add `turndown` dep, `@types/turndown` devDep, `./lib/html-to-markdown` exports entry |
| `packages/editor/src/lib/html-to-markdown.ts` | Create | shared turndown config (moved verbatim from web) |
| `packages/editor/src/lib/block-to-markdown.ts` | Create | PM node → HTML → markdown |
| `packages/editor/src/lib/block-to-markdown.test.ts` | Create | unit tests (happy-dom) |
| `apps/web/src/server/page-export/html-to-markdown.ts` | Replace | one-line re-export from `@repo/editor/lib/html-to-markdown` |
| `packages/editor/src/components/drag-handle-menu.tsx` | Modify | new "Копировать текст" item + copied flash |

---

### Task 0: Branch + commit design docs

- [ ] **Step 0.1: Create branch**

```bash
cd /Users/victor/Projects/anynote
git checkout -b feat/block-copy-markdown
```

- [ ] **Step 0.2: Commit spec + plan**

```bash
git add docs/superpowers/specs/2026-07-05-block-copy-markdown-design.md docs/superpowers/plans/2026-07-05-block-copy-markdown.md
git commit -m "docs(specs): add block copy-as-markdown design and plan"
```

Expected: commit succeeds (gates run via husky; docs-only change should pass quickly via turbo cache).

---

### Task 1: Move `htmlToMarkdown` into `@repo/editor`

**Files:**
- Modify: `packages/editor/package.json`
- Create: `packages/editor/src/lib/html-to-markdown.ts`
- Replace content: `apps/web/src/server/page-export/html-to-markdown.ts`
- Test (existing, must stay green): `apps/web/test/server/page-export/html-to-markdown.test.ts`

- [ ] **Step 1.1: Add deps to `packages/editor/package.json`**

In `dependencies` (alphabetical — after `"tippy.js"`, before `"y-prosemirror"`):

```json
    "turndown": "^7.2.4",
```

In `devDependencies` (after `"@types/react-dom"`):

```json
    "@types/turndown": "^5.0.6",
```

- [ ] **Step 1.2: Add explicit exports entry**

In the same file's `exports` map, insert after the `"./extensions/server"` entry and before `"./*"` (explicit entry, mirroring the `extensions/server` precedent — the `./*` wildcard maps to an extensionless path Node exports resolution can't satisfy):

```json
    "./lib/html-to-markdown": {
      "types": "./src/lib/html-to-markdown.ts",
      "import": "./src/lib/html-to-markdown.ts",
      "default": "./src/lib/html-to-markdown.ts"
    },
```

- [ ] **Step 1.3: Install**

```bash
pnpm install
```

Expected: lockfile updates, `packages/editor/node_modules/turndown` appears.

- [ ] **Step 1.4: Create `packages/editor/src/lib/html-to-markdown.ts`**

Content is the current `apps/web/src/server/page-export/html-to-markdown.ts` **verbatim** (behaviour must not change — the web test pins it):

```ts
import TurndownService from 'turndown'

export function htmlToMarkdown(html: string): string {
  const td = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
  })

  td.addRule('callout', {
    filter: (n) => {
      if (n.nodeName !== 'DIV') return false
      return n.getAttribute('data-type') === 'callout'
    },
    replacement: (content, node) => {
      const icon = node.getAttribute('data-emoji') ?? node.getAttribute('data-icon') ?? '💡'
      return `\n> ${icon} ${content.trim()}\n`
    },
  })

  td.addRule('details', {
    filter: (n) => {
      return n.nodeName === 'DETAILS' || n.getAttribute('data-type') === 'details'
    },
    replacement: (content) => {
      const trimmed = content.trim()
      const lines = trimmed.split('\n').filter((l) => l.length > 0)
      const summary = lines[0] ?? ''
      const body = lines.slice(1).join('\n')
      return `\n<details>\n<summary>${summary}</summary>\n${body}\n</details>\n`
    },
  })

  td.addRule('hiddenText', {
    filter: (n) => {
      if (n.nodeName !== 'DIV') return false
      return n.getAttribute('data-type') === 'hidden-text'
    },
    replacement: (content) => `<span class="hidden">${content.trim()}</span>`,
  })

  td.addRule('fileAttachment', {
    filter: (n) => {
      if (n.nodeName !== 'DIV') return false
      return n.getAttribute('data-type') === 'file-attachment'
    },
    replacement: (_content, node) => {
      const name = node.getAttribute('data-name') ?? 'file'
      const url = node.getAttribute('data-url') ?? node.getAttribute('data-href') ?? '#'
      return `[${name}](${url})`
    },
  })

  // Turndown emits two newlines between most blocks for standard markdown.
  // Callers found the extra blank lines noisy — collapse to single newlines
  // (markdown renderers still treat these as paragraph breaks for rendering
  // purposes because of hard line breaks at the block level).
  const raw = td.turndown(html)
  return raw.replaceAll(/\n{2,}/g, '\n').trim() + '\n'
}
```

Note: turndown is safe in both runtimes — its node build parses HTML via bundled domino (used today server-side in web), and its `browser` package.json field swaps in a DOM-based build with `@mixmark-io/domino → false`, so no domino ships in the Next client bundle.

- [ ] **Step 1.5: Replace `apps/web/src/server/page-export/html-to-markdown.ts` with a re-export**

Full new file content:

```ts
export { htmlToMarkdown } from '@repo/editor/lib/html-to-markdown'
```

Do **not** touch the 3 consumers (`page-export/index.ts`, `api/pages/[pageId]/export/[format]/route.ts`, `jobs/process-export-job.ts`) — they import via `@/server/page-export/...` and keep working. Do **not** remove `turndown` from `apps/web/package.json` — `src/server/page-import/html-to-tiptap.ts` still uses it directly.

- [ ] **Step 1.6: Verify the existing web test still passes**

```bash
pnpm --filter web exec vitest run test/server/page-export/html-to-markdown.test.ts
```

Expected: 6 tests PASS (headings/bullets/fenced, callout, details, hidden-text, file-attachment, blank-line collapse).

- [ ] **Step 1.7: Type-check both packages**

```bash
pnpm --filter @repo/editor check-types && pnpm --filter web check-types
```

Expected: both exit 0. (If web fails with a stale `.next/types` error about an unrelated deleted route, `rm -rf apps/web/.next/types` and rerun.)

- [ ] **Step 1.8: Commit**

```bash
git add packages/editor/package.json packages/editor/src/lib/html-to-markdown.ts apps/web/src/server/page-export/html-to-markdown.ts pnpm-lock.yaml
git commit -m "refactor(editor): move htmlToMarkdown into @repo/editor shared leaf"
```

---

### Task 2: `blockToMarkdown` (TDD)

**Files:**
- Test: `packages/editor/src/lib/block-to-markdown.test.ts`
- Create: `packages/editor/src/lib/block-to-markdown.ts`

- [ ] **Step 2.1: Write the failing test**

Create `packages/editor/src/lib/block-to-markdown.test.ts`. Idioms copied from `packages/editor/src/extensions/collapsible-headings.test.ts`: `getSchema([StarterKit])` + `nodeFromJSON` (never index `schema.nodes[x]` directly). happy-dom pragma is required because `DOMSerializer` needs a real `document`.

```ts
// @vitest-environment happy-dom
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { describe, expect, it } from 'vitest'

import { blockToMarkdown } from './block-to-markdown'

// Real StarterKit schema so toDOM output matches what the live editor produces.
const schema = getSchema([StarterKit])

type JSONNode = {
  type: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: { type: string }[]
  content?: JSONNode[]
}

const node = (json: JSONNode) => schema.nodeFromJSON(json)

describe('blockToMarkdown', () => {
  it('serializes a heading to ATX markdown', () => {
    const heading = node({
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Заголовок' }],
    })
    expect(blockToMarkdown(schema, heading)).toBe('## Заголовок\n')
  })

  it('serializes a bullet list with dash markers', () => {
    const list = node({
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Один' }] }],
        },
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Два' }] }],
        },
      ],
    })
    const md = blockToMarkdown(schema, list)
    // turndown pads after the marker; assert marker + text, not exact spacing
    expect(md).toMatch(/^-\s+Один$/m)
    expect(md).toMatch(/^-\s+Два$/m)
  })

  it('keeps inline marks (bold) as markdown', () => {
    const para = node({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'обычный ' },
        { type: 'text', text: 'жирный', marks: [{ type: 'bold' }] },
      ],
    })
    expect(blockToMarkdown(schema, para)).toBe('обычный **жирный**\n')
  })

  it('serializes a code block as fenced', () => {
    // Stock StarterKit codeBlock — the live editor swaps it for CodeBlockLowlight,
    // but both emit the same `pre > code` toDOM shell that turndown fences.
    const code = node({
      type: 'codeBlock',
      content: [{ type: 'text', text: 'const x = 1' }],
    })
    const md = blockToMarkdown(schema, code)
    expect(md).toContain('```')
    expect(md).toContain('const x = 1')
  })
})
```

- [ ] **Step 2.2: Run the test — expect failure**

```bash
pnpm --filter @repo/editor exec vitest run src/lib/block-to-markdown.test.ts
```

Expected: FAIL — `Cannot find module './block-to-markdown'` (or equivalent resolve error).

- [ ] **Step 2.3: Implement `packages/editor/src/lib/block-to-markdown.ts`**

```ts
import { DOMSerializer } from '@tiptap/pm/model'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'

import { htmlToMarkdown } from './html-to-markdown'

// Serializes a single block node through the same renderHTML/toDOM path the
// page-export pipeline uses, so the markdown matches what a full-page export
// would produce for that block. Requires a DOM `document` (browser or
// happy-dom) — callers are client components.
export function blockToMarkdown(schema: Schema, node: PMNode): string {
  const container = document.createElement('div')
  container.appendChild(DOMSerializer.fromSchema(schema).serializeNode(node))
  return htmlToMarkdown(container.innerHTML)
}
```

- [ ] **Step 2.4: Run the test — expect pass**

```bash
pnpm --filter @repo/editor exec vitest run src/lib/block-to-markdown.test.ts
```

Expected: 4 tests PASS. If the exact-match assertions (heading/bold) fail on spacing, inspect the received string — turndown's exact escaping/whitespace is pinned by `htmlToMarkdown`'s collapse+trim, so `'## Заголовок\n'` should hold; only relax to `toContain` if the received output shows a legitimate turndown formatting difference, and note it in the commit message.

- [ ] **Step 2.5: Commit**

```bash
git add packages/editor/src/lib/block-to-markdown.ts packages/editor/src/lib/block-to-markdown.test.ts
git commit -m "feat(editor): add blockToMarkdown block serializer"
```

---

### Task 3: "Копировать текст" menu item

**Files:**
- Modify: `packages/editor/src/components/drag-handle-menu.tsx`

- [ ] **Step 3.1: Add imports**

In the react import line, add `useEffect` and `useRef`:

```ts
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
```

Add two icon imports (alphabetical among the existing icon imports):

```ts
import CheckIcon from '@mui/icons-material/Check'
import ControlPointDuplicateIcon from '@mui/icons-material/ControlPointDuplicate'
```

Add the serializer import next to the other `../lib/` imports:

```ts
import { blockToMarkdown } from '../lib/block-to-markdown'
```

- [ ] **Step 3.2: Add copied state + timer**

Inside `DragHandleMenu`, next to the existing `submenu` state:

```ts
const [copied, setCopied] = useState(false)
const copyTimerRef = useRef<number | null>(null)

useEffect(
  () => () => {
    if (copyTimerRef.current != null) window.clearTimeout(copyTimerRef.current)
  },
  [],
)
```

- [ ] **Step 3.3: Reset copied state in `handleClose`**

Replace the existing `handleClose` with:

```ts
const handleClose = () => {
  if (copyTimerRef.current != null) {
    window.clearTimeout(copyTimerRef.current)
    copyTimerRef.current = null
  }
  setCopied(false)
  setSubmenu(null)
  setSubmenuAnchor(null)
  onClose()
}
```

- [ ] **Step 3.4: Add the handler** (after `handleOpenSubmenu`, before `handleConvert`)

```ts
const handleCopyText = () => {
  if (!node || copied) return
  const markdown = blockToMarkdown(editor.schema, node)
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
  if (!clipboard?.writeText) {
    // Insecure context (plain HTTP) — nothing to flash, just close.
    handleClose()
    return
  }
  void clipboard
    .writeText(markdown)
    .then(() => {
      setCopied(true)
      copyTimerRef.current = window.setTimeout(handleClose, 900)
    })
    .catch(() => handleClose())
}
```

- [ ] **Step 3.5: Add the menu item + de-collide the Дубликат icon**

Insert directly after the `<Divider />` and before the Дубликат item:

```tsx
<MenuItem onClick={handleCopyText} data-testid="block-copy-text">
  <ListItemIcon>
    {copied ? (
      <CheckIcon fontSize="small" color="success" />
    ) : (
      <ContentCopyIcon fontSize="small" />
    )}
  </ListItemIcon>
  <ListItemText>{copied ? 'Скопировано' : 'Копировать текст'}</ListItemText>
</MenuItem>
```

The Дубликат item currently uses `ContentCopyIcon`, which would now appear twice in one menu. Swap its icon to `ControlPointDuplicateIcon` (deviation 3 in the plan header — spec named only the new item's icon):

```tsx
<MenuItem onClick={handleDuplicate}>
  <ListItemIcon>
    <ControlPointDuplicateIcon fontSize="small" />
  </ListItemIcon>
  <ListItemText>Дубликат</ListItemText>
</MenuItem>
```

- [ ] **Step 3.6: Verify package health**

```bash
pnpm --filter @repo/editor check-types && pnpm --filter @repo/editor lint && pnpm --filter @repo/editor test
```

Expected: all exit 0 (no unit test covers the menu component — existing suite must stay green).

- [ ] **Step 3.7: Commit**

```bash
git add packages/editor/src/components/drag-handle-menu.tsx
git commit -m "feat(editor): add Копировать текст (copy block as markdown) to block menu"
```

---

### Task 4: Gates + live verification

- [ ] **Step 4.1: Full gates**

```bash
pnpm gates
```

Expected: check-types, lint, build, test all green. Known flake notes: if `@repo/editor` tests fail with "document is not defined" post-teardown, it's the known Tiptap focus-timer flake — rerun; if web check-types OOMs, raise `NODE_OPTIONS=--max-old-space-size`.

- [ ] **Step 4.2: Live verification (real app, not just tests)**

Prereq: `docker compose up -d`, root `.env` present.

1. `pnpm --filter web dev` (and `pnpm --filter @repo/yjs-server dev` for collaborative load).
2. Open a TEXT page, hover a **heading** block → click the ⋮⋮ handle → menu shows "Копировать текст" between the divider and Дубликат.
3. Click it → item flashes ✓ "Скопировано" ~0.9s → menu closes.
4. `pbpaste` in a terminal → expect `## <heading text>`.
5. Repeat for a bullet list — expect `-   item` lines (turndown pads three spaces after the marker, and a whitespace-only line sits between items; both are pre-existing `htmlToMarkdown` behaviour pinned by the web export test) — and a paragraph with bold (`**…**`).
6. Confirm the block itself is untouched (no selection change side effects, undo history clean).

- [ ] **Step 4.3: Finish**

Use superpowers:finishing-a-development-branch — present merge/PR options to the user.

---

## Self-review notes

- Spec coverage: menu item ✓ (Task 3), markdown fidelity via export path ✓ (Task 2), shared `htmlToMarkdown` ✓ (Task 1), flash feedback ✓ (3.4/3.5), clipboard-unavailable guard ✓ (3.4), tests ✓ (Task 2 + existing web test in 1.6), manual verification ✓ (4.2).
- Deviations from spec: all four listed in the plan header.
- Type consistency: `blockToMarkdown(schema: Schema, node: PMNode)` defined in Task 2, called as `blockToMarkdown(editor.schema, node)` in Task 3.4 ✓.
- Adversarial verification (3-агент workflow): no blockers; the exact-match test assertions were confirmed by a live run of the happy-dom + DOMSerializer + turndown pipeline; edit anchors in `drag-handle-menu.tsx` verified against current source; all referenced APIs (`getSchema`, `nodeFromJSON`, `DOMSerializer.serializeNode`, MUI `Check`/`ControlPointDuplicate` icons) confirmed present in installed versions.
