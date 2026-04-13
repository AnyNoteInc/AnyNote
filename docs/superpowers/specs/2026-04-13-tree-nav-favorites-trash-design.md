# Tree Navigation, Favorites & Trash

**Date:** 2026-04-13
**Branch:** TBD (will be created during implementation)

## Overview

Replace flat page/chat lists in the workspace sidebar with tree views (MUI X Tree View), add favorites section, implement trash with restore/hard-delete, and add page context menu with full set of actions.

---

## 1. Schema Changes

### Page — new field

```prisma
prevPageId String? @unique
prevPage   Page?   @relation("PageOrder", fields: [prevPageId], references: [id])
nextPage   Page?   @relation("PageOrder")
```

Linked-list for sibling ordering within the same parent. Same pattern as Block.prevBlockId.

Existing fields already cover hierarchy (`parentId`, `parentType`) and soft-delete (`deletedAt`).

### SearchChat — new field

```prisma
parentId  String?
parent    SearchChat?  @relation("ChatTree", fields: [parentId], references: [id], onDelete: Cascade)
children  SearchChat[] @relation("ChatTree")
```

Cascade delete: deleting a parent chat deletes all children.

Sort remains `updatedAt DESC` at every level — no linked-list, no manual ordering.

### New table: FavoritePage

```prisma
model FavoritePage {
  id        String   @id @default(uuid())
  userId    String
  pageId    String
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  page Page @relation(fields: [pageId], references: [id], onDelete: Cascade)

  @@unique([userId, pageId])
  @@index([userId])
}
```

Many-to-many between User and Page. One record = one page favorited by one user.

---

## 2. UI Package — MUI X Tree View

Install `@mui/x-tree-view` in `packages/ui`.

Re-export from `@repo/ui/components`:

- `SimpleTreeView`
- `TreeItem`
- `RichTreeView` (for drag-and-drop)
- Related types as needed

---

## 3. Page Tree in Sidebar

### Data flow

1. `page.listByWorkspace` returns flat list with `id`, `title`, `icon`, `parentId`, `prevPageId`, `deletedAt`
2. Client-side: filter `deletedAt == null`, group by `parentId`, sort siblings by linked-list traversal
3. Render recursively as `TreeItem` inside `RichTreeView` (Rich variant for D&D support)

### Hover actions on each TreeItem

On hover, two icons appear to the right of the page title:

1. **AddIcon** — create child page (`parentId` = current page, inserted at start of children linked-list)
2. **MoreHorizIcon** — context menu:
   - StarIcon / StarBorderIcon — toggle favorite
   - Divider
   - LinkIcon — copy page URL to clipboard
   - ContentCopyIcon — duplicate page in same parent
   - DriveFileRenameOutlineIcon — inline rename (creator or workspace owner only)
   - MovingIcon — open move dialog
   - DeleteIcon — soft-delete (creator or workspace owner only)

### Drag & Drop

RichTreeView handles D&D natively. On drop:

1. Remove page from old linked-list chain (rewire prev/next siblings)
2. Set new `parentId`
3. Insert into new linked-list chain at drop position
4. Single transaction via `page.move`

### Navigation

Click on TreeItem (not action icons) navigates to `/workspaces/{workspaceId}/pages/{pageId}`.

---

## 4. Search Chat Tree in Sidebar

### Data flow

1. `search.listChats` returns flat list with `id`, `title`, `parentId`, `updatedAt`
2. Client-side: group by `parentId`, sort by `updatedAt DESC` at each level
3. Render recursively as `TreeItem` inside `SimpleTreeView`

### Hover actions on each chat

On hover, two icons appear:

1. **AddIcon** — create child chat (`parentId` = current chat)
2. **MoreHorizIcon** — context menu:
   - DriveFileRenameOutlineIcon — rename
   - DeleteIcon — hard delete (cascades to children)

### Deletion behavior

Deleting a parent chat cascades — all children are also deleted (DB-level cascade).

### Navigation

Click navigates to `/workspaces/{workspaceId}/search/{chatId}`.

---

## 5. Favorites Section

### Sidebar placement

Appears between search section and pages section. Only rendered if user has at least one favorite page.

### Display

- Each favorited page is a root-level tree item
- Children of favorited pages are shown as nested (expandable)
- If a child page is also favorited independently, it appears both:
  - Nested under its parent (if parent is favorited)
  - As its own root-level item in favorites

### Actions

- Add: via MoreHorizIcon > StarBorderIcon in any page's context menu
- Remove: via MoreHorizIcon > StarIcon — available in both main tree and favorites section

### tRPC procedures

- `page.listFavorites` — returns user's favorited pages with children for tree rendering
- `page.addFavorite` — add to favorites
- `page.removeFavorite` — remove from favorites

---

## 6. Trash

### Route

`/workspaces/{workspaceId}/trash`

### Display

Flat list (no tree) of all workspace pages where `deletedAt != null`. Sorted by `deletedAt DESC`.

Each item shows:

- Page icon + title
- Deletion date
- Two action icons:
  - **RestoreIcon** — restore page (`deletedAt = null`)
  - **DeleteForeverIcon** — permanently delete from database

### Soft-delete cascade

When a page is moved to trash:

- All descendant pages are also marked `deletedAt = now()`
- All appear in trash as flat list

### Restore behavior

- Restoring a parent page also restores all its descendants
- Restoring a child whose parent is still in trash — child moves to workspace root (`parentId = null`, removed from old linked-list, inserted at start of root)

### Hard-delete

Permanently removes page and all its blocks from database.

### tRPC procedures

- `page.listTrashed` — list soft-deleted pages for workspace
- `page.restore` — restore page (and descendants)
- `page.hardDelete` — permanent deletion

---

## 7. Move Dialog

### UI

MUI Dialog containing:

- Title: "Переместить «{page title}»"
- Tree of workspace pages (SimpleTreeView) excluding:
  - The page being moved
  - All its descendants (prevent circular reference)
- First item: "Корень" — moves to workspace root level
- Buttons: "Переместить" / "Отмена"

### Logic

On confirm:

1. Remove page from old linked-list chain
2. Set new `parentId` (or null for root)
3. Insert at start of new parent's linked-list
4. Single transaction

### tRPC

- `page.move` — mutation: `{ pageId, newParentId: string | null }`

---

## 8. Rename

### UI

Inline editing in tree — TreeItem label becomes a text input on "Переименовать" action.

- Enter or blur: save
- Escape: cancel

### Access control

Only page creator (`createdById`) or workspace owner can rename.

### tRPC

- `page.rename` — mutation: `{ pageId, title: string }`

---

## 9. Copy Link & Duplicate

### Copy link (LinkIcon)

Client-only: `navigator.clipboard.writeText("{NEXT_PUBLIC_BASE_URL}/workspaces/{workspaceId}/pages/{pageId}")`

No tRPC call.

### Duplicate (ContentCopyIcon)

- `page.duplicate` — mutation: `{ pageId }`
- Creates copy with same `parentId`
- Title: "{original title} (копия)"
- Copies all blocks of the page (not child pages)
- Inserts in linked-list immediately after the original

Available to any workspace member.

---

## 10. Access Control Summary

| Action              | Who can perform                 |
| ------------------- | ------------------------------- |
| View pages/tree     | Any workspace member            |
| Create page/child   | Any workspace member            |
| Rename              | Page creator OR workspace owner |
| Delete (soft)       | Page creator OR workspace owner |
| Move                | Page creator OR workspace owner |
| Duplicate           | Any workspace member            |
| Favorite/unfavorite | Any workspace member            |
| Copy link           | Any workspace member            |
| Restore from trash  | Page creator OR workspace owner |
| Hard delete         | Page creator OR workspace owner |

---

## 11. tRPC Procedures Summary

### page router (new/modified)

| Procedure         | Type     | Description                                      |
| ----------------- | -------- | ------------------------------------------------ |
| `listByWorkspace` | query    | **Modified** — add `prevPageId` to select        |
| `listTrashed`     | query    | Soft-deleted pages for workspace                 |
| `listFavorites`   | query    | User's favorited pages with children             |
| `create`          | mutation | Create page with parentId, linked-list insertion |
| `rename`          | mutation | Update title (creator/owner only)                |
| `duplicate`       | mutation | Copy page + blocks                               |
| `move`            | mutation | Change parent + rewire linked-lists              |
| `softDelete`      | mutation | Set deletedAt on page + descendants              |
| `restore`         | mutation | Clear deletedAt on page + descendants            |
| `hardDelete`      | mutation | Permanent delete from DB                         |
| `addFavorite`     | mutation | Add FavoritePage record                          |
| `removeFavorite`  | mutation | Remove FavoritePage record                       |

### search router (modified)

| Procedure    | Type     | Description                                        |
| ------------ | -------- | -------------------------------------------------- |
| `listChats`  | query    | **Modified** — add `parentId` to select            |
| `createChat` | mutation | **Modified** — accept optional `parentId`          |
| `deleteChat` | mutation | **Modified** — cascade deletes children (DB-level) |
