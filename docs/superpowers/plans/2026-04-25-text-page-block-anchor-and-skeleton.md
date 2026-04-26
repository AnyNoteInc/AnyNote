# TEXT page block-anchor + skeleton implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add scroll-and-highlight behavior for block-anchor URLs on TEXT pages and a continuous content skeleton during page/editor load.

**Architecture:** A ProseMirror Decoration plugin tags top-level Tiptap nodes with `data-block-index="N"`. PageRenderer reads `window.location.hash` (mount + `hashchange`), and after the editor is ready calls `scrollToBlockIndex(editor, N)` which finds the DOM node, scrolls it to the vertical center of the viewport, and toggles a `.block-flash` CSS class for 3s with a smooth fade. A shared `EditorContentSkeleton` replaces the spinner used during the dynamic-import + Y.Doc-init phases for `pageType === 'TEXT'`. Chat markdown links pass through an injected renderer prop so the web app can route internal links via Next.js `Link` (client-side nav) and external links through a sanitized `<a target="_blank">`.

**Tech Stack:** Tiptap 3 + ProseMirror, Next.js 16 App Router, react-markdown 10, MUI Skeleton, Playwright.

**Spec:** `docs/superpowers/specs/2026-04-25-text-page-block-anchor-and-skeleton-design.md`

---

### Task 1: BlockIndexAttributes Tiptap extension

**Files:**

- Create: `packages/editor/src/extensions/block-index-attributes.ts`

ProseMirror Decoration plugin that tags every top-level node in `doc.content` with `data-block-index="N"`. Decorations are presentation-only — they never modify the doc or write to Y.Doc, so they are safe under collaborative editing.

- [ ] **Step 1: Create extension file**

```ts
// packages/editor/src/extensions/block-index-attributes.ts
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const BlockIndexAttributes = Extension.create({
  name: 'blockIndexAttributes',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('blockIndexAttributes'),
        props: {
          decorations(state) {
            const decos: Decoration[] = []
            state.doc.content.forEach((node, offset, index) => {
              decos.push(
                Decoration.node(offset, offset + node.nodeSize, {
                  'data-block-index': String(index),
                }),
              )
            })
            return DecorationSet.create(state.doc, decos)
          },
        },
      }),
    ]
  },
})
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @repo/editor check-types`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/editor/src/extensions/block-index-attributes.ts
git commit -m "feat(editor): BlockIndexAttributes extension tags top-level nodes"
```

---

### Task 2: Register BlockIndexAttributes in buildExtensions

**Files:**

- Modify: `packages/editor/src/extensions/index.ts`

- [ ] **Step 1: Import and register**

In `packages/editor/src/extensions/index.ts`, add the import alongside other extension imports (after existing imports):

```ts
import { BlockIndexAttributes } from './block-index-attributes'
```

Append `BlockIndexAttributes` to the array returned by `buildExtensions`:

```ts
export const buildExtensions = (opts: BuildExtensionsOptions) => [
  StarterKit.configure({ undoRedo: false }),
  buildPlaceholder(opts.placeholder),
  Link.configure({ openOnClick: false }),
  Typography,
  AnynoteTextColor,
  BlockBackground,
  ResizableImage.configure({ uploadHandler: opts.uploadHandler }),
  TaskList,
  TaskItemWithCheckbox.configure({ nested: true }),
  Table.configure({ resizable: true }),
  TableRow,
  TableHeader,
  TableCell,
  CodeBlockLowlight.configure({ lowlight }),
  Callout,
  Toggle,
  HiddenText,
  FileAttachment,
  PageLink.configure({ onNavigate: opts.onNavigateToPage }),
  ...buildCollaboration({ ydoc: opts.ydoc, provider: opts.provider, user: opts.user }),
  buildFileUpload(opts.uploadHandler),
  SlashMenu.configure({
    items: opts.slashItems,
    render: opts.slashRender,
  }),
  BlockIndexAttributes,
]
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @repo/editor check-types`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/editor/src/extensions/index.ts
git commit -m "feat(editor): register BlockIndexAttributes in buildExtensions"
```

---

### Task 3: scrollToBlockIndex utility + .block-flash CSS

**Files:**

- Create: `packages/editor/src/block-anchor.ts`
- Modify: `packages/editor/src/index.ts`
- Modify: `packages/editor/src/styles/content.css`

- [ ] **Step 1: Create utility**

```ts
// packages/editor/src/block-anchor.ts
import type { Editor } from '@tiptap/core'

const BLOCK_FLASH_CLASS = 'block-flash'
const BLOCK_FLASH_DURATION_MS = 3000

export function scrollToBlockIndex(editor: Editor, index: number): boolean {
  const root = editor.view.dom
  // Drop any leftover flash so a follow-up navigation doesn't leave two
  // highlighted blocks at once.
  root.querySelectorAll(`.${BLOCK_FLASH_CLASS}`).forEach((el) => {
    el.classList.remove(BLOCK_FLASH_CLASS)
  })
  const target = root.querySelector(`[data-block-index="${index}"]`)
  if (!(target instanceof HTMLElement)) return false
  target.scrollIntoView({ block: 'center', behavior: 'smooth' })
  target.classList.add(BLOCK_FLASH_CLASS)
  window.setTimeout(() => target.classList.remove(BLOCK_FLASH_CLASS), BLOCK_FLASH_DURATION_MS)
  return true
}
```

- [ ] **Step 2: Append CSS rule**

Append to `packages/editor/src/styles/content.css`:

```css
/* Block-anchor flash: applied for 3s when the user navigates to a
   /workspaces/.../pages/.../#N URL. The transition fades the background
   back to transparent when the class is removed. */
.anynote-editor .ProseMirror .block-flash {
  background-color: #fff9c4; /* MUI yellow.100 */
  border-radius: 4px;
  transition: background-color 0.6s ease-out;
}
```

- [ ] **Step 3: Export from package root**

Add to `packages/editor/src/index.ts` (anywhere among the exports):

```ts
export { scrollToBlockIndex } from './block-anchor'
```

- [ ] **Step 4: Type-check**

Run: `pnpm --filter @repo/editor check-types`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/block-anchor.ts packages/editor/src/styles/content.css packages/editor/src/index.ts
git commit -m "feat(editor): scrollToBlockIndex utility + block-flash CSS"
```

---

### Task 4: Add loadingFallback prop to AnyNoteEditor

**Files:**

- Modify: `packages/editor/src/types.ts`
- Modify: `packages/editor/src/anynote-editor.tsx`

- [ ] **Step 1: Add prop to AnyNoteEditorProps**

In `packages/editor/src/types.ts`, append `loadingFallback?: ReactNode` to `AnyNoteEditorProps` (the `ReactNode` import already exists at the top of the file):

```ts
export type AnyNoteEditorProps = {
  pageId: string
  workspaceId: string
  initialContentYjs?: string | null
  yjsUrl: string
  yjsToken: () => Promise<string>
  user: AnyNoteEditorUser
  uploadHandler: UploadHandler
  pageSearch: (query: string) => Promise<PageLookupItem[]>
  onNavigateToPage: (pageId: string) => void
  editable?: boolean
  className?: string
  placeholder?: string
  onReady?: (editor: Editor) => void
  onRequestBlockMove?: (pos: number) => void
  loadingFallback?: ReactNode
}
```

- [ ] **Step 2: Use prop in AnyNoteEditor's empty-state branch**

Replace the `if (!resources)` branch (currently at lines 69–71) of `packages/editor/src/anynote-editor.tsx` with:

```tsx
if (!resources) {
  return (
    props.loadingFallback ?? (
      <Box className={`anynote-editor ${props.className ?? ''}`} sx={{ height: '100%' }} />
    )
  )
}
```

- [ ] **Step 3: Type-check**

Run: `pnpm --filter @repo/editor check-types`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/editor/src/types.ts packages/editor/src/anynote-editor.tsx
git commit -m "feat(editor): support loadingFallback prop for AnyNoteEditor"
```

---

### Task 5: ChatMessageContent — renderLink prop (TDD)

**Files:**

- Modify: `packages/ui/test/chat-message-content.test.tsx`
- Modify: `packages/ui/src/components/chat/chat-message-content.tsx`

- [ ] **Step 1: Write failing tests**

Append to the existing `describe('ChatMessageContent', ...)` block in `packages/ui/test/chat-message-content.test.tsx`:

```tsx
it('renders default <a> when renderLink is not provided', () => {
  const { container } = render(
    <ChatMessageContent parts={[{ type: 'text', text: '[link](/foo)' }]} />,
  )
  const anchor = container.querySelector('a')
  expect(anchor).toBeTruthy()
  expect(anchor?.getAttribute('href')).toBe('/foo')
  expect(anchor?.textContent).toBe('link')
})

it('uses renderLink when provided', () => {
  const { container } = render(
    <ChatMessageContent
      parts={[{ type: 'text', text: '[link](/foo)' }]}
      renderLink={(href, children) => (
        <span data-testid="custom-link" data-href={href}>
          {children}
        </span>
      )}
    />,
  )
  const span = container.querySelector('[data-testid="custom-link"]')
  expect(span).toBeTruthy()
  expect(span?.getAttribute('data-href')).toBe('/foo')
  expect(span?.textContent).toBe('link')
  expect(container.querySelector('a')).toBeNull()
})
```

- [ ] **Step 2: Run tests, see failures**

Run: `pnpm --filter @repo/ui test -- chat-message-content`
Expected: 2 new tests fail (TypeScript: prop `renderLink` does not exist).

- [ ] **Step 3: Implement renderLink**

Replace `packages/ui/src/components/chat/chat-message-content.tsx` with:

```tsx
'use client'

import Box from '@mui/material/Box'
import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'

import { ChatFileChip } from './chat-file-chip'
import { ChatServiceBlock } from './chat-service-block'
import type { ChatMessagePart } from './chat-types'

export type ChatRenderLink = (href: string, children: ReactNode) => ReactNode

type ChatMessageContentProps = {
  parts: ChatMessagePart[]
  renderLink?: ChatRenderLink
}

function getPartOrder(part: ChatMessagePart) {
  switch (part.type) {
    case 'text':
      return 0
    case 'tool':
      return 1
    case 'attacment':
      return 2
    default:
      return 3
  }
}

export function ChatMessageContent({ parts, renderLink }: ChatMessageContentProps) {
  const sortedParts = [...parts].sort((left, right) => getPartOrder(left) - getPartOrder(right))
  const markdownComponents = renderLink
    ? {
        a: ({ href, children }: { href?: string; children?: ReactNode }) =>
          href ? <>{renderLink(href, children)}</> : <>{children}</>,
      }
    : undefined

  return (
    <Box display="flex" flexDirection="column" gap={1.25}>
      {sortedParts.map((part, index) => {
        if (part.type === 'text') {
          return (
            <Box
              key={`${part.type}-${index}`}
              sx={{
                '& code': {
                  bgcolor: 'action.hover',
                  borderRadius: 1,
                  px: 0.5,
                  py: 0.125,
                },
                '& ol, & ul': {
                  m: 0,
                  pl: 3,
                },
                '& p': {
                  m: 0,
                },
                '& p + p': {
                  mt: 1,
                },
                '& pre': {
                  bgcolor: 'grey.100',
                  borderRadius: 2,
                  m: 0,
                  overflowX: 'auto',
                  p: 1,
                },
                '& strong': {
                  fontWeight: 600,
                },
                overflowWrap: 'anywhere',
              }}
            >
              <ReactMarkdown components={markdownComponents}>{part.text}</ReactMarkdown>
            </Box>
          )
        }

        if (part.type === 'attacment') {
          return (
            <ChatFileChip
              key={part.fileId}
              href={part.downloadUrl}
              name={part.name}
              secondaryLabel={part.fileSize}
            />
          )
        }

        if (part.type === 'tool') {
          return <ChatServiceBlock key={part.id} part={part} />
        }

        return null
      })}
    </Box>
  )
}
```

- [ ] **Step 4: Run tests, all pass**

Run: `pnpm --filter @repo/ui test -- chat-message-content`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/chat/chat-message-content.tsx packages/ui/test/chat-message-content.test.tsx
git commit -m "feat(ui): ChatMessageContent supports renderLink prop"
```

---

### Task 6: Pass renderLink through ChatMessageList and ChatThread

**Files:**

- Modify: `packages/ui/src/components/chat/chat-message-list.tsx`
- Modify: `packages/ui/src/components/chat/chat-thread.tsx`

- [ ] **Step 1: Add prop to ChatMessageList**

In `packages/ui/src/components/chat/chat-message-list.tsx`:

Replace the import line `import { ChatMessageContent } from "./chat-message-content"` with:

```tsx
import { ChatMessageContent, type ChatRenderLink } from './chat-message-content'
```

Add `renderLink?: ChatRenderLink` to `ChatMessageListProps`:

```tsx
type ChatMessageListProps = {
  messages: ChatThreadMessage[]
  emptyTitle?: string
  emptyDescription?: string
  showEmptyState?: boolean
  scrollMode?: 'internal' | 'page'
  renderLink?: ChatRenderLink
}
```

Destructure `renderLink` in the component signature and pass to `ChatMessageContent`. The signature change:

```tsx
export function ChatMessageList({
  messages,
  emptyTitle,
  emptyDescription,
  showEmptyState = true,
  scrollMode = "internal",
  renderLink,
}: ChatMessageListProps) {
```

The `<ChatMessageContent>` usage (currently `<ChatMessageContent parts={message.parts} />` in the renderItem callback) becomes:

```tsx
<ChatMessageContent parts={message.parts} renderLink={renderLink} />
```

- [ ] **Step 2: Add prop to ChatThread**

In `packages/ui/src/components/chat/chat-thread.tsx`:

Add to imports (alongside existing chat imports):

```tsx
import type { ChatRenderLink } from './chat-message-content'
```

Add to `ChatThreadProps`:

```tsx
  renderLink?: ChatRenderLink
```

Destructure in the component signature alongside other props.

Pass to `<ChatMessageList ...>` (search for the existing usage, around line 135):

```tsx
<ChatMessageList
  messages={messages}
  emptyTitle={emptyTitle}
  emptyDescription={emptyDescription}
  scrollMode={scrollContainerSelector ? 'page' : 'internal'}
  renderLink={renderLink}
/>
```

(Adjust to match the existing prop list — only add `renderLink={renderLink}`.)

- [ ] **Step 3: Type-check**

Run: `pnpm --filter @repo/ui check-types`
Expected: PASS

- [ ] **Step 4: Run UI tests (regression check)**

Run: `pnpm --filter @repo/ui test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/chat/chat-message-list.tsx packages/ui/src/components/chat/chat-thread.tsx
git commit -m "feat(ui): propagate renderLink through ChatMessageList and ChatThread"
```

---

### Task 7: EditorContentSkeleton component

**Files:**

- Create: `apps/web/src/components/page/editor-content-skeleton.tsx`

Geometry mirrors the content portion of `apps/web/src/app/(protected)/workspaces/[workspaceId]/pages/[pageId]/loading.tsx` so the user sees one continuous skeleton across the RSC → JS-load → Y.Doc-init phases.

- [ ] **Step 1: Create skeleton**

```tsx
// apps/web/src/components/page/editor-content-skeleton.tsx
'use client'

import { Box, Skeleton, Stack } from '@repo/ui/components'

import { pageColumnSx } from './column-sx'

export function EditorContentSkeleton() {
  return (
    <Box sx={{ ...pageColumnSx, py: 2 }}>
      <Stack spacing={1.25}>
        <Skeleton variant="text" height={24} />
        <Skeleton variant="text" height={24} width="90%" />
        <Skeleton variant="text" height={24} width="75%" />
        <Skeleton variant="rectangular" height={160} sx={{ borderRadius: 1, mt: 2 }} />
        <Skeleton variant="text" height={24} />
        <Skeleton variant="text" height={24} width="85%" />
      </Stack>
    </Box>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter web check-types`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/page/editor-content-skeleton.tsx
git commit -m "feat(web): EditorContentSkeleton matches loading.tsx geometry"
```

---

### Task 8: PageRenderer — skeleton wiring + hash-anchor effect

**Files:**

- Modify: `apps/web/src/components/page/page-renderer.tsx`

- [ ] **Step 1: Update imports**

Change the React import to include `useEffect` and `useState`:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
```

Update the `@repo/editor` import to include `scrollToBlockIndex`:

```tsx
import {
  BlockMoveDialog,
  moveBlockToPage,
  scrollToBlockIndex,
  type Editor,
  type MoveBlockResult,
  type PageLookupItem,
} from '@repo/editor'
```

Add the skeleton import (after other local imports):

```tsx
import { EditorContentSkeleton } from './editor-content-skeleton'
```

- [ ] **Step 2: Replace TEXT-variant dynamic loading fallback**

Replace the `AnyNoteEditor` dynamic line so the loading fallback is the skeleton (Board and Genogram keep `CenteredSpinner`):

```tsx
const AnyNoteEditor = dynamic(() => import('@repo/editor').then((m) => m.AnyNoteEditor), {
  ssr: false,
  loading: () => <EditorContentSkeleton />,
})
```

- [ ] **Step 3: Track editor-ready state**

Update `handleEditorReady` to also flip an `editorReady` state, and add the state declaration near the other `useState` calls (after the existing `useState` lines):

```tsx
const [editorReady, setEditorReady] = useState(false)

// ... existing useState calls remain ...

const handleEditorReady = useCallback(
  (editor: Editor) => {
    editorRef.current = editor
    pageEditor.setEditor(editor)
    setEditorReady(true)
  },
  [pageEditor],
)
```

- [ ] **Step 4: Add the hash-anchor effect**

Add immediately after `handleEditorReady`:

```tsx
useEffect(() => {
  if (!editorReady) return
  const editor = editorRef.current
  if (!editor) return

  let timer: ReturnType<typeof window.setTimeout> | null = null
  let cancelled = false

  const apply = () => {
    const hash = window.location.hash.slice(1)
    if (!hash) return
    const index = Number.parseInt(hash, 10)
    if (Number.isNaN(index)) return
    let attempts = 0
    const tryScroll = () => {
      if (cancelled) return
      if (scrollToBlockIndex(editor, index)) return
      if (++attempts < 10) {
        timer = window.setTimeout(tryScroll, 150)
      }
    }
    tryScroll()
  }

  apply()
  window.addEventListener('hashchange', apply)
  return () => {
    cancelled = true
    if (timer) window.clearTimeout(timer)
    window.removeEventListener('hashchange', apply)
  }
}, [editorReady])
```

- [ ] **Step 5: Pass loadingFallback to AnyNoteEditor**

In the `if (page.type === "TEXT")` branch, add `loadingFallback={<EditorContentSkeleton />}` to the `<AnyNoteEditor>` props:

```tsx
<AnyNoteEditor
  pageId={page.id}
  workspaceId={workspaceId}
  initialContentYjs={page.contentYjs}
  yjsUrl={yjsUrl}
  yjsToken={fetchYjsToken}
  user={user}
  uploadHandler={uploadHandler}
  pageSearch={pageSearch}
  onNavigateToPage={onNavigateToPage}
  onReady={handleEditorReady}
  onRequestBlockMove={handleRequestBlockMove}
  loadingFallback={<EditorContentSkeleton />}
/>
```

- [ ] **Step 6: Type-check + lint**

Run: `pnpm --filter web check-types`
Expected: PASS

Run: `pnpm --filter web lint`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/page/page-renderer.tsx
git commit -m "feat(web): TEXT page skeleton + hash-anchor scroll/highlight"
```

---

### Task 9: chat-link-renderer + workspace-chat-client wiring

**Files:**

- Create: `apps/web/src/components/chat/chat-link-renderer.tsx`
- Modify: `apps/web/src/components/workspace/chat/workspace-chat-client.tsx`

- [ ] **Step 1: Create renderer**

```tsx
// apps/web/src/components/chat/chat-link-renderer.tsx
'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'

const SAFE_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:'])

export function renderChatLink(href: string, children: ReactNode): ReactNode {
  // Internal app links: /workspaces/..., /app, etc. (single leading slash, not //)
  if (href.startsWith('/') && !href.startsWith('//')) {
    return <Link href={href}>{children}</Link>
  }
  // External: only render <a> for safe protocols (http/https)
  try {
    const url = new URL(href)
    if (SAFE_EXTERNAL_PROTOCOLS.has(url.protocol)) {
      return (
        <a href={href} rel="noopener noreferrer" target="_blank">
          {children}
        </a>
      )
    }
  } catch {
    // Not a valid URL — fall through
  }
  // Unsafe / unrecognized — render the label as plain text (no link)
  return <>{children}</>
}
```

- [ ] **Step 2: Wire into workspace-chat-client**

In `apps/web/src/components/workspace/chat/workspace-chat-client.tsx`:

Add the import alongside other component imports:

```tsx
import { renderChatLink } from '@/components/chat/chat-link-renderer'
```

On the `<ChatThread ... />` element (around line 135), add the prop `renderLink={renderChatLink}` next to the other props.

- [ ] **Step 3: Type-check + lint**

Run: `pnpm --filter web check-types`
Expected: PASS

Run: `pnpm --filter web lint`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/chat/chat-link-renderer.tsx apps/web/src/components/workspace/chat/workspace-chat-client.tsx
git commit -m "feat(web): chat links use Next Link for internal hrefs, sanitize external"
```

---

### Task 10: E2E spec for block-anchor

**Files:**

- Create: `apps/e2e/page-block-anchor.spec.ts`

Verifies end-to-end that `/workspaces/{id}/pages/{id}#N`:

- renders `[data-block-index="N"]` in the DOM,
- adds `block-flash` class on arrival,
- removes the class within 3.5s.

- [ ] **Step 1: Start the dev server (in another terminal, leave running)**

```bash
docker compose up -d
pnpm dev
```

(Wait for `web` to be ready on `http://localhost:3000`.)

- [ ] **Step 2: Write the spec**

```ts
// apps/e2e/page-block-anchor.spec.ts
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let RoleType: { OWNER: string }
let prisma: {
  $disconnect: () => Promise<void>
  user: {
    findUniqueOrThrow: (args: unknown) => Promise<{ id: string }>
  }
  workspace: {
    create: (args: unknown) => Promise<{ id: string }>
    delete: (args: unknown) => Promise<unknown>
  }
  workspaceMember: {
    create: (args: unknown) => Promise<unknown>
  }
  page: {
    create: (args: unknown) => Promise<{ id: string }>
    delete: (args: unknown) => Promise<unknown>
  }
}

test.setTimeout(120_000)

test.beforeAll(async () => {
  const envPath = join(process.cwd(), '.env')
  const envFile = readFileSync(envPath, 'utf8')
  const readVar = (key: string): string | undefined =>
    envFile
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.startsWith(`${key}=`))
      ?.slice(`${key}=`.length)
      .replace(/^"|"$/g, '')

  if (!process.env.DATABASE_URL) {
    const databaseUrl = readVar('DATABASE_URL')
    if (!databaseUrl) throw new Error('DATABASE_URL not configured in .env')
    process.env.DATABASE_URL = databaseUrl
  }
  const db = await import('../../packages/db/src/index')
  RoleType = db.RoleType
  prisma = db.prisma
})

test.afterAll(async () => {
  if (prisma) await prisma.$disconnect()
})

const password = 'SuperSecure123!'

test('block-anchor URL scrolls to and highlights the indexed block', async ({ page: browser }) => {
  const email = `block-anchor+${Date.now()}@example.com`

  // --- Register via UI ---
  await browser.goto('/sign-up')
  await browser.getByRole('textbox', { name: 'Email' }).fill(email)
  await browser.getByRole('textbox', { name: 'Фамилия' }).fill('Тест')
  await browser.getByRole('textbox', { name: 'Имя' }).fill('Якорь')
  await browser.getByRole('textbox', { name: /^пароль$/i }).fill(password)
  await browser.getByRole('textbox', { name: 'Повторите пароль' }).fill(password)
  await browser.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await browser.waitForURL(/\/workspaces\/new/)

  await expect
    .poll(
      async () =>
        prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } }).catch(() => null),
      { timeout: 10_000, intervals: [200, 500, 1000] },
    )
    .toBeTruthy()

  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  })

  const workspace = await prisma.workspace.create({
    data: { name: `Anchor ${Date.now()}`, createdById: user.id },
    select: { id: true },
  })
  await prisma.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: user.id, role: RoleType.OWNER },
  })

  // --- Page with 3 paragraphs (indices 0, 1, 2). Long filler so the
  //     viewport must scroll for #2 to be vertically centered. ---
  const filler = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(40)
  const pageRow = await prisma.page.create({
    data: {
      workspaceId: workspace.id,
      title: 'Anchor target',
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: `Block 0: ${filler}` }] },
          { type: 'paragraph', content: [{ type: 'text', text: `Block 1: ${filler}` }] },
          { type: 'paragraph', content: [{ type: 'text', text: `Block 2 TARGET: ${filler}` }] },
        ],
      },
      createdById: user.id,
      updatedById: user.id,
    },
    select: { id: true },
  })

  await browser.goto(`/workspaces/${workspace.id}/pages/${pageRow.id}#2`)

  const target = browser.locator('[data-block-index="2"]')
  await expect(target).toBeVisible({ timeout: 15_000 })

  // Has block-flash within 2s of arrival
  await expect(target).toHaveClass(/block-flash/, { timeout: 2_000 })

  // Class removed within 3.5s (3s timeout + small slack)
  await expect(target).not.toHaveClass(/block-flash/, { timeout: 3_500 })

  // Cleanup
  await prisma.page.delete({ where: { id: pageRow.id } }).catch(() => undefined)
  await prisma.workspace.delete({ where: { id: workspace.id } }).catch(() => undefined)
})
```

- [ ] **Step 3: Run the spec**

Run: `pnpm exec playwright test apps/e2e/page-block-anchor.spec.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/e2e/page-block-anchor.spec.ts
git commit -m "test(e2e): page-block-anchor scrolls and flashes target block"
```

---

### Task 11: Manual smoke test

No code changes. Follow each check, mark only after success.

- [ ] **Step 1: Infra and dev server up**

```bash
docker compose up -d
pnpm dev
pnpm --filter @repo/yjs-server dev
```

- [ ] **Step 2: Direct hash navigation**

- Open http://localhost:3000, sign in, create a workspace and a TEXT page with at least 5 paragraphs of varied length.
- Manually open `/workspaces/{id}/pages/{id}#3` (substitute IDs).
- Verify: smooth scroll places block index 3 near vertical center, light-yellow background appears, fades away after 3 seconds.

- [ ] **Step 3: Skeleton continuity**

- Open Chrome DevTools → Network → throttle to "Slow 3G".
- Hard-reload the same page URL.
- Verify: continuous skeleton from page route → editor mount, no flash to spinner or empty box. Layout matches `loading.tsx` (same column width, same row pattern).

- [ ] **Step 4: Chat link client-nav**

- Open a chat in the workspace; ask a question that yields a citation with a block-anchor link (or paste a markdown message into a draft if available).
- Click the link.
- Verify: client-side navigation (URL changes without full reload — no white flash, network panel does not show a new HTML document request), target block scrolled and highlighted as in Step 2.

- [ ] **Step 5: External-link safety**

- Inspect a chat message containing `[example](https://example.com)`. The rendered anchor must have `target="_blank"` and `rel="noopener noreferrer"`.
- Confirm `[bad](javascript:alert('xss'))` renders as plain text (no `<a>`).

- [ ] **Step 6: hashchange on the same page**

- On a TEXT page already open at `#1`, change the URL hash in the address bar to `#2` (or click another in-page block-anchor link to the same page).
- Verify: scroll/highlight happens on the new target without a full reload.

---

## Self-review notes

**Spec coverage** (each spec section maps to at least one task):

- Block-index decoration → Tasks 1, 2
- `scrollToBlockIndex` + CSS → Task 3
- `loadingFallback` prop → Task 4
- `renderLink` prop chain → Tasks 5, 6
- `EditorContentSkeleton` → Task 7
- PageRenderer integration (skeleton + hash) → Task 8
- `renderChatLink` + wiring → Task 9
- E2E coverage → Task 10
- Manual UX verification (skeleton continuity, external-link safety, hashchange) → Task 11

**Type consistency:**

- `ChatRenderLink` defined in Task 5 is consumed identically in Task 6 and used by `renderChatLink` (Task 9, signature matches: `(href: string, children: ReactNode) => ReactNode`).
- `scrollToBlockIndex(editor: Editor, index: number): boolean` defined in Task 3 is consumed in Task 8 with the same signature.
- `loadingFallback?: ReactNode` in Task 4 matches the JSX passed in Task 8.

**No placeholders:** every step has explicit code and exact commands.
