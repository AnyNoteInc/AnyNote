# Post-Release 1.25 Fixes — Design

Date: 2026-06-16
Status: Approved (design), pending implementation
Branch: `fix/post-release-1.25`

Eight independent bug fixes / small UX changes reported against the live 1.25.0
build. Each is self-contained; they share no state and can be implemented and
verified one at a time. Verification uses unit tests where a pure conversion or
domain transaction is involved, and Playwright for the browser-only behaviours
(drag-and-drop, drawio render, layout).

---

## 1 + 6. Sidebar drag-and-drop into Личное/Команда: sort to the drop position, optimistically, no blink

**Symptom (1):** Dragging a page into the Личное (Personal) section does not
sort — drop the second of two pages into second position and nothing reorders.

**Symptom (6):** On drop the page snaps back to its origin, then jumps to the
target only after the server responds (a visible blink).

**Root cause:** A cross-section drop routes to `page.moveToCollection`
(`sidebar-dnd-context.tsx:233-235`), whose domain transaction
(`moveToCollectionTx`, `pages.repository.ts:398-423`) updates **only**
`collectionId`. It never touches `prevPageId`, so:
- the page keeps its old linked-list position (which belongs to the *source*
  collection's list), so it does not sort within the target — and the target
  list's ordering is now corrupt (a page "after" a row in another collection);
- there is no optimistic `setData` before the mutation, so the page disappears
  from the source list and reappears in the target only after the round-trip —
  the blink.

**Decision (confirmed):** Drop inserts the page at the **exact position it was
dropped** (above/below the row under the cursor), mirroring same-section
reorder.

### Changes

**Domain — `moveToCollectionInput` + `moveToCollectionTx`.**
Extend `moveToCollectionInput` (`pages.dto.ts:73-78`) with optional position:

```ts
export const moveToCollectionInput = z.object({
  pageId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  target: z.enum(['team', 'private']),
  newParentId: z.string().uuid().nullable().optional(),
  newPrevPageId: z.string().uuid().nullable().optional(),
})
```

`moveToCollectionTx` becomes a "detach from old list → set collection → splice
into new list at position" transaction. It already must detach the moved page's
old next-sibling (the bug today is that it does not). Reuse the exact 4-step
linked-list shuffle from `reorderPageTx`:

1. Lift moved page (`prevPageId = null`) to free the UNIQUE slot.
2. Fix the old next sibling's back-pointer to the moved page's old `prevPageId`.
3. Plug the insert point: the row currently at `newPrevPageId` (within the
   *target* collection's parent scope) re-points to the moved page.
4. Set the moved page's final `collectionId`, `parentId`, `prevPageId`.

When `newPrevPageId`/`newParentId` are omitted (e.g. drop on the bare header
zone, or the context-menu "move" action), fall back to inserting at the **head**
of the target collection (`prevPageId = null`, after detaching the existing head
exactly like `movePageTx:602-617`). This keeps the header-zone and menu paths
working without a position.

The service layer resolves `target` → `collectionId` as today, then forwards the
optional position to the repo.

**Frontend — `sidebar-dnd-context.tsx`.**
The cross-section branch (`233-236`) currently has no position and no optimistic
update. Change it to:
- compute `newParentId` / `newPrevPageId` from the `over` row the same way
  `page-tree-section.reorderHandler` does (the drop target row's `parentId`, and
  `prevPageId` vs `id` depending on drop-above/below). When `over` is the bare
  header zone (`zone:team`/`zone:private`), pass no position (head insert).
- apply an **optimistic** `utils.page.listByWorkspace.setData` that updates the
  dragged page's `collectionId` + `parentId` + `prevPageId` and repairs the two
  affected neighbour back-pointers (same shape as the reorder optimistic update),
  **before** calling `moveToCollection.mutate`.
- keep `onError: invalidate` rollback; **remove** the unconditional
  `onSuccess: invalidateCollections` refetch for the *drag* path so the
  optimistic state is authoritative and nothing re-snaps. (The context-menu
  move path in `use-page-actions` keeps its own invalidation.)

To compute the over-row position the context needs the same `flatItems`
knowledge the section has. Simplest: have the section's registered reorder
handler also accept cross-collection drops — i.e. when the drop resolves to a
*different* move-target section, the **target** section's handler runs the splice
(it knows its own `flatItems` and pages). Concretely, register a second
per-section handler `moveIntoHandler(active, over)` keyed by section, and in
`onDragEnd` branch (2) look up the **target** section's `moveIntoHandler` and
delegate. This keeps all linked-list math in one place (the section that owns the
list) and avoids duplicating `flattenTree` in the context.

The `moveIntoHandler` does the optimistic `setData` and calls
`moveToCollection.mutate({ pageId, workspaceId, target, newParentId, newPrevPageId })`.

**The blink fix (6)** falls out of the same change: because the optimistic
`setData` runs synchronously on drop and there is no success-refetch, the page is
already in its final place the instant you release; rollback only happens on a
real error.

### Verification
- Domain unit test (vitest, `@repo/domain`): create two pages in collection A,
  one page in collection B; move A's second page into B between B's pages; assert
  the linked-list in B is well-formed and A's list closed the gap. Add a
  rollback-style assertion that omitted position → head insert.
- Playwright: two pages in Личное, drag the second onto the first → asserts order
  flips; network throttled, assert no intermediate "missing then reappears"
  frame (the row stays present through the drop). Run with `--retries` per the
  cold-compile note.

---

## 2. Page icon hangs in the left gutter; title stays in place

**Symptom:** When a page has an icon, the title shifts right (icon is an in-flow
flex child). Want: icon offset into the left margin/gutter, title at the same x
whether or not an icon is present.

**File:** `apps/web/src/components/page/page-header.tsx:238-307` — the
`Stack direction="row"` title row.

**Change:** Take the icon out of the in-flow row. Wrap the title row in a
`position: relative` container at the normal content x; render the icon
absolutely positioned (or with a negative left margin) so it sits in the 48px
left gutter provided by `column-sx.ts` (`px: '48px'`), vertically aligned to the
title's first line. The title `TextField`/`Typography` renders at the same x in
both states (icon present / absent).

Keep the existing cover-overlap behaviour (`mt: '-36px'` when `hasCover`) — the
icon still overlaps the cover's bottom edge, just anchored to the gutter rather
than pushing the title. Icon stays clickable (opens the icon picker).

### Verification
Playwright: a page without an icon and one with an icon; assert the title's left
edge x-coordinate is identical in both cases, and the icon's right edge sits left
of the title's left edge. Visual screenshot for sanity.

---

## 3. Right outline nav vertically centered

**Symptom:** The right-hand table-of-contents mini-bar nav aligns to the top
(`top: 80`). Want it vertically centered in the viewport.

**File:** `apps/web/src/components/page/editor-outline.tsx:221-240`.

**Change:** Replace `top: 80` with `top: '50%'` + `transform: 'translateY(-50%)'`.
Keep `maxHeight: 'calc(100vh - 96px)'` + `overflowY: 'auto'` so a long TOC still
scrolls within the centered band. The hover popover (`297-322`) anchors to the
nav element, so it follows automatically; no change needed there beyond
confirming it doesn't clip at the viewport top/bottom for long lists (its own
`maxHeight` already clamps it).

### Verification
Playwright: a page with several headings; assert the nav's bounding box is
vertically centered (its center y ≈ viewport center y) within a tolerance.

---

## 4. MCP-created pages: tables don't render

**Symptom:** A page created via the MCP `createPage` tool with a markdown table
renders without the table.

**Root cause:** The MCP markdown pipeline in `apps/engines` lacks table support
that the web import flow already has:
- `apps/engines/src/apps/mcp/services/markdown-parser.service.ts` `parseBlock()`
  has no `case 'table'` — table tokens fall through to the paragraph default.
- `apps/engines/src/apps/mcp/services/page-writer.service.ts` `buildContentYjs()`
  passes only `[StarterKit]` to `TiptapTransformer.toYdoc`, so even a correct
  table node would have no schema to serialize.

**Reference (working):** `apps/web/src/server/page-import/markdown-to-tiptap.ts:86-103`
(table case) and `apps/web/src/server/page-import/content-yjs.ts:14-23`
(Table/TableRow/TableHeader/TableCell extensions). Test:
`apps/web/test/server/markdown-to-tiptap.test.ts:72-83`.

**Changes:**
1. `markdown-parser.service.ts`: add `case 'table'` producing
   `table → tableRow → tableHeader/tableCell → paragraph(inline)`, copied from the
   web implementation (adapted to this file's node-builder helpers).
2. `page-writer.service.ts`: import `Table`, `TableRow`, `TableHeader`,
   `TableCell` from `@tiptap/extension-table*` and add them to the extensions
   array passed to `TiptapTransformer.toYdoc`. Verify these deps are available to
   `apps/engines` (they are transitive via the editor stack; add explicit
   dependencies if missing).
3. `markdown-renderer.service.ts` (round-trip, for `getPageMarkdown`): add a
   `case` rendering a `table` node back to a GFM markdown table, for symmetry so
   a UI-created table read back via MCP round-trips.

### Verification
- Jest unit test in `apps/engines` mirroring the web test: parse a GFM table →
  assert `table`/`tableRow`/`tableHeader`/`tableCell` node tree.
- Round-trip test: render a table node → markdown → re-parse → same tree.
- End-to-end sanity via Playwright is optional here (MCP create is server-side);
  the unit tests cover the conversion gap, and the editor already renders tables.

---

## 5. /profile: replace workspaces list with Activity + Activity Grid

**Symptom:** `/profile` shows the user's workspaces. Want instead: the user's
activity, including a GitHub-style **Activity Grid** of which days had activity.

**File:** `apps/web/src/app/(protected)/profile/page.tsx:81-141` (workspaces
block).

**Decision (confirmed):** Activity source = `PageRevision` rows where
`actorId = current user`, counted per calendar day.

**Changes:**
1. New tRPC procedure `user.activity` (or extend an existing profile router):
   - returns the per-day counts for the trailing ~12 months:
     `Array<{ date: string (YYYY-MM-DD); count: number }>`, computed by grouping
     `PageRevision` on `createdAt::date` for the current `actorId`. Use a raw
     grouped query (Prisma `$queryRaw` with `date_trunc('day', ...)`) since
     Prisma `groupBy` can't truncate dates.
   - returns a `recentActions` list: the latest N `PageRevision` rows joined to
     the page title/type, mapped to `{ action, pageId, pageTitle, createdAt }`,
     filtered to pages the user can still see (revisions to deleted pages are
     skipped or shown as "(удалённая страница)").
2. Replace the workspaces JSX with:
   - an **ActivityGrid** component (new, `apps/web/src/components/profile/`):
     a 53-week × 7-day grid of cells colored by count bucket (0 / 1–2 / 3–5 /
     6+), MUI `Tooltip` per cell showing the date + count. Pure presentational,
     fed the per-day array. Server-rendered where possible; the grid itself is
     static markup.
   - a **recent activity** list below it (latest actions, each a link to the
     page, with a relative timestamp and an action label in Russian:
     создал/изменил/архивировал/восстановил/опубликовал).
3. Remove the now-unused workspaces query/imports from the profile page; the
   "create workspace" affordance stays available elsewhere (sidebar space menu),
   so dropping it here is intentional.

### Verification
- tRPC unit/integration test for `user.activity`: seed N revisions across 3
  distinct days for a user → assert 3 buckets with correct counts, and that
  another user's revisions are excluded.
- Playwright: `/profile` shows the grid (assert grid cells render) and a recent
  action linking to a page; assert the old "Рабочие пространства" heading is gone.

---

## 7. /notifications standalone, with the home-page header

**Symptom:** `/notifications` renders inside the workspace shell (sidebar +
workspace toolbar). Want it outside the workspace area, with a header like the
home page.

**Decision (confirmed):** Header = `PublicHeader` (the landing header with the
"Любые заметки" logo, user menu, theme switch).

**Current:** `apps/web/src/app/(protected)/(active)/notifications/page.tsx`
inherits `WorkspaceLayoutClient` from the `(active)` layout, so it gets the
sidebar + `WorkspaceToolbar` breadcrumb.

**Changes:**
1. Move the route out of the `(active)` group:
   `(protected)/(active)/notifications/page.tsx` →
   `(protected)/notifications/page.tsx`.
2. Add `(protected)/notifications/layout.tsx` that renders `<PublicHeader />`
   above `{children}` (mirror the `(about)/layout.tsx` structure, but inside
   `(protected)` so the session/providers from the protected layout still wrap
   it). Wrap content in a centered container consistent with other standalone
   pages.
3. Remove the `/notifications` breadcrumb special-case in
   `workspace-layout-client.tsx:135-137` (now dead — the route no longer renders
   under that layout). Confirm no other code assumes `/notifications` is inside
   the workspace shell.
4. Keep the page content (`NotificationsList`) unchanged; links to
   `/notifications` (e.g. from `/profile`, the user menu) keep working.

`PublicHeader` is a client component already used in protected-adjacent layouts;
confirm it has no RSC-prop-boundary issues when used here (it currently renders
`AppUserMenu` etc. fine on the landing page).

### Verification
Playwright: navigate to `/notifications` as an authed user; assert the
`PublicHeader` logo is present and the workspace sidebar is **not**; assert the
notifications list still renders.

---

## 8. Drawio page crash: `Invalid value for <foreignObject> attribute y=""`

**Symptom:** A DRAWIO page fails to open with
`Error: Invalid value for <foreignObject> attribute y=""`.

**Root cause:** The drawio block itself renders the SVG as an `<img src=data:…>`
(safe — the browser does not validate inner SVG markup). But the
`diagram-board`/preview path injects the SVG via `innerHTML`
(`packages/diagram-board/src/diagram-preview.tsx:44`,
`packages/editor/src/extensions/code-block.tsx:196`), which makes the browser
parse and validate the markup — and react-drawio's export contains a
`<foreignObject>` with an empty `y` attribute, which throws.

**Decision (confirmed):** Render the drawio SVG as an `<img>` data URL on the
render path that currently uses `innerHTML`, mirroring the safe drawio block, and
additionally sanitize empty `x`/`y`/`width`/`height` attributes on
`<foreignObject>` (and any element) before any DOM insertion, as belt-and-
suspenders against future malformed exports.

**Changes:**
1. Identify the exact render path that opens a DRAWIO **page** (vs. the inline
   drawio block) — trace `page-renderer.tsx` DRAWIO dispatch. If it routes
   through `diagram-preview`/`code-block` `innerHTML`, switch the drawio case to
   the `<img src={svgDataUrl}>` approach.
2. Add a small `sanitizeSvg(svg: string)` util that strips/zero-fills empty
   numeric attributes (`y=""` → remove, or `y="0"`) on the SVG string, applied
   wherever drawio SVG is still inserted as markup. Keep it minimal and tested.
3. Ensure stored already-broken pages recover: the sanitize runs on read/render,
   so existing pages with the empty-`y` export open without a re-save.

### Verification
**Playwright is required for this one** (the user explicitly asked). Open a
DRAWIO page whose stored SVG contains `<foreignObject y="">`; assert it renders
without a thrown error (no error overlay, the diagram image/SVG is present).
Seed such a page via Prisma in the spec setup.

---

## Cross-cutting

- Branch: `fix/post-release-1.25` off `main`.
- Each fix gets its own commit (Conventional Commits with scope), so they can be
  reviewed/reverted independently.
- Run `pnpm gates` before merge. Run the touched packages' tests per-fix during
  development (web vitest, engines jest, domain vitest, Playwright for the
  browser behaviours).
- Items 1/6, 2, 3, 7, 8 are browser-verified with Playwright; items 4 and 5 are
  primarily unit/integration-verified with a Playwright sanity pass where it adds
  signal.
