# Collaborative Editor System — Design Spec

**Date:** 2026-04-16
**Status:** Draft, awaiting user review
**Scope:** Replace block-based page model with Tiptap editor (text pages), add Excalidraw canvas pages, enable real-time multi-user collaboration via Yjs, add a dedicated WebSocket server (apps/yjs) and two new packages (packages/editor, packages/excalidraw).

---

## 1. Goals & Non-goals

### Goals
- Render rich-text pages with a Notion-like editing UX powered by Tiptap v3.
- Render canvas pages with Excalidraw for diagrams and sketches.
- Multiple users can edit the same page simultaneously (text or canvas) and see each other's cursors and changes in real time.
- Page content persists in Postgres without requiring the Yjs server to be the source of truth at rest.
- File attachments (images, generic files) inserted into either editor are uploaded through `apps/web` and linked to the page via a new `PageFile` join table.
- Authorization for the realtime channel is enforced per page (workspace membership).

### Non-goals (this spec)
- Implementing DATABASE / KANBAN / FORM page types — only enum values and a placeholder branch in the renderer factory.
- Restoring or migrating data from the existing `Block` / `BlockFile` tables — they are dropped cleanly.
- Cover images on pages — `coverUrl` is removed; cover support is a future task.
- Email transports, SSO, or any auth changes beyond the new JWT issuance endpoint.

---

## 2. Architecture Overview

```
Browser
  apps/web  /workspaces/{wsId}/pages/{pageId}
    └─ <PageRenderer page={page}>
         ├─ type=EXCALIDRAW → <Board/>           (packages/excalidraw, dynamic ssr:false)
         └─ otherwise        → <AnyNoteEditor/>   (packages/editor,    dynamic ssr:false)

Browser ↔ apps/web (HTTP)
  POST /api/yjs/token            → JWT (sub=userId), 1h TTL
  POST /api/files/upload         → existing file upload (kind=attachment)
  tRPC pageRouter, fileRouter    → CRUD, attachToPage, detachFromPage

Browser ↔ apps/yjs (WebSocket, Hocuspocus)
  onAuthenticate({ token, documentName })   → verify JWT, check workspace membership
  onLoadDocument({ documentName })          → load Y.Doc from Page.contentYjs
  onStoreDocument({ documentName, document })  → debounced write of contentYjs (Bytes) and content (JSON snapshot)

Postgres (single source of truth at rest)
  Page.content      Json?     — denormalized Tiptap JSON snapshot for fast read paths
  Page.contentYjs   Bytes?    — Y.encodeStateAsUpdate, authoritative for live editing
  Page.type         PageType  — TEXT | EXCALIDRAW | DATABASE | KANBAN | FORM
  PageFile          (pageId, fileId) composite PK
```

**Key invariants:**
- `Page.contentYjs` is the source of truth for collaborative state. `Page.content` is a denormalized snapshot for non-realtime consumers (search, RSC pages, future API exports).
- `apps/yjs` is the only writer of `content` and `contentYjs` during an active session. tRPC mutations only read those fields (except `page.create` which initializes both to null and `page.update` which can change `type`/`title`/`icon`).
- `PageFile` rows are written by `apps/web` (via tRPC) when an attachment is added in either editor; cleanup happens on page delete via `onDelete: Cascade` and on explicit `file.detachFromPage`.

---

## 3. Database Changes (`packages/db`)

### 3.1 Removals
- Drop table `blocks` and all its indexes.
- Drop table `block_files`.
- Drop enum `block_type` (`BlockType`).
- On `Page`: drop columns `parentType`, `coverUrl`, `isDatabaseRow`.
- Drop enum `parent_type` (`ParentType`) **only if** unused after the column drop. Verify before dropping.
- On `File`: drop relation `blocks BlockFile[]`.

### 3.2 Additions
- New enum:
  ```prisma
  enum PageType {
    TEXT
    EXCALIDRAW
    DATABASE
    KANBAN
    FORM
  }
  ```
- On `Page`, add:
  - `type PageType @default(TEXT)`
  - `content Json?`            // Tiptap JSON snapshot
  - `contentYjs Bytes?`        // Y.encodeStateAsUpdate
  - `files PageFile[]`         // back-relation
- On `File`, add:
  - `pages PageFile[]`         // back-relation
- New model:
  ```prisma
  model PageFile {
    pageId    String   @db.Uuid
    fileId    String   @db.Uuid
    page      Page     @relation(fields: [pageId], references: [id], onDelete: Cascade)
    file      File     @relation(fields: [fileId], references: [id], onDelete: Cascade)
    createdAt DateTime @default(now()) @db.Timestamptz(3)

    @@id([pageId, fileId])
    @@index([fileId])
    @@map("page_files")
  }
  ```

### 3.3 Migration
A single Prisma migration named `20260416_collab_editor`:
1. `DROP TABLE block_files;`
2. `DROP TABLE blocks;`
3. `DROP TYPE block_type;`
4. `ALTER TABLE pages DROP COLUMN parent_type, DROP COLUMN cover_url, DROP COLUMN is_database_row;`
5. Conditionally `DROP TYPE parent_type` (only if unused — verify with `pg_depend` query first).
6. `CREATE TYPE page_type AS ENUM (...);`
7. `ALTER TABLE pages ADD COLUMN type page_type NOT NULL DEFAULT 'TEXT', ADD COLUMN content jsonb, ADD COLUMN content_yjs bytea;`
8. `CREATE TABLE page_files (...);` with composite PK and index.

No data migration — existing Block rows are deleted with the table.

---

## 4. apps/yjs (Hocuspocus WebSocket Server)

### 4.1 Layout
```
apps/yjs/
├─ package.json          (scripts: dev, build, start, lint, check-types)
├─ tsconfig.json         (extends @repo/typescript-config/base)
├─ eslint.config.mjs     (extends @repo/eslint-config)
├─ src/
│  ├─ index.ts           (Hocuspocus.Server bootstrap)
│  ├─ env.ts             (env var validation at startup; fail fast)
│  ├─ auth.ts            (verifyJwt, canAccessPage)
│  ├─ persistence.ts     (loadDocument, storeDocument)
│  └─ logger.ts
└─ README.md
```

### 4.2 Dependencies
- Runtime: `@hocuspocus/server`, `@hocuspocus/transformer` (TiptapTransformer), `yjs`, `jose`, `@repo/db`.
- Dev: `tsx`, `typescript`, `@types/node`, `@repo/typescript-config`, `@repo/eslint-config`.

### 4.3 Scripts
```json
{
  "dev": "tsx watch src/index.ts",
  "build": "tsc -p tsconfig.json",
  "start": "node dist/index.js",
  "lint": "eslint .",
  "check-types": "tsc --noEmit"
}
```

### 4.4 Hooks
- **`onAuthenticate({ token, documentName })`** — verify JWT via `jose.jwtVerify` against better-auth JWKS (URL fetched once at startup, cached). On success, call `canAccessPage(prisma, userId, pageId=documentName)` which returns `{ pageType }` (single Prisma query that joins workspace members and selects `Page.type`). Throw to reject; on success, return `{ userId, pageType }` so subsequent hooks receive it via `context`.
- **`onLoadDocument({ documentName, context })`** — read `Page.contentYjs` from Postgres; if non-null, `Y.applyUpdate(ydoc, contentYjs)`; return `ydoc`. The `context.pageType` from `onAuthenticate` is consulted by `onStoreDocument`.
- **`onStoreDocument({ documentName, document, context })`** — encode `Y.encodeStateAsUpdate(document)` → `Buffer`. If `context.pageType !== 'EXCALIDRAW'`, also derive Tiptap JSON via `TiptapTransformer.fromYdoc(document, "default")` and write to `Page.content`; otherwise leave `content` untouched. Single `prisma.page.update` writes the affected fields.
- Hocuspocus default debounce (~2s, max ~10s) is sufficient.

### 4.5 Auth model
- The browser calls `POST /api/yjs/token` (in apps/web) and receives a short-lived JWT (1h TTL, `sub=userId`).
- The browser passes the JWT as `token` to `HocuspocusProvider`.
- apps/yjs verifies the JWT against the same JWKS exposed by better-auth's `jwt()` plugin.
- Per-page authorization (`canAccessPage`) runs once per WebSocket connection in `onAuthenticate`.

### 4.6 Failure modes
- Invalid JWT → connection rejected (Hocuspocus surfaces 401-equivalent).
- Page not found or user not a workspace member → connection rejected.
- DB unavailable on `onStoreDocument` → Hocuspocus retries with backoff; client keeps editing in-memory; on permanent failure, the in-memory state stays correct until reconnect.

---

## 5. packages/editor (Tiptap)

### 5.1 Layout
```
packages/editor/
├─ package.json
├─ tsconfig.json
├─ eslint.config.mjs
├─ src/
│  ├─ index.ts
│  ├─ anynote-editor.tsx              ("use client" — main component)
│  ├─ extensions/
│  │  ├─ index.ts                     (buildExtensions(opts))
│  │  ├─ collaboration.ts             (Collaboration + CollaborationCursor)
│  │  ├─ slash-menu.ts                (suggestion-based slash command)
│  │  ├─ file-upload.ts               (@tiptap-codeless config, storageMode:"custom")
│  │  └─ placeholder.ts
│  ├─ components/
│  │  ├─ slash-menu-popover.tsx       (MUI Popover with command list)
│  │  ├─ floating-toolbar.tsx         (BubbleMenu — bold/italic/code/link/heading)
│  │  ├─ drag-handle.tsx              (DragHandle wrapper)
│  │  └─ image-uploader-card.tsx      (markdown-style upload card)
│  ├─ styles/
│  │  └─ content.css                  (base Tiptap content styles, MUI palette bridge)
│  └─ types.ts                        (AnyNoteEditorProps, SlashCommand, UploadHandler)
└─ README.md
```

### 5.2 Public API
```ts
export type UploadHandler = (args: {
  blob: Blob
  filename: string
}) => Promise<{ id: string; src: string }>

export type AnyNoteEditorProps = {
  pageId: string
  workspaceId: string
  yjsUrl: string                        // ws://...
  yjsToken: () => Promise<string>       // called by HocuspocusProvider on initial connect and on every reconnect; implementation must always fetch a fresh JWT (do not cache the resolved string)
  user: { id: string; name: string; color: string }
  uploadHandler: UploadHandler
  editable?: boolean
  className?: string
}

export function AnyNoteEditor(props: AnyNoteEditorProps): JSX.Element
```

### 5.3 Extension set
- Base (Tiptap v3): `@tiptap/starter-kit` (with `history: false` — Yjs manages undo/redo), `@tiptap/extension-task-list`, `@tiptap/extension-task-item`, `@tiptap/extension-link`, `@tiptap/extension-placeholder`, `@tiptap/extension-typography`, `@tiptap/extension-image`, `@tiptap/extension-table` (+ row, cell, header), `@tiptap/extension-code-block-lowlight` + `lowlight`.
- Collaboration: `@tiptap/extension-collaboration` (Yjs binding), `@tiptap/extension-collaboration-cursor`.
- UX: `@tiptap/extension-drag-handle-react`, custom `slash-menu` extension on top of `@tiptap/suggestion`.
- Files: `@tiptap-codeless/extension-file-upload` with `storageMode: "custom"`; the custom handler invokes `uploadHandler` and returns `{ src }`.

### 5.4 Initialization flow
1. `const ydoc = useState(() => new Y.Doc())[0]`
2. `const provider = useState(() => new HocuspocusProvider({ url: yjsUrl, name: pageId, document: ydoc, token: yjsToken }))[0]`
3. `const editor = useEditor({ extensions: buildExtensions({ ydoc, provider, user, uploadHandler }), editable, onCreate, ... })`
4. On unmount: `provider.destroy(); ydoc.destroy()`. The `useState(initializer)` pattern guarantees stable references across Next.js re-renders.

### 5.5 Slash menu items (initial set)
Heading 1/2/3, Paragraph, Bullet list, Numbered list, Task list, Quote, Code block, Divider, Image, File, Table.

### 5.6 Floating toolbar items
Bold, italic, strike, code, link, heading-toggle.

### 5.7 Markdown input
Provided by `@tiptap/extension-typography` and starter-kit's input rules: `# `, `## `, `### `, `> `, `- `, `1. `, `\`\`\``, `---`, `**bold**`, `*italic*`, `~~strike~~`, `\`code\``.

### 5.8 Theming
- `styles/content.css` defines content typography using CSS variables with `currentColor` fallbacks.
- AnyNoteEditor wraps content in a small `<GlobalStyles>` block that maps `theme.palette.text.primary`, `theme.palette.divider`, etc. to the CSS variables consumed by `content.css`.
- `content.css` is exposed via subpath export `@repo/editor/styles` and imported once in the protected layout.

---

## 6. packages/excalidraw

### 6.1 Layout
```
packages/excalidraw/
├─ package.json
├─ tsconfig.json
├─ eslint.config.mjs
├─ src/
│  ├─ index.ts
│  ├─ board.tsx                  ("use client" — dynamic-import wrapper)
│  ├─ board-inner.tsx            ("use client" — actual Excalidraw + binding)
│  ├─ use-excalidraw-yjs.ts      (Y.Doc + HocuspocusProvider + ExcalidrawBinding)
│  ├─ files-handler.ts           (Excalidraw image upload through uploadHandler)
│  └─ types.ts                   (BoardProps)
└─ README.md
```

### 6.2 Dependencies
- Runtime: `@excalidraw/excalidraw`, `@timephy/y-excalidraw`, `@hocuspocus/provider`, `yjs`.
- Peer: `react`, `next` (for `next/dynamic`).

### 6.3 Public API
```ts
export type BoardProps = {
  pageId: string
  workspaceId: string
  yjsUrl: string
  yjsToken: () => Promise<string>
  uploadHandler: UploadHandler           // shared type with @repo/editor
  editable?: boolean
  className?: string
}

export function Board(props: BoardProps): JSX.Element
```

### 6.4 SSR strategy
- `board.tsx` exports a `dynamic(() => import("./board-inner"), { ssr: false })`. This guarantees Excalidraw never appears in the server bundle.
- `board-inner.tsx` carries `"use client"` and never accesses `window` / `document` at module top level.

### 6.5 Sizing
- `<Board>` renders with `width: 100%; height: 100%`. The parent `PageRenderer` cell uses `flex: 1; min-height: 0` inside a flex column so Excalidraw fills the available area without overflow loops.

### 6.6 Yjs binding
- `useExcalidrawYjs` returns `{ ydoc, provider, binding }` initialized via `useState(initializer)` for stable references.
- On the Excalidraw `excalidrawAPI` callback: `binding.attach(api)`.
- Cursors / awareness handled by `ExcalidrawBinding(ydoc, provider.awareness)`.

### 6.7 File handling
- Excalidraw stores image `Files` (BinaryFiles) in memory: `{ id, dataURL, mimeType, ... }`.
- `files-handler.ts` watches `onChange(elements, appState, files)`:
  1. Diff `files` against an in-memory `Set<excalidrawFileId>` of already-uploaded ids.
  2. For each new file, decode `dataURL` → `Blob` and call `uploadHandler({ blob, filename })`.
  3. On success, store `excalidrawFileId → dbFileId` in the local map and call `file.attachToPage` via tRPC.
- On board load: read `pageFiles` (via tRPC), download each via `/api/files/{id}/download` as `Blob`, convert to `dataURL`, and call `excalidrawAPI.addFiles(...)` to populate Excalidraw's file cache. Cache `dbFileId → excalidrawFileId` to avoid double-uploads.

---

## 7. apps/web Integration

### 7.1 New / modified files
- `app/api/yjs/token/route.ts` — JWT issuer (POST). Calls `requireSession()`, then obtains a JWT via better-auth's JWT plugin (the plugin exposes `/api/auth/token` endpoint and equivalent `auth.api.getToken({ headers })`; the exact call is wired during implementation against the installed version). Returns `{ token, expiresAt }`. Runtime `nodejs`.
- `app/(protected)/workspaces/[workspaceId]/pages/[pageId]/page.tsx` — replace placeholder; resolve `page` via RSC tRPC, render `<PageRenderer>` inside a flex column with header.
- `components/page/page-renderer.tsx` — RSC factory component; `dynamic(import @repo/editor)` and `dynamic(import @repo/excalidraw)` with `ssr:false`; switch on `page.type`.
- `components/page/page-view.tsx` — DELETE.
- `components/page/block-renderer.tsx` — DELETE.
- `lib/yjs-config.ts` — exports `yjsUrl` (from `process.env.NEXT_PUBLIC_YJS_URL`) and `fetchYjsToken()` (POST `/api/yjs/token`).
- `lib/upload-handler.ts` — exports `createUploadHandler(workspaceId, pageId)` returning a `UploadHandler` that POSTs to `/api/files/upload?kind=attachment&workspaceId=...` and then attaches to page via tRPC.

### 7.2 tRPC changes (`packages/trpc`)
- Add `file.attachToPage({ pageId, fileId })` — upserts a `PageFile` row; verifies workspace membership.
- Add `file.detachFromPage({ pageId, fileId })` — deletes the `PageFile` row.
- Update `page.update` input to allow `type?: PageType`.
- Remove the existing `blockRouter` (and its mount) plus any references to Block / BlockFile.

### 7.3 Env vars (new)
- `NEXT_PUBLIC_YJS_URL` (apps/web) — e.g. `ws://localhost:1234`.
- `YJS_PORT` (apps/yjs) — defaults to `1234`.
- `BETTER_AUTH_JWT_AUDIENCE` (optional, both) — JWT audience claim, validated by apps/yjs.

All added to `turbo.json` `globalEnv` for cache hashing.

### 7.4 Layout & styles
- `app/(protected)/layout.tsx` adds a side-effect import: `import "@repo/editor/styles"`.
- `MUI` continues to provide the surrounding shell; the editor renders inside an MUI `Box` whose theme tokens feed into the editor's CSS variables.

---

## 8. Testing

### 8.1 Manual verification (must pass before considering work done)
- Open a TEXT page → type text → reload → text persists.
- Open the same TEXT page in two windows → typing in one appears in the other within ~1s; cursors visible.
- Use slash-menu: insert heading, list, image (upload), divider — each renders.
- Drag a block via the drag handle to a new position — order persists after reload.
- Open an EXCALIDRAW page → draw a rectangle → reload → rectangle persists.
- Same EXCALIDRAW page in two windows → drawing in one appears in the other; pointer cursors visible.
- Insert an image into Excalidraw → upload completes → reload → image still on the canvas.

### 8.2 Playwright (apps/e2e)
- `editor.spec.ts` — single-user TEXT editor: type, save, reload, assert content.
- `editor-collab.spec.ts` — two browser contexts on the same TEXT page: write in A, assert in B.
- `excalidraw.spec.ts` — single-user EXCALIDRAW: draw, reload, assert element count.

Run via `pnpm exec playwright test`. The dev server (apps/web on :3000 and apps/yjs on :1234) must be running before invocation.

### 8.3 Verification commands (run at end)
- `pnpm lint`
- `pnpm check-types`
- `pnpm format`

---

## 9. Risks & Open Questions

- **JWT audience / issuer mismatch.** better-auth's `jwt()` plugin and `jose`'s `jwtVerify` must agree on `iss` and `aud`. Confirm by hitting the JWKS endpoint (better-auth exposes it under `/api/auth/jwks`) and inspecting an issued token during initial wiring. The JWKS URL becomes a startup env var for apps/yjs.
- **`@timephy/y-excalidraw` API drift.** The package is a fork; the binding shape (`new ExcalidrawBinding(ydoc, awareness)`, `binding.attach(api)`) may differ slightly from upstream. Verify against the package's README on installation.
- **Tiptap v3 + React 19.** All chosen extensions must publish v3-compatible releases. If any extension is still v2-only, downgrade only that one and adapt or substitute.
- **Excalidraw bundle size.** First-load on EXCALIDRAW pages will be large (~1MB). Mitigated by `dynamic(ssr:false)`, but document the trade-off.
- **`parentType` enum drop safety.** Before dropping the type, verify nothing else in the schema references it.
- **PageFile ownership transfer.** If a file is moved between pages (rare today), there is no UI for it. The data model supports many-to-many via `PageFile`, but the UI treats it as 1:1 for now.

---

## 10. Out of scope (explicit)

- DATABASE / KANBAN / FORM page renderers (only enum + factory placeholder).
- Page cover images.
- Document version history (Yjs has built-in undo, but no snapshot timeline UI).
- Public sharing of pages without auth.
- Comments / annotations.
- Mobile UX polish for the editor.
