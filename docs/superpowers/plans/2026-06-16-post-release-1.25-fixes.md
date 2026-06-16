# Post-Release 1.25 Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship eight independent post-release fixes for AnyNote 1.25 (sidebar DnD sorting + optimistic no-blink, page-icon gutter layout, centered outline nav, MCP table rendering, profile activity grid, standalone notifications page, drawio render crash).

**Architecture:** Each fix is self-contained and committed separately on branch `fix/post-release-1.25`. Fixes touch four layers: `@repo/domain` (DnD splice), `apps/web` (React UI + tRPC), `apps/engines` (MCP markdown pipeline), and `packages/editor`/`packages/drawio` (drawio). Verification is unit/integration tests where a pure conversion or domain transaction exists, and Playwright for browser-only behaviour.

**Tech Stack:** Next.js 16 / React 19 / MUI v6, tRPC v11, Prisma 7, NestJS 11 (engines), @dnd-kit, Tiptap v3 + @hocuspocus/transformer, marked, vitest (web/domain), jest (engines), Playwright.

**Reference spec:** `docs/superpowers/specs/2026-06-16-post-release-1.25-fixes-design.md`

---

## Task 0: Branch setup

- [ ] **Step 1: Create the working branch**

Run:
```bash
cd /Users/victor/Projects/anynote
git checkout main && git pull --ff-only
git checkout -b fix/post-release-1.25
```
Expected: `Switched to a new branch 'fix/post-release-1.25'`

---

## Task 1: MCP markdown parser — tables (Fix #4, part 1)

**Why first:** pure function, fastest TDD loop, no infra.

**Files:**
- Modify: `apps/engines/src/apps/mcp/services/markdown-parser.service.ts`
- Test: `apps/engines/src/apps/mcp/services/markdown-parser.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `markdown-parser.service.spec.ts` (inside the existing `describe('MarkdownParser', …)`):

```ts
it('parses GFM tables into tiptap table nodes', () => {
  const doc = parser.parse('| a | b |\n|---|---|\n| **1** | 2 |')
  expect(doc.content).toHaveLength(1)
  const table = doc.content[0]!
  expect(table.type).toBe('table')
  const rows = table.content!
  expect(rows).toHaveLength(2)
  // header row
  expect(rows[0]!.content![0]!.type).toBe('tableHeader')
  expect(rows[0]!.content![0]!.content).toEqual([
    { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
  ])
  // body row, bold cell
  expect(rows[1]!.content![0]!.type).toBe('tableCell')
  expect(rows[1]!.content![0]!.content).toEqual([
    { type: 'paragraph', content: [{ type: 'text', text: '1', marks: [{ type: 'bold' }] }] },
  ])
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter engines test -- markdown-parser.service.spec`
Expected: FAIL — `table.type` is `'paragraph'`, not `'table'`.

- [ ] **Step 3: Add the `table` case to `parseBlock`**

In `markdown-parser.service.ts`, add a `case 'table'` to the `switch (token.type)` in `parseBlock` (place it right before the `default:` case, after `case 'space': return []`):

```ts
case 'table': {
  const t = token as Tokens.Table
  const headerRow: TiptapNode = {
    type: 'tableRow',
    content: t.header.map((cell) => ({
      type: 'tableHeader',
      content: [{ type: 'paragraph', content: this.parseInline(cell.tokens) }],
    })),
  }
  const bodyRows: TiptapNode[] = t.rows.map((row) => ({
    type: 'tableRow',
    content: row.map((cell) => ({
      type: 'tableCell',
      content: [{ type: 'paragraph', content: this.parseInline(cell.tokens) }],
    })),
  }))
  return [{ type: 'table', content: [headerRow, ...bodyRows] }]
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter engines test -- markdown-parser.service.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/engines/src/apps/mcp/services/markdown-parser.service.ts apps/engines/src/apps/mcp/services/markdown-parser.service.spec.ts
git commit -m "fix(engines): parse GFM tables in MCP markdown parser"
```

---

## Task 2: MCP markdown renderer — tables round-trip (Fix #4, part 2)

**Files:**
- Modify: `apps/engines/src/apps/mcp/services/markdown-renderer.service.ts`
- Test: `apps/engines/src/apps/mcp/services/markdown-renderer.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `markdown-renderer.service.spec.ts`:

```ts
it('renders a table node back to a GFM markdown table', () => {
  const md = renderer.render({
    type: 'doc',
    content: [
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] },
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }] },
            ],
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '1' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '2' }] }] },
            ],
          },
        ],
      },
    ],
  })
  expect(md).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |')
})
```

The renderer's `render()` and helpers use `this` — confirm the spec already constructs `const renderer = new MarkdownRenderer()` (mirror the parser spec's setup; add it if absent).

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter engines test -- markdown-renderer.service.spec`
Expected: FAIL — table falls into `default` and renders as empty/garbled inline.

- [ ] **Step 3: Add the `table` case to `renderNode`**

In `markdown-renderer.service.ts`, add a `case 'table'` to the `switch (node.type)` in `renderNode` (before `default:`), plus a private helper:

```ts
case 'table':
  return this.renderTable(node)
```

Add the helper method to the class:

```ts
private renderTable(node: Node): string {
  const rows = node.content ?? []
  if (rows.length === 0) return ''
  const cellText = (cell: Node): string =>
    (cell.content ?? []).map((n) => this.renderNode(n)).join(' ').trim()
  const lines: string[] = []
  rows.forEach((row, rowIdx) => {
    const cells = (row.content ?? []).map(cellText)
    lines.push(`| ${cells.join(' | ')} |`)
    if (rowIdx === 0) lines.push(`| ${cells.map(() => '---').join(' | ')} |`)
  })
  return lines.join('\n')
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter engines test -- markdown-renderer.service.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/engines/src/apps/mcp/services/markdown-renderer.service.ts apps/engines/src/apps/mcp/services/markdown-renderer.service.spec.ts
git commit -m "fix(engines): render table nodes to GFM markdown in MCP renderer"
```

---

## Task 3: MCP page-writer — serialize tables into Yjs (Fix #4, part 3)

This is the part that actually makes the table render in the editor: `buildContentYjs` must pass the table extensions to `TiptapTransformer.toYdoc`, or the table node is silently dropped during Yjs serialization.

**Files:**
- Modify: `apps/engines/package.json` (add table extension deps)
- Modify: `apps/engines/src/apps/mcp/services/page-writer.service.ts`
- Test: `apps/engines/src/apps/mcp/services/page-writer.service.spec.ts`

- [ ] **Step 1: Add the Tiptap table extension dependencies to engines**

The web import path (`apps/web/src/server/page-import/content-yjs.ts`) imports `@tiptap/extension-table`, `-table-row`, `-table-header`, `-table-cell`. `apps/engines` currently has only `@tiptap/starter-kit`. Add the four packages at the same versions web uses:

Run:
```bash
cd /Users/victor/Projects/anynote
WEB_TABLE_VER=$(node -p "require('./apps/web/package.json').dependencies['@tiptap/extension-table']")
echo "web @tiptap/extension-table version: $WEB_TABLE_VER"
pnpm --filter engines add "@tiptap/extension-table@$WEB_TABLE_VER" "@tiptap/extension-table-row@$WEB_TABLE_VER" "@tiptap/extension-table-header@$WEB_TABLE_VER" "@tiptap/extension-table-cell@$WEB_TABLE_VER"
```
Expected: the four `@tiptap/extension-table*` entries appear in `apps/engines/package.json` dependencies. (If web pins them via a different package name/range, mirror web's exact entries instead.)

- [ ] **Step 2: Write the failing test**

Add to `page-writer.service.spec.ts` a test that round-trips a table through `buildContentYjs` and reads it back out via the transformer. Add this test near the existing content-building tests (mirror their import style; the helpers below are self-contained):

```ts
import { TiptapTransformer } from '@hocuspocus/transformer'
import StarterKit from '@tiptap/starter-kit'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import * as Y from 'yjs'
import { buildContentYjsForTest } from './page-writer.service.js'

it('serializes a table node into contentYjs so it round-trips', () => {
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] },
            ],
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '1' }] }] },
            ],
          },
        ],
      },
    ],
  }
  const bytes = buildContentYjsForTest(doc)
  const ydoc = new Y.Doc()
  Y.applyUpdate(ydoc, bytes)
  const back = TiptapTransformer.fromYdoc(ydoc, 'default') as { content?: { type: string }[] }
  expect(back.content?.some((n) => n.type === 'table')).toBe(true)
})
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `pnpm --filter engines test -- page-writer.service.spec`
Expected: FAIL — either `buildContentYjsForTest` is not exported, or the round-trip has no `table` node (StarterKit-only serialization dropped it).

- [ ] **Step 4: Add table extensions and export the helper**

In `page-writer.service.ts`:

Add imports near the existing `import StarterKit from '@tiptap/starter-kit'`:
```ts
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
```

Replace the `buildContentYjs` body's extension list and export a test alias:
```ts
const CONTENT_EXTENSIONS = [StarterKit, Table, TableRow, TableHeader, TableCell]

function buildContentYjs(content: unknown): Uint8Array<ArrayBuffer> {
  const ydoc = TiptapTransformer.toYdoc(content, 'default', CONTENT_EXTENSIONS)
  const src = Y.encodeStateAsUpdate(ydoc)
  const contentYjs = new Uint8Array(new ArrayBuffer(src.byteLength))
  contentYjs.set(src)
  return contentYjs
}

/** Test-only alias so the table-serialization round-trip can be asserted. */
export const buildContentYjsForTest = buildContentYjs
```

Also update the sibling helper just below (`buildContentYjsOrUndefined` per the file comment at lines 274-279) to use `CONTENT_EXTENSIONS` if it independently calls `TiptapTransformer.toYdoc(... [StarterKit])` — grep for `StarterKit]` in this file and replace every `[StarterKit]` with `CONTENT_EXTENSIONS` so both create and update paths serialize tables.

Run to confirm both call sites updated:
```bash
grep -n "StarterKit\]\|CONTENT_EXTENSIONS\|toYdoc" apps/engines/src/apps/mcp/services/page-writer.service.ts
```
Expected: no remaining `[StarterKit]` array literal passed to `toYdoc`.

- [ ] **Step 5: Run the test, verify it passes**

Run: `pnpm --filter engines test -- page-writer.service.spec`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/engines/package.json pnpm-lock.yaml apps/engines/src/apps/mcp/services/page-writer.service.ts apps/engines/src/apps/mcp/services/page-writer.service.spec.ts
git commit -m "fix(engines): serialize MCP tables into contentYjs via table extensions"
```

---

## Task 4: Domain — `moveToCollection` splices at a target position (Fix #1, part 1)

The cross-collection move must (a) detach the page from its old linked list and (b) splice it at a given `newParentId`/`newPrevPageId` inside the target collection — exactly like `reorderPageTx`. Without a position it head-inserts.

**Files:**
- Modify: `packages/domain/src/pages/dto/pages.dto.ts:73-78` (`moveToCollectionInput`)
- Modify: `packages/domain/src/pages/services/pages.service.ts:186-198` (`moveToCollection`)
- Modify: `packages/domain/src/pages/repositories/pages.repository.ts:398-423` (`moveToCollectionTx`)
- Test: a domain repo/service test (find the existing pages repo/service spec; create `packages/domain/src/pages/__tests__/move-to-collection.test.ts` if no co-located spec exists — match the directory convention used by the other pages tests, e.g. check for `*.test.ts` next to the service first).

- [ ] **Step 1: Extend the input DTO**

In `pages.dto.ts`, replace `moveToCollectionInput`:
```ts
export const moveToCollectionInput = z.object({
  pageId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  target: z.enum(['team', 'private']),
  newParentId: z.string().uuid().nullable().optional(),
  newPrevPageId: z.string().uuid().nullable().optional(),
})
export type MoveToCollectionInput = z.infer<typeof moveToCollectionInput>
```

- [ ] **Step 2: Write the failing test**

First locate the existing pages-domain test harness:
```bash
grep -rln "reorderPageTx\|moveToCollectionTx\|describe('PagesService\|PagesRepository" packages/domain/src/pages
```
Use the same in-memory/prisma-mock setup those tests use. Write a test asserting that moving a page into the personal collection at a given `newPrevPageId` produces a well-formed linked list:

```ts
it('splices the moved page after newPrevPageId in the target collection and closes the old gap', async () => {
  // Arrange: collection A has [a1, a2] (a2.prev=a1); collection B has [b1].
  // Move a2 into B after b1.
  // Act:
  await service.moveToCollection(actorId, {
    pageId: 'a2', workspaceId: 'w1', target: 'private',
    newParentId: null, newPrevPageId: 'b1',
  })
  // Assert: a2.collectionId === personalId, a2.prevPageId === 'b1';
  //         no page in A still points prevPageId === 'a2';
  //         a1 is now the tail of A (nothing after it).
})
```

Concretely assert on the mock's recorded `page.update` calls (mirror how the existing `reorderPageTx` test asserts the 4-step shuffle). If the existing tests assert via a real test DB (`anynote_phase1`-style), follow that pattern instead and assert on read-back rows.

- [ ] **Step 3: Run the test, verify it fails**

Run: `pnpm --filter @repo/domain test -- move-to-collection`
Expected: FAIL — current `moveToCollectionTx` only updates `collectionId`; `prevPageId` stays stale and the old gap is not closed.

- [ ] **Step 4: Rewrite `moveToCollectionTx` to detach + splice**

In `pages.repository.ts`, replace `moveToCollectionTx` with a detach-then-splice transaction. It needs the moved page's current `prevPageId`, so load it first:

```ts
async moveToCollectionTx(
  actorUserId: string,
  pageId: string,
  collectionId: string | null,
  workspaceId: string,
  position?: { newParentId: string | null; newPrevPageId: string | null },
): Promise<CreateResultDto> {
  const moved = await this.uow.client().page.findUnique({
    where: { id: pageId },
    select: { prevPageId: true, parentId: true },
  })
  const oldPrevPageId = moved?.prevPageId ?? null

  // Step 0: lift the moved page out so its prev_page_id slot is free (UNIQUE).
  if (oldPrevPageId !== null) {
    await this.uow.client().page.update({ where: { id: pageId }, data: { prevPageId: null } })
  }

  // Step 1: detach — the old next sibling adopts the moved page's old prev.
  const oldNext = await this.uow.client().page.findFirst({
    where: { prevPageId: pageId, deletedAt: null },
  })
  if (oldNext) {
    await this.uow.client().page.update({
      where: { id: oldNext.id },
      data: { prevPageId: oldPrevPageId },
    })
  }

  // Resolve the insert position. Default = head of the target collection.
  const newParentId = position?.newParentId ?? null
  let newPrevPageId = position?.newPrevPageId ?? null
  if (!position) {
    // Head insert: detach the current head of (collection, parent) and point it at us.
    const head = await this.uow.client().page.findFirst({
      where: {
        workspaceId,
        collectionId,
        parentId: newParentId,
        prevPageId: null,
        id: { not: pageId },
        deletedAt: null,
      },
    })
    if (head) {
      await this.uow.client().page.update({ where: { id: head.id }, data: { prevPageId: pageId } })
    }
    newPrevPageId = null
  } else {
    // Positioned insert: the row currently at newPrevPageId re-points to us.
    const pageAtInsertPoint = await this.uow.client().page.findFirst({
      where: {
        prevPageId: newPrevPageId,
        workspaceId,
        collectionId,
        parentId: newParentId,
        deletedAt: null,
        id: { not: pageId },
      },
    })
    if (pageAtInsertPoint) {
      await this.uow.client().page.update({
        where: { id: pageAtInsertPoint.id },
        data: { prevPageId: pageId },
      })
    }
  }

  // Final: set collection + position on the moved page.
  await this.uow.client().page.update({
    where: { id: pageId },
    data: { collectionId, parentId: newParentId, prevPageId: newPrevPageId, updatedById: actorUserId },
  })

  await enqueueOutboxEvent(this.uow.client() as Prisma.TransactionClient, {
    eventType: 'page.upserted',
    aggregateType: 'page',
    aggregateId: pageId,
    workspaceId,
  })
  await enqueueIntegrationEvents(this.uow.client() as Prisma.TransactionClient, {
    event: 'page.moved',
    resourceType: 'page',
    resourceId: pageId,
    workspaceId,
    actorId: actorUserId,
    hints: { scope: 'collection' },
  })
  return { id: pageId }
}
```

- [ ] **Step 5: Forward the position from the service**

In `pages.service.ts`, update `moveToCollection` to pass the optional position:
```ts
return this.uow.transaction(() =>
  this.repo.moveToCollectionTx(actorUserId, input.pageId, target, input.workspaceId, {
    newParentId: input.newParentId ?? null,
    newPrevPageId: input.newPrevPageId ?? null,
  }),
)
```
Note: when both are `undefined` the caller wants a head insert. To preserve "no position → head insert", only forward the position object when at least one of `newParentId`/`newPrevPageId` was provided:
```ts
const hasPosition = input.newParentId !== undefined || input.newPrevPageId !== undefined
return this.uow.transaction(() =>
  this.repo.moveToCollectionTx(
    actorUserId,
    input.pageId,
    target,
    input.workspaceId,
    hasPosition ? { newParentId: input.newParentId ?? null, newPrevPageId: input.newPrevPageId ?? null } : undefined,
  ),
)
```

- [ ] **Step 6: Run the test, verify it passes**

Run: `pnpm --filter @repo/domain test -- move-to-collection`
Expected: PASS.

- [ ] **Step 7: Run the whole pages domain suite to catch regressions**

Run: `pnpm --filter @repo/domain test`
Expected: PASS (the existing `moveToCollection` head-insert behaviour still holds for callers that pass no position — e.g. the context-menu move).

- [ ] **Step 8: Commit**

```bash
git add packages/domain/src/pages
git commit -m "fix(domain): moveToCollection detaches and splices at the drop position"
```

---

## Task 5: tRPC — accept the new move position; frontend optimistic splice + no blink (Fix #1 + #6)

**Files:**
- Verify: `packages/trpc/src/routers/page.ts:275-280` (`moveToCollection` uses `domain.moveToCollectionInput`, so the new optional fields flow through with no change — confirm).
- Modify: `apps/web/src/components/workspace/sidebar-dnd-context.tsx` (cross-section branch → optimistic splice via target section handler; drop the success-refetch on the drag path).
- Modify: `apps/web/src/components/workspace/page-tree-section.tsx` (register a `moveInto` handler that computes the drop position and does the optimistic move).

- [ ] **Step 1: Confirm the tRPC procedure needs no change**

Run:
```bash
grep -n "moveToCollection" packages/trpc/src/routers/page.ts
```
Expected: it passes `domain.moveToCollectionInput` straight to `domainSvc.pages.moveToCollection`. The new optional `newParentId`/`newPrevPageId` are part of that schema now, so no edit is needed. If the router re-declares a narrower input inline, widen it to include the two optional fields.

- [ ] **Step 2: Add a `moveInto` registry to the DnD context**

In `sidebar-dnd-context.tsx`, mirror the existing reorder registry so the **target** section can own the cross-collection splice (it knows its own `flatItems`/pages). Add alongside `ReorderRegistryCtx`:

```ts
type MoveIntoHandler = (active: Active, over: Over) => void

const MoveIntoRegistryCtx = createContext<{
  register: (section: string, handler: MoveIntoHandler) => () => void
} | null>(null)

export function useRegisterMoveInto(section: string, handler: MoveIntoHandler): void {
  const registry = useContext(MoveIntoRegistryCtx)
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  const stable = useCallback<MoveIntoHandler>((active, over) => handlerRef.current(active, over), [])
  useEffect(() => {
    if (!registry) return
    return registry.register(section, stable)
  }, [registry, section, stable])
}
```

In `SidebarDndProvider`, add a `moveIntoHandlers` ref + `registerMoveInto` callback (copy the shape of `handlers`/`register`), expose it via `MoveIntoRegistryCtx.Provider`, and wrap it around the existing providers next to `ReorderRegistryCtx.Provider`.

- [ ] **Step 3: Route the cross-section drop to the target section's `moveInto` handler**

In `onDragEnd`, replace branch (2) (the block at lines 233-236 that currently calls `moveToCollection.mutate(...)` with no position):

```ts
if (dropSection && dropSection.moveTarget && dropSection.section !== sourceSection) {
  const handler = moveIntoHandlers.current.get(dropSection.section)
  if (handler) {
    handler(active, over)
    return
  }
  // Fallback: header-zone / no registered handler → head insert (no position).
  moveToCollection.mutate({ pageId, workspaceId, target: dropSection.moveTarget })
  return
}
```

Keep the `moveToCollection` mutation declaration, but change it so the **drag path does not force a success refetch** (the optimistic state is authoritative). Since `moveToCollection.mutate` is also used by the zone-header branch and the fallback, keep `onSuccess: invalidateCollections` there is acceptable ONLY if it doesn't cause a visible re-snap; to be safe for the smooth drag path, the section's `moveInto` handler will use its **own** mutation instance (next step) with no success refetch, leaving this shared one for the header-zone/fallback paths.

- [ ] **Step 4: Implement `moveInto` in the section with an optimistic splice**

In `page-tree-section.tsx`, add a dedicated mutation (no success refetch, rollback on error) and a handler, then register it. Place near the existing `reorder` mutation:

```ts
const moveInto = trpc.page.moveToCollection.useMutation({
  onError: () => {
    void utils.page.listByWorkspace.invalidate({ workspaceId })
  },
})
```

Add the handler (mirrors `reorderHandler` for position math, but also flips `collectionId` and resolves `target` from this section's `location`):

```ts
function moveIntoHandler(active: Active, over: Over) {
  // Only the Команда/Личное sections register this; they always have a concrete
  // collectionId. Bail if either is missing (extra/pinned collections, or the
  // section somehow lacks an id) — those are not move targets.
  if (!location || collectionId == null) return
  const targetCollectionId = collectionId // narrowed to string
  const draggedActiveId = active.id as string
  const draggedPage = allPages.find((p) => p.id === draggedActiveId)
  if (!draggedPage) return

  // Resolve drop position within THIS section's flat list.
  const toIdx = flatItems.findIndex((i) => i.id === over.id)
  const overItem = toIdx >= 0 ? flatItems[toIdx] : undefined

  // Default = head of this collection when dropping on the bare area/header.
  let newParentId: string | null = null
  let newPrevPageId: string | null = null
  if (overItem) {
    newParentId = overItem.parentId
    // Cross-collection drops always insert AFTER the hovered row (drop-below),
    // since the page is new to this list (no fromIdx ordering to compare).
    newPrevPageId = overItem.id
  }

  // Optimistic: move the page into this collection at the computed position and
  // repair the two affected back-pointers (old next sibling + insert-point page).
  utils.page.listByWorkspace.setData({ workspaceId }, (old) => {
    if (!old) return old
    const oldNextId = old.find((p) => p.prevPageId === draggedActiveId)?.id
    const insertPointId = old.find(
      (p) => p.prevPageId === newPrevPageId && p.parentId === newParentId && p.id !== draggedActiveId,
    )?.id
    return old.map((p) => {
      if (p.id === draggedActiveId)
        return { ...p, collectionId: targetCollectionId, parentId: newParentId, prevPageId: newPrevPageId }
      if (oldNextId && p.id === oldNextId) return { ...p, prevPageId: draggedPage.prevPageId }
      if (insertPointId && p.id === insertPointId) return { ...p, prevPageId: draggedActiveId }
      return p
    })
  })

  moveInto.mutate({
    pageId: draggedActiveId,
    workspaceId,
    target: location, // 'team' | 'private'
    newParentId,
    newPrevPageId,
  })
}
useRegisterMoveInto(sectionId, moveIntoHandler)
```

`collectionId` is the section's own prop (`string | null | undefined`, line 38) — the
concrete personal/team collection id the section renders and filters `allPages` by
(`p.collectionId === collectionId`, line 304). The handler narrows it to `targetCollectionId`
(a `string`) via the `collectionId == null` guard, so the optimistic write and the
mutation both use a concrete id.

`location`, `sectionId`, `flatItems`, `allPages`, `utils`, `workspaceId`, `collectionId`,
and the `Active`/`Over` types (line 6) are all already in scope in this component
(see lines 298-374) — no new imports needed.

- [ ] **Step 5: Type-check**

Run: `pnpm --filter web check-types`
Expected: PASS (no TS errors; `Active`/`Over` types imported from `@dnd-kit/core` already in `sidebar-dnd-context.tsx`, re-import in `page-tree-section.tsx` if needed — it already imports them for `reorderHandler`).

- [ ] **Step 6: Playwright — sorting works + no blink**

Create `apps/e2e/post-release-1.25-dnd.spec.ts`. Use the `signUpAndAuthAs` helper and the established page-creation flow (see existing sidebar specs, e.g. `apps/e2e/sidebar-scroll-boundary.spec.ts`, for `createWorkspace`/`createPages` helpers and `[data-page-row]` selectors).

```ts
import { test, expect } from '@playwright/test'
import { signUpAndAuthAs } from './helpers/auth'

test('dragging the 2nd Личное page onto the 1st reorders it, no disappearance', async ({ page }) => {
  await signUpAndAuthAs(page)
  // create workspace + two pages in Личное via the established helpers,
  // then drag row 2 onto row 1 and assert order flips.
  // Assert mid-drag the dragged row stays present (no "removed then re-added").
})
```

Implementation detail: use `mcp__playwright`-style drag or `@dnd-kit` needs pointer move with the 8px activation distance — use `page.mouse.move/down/up` with intermediate moves (>8px) since `dragTo` may not trip the PointerSensor. Assert the two page titles' order via `[data-page-row]` text, before and after.

Run: `pnpm exec playwright test apps/e2e/post-release-1.25-dnd.spec.ts --retries=1`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/workspace/sidebar-dnd-context.tsx apps/web/src/components/workspace/page-tree-section.tsx apps/e2e/post-release-1.25-dnd.spec.ts packages/trpc/src/routers/page.ts
git commit -m "fix(web): drag into Личное/Команда splices at the drop position, optimistically"
```

---

## Task 6: Page icon hangs in the left gutter (Fix #2)

**Files:**
- Modify: `apps/web/src/components/page/page-header.tsx:238-307`
- Test (Playwright): `apps/e2e/post-release-1.25-page-icon.spec.ts`

- [ ] **Step 1: Restructure the title row so the icon is absolutely positioned in the gutter**

Replace the `<Stack direction="row" spacing={1} alignItems="center">` wrapper (line 238) and the icon `IconButton` so the title row no longer reserves in-flow space for the icon. The icon becomes an absolutely-positioned child anchored to the row's left edge, shifted into the 48px gutter; the title renders at the same x with or without an icon.

```tsx
<Box sx={{ position: 'relative' }}>
  {icon ? (
    <IconButton
      aria-label="Изменить иконку"
      onClick={openIconPicker}
      sx={{
        position: 'absolute',
        // Hang the 56px icon button into the left gutter so it sits to the LEFT
        // of the title without pushing it. -64px ≈ icon width (56) + 8px gap.
        left: -64,
        top: hasCover ? -36 : 0,
        width: 56,
        height: 56,
        p: 0.5,
        borderRadius: 1,
        zIndex: 1,
      }}
    >
      <PageIcon icon={icon} size={44} />
    </IconButton>
  ) : null}
  {editing ? (
    <TextField
      /* …unchanged props… */
      sx={{
        '& .MuiInput-input': {
          fontSize: '2.25rem',
          fontWeight: 700,
          lineHeight: 1.2,
          padding: 0,
        },
      }}
    />
  ) : (
    <Typography
      variant="h3"
      onClick={startEdit}
      sx={{
        fontSize: '2.25rem',
        fontWeight: 700,
        lineHeight: 1.2,
        cursor: 'text',
        color: title ? 'text.primary' : 'text.secondary',
        px: 1,
        mx: -1,
        borderRadius: 1,
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      {title || UNTITLED_PLACEHOLDER}
    </Typography>
  )}
</Box>
```

Keep all existing handlers/props on the `TextField`/`Typography` (the `…unchanged props…` comment means: do not change `inputRef`, `value`, `onChange`, `onBlur`, `onKeyDown`, `variant`, `fullWidth`, `placeholder`, `slotProps` on the `TextField`). Remove the old `flex: 1` from the Typography (no longer in a flex row) — the title is now block-level at full width.

Note on the gutter: the page column has `px: '48px'` (`column-sx.ts`). A `-64px` offset places the icon's right edge ~8px left of the title and within/just-past the 48px gutter; on narrow viewports this is acceptable (icon may slightly overlap the gutter edge but stays clickable). If the icon clips off-screen at the smallest column width, reduce to `left: -56` so it sits flush in the gutter.

- [ ] **Step 2: Type-check**

Run: `pnpm --filter web check-types`
Expected: PASS.

- [ ] **Step 3: Playwright — title x is identical with and without an icon**

Create `apps/e2e/post-release-1.25-page-icon.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { signUpAndAuthAs } from './helpers/auth'

test('page title keeps its x position when an icon is added; icon sits to its left', async ({ page }) => {
  await signUpAndAuthAs(page)
  // open a text page, locate the title element, record its boundingBox().x
  // add an emoji icon via the icon picker, re-read the title boundingBox().x
  // assert |x_before - x_after| < 2 (title did not shift)
  // assert the icon button's (x + width) <= title.x (icon is to the left)
})
```

Run: `pnpm exec playwright test apps/e2e/post-release-1.25-page-icon.spec.ts --retries=1`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/page/page-header.tsx apps/e2e/post-release-1.25-page-icon.spec.ts
git commit -m "fix(web): hang page icon in the left gutter, keep title position fixed"
```

---

## Task 7: Center the right outline nav vertically (Fix #3)

**Files:**
- Modify: `apps/web/src/components/page/editor-outline.tsx:226-240`
- Test (Playwright): `apps/e2e/post-release-1.25-outline.spec.ts`

- [ ] **Step 1: Replace top-alignment with vertical centering**

In the `<Box component="nav" …>` `sx` (lines 226-240), change `top: 80` to a centered transform and keep the scroll clamp:

```ts
sx={{
  position: 'fixed',
  top: '50%',
  transform: 'translateY(-50%)',
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
```

(`transition: 'right 0.15s ease'` stays — it does not animate `transform`, so centering is instant; the right-offset animation for the comments panel still works.)

- [ ] **Step 2: Playwright — nav is vertically centered**

Create `apps/e2e/post-release-1.25-outline.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { signUpAndAuthAs } from './helpers/auth'

test('right outline nav is vertically centered', async ({ page }) => {
  await signUpAndAuthAs(page)
  // open a text page with several headings so the outline renders,
  // locate nav[aria-label="Содержание страницы"], read boundingBox(),
  // assert |box.y + box.height/2 - viewportHeight/2| < 40
})
```

Run: `pnpm exec playwright test apps/e2e/post-release-1.25-outline.spec.ts --retries=1`
Expected: PASS. (If the page has no headings the nav doesn't render — ensure the test page has ≥2 headings, e.g. type `# A` / `## B` into the editor.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/page/editor-outline.tsx apps/e2e/post-release-1.25-outline.spec.ts
git commit -m "fix(web): vertically center the right outline nav"
```

---

## Task 8: tRPC `user.activity` — per-day PageRevision counts + recent actions (Fix #5, part 1)

**Files:**
- Modify: `packages/trpc/src/routers/user.ts` (add `activity` query)
- Test: the trpc package test dir (`packages/trpc/test/` — match the existing convention; e.g. `packages/trpc/test/user-activity.test.ts`)

- [ ] **Step 1: Write the failing test**

Find the existing real-DB tRPC test setup (e.g. `packages/trpc/test/plan.test.ts` per the memory note about self-contained fixtures) and mirror it. Seed a user with 3 PageRevision rows on 2 distinct days, plus another user's revision that must be excluded:

```ts
it('user.activity returns per-day counts for the caller only', async () => {
  // seed: pageA owned by user U; revisions: 2 on 2026-06-10, 1 on 2026-06-11 (actor=U)
  //       + 1 revision by another user V on 2026-06-10
  const caller = makeCaller(U)
  const res = await caller.user.activity()
  const byDate = Object.fromEntries(res.grid.map((d) => [d.date, d.count]))
  expect(byDate['2026-06-10']).toBe(2) // V's revision excluded
  expect(byDate['2026-06-11']).toBe(1)
})
```

Make fixtures self-contained (create the workspace, collections, consents via `writeConsentsForUserId`, pages, and revisions in the test) so it passes on a fresh CI DB, per the project's stale-local-vs-fresh-CI note.

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @repo/trpc test -- user-activity`
Expected: FAIL — `user.activity` is not defined.

- [ ] **Step 3: Implement `user.activity`**

Add to `userRouter` in `user.ts`. Use a raw grouped query (Prisma `groupBy` can't truncate to day):

```ts
activity: protectedProcedure.query(async ({ ctx }) => {
  const rows = await ctx.prisma.$queryRaw<{ day: Date; count: bigint }[]>`
    SELECT date_trunc('day', created_at)::date AS day, count(*)::bigint AS count
    FROM page_revisions
    WHERE actor_id = ${ctx.user.id}::uuid
      AND created_at >= now() - interval '12 months'
    GROUP BY day
    ORDER BY day
  `
  const grid = rows.map((r) => ({
    date: r.day.toISOString().slice(0, 10),
    count: Number(r.count),
  }))

  const recentRaw = await ctx.prisma.pageRevision.findMany({
    where: { actorId: ctx.user.id, page: { deletedAt: null } },
    orderBy: { createdAt: 'desc' },
    take: 15,
    select: {
      action: true,
      createdAt: true,
      page: { select: { id: true, title: true, type: true } },
    },
  })
  const recentActions = recentRaw.map((r) => ({
    action: r.action,
    createdAt: r.createdAt,
    pageId: r.page.id,
    pageTitle: r.page.title,
    pageType: r.page.type,
  }))

  return { grid, recentActions }
}),
```

Note: `date_trunc('day', created_at)::date` returns a JS `Date` at UTC midnight; `.toISOString().slice(0,10)` yields `YYYY-MM-DD`. This is UTC-bucketed — acceptable for an activity grid. The `created_at` column name and `page_revisions` table name come from the `@@map`/`@map` in schema (`page_revisions`, `actor_id`, `created_at`).

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter @repo/trpc test -- user-activity`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/routers/user.ts packages/trpc/test/user-activity.test.ts
git commit -m "feat(trpc): user.activity per-day PageRevision counts + recent actions"
```

---

## Task 9: Profile page — Activity Grid + recent activity replaces workspaces (Fix #5, part 2)

**Files:**
- Create: `apps/web/src/components/profile/activity-grid.tsx`
- Create: `apps/web/src/components/profile/recent-activity.tsx`
- Modify: `apps/web/src/app/(protected)/profile/page.tsx:81-142` (replace the workspaces `Box`)
- Test (Playwright): `apps/e2e/post-release-1.25-profile.spec.ts`

- [ ] **Step 1: Build the ActivityGrid component**

Create `activity-grid.tsx` — a pure presentational GitHub-style grid. It takes the `grid` array (`{date,count}[]`) and renders 53 week-columns × 7 day-rows, coloring each cell by a count bucket, with a tooltip per cell.

```tsx
'use client'

import { Box, Tooltip, Typography } from '@repo/ui/components'

type Day = { date: string; count: number }

function bucketColor(count: number): string {
  if (count === 0) return 'action.hover'
  if (count <= 2) return 'success.light'
  if (count <= 5) return 'success.main'
  return 'success.dark'
}

export function ActivityGrid({ grid }: { grid: Day[] }) {
  // Build a date->count map, then walk the trailing 53 weeks ending today.
  const counts = new Map(grid.map((d) => [d.date, d.count]))
  const today = new Date()
  // Anchor to the most recent Saturday so columns align to weeks.
  const cells: Day[] = []
  const start = new Date(today)
  start.setUTCDate(start.getUTCDate() - 7 * 52 - today.getUTCDay())
  for (let i = 0; i < 53 * 7; i++) {
    const d = new Date(start)
    d.setUTCDate(start.getUTCDate() + i)
    const iso = d.toISOString().slice(0, 10)
    cells.push({ date: iso, count: counts.get(iso) ?? 0 })
  }
  // Chunk into weeks (columns of 7).
  const weeks: Day[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  return (
    <Box sx={{ width: '100%' }}>
      <Typography variant="overline" color="text.secondary">
        Активность
      </Typography>
      <Box sx={{ display: 'flex', gap: '3px', mt: 1, overflowX: 'auto', pb: 1 }}>
        {weeks.map((week, wi) => (
          <Box key={wi} sx={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {week.map((day) => (
              <Tooltip key={day.date} title={`${day.date}: ${day.count}`} arrow>
                <Box
                  sx={{
                    width: 11,
                    height: 11,
                    borderRadius: '2px',
                    bgcolor: bucketColor(day.count),
                  }}
                />
              </Tooltip>
            ))}
          </Box>
        ))}
      </Box>
    </Box>
  )
}
```

Confirm `Tooltip` is exported from `@repo/ui/components`; if not, add the re-export (per CLAUDE.md UI-imports convention) or import via the components subpath used elsewhere. Run:
```bash
grep -n "Tooltip" packages/ui/src/components/index.ts
```
If absent, add `export { default as Tooltip } from '@mui/material/Tooltip'` (match the file's existing re-export style).

- [ ] **Step 2: Build the RecentActivity list**

Create `recent-activity.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { Box, Paper, Stack, Typography } from '@repo/ui/components'

type Action = {
  action: string
  createdAt: string | Date
  pageId: string
  pageTitle: string | null
}

// PageRevisionAction enum (schema): EDIT | TITLE_CHANGE | MOVE | ARCHIVE | RESTORE | PUBLISH
const ACTION_LABEL: Record<string, string> = {
  EDIT: 'изменил',
  TITLE_CHANGE: 'переименовал',
  MOVE: 'переместил',
  ARCHIVE: 'архивировал',
  RESTORE: 'восстановил',
  PUBLISH: 'опубликовал',
}

export function RecentActivity({ actions }: { actions: Action[] }) {
  if (actions.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 3, textAlign: 'center', mt: 1 }}>
        <Typography variant="body2" color="text.secondary">
          Пока нет активности
        </Typography>
      </Paper>
    )
  }
  return (
    <Stack spacing={1} sx={{ mt: 1, width: '100%' }}>
      {actions.map((a, i) => (
        <Link key={i} href={`/pages/${a.pageId}`} style={{ textDecoration: 'none' }}>
          <Paper
            variant="outlined"
            sx={{ p: 1.5, display: 'flex', gap: 1, alignItems: 'baseline', '&:hover': { bgcolor: 'action.hover' } }}
          >
            <Typography variant="body2" color="text.secondary">
              {ACTION_LABEL[a.action] ?? a.action}
            </Typography>
            <Typography variant="body2" noWrap sx={{ flex: 1 }}>
              {a.pageTitle || 'Без названия'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {new Date(a.createdAt).toLocaleDateString('ru-RU')}
            </Typography>
          </Paper>
        </Link>
      ))}
    </Stack>
  )
}
```

`PageRevisionAction` enum values (confirmed against schema line 1718) are
`EDIT | TITLE_CHANGE | MOVE | ARCHIVE | RESTORE | PUBLISH`. The `ACTION_LABEL` map
above already uses these exact keys.

- [ ] **Step 3: Wire them into the profile page; remove workspaces**

In `profile/page.tsx`:
- Remove the workspaces query (line 28) and the `<Box sx={{ width: '100%', pt: 2 }}>…Рабочие пространства…</Box>` block (lines 81-142).
- Remove now-unused imports: `SwitchWorkspaceButton`, `AddIcon`, `Button` (keep `Box`, `Paper`, `Stack`, `Typography`, `Container`, `IconButton`, `SettingsIcon`, `NotificationsIcon` — verify which are still used after the edit and drop the rest to keep lint `--max-warnings 0` happy).
- Fetch activity and render the two new components:

```tsx
const activity = await trpc.user.activity()
```

After the Настройки/Уведомления `Stack` (the row ending line 79), add:

```tsx
<ActivityGrid grid={activity.grid} />
<Box sx={{ width: '100%', pt: 2 }}>
  <Typography variant="overline" color="text.secondary">
    Последние действия
  </Typography>
  <RecentActivity actions={activity.recentActions} />
</Box>
```

Add imports:
```tsx
import { ActivityGrid } from '@/components/profile/activity-grid'
import { RecentActivity } from '@/components/profile/recent-activity'
```

Note: `activity.recentActions[].createdAt` is a `Date` on the server; serialized to the client component as a string — `RecentActivity` already accepts `string | Date`, so no z.date browser-serialization gotcha (the component does `new Date(a.createdAt)`).

- [ ] **Step 4: Type-check + lint**

Run: `pnpm --filter web check-types && pnpm --filter web lint`
Expected: PASS (no unused-import warnings).

- [ ] **Step 5: Playwright — grid renders, no workspaces heading**

Create `apps/e2e/post-release-1.25-profile.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { signUpAndAuthAs } from './helpers/auth'

test('/profile shows the activity grid and not the workspaces list', async ({ page }) => {
  await signUpAndAuthAs(page)
  await page.goto('/profile')
  await expect(page.getByText('Рабочие пространства')).toHaveCount(0)
  await expect(page.getByText('Активность')).toBeVisible()
})
```

Run: `pnpm exec playwright test apps/e2e/post-release-1.25-profile.spec.ts --retries=1`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/profile/activity-grid.tsx apps/web/src/components/profile/recent-activity.tsx apps/web/src/app/\(protected\)/profile/page.tsx packages/ui/src/components/index.ts apps/e2e/post-release-1.25-profile.spec.ts
git commit -m "feat(web): replace profile workspaces with activity grid + recent actions"
```

---

## Task 10: Standalone /notifications with PublicHeader (Fix #7)

**Files:**
- Move: `apps/web/src/app/(protected)/(active)/notifications/page.tsx` → `apps/web/src/app/(protected)/notifications/page.tsx`
- Create: `apps/web/src/app/(protected)/notifications/layout.tsx`
- Modify: `apps/web/src/components/workspace/workspace-layout-client.tsx:135-137` (remove dead breadcrumb case)
- Test (Playwright): `apps/e2e/post-release-1.25-notifications.spec.ts`

- [ ] **Step 1: Move the route out of the (active) group**

Run:
```bash
cd /Users/victor/Projects/anynote
mkdir -p "apps/web/src/app/(protected)/notifications"
git mv "apps/web/src/app/(protected)/(active)/notifications/page.tsx" "apps/web/src/app/(protected)/notifications/page.tsx"
```
Expected: the file moves; `git status` shows a rename.

- [ ] **Step 2: Add the standalone layout with PublicHeader**

Create `apps/web/src/app/(protected)/notifications/layout.tsx` (mirror `(about)/layout.tsx`, but no extra session logic — the `(protected)` layout above already enforces session + providers):

```tsx
import type { ReactNode } from 'react'

import { Box } from '@repo/ui/components'

import { PublicHeader } from '@/components/public/public-header'

export default function NotificationsLayout({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <PublicHeader />
      <Box component="main" sx={{ flex: 1 }}>
        {children}
      </Box>
    </Box>
  )
}
```

Confirm `PublicHeader` is a named export at that path:
```bash
grep -n "export" apps/web/src/components/public/public-header.tsx | head
```
If it is a default export, adjust the import. Confirm `Box` is exported from `@repo/ui/components` (it is, used widely).

- [ ] **Step 3: Remove the dead workspace breadcrumb case**

In `workspace-layout-client.tsx`, delete the now-unreachable block (lines 135-137):
```ts
if (pathname.includes('/notifications')) {
  return [{ label: 'Уведомления' }]
}
```
Run to confirm no other code depends on `/notifications` being inside the shell:
```bash
grep -rn "notifications" apps/web/src/components/workspace
```
Expected: no remaining references that assume the in-shell layout.

- [ ] **Step 4: Type-check + dev smoke (RSC boundary)**

Per CLAUDE.md, dynamic routes blow up at request time, not build time. Smoke the route against the already-running dev server (port 3000) or a fresh `pnpm --filter web dev`:
```bash
pnpm --filter web check-types
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/notifications
```
Expected: check-types PASS; curl returns `200` or `307` (redirect to sign-in if unauthenticated) — NOT `500`. A 500 means an RSC prop boundary issue in the new layout; fix before continuing.

- [ ] **Step 5: Playwright — header present, no sidebar**

Create `apps/e2e/post-release-1.25-notifications.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { signUpAndAuthAs } from './helpers/auth'

test('/notifications renders standalone with the public header and no workspace sidebar', async ({ page }) => {
  await signUpAndAuthAs(page)
  await page.goto('/notifications')
  // PublicHeader logo/title present
  await expect(page.getByText('Любые заметки')).toBeVisible()
  // Workspace sidebar create-page buttons are NOT present
  await expect(page.getByRole('button', { name: 'Новая страница' })).toHaveCount(0)
})
```

Verify the exact header text/selector against `public-header.tsx` (the logo text is "Любые заметки" per exploration) and adjust the sidebar-absence assertion to a selector that only exists in the workspace shell (e.g. a sidebar test-id) if "Новая страница" is ambiguous.

Run: `pnpm exec playwright test apps/e2e/post-release-1.25-notifications.spec.ts --retries=1`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A "apps/web/src/app/(protected)/notifications" "apps/web/src/app/(protected)/(active)/notifications" apps/web/src/components/workspace/workspace-layout-client.tsx apps/e2e/post-release-1.25-notifications.spec.ts
git commit -m "feat(web): move /notifications to a standalone page with the public header"
```

---

## Task 11: Drawio render crash — REPRODUCE FIRST, then fix (Fix #8)

**The spec's innerHTML theory is unconfirmed.** Source-wide there is no `<foreignObject>` and every drawio SVG renders via `<img>`. The DRAWIO *page* renders through `react-drawio`'s `DrawIoEmbed` (an iframe). The error `Invalid value for <foreignObject> attribute y=""` is a React-DOM reconciliation error, which means some component renders a real `<foreignObject>` JSX/SVG element — likely a third party. **Do not write a fix before reproducing and reading the real stack.**

**Files:**
- Investigate, then modify the file the stack identifies. Candidate fix location: `packages/drawio/src/board-inner.tsx` or `packages/editor/src/components/drawio-editor-dialog.tsx`, or a new `sanitizeSvg` util if an SVG string is the source.
- Test (Playwright): `apps/e2e/post-release-1.25-drawio.spec.ts`

- [ ] **Step 1: Reproduce with Playwright + capture the real stack**

Seed a DRAWIO page (via Prisma in the spec or by creating one in-app), open it, and capture console errors + the React error overlay text. Use the Playwright MCP browser tools against the running dev server, OR write a spec:

```ts
import { test, expect } from '@playwright/test'
import { signUpAndAuthAs } from './helpers/auth'

test('opening a DRAWIO page does not throw foreignObject error', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(e.message))
  await signUpAndAuthAs(page)
  // create a DRAWIO page (sidebar → создать → draw.io canvas) and open it,
  // OR seed one via the test DB and goto(`/pages/${id}`)
  // wait for the drawio iframe / board to mount
  await page.waitForTimeout(1500)
  expect(errors.filter((e) => e.includes('foreignObject'))).toEqual([])
})
```

Run it and READ THE FAILURE. Capture: the full error message, the component stack (which file/component renders the `<foreignObject>`), and whether it comes from our code, `react-drawio`, or another renderer (e.g. a thumbnail/preview component, or a different page type sharing the route).

Run: `pnpm exec playwright test apps/e2e/post-release-1.25-drawio.spec.ts --retries=0`
Expected (initially): FAIL — record the stack.

- [ ] **Step 2: Decide the fix from the real stack**

Based on Step 1's stack, choose:

- **(A) If a third-party React component (e.g. react-drawio preview) renders `<foreignObject y="">`:** the fix is to avoid mounting that component with empty geometry, or render the diagram via `<img src={dataUrl}>` instead of the component. Replace the offending render path with the safe `<img>` pattern already used in `drawio.tsx`/`drawio-viewer-dialog.tsx`.

- **(B) If an SVG *string* is inserted as markup somewhere (innerHTML / dangerouslySetInnerHTML) and that path is reachable for drawio:** add and apply a `sanitizeSvg` util:

  Create `packages/editor/src/extensions/sanitize-svg.ts` (or co-locate with the offending file):
  ```ts
  /**
   * react-drawio / drawio exports occasionally emit <foreignObject> with empty
   * numeric attributes (y="", x="") which the DOM rejects. Drop empty x/y/width/
   * height so the SVG parses.
   */
  export function sanitizeSvg(svg: string): string {
    return svg.replace(/\s(x|y|width|height)=""/g, '')
  }
  ```
  Add a unit test `sanitize-svg.test.ts`:
  ```ts
  import { describe, expect, it } from 'vitest'
  import { sanitizeSvg } from './sanitize-svg'
  describe('sanitizeSvg', () => {
    it('drops empty numeric attributes on foreignObject', () => {
      expect(sanitizeSvg('<foreignObject y="" x="" width="10">x</foreignObject>'))
        .toBe('<foreignObject width="10">x</foreignObject>')
    })
  })
  ```
  Run: `pnpm --filter @repo/editor test -- sanitize-svg` → PASS. Then apply `sanitizeSvg(...)` at every markup-insertion point the stack implicated.

- **(C) If the source is the `diagram-preview` innerHTML path being hit for drawio** (the spec's original hypothesis, only if Step 1 confirms it): switch `diagram-preview.tsx:44` to render the drawio SVG as `<img>` for the drawio render function, OR sanitize via (B). Confirm with the stack before touching this — drawio does NOT currently route through diagram-board per exploration.

Implement the chosen fix.

- [ ] **Step 3: Re-run the reproduction spec, verify it passes**

Run: `pnpm exec playwright test apps/e2e/post-release-1.25-drawio.spec.ts --retries=1`
Expected: PASS — no `foreignObject` error, the drawio page/diagram renders.

- [ ] **Step 4: Verify an already-broken stored page recovers**

If the fix is sanitize-on-render (B/C), seed a page whose stored content contains `<foreignObject y="">` and assert it opens. If the fix is avoid-the-component (A), confirm the same. The user reported existing pages broke, so recovery-on-read is required — do not require a re-save.

- [ ] **Step 5: Commit**

```bash
git add -A packages/editor packages/drawio packages/diagram-board apps/e2e/post-release-1.25-drawio.spec.ts
git commit -m "fix(editor): drawio page no longer crashes on empty foreignObject attribute"
```

---

## Task 12: Full gates + finish

- [ ] **Step 1: Run the merge gate**

Run: `pnpm gates`
Expected: check-types + lint + check-architecture + build + test all PASS. If `web build` fails with `DATABASE_URL not set during page data collection` (a known false-failure for this app per prior release work), confirm whether it reproduces on `main` before treating it as introduced by this branch.

- [ ] **Step 2: Run the new E2E specs warm (server already compiled)**

Run:
```bash
pnpm exec playwright test apps/e2e/post-release-1.25-*.spec.ts --retries=1
```
Expected: all PASS. Per the cold-compile note, the first attempt warms the shared dev server; `--retries=1` absorbs cold-compile flake.

- [ ] **Step 3: Update the changelog (notable release)**

Per the changelog memory note, add a short entry to `docs/changelog.md` (the hand-curated public changelog) summarizing the 8 fixes. Commit:
```bash
git add docs/changelog.md
git commit -m "docs(changelog): note post-release 1.25 fixes"
```

- [ ] **Step 4: Finish the branch**

Invoke superpowers:finishing-a-development-branch to choose merge/PR. Do NOT merge or release without explicit user instruction.

---

## Self-Review notes (resolved)

- **Spec coverage:** #1→Tasks 4-5; #2→Task 6; #3→Task 7; #4→Tasks 1-3; #5→Tasks 8-9; #6→Task 5 (optimistic splice, no success-refetch); #7→Task 10; #8→Task 11. All eight covered.
- **#8 caveat:** the spec assumed an innerHTML source; exploration contradicts that for the DRAWIO page. Task 11 makes reproduction the first step and branches the fix on the real stack rather than committing to the wrong file — this is the intended, honest handling, not a placeholder.
- **Type consistency:** `moveToCollectionInput` gains `newParentId`/`newPrevPageId` (Task 4) and they are consumed in Tasks 5; `buildContentYjsForTest` exported in Task 3 is used by that task's test only; `CONTENT_EXTENSIONS` replaces every `[StarterKit]` literal in page-writer (Task 3 step 4 greps to confirm).
- **MCP table caveat (user-acknowledged):** pages already created via MCP without tables were lost server-side and are not retroactively fixed — only new MCP creates/updates gain tables.
