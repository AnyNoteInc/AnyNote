# Workspace Files Settings — Design Spec

**Date:** 2026-04-22
**Scope:** New section "Файлы" on the workspace settings page — list, filter, paginate, download, and delete workspace files.

## Context

Workspace members currently upload files through chat/page attachments (`POST /api/files/upload?kind=attachment&workspaceId=...`), which creates `File` rows scoped to a workspace. There is no UI to browse those files or manage them after upload. Owners cannot see what has been uploaded; non-owners cannot reuse files uploaded by teammates.

This spec adds a dedicated settings page that lists every ACTIVE file in the workspace with filters and actions.

## Goals

- Browse all ACTIVE workspace files in one place.
- Filter the list by file name and by uploader.
- Download any workspace file from the list.
- Delete own files (soft-delete → status `DELETED`) with a confirmation dialog.
- Keep the page fast for workspaces with hundreds of files via server-side pagination.

## Non-goals

- Rename, re-upload, move, or archive from this UI. (Rename already exists in the tRPC router and can be wired later.)
- Admin-level deletion of files uploaded by other users. Only the uploader can delete.
- Cross-workspace file search.
- Showing `PENDING`, `DELETED`, or `ARCHIVED` files. The list shows only `ACTIVE` files. The status column is displayed for consistency and future use but currently always shows `Активен`.
- Virus scanning, thumbnails, or preview modals.

## User experience

### Navigation

Add a new entry **Файлы** to the workspace settings sidebar in `WorkspaceSettingsNav`, placed between **AI агент** and **Опасная зона**. Slug: `files`. URL: `/workspaces/{workspaceId}/settings/files`.

### Page layout

A single MUI `Paper` block mirroring `WorkspaceAiSection`:

1. Header — `Typography h6` "Файлы" + one-line description "Все файлы, загруженные в этом workspace."
2. Filter chip row (see below).
3. Table (or list) of files — columns: иконка+имя, расширение, размер МБ, статус, скачивания, загрузил (аватар+ФИО), действия.
4. `TablePagination` footer (20 rows per page, Russian labels via `labelRowsPerPage`, `labelDisplayedRows`).
5. Empty states: no files at all, no files matching filters.

### Filter chips

Two MUI `Chip` controls, displayed side-by-side above the table. Both use `variant="outlined"` when inactive and `color="primary"` filled when active, with an `onDelete` `X` icon that clears the filter.

- **Чип "Название"** — clicking opens a popover with a `TextField` (debounced 300 ms). When value is non-empty, chip label becomes `Название: "foo"` and shows `X` to clear.
- **Чип "Пользователь"** — clicking opens an MUI `Menu` anchored to the chip. The menu is populated from `file.workspaceUploaders` (described below) — a list of `{ id, firstName, lastName, email, image }` entries, each rendered as an `Avatar` + full name `MenuItem`. Selecting one sets the filter to that user's id; chip label becomes `Пользователь: Иван И.`.

Filters combine with AND semantics. Changing a filter resets `page` to 0.

### Table rows

Each row shows:

- **Имя** — extension icon (see mapping) + file name. Name is a link to `/api/files/{id}` (opens in a new tab via `target="_blank"` and `rel="noreferrer"`, which triggers the existing download/view path and increments the counter).
- **Расширение** — uppercase text (`PDF`, `PNG`, `MP4`).
- **Размер** — `(fileSize / (1024 * 1024)).toFixed(2)` + ` МБ`. `fileSize` is a string DTO field (BigInt); parse with `Number()`.
- **Статус** — `MuiChip` with label `Активен` (always, since list filters to ACTIVE).
- **Скачивания** — plain integer.
- **Загрузил** — `Avatar` (24 px, `src={user.image}`, initials fallback) + `firstName lastName`; fallback to `email` if name fields are blank.
- **Действия** — `IconButton` download (`DownloadIcon`, always visible) + `IconButton` delete (`DeleteIcon`, only when `file.userId === currentUser.id`).

### Delete confirmation dialog

MUI `Dialog` opened from the row delete action:

- Title: `Удалить файл?`
- Body: `Файл "{name}.{ext}" будет удалён. Это действие нельзя отменить.`
- Buttons: `Отмена` (closes dialog) and `Удалить` (calls `file.delete`, shows loading, closes on success, invalidates list query).
- Error displayed as `Alert severity="error"` inside the dialog body.

### Extension → icon mapping

Pure function `getFileExtIcon(ext: string)` using MUI icons:

| Extensions                                                                       | Icon                  |
| -------------------------------------------------------------------------------- | --------------------- |
| `pdf`                                                                            | `PictureAsPdfIcon`    |
| `png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`, `bmp`, `avif`                        | `ImageIcon`           |
| `mp4`, `mov`, `avi`, `mkv`, `webm`                                               | `VideoFileIcon`       |
| `mp3`, `wav`, `ogg`, `flac`, `m4a`                                               | `AudioFileIcon`       |
| `zip`, `rar`, `7z`, `tar`, `gz`                                                  | `FolderZipIcon`       |
| `doc`, `docx`, `odt`, `rtf`                                                      | `DescriptionIcon`     |
| `xls`, `xlsx`, `csv`, `ods`                                                      | `TableChartIcon`      |
| `ppt`, `pptx`, `odp`                                                             | `SlideshowIcon`       |
| `txt`, `md`                                                                      | `TextSnippetIcon`     |
| `js`, `ts`, `tsx`, `jsx`, `json`, `xml`, `yaml`, `yml`, `py`, `go`, `rs`, `java` | `CodeIcon`            |
| _default_                                                                        | `InsertDriveFileIcon` |

Icons not yet re-exported from `@repo/ui/components` must be added to `packages/ui/src/components/index.ts` alongside existing `MenuIcon`-style re-exports, never imported directly from `@mui/icons-material` in app code.

## API surface

All changes are in `packages/trpc/src/routers/file.ts` plus one API route tweak.

### `file.listWorkspace` — extended (breaking change, one caller)

Current signature: `{ workspaceId, cursor?, limit? } → FileDTO[]`. Only caller is a future one (no existing consumers), so we can reshape without a deprecation path.

New signature:

```ts
input: {
  workspaceId: uuid,
  search?: string,        // trim, ≤ 256 chars; matched against File.name (case-insensitive contains)
  uploaderId?: uuid,
  page: number (int, ≥ 0, default 0),
  pageSize: number (int, 1..100, default 20),
}
output: {
  items: Array<FileDTO & { user: { id, firstName, lastName, email, image } }>,
  total: number,          // total row count for current filters
}
```

Implementation notes:

- Enforce membership as today; return 403 if not a member.
- Only include `status: ACTIVE`.
- `Prisma.count` and `Prisma.findMany` in parallel via `Promise.all`.
- `orderBy: { createdAt: "desc" }` preserved.
- `include: { user: { select: { id, firstName, lastName, email, image } } }` — we need the uploader for display. `serializeFile` extended to attach the user sub-object.
- Case-insensitive match: Prisma `contains` with `mode: "insensitive"`.

### `file.workspaceUploaders` — new query

```ts
input: {
  workspaceId: uuid
}
output: Array<{ id; firstName; lastName; email; image }>
```

Implementation:

- Enforce membership.
- `prisma.user.findMany({ where: { files: { some: { workspaceId, status: ACTIVE } } }, orderBy: { firstName: "asc" } })`.

### `GET /api/files/[id]` — expanded permission

Current rule: `file.userId === session.user.id` OR file is attached to a page in a workspace the user belongs to.

New rule (adds a third path): OR `file.workspaceId` is non-null AND the session user is a member of that workspace AND `file.status === ACTIVE`.

Order of checks stays the same; the new branch short-circuits after the cheaper owner check and before the `pageFile` lookup (saves a query in the common "download from the files list" path).

## Components and files

### New files

```
apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/files/page.tsx
apps/web/src/components/workspace/settings/files-section.tsx
apps/web/src/components/workspace/settings/files-filters.tsx
apps/web/src/components/workspace/settings/files-table-row.tsx
apps/web/src/components/workspace/settings/files-delete-dialog.tsx
apps/web/src/components/workspace/settings/file-ext-icon.tsx
```

### Edited files

```
apps/web/src/components/workspace/workspace-settings-nav.tsx   — add "Файлы" nav item
packages/trpc/src/routers/file.ts                              — extend listWorkspace, add workspaceUploaders, tweak DTO
apps/web/src/app/api/files/[id]/route.ts                        — allow workspace-member download of ACTIVE workspace files
packages/ui/src/components/index.ts                             — re-export any missing MUI icons used in file-ext-icon.tsx
```

### Component boundaries

- **`page.tsx`** (RSC): validates workspace exists via `getServerTRPC`, renders `<WorkspaceFilesSection workspaceId={workspaceId} currentUserId={session.user.id} />`. Uses `requireSession()` via the protected layout. Calls `notFound()` if workspace missing. Note: `currentUserId` is also available client-side via tRPC but passing explicitly from RSC avoids an extra request on first render.
- **`files-section.tsx`** (`"use client"`): owns filter state (`search`, `uploaderId`, `page`), calls `trpc.file.listWorkspace.useQuery`, renders layout + filters + table + pagination. Single source of truth for filter/page state.
- **`files-filters.tsx`**: stateless chip row that takes `{ search, uploaderId, onSearchChange, onUploaderChange, uploaders }` and owns popover/menu open state internally.
- **`files-table-row.tsx`**: pure presentational row given `{ file, currentUserId, onRequestDelete }`.
- **`files-delete-dialog.tsx`**: self-contained dialog controlled by `{ open, file, onClose, onDeleted }`.
- **`file-ext-icon.tsx`**: exports `FileExtIcon` (component wrapping the mapping above) plus the lookup table.

## Data flow

```
files-section
  ├─ useQuery file.workspaceUploaders  → populates uploader menu once
  ├─ useQuery file.listWorkspace({ search, uploaderId, page })
  │    debounce search 300 ms, reset page on filter change
  ├─ renders files-filters (passes state + setters)
  ├─ renders table of files-table-row
  │    each row: download link + delete button (own files only)
  │    delete click → setDeleteTarget(file) → opens files-delete-dialog
  └─ renders TablePagination (page + total)

files-delete-dialog
  ├─ confirm → trpc.file.delete.useMutation
  ├─ onSuccess → utils.file.listWorkspace.invalidate + onClose
  └─ error → Alert in dialog
```

## Edge cases and error handling

- **Empty workspace**: show `Typography color="text.secondary"` "Файлы ещё не загружались" instead of the table.
- **Empty filter result**: show "По фильтрам ничего не найдено. Сбросьте фильтры." with a `Button` that clears both filters.
- **Long file names**: `sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}` on the name cell; full name in `title` attribute.
- **User without firstName/lastName**: fall back to `email`. Avatar fallback initials derived from the same precedence.
- **Uploaders list race**: if `workspaceUploaders` is still loading when the user opens the uploader chip menu, show a disabled placeholder `MenuItem` "Загрузка...".
- **Delete race**: if a file disappears between list render and delete (e.g., uploader deleted from another tab), tRPC returns `NOT_FOUND`; dialog shows error and leaves itself open. List invalidation will sync eventually.
- **Pagination edge**: if current page exceeds `Math.ceil(total / pageSize) - 1` after deletion/filter change, clamp to last valid page in the query's `onSuccess`/`useEffect`.

## Testing

- tRPC: extend existing file router tests with:
  - `listWorkspace` returns paginated results with correct `total`.
  - Search matches case-insensitively.
  - `uploaderId` filter narrows rows.
  - Non-member gets 403.
  - `workspaceUploaders` returns only users with ACTIVE files in that workspace.
- API: unit-test `GET /api/files/[id]` authorization branch — workspace member can download an ACTIVE workspace file they don't own.
- No UI e2e in this iteration. Manual Playwright run at the end of implementation to verify the flow.

## Accessibility and i18n

- All copy in Russian, matching surrounding settings UI.
- Buttons carry `aria-label` (`Скачать файл`, `Удалить файл`) since they're icon-only.
- Dialog opens with focus on `Отмена` (safer default than `Удалить`).
- Table uses semantic `<table>` via MUI `Table` components, not divs.

## Rollout

Single PR. No feature flag — this is net-new UI on a restricted settings page behind workspace membership. No DB migration needed; all fields used already exist on `File` and `User`.
