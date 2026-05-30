# Domain Layered Architecture — Scaffold + `workspace` Module — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the layered architecture (`dto/` + `repositories/` + `services/`) and the inversify composition root for `@repo/domain`, proven end-to-end on the `workspace` module, with all consumers and enforcement wired.

**Architecture:** Plain (decorator-free) TypeScript classes wired by an inversify 8 `Container` that `@repo/domain` builds via `createDomain(deps)`. Repositories own all I/O and map Prisma rows to DTOs; services own business logic and speak only DTOs; a `UnitOfWork` backed by `AsyncLocalStorage` makes multi-repository writes atomic. inversify lives **inside** the package; consumers (`@repo/trpc`, `apps/web`) call a singleton facade.

**Tech Stack:** TypeScript (NodeNext), inversify `^8.1.0`, `reflect-metadata`, `node:async_hooks` (ALS), zod, Prisma, vitest (mocked Prisma), dependency-cruiser.

**Spec:** `docs/superpowers/specs/2026-05-30-domain-layered-architecture-design.md`

**Scope:** This is plan **1 of 7** (per the spec's migration order). It covers the shared scaffold + the `workspace` module only. The remaining modules (`favorites`, `notifications`, `billing`, `pages`, `reminders`, `kanban`) each get their own follow-on plan using the template proven here.

**Conventions for every task:**
- Domain files use **explicit `.ts` import extensions** (the package's NodeNext config requires it). `@repo/trpc` and `apps/web` use **extensionless** relative imports.
- Run a single domain test file with: `pnpm --filter @repo/domain exec vitest run <path>`.
- Every commit message ends with the trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` (shown via a second `-m`; omitted from some snippets for brevity — always include it).
- Work happens on branch `refactor/domain-layered-architecture` (already created; the spec commit `daef32b` is its tip).

---

## File Structure

**Created (domain):**
- `packages/domain/src/shared/errors.ts` — `DomainError` + helpers (moved from `src/errors.ts`).
- `packages/domain/src/shared/tokens.ts` — shared inversify symbols (`SHARED.Prisma`, `SHARED.UnitOfWork`).
- `packages/domain/src/shared/unit-of-work.ts` — `UnitOfWork` interface + `PrismaUnitOfWork` (ALS) + `Db` type.
- `packages/domain/src/workspace/dto/workspace.dto.ts` — `WorkspaceMembershipDto`.
- `packages/domain/src/workspace/workspace.tokens.ts` — `WORKSPACE.Repository`, `WORKSPACE.Service`.
- `packages/domain/src/workspace/repositories/workspace.repository.ts` — `WorkspaceRepository`.
- `packages/domain/src/workspace/services/workspace.service.ts` — `WorkspaceService`.
- `packages/domain/src/workspace/workspace.module.ts` — `workspaceModule` (`ContainerModule`).
- `packages/domain/src/container.ts` — `DomainDeps`, `Domain`, `createDomainContainer`, `createDomain`.

**Modified (domain):**
- `packages/domain/package.json` — add `inversify`, `reflect-metadata`.
- `packages/domain/src/errors.ts` — becomes a compat re-export of `./shared/errors.ts`.
- `packages/domain/src/workspace/index.ts` — re-export new module surface; drop `access.ts` (Task 13).
- `packages/domain/src/index.ts` — add `export * from './container.ts'`.

**Deleted (domain):**
- `packages/domain/src/workspace/access.ts` — replaced by repository+service (Task 13).

**Created (consumers):**
- `packages/trpc/src/domain.ts` — module-singleton `domain = createDomain({ prisma })`.
- `apps/web/src/lib/domain.ts` — module-singleton `domain = createDomain({ prisma })`.

**Modified (consumers + enforcement):**
- `packages/trpc/src/helpers/workspace.ts` — call `domain.workspace.assertMembership`.
- `apps/web/.../pages/[pageId]/export/[format]/route.ts` — call `domain.workspace.assertMembership`.
- `.dependency-cruiser.cjs` — add intra-domain layer rules.
- `docs/architecture.md` — document the intra-domain layering convention.

**Tests (created):**
- `packages/domain/test/shared/unit-of-work.test.ts`
- `packages/domain/test/workspace/repositories/workspace.repository.test.ts`
- `packages/domain/test/workspace/services/workspace.service.test.ts`
- `packages/domain/test/container.test.ts`

---

## Task 1: Add inversify + reflect-metadata to `@repo/domain`

**Files:**
- Modify: `packages/domain/package.json`

- [ ] **Step 1: Add the dependencies**

Edit `packages/domain/package.json` `dependencies` to read:

```json
  "dependencies": {
    "@repo/db": "workspace:*",
    "inversify": "^8.1.0",
    "reflect-metadata": "^0.2.2",
    "zod": "^3.25.76"
  },
```

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: completes; `inversify` and `reflect-metadata` appear under `packages/domain` in the lockfile.

- [ ] **Step 3: Verify resolution under NodeNext**

Run: `pnpm --filter @repo/domain exec node -e "require('reflect-metadata'); const {Container}=require('inversify'); console.log(typeof Container)"`
Expected: prints `function` (confirms inversify resolves at runtime).

- [ ] **Step 4: Commit**

```bash
git add packages/domain/package.json pnpm-lock.yaml
git commit -m "build(domain): add inversify + reflect-metadata deps" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Move `DomainError` into `shared/errors.ts` (keep compat path)

**Files:**
- Create: `packages/domain/src/shared/errors.ts`
- Modify: `packages/domain/src/errors.ts` (becomes a re-export)
- Test: `packages/domain/test/errors.test.ts` (existing — must still pass)

- [ ] **Step 1: Create the new home**

Create `packages/domain/src/shared/errors.ts` with the current error code verbatim:

```ts
export class DomainError extends Error {
  readonly code: string
  readonly httpStatus: number

  constructor(code: string, message: string, httpStatus: number) {
    super(message)
    this.code = code
    this.httpStatus = httpStatus
    this.name = 'DomainError'
  }
}

export const notFound = (message: string): DomainError => new DomainError('NOT_FOUND', message, 404)
export const forbidden = (message: string): DomainError => new DomainError('FORBIDDEN', message, 403)
export const badRequest = (message: string): DomainError => new DomainError('BAD_REQUEST', message, 400)
export const conflict = (message: string): DomainError => new DomainError('CONFLICT', message, 409)

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof Error && e.name === 'DomainError'
}
```

- [ ] **Step 2: Turn the old path into a compat re-export**

Replace the entire contents of `packages/domain/src/errors.ts` with:

```ts
// Compat re-export. Canonical home is ./shared/errors.ts.
export * from './shared/errors.ts'
```

- [ ] **Step 3: Run the existing error test to verify it still passes**

Run: `pnpm --filter @repo/domain exec vitest run test/errors.test.ts`
Expected: PASS (the test imports from `../src/errors.ts`, which now re-exports).

- [ ] **Step 4: Commit**

```bash
git add packages/domain/src/shared/errors.ts packages/domain/src/errors.ts
git commit -m "refactor(domain): move DomainError to shared/, keep errors.ts compat re-export"
```

---

## Task 3: Shared tokens + `Db` type

**Files:**
- Create: `packages/domain/src/shared/tokens.ts`

- [ ] **Step 1: Create the shared tokens**

Create `packages/domain/src/shared/tokens.ts`:

```ts
export const SHARED = {
  Prisma: Symbol.for('domain/Prisma'),
  UnitOfWork: Symbol.for('domain/UnitOfWork'),
} as const
```

- [ ] **Step 2: Type-check the package**

Run: `pnpm --filter @repo/domain check-types`
Expected: PASS (no new errors).

- [ ] **Step 3: Commit**

```bash
git add packages/domain/src/shared/tokens.ts
git commit -m "feat(domain): add shared inversify tokens"
```

---

## Task 4: UnitOfWork (interface + ALS implementation)

**Files:**
- Create: `packages/domain/src/shared/unit-of-work.ts`
- Test: `packages/domain/test/shared/unit-of-work.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/domain/test/shared/unit-of-work.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient, Prisma } from '@repo/db'

import { PrismaUnitOfWork } from '../../src/shared/unit-of-work.ts'

function makePrisma() {
  const tx = { __isTx: true } as unknown as Prisma.TransactionClient
  const client = {
    $transaction: vi.fn(async (fn: (t: Prisma.TransactionClient) => unknown) => fn(tx)),
  }
  return { tx, prisma: client as unknown as PrismaClient }
}

describe('PrismaUnitOfWork', () => {
  it('client() returns the base prisma outside a transaction', () => {
    const { prisma } = makePrisma()
    const uow = new PrismaUnitOfWork(prisma)
    expect(uow.client()).toBe(prisma)
  })

  it('client() returns the tx inside transaction()', async () => {
    const { prisma, tx } = makePrisma()
    const uow = new PrismaUnitOfWork(prisma)
    let inside: unknown
    const result = await uow.transaction(async () => {
      inside = uow.client()
      return 'ok'
    })
    expect(result).toBe('ok')
    expect(inside).toBe(tx)
  })

  it('nested transaction() joins the active tx (only one $transaction)', async () => {
    const { prisma, tx } = makePrisma()
    const uow = new PrismaUnitOfWork(prisma)
    await uow.transaction(async () => {
      await uow.transaction(async () => {
        expect(uow.client()).toBe(tx)
      })
    })
    expect((prisma.$transaction as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @repo/domain exec vitest run test/shared/unit-of-work.test.ts`
Expected: FAIL — cannot find module `../../src/shared/unit-of-work.ts`.

- [ ] **Step 3: Implement the UnitOfWork**

Create `packages/domain/src/shared/unit-of-work.ts`:

```ts
import { AsyncLocalStorage } from 'node:async_hooks'

import type { Prisma, PrismaClient } from '@repo/db'

export type Db = PrismaClient | Prisma.TransactionClient

export interface UnitOfWork {
  /** Run fn inside a DB transaction; nested calls reuse the active tx. */
  transaction<T>(fn: () => Promise<T>): Promise<T>
  /** The active tx if inside transaction(), else the base prisma client. */
  client(): Db
}

export class PrismaUnitOfWork implements UnitOfWork {
  private readonly als = new AsyncLocalStorage<Prisma.TransactionClient>()

  constructor(private readonly prisma: PrismaClient) {}

  client(): Db {
    return this.als.getStore() ?? this.prisma
  }

  transaction<T>(fn: () => Promise<T>): Promise<T> {
    const active = this.als.getStore()
    if (active) return fn()
    return this.prisma.$transaction((tx) => this.als.run(tx, fn))
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @repo/domain exec vitest run test/shared/unit-of-work.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/shared/unit-of-work.ts packages/domain/test/shared/unit-of-work.test.ts
git commit -m "feat(domain): add UnitOfWork with AsyncLocalStorage transaction scoping"
```

---

## Task 5: `workspace` DTO

**Files:**
- Create: `packages/domain/src/workspace/dto/workspace.dto.ts`

- [ ] **Step 1: Create the output DTO**

Create `packages/domain/src/workspace/dto/workspace.dto.ts`. Use the Prisma model's indexed `role` type so we don't hard-code the enum name and keep the import **type-only** (erased — client-safe):

```ts
import type { WorkspaceMember } from '@repo/db'

export interface WorkspaceMembershipDto {
  workspaceId: string
  userId: string
  role: WorkspaceMember['role']
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @repo/domain check-types`
Expected: PASS (confirms `WorkspaceMember['role']` resolves).

- [ ] **Step 3: Commit**

```bash
git add packages/domain/src/workspace/dto/workspace.dto.ts
git commit -m "feat(domain): add WorkspaceMembershipDto"
```

---

## Task 6: `workspace` tokens

**Files:**
- Create: `packages/domain/src/workspace/workspace.tokens.ts`

- [ ] **Step 1: Create the tokens**

Create `packages/domain/src/workspace/workspace.tokens.ts`:

```ts
export const WORKSPACE = {
  Repository: Symbol.for('domain/WorkspaceRepository'),
  Service: Symbol.for('domain/WorkspaceService'),
} as const
```

- [ ] **Step 2: Commit**

```bash
git add packages/domain/src/workspace/workspace.tokens.ts
git commit -m "feat(domain): add workspace module tokens"
```

---

## Task 7: `WorkspaceRepository`

**Files:**
- Create: `packages/domain/src/workspace/repositories/workspace.repository.ts`
- Test: `packages/domain/test/workspace/repositories/workspace.repository.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/domain/test/workspace/repositories/workspace.repository.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'

import type { UnitOfWork } from '../../../src/shared/unit-of-work.ts'
import { WorkspaceRepository } from '../../../src/workspace/repositories/workspace.repository.ts'

function makeUow(row: unknown) {
  const findUnique = vi.fn(async () => row)
  const client = { workspaceMember: { findUnique } }
  const uow: UnitOfWork = {
    client: () => client as never,
    transaction: async (fn) => fn(),
  }
  return { uow, findUnique }
}

describe('WorkspaceRepository.findMembership', () => {
  it('maps the Prisma row to a WorkspaceMembershipDto', async () => {
    const { uow, findUnique } = makeUow({
      workspaceId: 'w1',
      userId: 'u1',
      role: 'MEMBER',
      createdAt: new Date(),
    })
    const repo = new WorkspaceRepository(uow)
    const dto = await repo.findMembership('u1', 'w1')
    expect(dto).toEqual({ workspaceId: 'w1', userId: 'u1', role: 'MEMBER' })
    expect(findUnique).toHaveBeenCalledWith({
      where: { workspaceId_userId: { workspaceId: 'w1', userId: 'u1' } },
    })
  })

  it('returns null when there is no membership row', async () => {
    const { uow } = makeUow(null)
    const repo = new WorkspaceRepository(uow)
    expect(await repo.findMembership('u1', 'w1')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @repo/domain exec vitest run test/workspace/repositories/workspace.repository.test.ts`
Expected: FAIL — cannot find `workspace.repository.ts`.

- [ ] **Step 3: Implement the repository**

Create `packages/domain/src/workspace/repositories/workspace.repository.ts`:

```ts
import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import type { WorkspaceMembershipDto } from '../dto/workspace.dto.ts'

export class WorkspaceRepository {
  constructor(private readonly uow: UnitOfWork) {}

  async findMembership(userId: string, workspaceId: string): Promise<WorkspaceMembershipDto | null> {
    const row = await this.uow.client().workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    })
    if (!row) return null
    return { workspaceId: row.workspaceId, userId: row.userId, role: row.role }
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @repo/domain exec vitest run test/workspace/repositories/workspace.repository.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/workspace/repositories/workspace.repository.ts packages/domain/test/workspace/repositories/workspace.repository.test.ts
git commit -m "feat(domain): add WorkspaceRepository (membership lookup -> DTO)"
```

---

## Task 8: `WorkspaceService`

**Files:**
- Create: `packages/domain/src/workspace/services/workspace.service.ts`
- Test: `packages/domain/test/workspace/services/workspace.service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/domain/test/workspace/services/workspace.service.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'

import { isDomainError } from '../../../src/shared/errors.ts'
import type { WorkspaceRepository } from '../../../src/workspace/repositories/workspace.repository.ts'
import { WorkspaceService } from '../../../src/workspace/services/workspace.service.ts'

function makeRepo(membership: unknown) {
  return { findMembership: vi.fn(async () => membership) } as unknown as WorkspaceRepository
}

describe('WorkspaceService.assertMembership', () => {
  it('returns the membership DTO when the user is a member', async () => {
    const dto = { workspaceId: 'w1', userId: 'u1', role: 'MEMBER' as const }
    const svc = new WorkspaceService(makeRepo(dto))
    await expect(svc.assertMembership('u1', 'w1')).resolves.toEqual(dto)
  })

  it('throws FORBIDDEN (403) when the user is not a member', async () => {
    const svc = new WorkspaceService(makeRepo(null))
    await expect(svc.assertMembership('u1', 'w1')).rejects.toMatchObject({
      httpStatus: 403,
      message: 'Вы не являетесь участником воркспейса',
    })
    await svc.assertMembership('u1', 'w1').catch((e) => {
      expect(isDomainError(e)).toBe(true)
    })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @repo/domain exec vitest run test/workspace/services/workspace.service.test.ts`
Expected: FAIL — cannot find `workspace.service.ts`.

- [ ] **Step 3: Implement the service**

Create `packages/domain/src/workspace/services/workspace.service.ts` (message verbatim from the original `access.ts`):

```ts
import { forbidden } from '../../shared/errors.ts'
import type { WorkspaceRepository } from '../repositories/workspace.repository.ts'
import type { WorkspaceMembershipDto } from '../dto/workspace.dto.ts'

export class WorkspaceService {
  constructor(private readonly repo: WorkspaceRepository) {}

  async assertMembership(actorUserId: string, workspaceId: string): Promise<WorkspaceMembershipDto> {
    const membership = await this.repo.findMembership(actorUserId, workspaceId)
    if (!membership) throw forbidden('Вы не являетесь участником воркспейса')
    return membership
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @repo/domain exec vitest run test/workspace/services/workspace.service.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/workspace/services/workspace.service.ts packages/domain/test/workspace/services/workspace.service.test.ts
git commit -m "feat(domain): add WorkspaceService.assertMembership"
```

---

## Task 9: `workspace` ContainerModule + barrel

**Files:**
- Create: `packages/domain/src/workspace/workspace.module.ts`
- Modify: `packages/domain/src/workspace/index.ts`

- [ ] **Step 1: Create the ContainerModule**

Create `packages/domain/src/workspace/workspace.module.ts`. We wire with `toResolvedValue(factory, [tokens])` — decorator-free, resolves synchronously. inversify gives the factory args as `unknown`, so cast to the concrete types:

```ts
import { ContainerModule } from 'inversify'

import { SHARED } from '../shared/tokens.ts'
import type { UnitOfWork } from '../shared/unit-of-work.ts'
import { WorkspaceRepository } from './repositories/workspace.repository.ts'
import { WorkspaceService } from './services/workspace.service.ts'
import { WORKSPACE } from './workspace.tokens.ts'

export const workspaceModule = new ContainerModule(({ bind }) => {
  bind(WORKSPACE.Repository).toResolvedValue(
    (uow) => new WorkspaceRepository(uow as UnitOfWork),
    [SHARED.UnitOfWork],
  )
  bind(WORKSPACE.Service).toResolvedValue(
    (repo) => new WorkspaceService(repo as WorkspaceRepository),
    [WORKSPACE.Repository],
  )
})
```

- [ ] **Step 2: Update the module barrel**

Replace `packages/domain/src/workspace/index.ts` with (keep `access.ts` exported **for now** — it is deleted in Task 13 after consumers move off it):

```ts
export * from './access.ts'
export * from './dto/workspace.dto.ts'
export * from './services/workspace.service.ts'
export * from './workspace.tokens.ts'
export * from './workspace.module.ts'
```

- [ ] **Step 3: Type-check**

Run: `pnpm --filter @repo/domain check-types`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/domain/src/workspace/workspace.module.ts packages/domain/src/workspace/index.ts
git commit -m "feat(domain): wire workspace ContainerModule + module barrel"
```

---

## Task 10: Composition root (`container.ts`) + package barrel

**Files:**
- Create: `packages/domain/src/container.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/test/container.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/domain/test/container.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@repo/db'

import { createDomain } from '../src/container.ts'

function makePrisma() {
  return {
    workspaceMember: {
      findUnique: vi.fn(async () => ({ workspaceId: 'w1', userId: 'u1', role: 'MEMBER' })),
    },
  } as unknown as PrismaClient
}

describe('createDomain', () => {
  it('resolves the workspace service from the container', () => {
    const domain = createDomain({ prisma: makePrisma() })
    expect(domain.workspace).toBeDefined()
    expect(typeof domain.workspace.assertMembership).toBe('function')
  })

  it('the resolved service performs a real membership check end-to-end', async () => {
    const domain = createDomain({ prisma: makePrisma() })
    await expect(domain.workspace.assertMembership('u1', 'w1')).resolves.toEqual({
      workspaceId: 'w1',
      userId: 'u1',
      role: 'MEMBER',
    })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @repo/domain exec vitest run test/container.test.ts`
Expected: FAIL — cannot find `../src/container.ts`.

- [ ] **Step 3: Implement the composition root**

Create `packages/domain/src/container.ts`. The `import 'reflect-metadata'` is the **single** allowed import of the polyfill, kept at the composition root only:

```ts
import 'reflect-metadata'

import { Container } from 'inversify'
import type { PrismaClient } from '@repo/db'

import { SHARED } from './shared/tokens.ts'
import { PrismaUnitOfWork } from './shared/unit-of-work.ts'
import { WORKSPACE } from './workspace/workspace.tokens.ts'
import { workspaceModule } from './workspace/workspace.module.ts'
import type { WorkspaceService } from './workspace/services/workspace.service.ts'

export interface DomainDeps {
  prisma: PrismaClient
}

export interface Domain {
  workspace: WorkspaceService
}

export function createDomainContainer(deps: DomainDeps): Container {
  const c = new Container()
  c.bind(SHARED.Prisma).toConstantValue(deps.prisma)
  c.bind(SHARED.UnitOfWork).toResolvedValue(
    (prisma) => new PrismaUnitOfWork(prisma as PrismaClient),
    [SHARED.Prisma],
  )
  c.load(workspaceModule)
  return c
}

export function createDomain(deps: DomainDeps): Domain {
  const c = createDomainContainer(deps)
  return {
    workspace: c.get<WorkspaceService>(WORKSPACE.Service),
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @repo/domain exec vitest run test/container.test.ts`
Expected: PASS (2 tests). If it throws a `Reflect.*` error, confirm `import 'reflect-metadata'` is the first line of `container.ts` (it should be).

- [ ] **Step 5: Export the container from the package barrel**

Add this line to `packages/domain/src/index.ts` (append after the existing exports):

```ts
export * from './container.ts'
```

- [ ] **Step 6: Full package check + test**

Run: `pnpm --filter @repo/domain check-types && pnpm --filter @repo/domain test`
Expected: PASS (all domain tests, including the legacy flat-module suites which are untouched).

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/container.ts packages/domain/src/index.ts packages/domain/test/container.test.ts
git commit -m "feat(domain): add createDomain composition root + export from barrel"
```

---

## Task 11: Wire `@repo/trpc` to the domain facade

**Files:**
- Create: `packages/trpc/src/domain.ts`
- Modify: `packages/trpc/src/helpers/workspace.ts`

- [ ] **Step 1: Create the trpc-side singleton**

Create `packages/trpc/src/domain.ts` (extensionless imports — trpc convention):

```ts
import { prisma } from '@repo/db'
import { createDomain } from '@repo/domain'

// Process-wide singleton: prisma is itself a singleton; actor ids are passed per call.
export const domain = createDomain({ prisma })
```

- [ ] **Step 2: Rewire the workspace helper**

Replace `packages/trpc/src/helpers/workspace.ts` with (drops the now-redundant `prisma` parameter — `domain` already holds it):

```ts
import type { PrismaClient } from '@repo/db'
import { domain } from '../domain'
import { mapDomain } from './map-domain'

export function assertWorkspaceMembership(userId: string, workspaceId: string) {
  return mapDomain(() => domain.workspace.assertMembership(userId, workspaceId))
}

export async function assertWorkspaceMember(
  ctx: { prisma: PrismaClient; user: { id: string } },
  workspaceId: string,
) {
  return assertWorkspaceMembership(ctx.user.id, workspaceId)
}
```

- [ ] **Step 3: Find any other callers of the helper's `assertWorkspaceMembership(prisma, …)`**

Run: `grep -rn "assertWorkspaceMembership(" packages/trpc/src apps --include="*.ts" --include="*.tsx" | grep -v node_modules`
Expected: the only call to the **helper** form is inside `helpers/workspace.ts` (now updated). `apps/web`'s route imports the **domain** path (handled in Task 12). If any other file calls `assertWorkspaceMembership(ctx.prisma, …)`, update it to the two-arg form `assertWorkspaceMembership(userId, workspaceId)`.

- [ ] **Step 4: Type-check + test trpc**

Run: `pnpm --filter @repo/trpc check-types && pnpm --filter @repo/trpc test`
Expected: PASS. (`assertWorkspaceMember(ctx, …)` keeps its signature, so routers are unchanged.)

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/domain.ts packages/trpc/src/helpers/workspace.ts
git commit -m "refactor(trpc): call domain.workspace.assertMembership via createDomain singleton"
```

---

## Task 12: Wire `apps/web` to the domain facade

**Files:**
- Create: `apps/web/src/lib/domain.ts`
- Modify: `apps/web/src/app/api/workspaces/[workspaceId]/pages/[pageId]/export/[format]/route.ts`

- [ ] **Step 1: Create the web-side singleton**

Create `apps/web/src/lib/domain.ts`:

```ts
import { prisma } from '@repo/db'
import { createDomain } from '@repo/domain'

export const domain = createDomain({ prisma })
```

- [ ] **Step 2: Rewire the export route**

In `apps/web/src/app/api/workspaces/[workspaceId]/pages/[pageId]/export/[format]/route.ts`:

Replace line 5:
```ts
import { assertWorkspaceMembership } from '@repo/domain/workspace/access.ts'
```
with:
```ts
import { domain } from '@/lib/domain'
```

Replace the call on line 48:
```ts
    await assertWorkspaceMembership(prisma, session.user.id, workspaceId)
```
with:
```ts
    await domain.workspace.assertMembership(session.user.id, workspaceId)
```

Leave line 6 (`import { isDomainError } from '@repo/domain/errors.ts'`) and line 50 unchanged — `errors.ts` is still a valid compat path and `isDomainError`/`httpStatus` are unchanged.

- [ ] **Step 3: Type-check web + dev-curl the route**

Run: `pnpm --filter web check-types`
Expected: PASS.

Then, with `docker compose up -d` running, start `pnpm --filter web dev`, sign in, and request an export for a workspace the user is NOT a member of. Expected: HTTP **403** (`{"error":"Forbidden"}`) — same behavior as before. (Per CLAUDE.md, dynamic routes must be exercised at request time, not just type-checked.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/domain.ts "apps/web/src/app/api/workspaces/[workspaceId]/pages/[pageId]/export/[format]/route.ts"
git commit -m "refactor(web): call domain.workspace.assertMembership via createDomain singleton"
```

---

## Task 13: Delete the legacy `workspace/access.ts`

**Files:**
- Delete: `packages/domain/src/workspace/access.ts`
- Modify: `packages/domain/src/workspace/index.ts`

- [ ] **Step 1: Confirm nothing still imports the free function**

Run: `grep -rn "workspace/access" --include="*.ts" --include="*.tsx" apps packages | grep -v node_modules | grep -v dist`
Expected: **no results** (Tasks 11 and 12 removed both consumers). If any remain, fix them before deleting.

- [ ] **Step 2: Remove the barrel export**

In `packages/domain/src/workspace/index.ts`, delete the line:
```ts
export * from './access.ts'
```

- [ ] **Step 3: Delete the file**

Run: `git rm packages/domain/src/workspace/access.ts`

- [ ] **Step 4: Type-check the whole graph + test**

Run: `pnpm --filter @repo/domain check-types && pnpm --filter @repo/domain test && pnpm --filter @repo/trpc check-types`
Expected: PASS. No `TS2307`/`couldNotResolve` for `workspace/access`.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/workspace/index.ts
git commit -m "refactor(domain): remove legacy workspace/access.ts free function"
```

---

## Task 14: Enforce the intra-domain layers in dependency-cruiser

**Files:**
- Modify: `.dependency-cruiser.cjs`

- [ ] **Step 1: Add the intra-domain rules**

In `.dependency-cruiser.cjs`, add these five objects to the `forbidden` array (place them right after the existing `domain-only-adapters` rule). The `dependencyTypesNot: ['type-only']` clauses rely on the config's `tsPreCompilationDeps: true`, so `import type { … } from '@repo/db'` stays allowed:

```js
    {
      name: 'domain-dto-no-upward',
      comment: 'Domain DTO layer imports nothing from repositories/services (data has no internal deps).',
      severity: 'error',
      from: { path: '^packages/domain/src/[^/]+/dto/' },
      to: { path: '^packages/domain/src/[^/]+/(repositories|services)/' },
    },
    {
      name: 'domain-dto-no-inversify',
      comment: 'Domain DTO leaves stay client-safe — never import inversify.',
      severity: 'error',
      from: { path: '^packages/domain/src/[^/]+/dto/' },
      to: { path: '^inversify($|/)' },
    },
    {
      name: 'domain-repo-no-services',
      comment: 'Domain repositories never import services (no upward edge).',
      severity: 'error',
      from: { path: '^packages/domain/src/[^/]+/repositories/' },
      to: { path: '^packages/domain/src/[^/]+/services/' },
    },
    {
      name: 'domain-services-no-db-value',
      comment: 'Domain services never import @repo/db as a value (type-only ok) — I/O lives in repositories.',
      severity: 'error',
      from: { path: '^packages/domain/src/[^/]+/services/' },
      to: { path: '^packages/db/', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'domain-module-isolation',
      comment: 'A domain module reaches another module only via its index.ts barrel or shared/, not deep internals.',
      severity: 'error',
      from: { path: '^packages/domain/src/([^/]+)/(dto|repositories|services)/' },
      to: {
        path: '^packages/domain/src/([^/]+)/',
        pathNot: [
          '^packages/domain/src/$1/',
          '^packages/domain/src/shared/',
          '^packages/domain/src/[^/]+/index\\.ts$',
        ],
      },
    },
```

- [ ] **Step 2: Run the architecture check**

Run: `pnpm check-architecture`
Expected: PASS — `no dependency violations found`. The `workspace` module already obeys all five rules (service imports `@repo/db` only as a type via the DTO; repository does the I/O; dto imports no inversify).

- [ ] **Step 3: Commit**

```bash
git add .dependency-cruiser.cjs
git commit -m "feat(arch): enforce intra-domain dto/repository/service boundaries"
```

---

## Task 15: Document the convention + run the full merge gate

**Files:**
- Modify: `docs/architecture.md`

- [ ] **Step 1: Document the intra-domain layering**

Append a subsection to `docs/architecture.md` (under the domain tier) describing the per-module layout and rules. Use this text:

```markdown
### `@repo/domain` internal layering

Each domain module is split into three layers, wired by inversify (decorator-free) and
exposed through `createDomain(deps)`:

- `dto/<module>.dto.ts` — data structures (zod input schemas + output DTO types). Pure
  and client-safe: no `inversify`, no value import of `@repo/db` (type-only is fine).
- `repositories/<module>.repository.ts` — the **only** layer doing I/O. Reads the active
  client from the injected `UnitOfWork`, and maps Prisma rows to DTOs.
- `services/<module>.service.ts` — business logic over DTOs. Never imports `@repo/db` as
  a value; opens transactions via `UnitOfWork.transaction(...)`.

Cross-aggregate atomicity uses `UnitOfWork` (`shared/unit-of-work.ts`), backed by
`AsyncLocalStorage`. The composition root is `container.ts` (`createDomain`). Consumers
build one process-singleton (`packages/trpc/src/domain.ts`, `apps/web/src/lib/domain.ts`)
and pass actor ids per call. Boundaries are enforced by `pnpm check-architecture`.
```

- [ ] **Step 2: Run the full merge gate**

Run: `pnpm gates`
Expected: PASS — `check-types`, `lint` (`--max-warnings 0`), `check-architecture`, `build`, and `test` all green across the workspace.

- [ ] **Step 3: Verify no client component imports the `@repo/domain` root barrel**

Run: `grep -rn "from '@repo/domain'" apps/web/src --include="*.ts" --include="*.tsx" | grep -v node_modules`
Expected: **no results** in client components. The root barrel now pulls in `inversify`; client code must deep-import pure leaves only (`@repo/domain/<module>/dto/...`, kanban colors). The only `@repo/domain` *root* importer in web is the server-only `apps/web/src/lib/domain.ts`.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture.md
git commit -m "docs(domain): document intra-domain layering and DI composition root"
```

---

## Self-Review

**1. Spec coverage** (against `2026-05-30-domain-layered-architecture-design.md`):
- R1 repositories / R2 services / R3 dto with `<module>.<layer>.ts` naming → Tasks 5–9. ✓
- R4 DTO-only communication (repo maps Prisma→DTO, service returns DTO) → Tasks 7, 8. ✓
- R5 entities in their layer + R6 inversify DI → Tasks 6, 9, 10; enforced Task 14. ✓
- D2 UnitOfWork+ALS → Task 4. ✓
- D3 zod/DTO + mappers (workspace has no input command; output DTO + mapper present) → Tasks 5, 7. ✓
- D4 composition root in domain + consumer bridges → Tasks 10, 11, 12. ✓
- D5 decorator-free (`toResolvedValue`, no `@injectable`) → Tasks 9, 10. ✓
- D6 pure/client-safe leaves (dto type-only `@repo/db`, no inversify) → Tasks 5, 14, 15-step3. ✓
- §13 enforcement → Task 14. ✓  §12 scaffold-first ordering → Tasks 2–10. ✓
- Engines bridge: **not** in this plan — `apps/engines` does not consume `workspace` (verified: no engines import of `assertWorkspaceMembership`). The engines `createDomain` bridge is introduced in the first engines-consuming module plan (`favorites`). Noted, not a gap.

**2. Placeholder scan:** No "TBD/TODO/handle edge cases/similar to Task N". Every code step shows complete code; the one conditional (reflect-metadata) has a concrete action. ✓

**3. Type consistency** across tasks:
- `UnitOfWork { client(): Db; transaction<T>(fn: () => Promise<T>): Promise<T> }` — Tasks 4, 7, 10. ✓
- `WorkspaceRepository.findMembership(userId, workspaceId): Promise<WorkspaceMembershipDto | null>` — Tasks 7, 8. ✓
- `WorkspaceService.assertMembership(actorUserId, workspaceId): Promise<WorkspaceMembershipDto>` — Tasks 8, 10, 11, 12. ✓
- `WorkspaceMembershipDto { workspaceId; userId; role }` — Tasks 5, 7, 8, 10. ✓
- Tokens `SHARED.{Prisma,UnitOfWork}`, `WORKSPACE.{Repository,Service}` — Tasks 3, 6, 9, 10. ✓
- `createDomain(deps: { prisma }): { workspace: WorkspaceService }` — Tasks 10, 11, 12. ✓
- Helper `assertWorkspaceMembership(userId, workspaceId)` (prisma dropped) + `assertWorkspaceMember(ctx, workspaceId)` — Task 11. ✓

No gaps found.

---

## Notes for the remaining modules (follow-on plans)

Each subsequent module (`favorites` → `notifications` → `billing` → `pages` → `reminders` → `kanban`, in that order) repeats Tasks 5–10 for that module and updates its specific call sites. Module-specific deltas to plan for then:
- **`favorites`, `notifications`, `pages`, `kanban`** also need an **`apps/engines` bridge** (`createDomain({ prisma, … })` factory provider + per-service factory providers) — introduce it fully in the **`favorites`** plan (first engines consumer), reuse after.
- **`reminders`** adds a consumer-implemented **port**: extend `DomainDeps` with `scheduler: DeliveryScheduler`, bind `REMINDERS.Scheduler` via `toConstantValue`, and have the service pass `uow.client()` to `scheduler.rebuild(...)` inside `uow.transaction(...)`.
- **`billing`/`kanban`** carry **pure helpers** (`getPlanDisplayName`, position math, label colors) — place constants/pure data in `dto/` leaves and pure business functions in the service layer per D6; never container-bind them.
