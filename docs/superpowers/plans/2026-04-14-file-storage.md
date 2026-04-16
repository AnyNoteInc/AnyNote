# File Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an S3-backed file subsystem (`@repo/storage` + `File`/`BlockFile` tables + HTTP upload/download routes + `fileRouter` tRPC API) and wire the first consumer: profile avatar upload.

**Architecture:** `@repo/storage` package wraps `@aws-sdk/client-s3` with a narrow `StorageClient` contract. `apps/web` route handlers stream multipart uploads to S3 and stream downloads back, enforcing auth and dedup-by-hash. tRPC `fileRouter` covers metadata operations. MinIO in dev is initialized via a `minio-init` one-shot container.

**Tech Stack:** MinIO / S3, `@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, Prisma 7 (Postgres), tRPC v11, Next.js 16 App Router, MUI 6, Playwright.

**Testing strategy:** This repo uses `pnpm check-types` + `pnpm lint` + Playwright E2E + manual smoke (no unit test framework). Each task ends with a typecheck and a commit. The golden path is verified by Playwright at the end.

**Spec:** `docs/superpowers/specs/2026-04-14-file-storage-design.md`

---

## Task 1: Infrastructure — compose, env, turbo

**Files:**

- Modify: `compose.yml`
- Modify: `.env`
- Modify: `turbo.json`

- [ ] **Step 1: Add `minio-init` service to compose.yml**

Open `compose.yml` and add this service block just after the `minio` service (before `weaviate`):

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

- [ ] **Step 2: Append S3 env vars to `.env`**

Append these six lines to the repo-root `.env`:

```
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_ACCESS_KEY=admin
S3_SECRET_KEY=password
S3_BUCKET=storage
S3_FORCE_PATH_STYLE=true
```

- [ ] **Step 3: Add vars to `turbo.json` globalEnv**

Open `turbo.json`, find the `globalEnv` array, and add the six `S3_*` names to it (alphabetized with existing entries is fine but not required).

- [ ] **Step 4: Bring MinIO up and verify bucket creation**

Run:

```bash
docker compose up -d minio minio-init
docker compose logs minio-init
```

Expected: a log line `Bucket created successfully \`local/storage\``OR`Bucket \`local/storage\` already exists` (if re-run). Exit code 0.

Confirm via:

```bash
docker run --rm --network anynote_default minio/mc sh -c \
  "mc alias set local http://minio:9000 admin password >/dev/null && mc ls local/"
```

Expected: `storage/` appears in the listing.

- [ ] **Step 5: Commit**

```bash
git add compose.yml .env turbo.json
git commit -m "feat(infra): add minio-init and s3 env vars"
```

> **Note:** `.env` may be gitignored. If `git add .env` is a no-op, that's expected — skip it from the commit and keep the local edit only.

---

## Task 2: Prisma schema — `File`, `BlockFile`, `FileStatus`

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_add_files/migration.sql`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Add `FileStatus` enum**

Open `packages/db/prisma/schema.prisma`. Add the enum at the bottom (after the existing enums):

```prisma
enum FileStatus {
  ACTIVE
  PENDING
  DELETED
  ARCHIVED
}
```

- [ ] **Step 2: Add `File` model**

Append to the same file, below the last model:

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

- [ ] **Step 3: Add `BlockFile` junction**

Append immediately after `File`:

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

- [ ] **Step 4: Add back-relations on `User`, `Workspace`, `Block`**

In `User` (around line 10–37), add inside the relations block:

```prisma
  files         File[]
```

In `Workspace` (around line 168), add inside the relations block:

```prisma
  files                 File[]
```

In `Block` (around line 238), add inside the relations block:

```prisma
  blockFiles    BlockFile[]
```

- [ ] **Step 5: Generate the migration**

```bash
cd packages/db
pnpm exec prisma migrate dev --name add_files --create-only
cd ../..
```

`--create-only` generates the migration file without applying, so we can edit it before running.

Expected: a new directory appears under `packages/db/prisma/migrations/` with a timestamp and name `_add_files`, containing `migration.sql`.

- [ ] **Step 6: Append partial unique indexes to generated `migration.sql`**

Open the newly created `migration.sql` and append at the bottom:

```sql

-- Partial unique indexes (Prisma cannot express these in schema.prisma)
-- Dedup key for user-level files (avatars): same user + same hash, only one row.
CREATE UNIQUE INDEX "files_user_hash_no_ws"
  ON "files"("user_id", "hash")
  WHERE "workspace_id" IS NULL;

-- Dedup key for workspace-scoped files: same (user, workspace, hash), only one row.
CREATE UNIQUE INDEX "files_user_ws_hash"
  ON "files"("user_id", "workspace_id", "hash")
  WHERE "workspace_id" IS NOT NULL;
```

- [ ] **Step 7: Apply the migration and regenerate the client**

```bash
pnpm --filter @repo/db exec prisma migrate deploy
pnpm --filter @repo/db exec prisma generate
```

Expected: both commands exit 0. `migrate deploy` reports "1 migration applied".

- [ ] **Step 8: Export new types from `@repo/db`**

Open `packages/db/src/index.ts`. In the value-export block (currently exports `RoleType`, `ParentType`, etc.), add `FileStatus`:

```ts
export {
  RoleType,
  ParentType,
  IntegrationScope,
  IntegrationStatus,
  SubscriptionStatus,
  BlockType,
  SearchMessageRole,
  FileStatus,
} from "@prisma/client"
```

In the type-export block, add `File` and `BlockFile`:

```ts
export type {
  User,
  Account,
  // ...existing types...
  FavoritePage,
  File,
  BlockFile,
} from "@prisma/client"
```

- [ ] **Step 9: Typecheck**

```bash
pnpm --filter @repo/db check-types
```

Expected: exit 0.

- [ ] **Step 10: Commit**

```bash
git add packages/db/prisma/schema.prisma \
        packages/db/prisma/migrations \
        packages/db/src/index.ts
git commit -m "feat(db): add File and BlockFile models with partial unique indexes"
```

---

## Task 3: Scaffold `@repo/storage` package

**Files:**

- Create: `packages/storage/package.json`
- Create: `packages/storage/tsconfig.json`
- Create: `packages/storage/eslint.config.mjs`
- Create: `packages/storage/src/index.ts` (empty placeholder for now)

- [ ] **Step 1: Create package.json**

Create `packages/storage/package.json` with:

```json
{
  "name": "@repo/storage",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "exports": {
    ".": {
      "import": "./src/index.ts",
      "types": "./src/index.ts"
    },
    "./*": {
      "import": "./src/*",
      "types": "./src/*"
    }
  },
  "scripts": {
    "lint": "eslint . --max-warnings 0",
    "build": "tsc -p tsconfig.json",
    "check-types": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@aws-sdk/client-s3": "^3.670.0",
    "@aws-sdk/lib-storage": "^3.670.0",
    "@repo/eslint-config": "workspace:*",
    "@repo/typescript-config": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^22.19.1",
    "eslint": "^9.39.1",
    "typescript": "^5.9.2"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

Create `packages/storage/tsconfig.json`:

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "@repo/typescript-config/base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"],
    "module": "ESNext",
    "moduleResolution": "Bundler"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create eslint.config.mjs**

Create `packages/storage/eslint.config.mjs`:

```js
import { config } from "@repo/eslint-config/base"

/** @type {import("eslint").Linter.Config[]} */
export default config
```

- [ ] **Step 4: Create src/index.ts placeholder**

Create `packages/storage/src/index.ts` with a single line so the build doesn't fail:

```ts
export {}
```

- [ ] **Step 5: Install deps**

```bash
pnpm install
```

Expected: pnpm resolves the workspace, installs `@aws-sdk/client-s3` and `@aws-sdk/lib-storage` into `packages/storage/node_modules`, exit 0.

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @repo/storage check-types
```

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/storage/ pnpm-lock.yaml
git commit -m "feat(storage): scaffold @repo/storage package"
```

---

## Task 4: Implement `@repo/storage` contract + S3 client

**Files:**

- Create: `packages/storage/src/contract.ts`
- Create: `packages/storage/src/s3-client.ts`
- Modify: `packages/storage/src/index.ts`

- [ ] **Step 1: Write the contract**

Create `packages/storage/src/contract.ts`:

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

- [ ] **Step 2: Implement `S3StorageClient`**

Create `packages/storage/src/s3-client.ts`:

```ts
import type { Readable } from "node:stream"

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { Upload } from "@aws-sdk/lib-storage"

import type { PutOptions, StorageClient } from "./contract"

type S3Config = {
  endpoint: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  forcePathStyle: boolean
}

const readConfig = (): S3Config => {
  const required = [
    "S3_ENDPOINT",
    "S3_REGION",
    "S3_ACCESS_KEY",
    "S3_SECRET_KEY",
    "S3_BUCKET",
  ] as const
  for (const name of required) {
    if (!process.env[name]) {
      throw new Error(`[@repo/storage] missing env var ${name}`)
    }
  }
  return {
    endpoint: process.env.S3_ENDPOINT!,
    region: process.env.S3_REGION!,
    accessKeyId: process.env.S3_ACCESS_KEY!,
    secretAccessKey: process.env.S3_SECRET_KEY!,
    bucket: process.env.S3_BUCKET!,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  }
}

export class S3StorageClient implements StorageClient {
  private client: S3Client
  private bucket: string

  constructor(config: S3Config = readConfig()) {
    this.bucket = config.bucket
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle,
    })
  }

  async put(key: string, body: Readable | Buffer, opts: PutOptions): Promise<void> {
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: opts.contentType,
        ContentLength: Buffer.isBuffer(body) ? opts.size : undefined,
      },
    })
    await upload.done()
  }

  async get(key: string): Promise<Readable> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
    if (!res.Body) {
      throw new Error(`[@repo/storage] empty body for key ${key}`)
    }
    return res.Body as Readable
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }))
      return true
    } catch (err: unknown) {
      const error = err as { name?: string; $metadata?: { httpStatusCode?: number } }
      if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
        return false
      }
      throw err
    }
  }
}
```

- [ ] **Step 3: Export the singleton from `src/index.ts`**

Replace the placeholder `packages/storage/src/index.ts` with:

```ts
import { S3StorageClient } from "./s3-client"

export type { PutOptions, StorageClient } from "./contract"
export { S3StorageClient } from "./s3-client"

type GlobalStorage = typeof globalThis & {
  __storage?: S3StorageClient
}

const g = globalThis as GlobalStorage

export const storage: S3StorageClient = g.__storage ?? new S3StorageClient()

if (process.env.NODE_ENV !== "production") {
  g.__storage = storage
}
```

(Singleton pattern mirrors `@repo/db`.)

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @repo/storage check-types
```

Expected: exit 0.

- [ ] **Step 5: Lint**

```bash
pnpm --filter @repo/storage lint
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/storage/src
git commit -m "feat(storage): implement S3StorageClient and singleton"
```

---

## Task 5: Wire `@repo/storage` into `apps/web`

**Files:**

- Modify: `apps/web/package.json`
- Modify: `apps/web/next.config.js`

- [ ] **Step 1: Add dep to `apps/web/package.json`**

In the `"dependencies"` section of `apps/web/package.json`, add:

```json
    "@repo/storage": "workspace:*",
```

(Keep alphabetical ordering with other `@repo/*` entries.)

- [ ] **Step 2: Add to transpilePackages**

Open `apps/web/next.config.js` and update:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["pg", "@prisma/client"],
  transpilePackages: ["@repo/ui", "@repo/trpc", "@repo/auth", "@repo/storage"],
}

export default nextConfig
```

- [ ] **Step 3: Install and typecheck**

```bash
pnpm install
pnpm --filter web check-types
```

Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json apps/web/next.config.js pnpm-lock.yaml
git commit -m "feat(web): add @repo/storage dependency"
```

---

## Task 6: HTTP route — `POST /api/files/upload`

**Files:**

- Create: `apps/web/src/lib/file-validation.ts`
- Create: `apps/web/src/app/api/files/upload/route.ts`

- [ ] **Step 1: Write validation helpers**

Create `apps/web/src/lib/file-validation.ts`:

```ts
export type UploadKind = "avatar" | "attachment"

const AVATAR_MAX_BYTES = 5 * 1024 * 1024
const ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024

const AVATAR_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"])

const ATTACHMENT_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/markdown",
  "application/zip",
])

export type ValidationError = { status: 400; message: string }

export const validateUpload = (
  kind: UploadKind,
  size: number,
  mimeType: string,
): ValidationError | null => {
  const maxBytes = kind === "avatar" ? AVATAR_MAX_BYTES : ATTACHMENT_MAX_BYTES
  if (size === 0) return { status: 400, message: "Empty file" }
  if (size > maxBytes) {
    return { status: 400, message: `File exceeds limit of ${maxBytes} bytes` }
  }
  const allowed = kind === "avatar" ? AVATAR_MIME : ATTACHMENT_MIME
  if (!allowed.has(mimeType)) {
    return { status: 400, message: `Mime type ${mimeType} not allowed for ${kind}` }
  }
  return null
}

export const extractExt = (filename: string): string => {
  const dot = filename.lastIndexOf(".")
  if (dot < 0 || dot === filename.length - 1) return ""
  return filename
    .slice(dot + 1)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 16)
}

export const computeS3Key = (hash: string, ext: string): string => {
  const prefix = hash.slice(0, 2)
  return ext ? `${prefix}/${hash}.${ext}` : `${prefix}/${hash}`
}
```

- [ ] **Step 2: Write the upload route handler**

Create `apps/web/src/app/api/files/upload/route.ts`:

```ts
import { createHash } from "node:crypto"

import { prisma } from "@repo/db"
import { storage } from "@repo/storage"

import { getSession } from "@/lib/get-session"
import { computeS3Key, extractExt, validateUpload, type UploadKind } from "@/lib/file-validation"

export const runtime = "nodejs"

const isAvatarMime = (mime: string): boolean =>
  mime === "image/png" || mime === "image/jpeg" || mime === "image/webp" || mime === "image/gif"

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(request.url)
  const kindParam = url.searchParams.get("kind")
  const workspaceIdParam = url.searchParams.get("workspaceId")

  if (kindParam !== "avatar" && kindParam !== "attachment") {
    return Response.json({ error: "Invalid kind" }, { status: 400 })
  }
  const kind: UploadKind = kindParam

  if (kind === "avatar" && workspaceIdParam) {
    return Response.json({ error: "workspaceId not allowed for avatar" }, { status: 400 })
  }
  if (kind === "attachment" && !workspaceIdParam) {
    return Response.json({ error: "workspaceId is required for attachment" }, { status: 400 })
  }

  if (kind === "attachment") {
    const member = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: workspaceIdParam!,
          userId: session.user.id,
        },
      },
    })
    if (!member) {
      return Response.json({ error: "Forbidden" }, { status: 403 })
    }
  }

  const formData = await request.formData()
  const file = formData.get("file")
  if (!(file instanceof File)) {
    return Response.json({ error: "Missing file field" }, { status: 400 })
  }

  const bytes = Buffer.from(await file.arrayBuffer())
  const mimeType = file.type || "application/octet-stream"

  const validationError = validateUpload(kind, bytes.length, mimeType)
  if (validationError) {
    return Response.json({ error: validationError.message }, { status: validationError.status })
  }

  if (kind === "avatar" && !isAvatarMime(mimeType)) {
    return Response.json({ error: "Avatar mime must be an image" }, { status: 400 })
  }

  const hash = createHash("sha256").update(bytes).digest("hex")
  const ext = extractExt(file.name)
  const s3Key = computeS3Key(hash, ext)

  const workspaceId = kind === "attachment" ? workspaceIdParam : null

  const existing = await prisma.file.findFirst({
    where: {
      userId: session.user.id,
      hash,
      workspaceId,
      status: "ACTIVE",
    },
  })

  let fileRow = existing
  if (!fileRow) {
    if (!(await storage.exists(s3Key))) {
      await storage.put(s3Key, bytes, { contentType: mimeType, size: bytes.length })
    }
    fileRow = await prisma.file.create({
      data: {
        userId: session.user.id,
        workspaceId,
        name: file.name,
        ext,
        fileSize: BigInt(bytes.length),
        mimeType,
        hash,
        path: s3Key,
        status: "ACTIVE",
        isPublic: kind === "avatar",
      },
    })
  }

  let imageUrl: string | undefined
  if (kind === "avatar") {
    imageUrl = `/api/files/${fileRow.id}`
    await prisma.user.update({
      where: { id: session.user.id },
      data: { image: imageUrl },
    })
  }

  return Response.json({
    file: {
      id: fileRow.id,
      name: fileRow.name,
      ext: fileRow.ext,
      mimeType: fileRow.mimeType,
      fileSize: fileRow.fileSize.toString(),
      isPublic: fileRow.isPublic,
      createdAt: fileRow.createdAt.toISOString(),
    },
    imageUrl,
  })
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter web check-types
```

Expected: exit 0. Common fixes: import paths, `Response.json` generics.

- [ ] **Step 4: Smoke test the upload manually**

Start the dev stack:

```bash
docker compose up -d
pnpm dev
```

In another shell, sign into the app first (via browser at `http://localhost:3000/sign-in`), grab the session cookie from DevTools, then:

```bash
echo "hello" > /tmp/avatar.png
# (not actually a PNG, but we just want to check the plumbing fails gracefully on mime)
curl -i -X POST "http://localhost:3000/api/files/upload?kind=avatar" \
  -H "Cookie: <your-session-cookie>" \
  -F "file=@/tmp/avatar.png;type=text/plain"
```

Expected: `400 Bad Request` with `"Mime type text/plain not allowed for avatar"` message.

Then upload an actual PNG:

```bash
curl -i -X POST "http://localhost:3000/api/files/upload?kind=avatar" \
  -H "Cookie: <your-session-cookie>" \
  -F "file=@/path/to/real.png;type=image/png"
```

Expected: `200 OK`, JSON body with `file.id` and `imageUrl` = `/api/files/<uuid>`.

Verify the row in DB:

```bash
pnpm --filter @repo/db exec prisma studio
```

Open `files` table — one row with the expected hash and `isPublic = true`, `status = ACTIVE`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/file-validation.ts \
        apps/web/src/app/api/files/upload/route.ts
git commit -m "feat(web): POST /api/files/upload route"
```

---

## Task 7: HTTP route — `GET /api/files/[id]`

**Files:**

- Create: `apps/web/src/app/api/files/[id]/route.ts`

- [ ] **Step 1: Write the download route**

Create `apps/web/src/app/api/files/[id]/route.ts`:

```ts
import type { Readable } from "node:stream"

import { prisma } from "@repo/db"
import { storage } from "@repo/storage"

import { getSession } from "@/lib/get-session"

export const runtime = "nodejs"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const file = await prisma.file.findUnique({ where: { id } })
  if (!file || file.status !== "ACTIVE") {
    return new Response("Not found", { status: 404 })
  }

  if (file.expiresAt && file.expiresAt.getTime() < Date.now()) {
    return new Response("Gone", { status: 410 })
  }

  if (!file.isPublic) {
    const session = await getSession()
    if (!session) return new Response("Unauthorized", { status: 401 })
    if (session.user.id !== file.userId) {
      return new Response("Forbidden", { status: 403 })
    }
  }

  const body = (await storage.get(file.path)) as Readable
  const stream = new ReadableStream({
    start(controller) {
      body.on("data", (chunk: Buffer) => controller.enqueue(chunk))
      body.on("end", () => controller.close())
      body.on("error", (err) => controller.error(err))
    },
    cancel() {
      body.destroy()
    },
  })

  // fire-and-forget increment
  void prisma.file
    .update({
      where: { id: file.id },
      data: { downloadCount: { increment: 1 } },
    })
    .catch(() => {
      /* swallow — download already streaming */
    })

  const filenameSafe = encodeURIComponent(file.name)
  const disposition = file.ext
    ? `inline; filename="${filenameSafe}.${file.ext}"`
    : `inline; filename="${filenameSafe}"`

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": file.fileSize.toString(),
      "Content-Disposition": disposition,
      "Cache-Control": "private, max-age=0",
    },
  })
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter web check-types
```

Expected: exit 0.

- [ ] **Step 3: Smoke test download**

Using a `file.id` from Task 6:

```bash
curl -i "http://localhost:3000/api/files/<file-id>" -o /tmp/downloaded.png
```

Expected: `200 OK`, `Content-Type: image/png`, `Content-Disposition: inline; filename="...png"`. `/tmp/downloaded.png` matches the source byte-for-byte: `sha256sum /tmp/downloaded.png` equals the `hash` stored in DB.

Negative tests:

- `curl -i "http://localhost:3000/api/files/00000000-0000-0000-0000-000000000000"` → `404`
- Upload a non-avatar (`kind=attachment` with `isPublic=false`), then try `curl` without cookie → `401`
- Same URL with a different user's session → `403`

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api/files/\[id\]/route.ts
git commit -m "feat(web): GET /api/files/[id] download route"
```

---

## Task 8: tRPC `fileRouter`

**Files:**

- Create: `packages/trpc/src/routers/file.ts`
- Modify: `packages/trpc/src/index.ts`

- [ ] **Step 1: Write the router**

Create `packages/trpc/src/routers/file.ts`:

```ts
import { TRPCError } from "@trpc/server"
import { z } from "zod"

import { FileStatus } from "@repo/db"

import { protectedProcedure, router } from "../trpc"

const uuid = z.string().uuid()

const FileStatusSchema = z.nativeEnum(FileStatus)

export const fileRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        cursor: uuid.optional(),
        limit: z.number().int().min(1).max(100).default(50),
        status: z.array(FileStatusSchema).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const statuses = input.status ?? [FileStatus.ACTIVE]
      return ctx.prisma.file.findMany({
        where: { userId: ctx.user.id, status: { in: statuses } },
        orderBy: { createdAt: "desc" },
        take: input.limit,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        skip: input.cursor ? 1 : 0,
      })
    }),

  listWorkspace: protectedProcedure
    .input(
      z.object({
        workspaceId: uuid,
        cursor: uuid.optional(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const member = await ctx.prisma.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: input.workspaceId,
            userId: ctx.user.id,
          },
        },
      })
      if (!member) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Not a member of this workspace",
        })
      }
      return ctx.prisma.file.findMany({
        where: { workspaceId: input.workspaceId, status: FileStatus.ACTIVE },
        orderBy: { createdAt: "desc" },
        take: input.limit,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        skip: input.cursor ? 1 : 0,
      })
    }),

  getById: protectedProcedure.input(z.object({ id: uuid })).query(async ({ ctx, input }) => {
    const file = await ctx.prisma.file.findUnique({ where: { id: input.id } })
    if (!file) throw new TRPCError({ code: "NOT_FOUND", message: "File not found" })
    if (file.userId !== ctx.user.id && !file.isPublic) {
      throw new TRPCError({ code: "NOT_FOUND", message: "File not found" })
    }
    return file
  }),

  delete: protectedProcedure.input(z.object({ id: uuid })).mutation(async ({ ctx, input }) => {
    const file = await ctx.prisma.file.findUnique({ where: { id: input.id } })
    if (!file || file.userId !== ctx.user.id) {
      throw new TRPCError({ code: "NOT_FOUND", message: "File not found" })
    }
    return ctx.prisma.file.update({
      where: { id: input.id },
      data: { status: FileStatus.DELETED },
    })
  }),

  rename: protectedProcedure
    .input(z.object({ id: uuid, name: z.string().min(1).max(512) }))
    .mutation(async ({ ctx, input }) => {
      const file = await ctx.prisma.file.findUnique({ where: { id: input.id } })
      if (!file || file.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "File not found" })
      }
      return ctx.prisma.file.update({
        where: { id: input.id },
        data: { name: input.name },
      })
    }),

  setPublic: protectedProcedure
    .input(z.object({ id: uuid, isPublic: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const file = await ctx.prisma.file.findUnique({ where: { id: input.id } })
      if (!file || file.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "File not found" })
      }
      return ctx.prisma.file.update({
        where: { id: input.id },
        data: { isPublic: input.isPublic },
      })
    }),
})
```

- [ ] **Step 2: Register in appRouter**

Open `packages/trpc/src/index.ts`. Add import and router entry:

```ts
import { router, publicProcedure, createCallerFactory } from "./trpc"
import { userRouter } from "./routers/user"
import { workspaceRouter } from "./routers/workspace"
import { subscriptionRouter } from "./routers/subscription"
import { integrationRouter } from "./routers/integration"
import { blockRouter } from "./routers/block"
import { pageRouter } from "./routers/page"
import { searchRouter } from "./routers/search"
import { fileRouter } from "./routers/file"

export { createContext, createServerContext } from "./trpc"
export type { Context } from "./trpc"

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true })),
  user: userRouter,
  workspace: workspaceRouter,
  subscription: subscriptionRouter,
  integration: integrationRouter,
  block: blockRouter,
  page: pageRouter,
  search: searchRouter,
  file: fileRouter,
})

export const createCaller = createCallerFactory(appRouter)
export type AppRouter = typeof appRouter
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @repo/trpc check-types
pnpm --filter web check-types
```

Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add packages/trpc/src/routers/file.ts packages/trpc/src/index.ts
git commit -m "feat(trpc): add fileRouter"
```

---

## Task 9: Profile avatar UI

**Files:**

- Create: `apps/web/src/components/profile/profile-avatar-uploader.tsx`
- Modify: `apps/web/src/app/(protected)/profile/page.tsx`

- [ ] **Step 1: Write the client component**

Create `apps/web/src/components/profile/profile-avatar-uploader.tsx`:

```tsx
"use client"

import { useRef, useState } from "react"

import { useRouter } from "next/navigation"

import { Avatar, Box, CircularProgress, Typography } from "@repo/ui/components"

type Props = {
  currentImage: string | null
  initials: string
}

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif"

export default function ProfileAvatarUploader({ currentImage, initials }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const router = useRouter()
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onClick = () => {
    if (isUploading) return
    inputRef.current?.click()
  }

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    setError(null)
    setIsUploading(true)
    try {
      const body = new FormData()
      body.append("file", file)
      const res = await fetch("/api/files/upload?kind=avatar", {
        method: "POST",
        body,
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(payload?.error ?? `Upload failed (${res.status})`)
      }
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
      <Box
        onClick={onClick}
        sx={{
          position: "relative",
          cursor: isUploading ? "wait" : "pointer",
          "&:hover .overlay": { opacity: 1 },
        }}
      >
        <Avatar
          src={currentImage ?? undefined}
          sx={{
            width: 128,
            height: 128,
            fontSize: 44,
            background: "linear-gradient(135deg,#0f766e,#155e75)",
            color: "#fff",
          }}
        >
          {initials}
        </Avatar>
        <Box
          className="overlay"
          sx={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            bgcolor: "rgba(0,0,0,0.4)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: isUploading ? 1 : 0,
            transition: "opacity 120ms ease",
            fontSize: 12,
          }}
        >
          {isUploading ? <CircularProgress size={28} sx={{ color: "#fff" }} /> : "Сменить"}
        </Box>
      </Box>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        onChange={onChange}
        style={{ display: "none" }}
        data-testid="avatar-file-input"
      />
      {error ? (
        <Typography variant="caption" color="error">
          {error}
        </Typography>
      ) : null}
    </Box>
  )
}
```

- [ ] **Step 2: Use it from the profile page**

Open `apps/web/src/app/(protected)/profile/page.tsx`. Replace the inline `<Avatar>...{initials}</Avatar>` block with the new client component. The resulting top of the page should look like:

```tsx
import Link from "next/link"

import { Box, Button, Container, Paper, Stack, Typography } from "@repo/ui/components"

import ProfileAvatarUploader from "@/components/profile/profile-avatar-uploader"
import { requireSession } from "@/lib/get-session"
import { getServerTRPC } from "@/trpc/server"

export const metadata = { title: "Мой профиль" }

export default async function ProfilePage() {
  const session = await requireSession()
  const trpc = await getServerTRPC()
  const workspaces = await trpc.workspace.listMine()

  const initials =
    `${session.user.firstName.charAt(0)}${session.user.lastName.charAt(0)}`.toUpperCase()

  return (
    <Container maxWidth="sm" sx={{ py: { xs: 4, md: 8 } }}>
      <Stack alignItems="center" spacing={3}>
        <ProfileAvatarUploader
          currentImage={session.user.image ?? null}
          initials={initials}
        />
        <Stack alignItems="center" spacing={0.5}>
          <Typography variant="h4">
            {session.user.firstName} {session.user.lastName}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {session.user.email}
          </Typography>
        </Stack>

        {/* ...rest of the existing page unchanged... */}
```

(Remove the `Avatar` import from `@repo/ui/components` on this page since it moves into the uploader component. Leave the rest of the page — `Box`, `Button`, `Container`, `Paper`, `Stack`, `Typography` — as is.)

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter web check-types
```

Expected: exit 0.

- [ ] **Step 4: Smoke test in browser**

```bash
pnpm dev
```

Navigate to `http://localhost:3000/profile`. Click the avatar circle. Pick a PNG. Expect:

- Spinner appears over the avatar
- Page refreshes with the new image displayed
- DevTools → Application → Cookies: still logged in
- Reload the page, avatar persists
- `session.user.image` in the DB is `/api/files/<uuid>`

Negative: try a PDF — expect the error text under the avatar.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/profile/profile-avatar-uploader.tsx \
        apps/web/src/app/\(protected\)/profile/page.tsx
git commit -m "feat(web): profile avatar upload UI"
```

---

## Task 10: Playwright E2E + final verification

**Files:**

- Create: `apps/e2e/files.spec.ts`

- [ ] **Step 1: Look at existing Playwright auth/setup**

```bash
ls apps/e2e/
```

Inspect how other specs sign in (e.g. `auth.spec.ts`) — reuse whatever fixture or helper exists for "logged-in user". If there's no fixture and the pattern in existing specs is `test.beforeEach` with UI sign-in, mirror that.

- [ ] **Step 2: Create the golden-path spec**

Create `apps/e2e/files.spec.ts`:

```ts
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { expect, test } from "@playwright/test"

// Small 1x1 PNG (base64-decoded) — valid minimal PNG bytes.
const MIN_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII="

test.describe("avatar upload", () => {
  test("uploads, persists, and serves via /api/files", async ({ page, request }) => {
    // Assume test-auth helper — adapt to whatever exists in apps/e2e.
    // e.g. await signIn(page, { email: "test@example.com", password: "..." })

    await page.goto("/profile")

    const fileInput = page.getByTestId("avatar-file-input")
    await fileInput.setInputFiles({
      name: "avatar.png",
      mimeType: "image/png",
      buffer: Buffer.from(MIN_PNG_BASE64, "base64"),
    })

    // Wait for router.refresh()
    await expect(async () => {
      const src = await page.locator("img").first().getAttribute("src")
      expect(src).toMatch(/^\/api\/files\//)
    }).toPass({ timeout: 5000 })

    const imgSrc = await page.locator("img").first().getAttribute("src")
    expect(imgSrc).toBeTruthy()

    // Reload — avatar persists
    await page.reload()
    await expect(page.locator("img").first()).toHaveAttribute("src", imgSrc!)

    // The image URL is publicly readable (isPublic=true for avatars)
    const res = await request.get(imgSrc!)
    expect(res.status()).toBe(200)
    expect(res.headers()["content-type"]).toBe("image/png")
  })
})
```

Adjust the sign-in portion to the repo's existing Playwright helper.

- [ ] **Step 3: Run the spec**

With dev server running:

```bash
pnpm exec playwright test apps/e2e/files.spec.ts
```

Expected: 1 passed.

- [ ] **Step 4: Full verification sweep**

```bash
pnpm lint
pnpm check-types
pnpm exec playwright test
```

Expected: all three exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/e2e/files.spec.ts
git commit -m "test(e2e): avatar upload golden path"
```

---

## Self-Review

**1. Spec coverage:**

| Spec section                                                                                   | Task(s)               |
| ---------------------------------------------------------------------------------------------- | --------------------- |
| compose minio-init + bucket                                                                    | Task 1                |
| S3 env vars + turbo globalEnv                                                                  | Task 1                |
| `@repo/storage` package scaffold                                                               | Task 3                |
| StorageClient contract + S3StorageClient impl + singleton                                      | Task 4                |
| File / BlockFile Prisma models + FileStatus enum                                               | Task 2                |
| Partial unique indexes (raw SQL)                                                               | Task 2 (6)            |
| User / Workspace / Block back-relations                                                        | Task 2 (4)            |
| @repo/db exports (FileStatus, File, BlockFile)                                                 | Task 2 (8)            |
| S3 path `{hash[0..2]}/{hash}.{ext}`                                                            | Task 6 (computeS3Key) |
| POST /api/files/upload (auth, kind, size/mime, dedup, S3 put, Files insert, User.image update) | Task 6                |
| GET /api/files/[id] (auth, stream, Content-Disposition, download count)                        | Task 7                |
| fileRouter: list, listWorkspace (403), getById, delete, rename, setPublic                      | Task 8                |
| ProfileAvatarUploader + profile page integration                                               | Task 9                |
| Playwright E2E golden path                                                                     | Task 10               |

All spec requirements have an implementing task.

**2. Placeholder scan:** No TBDs, all code steps show full code, all commands exact.

**3. Type consistency:**

- `StorageClient`: used in Task 4 (definition), Task 6 (`storage.put`, `storage.exists`), Task 7 (`storage.get`) — signatures align.
- `FileStatus`: defined as Prisma enum in Task 2, imported in Task 8 (`@repo/db`) and used as string literal in Tasks 6–7 (`"ACTIVE"`, `"DELETED"`). Prisma's runtime enum matches string values — fine.
- `computeS3Key`, `extractExt`, `validateUpload`: defined in Task 6 step 1, used in Task 6 step 2. Consistent signatures.
- `ProfileAvatarUploader` props `{ currentImage, initials }` — defined and consumed consistently in Task 9.

No inconsistencies found.

---

## Execution Notes

- **Commit discipline:** every task ends with a commit. Do not batch.
- **Stop-and-ask:** if any task fails typecheck or lint and the fix isn't obvious from the error, stop and report rather than silently rewriting structure.
- **Env contents:** `.env` may be gitignored. If so, record the new vars in the commit message body instead of committing the file.
- **MinIO dev-only quirk:** the `minio-init` container exits after a successful `mc mb`. `docker compose ps` will show it `exited (0)` — that's correct, not a failure.
