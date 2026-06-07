# Remove `workspaceId` from user-facing URLs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AnyNote's normal user-facing URLs `/pages/{id}`, `/chats/new`, `/chats/{id}`, `/templates`, `/templates/{id}`, `/trash` by storing the current workspace as a server-side user preference, while keeping `workspaceId` as the internal DB/domain/security boundary.

**Architecture:** Add `UserPreference.activeWorkspaceId`. A `resolveActiveWorkspace(prisma, userId)` core (active → default → first-workspace fallback, self-repairing) drives a new `(protected)/(active)/` route group whose shell layout no longer reads `workspaceId` from the URL. Old `/workspaces/[workspaceId]/*` paths become membership-checked redirects that set the active workspace and bounce to the neutral URL. All UI link generation switches to neutral URLs; attachment upload and export resolve the workspace server-side.

**Tech Stack:** Next.js 16 App Router (RSC), tRPC v11, Prisma 7, MUI v6, vitest. Repo conventions: `pnpm` + Turborepo, prettier (`semi:false`, single quotes, 100 cols), Conventional Commits.

**Reference spec:** `docs/superpowers/specs/2026-06-07-remove-workspaceid-from-urls-design.md`

---

## File structure

**Create:**
- `packages/db/prisma/migrations/<ts>_add_active_workspace_id/migration.sql` (generated)
- `packages/trpc/src/helpers/active-workspace.ts` — `resolveActiveWorkspace(prisma, userId)` core + types
- `packages/trpc/test/active-workspace.test.ts` — resolver + `getActive`/`setActive` tests
- `apps/web/src/app/(protected)/(active)/layout.tsx` — neutral shell layout
- `apps/web/src/app/(protected)/(active)/pages/[pageId]/page.tsx`
- `apps/web/src/app/(protected)/(active)/pages/[pageId]/loading.tsx`
- `apps/web/src/app/(protected)/(active)/chats/new/page.tsx`
- `apps/web/src/app/(protected)/(active)/chats/[chatId]/page.tsx`
- `apps/web/src/app/(protected)/(active)/templates/page.tsx`
- `apps/web/src/app/(protected)/(active)/templates/[templateId]/page.tsx`
- `apps/web/src/app/(protected)/(active)/trash/page.tsx`
- `apps/web/src/lib/active-workspace.ts` — session-scoped `getActiveWorkspaceForUser(userId)` for API routes
- `apps/web/src/app/api/pages/[pageId]/export/[format]/route.ts` — new export API

**Modify:**
- `packages/db/prisma/schema.prisma` (UserPreference + Workspace relations)
- `packages/trpc/src/routers/workspace.ts` (add `getActive`, `setActive`; set active in `create`)
- `packages/trpc/src/index.ts` (export `resolveActiveWorkspace` if not already barrel-exported)
- `apps/web/src/app/(protected)/app/page.tsx`
- `apps/web/src/app/(protected)/workspaces/page.tsx`
- `apps/web/src/app/(protected)/workspaces/[workspaceId]/*` (all → redirects)
- UI link files (Task 9): `chat/navigation.ts`, `use-page-actions.tsx`, `templates/*`, `favorites-section.tsx`, `page-tree-section.tsx`, `search-sidebar-section.tsx`, `search/search-dialog.tsx`, `search/use-search-hotkey.ts`, `page/page-renderer.tsx`, `workspace-layout-client.tsx`, `page/page-export-dialog.tsx`, `workspace-sidebar.tsx`, `settings/integrations/mcp/page.tsx`, `profile/page.tsx`, `settings/integration-card.tsx`
- `apps/web/src/app/api/files/upload/route.ts` (resolve active for attachments)
- Upload callers: `chat/use-draft-attachments.ts`, `kanban/task/task-attachments.tsx`, `lib/upload-handler.ts`
- `apps/web/src/server/page-export/embed-images.ts` (add `/pages/` link prefix)
- `apps/web/src/app/robots.ts`
- `packages/ui/test/chat-message-content.test.tsx` (fixture URL)

---

## Task 1: DB — add `activeWorkspaceId`

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (UserPreference ~597-611, Workspace ~327-357)
- Create: migration via prisma

- [ ] **Step 1: Add the field + relation to `UserPreference`**

In `packages/db/prisma/schema.prisma`, inside `model UserPreference`, after the `defaultWorkspaceId` line add:

```prisma
  activeWorkspaceId  String?  @map("active_workspace_id") @db.Uuid
```

After the existing `defaultWorkspace` relation line add:

```prisma
  activeWorkspace  Workspace? @relation("ActiveWorkspace", fields: [activeWorkspaceId], references: [id], onDelete: SetNull)
```

And add an index next to `@@index([defaultWorkspaceId])`:

```prisma
  @@index([activeWorkspaceId])
```

- [ ] **Step 2: Add the back-relation to `Workspace`**

In `model Workspace`, next to `defaultForUsers UserPreference[] @relation("DefaultWorkspace")` add:

```prisma
  activeForUsers        UserPreference[]       @relation("ActiveWorkspace")
```

- [ ] **Step 3: Create the migration + regenerate client**

Run (requires `docker compose up -d`):

```bash
pnpm --filter @repo/db exec prisma migrate dev --name add_active_workspace_id
```

Expected: a new migration folder under `packages/db/prisma/migrations/`, `ALTER TABLE "user_preferences" ADD COLUMN "active_workspace_id" uuid`, and `Generated Prisma Client`.

- [ ] **Step 4: Verify types compile**

Run: `pnpm --filter @repo/db check-types`
Expected: PASS (no errors).

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): add UserPreference.activeWorkspaceId"
```

---

## Task 2: `resolveActiveWorkspace` core helper

**Files:**
- Create: `packages/trpc/src/helpers/active-workspace.ts`
- Test: `packages/trpc/test/active-workspace.test.ts`

- [ ] **Step 1: Write the failing test (real-DB style, matches `workspace-usage.test.ts`)**

Create `packages/trpc/test/active-workspace.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { prisma } from '@repo/db'

import { resolveActiveWorkspace } from '../src/helpers/active-workspace'

const EMAIL_SUFFIX = '+activews-test@anynote.dev'

async function cleanFixtures() {
  await prisma.userPreference.deleteMany({
    where: { user: { email: { contains: EMAIL_SUFFIX } } },
  })
  await prisma.workspace.deleteMany({
    where: { createdBy: { email: { contains: EMAIL_SUFFIX } } },
  })
  await prisma.user.deleteMany({ where: { email: { contains: EMAIL_SUFFIX } } })
}

async function makeUser(label: string) {
  return prisma.user.create({
    data: {
      email: `${label}${EMAIL_SUFFIX}`,
      emailVerified: true,
      name: label,
      firstName: label,
      lastName: 'T',
    },
  })
}

async function makeWorkspace(ownerId: string, name: string) {
  const ws = await prisma.workspace.create({ data: { name, createdById: ownerId } })
  await prisma.workspaceMember.create({
    data: { workspaceId: ws.id, userId: ownerId, role: 'OWNER' },
  })
  return ws
}

describe('resolveActiveWorkspace', () => {
  beforeEach(cleanFixtures)

  it('returns null when the user has no workspace', async () => {
    const user = await makeUser('none')
    expect(await resolveActiveWorkspace(prisma, user.id)).toBeNull()
  })

  it('returns the stored active workspace when still a member', async () => {
    const user = await makeUser('active')
    const ws = await makeWorkspace(user.id, 'A')
    await prisma.userPreference.create({
      data: { userId: user.id, activeWorkspaceId: ws.id },
    })
    const result = await resolveActiveWorkspace(prisma, user.id)
    expect(result?.id).toBe(ws.id)
  })

  it('falls back to defaultWorkspaceId and repairs active when active is stale', async () => {
    const user = await makeUser('stale')
    const wsDefault = await makeWorkspace(user.id, 'D')
    await prisma.userPreference.create({
      data: {
        userId: user.id,
        defaultWorkspaceId: wsDefault.id,
        // a random non-member UUID as a stale active id
        activeWorkspaceId: '00000000-0000-0000-0000-0000000000ff',
      },
    })
    const result = await resolveActiveWorkspace(prisma, user.id)
    expect(result?.id).toBe(wsDefault.id)
    const pref = await prisma.userPreference.findUnique({ where: { userId: user.id } })
    expect(pref?.activeWorkspaceId).toBe(wsDefault.id)
  })

  it('falls back to the first workspace when no valid active or default', async () => {
    const user = await makeUser('first')
    const ws1 = await makeWorkspace(user.id, 'W1')
    await makeWorkspace(user.id, 'W2')
    const result = await resolveActiveWorkspace(prisma, user.id)
    expect(result?.id).toBe(ws1.id) // createdAt asc -> first created
    const pref = await prisma.userPreference.findUnique({ where: { userId: user.id } })
    expect(pref?.activeWorkspaceId).toBe(ws1.id)
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @repo/trpc exec vitest run active-workspace`
Expected: FAIL — `Cannot find module '../src/helpers/active-workspace'`.

- [ ] **Step 3: Implement the helper**

Create `packages/trpc/src/helpers/active-workspace.ts`:

```typescript
import type { PrismaClient, Workspace } from '@repo/db'

async function isMember(prisma: PrismaClient, workspaceId: string, userId: string) {
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  })
  return member !== null
}

/**
 * Resolve the workspace the user should currently be scoped to.
 * Order: stored active (if still a member) -> default (if member) -> first
 * workspace by createdAt. Repairs the stored activeWorkspaceId when it falls
 * back. Returns null only when the user has no workspace at all.
 *
 * The active workspace is a default-scope HINT, never an authorization: every
 * tRPC procedure still asserts membership on the workspace it is given.
 */
export async function resolveActiveWorkspace(
  prisma: PrismaClient,
  userId: string,
): Promise<Workspace | null> {
  const pref = await prisma.userPreference.findUnique({ where: { userId } })

  if (pref?.activeWorkspaceId && (await isMember(prisma, pref.activeWorkspaceId, userId))) {
    return prisma.workspace.findUnique({ where: { id: pref.activeWorkspaceId } })
  }

  let fallback: Workspace | null = null
  if (pref?.defaultWorkspaceId && (await isMember(prisma, pref.defaultWorkspaceId, userId))) {
    fallback = await prisma.workspace.findUnique({ where: { id: pref.defaultWorkspaceId } })
  }
  if (!fallback) {
    fallback = await prisma.workspace.findFirst({
      where: { members: { some: { userId } } },
      orderBy: { createdAt: 'asc' },
    })
  }
  if (!fallback) return null

  if (pref?.activeWorkspaceId !== fallback.id) {
    await prisma.userPreference.upsert({
      where: { userId },
      create: { userId, activeWorkspaceId: fallback.id },
      update: { activeWorkspaceId: fallback.id },
    })
  }
  return fallback
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run (requires `docker compose up -d`): `pnpm --filter @repo/trpc exec vitest run active-workspace`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/helpers/active-workspace.ts packages/trpc/test/active-workspace.test.ts
git commit -m "feat(trpc): add resolveActiveWorkspace helper"
```

---

## Task 3: `workspace.getActive` / `setActive` + active on create

**Files:**
- Modify: `packages/trpc/src/routers/workspace.ts`
- Test: `packages/trpc/test/active-workspace.test.ts` (append router tests)

- [ ] **Step 1: Add failing router tests**

Append to `packages/trpc/test/active-workspace.test.ts`:

```typescript
import { workspaceRouter } from '../src/routers/workspace'
import { createCallerFactory } from '../src/trpc'

function makeCaller(userId: string, email: string) {
  return createCallerFactory(workspaceRouter)({
    prisma,
    user: { id: userId, email },
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {} as never,
    returnUrlBase: 'http://localhost:3000',
  })
}

describe('workspace.getActive / setActive', () => {
  beforeEach(cleanFixtures)

  it('setActive writes the pref for a member and getActive returns it', async () => {
    const user = await makeUser('setget')
    const ws = await makeWorkspace(user.id, 'WS')
    const caller = makeCaller(user.id, user.email)

    const set = await caller.setActive({ workspaceId: ws.id })
    expect(set.id).toBe(ws.id)

    const active = await caller.getActive()
    expect(active?.id).toBe(ws.id)
  })

  it('setActive rejects a non-member', async () => {
    const owner = await makeUser('owner')
    const ws = await makeWorkspace(owner.id, 'WS')
    const stranger = await makeUser('stranger')
    const caller = makeCaller(stranger.id, stranger.email)

    await expect(caller.setActive({ workspaceId: ws.id })).rejects.toThrow()
  })

  it('create sets the new workspace as active', async () => {
    // create() requires a plan; mirror workspace-usage.test.ts by seeding a sub.
    const user = await makeUser('creator')
    const plan = await prisma.plan.findUniqueOrThrow({ where: { slug: 'personal' } })
    await prisma.subscription.create({
      data: { userId: user.id, planId: plan.id, status: 'ACTIVE' },
    })
    const caller = makeCaller(user.id, user.email)
    const ws = await caller.create({ name: 'New' })

    const pref = await prisma.userPreference.findUnique({ where: { userId: user.id } })
    expect(pref?.activeWorkspaceId).toBe(ws.id)
  })
})
```

Note: the `create` test also writes `subscription` rows — extend `cleanFixtures` to delete them:

```typescript
  await prisma.subscription.deleteMany({
    where: { user: { email: { contains: EMAIL_SUFFIX } } },
  })
```
(add this line before the `workspace.deleteMany` call in `cleanFixtures`).

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @repo/trpc exec vitest run active-workspace`
Expected: FAIL — `caller.getActive is not a function` / `caller.setActive is not a function`.

- [ ] **Step 3: Add the procedures to the router**

In `packages/trpc/src/routers/workspace.ts`, add the import at the top (after the existing helper imports):

```typescript
import { resolveActiveWorkspace } from '../helpers/active-workspace'
```

Inside `export const workspaceRouter = router({ ... })`, after `getDefault`, add:

```typescript
  getActive: protectedProcedure.query(async ({ ctx }) => {
    return resolveActiveWorkspace(ctx.prisma, ctx.user.id)
  }),

  setActive: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const member = await ctx.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: ctx.user.id } },
      })
      if (!member) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Вы не являетесь участником пространства' })
      }
      await ctx.prisma.userPreference.upsert({
        where: { userId: ctx.user.id },
        create: { userId: ctx.user.id, activeWorkspaceId: input.workspaceId },
        update: { activeWorkspaceId: input.workspaceId },
      })
      return ctx.prisma.workspace.findUniqueOrThrow({ where: { id: input.workspaceId } })
    }),
```

- [ ] **Step 4: Set active in `create`**

In `workspace.create`'s transaction, change the `userPreference.upsert` block (currently sets only `defaultWorkspaceId`) to also set active:

```typescript
        await tx.userPreference.upsert({
          where: { userId: ctx.user.id },
          create: {
            userId: ctx.user.id,
            defaultWorkspaceId: workspace.id,
            activeWorkspaceId: workspace.id,
          },
          update: { defaultWorkspaceId: workspace.id, activeWorkspaceId: workspace.id },
        })
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @repo/trpc exec vitest run active-workspace`
Expected: PASS — 7 tests total.

- [ ] **Step 6: Commit**

```bash
git add packages/trpc/src/routers/workspace.ts packages/trpc/test/active-workspace.test.ts
git commit -m "feat(trpc): add workspace.getActive/setActive and set active on create"
```

---

## Task 4: Neutral shell layout `(active)/layout.tsx`

**Files:**
- Create: `apps/web/src/app/(protected)/(active)/layout.tsx`

- [ ] **Step 1: Create the layout (port of `workspaces/[workspaceId]/layout.tsx`, no params)**

```tsx
import type { ReactNode } from 'react'

import { redirect } from 'next/navigation'

import { getWorkspaceFeatures } from '@repo/trpc'

import { requireSession } from '@/lib/get-session'
import { getServerTRPC } from '@/trpc/server'
import { PlanFeaturesProvider } from '@/components/workspace/plan-features-context'
import { WorkspaceLayoutClient } from '@/components/workspace/workspace-layout-client'

export default async function ActiveWorkspaceLayout({ children }: { children: ReactNode }) {
  const session = await requireSession()
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getActive()
  if (!workspace) redirect('/workspaces/new')

  const pages = await trpc.page.listByWorkspace({ workspaceId: workspace.id })
  const features = await getWorkspaceFeatures(workspace.id)

  return (
    <PlanFeaturesProvider features={features}>
      <WorkspaceLayoutClient
        workspace={{ id: workspace.id, name: workspace.name, icon: workspace.icon }}
        features={features}
        pages={pages}
        user={{
          id: session.user.id,
          firstName: session.user.firstName,
          lastName: session.user.lastName,
          email: session.user.email,
          image: session.user.image ?? null,
        }}
      >
        {children}
      </WorkspaceLayoutClient>
    </PlanFeaturesProvider>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter web check-types`
Expected: PASS (the route group has no pages yet — Next allows a layout with no sibling pages; if Next complains about an empty group, Task 5 adds pages immediately, so run check-types again after Task 5).

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(protected)/(active)/layout.tsx"
git commit -m "feat(web): add neutral (active) workspace shell layout"
```

---

## Task 5: Neutral resource pages

**Files:**
- Create: pages under `apps/web/src/app/(protected)/(active)/`

Each page is a near-copy of its `workspaces/[workspaceId]/...` counterpart, but reads the workspace from `workspace.getActive()` (or the resource) instead of `params`.

- [ ] **Step 1: `trash/page.tsx`**

Create `apps/web/src/app/(protected)/(active)/trash/page.tsx`. It is a client component today taking `params`; rewrite to resolve workspaceId from a small RSC wrapper. Simplest: make a server page that resolves the active workspace and passes `workspaceId` to a client body. Create the server page:

```tsx
import { redirect } from 'next/navigation'

import { getServerTRPC } from '@/trpc/server'
import { TrashPageBody } from '@/components/workspace/trash-page-body'

export default async function TrashPage() {
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getActive()
  if (!workspace) redirect('/workspaces/new')
  return <TrashPageBody workspaceId={workspace.id} />
}
```

Then move the existing client component body into `apps/web/src/components/workspace/trash-page-body.tsx`: copy the entire current `workspaces/[workspaceId]/trash/page.tsx` content, rename the default export to a named `export function TrashPageBody({ workspaceId }: { workspaceId: string })`, and replace its `const { workspaceId } = use(params)` + `Props`/`use` import with the `workspaceId` prop. Keep `'use client'` at the top.

- [ ] **Step 2: `templates/page.tsx`**

```tsx
import { redirect } from 'next/navigation'

import { getServerTRPC } from '@/trpc/server'
import { TemplatesPage } from '@/components/templates/templates-page'

export default async function TemplatesRoute() {
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getActive()
  if (!workspace) redirect('/workspaces/new')
  return <TemplatesPage workspaceId={workspace.id} />
}
```

- [ ] **Step 3: `templates/[templateId]/page.tsx`**

```tsx
import { redirect } from 'next/navigation'

import { getServerTRPC } from '@/trpc/server'
import { TemplateEditor } from '@/components/templates/template-editor'

export default async function TemplateEditorRoute({
  params,
}: {
  params: Promise<{ templateId: string }>
}) {
  const { templateId } = await params
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getActive()
  if (!workspace) redirect('/workspaces/new')
  return <TemplateEditor workspaceId={workspace.id} templateId={templateId} />
}
```

- [ ] **Step 4: `chats/new/page.tsx`**

```tsx
import { redirect } from 'next/navigation'

import { getServerTRPC } from '@/trpc/server'
import { WorkspaceChatClient } from '@/components/workspace/chat/workspace-chat-client'

export default async function NewChatRoute() {
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getActive()
  if (!workspace) redirect('/workspaces/new')
  return <WorkspaceChatClient chatId={null} initialMessages={[]} workspaceId={workspace.id} />
}
```

- [ ] **Step 5: `chats/[chatId]/page.tsx` (with active-workspace switch)**

```tsx
import { notFound, redirect } from 'next/navigation'
import { TRPCError } from '@trpc/server'

import { getServerTRPC } from '@/trpc/server'
import { WorkspaceChatClient } from '@/components/workspace/chat/workspace-chat-client'

function isNotFoundTrpcError(error: unknown): boolean {
  if (error instanceof TRPCError) return error.code === 'NOT_FOUND'
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'NOT_FOUND'
  )
}

export default async function ChatRoute({ params }: { params: Promise<{ chatId: string }> }) {
  const { chatId } = await params
  const trpc = await getServerTRPC()

  let chat
  try {
    chat = await trpc.chat.getChat({ chatId })
  } catch (error) {
    if (isNotFoundTrpcError(error)) notFound()
    throw error
  }

  const active = await trpc.workspace.getActive()
  if (!active || active.id !== chat.chat.workspaceId) {
    await trpc.workspace.setActive({ workspaceId: chat.chat.workspaceId })
    redirect(`/chats/${chatId}`)
  }

  return (
    <WorkspaceChatClient
      chatId={chatId}
      initialMessages={chat.messages}
      workspaceId={chat.chat.workspaceId}
    />
  )
}
```

(Confirm `chat.getChat` returns `{ chat: { workspaceId }, messages }` — it does; `assertChatAccess` returns the chat row which has `workspaceId`.)

- [ ] **Step 6: `pages/[pageId]/page.tsx` (with active-workspace switch)**

Copy `workspaces/[workspaceId]/pages/[pageId]/page.tsx`, then change the signature and add the switch. Full file:

```tsx
import { notFound, redirect } from 'next/navigation'

import { Box } from '@repo/ui/components'

import { requireSession } from '@/lib/get-session'
import { getServerTRPC } from '@/trpc/server'
import { PageRenderer } from '@/components/page/page-renderer'
import { PageHeader } from '@/components/page/page-header'
import { PAGE_COLUMN_CLASS, pageColumnSx } from '@/components/page/column-sx'

const COLORS = ['#1976d2', '#9c27b0', '#2e7d32', '#ed6c02', '#0288d1', '#d32f2f']

function colorFor(userId: string): string {
  let hash = 0
  for (const ch of userId) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return COLORS[Math.abs(hash) % COLORS.length]!
}

export default async function PageRoute({ params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params
  const session = await requireSession()
  const trpc = await getServerTRPC()
  const page = await trpc.page.getById({ id: pageId })
  if (!page) notFound()

  const active = await trpc.workspace.getActive()
  if (!active || active.id !== page.workspaceId) {
    await trpc.workspace.setActive({ workspaceId: page.workspaceId })
    redirect(`/pages/${pageId}`)
  }

  const displayName =
    [session.user.firstName, session.user.lastName].filter(Boolean).join(' ').trim() ||
    session.user.email

  const isFullBleed =
    page.type === 'EXCALIDRAW' ||
    page.type === 'GENOGRAM' ||
    page.type === 'MERMAID' ||
    page.type === 'PLANTUML' ||
    page.type === 'LIKEC4' ||
    page.type === 'DRAWIO' ||
    page.type === 'KANBAN'

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {!isFullBleed && (
        <Box className={PAGE_COLUMN_CLASS} sx={{ ...pageColumnSx, pt: 4, pb: 1 }}>
          <PageHeader
            id={page.id}
            workspaceId={page.workspaceId}
            initialTitle={page.title}
            initialIcon={page.icon}
          />
        </Box>
      )}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <PageRenderer
          page={{ id: page.id, type: page.type, contentYjs: page.contentYjs }}
          workspaceId={page.workspaceId}
          user={{ id: session.user.id, name: displayName, color: colorFor(session.user.id) }}
        />
      </Box>
    </Box>
  )
}
```

- [ ] **Step 7: `pages/[pageId]/loading.tsx`**

Copy the existing `workspaces/[workspaceId]/pages/[pageId]/loading.tsx` verbatim into `apps/web/src/app/(protected)/(active)/pages/[pageId]/loading.tsx` (no changes — it takes no params).

- [ ] **Step 8: Type-check**

Run: `pnpm --filter web check-types`
Expected: PASS.

- [ ] **Step 9: Smoke test in dev**

Run `pnpm --filter web dev`, sign in, and curl/visit `/app`. After Task 7 wires `/app`, visiting a page should land on `/pages/{id}` (not `/workspaces/...`). (Defer this verification to after Task 7; for now just confirm the pages compile.)

- [ ] **Step 10: Commit**

```bash
git add "apps/web/src/app/(protected)/(active)" apps/web/src/components/workspace/trash-page-body.tsx
git commit -m "feat(web): add neutral resource pages under (active)"
```

---

## Task 6: `/app` and `/workspaces` (no-id) redirects

**Files:**
- Modify: `apps/web/src/app/(protected)/app/page.tsx`
- Modify: `apps/web/src/app/(protected)/workspaces/page.tsx`

- [ ] **Step 1: Rewrite `/app/page.tsx` to use active workspace + neutral URLs**

```tsx
import { redirect } from 'next/navigation'

import { getServerTRPC } from '@/trpc/server'
import { firstPageInTreeOrder } from '@/components/workspace/types'

export default async function AppIndexPage() {
  const trpc = await getServerTRPC()
  const workspace = await trpc.workspace.getActive()
  if (!workspace) redirect('/workspaces/new')

  const pages = await trpc.page.listByWorkspace({ workspaceId: workspace.id })
  const first = firstPageInTreeOrder(pages)
  redirect(first ? `/pages/${first.id}` : '/chats/new')
}
```

- [ ] **Step 2: Rewrite `/workspaces/page.tsx` to bounce to `/app`**

```tsx
import { redirect } from 'next/navigation'

export default async function WorkspacesIndexPage() {
  redirect('/app')
}
```

- [ ] **Step 3: Type-check**

Run: `pnpm --filter web check-types`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(protected)/app/page.tsx" "apps/web/src/app/(protected)/workspaces/page.tsx"
git commit -m "feat(web): point /app and /workspaces at active workspace + neutral URLs"
```

---

## Task 7: Legacy `/workspaces/[workspaceId]/*` → redirects

**Files:**
- Modify: every page under `apps/web/src/app/(protected)/workspaces/[workspaceId]/` EXCEPT `new/`.

Each becomes a server component that: resolves the session via tRPC; verifies membership of `:workspaceId`; for resource sub-paths verifies the resource belongs to `:workspaceId`; calls `workspace.setActive`; then `redirect`s to the neutral URL.

- [ ] **Step 1: `workspaces/[workspaceId]/page.tsx` → `/app`**

```tsx
import { notFound, redirect } from 'next/navigation'

import { getServerTRPC } from '@/trpc/server'

export default async function LegacyWorkspaceRoot({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  const trpc = await getServerTRPC()
  const ws = await trpc.workspace.getById({ id: workspaceId })
  if (!ws) notFound()
  await trpc.workspace.setActive({ workspaceId })
  redirect('/app')
}
```

- [ ] **Step 2: `workspaces/[workspaceId]/settings/page.tsx` → `/app`**

Same as Step 1 but the file is `settings/page.tsx` (settings is a dialog now, so land on `/app`):

```tsx
import { notFound, redirect } from 'next/navigation'

import { getServerTRPC } from '@/trpc/server'

export default async function LegacyWorkspaceSettings({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  const trpc = await getServerTRPC()
  const ws = await trpc.workspace.getById({ id: workspaceId })
  if (!ws) notFound()
  await trpc.workspace.setActive({ workspaceId })
  redirect('/app')
}
```

- [ ] **Step 3: `workspaces/[workspaceId]/templates/page.tsx` → `/templates`**

```tsx
import { notFound, redirect } from 'next/navigation'

import { getServerTRPC } from '@/trpc/server'

export default async function LegacyTemplates({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  const trpc = await getServerTRPC()
  const ws = await trpc.workspace.getById({ id: workspaceId })
  if (!ws) notFound()
  await trpc.workspace.setActive({ workspaceId })
  redirect('/templates')
}
```

- [ ] **Step 4: `workspaces/[workspaceId]/templates/[templateId]/page.tsx` → `/templates/:id`**

```tsx
import { notFound, redirect } from 'next/navigation'

import { getServerTRPC } from '@/trpc/server'

export default async function LegacyTemplateEditor({
  params,
}: {
  params: Promise<{ workspaceId: string; templateId: string }>
}) {
  const { workspaceId, templateId } = await params
  const trpc = await getServerTRPC()
  const ws = await trpc.workspace.getById({ id: workspaceId })
  if (!ws) notFound()
  await trpc.workspace.setActive({ workspaceId })
  redirect(`/templates/${templateId}`)
}
```

- [ ] **Step 5: `workspaces/[workspaceId]/trash/page.tsx` → `/trash`**

This file is currently a client component. Replace its entire content with a server redirect:

```tsx
import { notFound, redirect } from 'next/navigation'

import { getServerTRPC } from '@/trpc/server'

export default async function LegacyTrash({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  const trpc = await getServerTRPC()
  const ws = await trpc.workspace.getById({ id: workspaceId })
  if (!ws) notFound()
  await trpc.workspace.setActive({ workspaceId })
  redirect('/trash')
}
```

- [ ] **Step 6: `workspaces/[workspaceId]/chats/page.tsx` → `/chats/new`**

```tsx
import { notFound, redirect } from 'next/navigation'

import { getServerTRPC } from '@/trpc/server'

export default async function LegacyChatsIndex({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  const trpc = await getServerTRPC()
  const ws = await trpc.workspace.getById({ id: workspaceId })
  if (!ws) notFound()
  await trpc.workspace.setActive({ workspaceId })
  redirect('/chats/new')
}
```

- [ ] **Step 7: `workspaces/[workspaceId]/chats/new/page.tsx` → `/chats/new`**

```tsx
import { notFound, redirect } from 'next/navigation'

import { getServerTRPC } from '@/trpc/server'

export default async function LegacyNewChat({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  const trpc = await getServerTRPC()
  const ws = await trpc.workspace.getById({ id: workspaceId })
  if (!ws) notFound()
  await trpc.workspace.setActive({ workspaceId })
  redirect('/chats/new')
}
```

- [ ] **Step 8: `workspaces/[workspaceId]/chats/[chatId]/page.tsx` → `/chats/:id` (verify resource workspace)**

```tsx
import { notFound, redirect } from 'next/navigation'
import { TRPCError } from '@trpc/server'

import { getServerTRPC } from '@/trpc/server'

function isNotFoundTrpcError(error: unknown): boolean {
  if (error instanceof TRPCError) return error.code === 'NOT_FOUND'
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'NOT_FOUND'
  )
}

export default async function LegacyChat({
  params,
}: {
  params: Promise<{ workspaceId: string; chatId: string }>
}) {
  const { workspaceId, chatId } = await params
  const trpc = await getServerTRPC()
  let chat
  try {
    chat = await trpc.chat.getChat({ chatId })
  } catch (error) {
    if (isNotFoundTrpcError(error)) notFound()
    throw error
  }
  if (chat.chat.workspaceId !== workspaceId) notFound()
  await trpc.workspace.setActive({ workspaceId })
  redirect(`/chats/${chatId}`)
}
```

- [ ] **Step 9: `workspaces/[workspaceId]/pages/[pageId]/page.tsx` → `/pages/:id` (verify resource workspace)**

```tsx
import { notFound, redirect } from 'next/navigation'

import { getServerTRPC } from '@/trpc/server'

export default async function LegacyPage({
  params,
}: {
  params: Promise<{ workspaceId: string; pageId: string }>
}) {
  const { workspaceId, pageId } = await params
  const trpc = await getServerTRPC()
  const page = await trpc.page.getById({ id: pageId })
  if (!page) notFound()
  if (page.workspaceId !== workspaceId) notFound()
  await trpc.workspace.setActive({ workspaceId })
  redirect(`/pages/${pageId}`)
}
```

- [ ] **Step 10: Delete the now-redundant legacy layout & loading**

The legacy `workspaces/[workspaceId]/layout.tsx` rendered the full shell. Since every legacy page now redirects before rendering children, the layout would still wrap them briefly and call `page.listByWorkspace`. Replace it with a pass-through to avoid double-loading the shell:

```tsx
export default function LegacyWorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
```

Also delete `workspaces/[workspaceId]/pages/[pageId]/loading.tsx` and `workspaces/[workspaceId]/chats/layout.tsx` is already a pass-through — leave it. (Removing the loading.tsx avoids a flash of the page skeleton before the redirect.)

```bash
git rm "apps/web/src/app/(protected)/workspaces/[workspaceId]/pages/[pageId]/loading.tsx"
```

- [ ] **Step 11: Type-check**

Run: `pnpm --filter web check-types`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add "apps/web/src/app/(protected)/workspaces/[workspaceId]"
git commit -m "feat(web): turn legacy /workspaces/[id] routes into safe redirects"
```

---

## Task 8: Chat navigation helper → neutral URL

**Files:**
- Modify: `apps/web/src/components/workspace/chat/navigation.ts`
- Test: `apps/web/src/components/workspace/chat/navigation.test.ts` (create)

- [ ] **Step 1: Write a failing test**

Create `apps/web/src/components/workspace/chat/navigation.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest'

import { buildChatHref, navigateToChat } from './navigation'

describe('chat navigation', () => {
  it('buildChatHref returns a neutral /chats/:id URL', () => {
    expect(buildChatHref('chat-123')).toBe('/chats/chat-123')
  })

  it('navigateToChat pushes the neutral URL', () => {
    const push = vi.fn()
    navigateToChat({ push }, 'chat-123')
    expect(push).toHaveBeenCalledWith('/chats/chat-123', { scroll: false })
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter web exec vitest run navigation`
Expected: FAIL — current `buildChatHref(workspaceId, chatId)` arity / output mismatch.

- [ ] **Step 3: Update the helper**

Rewrite `apps/web/src/components/workspace/chat/navigation.ts`:

```typescript
type RouterLike = {
  push: (href: string, options?: { scroll?: boolean }) => void
}

export function buildChatHref(chatId: string) {
  return `/chats/${chatId}`
}

export function navigateToChat(router: RouterLike, chatId: string) {
  router.push(buildChatHref(chatId), { scroll: false })
}
```

- [ ] **Step 4: Update callers**

Find callers: `grep -rn "buildChatHref\|navigateToChat" apps/web/src`. For each, drop the `workspaceId` argument. (Expected callers: `search-sidebar-section.tsx`, `workspace-chat-client.tsx` or its hooks — update whichever pass `workspaceId` first.)

- [ ] **Step 5: Run the test + type-check**

Run: `pnpm --filter web exec vitest run navigation && pnpm --filter web check-types`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/workspace/chat/navigation.ts apps/web/src/components/workspace/chat/navigation.test.ts
git commit -m "feat(web): neutral chat href helper"
```

---

## Task 9: Replace all remaining `/workspaces/${id}/...` UI links

**Files (modify):** each file below. The pattern is mechanical: replace the URL template; keep `workspaceId` props (still used for tRPC), only stop using them for URL building.

- [ ] **Step 1: `hooks/use-page-actions.tsx`**
  - L54: `router.push(`/pages/${data.id}`)`
  - L64: `const url = `${window.location.origin}/pages/${page.id}`` 
  - L70: export fetch → `/api/pages/${page.id}/export/md` (new API, Task 11)

- [ ] **Step 2: `components/templates/use-create-page-flow.ts` L25:** `router.push(`/pages/${data.id}`)`

- [ ] **Step 3: `components/templates/templates-page.tsx` L72:** `href={`/templates/${t.id}`}`

- [ ] **Step 4: `components/templates/template-editor.tsx` L94:** `router.push('/templates')`

- [ ] **Step 5: `components/workspace/favorites-section.tsx`**
  - L66: `const isActive = pathname === `/pages/${page.id}``
  - L91: `href={`/pages/${page.id}`}`

- [ ] **Step 6: `components/workspace/page-tree-section.tsx`**
  - L88: `const isCurrentPage = pathname === `/pages/${item.id}``
  - L136: `href={`/pages/${item.id}`}`

- [ ] **Step 7: `components/workspace/search-sidebar-section.tsx`**
  - L71: `const isActive = pathname === `/chats/${chat.id}``
  - L96: `if (isActive) router.push('/chats/new')`
  - L407: `onClick={() => router.push('/chats/new')}`

- [ ] **Step 8: `components/search/search-dialog.tsx` L96:** `router.push(`/pages/${pageId}${hash}`)`

- [ ] **Step 9: `components/search/use-search-hotkey.ts` L46:** `current.router.push('/chats/new')` (the `current.workspaceId` field may become unused for this push — leave the hook's other usages intact)

- [ ] **Step 10: `components/page/page-renderer.tsx`**
  - L269: `router.push(`/pages/${pageId}`)`
  - L368: `router.push(`/pages/${moveTarget}`)`

- [ ] **Step 11: `components/workspace/workspace-layout-client.tsx`**
  - L105: `const base = { label: 'Чаты', href: '/chats/new' }`
  - L129: `href: idx === chain.length - 1 ? undefined : `/pages/${p.id}``

- [ ] **Step 12: `app/(protected)/settings/integrations/mcp/page.tsx` L8:** `redirect(workspace ? '/app' : '/workspaces')` → since `/workspaces` now bounces to `/app`, just `redirect('/app')` when workspace exists, else `redirect('/workspaces/new')`. Read the file first; keep its existing workspace-existence check.

- [ ] **Step 13: `app/(protected)/profile/page.tsx` L134:** `<Link href="/app">` (workspace row link → active app). Lines 84/98 (`/workspaces/new`) stay.

- [ ] **Step 14: `components/settings/integration-card.tsx` L101:** stays `/workspaces/new` (create-workspace CTA) — no change. (Listed for completeness; verify it's the create CTA.)

- [ ] **Step 15: Type-check + targeted vitest**

Run: `pnpm --filter web check-types`
Expected: PASS. Fix any "declared but never read" on now-unused `workspaceId` params by prefixing `_` only if lint flags them; prefer keeping them if still passed to tRPC.

- [ ] **Step 16: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): switch all page/chat/template/trash links to neutral URLs"
```

---

## Task 10: Workspace switcher → `setActive`

**Files:**
- Modify: `apps/web/src/components/workspace/workspace-sidebar.tsx` (L171-185 switcher MenuItems)

- [ ] **Step 1: Replace the per-workspace `<MenuItem component={Link} href=...>` with a `setActive` action**

Add near the other hooks in `WorkspaceSidebar`:

```tsx
  const utils = trpc.useUtils()
  const router = useRouter() // import { useRouter } from 'next/navigation'
  const setActive = trpc.workspace.setActive.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.page.listByWorkspace.invalidate(),
        utils.page.listFavorites.invalidate(),
        utils.chat.listChats.invalidate(),
        utils.workspace.getActive.invalidate(),
      ])
      router.push('/app')
      router.refresh()
    },
  })
```

Replace the workspace `MenuItem` block (L171-185) with:

```tsx
        {(allWorkspaces.data ?? []).map((w) => (
          <MenuItem
            key={w.id}
            onClick={() => {
              closeSwitcher()
              if (w.id !== workspace.id) setActive.mutate({ workspaceId: w.id })
            }}
            selected={w.id === workspace.id}
            sx={{ gap: 1 }}
          >
            <WorkspaceAvatar icon={w.icon} size={22} />
            <Typography variant="body2" noWrap>
              {w.name}
            </Typography>
          </MenuItem>
        ))}
```

Keep the "Создать пространство" item linking to `/workspaces/new`. Remove the now-unused `Link` import only if no other usage remains (the `NavItem` `component={Link}` and the create item still use it — so keep `Link`).

- [ ] **Step 2: Type-check**

Run: `pnpm --filter web check-types`
Expected: PASS.

- [ ] **Step 3: Manual verify in dev**

`pnpm --filter web dev`, open the switcher with 2+ workspaces, pick the other one → URL goes to `/app` (then `/pages/...`), sidebar shows the other workspace's pages. The address bar never shows `/workspaces/{uuid}`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/workspace/workspace-sidebar.tsx
git commit -m "feat(web): workspace switcher uses setActive instead of /workspaces/:id link"
```

---

## Task 11: Export API at `/api/pages/[pageId]/export/[format]`

**Files:**
- Create: `apps/web/src/app/api/pages/[pageId]/export/[format]/route.ts`
- Modify: `apps/web/src/app/api/workspaces/[workspaceId]/pages/[pageId]/export/[format]/route.ts` (→ redirect)
- Modify: `apps/web/src/components/page/page-export-dialog.tsx` (L33 URL builder)

- [ ] **Step 1: Create the new export route (port without workspaceId param)**

```typescript
import { z } from 'zod'
import type { NextRequest } from 'next/server'
import { prisma } from '@repo/db'
import { storage } from '@repo/storage'
import { domain } from '@/lib/domain'
import { isDomainError } from '@repo/domain/errors.ts'

import { getSession } from '@/lib/get-session'
import {
  buildFilename,
  contentDisposition,
  GotenbergTimeoutError,
  GotenbergUnreachableError,
  GotenbergUpstreamError,
  htmlToMarkdown,
  htmlToPdf,
  renderPageBodyHtml,
  wrapHtmlDocument,
} from '@/server/page-export'

export const runtime = 'nodejs'

const FormatSchema = z.enum(['pdf', 'html', 'md'])
const ParamsSchema = z.object({
  pageId: z.string().uuid(),
  format: FormatSchema,
})

const NOT_FOUND = new Response(null, { status: 404 })
const FORBIDDEN = Response.json({ error: 'Forbidden' }, { status: 403 })

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ pageId: string; format: string }> },
) {
  const parsed = ParamsSchema.safeParse(await ctx.params)
  if (!parsed.success) return NOT_FOUND
  const { pageId, format } = parsed.data

  const session = await getSession()
  if (!session) {
    const next = new URL(req.url).pathname
    return Response.redirect(new URL(`/sign-in?next=${encodeURIComponent(next)}`, req.url), 302)
  }

  const page = await prisma.page.findFirst({
    where: { id: pageId, deletedAt: null, type: 'TEXT' },
    select: { id: true, title: true, icon: true, content: true, workspaceId: true },
  })
  if (!page) return NOT_FOUND

  try {
    await domain.workspace.assertMembership(session.user.id, page.workspaceId)
  } catch (e) {
    if (isDomainError(e) && e.httpStatus === 403) return FORBIDDEN
    throw e
  }

  const titleForOutput = (page.title ?? '').trim() || 'Без названия'
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? new URL(req.url).origin
  const bodyHtml = await renderPageBodyHtml(page, { prisma, storage, baseUrl })
  const filename = buildFilename(page.title, format)

  if (format === 'html') {
    const fullHtml = wrapHtmlDocument({ bodyHtml, title: titleForOutput, icon: page.icon })
    return new Response(fullHtml, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-disposition': contentDisposition(filename),
        'cache-control': 'private, no-store',
      },
    })
  }

  if (format === 'md') {
    const md = `# ${titleForOutput}\n\n${htmlToMarkdown(bodyHtml)}`
    return new Response(md, {
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': contentDisposition(filename),
        'cache-control': 'private, no-store',
      },
    })
  }

  const fullHtml = wrapHtmlDocument({ bodyHtml, title: titleForOutput, icon: page.icon })
  try {
    const pdfStream = await htmlToPdf(fullHtml)
    return new Response(pdfStream, {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': contentDisposition(filename),
        'cache-control': 'private, no-store',
      },
    })
  } catch (e) {
    if (e instanceof GotenbergTimeoutError) {
      return Response.json({ error: 'PDF generation timed out' }, { status: 504 })
    }
    if (e instanceof GotenbergUpstreamError || e instanceof GotenbergUnreachableError) {
      return Response.json({ error: 'PDF service unavailable' }, { status: 502 })
    }
    throw e
  }
}
```

(Note: `renderPageBodyHtml` is called with `page` that now includes `workspaceId` in the select — it ignores extra fields; confirm by reading `@/server/page-export` signature. If it requires an exact shape, pass `{ id, title, icon, content }`.)

- [ ] **Step 2: Make the old export route a redirect**

Replace the body of `apps/web/src/app/api/workspaces/[workspaceId]/pages/[pageId]/export/[format]/route.ts` GET with a membership-checked 307 to the new URL:

```typescript
import { z } from 'zod'
import type { NextRequest } from 'next/server'

export const runtime = 'nodejs'

const ParamsSchema = z.object({
  workspaceId: z.string().uuid(),
  pageId: z.string().uuid(),
  format: z.enum(['pdf', 'html', 'md']),
})

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ workspaceId: string; pageId: string; format: string }> },
) {
  const parsed = ParamsSchema.safeParse(await ctx.params)
  if (!parsed.success) return new Response(null, { status: 404 })
  const { pageId, format } = parsed.data
  return Response.redirect(new URL(`/api/pages/${pageId}/export/${format}`, req.url), 307)
}
```

(The new route re-checks session + membership, so dropping the workspace check here is safe.)

- [ ] **Step 3: Update `page-export-dialog.tsx`**

L33: change the URL builder to `return `/api/pages/${pageId}/export/${format}`` and drop the `workspaceId` parameter from the function + its callers.

- [ ] **Step 4: Type-check**

Run: `pnpm --filter web check-types`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/api/pages" "apps/web/src/app/api/workspaces" apps/web/src/components/page/page-export-dialog.tsx apps/web/src/hooks/use-page-actions.tsx
git commit -m "feat(web): page export API by pageId; legacy export redirects"
```

---

## Task 12: Attachment upload resolves active workspace server-side

**Files:**
- Create: `apps/web/src/lib/active-workspace.ts`
- Modify: `apps/web/src/app/api/files/upload/route.ts`
- Modify: `apps/web/src/components/workspace/chat/use-draft-attachments.ts`, `apps/web/src/components/kanban/task/task-attachments.tsx`, `apps/web/src/lib/upload-handler.ts`

- [ ] **Step 1: Add an app-side resolver wrapper**

Create `apps/web/src/lib/active-workspace.ts`:

```typescript
import 'server-only'

import { prisma } from '@repo/db'
import { resolveActiveWorkspace } from '@repo/trpc'

export function getActiveWorkspaceForUser(userId: string) {
  return resolveActiveWorkspace(prisma, userId)
}
```

(Confirm `resolveActiveWorkspace` is exported from `@repo/trpc` root barrel; if not, add `export { resolveActiveWorkspace } from './helpers/active-workspace'` to `packages/trpc/src/index.ts`.)

- [ ] **Step 2: Update the upload route to resolve active for attachments**

In `apps/web/src/app/api/files/upload/route.ts`:
- Import: `import { getActiveWorkspaceForUser } from '@/lib/active-workspace'`
- Remove the `workspaceIdParam` reads (L25) and the `kind === 'attachment' && !workspaceIdParam` 400 (L35-37).
- After confirming `kind === 'attachment'`, resolve the workspace:

```typescript
  let attachmentWorkspaceId: string | null = null
  if (kind === 'attachment') {
    const ws = await getActiveWorkspaceForUser(session.user.id)
    if (!ws) {
      return Response.json({ error: 'No active workspace' }, { status: 400 })
    }
    attachmentWorkspaceId = ws.id
    // membership is implied by resolveActiveWorkspace (it only returns a ws the
    // user is a member of), so the explicit member lookup can be dropped.
  }
```

- Replace every later `workspaceIdParam!` usage with `attachmentWorkspaceId!`, and set `const workspaceId = kind === 'attachment' ? attachmentWorkspaceId : null` (L91).
- Keep the `kind === 'avatar' && workspaceIdParam` guard removed (avatar never sends workspaceId now). Keep avatar logic unchanged.

- [ ] **Step 3: Drop `workspaceId` from upload callers**

- `use-draft-attachments.ts` L35: `fetch('/api/files/upload?kind=attachment', ...)`
- `task-attachments.tsx` L62: `fetch('/api/files/upload?kind=attachment', ...)`
- `lib/upload-handler.ts` L14: `fetch('/api/files/upload?kind=attachment', ...)` — and remove `args.workspaceId` from the call site / type if it becomes unused. Read each file; if `workspaceId` is part of the args type and no longer used, remove it from the type and callers, or keep it if used elsewhere.

- [ ] **Step 4: Type-check**

Run: `pnpm --filter web check-types`
Expected: PASS.

- [ ] **Step 5: Manual verify**

In dev, paste/drop an image into a page editor and add a Kanban task attachment → both upload successfully without `workspaceId` in the request URL (check Network tab).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/active-workspace.ts apps/web/src/app/api/files/upload/route.ts apps/web/src/components/workspace/chat/use-draft-attachments.ts apps/web/src/components/kanban/task/task-attachments.tsx apps/web/src/lib/upload-handler.ts packages/trpc/src/index.ts
git commit -m "feat(web): attachment upload resolves active workspace server-side"
```

---

## Task 13: Export link rewriting + robots

**Files:**
- Modify: `apps/web/src/server/page-export/embed-images.ts` (L7, L89)
- Modify: `apps/web/src/app/robots.ts`

> Note: `packages/ui/test/chat-message-content.test.tsx` L140 feeds a
> `/workspaces/.../pages/...` URL but only asserts the rendered link's `href`
> equals the input (scheme-agnostic URL *detection*), and chat/notification
> links intentionally stay on the legacy scheme (decision 3). So this fixture
> needs **no change** — do not touch it.

- [ ] **Step 1: Add `/pages/` to export link rewriting**

In `embed-images.ts`, alongside `const PAGE_PATH_PREFIX = '/workspaces/'`, add:

```typescript
const NEUTRAL_PAGE_PATH_PREFIX = '/pages/'
```

In the link-rewrite loop (~L89), extend the condition:

```typescript
    if (href.startsWith(PAGE_PATH_PREFIX) || href.startsWith(NEUTRAL_PAGE_PATH_PREFIX)) {
      a.setAttribute('href', `${ctx.baseUrl}${href}`)
    } else if (href.startsWith(FILE_PATH_PREFIX)) {
```

- [ ] **Step 2: Update robots.ts disallow list**

In `apps/web/src/app/robots.ts`, add to the `disallow` array (next to `'/workspaces/'`):

```typescript
          '/pages/',
          '/chats/',
          '/templates/',
          '/trash',
          '/app',
```

- [ ] **Step 3: Run the affected tests**

Run: `pnpm --filter web check-types`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/server/page-export/embed-images.ts apps/web/src/app/robots.ts
git commit -m "chore(web): export link rewrite and robots for neutral URLs"
```

---

## Task 14: Full gate run + cleanup

**Files:** none new — verification only.

- [ ] **Step 1: Run focused suites**

```bash
pnpm --filter @repo/trpc exec vitest run active-workspace
pnpm --filter web exec vitest run navigation
```
Expected: PASS.

- [ ] **Step 2: Grep for any remaining hardcoded workspace URLs in user-facing code**

Run:
```bash
grep -rn "workspaces/\${" apps/web/src --include='*.ts' --include='*.tsx' | grep -v "/workspaces/new\|/workspaces/\${workspace.id}\`,\$"
```
Expected: only legitimate remainders — `/workspaces/new` links, the legacy redirect routes (which intentionally still reference the path in `redirect()` targets — actually they redirect TO neutral URLs, so they shouldn't build `/workspaces/${id}` at all), the `workspace.ts` invite-notification `link` (intentionally legacy, per decision 3), and `packages/notifications` / `packages/mail` (intentionally legacy). Anything else under `apps/web/src/components` or `hooks` building `/workspaces/${id}/pages|chats|templates|trash` is a miss — fix it.

- [ ] **Step 3: check-types + lint + test across the repo**

```bash
pnpm check-types
pnpm lint
pnpm test
```
Expected: PASS. (`pnpm test` runs the real-DB trpc suite — ensure `docker compose up -d`.)

- [ ] **Step 4: Manual end-to-end in dev**

`pnpm --filter web dev`. Verify:
- `/app` → lands on `/pages/{id}` or `/chats/new`, never `/workspaces/...`.
- Click a page in the tree → `/pages/{id}`.
- Open a chat → `/chats/{id}`; new chat → `/chats/new`.
- Templates → `/templates`, open one → `/templates/{id}`; trash → `/trash`.
- Switcher → switches workspace, URL stays neutral.
- Paste an old `/workspaces/{id}/pages/{pid}` URL → redirects to `/pages/{pid}` and sets that workspace active.
- An old URL with mismatched workspace/page → 404.

- [ ] **Step 5: Final commit (if any fixes from Steps 2-4)**

```bash
git add -A
git commit -m "fix(web): final neutral-URL cleanups from gate run"
```

---

## Self-review notes (for the implementer)

- **Active workspace is a hint, not auth.** Every list/mutation still asserts
  membership; direct-resource pages use `getById`/`getChat` which filter by
  membership. Never weaken those checks to "trust active workspace."
- **Redirect, don't render, when switching active workspace** on a direct
  resource page — the `(active)/layout` must re-resolve pages/features for the
  new workspace. The redirect loops at most once (after `setActive`, the second
  pass sees `active.id === resource.workspaceId`).
- **Legacy mismatch → `notFound()`**, never a silent cross-workspace switch.
- **Don't touch** `packages/notifications`, `packages/mail`, domain services,
  Prisma models beyond the one column, agents, engines, or Yjs.
- **Prettier:** `semi:false`, single quotes, 100 cols — run `pnpm format` if a
  commit's lint-staged hook complains.
