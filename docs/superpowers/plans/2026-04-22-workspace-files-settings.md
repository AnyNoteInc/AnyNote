# Workspace Files Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a new "Файлы" section on `/workspaces/{workspaceId}/settings/files` that lists all ACTIVE workspace files with chip-filters, 20-per-page pagination, download, and owner-only delete.

**Architecture:** Extend the existing `file` tRPC router with a paginated `listWorkspace` (adds search + uploader filter + total count) and a new `workspaceUploaders` query. Widen `/api/files/[id]` authorization so workspace members can download any ACTIVE workspace file. Build a client section (`"use client"`) hosted by a thin RSC page, following the same layout pattern as `WorkspaceAiSection`.

**Tech Stack:** Next.js 16 App Router (RSC + client), tRPC v11 (`createCallerFactory`), Prisma 7, MUI v6 via `@repo/ui/components`, Vitest for router tests.

**Reference spec:** [docs/superpowers/specs/2026-04-22-workspace-files-settings-design.md](../specs/2026-04-22-workspace-files-settings-design.md)

---

## Pre-flight

All tests and checks run from the repo root. Run these once before starting:

```bash
pnpm install
docker compose up -d
pnpm --filter @repo/db prisma:generate
```

Dev loop during implementation:

```bash
pnpm --filter @repo/trpc test            # router tests
pnpm --filter @repo/ui check-types       # UI re-export type check
pnpm --filter web check-types            # app type check
pnpm --filter web lint                   # app lint
pnpm --filter web dev                    # manual browser verification
```

---

## Task 1: Re-export missing MUI icons and `TablePagination` from `@repo/ui/components`

Per CLAUDE.md, app code must import MUI through `@repo/ui/components`. The icon mapping in [packages/ui/src/components/index.ts](../../../packages/ui/src/components/index.ts) already re-exports `DescriptionIcon`, `DeleteIcon`, `SearchIcon`. We need nine more icons plus `DownloadIcon` and the `TablePagination` component.

**Files:**

- Modify: `packages/ui/src/components/index.ts`

- [ ] **Step 1: Add re-exports**

Edit `packages/ui/src/components/index.ts`. After the existing `TableRow` export on line 35, add:

```ts
export {
  default as TablePagination,
  type TablePaginationProps,
} from '@mui/material/TablePagination'
```

After the existing `VisibilityOffIcon` export on line 93, add:

```ts
export { default as DownloadIcon } from '@mui/icons-material/Download'
export { default as PictureAsPdfIcon } from '@mui/icons-material/PictureAsPdf'
export { default as ImageIcon } from '@mui/icons-material/Image'
export { default as VideoFileIcon } from '@mui/icons-material/VideoFile'
export { default as AudioFileIcon } from '@mui/icons-material/AudioFile'
export { default as FolderZipIcon } from '@mui/icons-material/FolderZip'
export { default as TableChartIcon } from '@mui/icons-material/TableChart'
export { default as SlideshowIcon } from '@mui/icons-material/Slideshow'
export { default as TextSnippetIcon } from '@mui/icons-material/TextSnippet'
export { default as CodeIcon } from '@mui/icons-material/Code'
export { default as InsertDriveFileIcon } from '@mui/icons-material/InsertDriveFile'
```

- [ ] **Step 2: Type-check the UI package**

```bash
pnpm --filter @repo/ui check-types
```

Expected: exit code 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/index.ts
git commit -m "feat(ui): re-export TablePagination and file-type icons"
```

---

## Task 2: Add `FileExtIcon` component

Pure component mapping a lowercase extension string to a MUI icon. No state, no tRPC, safe to render in RSC but placed under `components/workspace/settings/` alongside the feature.

**Files:**

- Create: `apps/web/src/components/workspace/settings/file-ext-icon.tsx`

- [ ] **Step 1: Create the component**

```tsx
import type { ComponentType, SVGProps } from 'react'

import {
  AudioFileIcon,
  CodeIcon,
  DescriptionIcon,
  FolderZipIcon,
  ImageIcon,
  InsertDriveFileIcon,
  PictureAsPdfIcon,
  SlideshowIcon,
  TableChartIcon,
  TextSnippetIcon,
  VideoFileIcon,
} from '@repo/ui/components'

type SvgIconComponent = ComponentType<
  SVGProps<SVGSVGElement> & { fontSize?: 'small' | 'inherit' | 'medium' | 'large' }
>

const GROUPS: Array<{ exts: readonly string[]; Icon: SvgIconComponent }> = [
  { exts: ['pdf'], Icon: PictureAsPdfIcon as unknown as SvgIconComponent },
  {
    exts: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'],
    Icon: ImageIcon as unknown as SvgIconComponent,
  },
  {
    exts: ['mp4', 'mov', 'avi', 'mkv', 'webm'],
    Icon: VideoFileIcon as unknown as SvgIconComponent,
  },
  {
    exts: ['mp3', 'wav', 'ogg', 'flac', 'm4a'],
    Icon: AudioFileIcon as unknown as SvgIconComponent,
  },
  {
    exts: ['zip', 'rar', '7z', 'tar', 'gz'],
    Icon: FolderZipIcon as unknown as SvgIconComponent,
  },
  { exts: ['doc', 'docx', 'odt', 'rtf'], Icon: DescriptionIcon as unknown as SvgIconComponent },
  {
    exts: ['xls', 'xlsx', 'csv', 'ods'],
    Icon: TableChartIcon as unknown as SvgIconComponent,
  },
  { exts: ['ppt', 'pptx', 'odp'], Icon: SlideshowIcon as unknown as SvgIconComponent },
  { exts: ['txt', 'md'], Icon: TextSnippetIcon as unknown as SvgIconComponent },
  {
    exts: ['js', 'ts', 'tsx', 'jsx', 'json', 'xml', 'yaml', 'yml', 'py', 'go', 'rs', 'java'],
    Icon: CodeIcon as unknown as SvgIconComponent,
  },
]

function resolve(ext: string): SvgIconComponent {
  const lower = ext.toLowerCase()
  for (const { exts, Icon } of GROUPS) {
    if (exts.includes(lower)) return Icon
  }
  return InsertDriveFileIcon as unknown as SvgIconComponent
}

type Props = {
  ext: string
  fontSize?: 'small' | 'inherit' | 'medium' | 'large'
}

export function FileExtIcon({ ext, fontSize = 'small' }: Props) {
  const Icon = resolve(ext)
  return <Icon fontSize={fontSize} />
}
```

- [ ] **Step 2: Type-check the web app**

```bash
pnpm --filter web check-types
```

Expected: exit code 0. (Depends on Task 1 icons being re-exported.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/workspace/settings/file-ext-icon.tsx
git commit -m "feat(web): add FileExtIcon component"
```

---

## Task 3: Rewrite `file.listWorkspace` with search, uploader filter, and total count

Replace the existing cursor-based `listWorkspace` (no production callers — verified via grep) with page-based `{ page, pageSize }` input, `{ search, uploaderId }` filters, and `{ items, total }` output. Each item carries a `user` sub-object with display fields. Add a router test file next to `chat-router.test.ts` covering the new behaviour.

**Files:**

- Modify: `packages/trpc/src/routers/file.ts` (replace `listWorkspace`, keep everything else)
- Create: `packages/trpc/test/file-router.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/trpc/test/file-router.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('@repo/auth', () => ({
  getUserFromRequest: vi.fn(),
}))

vi.mock('@repo/db', () => ({
  FileStatus: { ACTIVE: 'ACTIVE', PENDING: 'PENDING', DELETED: 'DELETED', ARCHIVED: 'ARCHIVED' },
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
      code: string
      constructor(message: string, opts: { code: string }) {
        super(message)
        this.code = opts.code
      }
    },
  },
  prisma: {},
}))

import type { PrismaClient } from '@repo/db'

import { fileRouter } from '../src/routers/file'
import { createCallerFactory } from '../src/trpc'

const createCaller = createCallerFactory(fileRouter)

const WORKSPACE_ID = '11111111-1111-1111-1111-111111111111'
const USER_ID = '22222222-2222-2222-2222-222222222222'
const OTHER_USER_ID = '33333333-3333-3333-3333-333333333333'
const FILE_ID = '44444444-4444-4444-4444-444444444444'

function baseContext(prisma: PrismaClient) {
  return {
    prisma,
    user: { id: USER_ID },
    headers: new Headers(),
    resHeaders: new Headers(),
  }
}

function memberOk() {
  return { workspaceId: WORKSPACE_ID, userId: USER_ID }
}

describe('fileRouter.listWorkspace', () => {
  it('returns paginated items with total and user relation', async () => {
    const createdAt = new Date('2026-04-22T10:00:00.000Z')
    const updatedAt = new Date('2026-04-22T10:01:00.000Z')
    const fileRow = {
      id: FILE_ID,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      name: 'brief',
      ext: 'pdf',
      fileSize: BigInt(1024),
      mimeType: 'application/pdf',
      hash: 'h',
      path: 'p',
      status: 'ACTIVE',
      isPublic: false,
      downloadCount: 3,
      expiresAt: null,
      createdAt,
      updatedAt,
      user: {
        id: USER_ID,
        firstName: 'Ivan',
        lastName: 'Ivanov',
        email: 'ivan@example.com',
        image: null,
      },
    }

    const findMany = vi.fn(async () => [fileRow])
    const count = vi.fn(async () => 42)
    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => memberOk()) },
      file: { findMany, count },
    } as unknown as PrismaClient

    const caller = createCaller(baseContext(prisma))
    const result = await caller.listWorkspace({
      workspaceId: WORKSPACE_ID,
      page: 1,
      pageSize: 20,
    })

    expect(result).toEqual({
      items: [
        {
          ...fileRow,
          fileSize: '1024',
        },
      ],
      total: 42,
    })

    expect(findMany).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, image: true } },
      },
      skip: 20,
      take: 20,
    })
    expect(count).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID, status: 'ACTIVE' },
    })
  })

  it('applies case-insensitive name search and uploader filter', async () => {
    const findMany = vi.fn(async () => [])
    const count = vi.fn(async () => 0)
    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => memberOk()) },
      file: { findMany, count },
    } as unknown as PrismaClient

    const caller = createCaller(baseContext(prisma))
    await caller.listWorkspace({
      workspaceId: WORKSPACE_ID,
      page: 0,
      pageSize: 20,
      search: '  Report  ',
      uploaderId: OTHER_USER_ID,
    })

    const expectedWhere = {
      workspaceId: WORKSPACE_ID,
      status: 'ACTIVE',
      name: { contains: 'Report', mode: 'insensitive' },
      userId: OTHER_USER_ID,
    }
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expectedWhere }))
    expect(count).toHaveBeenCalledWith({ where: expectedWhere })
  })

  it('ignores whitespace-only search', async () => {
    const findMany = vi.fn(async () => [])
    const count = vi.fn(async () => 0)
    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => memberOk()) },
      file: { findMany, count },
    } as unknown as PrismaClient

    const caller = createCaller(baseContext(prisma))
    await caller.listWorkspace({
      workspaceId: WORKSPACE_ID,
      page: 0,
      pageSize: 20,
      search: '   ',
    })

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: WORKSPACE_ID, status: 'ACTIVE' } }),
    )
  })

  it('forbids non-members', async () => {
    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => null) },
      file: { findMany: vi.fn(), count: vi.fn() },
    } as unknown as PrismaClient

    const caller = createCaller(baseContext(prisma))
    await expect(
      caller.listWorkspace({ workspaceId: WORKSPACE_ID, page: 0, pageSize: 20 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @repo/trpc test -- file-router
```

Expected: Test file not found OR first test fails because `listWorkspace` still has the old cursor shape. Either failure mode is acceptable for the red phase.

- [ ] **Step 3: Rewrite `listWorkspace` in the router**

Open `packages/trpc/src/routers/file.ts` and replace lines 42–73 (the current `listWorkspace` block). The new implementation:

```ts
  listWorkspace: protectedProcedure
    .input(
      z.object({
        workspaceId: uuid,
        search: z.string().max(256).optional(),
        uploaderId: uuid.optional(),
        page: z.number().int().min(0).default(0),
        pageSize: z.number().int().min(1).max(100).default(20),
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

      const search = input.search?.trim() ?? ""
      const where: Prisma.FileWhereInput = {
        workspaceId: input.workspaceId,
        status: FileStatus.ACTIVE,
        ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
        ...(input.uploaderId ? { userId: input.uploaderId } : {}),
      }

      const [rows, total] = await Promise.all([
        ctx.prisma.file.findMany({
          where,
          orderBy: { createdAt: "desc" },
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                image: true,
              },
            },
          },
          skip: input.page * input.pageSize,
          take: input.pageSize,
        }),
        ctx.prisma.file.count({ where }),
      ])

      return {
        items: rows.map((row) => ({
          ...serializeFile(row),
          user: row.user,
        })),
        total,
      }
    }),
```

Note: `serializeFile` already accepts any `File`-shaped object and spreads the rest through, so the `user` relation survives the spread. No DTO type change needed; the inferred return type picks up the user shape automatically.

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @repo/trpc test -- file-router
```

Expected: all four tests PASS.

- [ ] **Step 5: Type-check the tRPC package**

```bash
pnpm --filter @repo/trpc check-types
```

Expected: exit code 0.

- [ ] **Step 6: Commit**

```bash
git add packages/trpc/src/routers/file.ts packages/trpc/test/file-router.test.ts
git commit -m "feat(trpc): paginate file.listWorkspace with search and uploader filter"
```

---

## Task 4: Add `file.workspaceUploaders` query

Returns the unique set of users who have uploaded an ACTIVE file to the workspace — used to populate the uploader chip menu.

**Files:**

- Modify: `packages/trpc/src/routers/file.ts` (add procedure after `listWorkspace`)
- Modify: `packages/trpc/test/file-router.test.ts` (append test block)

- [ ] **Step 1: Write the failing test**

Append to `packages/trpc/test/file-router.test.ts`:

```ts
describe('fileRouter.workspaceUploaders', () => {
  it('lists unique uploaders for a workspace', async () => {
    const findMany = vi.fn(async () => [
      { id: USER_ID, firstName: 'Ivan', lastName: 'Ivanov', email: 'i@x', image: null },
      { id: OTHER_USER_ID, firstName: 'Petr', lastName: 'Petrov', email: 'p@x', image: '/a' },
    ])
    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => memberOk()) },
      user: { findMany },
    } as unknown as PrismaClient

    const caller = createCaller(baseContext(prisma))
    const result = await caller.workspaceUploaders({ workspaceId: WORKSPACE_ID })

    expect(findMany).toHaveBeenCalledWith({
      where: { files: { some: { workspaceId: WORKSPACE_ID, status: 'ACTIVE' } } },
      select: { id: true, firstName: true, lastName: true, email: true, image: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { email: 'asc' }],
    })
    expect(result).toHaveLength(2)
  })

  it('forbids non-members from listing uploaders', async () => {
    const prisma = {
      workspaceMember: { findUnique: vi.fn(async () => null) },
      user: { findMany: vi.fn() },
    } as unknown as PrismaClient

    const caller = createCaller(baseContext(prisma))
    await expect(caller.workspaceUploaders({ workspaceId: WORKSPACE_ID })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @repo/trpc test -- file-router
```

Expected: the two new tests FAIL (procedure `workspaceUploaders` missing).

- [ ] **Step 3: Add the procedure**

In `packages/trpc/src/routers/file.ts`, immediately after the closing `}),` of `listWorkspace`, add:

```ts
  workspaceUploaders: protectedProcedure
    .input(z.object({ workspaceId: uuid }))
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

      return ctx.prisma.user.findMany({
        where: { files: { some: { workspaceId: input.workspaceId, status: FileStatus.ACTIVE } } },
        select: { id: true, firstName: true, lastName: true, email: true, image: true },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }, { email: "asc" }],
      })
    }),
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @repo/trpc test -- file-router
```

Expected: all six tests (four from Task 3 + two new) PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/routers/file.ts packages/trpc/test/file-router.test.ts
git commit -m "feat(trpc): add file.workspaceUploaders query"
```

---

## Task 5: Widen `/api/files/[id]` authorization for workspace members

Today non-owners can only download if the file is linked to a page they have access to. Allow any workspace member to download any ACTIVE file that belongs to their workspace.

**Files:**

- Modify: `apps/web/src/app/api/files/[id]/route.ts` — extend the `if (!file.isPublic)` block

- [ ] **Step 1: Update the route**

Edit `apps/web/src/app/api/files/[id]/route.ts`. Replace the existing `if (session.user.id !== file.userId) { ... }` block (lines 26–41 in the current file) with:

```ts
if (session.user.id !== file.userId) {
  // Allow download if the file is an ACTIVE file in a workspace the user belongs to…
  let authorized = false

  if (file.workspaceId && file.status === 'ACTIVE') {
    const member = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: file.workspaceId,
          userId: session.user.id,
        },
      },
      select: { userId: true },
    })
    if (member) authorized = true
  }

  // …or attached to a page in a workspace the user belongs to.
  if (!authorized) {
    const linked = await prisma.pageFile.findFirst({
      where: {
        fileId: file.id,
        page: {
          deletedAt: null,
          workspace: { members: { some: { userId: session.user.id } } },
        },
      },
      select: { pageId: true },
    })
    if (linked) authorized = true
  }

  if (!authorized) {
    return new Response('Forbidden', { status: 403 })
  }
}
```

- [ ] **Step 2: Verify types**

```bash
pnpm --filter web check-types
```

Expected: exit code 0.

- [ ] **Step 3: Manual smoke test**

```bash
# Terminal 1
pnpm --filter web dev

# Terminal 2 — ensure at least one ACTIVE file uploaded to a workspace by user A,
# and user B is a member. Sign in as B, then:
curl -i -b cookies.txt http://localhost:3000/api/files/<FILE_ID>
```

Expected: HTTP 200 with the file bytes streaming (not 403). Copy the cookie from an authenticated browser session to `cookies.txt` for the test.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api/files/[id]/route.ts
git commit -m "feat(api): allow workspace members to download workspace files"
```

---

## Task 6: Create `FilesDeleteDialog` component

Controlled MUI `Dialog` that confirms deletion of a file by the owner and calls `file.delete`. Keeps its own mutation state; parent passes `onDeleted` to invalidate the list.

**Files:**

- Create: `apps/web/src/components/workspace/settings/files-delete-dialog.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client'

import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

type DialogFile = {
  id: string
  name: string
  ext: string
}

type Props = {
  open: boolean
  file: DialogFile | null
  onClose: () => void
  onDeleted: () => void
}

export function FilesDeleteDialog({ open, file, onClose, onDeleted }: Props) {
  const mutation = trpc.file.delete.useMutation({
    onSuccess: () => {
      onDeleted()
      onClose()
    },
  })

  const handleConfirm = () => {
    if (!file) return
    mutation.mutate({ id: file.id })
  }

  const handleClose = () => {
    if (mutation.isPending) return
    mutation.reset()
    onClose()
  }

  const displayName = file ? (file.ext ? `${file.name}.${file.ext}` : file.name) : ''

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>Удалить файл?</DialogTitle>
      <DialogContent>
        <DialogContentText>
          Файл «{displayName}» будет удалён. Это действие нельзя отменить.
        </DialogContentText>
        {mutation.error ? (
          <Alert severity="error" sx={{ mt: 2 }}>
            {mutation.error.message}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={mutation.isPending}>
          Отмена
        </Button>
        <Button
          onClick={handleConfirm}
          color="error"
          variant="contained"
          loading={mutation.isPending}
          disabled={!file}
        >
          Удалить
        </Button>
      </DialogActions>
    </Dialog>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm --filter web check-types
```

Expected: exit code 0. If the `Button` rejects `loading`, check that `@repo/ui/components/ui/button.tsx` exports the custom button used elsewhere (it does — see `WorkspaceAiSection` which passes `loading={update.isPending}`).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/workspace/settings/files-delete-dialog.tsx
git commit -m "feat(web): add FilesDeleteDialog"
```

---

## Task 7: Create `FilesFilters` component

Two chip controls: a name-search popover and an uploader `Menu`. Emits changes to a parent via `onSearchChange` / `onUploaderChange`. Receives the uploader list and a loading flag.

**Files:**

- Create: `apps/web/src/components/workspace/settings/files-filters.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client'

import { useRef, useState } from 'react'

import {
  Avatar,
  Box,
  Chip,
  InputAdornment,
  Menu,
  MenuItem,
  Popover,
  SearchIcon,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'

type Uploader = {
  id: string
  firstName: string | null
  lastName: string | null
  email: string
  image: string | null
}

type Props = {
  search: string
  uploaderId: string | null
  uploaders: Uploader[]
  uploadersLoading: boolean
  onSearchChange: (value: string) => void
  onUploaderChange: (value: string | null) => void
}

function fullName(user: Uploader) {
  const joined = [user.firstName, user.lastName].filter(Boolean).join(' ').trim()
  return joined || user.email
}

function initials(user: Uploader) {
  const src = fullName(user)
  return src.slice(0, 1).toUpperCase()
}

function shortName(user: Uploader) {
  const first = user.firstName?.trim() ?? ''
  const last = user.lastName?.trim() ?? ''
  if (first && last) return `${first} ${last.slice(0, 1)}.`
  return first || last || user.email
}

export function FilesFilters({
  search,
  uploaderId,
  uploaders,
  uploadersLoading,
  onSearchChange,
  onUploaderChange,
}: Props) {
  const searchChipRef = useRef<HTMLDivElement>(null)
  const uploaderChipRef = useRef<HTMLDivElement>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [uploaderOpen, setUploaderOpen] = useState(false)

  const activeUploader = uploaderId ? (uploaders.find((u) => u.id === uploaderId) ?? null) : null

  const searchLabel = search ? `Название: «${search}»` : 'Название'
  const uploaderLabel = activeUploader
    ? `Пользователь: ${shortName(activeUploader)}`
    : 'Пользователь'

  return (
    <>
      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
        <Chip
          ref={searchChipRef}
          label={searchLabel}
          variant={search ? 'filled' : 'outlined'}
          color={search ? 'primary' : 'default'}
          icon={<SearchIcon fontSize="small" />}
          onClick={() => setSearchOpen(true)}
          onDelete={search ? () => onSearchChange('') : undefined}
        />
        <Chip
          ref={uploaderChipRef}
          label={uploaderLabel}
          variant={activeUploader ? 'filled' : 'outlined'}
          color={activeUploader ? 'primary' : 'default'}
          onClick={() => setUploaderOpen(true)}
          onDelete={activeUploader ? () => onUploaderChange(null) : undefined}
        />
      </Stack>

      <Popover
        open={searchOpen}
        anchorEl={searchChipRef.current}
        onClose={() => setSearchOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { p: 1.5, width: 280 } } }}
      >
        <TextField
          autoFocus
          fullWidth
          size="small"
          placeholder="Поиск по названию"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
      </Popover>

      <Menu
        open={uploaderOpen}
        anchorEl={uploaderChipRef.current}
        onClose={() => setUploaderOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { maxHeight: 360, minWidth: 260 } } }}
      >
        {uploadersLoading ? (
          <MenuItem disabled>Загрузка…</MenuItem>
        ) : uploaders.length === 0 ? (
          <MenuItem disabled>Нет пользователей</MenuItem>
        ) : (
          uploaders.map((user) => (
            <MenuItem
              key={user.id}
              selected={user.id === uploaderId}
              onClick={() => {
                onUploaderChange(user.id)
                setUploaderOpen(false)
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                <Avatar src={user.image ?? undefined} sx={{ width: 24, height: 24, fontSize: 12 }}>
                  {initials(user)}
                </Avatar>
                <Typography variant="body2" noWrap>
                  {fullName(user)}
                </Typography>
              </Box>
            </MenuItem>
          ))
        )}
      </Menu>
    </>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm --filter web check-types
```

Expected: exit code 0.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/workspace/settings/files-filters.tsx
git commit -m "feat(web): add FilesFilters chip row"
```

---

## Task 8: Create `FilesTableRow` component

Presentational row for a single file. Shows the extension icon, name, ext, size in МБ, status chip, download count, uploader avatar + name, download button, and conditional delete button.

**Files:**

- Create: `apps/web/src/components/workspace/settings/files-table-row.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client'

import {
  Avatar,
  Box,
  Chip,
  DeleteIcon,
  DownloadIcon,
  IconButton,
  Stack,
  TableCell,
  TableRow,
  Tooltip,
  Typography,
} from '@repo/ui/components'

import { FileExtIcon } from './file-ext-icon'

type RowUser = {
  id: string
  firstName: string | null
  lastName: string | null
  email: string
  image: string | null
}

export type RowFile = {
  id: string
  name: string
  ext: string
  fileSize: string
  status: string
  downloadCount: number
  userId: string
  user: RowUser
}

type Props = {
  file: RowFile
  currentUserId: string
  onRequestDelete: (file: RowFile) => void
}

const formatMb = (bytes: string) => {
  const num = Number(bytes)
  if (!Number.isFinite(num)) return '—'
  return `${(num / (1024 * 1024)).toFixed(2)} МБ`
}

const fullName = (user: RowUser) => {
  const joined = [user.firstName, user.lastName].filter(Boolean).join(' ').trim()
  return joined || user.email
}

const initials = (user: RowUser) => fullName(user).slice(0, 1).toUpperCase()

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Активен',
  ARCHIVED: 'В архиве',
  PENDING: 'Обработка',
  DELETED: 'Удалён',
}

export function FilesTableRow({ file, currentUserId, onRequestDelete }: Props) {
  const displayName = file.ext ? `${file.name}.${file.ext}` : file.name
  const downloadUrl = `/api/files/${file.id}`
  const owned = file.userId === currentUserId

  return (
    <TableRow hover>
      <TableCell sx={{ maxWidth: 320 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
          <FileExtIcon ext={file.ext} />
          <Tooltip title={displayName}>
            <Typography
              variant="body2"
              sx={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }}
            >
              {displayName}
            </Typography>
          </Tooltip>
        </Stack>
      </TableCell>
      <TableCell>{file.ext ? file.ext.toUpperCase() : '—'}</TableCell>
      <TableCell align="right">{formatMb(file.fileSize)}</TableCell>
      <TableCell>
        <Chip size="small" label={STATUS_LABEL[file.status] ?? file.status} />
      </TableCell>
      <TableCell align="right">{file.downloadCount}</TableCell>
      <TableCell>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <Avatar src={file.user.image ?? undefined} sx={{ width: 24, height: 24, fontSize: 12 }}>
            {initials(file.user)}
          </Avatar>
          <Typography variant="body2" noWrap>
            {fullName(file.user)}
          </Typography>
        </Box>
      </TableCell>
      <TableCell align="right">
        <Stack direction="row" spacing={0.5} justifyContent="flex-end">
          <Tooltip title="Скачать файл">
            <IconButton
              size="small"
              component="a"
              href={downloadUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="Скачать файл"
            >
              <DownloadIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {owned ? (
            <Tooltip title="Удалить файл">
              <IconButton
                size="small"
                color="error"
                aria-label="Удалить файл"
                onClick={() => onRequestDelete(file)}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : null}
        </Stack>
      </TableCell>
    </TableRow>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm --filter web check-types
```

Expected: exit code 0.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/workspace/settings/files-table-row.tsx
git commit -m "feat(web): add FilesTableRow"
```

---

## Task 9: Create `WorkspaceFilesSection` — the main client component

Glues filters, table, pagination, and the delete dialog together. Owns `search` (debounced), `uploaderId`, and `page` state. Uses the `@repo/ui/components` Table primitives.

**Files:**

- Create: `apps/web/src/components/workspace/settings/files-section.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client'

import { useEffect, useMemo, useState } from 'react'

import {
  Alert,
  Box,
  Button,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { FilesDeleteDialog } from './files-delete-dialog'
import { FilesFilters } from './files-filters'
import { FilesTableRow, type RowFile } from './files-table-row'

type Props = {
  workspaceId: string
  currentUserId: string
}

const PAGE_SIZE = 20

export function WorkspaceFilesSection({ workspaceId, currentUserId }: Props) {
  const utils = trpc.useUtils()

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [uploaderId, setUploaderId] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [deleteTarget, setDeleteTarget] = useState<RowFile | null>(null)

  // Debounce the search input 300 ms.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  // Reset pagination whenever filters change.
  useEffect(() => {
    setPage(0)
  }, [search, uploaderId])

  const uploadersQuery = trpc.file.workspaceUploaders.useQuery({ workspaceId })

  const listQuery = trpc.file.listWorkspace.useQuery(
    {
      workspaceId,
      search: search || undefined,
      uploaderId: uploaderId ?? undefined,
      page,
      pageSize: PAGE_SIZE,
    },
    { placeholderData: (prev) => prev },
  )

  // Clamp to last page if total shrinks below current page.
  useEffect(() => {
    const total = listQuery.data?.total ?? 0
    const lastPage = total === 0 ? 0 : Math.ceil(total / PAGE_SIZE) - 1
    if (page > lastPage) setPage(lastPage)
  }, [listQuery.data?.total, page])

  const resetFilters = () => {
    setSearchInput('')
    setSearch('')
    setUploaderId(null)
  }

  const handleDeleted = () => {
    utils.file.listWorkspace.invalidate({ workspaceId })
    utils.file.workspaceUploaders.invalidate({ workspaceId })
  }

  const filtersActive = search !== '' || uploaderId !== null
  const items = listQuery.data?.items ?? []
  const total = listQuery.data?.total ?? 0

  const body = useMemo(() => {
    if (listQuery.isLoading && items.length === 0) {
      return (
        <TableRow>
          <TableCell colSpan={7} sx={{ textAlign: 'center', py: 4 }}>
            <Typography variant="body2" color="text.secondary">
              Загрузка…
            </Typography>
          </TableCell>
        </TableRow>
      )
    }

    if (items.length === 0 && filtersActive) {
      return (
        <TableRow>
          <TableCell colSpan={7} sx={{ textAlign: 'center', py: 4 }}>
            <Stack spacing={1} alignItems="center">
              <Typography variant="body2" color="text.secondary">
                По фильтрам ничего не найдено.
              </Typography>
              <Button size="small" onClick={resetFilters}>
                Сбросить фильтры
              </Button>
            </Stack>
          </TableCell>
        </TableRow>
      )
    }

    if (items.length === 0) {
      return (
        <TableRow>
          <TableCell colSpan={7} sx={{ textAlign: 'center', py: 4 }}>
            <Typography variant="body2" color="text.secondary">
              Файлы ещё не загружались.
            </Typography>
          </TableCell>
        </TableRow>
      )
    }

    return items.map((file) => (
      <FilesTableRow
        key={file.id}
        file={file as RowFile}
        currentUserId={currentUserId}
        onRequestDelete={setDeleteTarget}
      />
    ))
  }, [listQuery.isLoading, items, filtersActive, currentUserId])

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Stack spacing={2}>
        <Box>
          <Typography variant="h6">Файлы</Typography>
          <Typography variant="body2" color="text.secondary">
            Все файлы, загруженные в этом workspace.
          </Typography>
        </Box>

        {listQuery.error ? <Alert severity="error">{listQuery.error.message}</Alert> : null}

        <FilesFilters
          search={searchInput}
          uploaderId={uploaderId}
          uploaders={uploadersQuery.data ?? []}
          uploadersLoading={uploadersQuery.isLoading}
          onSearchChange={setSearchInput}
          onUploaderChange={setUploaderId}
        />

        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Название</TableCell>
                <TableCell>Расширение</TableCell>
                <TableCell align="right">Размер</TableCell>
                <TableCell>Статус</TableCell>
                <TableCell align="right">Скачивания</TableCell>
                <TableCell>Загрузил</TableCell>
                <TableCell align="right">Действия</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>{body}</TableBody>
          </Table>
        </Box>

        <TablePagination
          component="div"
          count={total}
          page={page}
          onPageChange={(_, next) => setPage(next)}
          rowsPerPage={PAGE_SIZE}
          rowsPerPageOptions={[PAGE_SIZE]}
          labelDisplayedRows={({ from, to, count }) =>
            `${from}–${to} из ${count !== -1 ? count : `больше ${to}`}`
          }
          labelRowsPerPage="На странице"
        />
      </Stack>

      <FilesDeleteDialog
        open={deleteTarget !== null}
        file={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={handleDeleted}
      />
    </Paper>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm --filter web check-types
```

Expected: exit code 0.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/workspace/settings/files-section.tsx
git commit -m "feat(web): add WorkspaceFilesSection"
```

---

## Task 10: Create the settings files page (RSC)

Server component that validates workspace access and hands `workspaceId` + `currentUserId` to the client section. Pattern mirrors `apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/ai/page.tsx`.

**Files:**

- Create: `apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/files/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
import { notFound } from 'next/navigation'

import { WorkspaceFilesSection } from '@/components/workspace/settings/files-section'
import { requireSession } from '@/lib/get-session'
import { getServerTRPC } from '@/trpc/server'

type Props = { params: Promise<{ workspaceId: string }> }

export default async function WorkspaceSettingsFilesPage({ params }: Props) {
  const { workspaceId } = await params
  const session = await requireSession()
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getById({ id: workspaceId })
  if (!workspace) notFound()

  return <WorkspaceFilesSection workspaceId={workspaceId} currentUserId={session.user.id} />
}
```

- [ ] **Step 2: Type-check**

```bash
pnpm --filter web check-types
```

Expected: exit code 0.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(protected\)/workspaces/\[workspaceId\]/settings/files/page.tsx
git commit -m "feat(web): add workspace settings files page"
```

---

## Task 11: Add "Файлы" to workspace settings navigation

Insert a new nav item between "AI агент" and "Опасная зона" in [apps/web/src/components/workspace/workspace-settings-nav.tsx](../../../apps/web/src/components/workspace/workspace-settings-nav.tsx).

**Files:**

- Modify: `apps/web/src/components/workspace/workspace-settings-nav.tsx`

- [ ] **Step 1: Update the `ITEMS` array**

Replace lines 10–15 (the current `ITEMS` constant) with:

```ts
const ITEMS = [
  { label: 'Общее', slug: 'general' },
  { label: 'Участники', slug: 'members' },
  { label: 'AI агент', slug: 'ai' },
  { label: 'Файлы', slug: 'files' },
  { label: 'Опасная зона', slug: 'danger' },
] as const
```

- [ ] **Step 2: Type-check + lint**

```bash
pnpm --filter web check-types && pnpm --filter web lint
```

Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/workspace/workspace-settings-nav.tsx
git commit -m "feat(web): add files tab to workspace settings nav"
```

---

## Task 12: Full verification pass and manual smoke test

**Files:** none new — verification only.

- [ ] **Step 1: Run all checks**

```bash
pnpm --filter @repo/ui check-types
pnpm --filter @repo/trpc check-types
pnpm --filter @repo/trpc test
pnpm --filter web check-types
pnpm --filter web lint
```

Expected: all exit 0. Six tests pass in `@repo/trpc` (four for `listWorkspace`, two for `workspaceUploaders`).

- [ ] **Step 2: Manual end-to-end walkthrough**

Start the dev server (`pnpm --filter web dev`) and in a browser signed in as a workspace member:

1. Visit `/workspaces/<id>/settings` — sidebar shows "Файлы" between "AI агент" and "Опасная зона".
2. Click "Файлы" — page loads without errors; table renders or shows "Файлы ещё не загружались" for empty workspaces.
3. Upload a file via chat or a page attachment elsewhere, come back — the file appears at the top (newest first) with correct name, ext, size (МБ with 2 decimals), status "Активен", download count.
4. Click the name or the download icon — file downloads in a new tab; download counter increments (refresh the page to confirm).
5. Uploader avatar + name shows; if the uploader has no first/last name, email fallback renders.
6. Click the "Название" chip — popover opens with a search input. Type 3+ chars — after ~300 ms the list filters; chip shows `Название: «...»` with an `X`. Click `X` — filter clears.
7. Click the "Пользователь" chip — menu lists uploaders; select one — chip shows `Пользователь: Иван И.`; click `X` to clear.
8. Both filters together — AND semantics.
9. With 21+ files in the workspace (`for i in $(seq 1 21); do echo $i > /tmp/f$i.txt; done` and upload via API), confirm `TablePagination` shows "1–20 из N" and the next-page arrow loads rows 21+.
10. As the uploader, click the delete icon on one of your own files — dialog confirms "Удалить файл? «foo.txt»"; click "Удалить" — row disappears, counter in pagination drops, uploader menu updates if it was that user's last file.
11. As a non-uploader, confirm the delete icon is **not** visible on files uploaded by others.
12. Sign in as a second workspace member — can download files uploaded by others (this was the `/api/files/[id]` widen change).

- [ ] **Step 3: Final commit if any fix-ups happened**

If the smoke test surfaced issues, fix them (each fix in its own commit), re-run Step 1, and re-verify. If the walkthrough is clean, no further commit is required — Task 12 is a gate, not code.

---

## File map summary

### Created

- `packages/trpc/test/file-router.test.ts`
- `apps/web/src/app/(protected)/workspaces/[workspaceId]/settings/files/page.tsx`
- `apps/web/src/components/workspace/settings/file-ext-icon.tsx`
- `apps/web/src/components/workspace/settings/files-delete-dialog.tsx`
- `apps/web/src/components/workspace/settings/files-filters.tsx`
- `apps/web/src/components/workspace/settings/files-section.tsx`
- `apps/web/src/components/workspace/settings/files-table-row.tsx`

### Modified

- `packages/ui/src/components/index.ts` (re-exports)
- `packages/trpc/src/routers/file.ts` (reshape `listWorkspace`, add `workspaceUploaders`)
- `apps/web/src/app/api/files/[id]/route.ts` (widen auth)
- `apps/web/src/components/workspace/workspace-settings-nav.tsx` (nav entry)
