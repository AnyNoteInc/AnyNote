# File Storage — Design Spec

**Date:** 2026-04-14
**Status:** Approved for implementation

## Problem

The app has no file storage. Users cannot upload avatars, and there is no path forward for future block attachments, workspace-scoped file search, or any persistent binary artifact. We need a first-class file subsystem that:

- Stores content in S3-compatible storage (MinIO in dev) via a reusable contract
- Tracks metadata, ownership, workspace scope, and access rules in Postgres
- Exposes upload and download as HTTP routes (streaming, not base64-in-JSON)
- Exposes management operations (list, rename, soft-delete, visibility toggle) via tRPC
- Provides end-to-end avatar upload as the first consumer

## Non-Goals

- BlockFile junction API (create / attach / detach for block attachments) — table is defined but write API is deferred to the block-attachment task
- S3 garbage collection of orphaned blobs
- Virus scanning / content moderation (`PENDING` status is a forward-compatible placeholder only)
- Cold storage tier transitions (`ARCHIVED` status is a placeholder only)
- Presigned upload/download URLs — all traffic is proxied by our route handlers
- Front-end pagination UX for the file list views

## Architecture Overview

```
┌────────────┐    multipart     ┌──────────────────────────┐    PutObject    ┌─────────┐
│  Browser   │ ───────────────▶ │ POST /api/files/upload   │ ──────────────▶ │  MinIO  │
│            │                  │ (Next.js route handler)  │                 │ (S3)    │
│            │ ◀─────────────── │                          │ ◀────── Stream  │ storage │
│            │   stream body    │ GET  /api/files/[id]     │    GetObject    │  bucket │
└────────────┘                  └──────────────────────────┘                 └─────────┘
      │                                   │
      │ tRPC (list/rename/delete/etc)     │  prisma (File, BlockFile)
      ▼                                   ▼
┌──────────────────────────┐      ┌────────────────────────┐
│ fileRouter (tRPC)        │      │ Postgres (files table) │
└──────────────────────────┘      └────────────────────────┘
```

Key boundaries:
- **`@repo/storage`** — storage contract + S3 implementation; the only place that talks to S3
- **`@repo/db`** — Prisma models for `File`, `BlockFile`, `FileStatus` enum
- **Route handlers in `apps/web`** — wire multipart / streaming to `@repo/storage` + `@repo/db`; enforce auth, size/mime
- **`packages/trpc` fileRouter** — metadata operations only; never touches S3

## Infrastructure

### compose.yml additions

Add a one-shot init service using the official MinIO client that runs after MinIO becomes healthy and creates the `storage` bucket idempotently:

```yaml
minio-init:
  image: minio/mc
  depends_on:
    minio:
      condition: service_healthy
  entrypoint: >
    /bin/sh -c "
    mc alias set local http://minio:9000 admin password &&
    mc mb --ignore-existing local/storage
    "
```

No public anonymous download is configured on the bucket — public files are still served through our HTTP route (which checks `is_public` in the DB).

### Environment variables (root `.env`)

```
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_ACCESS_KEY=admin
S3_SECRET_KEY=password
S3_BUCKET=storage
S3_FORCE_PATH_STYLE=true
```

`S3_FORCE_PATH_STYLE` is required by MinIO. All six vars must be added to `turbo.json` under `globalEnv` so Turbo hashes them for caching.

## `@repo/storage` Package

### Layout

```
packages/storage/
├── package.json
├── tsconfig.json
├── eslint.config.js
└── src/
    ├── index.ts        # re-exports contract + default singleton
    ├── contract.ts     # StorageClient interface + types
    └── s3-client.ts    # S3StorageClient implementation
```

Subpath exports:
- `.` — contract, types, and the default singleton `storage`

### Contract

```ts
import type { Readable } from "node:stream"

export type PutOptions = {
  contentType: string
  size: number
}

export interface StorageClient {
  put(key: string, body: Readable | Buffer, opts: PutOptions): Promise<void>
  get(key: string): Promise<Readable>
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
}
```

### S3StorageClient

- Built on `@aws-sdk/client-s3` + `@aws-sdk/lib-storage` (the latter for streaming multi-part uploads)
- Reads config from env (`S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`)
- Throws a clear error on boot if any required env var is missing
- `get` returns the raw body stream from `GetObjectCommand`
- `exists` uses `HeadObjectCommand` and treats 404 / NotFound as `false`
- `delete` is idempotent (no error on missing object)

### Singleton export

Follows the `@repo/db` pattern: a module-level singleton constructed lazily from env.

```ts
export const storage: StorageClient = new S3StorageClient()
```

## Database Schema

### `File` model

```prisma
model File {
  id            String      @id @default(uuid(7)) @db.Uuid()
  userId        String      @map("user_id") @db.Uuid()
  workspaceId   String?     @map("workspace_id") @db.Uuid()

  name          String      @db.VarChar(512)
  ext           String      @db.VarChar(16)
  fileSize      BigInt      @map("file_size")
  mimeType      String      @map("mime_type") @db.VarChar(128)
  hash          String      @db.VarChar(64)
  path          String      @db.VarChar(512)

  status        FileStatus  @default(ACTIVE)
  isPublic      Boolean     @default(false) @map("is_public")

  downloadCount Int         @default(0) @map("download_count")
  expiresAt     DateTime?   @map("expires_at") @db.Timestamptz(6)

  createdAt     DateTime    @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt     DateTime    @updatedAt @map("updated_at") @db.Timestamptz(6)

  user          User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  workspace     Workspace?  @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  blockFiles    BlockFile[]

  @@index([userId])
  @@index([createdAt])
  @@index([workspaceId])
  @@map("files")
}
```

### `BlockFile` junction

```prisma
model BlockFile {
  blockId   String   @map("block_id") @db.Uuid()
  fileId    String   @map("file_id") @db.Uuid()
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  block     Block    @relation(fields: [blockId], references: [id], onDelete: Cascade)
  file      File     @relation(fields: [fileId], references: [id], onDelete: Cascade)

  @@id([blockId, fileId])
  @@index([fileId])
  @@map("block_files")
}
```

### `FileStatus` enum

```prisma
enum FileStatus {
  ACTIVE
  PENDING
  DELETED
  ARCHIVED
}
```

### Partial unique indexes (raw SQL in migration)

Prisma cannot express partial unique indexes in `schema.prisma`. The project already uses this pattern for block linked-list invariants (`20260411211823_workspace_polish_pass/migration.sql`). Workflow:

1. Run `pnpm --filter @repo/db exec prisma migrate dev --name add_files` to generate the migration from the schema additions
2. Manually append the partial unique index SQL to the generated `migration.sql`:

```sql
CREATE UNIQUE INDEX "files_user_hash_no_ws"
  ON "files"("user_id", "hash")
  WHERE "workspace_id" IS NULL;

CREATE UNIQUE INDEX "files_user_ws_hash"
  ON "files"("user_id", "workspace_id", "hash")
  WHERE "workspace_id" IS NOT NULL;
```

3. Reset the local DB and re-apply: `pnpm --filter @repo/db exec prisma migrate reset` (dev only; prod uses `migrate deploy`)

### Required updates to existing models

- `User` — add `files File[]` back-relation (no change to `image` field type; it already stores strings)
- `Workspace` — add `files File[]` back-relation
- `Block` — add `blockFiles BlockFile[]` back-relation
- `@repo/db` `index.ts` — add `FileStatus` to value exports and `File`, `BlockFile` to type exports

## S3 Path Structure

`{hash.slice(0,2)}/{hash}.{ext}`

Where `hash` is the lowercase SHA-256 hex digest of the file bytes (64 chars). The first two hex characters shard the bucket so no single prefix grows unbounded. Because the path is deterministic from content, two DB rows with the same hash point at the same physical blob — even if they belong to different workspaces (dedup at the storage layer).

If a duplicate hash is detected in DB for the same `(userId, workspaceId)` the route handler returns the existing row without re-uploading to S3. If no DB row exists but the blob is already in S3 (same hash from another user), the `put` still succeeds (S3 overwrites, identical bytes — no-op in practice).

## HTTP Route Handlers

Both handlers run on `runtime = "nodejs"` and live under `apps/web/src/app/api/files/`.

### `POST /api/files/upload`

**Query params:**
- `kind=avatar|attachment` (required)
- `workspaceId=<uuid>` (required iff `kind=attachment`; rejected iff `kind=avatar`)

**Body:** `multipart/form-data` with a single `file` field.

**Flow:**
1. Require session (`401` if absent)
2. Parse the multipart body via `request.formData()`; reject if `file` missing (`400`)
3. Validate size and mime by `kind`:
   - **avatar** — max 5 MB, mime ∈ `{image/png, image/jpeg, image/webp, image/gif}`
   - **attachment** — max 50 MB, mime ∈ `{image/png, image/jpeg, image/webp, image/gif, application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.openxmlformats-officedocument.presentationml.presentation, text/plain, text/markdown, application/zip}`
4. For `kind=attachment`, verify the current user is a member of `workspaceId` (else `403`)
5. Read bytes into a buffer (single pass), compute SHA-256 hex, derive `ext` (lowercased, no dot) from the original filename
6. Look up existing row by dedup key:
   - avatar → `(userId, hash)` WHERE `workspaceId IS NULL`
   - attachment → `(userId, workspaceId, hash)`
7. If found → use that row; skip S3 upload. If not → `storage.put(path, buffer, { contentType, size })`, then create the row (`status=ACTIVE`, `isPublic` = `true` for avatar else `false`)
8. If `kind=avatar`: in the same transaction update `User.image = "/api/files/" + file.id`

**Response:** `{ file: FileDTO, imageUrl?: string }` where `imageUrl` is only populated for avatars.

### `GET /api/files/[id]`

**Flow:**
1. Load `File` by id; if missing or `status != ACTIVE` → `404`
2. If `expiresAt && expiresAt < now` → `410 Gone`
3. If `!isPublic` → require session and enforce `session.user.id === file.userId`; else `403`
4. `const body = await storage.get(file.path)`
5. Return a `Response` whose body is the stream, with headers:
   - `Content-Type: file.mimeType`
   - `Content-Length: file.fileSize.toString()`
   - `Content-Disposition: inline; filename="{encodeURIComponent(file.name)}.{file.ext}"`
   - `Cache-Control: private, max-age=0`
6. Fire-and-forget increment: `prisma.file.update({ where: { id }, data: { downloadCount: { increment: 1 } } })` — do not `await` on the response path

Errors surfaced to clients are plain status codes with short messages; stack traces and S3 error details stay in server logs.

## `fileRouter` (tRPC)

File: `packages/trpc/src/routers/file.ts`. All procedures are `protectedProcedure` unless stated.

- `list({ cursor?: uuid, limit: number = 50, status?: FileStatus[] })`
  Returns the caller's files, newest first. Cursor is the last `id` on the previous page. Default filter when `status` is omitted: `[ACTIVE]` (do not leak deleted/archived without explicit opt-in).

- `listWorkspace({ workspaceId: uuid, cursor?: uuid, limit: number = 50 })`
  First checks `WorkspaceMember` for `(workspaceId, ctx.user.id)`. If the caller is not a member → `TRPCError { code: "FORBIDDEN" }`. Otherwise returns files where `workspaceId = input.workspaceId AND status = ACTIVE`, newest first. No opt-in for non-ACTIVE here (workspace-wide visibility is stricter).

- `getById({ id: uuid })`
  Returns metadata if caller is owner or `isPublic=true`, else `NOT_FOUND` (do not reveal existence to strangers).

- `delete({ id: uuid })` → owner-only, sets `status = DELETED`

- `rename({ id: uuid, name: string (1..512) })` → owner-only, updates `name`

- `setPublic({ id: uuid, isPublic: boolean })` → owner-only, updates `isPublic`

Register under `appRouter.file` in `packages/trpc/src/index.ts`.

## UI — Profile Avatar

Minimal integration on `apps/web/src/app/(protected)/profile/page.tsx`:

- Extract the `Avatar` into a new client component `ProfileAvatarUploader` in `apps/web/src/components/profile/`
- Component receives `currentImage` and `initials` as props
- Click on avatar triggers a hidden `<input type="file" accept="image/png,image/jpeg,image/webp,image/gif">`
- On change: `fetch("/api/files/upload?kind=avatar", { method: "POST", body: formData })`, then `router.refresh()` to re-render the server component with the new `user.image`
- MUI `<Avatar src={currentImage ?? undefined}>{initials}</Avatar>` handles the fallback-to-initials case automatically when the image is null or fails to load

No separate "remove avatar" button in this iteration (YAGNI — the user can just upload a different picture).

## Error Handling Summary

| Scenario                                  | Status |
|-------------------------------------------|--------|
| No session on protected route             | 401    |
| Non-owner tries to mutate a file          | 403    |
| Non-member calls `listWorkspace`          | 403    |
| Non-public download without matching user | 403    |
| File not found / wrong status             | 404    |
| Expired file                              | 410    |
| Oversize, bad mime, missing `file` field  | 400    |
| S3 failure, unexpected exceptions         | 500    |

## Testing

- **Type check** — `pnpm check-types` must pass across all packages (new `@repo/storage`, updated `@repo/db`, `@repo/trpc`, `apps/web`)
- **Lint** — `pnpm lint` clean
- **Manual smoke** — `docker compose up -d`, `pnpm --filter @repo/db prisma:db-push`, `pnpm dev`, upload avatar via profile page, reload, verify persistence; download via `/api/files/{id}` and confirm the bytes round-trip
- **Playwright E2E** — a single spec in `apps/e2e/files.spec.ts` covers the golden path: sign in → open profile → upload small PNG → reload → avatar `<img>` has a `src` matching `/api/files/`. Negative paths (oversize, bad mime, unauthorized download) are covered by unit-style tests on the route handler if feasible; if the Next test harness makes that awkward, document and skip for this iteration

## Rollout

No feature flag. The `File` table is net-new (no existing data to migrate). The `User.image` field is already nullable and currently empty across all rows, so changing how we populate it is non-breaking.

Release order:
1. Merge schema + `@repo/storage` + env + compose changes together (infra-safe alone; no consumer code)
2. Merge route handlers + `fileRouter`
3. Merge profile UI change

Can also ship as a single PR; split is optional.
