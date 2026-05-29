# Architecture Layering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Codify and automatically enforce a 6-tier layered architecture, relocating business logic that is currently parked in `@repo/trpc` into `@repo/domain`, and clean up dependency hygiene — without changing any runtime behavior.

**Architecture:** Tiers (top imports downward only): presentation/transport (`web`, `engines`, `yjs`, `@repo/trpc`) → domain (`@repo/domain`) / UI (foundation `ui`+`diagram-board`, feature packages) → infra services (`auth`→`notifications`→`mail`) → pure adapters (`db`, `mail`, `storage`, `yookassa`). The moved domain functions throw `DomainError`; `@repo/trpc` keeps thin **adapter** helpers that wrap them with the existing `mapDomain` so every call site stays byte-identical.

**Tech Stack:** TypeScript, pnpm workspaces, Turborepo, tRPC v11, Prisma 7, Next.js 16, NestJS 11, dependency-cruiser (new), vitest/jest.

---

## Approach note (read first)

This is a **behavior-preserving refactor**, not a feature. The regression net is the
**existing** test suites (`@repo/trpc`, `web`, `engines`, `@repo/domain`) plus
`check-types`, `lint`, and the new `dependency-cruiser` check. We do **not** write new
behavioral tests for relocated functions, because the only change is the *error type*
(`TRPCError` → `DomainError`), which the trpc adapter maps back to the identical
`TRPCError` code — so existing router tests already assert the observable behavior.
The "test → verify → implement → verify → commit" loop is realized per task as
"make the change → run the exact verification commands → confirm expected output →
commit". For Task 6 the dependency-cruiser config **is** the executable check.

Key design decision (refines the spec's "delete the file"): `packages/trpc/src/helpers/plan.ts`
and `packages/trpc/src/helpers/workspace.ts` are **converted to adapters** over `@repo/domain`
rather than deleted, so the 19 `requireWritableWorkspace` + 3 `getActivePlanForUser` + 4
`assertWorkspaceMember` call sites need **zero** edits. The domain *logic* still lives in
`@repo/domain`; these files become legal transport-layer error-mapping adapters.

## File structure

**Created**
- `packages/domain/src/billing/plan.ts` — plan/limits/features logic (moved from trpc), throws `DomainError`.
- `packages/domain/src/billing/index.ts` — barrel.
- `packages/domain/src/workspace/access.ts` — `assertWorkspaceMembership`, throws `DomainError`.
- `packages/domain/src/workspace/index.ts` — barrel.
- `packages/domain/src/kanban/colors.ts` — kanban label color vocabulary (moved from `@repo/ui`).
- `.dependency-cruiser.cjs` — tier boundary rules.
- `docs/architecture.md` — tier model summary + diagram (points at the spec).

**Modified**
- `packages/domain/src/index.ts` — export billing + workspace barrels.
- `packages/domain/src/kanban/index.ts` — export colors.
- `packages/trpc/src/helpers/plan.ts` — convert to adapter over `@repo/domain`.
- `packages/trpc/src/helpers/workspace.ts` — convert to adapter over `@repo/domain`.
- `packages/trpc/src/routers/kanban/label.ts` — import colors from `@repo/domain`.
- `apps/web/src/components/kanban/task/manage-list-popover.tsx`, `.../settings/kanban-settings-dialog.tsx`, `.../task/task-form.tsx` — import colors from `@repo/domain`.
- `apps/web/src/app/api/workspaces/[workspaceId]/pages/[pageId]/export/[format]/route.ts` — import assert from `@repo/domain`, handle `DomainError`.
- `apps/engines/src/apps/billing/services/subscription-renewal.service.ts` — import `syncWorkspaceLimits` from `@repo/domain`.
- `apps/web/next.config.js` — `transpilePackages`: add `@repo/domain`, remove `@repo/mail`.
- `package.json` (root) — add `check-architecture` script + `dependency-cruiser` devDep; extend `gates`.
- `apps/web/package.json`, `apps/engines/package.json`, `packages/auth/package.json`, `packages/mail/package.json`, `packages/storage/package.json`, `packages/trpc/package.json`, `packages/db/package.json`, `packages/yookassa/package.json`, `packages/domain/package.json` — dependency edits.
- `CLAUDE.md` — add an "Architecture layers" pointer.

**Deleted**
- `packages/ui/src/lib/kanban-colors.ts` (+ any re-export from the `@repo/ui` barrel).

---

## Task 1: Hygiene — phantom deps + tooling-config classification

**Files:**
- Modify: `apps/web/package.json`, `apps/engines/package.json`, `packages/auth/package.json`, `packages/mail/package.json` (remove phantom `@repo/mail`/`@repo/db`)
- Modify: `apps/web/next.config.js` (drop `@repo/mail` from transpilePackages)
- Modify: `packages/storage/package.json`, `packages/trpc/package.json`, `packages/db/package.json`, `packages/yookassa/package.json`, `packages/domain/package.json` (move tooling configs to devDependencies)

- [ ] **Step 1: Remove phantom `@repo/mail` from web/engines/auth and `@repo/db` from mail**

In `apps/web/package.json` delete the line in `dependencies`:
```json
    "@repo/mail": "workspace:*",
```
In `apps/engines/package.json` delete the line in `dependencies`:
```json
    "@repo/mail": "workspace:*",
```
In `packages/auth/package.json` delete the line in `dependencies`:
```json
    "@repo/mail": "workspace:*",
```
In `packages/mail/package.json` delete the line in `dependencies`:
```json
    "@repo/db": "workspace:*",
```

- [ ] **Step 2: Remove `@repo/mail` from web transpilePackages**

In `apps/web/next.config.js`, delete this line from the `transpilePackages` array:
```js
    '@repo/mail',
```

- [ ] **Step 3: Move tooling configs from `dependencies` to `devDependencies`**

`packages/storage/package.json`: remove from `dependencies`:
```json
    "@repo/eslint-config": "workspace:*",
    "@repo/typescript-config": "workspace:*",
```
and add them to `devDependencies`:
```json
    "@repo/eslint-config": "workspace:*",
    "@repo/typescript-config": "workspace:*",
```
`packages/trpc/package.json`: same — move `@repo/eslint-config` and `@repo/typescript-config` from `dependencies` to `devDependencies`.
`packages/db/package.json`: move `@repo/typescript-config` from `dependencies` to `devDependencies`.
`packages/yookassa/package.json`: move `@repo/typescript-config` from `dependencies` to `devDependencies`.
`packages/domain/package.json`: move `@repo/typescript-config` from `dependencies` to `devDependencies` (keep `@repo/db` and `zod` in `dependencies`).

- [ ] **Step 4: Reinstall and verify the graph still type-checks and builds**

Run:
```bash
pnpm install
pnpm check-types
pnpm build
```
Expected: `pnpm install` updates the lockfile with no errors; `check-types` and `build` both PASS (these deps were unused/dev-only, so nothing breaks).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(deps): drop phantom @repo/mail/@repo/db deps; tooling configs to devDeps"
```

---

## Task 2: Wire `@repo/domain` into `apps/web` (B0)

`apps/web` reaches the domain only transitively today. Tasks 3 and 4 add direct
`web → @repo/domain` imports, which requires the dependency + a transpile entry first.

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/next.config.js`

- [ ] **Step 1: Add `@repo/domain` to web dependencies**

In `apps/web/package.json` `dependencies`, add (keep alphabetical, before `@repo/drawio`):
```json
    "@repo/domain": "workspace:*",
```

- [ ] **Step 2: Add `@repo/domain` to transpilePackages**

In `apps/web/next.config.js` `transpilePackages`, add after `'@repo/trpc',`:
```js
    '@repo/domain',
```
(`@repo/domain`'s `exports` map points at TS source `./src/*`, so Next must transpile it.)

- [ ] **Step 3: Install and verify web still builds**

Run:
```bash
pnpm install
pnpm --filter web build
```
Expected: PASS. (No web file imports `@repo/domain` yet; this only wires the dependency.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json apps/web/next.config.js pnpm-lock.yaml
git commit -m "build(web): wire @repo/domain into deps + transpilePackages"
```

---

## Task 3: Move kanban label colors to `@repo/domain` (B3)

Removes the `@repo/trpc → @repo/ui` edge (the only one) and centralizes the color
vocabulary in the domain.

**Files:**
- Create: `packages/domain/src/kanban/colors.ts`
- Modify: `packages/domain/src/kanban/index.ts`
- Modify: `packages/trpc/src/routers/kanban/label.ts:3`
- Modify: `apps/web/src/components/kanban/task/manage-list-popover.tsx:17`, `apps/web/src/components/kanban/settings/kanban-settings-dialog.tsx:20`, `apps/web/src/components/kanban/task/task-form.tsx:30`
- Modify: `packages/trpc/package.json` (drop `@repo/ui`)
- Delete: `packages/ui/src/lib/kanban-colors.ts`

- [ ] **Step 1: Create the colors module in the domain**

Create `packages/domain/src/kanban/colors.ts`:
```ts
export const KANBAN_LABEL_COLORS = [
  { name: 'red', hex: '#EF4444' },
  { name: 'orange', hex: '#F97316' },
  { name: 'yellow', hex: '#EAB308' },
  { name: 'green', hex: '#22C55E' },
  { name: 'teal', hex: '#14B8A6' },
  { name: 'blue', hex: '#3B82F6' },
  { name: 'purple', hex: '#A855F7' },
  { name: 'pink', hex: '#EC4899' },
  { name: 'gray', hex: '#6B7280' },
] as const

export const KANBAN_LABEL_COLOR_HEXES: ReadonlySet<string> = new Set(
  KANBAN_LABEL_COLORS.map((c) => c.hex),
)
```

- [ ] **Step 2: Export it from the kanban barrel**

In `packages/domain/src/kanban/index.ts`, add (extension required — NodeNext):
```ts
export * from './colors.ts'
```

- [ ] **Step 3: Point the trpc kanban router at the domain**

In `packages/trpc/src/routers/kanban/label.ts`, replace line 3:
```ts
import { KANBAN_LABEL_COLOR_HEXES } from '@repo/ui/lib/kanban-colors'
```
with:
```ts
import { KANBAN_LABEL_COLOR_HEXES } from '@repo/domain'
```

- [ ] **Step 4: Point the 3 web kanban components at the domain**

In each of these files, replace `from '@repo/ui/lib/kanban-colors'` with `from '@repo/domain'`:
- `apps/web/src/components/kanban/task/manage-list-popover.tsx:17`
- `apps/web/src/components/kanban/settings/kanban-settings-dialog.tsx:20`
- `apps/web/src/components/kanban/task/task-form.tsx:30`

Each becomes:
```ts
import { KANBAN_LABEL_COLORS } from '@repo/domain'
```

- [ ] **Step 5: Delete the UI-kit copy and confirm no references remain**

```bash
rm packages/ui/src/lib/kanban-colors.ts
grep -rn "kanban-colors" packages apps --include='*.ts' --include='*.tsx' | grep -v "/dist/"
```
Expected: the `grep` prints **nothing** (no remaining references). If it shows a barrel
re-export inside `packages/ui/src` (e.g. an `export … from './lib/kanban-colors'`), delete that line too.

- [ ] **Step 6: Drop `@repo/ui` from trpc (now unused)**

In `packages/trpc/package.json` `dependencies`, delete:
```json
    "@repo/ui": "workspace:*",
```
Then:
```bash
pnpm install
```

- [ ] **Step 7: Verify**

```bash
pnpm --filter @repo/domain check-types
pnpm --filter @repo/trpc test
pnpm --filter web check-types
```
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(domain): move kanban label colors out of @repo/ui; drop trpc->ui"
```

---

## Task 4: Move workspace membership assertion to `@repo/domain` (B2)

Removes `apps/web → @repo/trpc/helpers/workspace`. `@repo/trpc/helpers/workspace.ts`
becomes an adapter so `routers/search.ts` (4 call sites) stays unchanged.

**Files:**
- Create: `packages/domain/src/workspace/access.ts`
- Create: `packages/domain/src/workspace/index.ts`
- Modify: `packages/domain/src/index.ts`
- Modify (rewrite): `packages/trpc/src/helpers/workspace.ts`
- Modify: `apps/web/src/app/api/workspaces/[workspaceId]/pages/[pageId]/export/[format]/route.ts`

- [ ] **Step 1: Create the domain access function**

Create `packages/domain/src/workspace/access.ts`:
```ts
import type { PrismaClient } from '@repo/db'
import { forbidden } from '../errors.ts'

export async function assertWorkspaceMembership(
  prisma: PrismaClient,
  userId: string,
  workspaceId: string,
) {
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  })
  if (!member) {
    throw forbidden('Вы не являетесь участником воркспейса')
  }
  return member
}
```

- [ ] **Step 2: Create the workspace barrel and export from the domain root**

Create `packages/domain/src/workspace/index.ts`:
```ts
export * from './access.ts'
```
In `packages/domain/src/index.ts`, add:
```ts
export * from './workspace/index.ts'
```

- [ ] **Step 3: Convert the trpc workspace helper to an adapter**

Replace the entire contents of `packages/trpc/src/helpers/workspace.ts` with:
```ts
import type { PrismaClient } from '@repo/db'
import { assertWorkspaceMembership as assertWorkspaceMembershipDomain } from '@repo/domain'
import { mapDomain } from './map-domain'

export function assertWorkspaceMembership(
  prisma: PrismaClient,
  userId: string,
  workspaceId: string,
) {
  return mapDomain(() => assertWorkspaceMembershipDomain(prisma, userId, workspaceId))
}

export async function assertWorkspaceMember(
  ctx: { prisma: PrismaClient; user: { id: string } },
  workspaceId: string,
) {
  return assertWorkspaceMembership(ctx.prisma, ctx.user.id, workspaceId)
}
```
(`routers/search.ts` imports `assertWorkspaceMember` from here and is unchanged; its 4
call sites keep returning a `FORBIDDEN` `TRPCError` for non-members.)

- [ ] **Step 4: Point the web export route at the domain and handle `DomainError`**

In `apps/web/src/app/api/workspaces/[workspaceId]/pages/[pageId]/export/[format]/route.ts`:

Delete line 3:
```ts
import { TRPCError } from '@trpc/server'
```
Replace line 7:
```ts
import { assertWorkspaceMembership } from '@repo/trpc/helpers/workspace'
```
with:
```ts
import { assertWorkspaceMembership, isDomainError } from '@repo/domain'
```
Replace the catch body (line 51):
```ts
    if (e instanceof TRPCError && e.code === 'FORBIDDEN') return FORBIDDEN
```
with:
```ts
    if (isDomainError(e) && e.httpStatus === 403) return FORBIDDEN
```

- [ ] **Step 5: Verify**

```bash
pnpm --filter @repo/domain check-types
pnpm --filter @repo/trpc test
pnpm --filter web check-types
```
Expected: all PASS. (`search.ts` behavior unchanged via the adapter; the export route now
catches `DomainError`.)

- [ ] **Step 6: Spot-run the export route**

```bash
pnpm --filter web dev
# in another shell, signed-out request must 302 to /sign-in (membership not reached);
# the route compiles and serves — confirm no 500 from a module-resolution error:
curl -sS -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/workspaces/00000000-0000-0000-0000-000000000000/pages/00000000-0000-0000-0000-000000000000/html"
```
Expected: `302` (redirect to sign-in) — proves the route loads with the new imports.
Stop the dev server afterward.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(domain): move assertWorkspaceMembership; trpc helper is now an adapter"
```

---

## Task 5: Move plan/limits logic to `@repo/domain` (B1)

Removes `apps/engines → @repo/trpc`. `@repo/trpc/helpers/plan.ts` becomes an adapter so
all 19 `requireWritableWorkspace` + 3 `getActivePlanForUser` call sites stay unchanged.

**Files:**
- Create: `packages/domain/src/billing/plan.ts`
- Create: `packages/domain/src/billing/index.ts`
- Modify: `packages/domain/src/index.ts`
- Modify (rewrite): `packages/trpc/src/helpers/plan.ts`
- Modify: `apps/engines/src/apps/billing/services/subscription-renewal.service.ts:3`
- Modify: `apps/engines/package.json` (drop `@repo/trpc`)

- [ ] **Step 1: Create the domain billing module**

Create `packages/domain/src/billing/plan.ts` (moved verbatim from the trpc helper, with
`TRPCError` swapped for `DomainError` helpers; `getActivePlanForUser` keeps its plain
`Error` to preserve the existing 500 behavior):
```ts
import { prisma } from '@repo/db'
import type { AiModel, AiProvider, Plan, Prisma, PrismaClient } from '@repo/db'
import { forbidden, notFound } from '../errors.ts'

export async function getActivePlanForUser(prismaClient: PrismaClient, userId: string) {
  const subscription = await prismaClient.subscription.findFirst({
    where: { userId, status: { in: ['TRIAL', 'ACTIVE', 'PAST_DUE'] } },
    include: { plan: true },
    orderBy: { createdAt: 'desc' },
  })
  if (!subscription) {
    throw new Error(`User ${userId} has no active subscription`)
  }
  return { subscription, plan: subscription.plan }
}

export type PlanFeatures = {
  slug: 'personal' | 'pro' | 'max'
  name: string
  sortOrder: number
  isPaid: boolean
  maxWorkspaces: number | null
  maxMembersPerWorkspace: number
  chatsEnabled: boolean
  pageIndexingEnabled: boolean
  membersSettingsEnabled: boolean
  aiSettingsEnabled: boolean
  customMcpEnabled: boolean
  customAiProvidersEnabled: boolean
  prioritySupport: boolean
  developerSpaceEnabled: boolean
}

export function getPlanDisplayName(plan: Pick<Plan, 'slug' | 'name'>): string {
  if (plan.slug === 'personal') return 'Персональный'
  if (plan.slug === 'pro') return 'ПРО'
  if (plan.slug === 'max') return 'МАКС'
  return plan.name
}

function planToFeatures(plan: Plan): PlanFeatures {
  return {
    slug: plan.slug as PlanFeatures['slug'],
    name: getPlanDisplayName(plan),
    sortOrder: plan.sortOrder,
    isPaid: plan.slug !== 'personal',
    maxWorkspaces: plan.maxWorkspaces,
    maxMembersPerWorkspace: plan.maxMembersPerWorkspace,
    chatsEnabled: plan.chatsEnabled,
    pageIndexingEnabled: plan.pageIndexingEnabled,
    membersSettingsEnabled: plan.membersSettingsEnabled,
    aiSettingsEnabled: plan.aiSettingsEnabled,
    customMcpEnabled: plan.customMcpEnabled,
    customAiProvidersEnabled: plan.customAiProvidersEnabled,
    prioritySupport: plan.prioritySupport,
    developerSpaceEnabled: plan.developerSpaceEnabled,
  }
}

export async function getAvailableAiModels(
  workspaceId: string,
): Promise<(AiModel & { provider: AiProvider })[]> {
  const features = await getWorkspaceFeatures(workspaceId)
  const allowed = await prisma.plan.findMany({
    where: { sortOrder: { lte: features.sortOrder } },
    select: { slug: true },
  })
  const allowedSlugs = allowed.map((r) => r.slug)
  return prisma.aiModel.findMany({
    where: {
      isActive: true,
      supportsEmbeddings: false,
      OR: [{ minPlanSlug: null }, { minPlanSlug: { in: allowedSlugs } }],
      provider: { isActive: true, OR: [{ workspaceId: null }, { workspaceId }] },
    },
    include: { provider: true },
    orderBy: { displayName: 'asc' },
  })
}

export async function getAvailableEmbeddingModels(
  workspaceId: string,
): Promise<(AiModel & { provider: AiProvider })[]> {
  const features = await getWorkspaceFeatures(workspaceId)
  const allowed = await prisma.plan.findMany({
    where: { sortOrder: { lte: features.sortOrder } },
    select: { slug: true },
  })
  const allowedSlugs = allowed.map((r) => r.slug)
  return prisma.aiModel.findMany({
    where: {
      isActive: true,
      supportsEmbeddings: true,
      vectorSize: { not: null },
      OR: [{ minPlanSlug: null }, { minPlanSlug: { in: allowedSlugs } }],
      provider: { isActive: true, OR: [{ workspaceId: null }, { workspaceId }] },
    },
    include: { provider: true },
    orderBy: { displayName: 'asc' },
  })
}

export async function getWorkspaceFeatures(workspaceId: string): Promise<PlanFeatures> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { createdById: true },
  })
  if (!workspace?.createdById) {
    const personal = await prisma.plan.findUniqueOrThrow({ where: { slug: 'personal' } })
    return planToFeatures(personal)
  }
  const sub = await prisma.subscription.findFirst({
    where: { userId: workspace.createdById, status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
    include: { plan: true },
  })
  if (!sub) {
    const personal = await prisma.plan.findUniqueOrThrow({ where: { slug: 'personal' } })
    return planToFeatures(personal)
  }
  return planToFeatures(sub.plan)
}

export async function requireWritableWorkspace(workspaceId: string): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { createdById: true, createdAt: true },
  })
  if (!workspace) throw notFound('Workspace not found')

  const features = await getWorkspaceFeatures(workspaceId)
  if (features.maxWorkspaces === null) return

  const olderCount = await prisma.workspace.count({
    where: { createdById: workspace.createdById, createdAt: { lt: workspace.createdAt } },
  })
  if (olderCount >= features.maxWorkspaces) {
    throw forbidden('WORKSPACE_OVER_PLAN_LIMIT')
  }
}

type TxClient = PrismaClient | Prisma.TransactionClient

export async function resolveActivePlanOrPersonal(tx: TxClient, userId: string): Promise<Plan> {
  const sub = await tx.subscription.findFirst({
    where: { userId, status: { in: ['TRIAL', 'ACTIVE', 'PAST_DUE'] } },
    include: { plan: true },
    orderBy: { createdAt: 'desc' },
  })
  return sub?.plan ?? (await tx.plan.findUniqueOrThrow({ where: { slug: 'personal' } }))
}

export async function syncWorkspaceLimits(tx: TxClient, userId: string): Promise<void> {
  const plan = await resolveActivePlanOrPersonal(tx, userId)
  const workspaces = await tx.workspace.findMany({
    where: { createdById: userId },
    select: { id: true },
  })
  if (workspaces.length === 0) return
  const now = new Date()
  for (const w of workspaces) {
    await tx.workspaceLimit.upsert({
      where: { workspaceId: w.id },
      create: {
        workspaceId: w.id,
        maxMembers: plan.maxMembersPerWorkspace,
        maxFileBytes: plan.maxFileBytes,
        sourcePlanSlug: plan.slug,
        syncedAt: now,
      },
      update: {
        maxMembers: plan.maxMembersPerWorkspace,
        maxFileBytes: plan.maxFileBytes,
        sourcePlanSlug: plan.slug,
        syncedAt: now,
      },
    })
  }
}
```

- [ ] **Step 2: Create the billing barrel and export from the domain root**

Create `packages/domain/src/billing/index.ts`:
```ts
export * from './plan.ts'
```
In `packages/domain/src/index.ts`, add:
```ts
export * from './billing/index.ts'
```

- [ ] **Step 3: Convert the trpc plan helper to an adapter**

Replace the entire contents of `packages/trpc/src/helpers/plan.ts` with:
```ts
import { mapDomain } from './map-domain'
import {
  getActivePlanForUser,
  getAvailableAiModels,
  getAvailableEmbeddingModels,
  getPlanDisplayName,
  getWorkspaceFeatures,
  requireWritableWorkspace as requireWritableWorkspaceDomain,
  resolveActivePlanOrPersonal,
  syncWorkspaceLimits,
} from '@repo/domain'

export type { PlanFeatures } from '@repo/domain'

export {
  getActivePlanForUser,
  getAvailableAiModels,
  getAvailableEmbeddingModels,
  getPlanDisplayName,
  getWorkspaceFeatures,
  resolveActivePlanOrPersonal,
  syncWorkspaceLimits,
}

export function requireWritableWorkspace(workspaceId: string): Promise<void> {
  return mapDomain(() => requireWritableWorkspaceDomain(workspaceId))
}
```
(All 9 importers keep `from '../helpers/plan'` / `from './helpers/plan'` unchanged.
`requireWritableWorkspace` still surfaces `NOT_FOUND` / `FORBIDDEN` TRPCErrors via `mapDomain`;
`getActivePlanForUser` still throws a plain `Error`, identical to before.)

- [ ] **Step 4: Point the engines billing cron at the domain**

In `apps/engines/src/apps/billing/services/subscription-renewal.service.ts`, replace line 3:
```ts
import { syncWorkspaceLimits } from '@repo/trpc/helpers/plan'
```
with:
```ts
import { syncWorkspaceLimits } from '@repo/domain'
```

- [ ] **Step 5: Drop `@repo/trpc` from engines (now unused) and reinstall**

In `apps/engines/package.json` `dependencies`, delete:
```json
    "@repo/trpc": "workspace:*",
```
Then:
```bash
pnpm install
```

- [ ] **Step 6: Verify there is no remaining `engines → trpc` import**

```bash
grep -rn "@repo/trpc" apps/engines/src --include='*.ts'
```
Expected: prints **nothing**.

- [ ] **Step 7: Verify type-checks and tests**

```bash
pnpm --filter @repo/domain check-types
pnpm --filter @repo/domain test
pnpm --filter @repo/trpc test
pnpm --filter engines check-types
pnpm --filter engines test
```
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(domain): move plan/limits logic from @repo/trpc; drop engines->trpc"
```

---

## Task 6: Enforce tiers with dependency-cruiser + document the model (A)

**Files:**
- Create: `.dependency-cruiser.cjs`
- Modify: root `package.json` (devDep + scripts)
- Create: `docs/architecture.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add dependency-cruiser as a root devDependency**

```bash
pnpm add -D -w dependency-cruiser
```
Expected: installs `dependency-cruiser` into the root `devDependencies`.

- [ ] **Step 2: Create `.dependency-cruiser.cjs`**

Create `.dependency-cruiser.cjs` at the repo root:
```js
// Tier model — see docs/superpowers/specs/2026-05-29-architecture-layering-design.md
// Imports may only point downward. `$1` in `to.pathNot` back-references the package
// name captured in `from.path`, allowing intra-package imports while forbidding peers.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment: 'No cyclic dependencies between modules.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'adapters-are-pure',
      comment: 'Tier 1 (db/mail/storage/yookassa) import no other @repo package (db ok).',
      severity: 'error',
      from: { path: '^packages/(db|mail|storage|yookassa)/src' },
      to: {
        path: '^packages/',
        pathNot: ['^packages/db/', '^packages/$1/', '^packages/(eslint-config|typescript-config)/'],
      },
    },
    {
      name: 'infra-only-adapters',
      comment: 'Tier 2 (notifications/auth) import only adapters + infra.',
      severity: 'error',
      from: { path: '^packages/(notifications|auth)/src' },
      to: {
        path: '^packages/',
        pathNot: [
          '^packages/(db|mail|storage|yookassa)/',
          '^packages/(notifications|auth)/',
          '^packages/(eslint-config|typescript-config)/',
        ],
      },
    },
    {
      name: 'domain-only-adapters',
      comment: 'Tier 3 (domain) imports only adapters.',
      severity: 'error',
      from: { path: '^packages/domain/src' },
      to: {
        path: '^packages/',
        pathNot: [
          '^packages/(db|mail|storage|yookassa)/',
          '^packages/domain/',
          '^packages/(eslint-config|typescript-config)/',
        ],
      },
    },
    {
      name: 'ui-foundation-pure',
      comment: 'ui & diagram-board import no other @repo package.',
      severity: 'error',
      from: { path: '^packages/(ui|diagram-board)/src' },
      to: {
        path: '^packages/',
        pathNot: ['^packages/$1/', '^packages/(eslint-config|typescript-config)/'],
      },
    },
    {
      name: 'feature-ui-foundation-only',
      comment: 'Feature UI imports only the UI foundation (ui/diagram-board).',
      severity: 'error',
      from: { path: '^packages/(drawio|excalidraw|genogram|likec4|mermaid|plantuml)/src' },
      to: {
        path: '^packages/',
        pathNot: [
          '^packages/(ui|diagram-board)/',
          '^packages/$1/',
          '^packages/(eslint-config|typescript-config)/',
        ],
      },
    },
    {
      name: 'editor-composite-ui',
      comment: 'editor (composite) imports only ui/diagram-board/mermaid/plantuml.',
      severity: 'error',
      from: { path: '^packages/editor/src' },
      to: {
        path: '^packages/',
        pathNot: [
          '^packages/(ui|diagram-board|mermaid|plantuml|editor)/',
          '^packages/(eslint-config|typescript-config)/',
        ],
      },
    },
    {
      name: 'engines-no-trpc',
      comment: 'engines reaches business logic via @repo/domain, never @repo/trpc.',
      severity: 'error',
      from: { path: '^apps/engines/src' },
      to: { path: '^packages/trpc/' },
    },
    {
      name: 'packages-no-import-apps',
      comment: 'Library packages must never import a presentation app.',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    includeOnly: '^(packages|apps)/',
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
  },
}
```

- [ ] **Step 3: Add the scripts to root `package.json`**

In the root `package.json` `scripts`, add:
```json
    "check-architecture": "depcruise apps packages --config .dependency-cruiser.cjs",
```
and change `gates` to include it:
```json
    "gates": "pnpm check-types && pnpm lint && pnpm check-architecture && pnpm build && pnpm test",
```

- [ ] **Step 4: Run the architecture check and confirm it resolves modules and passes**

```bash
pnpm check-architecture
```
Expected: a summary line like `no dependency violations found (NN modules, MM dependencies cruised)`
with `NN` > 0. After Tasks 1–5 every edge is legal, so there are **zero** violations.

Contingency (only if the output says `0 modules cruised` or reports `@repo/*` as
unresolvable): dependency-cruiser is not resolving the pnpm workspace symlinks. Fix by
adding a root `tsconfig.json` with `compilerOptions.paths` mapping `@repo/*` to
`packages/*/src`, then pass it via `options.tsConfig = { fileName: 'tsconfig.json' }`.
Re-run until it cruises the real `packages/*` and `apps/*` files. This is configuration,
not a code change.

- [ ] **Step 5: Create `docs/architecture.md`**

Create `docs/architecture.md`:
```markdown
# Architecture layers

Imports point **downward** only. Enforced by `.dependency-cruiser.cjs`
(`pnpm check-architecture`, part of `pnpm gates`). Full rationale and decisions:
`docs/superpowers/specs/2026-05-29-architecture-layering-design.md`.

| Tier | Packages | May import |
|---|---|---|
| 5 · Presentation/transport | apps/web, apps/engines, apps/yjs, @repo/trpc | everything below |
| 4a · UI foundation | @repo/ui, @repo/diagram-board | nothing @repo/* |
| 4b · UI feature | drawio, excalidraw, genogram, likec4, mermaid, plantuml, editor* | UI foundation (*editor may also import mermaid/plantuml) |
| 3 · Domain | @repo/domain | adapters only |
| 2 · Infra services | @repo/auth → @repo/notifications → @repo/mail | adapters + infra below |
| 1 · Pure adapters | @repo/db, @repo/mail, @repo/storage, @repo/yookassa | nothing @repo/* (db types ok) |
| 0 · Tooling | @repo/eslint-config, @repo/typescript-config | devDependency anywhere |

Known tech-debt: `apps/web → @repo/trpc/services/billing` (payment-webhook handlers)
awaits a dedicated billing-domain migration; it is a within-tier edge, not a violation.
`apps/agents` (Python) is outside the TS dependency graph.
```

- [ ] **Step 6: Add a pointer in `CLAUDE.md`**

In `CLAUDE.md`, under the `## Architecture` heading (right after the "Monorepo shape"
intro), add:
```markdown
The package dependency graph is layered and **enforced** by `pnpm check-architecture`
(dependency-cruiser, part of `pnpm gates`). See `docs/architecture.md` for the tier
table and `docs/superpowers/specs/2026-05-29-architecture-layering-design.md` for the
rationale. In short: presentation → domain/UI → infra services → pure adapters,
downward only; UI feature packages depend only on the UI foundation (`@repo/ui`,
`@repo/diagram-board`).
```

- [ ] **Step 7: Run the full gate**

```bash
pnpm gates
```
Expected: PASS end-to-end (`check-types`, `lint`, `check-architecture`, `build`, `test`).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(architecture): enforce layer boundaries via dependency-cruiser + docs"
```

---

## Self-review

**Spec coverage** (each spec item → task):
- §5 A (codification + enforcement) → Task 6 (config, scripts, gates, docs/CLAUDE.md). ✓
- §5 B0 (wire domain into web) → Task 2. ✓
- §5 B1 (plan.ts → domain) → Task 5. ✓ (refined: trpc keeps an adapter, per Approach note)
- §5 B2 (workspace asserts → domain) → Task 4. ✓ (adapter for search.ts; web route uses domain)
- §5 B3 (kanban-colors → domain) → Task 3. ✓ (also drops trpc→ui)
- §5 C1 (phantom deps) + C2 (tooling devDeps) → Task 1. ✓
- §6 out-of-scope (`services/billing`, reads, agents, editor inversion) → untouched. ✓
- §7 verification → per-task verify steps + Task 6 `pnpm gates`. ✓

**Placeholder scan:** No TBD/TODO/"handle errors"/"similar to". The dependency-cruiser
"contingency" in Task 6 Step 4 is a real, conditional config fallback with exact actions,
not a placeholder. ✓

**Type/name consistency:** `DomainError` helpers `forbidden`/`notFound` match
`packages/domain/src/errors.ts`. `mapDomain` signature matches
`packages/trpc/src/helpers/map-domain.ts`. Adapter re-export names
(`requireWritableWorkspace`, `getActivePlanForUser`, `getWorkspaceFeatures`,
`getAvailableAiModels`, `getAvailableEmbeddingModels`, `getPlanDisplayName`,
`resolveActivePlanOrPersonal`, `syncWorkspaceLimits`, `PlanFeatures`) match the 9
trpc importers' expectations. `KANBAN_LABEL_COLORS` / `KANBAN_LABEL_COLOR_HEXES` match
the consumers. `assertWorkspaceMembership` / `assertWorkspaceMember` match
`routers/search.ts` and the web route. ✓

**Ordering safety:** dep removals tied to moves (`@repo/ui` from trpc in Task 3,
`@repo/trpc` from engines in Task 5) happen *with* their moves, so the graph is legal at
each commit; enforcement (Task 6) lands last and is green immediately. ✓
