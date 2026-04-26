# Collaborative Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the block-based page model with a Tiptap-powered text editor and an Excalidraw canvas, both backed by Yjs for real-time multi-user collaboration via a dedicated Hocuspocus WebSocket server.

**Architecture:** Two new client packages (`packages/editor`, `packages/excalidraw`) provide the collaborative components. A new app (`apps/yjs`) runs Hocuspocus with JWT auth and persists `Y.Doc` state to `Page.contentYjs` (Bytes) plus a denormalized Tiptap snapshot in `Page.content` (JSONB). `apps/web` renders the right component via a `PageRenderer` factory keyed on `Page.type` (TEXT vs EXCALIDRAW). File uploads from either editor go through the existing `/api/files/upload` route and link to the page via a new `PageFile` join table.

**Tech Stack:** Tiptap v3, Yjs, Hocuspocus, Excalidraw, `@timephy/y-excalidraw`, MUI v6, Prisma 7, Next.js 16 (App Router), better-auth (JWT plugin via `jose`).

**Reference spec:** [docs/superpowers/specs/2026-04-16-collaborative-editor-design.md](../specs/2026-04-16-collaborative-editor-design.md)

---

## Phase 1 — Database Schema

### Task 1.1: Verify `parent_type` enum usage and edit Prisma schema

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (Page model, File model; remove Block + BlockFile + BlockType + ParentType)

- [ ] **Step 1: Check that `ParentType` is used only by `Page.parentType`**

```bash
grep -rn "ParentType\|parent_type" packages/db/prisma/schema.prisma packages/trpc packages/auth apps/web/src
```

Expected: only the `Page.parentType` declaration in `schema.prisma`, the enum declaration itself, and possibly its usage in `pageRouter` filter. If usage exists in tRPC, plan to either drop those filters or substitute `parentId IS NULL` semantics during Task 2.x.

- [ ] **Step 2: Edit `schema.prisma` — Add `PageType` enum**

Insert after the existing `BlockType` enum block:

```prisma
enum PageType {
  TEXT
  EXCALIDRAW
  DATABASE
  KANBAN
  FORM
}
```

- [ ] **Step 3: Edit `Page` model — drop `parentType`, `coverUrl`, `isDatabaseRow`, drop `blocks` relation, add `type`, `content`, `contentYjs`, `files`**

Replace the current `Page` model with:

```prisma
model Page {
  id            String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  workspaceId   String    @map("workspace_id") @db.Uuid
  parentId      String?   @map("parent_id") @db.Uuid
  type          PageType  @default(TEXT)
  title         String?   @db.Text
  icon          String?   @db.Text
  content       Json?
  contentYjs    Bytes?    @map("content_yjs")
  archived      Boolean   @default(false)
  prevPageId    String?   @unique @map("prev_page_id") @db.Uuid
  deletedAt     DateTime? @map("deleted_at") @db.Timestamptz(6)
  createdById   String?   @map("created_by_id") @db.Uuid
  updatedById   String?   @map("updated_by_id") @db.Uuid
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt     DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  workspace Workspace      @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  createdBy User?          @relation("PageCreatedBy", fields: [createdById], references: [id], onDelete: SetNull)
  updatedBy User?          @relation("PageUpdatedBy", fields: [updatedById], references: [id], onDelete: SetNull)
  prevPage  Page?          @relation("PageOrder", fields: [prevPageId], references: [id], onDelete: SetNull)
  nextPage  Page?          @relation("PageOrder")
  children  Page[]         @relation("PageTree")
  parent    Page?          @relation("PageTree", fields: [parentId], references: [id], onDelete: SetNull)
  favorites FavoritePage[]
  files     PageFile[]

  @@index([workspaceId])
  @@index([parentId])
  @@index([archived])
  @@map("pages")
}
```

- [ ] **Step 4: Delete `Block` model and `BlockType` enum**

Remove the entire `model Block { ... }` block and the `enum BlockType { ... }` block from `schema.prisma`.

- [ ] **Step 5: Delete `ParentType` enum**

Remove `enum ParentType { ... }` from `schema.prisma`.

- [ ] **Step 6: Edit `User` model — drop block relations**

Remove these two lines from the `User` model:

```prisma
  blocksCreated Block[] @relation("BlockCreator")
  blocksUpdated Block[] @relation("BlockUpdater")
```

- [ ] **Step 7: Edit `File` model — replace `blockFiles` with `pages`**

In the `File` model, replace:

```prisma
  blockFiles    BlockFile[]
```

with:

```prisma
  pages         PageFile[]
```

- [ ] **Step 8: Delete `BlockFile` model**

Remove the entire `model BlockFile { ... }` block from `schema.prisma`.

- [ ] **Step 9: Add `PageFile` model**

Append at the end of the file:

```prisma
model PageFile {
  pageId    String   @map("page_id") @db.Uuid
  fileId    String   @map("file_id") @db.Uuid
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  page Page @relation(fields: [pageId], references: [id], onDelete: Cascade)
  file File @relation(fields: [fileId], references: [id], onDelete: Cascade)

  @@id([pageId, fileId])
  @@index([fileId])
  @@map("page_files")
}
```

- [ ] **Step 10: Format the schema**

```bash
pnpm --filter @repo/db prisma format
```

Expected: schema is reformatted, no errors.

- [ ] **Step 11: Generate the Prisma client (compile-time check)**

```bash
pnpm --filter @repo/db prisma:generate
```

Expected: client generates successfully. Any field reference errors here mean Step 1's grep missed something.

### Task 1.2: Create the migration

**Files:**

- Create: `packages/db/prisma/migrations/20260416_collab_editor/migration.sql`

- [ ] **Step 1: Run `prisma migrate dev` against the local DB**

```bash
docker compose up -d postgres
pnpm --filter @repo/db exec prisma migrate dev --name collab_editor --create-only
```

Expected: a new directory `packages/db/prisma/migrations/<timestamp>_collab_editor/` containing `migration.sql`. We use `--create-only` so we can review and tweak before applying.

- [ ] **Step 2: Inspect and adjust generated SQL**

Open the new `migration.sql`. It must contain (order matters):

```sql
-- Drop block-related tables and enum
DROP TABLE IF EXISTS "block_files";
DROP TABLE IF EXISTS "blocks";
DROP TYPE IF EXISTS "BlockType";

-- Drop removed columns from pages
ALTER TABLE "pages" DROP COLUMN "parent_type";
ALTER TABLE "pages" DROP COLUMN "cover_url";
ALTER TABLE "pages" DROP COLUMN "is_database_row";

-- Drop ParentType enum (unused after column removal)
DROP TYPE IF EXISTS "ParentType";

-- Create PageType enum
CREATE TYPE "PageType" AS ENUM ('TEXT', 'EXCALIDRAW', 'DATABASE', 'KANBAN', 'FORM');

-- Add new columns to pages
ALTER TABLE "pages" ADD COLUMN "type" "PageType" NOT NULL DEFAULT 'TEXT';
ALTER TABLE "pages" ADD COLUMN "content" JSONB;
ALTER TABLE "pages" ADD COLUMN "content_yjs" BYTEA;

-- Create page_files join table
CREATE TABLE "page_files" (
  "page_id"    UUID NOT NULL,
  "file_id"    UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "page_files_pkey" PRIMARY KEY ("page_id", "file_id")
);
CREATE INDEX "page_files_file_id_idx" ON "page_files"("file_id");
ALTER TABLE "page_files"
  ADD CONSTRAINT "page_files_page_id_fkey"
  FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "page_files"
  ADD CONSTRAINT "page_files_file_id_fkey"
  FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Drop old (parent_type, parent_id) compound index, add (parent_id) only
DROP INDEX IF EXISTS "pages_parent_type_parent_id_idx";
CREATE INDEX "pages_parent_id_idx" ON "pages"("parent_id");
```

If Prisma generated different statements, edit them to match this order and content.

- [ ] **Step 3: Apply the migration**

```bash
pnpm --filter @repo/db exec prisma migrate dev
```

Expected: migration applied successfully; Prisma client regenerated.

- [ ] **Step 4: Verify the schema in Postgres**

```bash
docker compose exec postgres psql -U user -d anynote -c "\d pages" -c "\d page_files" -c "\dT"
```

Expected:

- `pages` has columns `type` (PageType), `content` (jsonb), `content_yjs` (bytea); does NOT have `parent_type`, `cover_url`, `is_database_row`.
- `page_files` exists with composite PK and an index on `file_id`.
- `BlockType` and `ParentType` are NOT listed in `\dT`; `PageType` IS listed.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): replace block model with PageType + content/contentYjs + PageFile

Drops blocks, block_files, BlockType, ParentType. Adds PageType enum,
Page.content (JSONB), Page.contentYjs (bytea), PageFile join table.
Removes Page.parentType, Page.coverUrl, Page.isDatabaseRow."
```

---

## Phase 2 — tRPC Cleanup & New Procedures

### Task 2.1: Remove `blockRouter` and Block references

**Files:**

- Delete: `packages/trpc/src/routers/block.ts`
- Modify: `packages/trpc/src/index.ts`
- Audit: `packages/trpc/src/routers/page.ts` (remove any block-related procedures or fields)

- [ ] **Step 1: Find all block references in trpc**

```bash
grep -rn "blockRouter\|block:\|@repo/db.*Block\|prisma.block\." packages/trpc/src
```

Note every hit; each must be removed in subsequent steps.

- [ ] **Step 2: Remove `blockRouter` from `appRouter`**

In `packages/trpc/src/index.ts`, delete:

```ts
import { blockRouter } from './routers/block'
```

and the `block: blockRouter,` line inside `router({ ... })`.

- [ ] **Step 3: Delete the block router file**

```bash
rm packages/trpc/src/routers/block.ts
```

- [ ] **Step 4: Audit `pageRouter` for block-related logic**

Open `packages/trpc/src/routers/page.ts`. For every procedure that returns `blocks` (e.g., `include: { blocks: ... }`) or filters on `parentType`:

- Remove the `blocks` includes entirely.
- Replace `parentType` filters with the equivalent on `parentId IS NULL` (workspace-level pages have no parent) — be guided by call sites; if a filter cannot be straightforwardly replaced, leave a `TODO: revisit` and surface it for review.

- [ ] **Step 5: Verify no stale block imports remain**

```bash
grep -rn "Block\|blockType\|BlockType" packages/trpc/src
```

Expected: no matches.

- [ ] **Step 6: Type-check the trpc package**

```bash
pnpm --filter @repo/trpc check-types
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/trpc
git commit -m "refactor(trpc): remove blockRouter and Block references"
```

### Task 2.2: Add `file.attachToPage` and `file.detachFromPage`

**Files:**

- Modify: `packages/trpc/src/routers/file.ts`

- [ ] **Step 1: Add input schemas and procedures**

Append before the closing `})` of `export const fileRouter = router({`:

```ts
  attachToPage: protectedProcedure
    .input(z.object({ pageId: uuid, fileId: uuid }))
    .mutation(async ({ ctx, input }) => {
      // Page must belong to a workspace where the user is a member
      const page = await ctx.prisma.page.findFirst({
        where: {
          id: input.pageId,
          deletedAt: null,
          workspace: { members: { some: { userId: ctx.user.id } } },
        },
        select: { id: true },
      })
      if (!page) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Page not accessible" })
      }
      const file = await ctx.prisma.file.findFirst({
        where: { id: input.fileId, userId: ctx.user.id },
        select: { id: true },
      })
      if (!file) {
        throw new TRPCError({ code: "NOT_FOUND", message: "File not found" })
      }
      await ctx.prisma.pageFile.upsert({
        where: { pageId_fileId: { pageId: input.pageId, fileId: input.fileId } },
        create: { pageId: input.pageId, fileId: input.fileId },
        update: {},
      })
      return { ok: true as const }
    }),

  detachFromPage: protectedProcedure
    .input(z.object({ pageId: uuid, fileId: uuid }))
    .mutation(async ({ ctx, input }) => {
      const page = await ctx.prisma.page.findFirst({
        where: {
          id: input.pageId,
          workspace: { members: { some: { userId: ctx.user.id } } },
        },
        select: { id: true },
      })
      if (!page) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Page not accessible" })
      }
      try {
        await ctx.prisma.pageFile.delete({
          where: { pageId_fileId: { pageId: input.pageId, fileId: input.fileId } },
        })
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
          // Already detached — idempotent
          return { ok: true as const }
        }
        throw err
      }
      return { ok: true as const }
    }),
```

- [ ] **Step 2: Type-check**

```bash
pnpm --filter @repo/trpc check-types
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/trpc/src/routers/file.ts
git commit -m "feat(trpc): add file.attachToPage and file.detachFromPage"
```

### Task 2.3: Add `type` to `page.update` input

**Files:**

- Modify: `packages/trpc/src/routers/page.ts` (or `packages/trpc/src/schemas/page.ts` if input is shared)

- [ ] **Step 1: Locate the `page.update` (or `update`) procedure input schema**

```bash
grep -n "update.*input\|updateInput\|pageUpdate" packages/trpc/src/routers/page.ts packages/trpc/src/schemas/*.ts 2>/dev/null
```

- [ ] **Step 2: Add `type` field**

In the input schema add an optional `type: z.nativeEnum(PageType).optional()` (import `PageType` from `@repo/db`).

If `data` is built explicitly inside the resolver, add `type: input.type` (when defined).

- [ ] **Step 3: Type-check**

```bash
pnpm --filter @repo/trpc check-types
```

- [ ] **Step 4: Commit**

```bash
git add packages/trpc
git commit -m "feat(trpc): allow page.update to set Page.type"
```

---

## Phase 3 — apps/yjs (Hocuspocus Server)

### Task 3.1: Scaffold the package

**Files:**

- Create: `apps/yjs/package.json`
- Create: `apps/yjs/tsconfig.json`
- Create: `apps/yjs/eslint.config.mjs`
- Create: `apps/yjs/README.md`
- Create: `apps/yjs/src/.gitkeep`

- [ ] **Step 1: Create `apps/yjs/package.json`**

```json
{
  "name": "@repo/yjs-server",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "main": "dist/index.js",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "lint": "eslint . --max-warnings 0",
    "check-types": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@hocuspocus/server": "^2.13.0",
    "@hocuspocus/transformer": "^2.13.0",
    "@repo/db": "workspace:*",
    "jose": "^5.9.0",
    "yjs": "^13.6.20"
  },
  "devDependencies": {
    "@repo/eslint-config": "workspace:*",
    "@repo/typescript-config": "workspace:*",
    "@types/node": "^22.19.1",
    "eslint": "^9.39.1",
    "tsx": "^4.20.0",
    "typescript": "^5.9.2"
  }
}
```

- [ ] **Step 2: Create `apps/yjs/tsconfig.json`**

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

- [ ] **Step 3: Create `apps/yjs/eslint.config.mjs`**

```js
import { config } from '@repo/eslint-config/base'

/** @type {import("eslint").Linter.Config[]} */
export default config
```

- [ ] **Step 4: Create `apps/yjs/README.md`**

```markdown
# @repo/yjs-server

Hocuspocus WebSocket server that powers real-time collaboration for AnyNote text and Excalidraw pages.

- Validates inbound JWTs against better-auth's JWKS endpoint.
- Verifies the user is a member of the page's workspace.
- Loads/saves `Y.Doc` state from `Page.contentYjs` (Bytes).
- For TEXT pages, also writes a denormalized Tiptap snapshot to `Page.content`.

## Scripts

- `pnpm dev` — watch mode
- `pnpm build` — compile to `dist/`
- `pnpm start` — run compiled server
- `pnpm lint`, `pnpm check-types`

## Env vars

- `YJS_PORT` — defaults to 1234
- `BETTER_AUTH_URL` — base URL of better-auth (used to fetch JWKS at startup)
- `BETTER_AUTH_JWT_AUDIENCE` — optional, validates `aud` claim
- `DATABASE_URL` — Postgres connection string (consumed via `@repo/db`)
```

- [ ] **Step 5: Install dependencies and ensure workspace resolves**

```bash
pnpm install
```

Expected: completes without errors; `apps/yjs/node_modules/` is created.

- [ ] **Step 6: Commit scaffolding**

```bash
git add apps/yjs
git commit -m "chore(yjs): scaffold apps/yjs package"
```

### Task 3.2: Implement env validation

**Files:**

- Create: `apps/yjs/src/env.ts`

- [ ] **Step 1: Write `env.ts`**

```ts
type Env = {
  port: number
  authBaseUrl: string
  jwksUrl: string
  jwtAudience: string | undefined
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required env var: ${name}`)
  }
  return value
}

export function loadEnv(): Env {
  const authBaseUrl = required('BETTER_AUTH_URL').replace(/\/$/, '')
  return {
    port: Number(process.env.YJS_PORT ?? 1234),
    authBaseUrl,
    jwksUrl: `${authBaseUrl}/api/auth/jwks`,
    jwtAudience: process.env.BETTER_AUTH_JWT_AUDIENCE,
  }
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm --filter @repo/yjs-server check-types
```

Expected: no errors.

### Task 3.3: Implement logger and persistence layer

**Files:**

- Create: `apps/yjs/src/logger.ts`
- Create: `apps/yjs/src/persistence.ts`

- [ ] **Step 1: Write `logger.ts`**

```ts
type Level = 'info' | 'warn' | 'error'

function emit(level: Level, msg: string, meta?: Record<string, unknown>) {
  const payload = { ts: new Date().toISOString(), level, msg, ...(meta ?? {}) }
  console[level === 'error' ? 'error' : 'log'](JSON.stringify(payload))
}

export const log = {
  info: (msg: string, meta?: Record<string, unknown>) => emit('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit('error', msg, meta),
}
```

- [ ] **Step 2: Write `persistence.ts`**

```ts
import { prisma, PageType } from '@repo/db'
import * as Y from 'yjs'
import { TiptapTransformer } from '@hocuspocus/transformer'

import { log } from './logger'

export async function loadPageDocument(pageId: string): Promise<Y.Doc> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { contentYjs: true },
  })
  const ydoc = new Y.Doc()
  if (page?.contentYjs) {
    Y.applyUpdate(ydoc, new Uint8Array(page.contentYjs))
  }
  return ydoc
}

export async function storePageDocument(args: {
  pageId: string
  document: Y.Doc
  pageType: PageType
}): Promise<void> {
  const { pageId, document, pageType } = args
  const update = Y.encodeStateAsUpdate(document)
  const buffer = Buffer.from(update)

  const data: { contentYjs: Buffer; content?: unknown } = { contentYjs: buffer }
  if (pageType !== PageType.EXCALIDRAW) {
    try {
      data.content = TiptapTransformer.fromYdoc(document, 'default')
    } catch (err) {
      log.warn('tiptap transformer failed; saving contentYjs only', {
        pageId,
        error: (err as Error).message,
      })
    }
  }

  await prisma.page.update({
    where: { id: pageId },
    data: data as { contentYjs: Buffer; content?: never },
  })
}
```

- [ ] **Step 3: Type-check**

```bash
pnpm --filter @repo/yjs-server check-types
```

Expected: no errors.

### Task 3.4: Implement JWT verification and access check

**Files:**

- Create: `apps/yjs/src/auth.ts`

- [ ] **Step 1: Write `auth.ts`**

```ts
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import { prisma, PageType } from '@repo/db'

import { log } from './logger'

let jwksFetcher: ReturnType<typeof createRemoteJWKSet> | null = null

export function initJwks(jwksUrl: string): void {
  jwksFetcher = createRemoteJWKSet(new URL(jwksUrl))
  log.info('JWKS fetcher initialized', { jwksUrl })
}

export async function verifyJwt(
  token: string,
  audience: string | undefined,
): Promise<{ userId: string }> {
  if (!jwksFetcher) throw new Error('JWKS not initialized; call initJwks first')
  const { payload } = await jwtVerify(token, jwksFetcher, {
    audience,
  })
  const userId = pickUserId(payload)
  if (!userId) throw new Error('JWT missing subject (userId)')
  return { userId }
}

function pickUserId(payload: JWTPayload): string | undefined {
  if (typeof payload.sub === 'string') return payload.sub
  if (typeof (payload as { userId?: unknown }).userId === 'string') {
    return (payload as { userId: string }).userId
  }
  return undefined
}

export async function canAccessPage(
  userId: string,
  pageId: string,
): Promise<{ pageType: PageType } | null> {
  const page = await prisma.page.findFirst({
    where: {
      id: pageId,
      deletedAt: null,
      workspace: { members: { some: { userId } } },
    },
    select: { type: true },
  })
  return page ? { pageType: page.type } : null
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm --filter @repo/yjs-server check-types
```

Expected: no errors.

### Task 3.5: Wire the Hocuspocus server

**Files:**

- Create: `apps/yjs/src/index.ts`

- [ ] **Step 1: Write `index.ts`**

```ts
import { Server } from '@hocuspocus/server'

import { loadEnv } from './env'
import { initJwks, verifyJwt, canAccessPage } from './auth'
import { loadPageDocument, storePageDocument } from './persistence'
import { log } from './logger'
import type { PageType } from '@repo/db'

type AuthContext = { userId: string; pageType: PageType }

const env = loadEnv()
initJwks(env.jwksUrl)

const server = new Server({
  port: env.port,

  async onAuthenticate({ token, documentName }) {
    if (!token) throw new Error('Missing auth token')
    const { userId } = await verifyJwt(token, env.jwtAudience)
    const access = await canAccessPage(userId, documentName)
    if (!access) {
      log.warn('page access denied', { userId, pageId: documentName })
      throw new Error('Forbidden')
    }
    log.info('authenticated', { userId, pageId: documentName, pageType: access.pageType })
    const ctx: AuthContext = { userId, pageType: access.pageType }
    return ctx
  },

  async onLoadDocument({ documentName }) {
    return loadPageDocument(documentName)
  },

  async onStoreDocument({ documentName, document, context }) {
    const { pageType } = context as AuthContext
    await storePageDocument({ pageId: documentName, document, pageType })
  },
})

server.listen()
log.info('yjs server listening', { port: env.port })
```

- [ ] **Step 2: Type-check**

```bash
pnpm --filter @repo/yjs-server check-types
```

Expected: no errors.

- [ ] **Step 3: Lint**

```bash
pnpm --filter @repo/yjs-server lint
```

Expected: no errors.

- [ ] **Step 4: Build**

```bash
pnpm --filter @repo/yjs-server build
```

Expected: `apps/yjs/dist/index.js` created.

- [ ] **Step 5: Commit**

```bash
git add apps/yjs
git commit -m "feat(yjs): hocuspocus server with JWT auth and prisma persistence"
```

---

## Phase 4 — JWT Issuer in apps/web

### Task 4.1: Add `/api/yjs/token` route

**Files:**

- Create: `apps/web/src/app/api/yjs/token/route.ts`

- [ ] **Step 1: Confirm better-auth's token endpoint exists**

```bash
grep -rn "getToken\|/api/auth/token\|jwt(" packages/auth/src
```

Expected: see the `jwt()` plugin in `auth.ts`. The plugin exposes both `auth.api.getToken({ headers })` and the `/api/auth/token` HTTP endpoint.

- [ ] **Step 2: Write the route**

```ts
import { NextResponse, type NextRequest } from 'next/server'

import { auth } from '@repo/auth'

import { getSession } from '@/lib/get-session'

export const runtime = 'nodejs'

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // better-auth's jwt plugin issues a JWT signed with the active JWKS key.
  // The exact return shape is { token: string } as of better-auth 1.x.
  const result = await auth.api.getToken({ headers: req.headers })
  if (!result || !result.token) {
    return NextResponse.json({ error: 'Token issuance failed' }, { status: 500 })
  }
  return NextResponse.json({ token: result.token })
}
```

- [ ] **Step 3: If `auth.api.getToken` does not exist on the installed version, fall back to forwarding to the HTTP endpoint**

```bash
node -e "const { auth } = require('./packages/auth/dist/auth.js'); console.log(Object.keys(auth.api).filter(k => k.toLowerCase().includes('token')))"
```

If the call surfaces a different name (e.g. `signJwt`, `token`), use it. If only the HTTP endpoint exists, replace the route body with:

```ts
const upstream = await fetch(new URL('/api/auth/token', req.url), {
  headers: req.headers,
  method: 'GET',
})
if (!upstream.ok) {
  return NextResponse.json({ error: 'Token issuance failed' }, { status: 500 })
}
const data = (await upstream.json()) as { token: string }
return NextResponse.json({ token: data.token })
```

- [ ] **Step 4: Manual verification**

```bash
docker compose up -d
pnpm exec turbo run dev --filter=web
# In another shell: sign in, then
curl -i -X POST http://localhost:3000/api/yjs/token -H "Cookie: $(cat .session-cookie)"
```

Expected: HTTP 200 with `{ "token": "<jwt>" }`. Decode at jwt.io to confirm `sub` claim equals the user id.

- [ ] **Step 5: Type-check + lint**

```bash
pnpm --filter web check-types
pnpm --filter web lint
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/api/yjs/token
git commit -m "feat(web): add /api/yjs/token JWT issuer for yjs server"
```

---

## Phase 5 — packages/editor (Tiptap)

### Task 5.1: Scaffold the package

**Files:**

- Create: `packages/editor/package.json`
- Create: `packages/editor/tsconfig.json`
- Create: `packages/editor/eslint.config.mjs`
- Create: `packages/editor/README.md`
- Create: `packages/editor/src/index.ts` (empty barrel for now)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@repo/editor",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "import": "./src/index.ts",
      "types": "./src/index.ts"
    },
    "./styles": {
      "import": "./src/styles/content.css"
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
    "@hocuspocus/provider": "^2.13.0",
    "@mui/icons-material": "^6.1.7",
    "@mui/material": "^6.1.7",
    "@tiptap-codeless/extension-file-upload": "^0.1.0",
    "@tiptap/core": "^3.0.0",
    "@tiptap/extension-code-block-lowlight": "^3.0.0",
    "@tiptap/extension-collaboration": "^3.0.0",
    "@tiptap/extension-collaboration-cursor": "^3.0.0",
    "@tiptap/extension-drag-handle-react": "^3.0.0",
    "@tiptap/extension-image": "^3.0.0",
    "@tiptap/extension-link": "^3.0.0",
    "@tiptap/extension-placeholder": "^3.0.0",
    "@tiptap/extension-table": "^3.0.0",
    "@tiptap/extension-table-cell": "^3.0.0",
    "@tiptap/extension-table-header": "^3.0.0",
    "@tiptap/extension-table-row": "^3.0.0",
    "@tiptap/extension-task-item": "^3.0.0",
    "@tiptap/extension-task-list": "^3.0.0",
    "@tiptap/extension-typography": "^3.0.0",
    "@tiptap/pm": "^3.0.0",
    "@tiptap/react": "^3.0.0",
    "@tiptap/starter-kit": "^3.0.0",
    "@tiptap/suggestion": "^3.0.0",
    "lowlight": "^3.1.0",
    "react": "^19.2.0",
    "tippy.js": "^6.3.7",
    "yjs": "^13.6.20"
  },
  "devDependencies": {
    "@repo/eslint-config": "workspace:*",
    "@repo/typescript-config": "workspace:*",
    "@types/react": "^19.2.2",
    "eslint": "^9.39.1",
    "typescript": "^5.9.2"
  }
}
```

> **Note:** If a specific Tiptap v3 release of one of these extensions does not exist on npm, fall back to the latest published v3 (or v3-rc) tag. If `@tiptap-codeless/extension-file-upload` does not yet exist on the registry under that name, search for the actual package via `npm search tiptap file upload` and substitute. Document any substitution in the commit body.

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "@repo/typescript-config/react-library.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "types": ["react", "react-dom"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `eslint.config.mjs`**

```js
import { config } from '@repo/eslint-config/react-internal'

/** @type {import("eslint").Linter.Config} */
export default config
```

- [ ] **Step 4: Create empty `src/index.ts`**

```ts
export {}
```

- [ ] **Step 5: Install dependencies**

```bash
pnpm install
```

If pnpm reports unresolvable versions for any Tiptap v3 package, downgrade or substitute as noted in Step 1, then re-run.

- [ ] **Step 6: Add `@repo/editor` to `apps/web/package.json` dependencies and to `apps/web/next.config.js` `transpilePackages`**

In `apps/web/package.json`, add to `dependencies`:

```json
"@repo/editor": "workspace:*",
```

In `apps/web/next.config.js`, extend `transpilePackages`:

```js
transpilePackages: ['@repo/ui', '@repo/trpc', '@repo/auth', '@repo/editor', '@repo/excalidraw'],
```

- [ ] **Step 7: Commit**

```bash
git add packages/editor apps/web/package.json apps/web/next.config.js pnpm-lock.yaml
git commit -m "chore(editor): scaffold packages/editor with tiptap dependencies"
```

### Task 5.2: Define public types

**Files:**

- Create: `packages/editor/src/types.ts`

- [ ] **Step 1: Write `types.ts`**

```ts
export type UploadedFile = {
  id: string
  src: string
}

export type UploadHandler = (args: { blob: Blob; filename: string }) => Promise<UploadedFile>

export type AnyNoteEditorUser = {
  id: string
  name: string
  color: string
}

export type AnyNoteEditorProps = {
  pageId: string
  workspaceId: string
  yjsUrl: string
  yjsToken: () => Promise<string>
  user: AnyNoteEditorUser
  uploadHandler: UploadHandler
  editable?: boolean
  className?: string
  placeholder?: string
}

export type SlashCommandItem = {
  id: string
  label: string
  description?: string
  keywords?: string[]
  run: (args: {
    editor: import('@tiptap/core').Editor
    range: { from: number; to: number }
  }) => void
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm --filter @repo/editor check-types
```

### Task 5.3: Build extensions module

**Files:**

- Create: `packages/editor/src/extensions/placeholder.ts`
- Create: `packages/editor/src/extensions/file-upload.ts`
- Create: `packages/editor/src/extensions/collaboration.ts`
- Create: `packages/editor/src/extensions/slash-menu.ts`
- Create: `packages/editor/src/extensions/index.ts`

- [ ] **Step 1: Write `placeholder.ts`**

```ts
import Placeholder from '@tiptap/extension-placeholder'

export const buildPlaceholder = (text: string) =>
  Placeholder.configure({
    placeholder: text,
    showOnlyWhenEditable: true,
    emptyEditorClass: 'is-editor-empty',
  })
```

- [ ] **Step 2: Write `file-upload.ts`**

```ts
import { FileUpload } from '@tiptap-codeless/extension-file-upload'

import type { UploadHandler } from '../types'

export const buildFileUpload = (uploadHandler: UploadHandler) =>
  FileUpload.configure({
    storageMode: 'custom',
    uploadHandler: async (file: File) => {
      const result = await uploadHandler({ blob: file, filename: file.name })
      return { src: result.src, id: result.id }
    },
  })
```

> **Note:** The exact configuration key (`uploadHandler` vs `onUpload` vs `upload`) depends on the installed extension version. Verify against the package's README at install time and adjust.

- [ ] **Step 3: Write `collaboration.ts`**

```ts
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import type { HocuspocusProvider } from '@hocuspocus/provider'
import type * as Y from 'yjs'

import type { AnyNoteEditorUser } from '../types'

export const buildCollaboration = (args: {
  ydoc: Y.Doc
  provider: HocuspocusProvider
  user: AnyNoteEditorUser
}) => [
  Collaboration.configure({ document: args.ydoc, field: 'default' }),
  CollaborationCursor.configure({
    provider: args.provider,
    user: { name: args.user.name, color: args.user.color },
  }),
]
```

- [ ] **Step 4: Write `slash-menu.ts`** (custom Suggestion-based extension)

```ts
import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import type { SlashCommandItem } from '../types'

export type SlashMenuOptions = {
  items: (query: string) => SlashCommandItem[]
  render: () => {
    onStart: (props: import('@tiptap/suggestion').SuggestionProps<SlashCommandItem>) => void
    onUpdate: (props: import('@tiptap/suggestion').SuggestionProps<SlashCommandItem>) => void
    onKeyDown: (props: import('@tiptap/suggestion').SuggestionKeyDownProps) => boolean
    onExit: () => void
  }
}

export const SlashMenu = Extension.create<SlashMenuOptions>({
  name: 'slashMenu',
  addOptions() {
    return {
      items: () => [],
      render: () => ({
        onStart: () => {},
        onUpdate: () => {},
        onKeyDown: () => false,
        onExit: () => {},
      }),
    }
  },
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashCommandItem>({
        editor: this.editor,
        char: '/',
        startOfLine: false,
        items: ({ query }) => this.options.items(query),
        command: ({ editor, range, props }) => {
          props.run({ editor, range })
        },
        render: this.options.render,
      }),
    ]
  },
})
```

- [ ] **Step 5: Write `extensions/index.ts` — `buildExtensions(opts)`**

```ts
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Typography from '@tiptap/extension-typography'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'
import type { HocuspocusProvider } from '@hocuspocus/provider'
import type * as Y from 'yjs'

import { buildPlaceholder } from './placeholder'
import { buildFileUpload } from './file-upload'
import { buildCollaboration } from './collaboration'
import { SlashMenu } from './slash-menu'
import type { AnyNoteEditorUser, SlashCommandItem, UploadHandler } from '../types'

const lowlight = createLowlight(common)

export const buildExtensions = (opts: {
  ydoc: Y.Doc
  provider: HocuspocusProvider
  user: AnyNoteEditorUser
  uploadHandler: UploadHandler
  placeholder: string
  slashItems: (query: string) => SlashCommandItem[]
  slashRender: ReturnType<Parameters<typeof SlashMenu.configure>[0]['render']>
}) => [
  StarterKit.configure({ history: false }),
  buildPlaceholder(opts.placeholder),
  Link.configure({ openOnClick: false }),
  Image,
  Typography,
  TaskList,
  TaskItem.configure({ nested: true }),
  Table.configure({ resizable: true }),
  TableRow,
  TableHeader,
  TableCell,
  CodeBlockLowlight.configure({ lowlight }),
  ...buildCollaboration({ ydoc: opts.ydoc, provider: opts.provider, user: opts.user }),
  buildFileUpload(opts.uploadHandler),
  SlashMenu.configure({
    items: opts.slashItems,
    render: () => opts.slashRender,
  }),
]
```

- [ ] **Step 6: Type-check**

```bash
pnpm --filter @repo/editor check-types
```

Fix any type mismatches against the actual installed extension APIs.

### Task 5.4: Build the slash-menu popover (MUI)

**Files:**

- Create: `packages/editor/src/components/slash-menu-popover.tsx`

- [ ] **Step 1: Write the popover component**

```tsx
'use client'

import { useEffect, useImperativeHandle, useState, forwardRef } from 'react'
import { List, ListItemButton, ListItemText, Paper } from '@mui/material'

import type { SlashCommandItem } from '../types'

export type SlashMenuPopoverHandle = {
  onKeyDown: (event: KeyboardEvent) => boolean
}

type Props = {
  items: SlashCommandItem[]
  command: (item: SlashCommandItem) => void
  clientRect?: () => DOMRect | null
}

export const SlashMenuPopover = forwardRef<SlashMenuPopoverHandle, Props>(function SlashMenuPopover(
  { items, command, clientRect },
  ref,
) {
  const [active, setActive] = useState(0)

  useEffect(() => {
    setActive(0)
  }, [items])

  useImperativeHandle(ref, () => ({
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        setActive((i) => (i + 1) % Math.max(items.length, 1))
        return true
      }
      if (event.key === 'ArrowUp') {
        setActive((i) => (i - 1 + items.length) % Math.max(items.length, 1))
        return true
      }
      if (event.key === 'Enter' && items[active]) {
        command(items[active])
        return true
      }
      return false
    },
  }))

  if (items.length === 0) return null
  const rect = clientRect?.()
  const style: React.CSSProperties = rect
    ? { position: 'fixed', top: rect.bottom + 4, left: rect.left, zIndex: 1300 }
    : { display: 'none' }

  return (
    <Paper elevation={6} style={style} sx={{ width: 280, py: 0.5 }}>
      <List dense>
        {items.map((item, idx) => (
          <ListItemButton key={item.id} selected={idx === active} onClick={() => command(item)}>
            <ListItemText primary={item.label} secondary={item.description} />
          </ListItemButton>
        ))}
      </List>
    </Paper>
  )
})
```

### Task 5.5: Build the floating toolbar (BubbleMenu) and drag handle

**Files:**

- Create: `packages/editor/src/components/floating-toolbar.tsx`
- Create: `packages/editor/src/components/drag-handle.tsx`

- [ ] **Step 1: Write `floating-toolbar.tsx`**

```tsx
'use client'

import { BubbleMenu } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { IconButton, Stack, Paper } from '@mui/material'
import FormatBoldIcon from '@mui/icons-material/FormatBold'
import FormatItalicIcon from '@mui/icons-material/FormatItalic'
import StrikethroughSIcon from '@mui/icons-material/StrikethroughS'
import CodeIcon from '@mui/icons-material/Code'
import LinkIcon from '@mui/icons-material/Link'

type Props = { editor: Editor }

export function FloatingToolbar({ editor }: Props) {
  return (
    <BubbleMenu editor={editor} tippyOptions={{ duration: 100 }}>
      <Paper elevation={6} sx={{ display: 'inline-flex', borderRadius: 1, px: 0.5 }}>
        <Stack direction="row">
          <IconButton
            size="small"
            color={editor.isActive('bold') ? 'primary' : 'default'}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <FormatBoldIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            color={editor.isActive('italic') ? 'primary' : 'default'}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <FormatItalicIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            color={editor.isActive('strike') ? 'primary' : 'default'}
            onClick={() => editor.chain().focus().toggleStrike().run()}
          >
            <StrikethroughSIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            color={editor.isActive('code') ? 'primary' : 'default'}
            onClick={() => editor.chain().focus().toggleCode().run()}
          >
            <CodeIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            color={editor.isActive('link') ? 'primary' : 'default'}
            onClick={() => {
              const url = window.prompt('URL')
              if (url) editor.chain().focus().setLink({ href: url }).run()
            }}
          >
            <LinkIcon fontSize="small" />
          </IconButton>
        </Stack>
      </Paper>
    </BubbleMenu>
  )
}
```

- [ ] **Step 2: Write `drag-handle.tsx` (thin wrapper around `DragHandle` from `@tiptap/extension-drag-handle-react`)**

```tsx
'use client'

import { DragHandle } from '@tiptap/extension-drag-handle-react'
import type { Editor } from '@tiptap/core'
import { Box } from '@mui/material'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'

type Props = { editor: Editor }

export function EditorDragHandle({ editor }: Props) {
  return (
    <DragHandle editor={editor}>
      <Box
        sx={{
          color: 'text.disabled',
          cursor: 'grab',
          display: 'inline-flex',
          alignItems: 'center',
          px: 0.5,
        }}
      >
        <DragIndicatorIcon fontSize="small" />
      </Box>
    </DragHandle>
  )
}
```

- [ ] **Step 3: Type-check**

```bash
pnpm --filter @repo/editor check-types
```

### Task 5.6: Default slash-menu items registry

**Files:**

- Create: `packages/editor/src/slash-items.ts`

- [ ] **Step 1: Write the registry**

```ts
import type { SlashCommandItem } from './types'

const ITEMS: SlashCommandItem[] = [
  {
    id: 'h1',
    label: 'Heading 1',
    keywords: ['h1', 'title'],
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run(),
  },
  {
    id: 'h2',
    label: 'Heading 2',
    keywords: ['h2'],
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run(),
  },
  {
    id: 'h3',
    label: 'Heading 3',
    keywords: ['h3'],
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run(),
  },
  {
    id: 'paragraph',
    label: 'Paragraph',
    keywords: ['text', 'p'],
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode('paragraph').run(),
  },
  {
    id: 'bullet',
    label: 'Bullet list',
    keywords: ['ul', 'list'],
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    id: 'ordered',
    label: 'Numbered list',
    keywords: ['ol'],
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    id: 'task',
    label: 'Task list',
    keywords: ['todo', 'checkbox'],
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    id: 'quote',
    label: 'Quote',
    keywords: ['blockquote'],
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
  {
    id: 'code',
    label: 'Code block',
    keywords: ['code'],
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    id: 'divider',
    label: 'Divider',
    keywords: ['hr', 'separator'],
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    id: 'table',
    label: 'Table',
    keywords: ['grid'],
    run: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
]

export const defaultSlashItems = (query: string): SlashCommandItem[] => {
  const q = query.trim().toLowerCase()
  if (!q) return ITEMS
  return ITEMS.filter(
    (it) =>
      it.label.toLowerCase().includes(q) ||
      (it.keywords ?? []).some((k) => k.toLowerCase().includes(q)),
  )
}
```

### Task 5.7: Build the AnyNoteEditor component

**Files:**

- Create: `packages/editor/src/anynote-editor.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor, ReactRenderer } from '@tiptap/react'
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { Box } from '@mui/material'
import tippy, { type Instance, type Props as TippyProps } from 'tippy.js'

import { buildExtensions } from './extensions'
import { FloatingToolbar } from './components/floating-toolbar'
import { EditorDragHandle } from './components/drag-handle'
import { SlashMenuPopover, type SlashMenuPopoverHandle } from './components/slash-menu-popover'
import { defaultSlashItems } from './slash-items'
import type { AnyNoteEditorProps, SlashCommandItem } from './types'

export function AnyNoteEditor(props: AnyNoteEditorProps) {
  const { pageId, yjsUrl, yjsToken, user, uploadHandler, editable = true } = props
  const placeholder = props.placeholder ?? "Введите '/' для команд"

  const ydoc = useState(() => new Y.Doc())[0]
  const provider = useState(
    () =>
      new HocuspocusProvider({
        url: yjsUrl,
        name: pageId,
        document: ydoc,
        token: yjsToken,
      }),
  )[0]

  const slashRendererRef = useRef<{
    component: ReactRenderer<SlashMenuPopoverHandle> | null
    popup: Instance<TippyProps>[] | null
  }>({ component: null, popup: null })

  const slashRender = useMemo(
    () => ({
      onStart: (suggestionProps: any) => {
        const component = new ReactRenderer<SlashMenuPopoverHandle>(SlashMenuPopover, {
          props: {
            items: suggestionProps.items as SlashCommandItem[],
            command: (item: SlashCommandItem) => suggestionProps.command(item),
            clientRect: suggestionProps.clientRect,
          },
          editor: suggestionProps.editor,
        })
        slashRendererRef.current.component = component

        slashRendererRef.current.popup = tippy('body', {
          getReferenceClientRect: suggestionProps.clientRect,
          appendTo: () => document.body,
          content: component.element,
          showOnCreate: true,
          interactive: true,
          trigger: 'manual',
          placement: 'bottom-start',
        })
      },
      onUpdate: (suggestionProps: any) => {
        slashRendererRef.current.component?.updateProps({
          items: suggestionProps.items as SlashCommandItem[],
          command: (item: SlashCommandItem) => suggestionProps.command(item),
          clientRect: suggestionProps.clientRect,
        })
        slashRendererRef.current.popup?.[0]?.setProps({
          getReferenceClientRect: suggestionProps.clientRect,
        })
      },
      onKeyDown: (suggestionProps: any) => {
        if (suggestionProps.event.key === 'Escape') {
          slashRendererRef.current.popup?.[0]?.hide()
          return true
        }
        return slashRendererRef.current.component?.ref?.onKeyDown(suggestionProps.event) ?? false
      },
      onExit: () => {
        slashRendererRef.current.popup?.[0]?.destroy()
        slashRendererRef.current.component?.destroy()
        slashRendererRef.current.component = null
        slashRendererRef.current.popup = null
      },
    }),
    [],
  )

  const editor = useEditor(
    {
      editable,
      extensions: buildExtensions({
        ydoc,
        provider,
        user,
        uploadHandler,
        placeholder,
        slashItems: defaultSlashItems,
        slashRender,
      }),
      immediatelyRender: false,
    },
    [],
  )

  useEffect(() => {
    return () => {
      provider.destroy()
      ydoc.destroy()
    }
  }, [provider, ydoc])

  return (
    <Box className={`anynote-editor ${props.className ?? ''}`} sx={{ height: '100%' }}>
      {editor && <EditorDragHandle editor={editor} />}
      {editor && <FloatingToolbar editor={editor} />}
      <EditorContent editor={editor} />
    </Box>
  )
}
```

> **Note:** `tippy.js` is included as a direct dependency for the slash-menu popup (Tiptap suggestion examples use it). It's also a transitive dep of the drag-handle React adapter.

- [ ] **Step 2: Type-check** (expect a few `any`s in suggestion callbacks — acceptable to keep narrow `any` until the suggestion typings stabilise)

```bash
pnpm --filter @repo/editor check-types
```

### Task 5.8: Editor styles + theme bridge

**Files:**

- Create: `packages/editor/src/styles/content.css`

- [ ] **Step 1: Write `content.css`**

```css
.anynote-editor {
  font-family: var(--editor-font-family, inherit);
  color: var(--editor-text, currentColor);
}

.anynote-editor .ProseMirror {
  outline: none;
  min-height: 200px;
  padding: 16px 24px;
  line-height: 1.6;
}

.anynote-editor .ProseMirror p.is-editor-empty:first-child::before {
  color: var(--editor-text-muted, rgba(0, 0, 0, 0.4));
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
}

.anynote-editor h1 {
  font-size: 1.875rem;
  font-weight: 700;
  margin: 1.25rem 0 0.5rem;
}
.anynote-editor h2 {
  font-size: 1.5rem;
  font-weight: 600;
  margin: 1rem 0 0.5rem;
}
.anynote-editor h3 {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 0.75rem 0 0.5rem;
}
.anynote-editor p,
.anynote-editor ul,
.anynote-editor ol {
  margin: 0.25rem 0;
}
.anynote-editor blockquote {
  border-left: 3px solid var(--editor-divider, rgba(0, 0, 0, 0.12));
  margin: 0.5rem 0;
  padding-left: 12px;
  color: var(--editor-text-muted, rgba(0, 0, 0, 0.6));
}
.anynote-editor pre {
  background: var(--editor-code-bg, rgba(0, 0, 0, 0.04));
  border-radius: 6px;
  padding: 12px;
  overflow-x: auto;
}
.anynote-editor code {
  background: var(--editor-code-bg, rgba(0, 0, 0, 0.04));
  border-radius: 4px;
  padding: 0 4px;
}
.anynote-editor hr {
  border: none;
  border-top: 1px solid var(--editor-divider, rgba(0, 0, 0, 0.12));
  margin: 1rem 0;
}
.anynote-editor table {
  border-collapse: collapse;
  margin: 0.5rem 0;
}
.anynote-editor th,
.anynote-editor td {
  border: 1px solid var(--editor-divider, rgba(0, 0, 0, 0.12));
  padding: 6px 8px;
}
.anynote-editor .collaboration-cursor__caret {
  border-left: 2px solid;
  border-right: 2px solid;
  margin-left: -1px;
  margin-right: -1px;
  pointer-events: none;
  position: relative;
  word-break: normal;
}
.anynote-editor .collaboration-cursor__label {
  border-radius: 3px 3px 3px 0;
  color: white;
  font-size: 12px;
  font-weight: 600;
  left: -1px;
  line-height: normal;
  padding: 0.1rem 0.3rem;
  position: absolute;
  top: -1.4em;
  user-select: none;
  white-space: nowrap;
}
```

### Task 5.9: Theme bridge + barrel + commit

**Files:**

- Create: `packages/editor/src/theme-bridge.tsx`
- Modify: `packages/editor/src/index.ts`

- [ ] **Step 1: Write `theme-bridge.tsx`**

```tsx
'use client'

import { GlobalStyles, useTheme } from '@mui/material'

export function EditorThemeBridge() {
  const theme = useTheme()
  return (
    <GlobalStyles
      styles={{
        ':root': {
          '--editor-text': theme.palette.text.primary,
          '--editor-text-muted': theme.palette.text.secondary,
          '--editor-divider': theme.palette.divider,
          '--editor-code-bg': theme.palette.action.hover,
          '--editor-font-family': theme.typography.fontFamily,
        },
      }}
    />
  )
}
```

- [ ] **Step 2: Write `src/index.ts` (barrel)**

```ts
export { AnyNoteEditor } from './anynote-editor'
export { EditorThemeBridge } from './theme-bridge'
export { defaultSlashItems } from './slash-items'
export type {
  AnyNoteEditorProps,
  AnyNoteEditorUser,
  UploadHandler,
  UploadedFile,
  SlashCommandItem,
} from './types'
```

- [ ] **Step 3: Lint and check-types**

```bash
pnpm --filter @repo/editor lint
pnpm --filter @repo/editor check-types
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add packages/editor
git commit -m "feat(editor): tiptap collaborative editor with slash menu, drag handle, file upload"
```

---

## Phase 6 — packages/excalidraw

### Task 6.1: Scaffold the package

**Files:**

- Create: `packages/excalidraw/package.json`
- Create: `packages/excalidraw/tsconfig.json`
- Create: `packages/excalidraw/eslint.config.mjs`
- Create: `packages/excalidraw/README.md`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@repo/excalidraw",
  "version": "0.1.0",
  "private": true,
  "type": "module",
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
    "@excalidraw/excalidraw": "^0.18.0",
    "@hocuspocus/provider": "^2.13.0",
    "@mui/material": "^6.1.7",
    "@timephy/y-excalidraw": "^0.4.0",
    "react": "^19.2.0",
    "yjs": "^13.6.20"
  },
  "peerDependencies": {
    "next": "^16.0.0"
  },
  "devDependencies": {
    "@repo/eslint-config": "workspace:*",
    "@repo/typescript-config": "workspace:*",
    "@types/react": "^19.2.2",
    "eslint": "^9.39.1",
    "next": "^16.0.0",
    "typescript": "^5.9.2"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`** (same as editor's)

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "@repo/typescript-config/react-library.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "types": ["react", "react-dom"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `eslint.config.mjs`**

```js
import { config } from '@repo/eslint-config/react-internal'

/** @type {import("eslint").Linter.Config} */
export default config
```

- [ ] **Step 4: Create `README.md`**

```markdown
# @repo/excalidraw

Excalidraw canvas with Yjs-backed real-time collaboration via `@timephy/y-excalidraw`.

## Public API

`<Board pageId workspaceId yjsUrl yjsToken uploadHandler />`

## Notes

- Renders only on the client (`dynamic(ssr:false)` in the consumer).
- Uses `useState(initializer)` for `Y.Doc`, provider, and binding to keep stable refs.
- File uploads go through the consumer-provided `uploadHandler` and are attached to the page via the consumer's tRPC client (passed in via the same handler).
```

- [ ] **Step 5: Add `@repo/excalidraw` to `apps/web/package.json` dependencies**

```json
"@repo/excalidraw": "workspace:*",
```

(`transpilePackages` was updated in Task 5.1 already.)

- [ ] **Step 6: Install**

```bash
pnpm install
```

If `@timephy/y-excalidraw` reports a version mismatch with React 19 or Excalidraw, pin to whichever version its README claims compatibility with and document the substitution.

- [ ] **Step 7: Commit scaffolding**

```bash
git add packages/excalidraw apps/web/package.json pnpm-lock.yaml
git commit -m "chore(excalidraw): scaffold packages/excalidraw"
```

### Task 6.2: Define types

**Files:**

- Create: `packages/excalidraw/src/types.ts`

- [ ] **Step 1: Write `types.ts`**

```ts
export type UploadedFile = { id: string; src: string }

export type UploadHandler = (args: { blob: Blob; filename: string }) => Promise<UploadedFile>

export type BoardProps = {
  pageId: string
  workspaceId: string
  yjsUrl: string
  yjsToken: () => Promise<string>
  uploadHandler: UploadHandler
  editable?: boolean
  className?: string
}
```

### Task 6.3: Yjs binding hook

**Files:**

- Create: `packages/excalidraw/src/use-excalidraw-yjs.ts`

- [ ] **Step 1: Write the hook**

```ts
'use client'

import { useEffect, useState } from 'react'
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { ExcalidrawBinding } from '@timephy/y-excalidraw'

export function useExcalidrawYjs(args: {
  pageId: string
  yjsUrl: string
  yjsToken: () => Promise<string>
}) {
  const ydoc = useState(() => new Y.Doc())[0]
  const provider = useState(
    () =>
      new HocuspocusProvider({
        url: args.yjsUrl,
        name: args.pageId,
        document: ydoc,
        token: args.yjsToken,
      }),
  )[0]
  const binding = useState(() => new ExcalidrawBinding(ydoc, provider.awareness))[0]

  useEffect(() => {
    return () => {
      binding.destroy?.()
      provider.destroy()
      ydoc.destroy()
    }
  }, [binding, provider, ydoc])

  return { ydoc, provider, binding }
}
```

> **Note:** Verify the `ExcalidrawBinding` constructor signature matches `@timephy/y-excalidraw`'s README. Some forks use `new ExcalidrawBinding({ ydoc, awareness })` or expose `.attach(api)` instead of accepting awareness in the constructor. Adjust to whatever the package exposes.

### Task 6.4: Files handler

**Files:**

- Create: `packages/excalidraw/src/files-handler.ts`

The handler relies entirely on the consumer-provided `UploadHandler` for both upload and page-attachment (the consumer wires that up in its closure — see Task 7.1).

- [ ] **Step 1: Write `files-handler.ts`**

```ts
import type { UploadHandler, UploadedFile } from './types'

type ExcalidrawFile = {
  id: string
  dataURL: string
  mimeType: string
  created?: number
}

export class FilesHandler {
  private uploaded = new Map<string, UploadedFile>() // excalidrawFileId -> uploaded
  constructor(private readonly uploadHandler: UploadHandler) {}

  async syncFiles(files: Record<string, ExcalidrawFile>): Promise<void> {
    const tasks: Promise<void>[] = []
    for (const [id, file] of Object.entries(files)) {
      if (this.uploaded.has(id)) continue
      tasks.push(this.uploadOne(id, file))
    }
    await Promise.allSettled(tasks)
  }

  private async uploadOne(excalidrawId: string, file: ExcalidrawFile): Promise<void> {
    const blob = await dataUrlToBlob(file.dataURL)
    const filename = `excalidraw-${excalidrawId}.${extFromMime(file.mimeType)}`
    const result = await this.uploadHandler({ blob, filename })
    this.uploaded.set(excalidrawId, result)
  }
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl)
  return res.blob()
}

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
  }
  return map[mime] ?? 'bin'
}
```

### Task 6.5: Board (inner + outer)

**Files:**

- Create: `packages/excalidraw/src/board-inner.tsx`
- Create: `packages/excalidraw/src/board.tsx`

- [ ] **Step 1: Write `board-inner.tsx`**

```tsx
'use client'

import { useCallback, useMemo, useRef } from 'react'
import { Excalidraw, type ExcalidrawImperativeAPI } from '@excalidraw/excalidraw'
import { Box } from '@mui/material'

import { useExcalidrawYjs } from './use-excalidraw-yjs'
import { FilesHandler } from './files-handler'
import type { BoardProps } from './types'

export function BoardInner(props: BoardProps) {
  const { pageId, yjsUrl, yjsToken, uploadHandler, editable = true } = props
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const { binding } = useExcalidrawYjs({ pageId, yjsUrl, yjsToken })
  const files = useMemo(() => new FilesHandler(uploadHandler), [uploadHandler])

  const onChange = useCallback(
    (_elements: unknown, _appState: unknown, fileMap: Record<string, never>) => {
      void files.syncFiles(fileMap as never)
    },
    [files],
  )

  const onMount = useCallback(
    (api: ExcalidrawImperativeAPI) => {
      apiRef.current = api
      // Some forks expose binding.attach(api); call only if present
      ;(binding as unknown as { attach?: (a: ExcalidrawImperativeAPI) => void }).attach?.(api)
    },
    [binding],
  )

  return (
    <Box
      className={props.className}
      sx={{ width: '100%', height: '100%', minHeight: 0, position: 'relative' }}
    >
      <Excalidraw excalidrawAPI={onMount} viewModeEnabled={!editable} onChange={onChange} />
    </Box>
  )
}
```

- [ ] **Step 2: Write `board.tsx`** (dynamic wrapper)

```tsx
'use client'

import dynamic from 'next/dynamic'

import type { BoardProps } from './types'

const BoardInner = dynamic(() => import('./board-inner').then((m) => m.BoardInner), {
  ssr: false,
})

export function Board(props: BoardProps) {
  return <BoardInner {...props} />
}
```

### Task 6.6: Barrel + verification

**Files:**

- Create: `packages/excalidraw/src/index.ts`

- [ ] **Step 1: Write barrel**

```ts
export { Board } from './board'
export type { BoardProps, UploadHandler, UploadedFile } from './types'
```

- [ ] **Step 2: Lint + type-check**

```bash
pnpm --filter @repo/excalidraw lint
pnpm --filter @repo/excalidraw check-types
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/excalidraw
git commit -m "feat(excalidraw): collaborative canvas with yjs binding and file upload"
```

---

## Phase 7 — apps/web Integration

### Task 7.1: Add yjs config and upload handler helpers

**Files:**

- Create: `apps/web/src/lib/yjs-config.ts`
- Create: `apps/web/src/lib/upload-handler.ts`

- [ ] **Step 1: Write `yjs-config.ts`**

```ts
'use client'

export const yjsUrl = process.env.NEXT_PUBLIC_YJS_URL ?? 'ws://localhost:1234'

export async function fetchYjsToken(): Promise<string> {
  const res = await fetch('/api/yjs/token', { method: 'POST', credentials: 'include' })
  if (!res.ok) throw new Error(`yjs token fetch failed: ${res.status}`)
  const data = (await res.json()) as { token: string }
  return data.token
}
```

- [ ] **Step 2: Write `upload-handler.ts`**

```ts
'use client'

import type { UploadHandler } from '@repo/editor'

export type AttachFn = (fileId: string) => Promise<void>

export function createUploadHandler(args: {
  workspaceId: string
  attachToPage: AttachFn
}): UploadHandler {
  return async ({ blob, filename }) => {
    const fd = new FormData()
    fd.append('file', blob, filename)
    const res = await fetch(`/api/files/upload?kind=attachment&workspaceId=${args.workspaceId}`, {
      method: 'POST',
      body: fd,
      credentials: 'include',
    })
    if (!res.ok) throw new Error(`upload failed: ${res.status}`)
    const data = (await res.json()) as { file: { id: string } }
    await args.attachToPage(data.file.id)
    return { id: data.file.id, src: `/api/files/${data.file.id}/download` }
  }
}
```

- [ ] **Step 3: Type-check**

```bash
pnpm --filter web check-types
```

### Task 7.2: PageRenderer factory

**Files:**

- Create: `apps/web/src/components/page/page-renderer.tsx`

- [ ] **Step 1: Write the renderer**

```tsx
'use client'

import { useCallback, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { Box, CircularProgress } from '@mui/material'

import { trpc } from '@/trpc/client'
import { yjsUrl, fetchYjsToken } from '@/lib/yjs-config'
import { createUploadHandler } from '@/lib/upload-handler'

const AnyNoteEditor = dynamic(() => import('@repo/editor').then((m) => m.AnyNoteEditor), {
  ssr: false,
  loading: () => <CenteredSpinner />,
})
const Board = dynamic(() => import('@repo/excalidraw').then((m) => m.Board), {
  ssr: false,
  loading: () => <CenteredSpinner />,
})

function CenteredSpinner() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
      <CircularProgress />
    </Box>
  )
}

type PageInput = {
  id: string
  type: 'TEXT' | 'EXCALIDRAW' | 'DATABASE' | 'KANBAN' | 'FORM'
}

type Props = {
  page: PageInput
  workspaceId: string
  user: { id: string; name: string; color: string }
}

export function PageRenderer({ page, workspaceId, user }: Props) {
  const attachFile = trpc.file.attachToPage.useMutation()

  const attachToPage = useCallback(
    async (fileId: string) => {
      await attachFile.mutateAsync({ pageId: page.id, fileId })
    },
    [attachFile, page.id],
  )

  const uploadHandler = useMemo(
    () => createUploadHandler({ workspaceId, attachToPage }),
    [workspaceId, attachToPage],
  )

  if (page.type === 'EXCALIDRAW') {
    return (
      <Board
        pageId={page.id}
        workspaceId={workspaceId}
        yjsUrl={yjsUrl}
        yjsToken={fetchYjsToken}
        uploadHandler={uploadHandler}
      />
    )
  }

  if (page.type === 'TEXT') {
    return (
      <AnyNoteEditor
        pageId={page.id}
        workspaceId={workspaceId}
        yjsUrl={yjsUrl}
        yjsToken={fetchYjsToken}
        user={user}
        uploadHandler={uploadHandler}
      />
    )
  }

  return (
    <Box sx={{ p: 4, color: 'text.secondary' }}>
      Тип страницы &laquo;{page.type}&raquo; пока не поддерживается.
    </Box>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm --filter web check-types
```

### Task 7.3: Update the page route

**Files:**

- Modify: `apps/web/src/app/(protected)/workspaces/[workspaceId]/pages/[pageId]/page.tsx`
- Delete: `apps/web/src/components/page/page-view.tsx`
- Delete: `apps/web/src/components/page/block-renderer.tsx`

- [ ] **Step 1: Replace the page route content**

```tsx
import { notFound } from 'next/navigation'
import { Box, Typography } from '@mui/material'

import { requireSession } from '@/lib/get-session'
import { getServerTRPC } from '@/trpc/server'
import { PageRenderer } from '@/components/page/page-renderer'

const COLORS = ['#1976d2', '#9c27b0', '#2e7d32', '#ed6c02', '#0288d1', '#d32f2f']

function colorFor(userId: string): string {
  let hash = 0
  for (const ch of userId) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return COLORS[Math.abs(hash) % COLORS.length]
}

export default async function PageView({
  params,
}: {
  params: Promise<{ workspaceId: string; pageId: string }>
}) {
  const { workspaceId, pageId } = await params
  const session = await requireSession()
  const trpc = await getServerTRPC()
  const page = await trpc.page.getById({ id: pageId })
  if (!page) notFound()

  const displayName =
    [session.user.firstName, session.user.lastName].filter(Boolean).join(' ').trim() ||
    session.user.email

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Box sx={{ px: 3, py: 2 }}>
        <Typography variant="h5">{page.title ?? 'Без названия'}</Typography>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <PageRenderer
          page={{ id: page.id, type: page.type }}
          workspaceId={workspaceId}
          user={{ id: session.user.id, name: displayName, color: colorFor(session.user.id) }}
        />
      </Box>
    </Box>
  )
}
```

- [ ] **Step 2: Delete the dead components**

```bash
rm apps/web/src/components/page/page-view.tsx apps/web/src/components/page/block-renderer.tsx
```

- [ ] **Step 3: Sweep for stale imports**

```bash
grep -rn "page-view\|block-renderer" apps/web/src
```

Expected: no matches. If matches exist, remove the importing call sites.

- [ ] **Step 4: Type-check**

```bash
pnpm --filter web check-types
```

### Task 7.4: Wire editor styles into the protected layout

**Files:**

- Modify: `apps/web/src/app/(protected)/layout.tsx`

- [ ] **Step 1: Add the side-effect import at the top of the file**

```ts
import '@repo/editor/styles'
```

- [ ] **Step 2: Add `<EditorThemeBridge/>`** inside the layout's React tree (under `<UiProvider>` so MUI theme is in scope):

```tsx
import { EditorThemeBridge } from '@repo/editor'
// ...
;<TRPCReactProvider>
  <EditorThemeBridge />
  {children}
</TRPCReactProvider>
```

- [ ] **Step 3: Type-check + lint**

```bash
pnpm --filter web check-types
pnpm --filter web lint
```

### Task 7.5: Env vars + turbo

**Files:**

- Modify: `.env` (local dev only — do not commit secrets)
- Modify: `.env.example` (if exists)
- Modify: `turbo.json`

- [ ] **Step 1: Add to `.env`**

```
NEXT_PUBLIC_YJS_URL=ws://localhost:1234
YJS_PORT=1234
```

- [ ] **Step 2: Add the same keys to `.env.example`** (if the file exists)

- [ ] **Step 3: Add to `turbo.json` `globalEnv`**

```json
"NEXT_PUBLIC_YJS_URL",
"YJS_PORT",
"BETTER_AUTH_JWT_AUDIENCE"
```

- [ ] **Step 4: Commit Phase 7 changes**

```bash
git add apps/web turbo.json
git commit -m "feat(web): integrate AnyNoteEditor and Board via PageRenderer factory"
```

### Task 7.6: Add page-type selector for testing

**Files:**

- Modify: the page-creation UI (likely `apps/web/src/app/(protected)/workspaces/[workspaceId]/page.tsx` or a sidebar component) — search and adjust.

- [ ] **Step 1: Locate the page creation entry point**

```bash
grep -rn "page.create\|createPage" apps/web/src
```

- [ ] **Step 2: Extend the create-page flow to accept `type`**

In the smallest place that currently calls `trpc.page.create`, add a small menu or split button: "New text page" / "New canvas". Each variant calls `page.create` with the corresponding `type`.

- [ ] **Step 3: Verify in the browser**

Run `pnpm exec turbo run dev --filter=web` and `pnpm --filter @repo/yjs-server dev` in separate terminals, sign in, create one page of each type, navigate to each — confirm the correct renderer mounts.

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat(web): allow creating pages of TEXT or EXCALIDRAW type"
```

---

## Phase 8 — Verification & Tests

### Task 8.1: Playwright — TEXT editor smoke

**Files:**

- Create: `apps/e2e/editor.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test'

test('text page persists typed content after reload', async ({ page }) => {
  await page.goto('/sign-in')
  // Reuse existing sign-in flow from auth.spec.ts (helper or repeated steps)
  // Then navigate to a known seeded TEXT page or create one via UI:
  await page.goto('/app')
  await page.getByRole('button', { name: /создать/i }).click()
  await page.getByRole('menuitem', { name: /текст/i }).click()
  const editor = page.locator('.anynote-editor .ProseMirror')
  await expect(editor).toBeVisible()
  await editor.click()
  await page.keyboard.type('hello tiptap')
  await page.waitForTimeout(2500) // allow Hocuspocus debounced save
  await page.reload()
  await expect(editor).toContainText('hello tiptap')
})
```

> **Note:** the exact selectors for the create flow depend on Task 7.6's UI; adjust accordingly. If sign-in helpers are not yet extracted, copy from `apps/e2e/auth.spec.ts`.

- [ ] **Step 2: Run with both servers up**

```bash
docker compose up -d
pnpm --filter @repo/yjs-server dev &        # background
pnpm exec turbo run dev --filter=web &      # background
pnpm exec playwright test apps/e2e/editor.spec.ts
```

Expected: PASS.

### Task 8.2: Playwright — collaborative editing

**Files:**

- Create: `apps/e2e/editor-collab.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test'

test("two clients see each other's edits in real time", async ({ browser }) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  // Sign in both contexts as the same user (simplest) or two seeded users
  // Navigate both to the same TEXT page URL
  const pageUrl = '/workspaces/SEEDED_WS_ID/pages/SEEDED_PAGE_ID'
  const a = await ctxA.newPage()
  const b = await ctxB.newPage()
  await a.goto(pageUrl)
  await b.goto(pageUrl)

  await a.locator('.anynote-editor .ProseMirror').click()
  await a.keyboard.type('from A')
  await expect(b.locator('.anynote-editor .ProseMirror')).toContainText('from A', {
    timeout: 5000,
  })
})
```

> **Note:** Replace `SEEDED_WS_ID` / `SEEDED_PAGE_ID` with values produced by your e2e seed setup (or create the page via UI in the spec).

- [ ] **Step 2: Run the spec**

```bash
pnpm exec playwright test apps/e2e/editor-collab.spec.ts
```

### Task 8.3: Playwright — Excalidraw smoke

**Files:**

- Create: `apps/e2e/excalidraw.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test'

test('excalidraw page persists a drawn shape after reload', async ({ page }) => {
  await page.goto('/sign-in')
  // ... sign-in steps ...
  await page.goto('/app')
  await page.getByRole('button', { name: /создать/i }).click()
  await page.getByRole('menuitem', { name: /рисунок|canvas/i }).click()
  await expect(page.locator('.excalidraw')).toBeVisible({ timeout: 10000 })

  // Select rectangle tool and draw
  await page.keyboard.press('r')
  const canvas = page.locator('.excalidraw canvas').first()
  const box = await canvas.boundingBox()
  if (!box) throw new Error('canvas not found')
  await page.mouse.move(box.x + 100, box.y + 100)
  await page.mouse.down()
  await page.mouse.move(box.x + 200, box.y + 180)
  await page.mouse.up()
  await page.waitForTimeout(2500)
  await page.reload()
  // Verify by counting elements via the Excalidraw API exposed in window
  const count = await page.evaluate(
    () => (window as any).EXCALIDRAW_API?.getSceneElements?.().length ?? 0,
  )
  expect(count).toBeGreaterThanOrEqual(1)
})
```

> **Note:** If the Excalidraw API is not exposed on `window`, expose it from `BoardInner` for tests by adding `;(window as any).EXCALIDRAW_API = api` inside `onMount` when `process.env.NODE_ENV !== "production"`. Add this as a follow-up tweak only if the spec needs it.

- [ ] **Step 2: Run the spec**

```bash
pnpm exec playwright test apps/e2e/excalidraw.spec.ts
```

### Task 8.4: Repo-wide checks

- [ ] **Step 1: Lint**

```bash
pnpm lint
```

Expected: pass with `--max-warnings 0`.

- [ ] **Step 2: Check types**

```bash
pnpm check-types
```

Expected: no errors.

- [ ] **Step 3: Format**

```bash
pnpm format
```

- [ ] **Step 4: Commit any formatting changes**

```bash
git add -A
git commit -m "chore: pnpm format pass after collab editor work" || true
```

### Task 8.5: Update CLAUDE.md and README touchpoints

**Files:**

- Modify: `CLAUDE.md` — add a short section documenting `apps/yjs`, the new env vars, and the `PageRenderer` location.

- [ ] **Step 1: Append a "Realtime collaboration" section**

Document:

- `pnpm --filter @repo/yjs-server dev` is required alongside `pnpm dev` for editing pages.
- `NEXT_PUBLIC_YJS_URL`, `YJS_PORT`, `BETTER_AUTH_JWT_AUDIENCE` env vars.
- Page rendering is dispatched via `apps/web/src/components/page/page-renderer.tsx` keyed on `Page.type`.
- Block model has been removed; do not re-introduce it without updating this plan.

- [ ] **Step 2: Final commit**

```bash
git add CLAUDE.md
git commit -m "docs: document apps/yjs and PageRenderer architecture"
```

---

## Self-Review Checklist (run before handing off)

- [ ] Every spec section maps to at least one task above (DB, apps/yjs, JWT issuer, packages/editor, packages/excalidraw, apps/web integration, tests, env vars).
- [ ] No "TODO" placeholders survive in code (only the two flagged `> Note:` blocks where third-party API shape must be confirmed at install time — those are intentional follow-up checks documented in the plan).
- [ ] `UploadHandler` signature is identical between `@repo/editor` and `@repo/excalidraw` (both: `{ blob, filename } -> { id, src }`).
- [ ] `Page.type` enum values match between Prisma schema, tRPC inputs, and `PageRenderer` switch.
- [ ] `PageFile` composite-PK queries (`pageId_fileId`) use the Prisma-generated key name consistently.
