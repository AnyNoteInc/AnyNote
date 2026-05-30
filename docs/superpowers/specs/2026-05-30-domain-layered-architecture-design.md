# Domain Layered Architecture — Design Spec

- **Date:** 2026-05-30
- **Status:** Approved (design), pending implementation plan
- **Scope decision:** All 7 modules migrated in one effort (D1)
- **Package:** `@repo/domain` (`packages/domain`)

## 1. Context & problem

`@repo/domain` is the framework-agnostic home for write logic, consumed by **both**
`@repo/trpc` (presentation/transport) and `apps/engines` (NestJS), plus a few
client-safe deep imports from `apps/web`. It was populated over three migration
cycles (Kanban → notifications/favorites/reminders → pages) and now holds 7 modules:
`billing`, `favorites`, `kanban`, `notifications`, `pages`, `reminders`, `workspace`.

Today every module is **flat**: business logic, I/O, and data structures are mixed
in files like `functions.ts` and `schemas.ts`. There is no separation of concerns:

- Functions are free functions called as `fn(prisma, actorUserId, input, [port])`.
  The `PrismaClient` (I/O) is threaded as the first argument through every call site.
- Business rules (authorization checks, activity logging, position math) sit in the
  same file as the Prisma queries that serve them.
- Return values are **raw Prisma rows** — the transport layer receives database
  shapes, not domain contracts.
- The only nod to inversion is `reminders/ports.ts` (`DeliveryScheduler`), but it
  does not follow any consistent convention.

This works, but it does not scale: there is no enforced place for new logic, no
boundary that prevents I/O leaking into business rules, and no DI seam. The goal of
this cycle is to **set the structure now so future extension is cheap and safe.**

The same layering philosophy is being applied in parallel to `apps/agents`
(Python/FastAPI) — repositories / services / use_cases with Dishka DI
(see `2026-05-30-apps-agents-cleanup-design.md`). This spec is the TypeScript analog
using **inversify**.

## 2. Requirements (the rules, verbatim intent)

The target architecture must satisfy six rules given for this package:

1. **R1 — Repositories layer.** Each module contains a `repositories/` folder holding
   everything related to input/output (I/O). Files are named `<module>.repository.ts`.
2. **R2 — Services layer.** All business logic lives in a `services/` folder. Files are
   named `<module>.service.ts`.
3. **R3 — DTO layer.** All data structures live in a `dto/` folder. Files are named
   `<module>.dto.ts`.
4. **R4 — DTO-only communication.** All communication **between layers** happens through
   DTOs. No exceptions. (A repository never returns a raw Prisma row to a service.)
5. **R5 — Entities stay in their layer.** No entity escapes its layer. No exceptions.
6. **R6 — DI via inversify.** Injection happens through the `inversify` container.

## 3. Goals / non-goals

**Goals**
- Reorganize **all 7 modules** into `dto/` + `repositories/` + `services/` with a
  consistent file-naming convention.
- Introduce an **inversify** composition root owned by `@repo/domain`, with
  decorator-free wiring that compiles identically under tsc, SWC, and esbuild.
- Make cross-aggregate writes atomic via a **UnitOfWork** backed by
  `AsyncLocalStorage`, replacing the per-function `prisma.$transaction(...)` calls.
- Force repositories to return **DTOs** (zod-derived types), mapping Prisma rows at
  the repository boundary.
- Update all consumer call sites (`@repo/trpc`, `apps/engines`, `apps/web`) to the
  new service API.
- **Enforce** the layer boundaries automatically via `dependency-cruiser`
  (part of `pnpm gates`), so the structure cannot regress.

**Non-goals**
- Changing observable behavior. This is a pure structural refactor; every domain
  operation keeps its current semantics, error codes, and Russian messages.
- Migrating *read* paths that currently bypass the domain (the transport layer still
  reads Prisma directly where it does today — domain owns **writes**, consistent with
  the existing architecture decision).
- Adopting inversify in the **consumers** themselves. `apps/engines` keeps NestJS DI;
  `@repo/trpc` keeps its per-request context. inversify lives **inside** `@repo/domain`
  (D4).
- Touching `apps/agents` (separate Python effort).

## 4. Decisions

### D1 — Scope: all 7 modules at once
Chosen over a single reference-module pilot. Higher blast radius (24+ call sites across
3 consumer packages) but one coherent result. Mitigated by per-module verification
(`pnpm gates` after each module) and a fixed migration order (§12).

### D2 — Transactions: UnitOfWork + AsyncLocalStorage
A `UnitOfWork` service wraps `prisma.$transaction`. Repositories read the **active**
client from an `AsyncLocalStorage`; outside a transaction that is the base `prisma`,
inside one it is the `tx`. Services that need atomicity across repositories wrap their
work in `uow.transaction(async () => { … })`. Chosen over explicit `tx`-threading
(verbose, leaks `tx` into every method signature) and over "client as a parameter"
(keeps the current style but bypasses DI, violating R6). ALS keeps method signatures
clean and lets repositories/services be stateless singletons.

### D3 — DTOs: zod schemas + inferred types + explicit mappers
A DTO is a **zod schema** (for input commands, giving runtime validation at the
boundary) plus its inferred type; **output DTOs** are zod schemas/types too. The
repository maps `Prisma row → output DTO` with an explicit mapper. Chosen over class
DTOs (more boilerplate, duplicate validation) and over plain interfaces with zod only
on input (output contracts would lack runtime guarantees). Matches the existing
zod-everywhere stack. **Mappers live in the repository layer** (the repository owns
both I/O and the translation of its results) so `dto/` stays pure data.

### D4 — DI reach: composition root in `@repo/domain`
`@repo/domain` exports `createDomain(deps)` which builds an inversify `Container`,
binds infrastructure (the `PrismaClient`, the `DeliveryScheduler` impl, …) supplied by
the caller, loads every module's `ContainerModule`, and returns a typed facade of
services. Consumers integrate this facade into their existing DI/no-DI world. inversify
does not leak out of the package. Chosen over "inversify across the whole repo" (large
rewrite of engines/trpc) and "domain owns a hard-coded singleton container" (no seam
for per-process infra or tests).

### D5 — DI mechanism: decorator-free factory bindings
**This is the load-bearing technical decision.** `@repo/domain` is compiled by **three
different toolchains**: `tsc` NodeNext (engines type-checks domain source), **SWC**
(Next transpiles `@repo/domain` — it is listed in `apps/web/next.config.js`
`transpilePackages`), and **esbuild** (vitest). esbuild **cannot emit
`emitDecoratorMetadata`**, and only `apps/engines/tsconfig.json` enables
`experimentalDecorators` anywhere in the repo.

Therefore we do **not** use `@injectable()`/`@inject()` decorators. Domain classes are
**plain TypeScript classes** with ordinary constructors. All wiring is explicit, in
each module's `*.module.ts`, using inversify 7's `toDynamicValue` / `toResolvedValue`
+ `toConstantValue`. Benefits:
- Zero decorator/metadata configuration in **any** toolchain — the package compiles
  identically everywhere.
- Domain classes never import `inversify`; only `*.module.ts` and `container.ts` do.
- Services are trivially unit-testable with `new BillingService(fakeRepo)` — no
  container needed in tests.

Trade-off: wiring is written by hand instead of derived from decorators. This is
*more* explicit, which suits the "no future surprises" goal. (Verify during
implementation whether inversify 7 needs a one-time `reflect-metadata` import at the
composition root for the non-decorator path; if so, import it once inside
`container.ts`, never in business code.)

### D6 — Pure, dependency-free logic stays out of the container
Constants (kanban label colors), pure math (`positionBetween`, `endPosition`), and pure
mappers (`getPlanDisplayName`) have **no dependencies**, so there is nothing to inject.
Forcing them through the container adds ceremony for zero benefit, and several are
deep-imported by **client** components (`apps/web` imports `@repo/domain/kanban/colors`).
R6 is about *injection*; a pure function has nothing to inject. Such helpers live as:
- **constants / pure data** → in the `dto/` layer (client-safe leaf), or
- **pure business functions** → co-located in the service layer as exported module
  functions / static helpers (still "in the services layer", just not container-bound).

This is codified in §10 and enforced by keeping these files free of `@repo/db` and
`inversify` imports.

## 5. Target module structure

Every module follows this shape (shown for `billing`):

```
src/billing/
  dto/
    billing.dto.ts          # zod schemas (input commands) + inferred types + output DTO types
    index.ts                # barrel for the dto leaf (client-safe)
  repositories/
    billing.repository.ts   # class BillingRepository — ONLY I/O; maps Prisma → DTO
  services/
    billing.service.ts      # class BillingService — ONLY business logic; speaks DTO
  billing.ports.ts          # (optional) interfaces of collaborators the CONSUMER implements
  billing.tokens.ts         # inversify symbols for this module
  billing.module.ts         # ContainerModule binding this module's repo + service
  index.ts                  # server-only module barrel (re-exports service + dto + tokens)
```

Shared infrastructure (created once, in step 1 of the migration):

```
src/shared/
  errors.ts                 # DomainError + notFound/forbidden/badRequest/conflict/isDomainError
                            #   (moved from src/errors.ts; old path re-exported for compat)
  tokens.ts                 # shared symbols: PRISMA, UNIT_OF_WORK
  unit-of-work.ts           # UnitOfWork interface + PrismaUnitOfWork (ALS) implementation
  prisma-client.type.ts     # type Db = PrismaClient | Prisma.TransactionClient
src/container.ts            # createDomainContainer(deps) + createDomain(deps) — composition root
src/tokens.ts               # (optional) re-export of all module tokens for consumers
src/index.ts                # server-only package barrel
```

## 6. Layer contracts

Imports may only point **downward** within a module. The runtime dependency rules:

| Layer | May import (value) | Returns / accepts across boundary | May touch Prisma (value) |
|---|---|---|---|
| `dto/` | `zod` only | — (it *is* the contract) | **no** |
| `repositories/` | `dto/`, `shared/`, `@repo/db` | **DTOs only** (never raw Prisma rows) | **yes** — the only I/O layer |
| `services/` | `repositories/`, `dto/`, `*.ports.ts`, `shared/` | **DTOs only** | **no** (type-only import allowed) |
| `*.ports.ts` | `dto/`, `shared/`, `@repo/db` (types) | interface contracts for injected collaborators | n/a (interface) |
| `*.module.ts` / `container.ts` | everything above + `inversify` | wires tokens → instances | binds |

- **R4** holds because a repository's public methods take and return DTO types; the
  Prisma row never crosses into a service.
- **R5** holds because each artifact has exactly one home and depcruise forbids the
  illegal edges (§13).
- A repository depends on the `UnitOfWork` (to obtain the active client), **not** on a
  bare `PrismaClient`. The base `PrismaClient` is bound once and consumed only by
  `PrismaUnitOfWork`.

## 7. DTO layer + mappers

`dto/<module>.dto.ts` holds, per operation:
- the **input command** zod schema + inferred type (migrated from today's `schemas.ts`);
- the **output DTO** type (new) — the shape the repository/service returns.

Example (`reminders`):

```ts
// reminders/dto/reminders.dto.ts
import { z } from 'zod'

export const createReminderInput = z.object({
  pageId: z.string().uuid(),
  dueAt: z.date(),
  offsets: z.array(z.number().int().min(0).max(525_600)).max(20).default([]),
  audience: z.enum(['ME', 'WORKSPACE', 'LIST']).default('ME'),
  label: z.string().max(200).nullable().optional(),
})
export type CreateReminderInput = z.infer<typeof createReminderInput>

// output DTO — what callers receive (no Prisma types leak)
export interface ReminderDto {
  id: string
  pageId: string
  workspaceId: string
  createdById: string | null
  dueAt: Date
  offsets: number[]
  audience: ReminderAudienceDto
  label: string | null
  doneAt: Date | null
}

// the structure handed to the DeliveryScheduler port (was reminders/ports.ts)
export interface ReminderForRebuildDto extends ReminderDto {
  recipients: string[]
}
```

Mapping `Prisma row → ReminderDto` is a private concern of `ReminderRepository`
(inline `private toDto(row)` or a co-located `reminders.mapper.ts` inside
`repositories/`). `dto/` never imports `@repo/db`, so it stays a client-safe leaf.

## 8. DI mechanism (decorator-free inversify)

Tokens are `Symbol`s, grouped per module:

```ts
// shared/tokens.ts
export const SHARED = {
  Prisma: Symbol.for('domain/Prisma'),
  UnitOfWork: Symbol.for('domain/UnitOfWork'),
} as const

// reminders/reminders.tokens.ts
export const REMINDERS = {
  Repository: Symbol.for('domain/ReminderRepository'),
  Service: Symbol.for('domain/ReminderService'),
  Scheduler: Symbol.for('domain/DeliveryScheduler'), // consumer-provided port
} as const
```

Classes are plain (no decorators, no inversify import):

```ts
// reminders/repositories/reminders.repository.ts
export class ReminderRepository {
  constructor(private readonly uow: UnitOfWork) {}
  async create(actorUserId: string, input: CreateReminderInput): Promise<ReminderDto> {
    const row = await this.uow.client().reminder.create({ /* … */ })
    return this.toDto(row)
  }
  // … private toDto(row): ReminderDto
}

// reminders/services/reminders.service.ts
export class ReminderService {
  constructor(
    private readonly repo: ReminderRepository,
    private readonly uow: UnitOfWork,
    private readonly scheduler: DeliveryScheduler,
  ) {}
  async create(actorUserId: string, input: CreateReminderInput): Promise<ReminderDto> {
    return this.uow.transaction(async () => {
      const reminder = await this.repo.create(actorUserId, input)
      await this.scheduler.rebuild(this.uow.client(), toRebuildDto(reminder))
      return reminder
    })
  }
}
```

Wiring is explicit, in the module:

```ts
// reminders/reminders.module.ts
import { ContainerModule } from 'inversify'

export const remindersModule = new ContainerModule((bind) => {
  bind(REMINDERS.Repository).toDynamicValue((ctx) =>
    new ReminderRepository(ctx.get(SHARED.UnitOfWork)),
  ).inSingletonScope()

  bind(REMINDERS.Service).toDynamicValue((ctx) =>
    new ReminderService(
      ctx.get(REMINDERS.Repository),
      ctx.get(SHARED.UnitOfWork),
      ctx.get(REMINDERS.Scheduler),
    ),
  ).inSingletonScope()
})
```

> Implementation note: inversify 7 offers two decorator-free binding forms —
> `toDynamicValue((ctx) => new X(ctx.get(T)))` (resolution-context form, shown above)
> and `toResolvedValue((dep) => new X(dep), [T])` (deps resolved and passed as args).
> Both keep `container.get` **synchronous** when the factory and all dependencies are
> synchronous (our case: `toConstantValue` infra + sync `new`). The plan will pick one
> form and apply it uniformly; if a `toResolvedValue` edge forces async resolution,
> `createDomain` resolves the facade once via `getAsync` (composition-time only).

The composition root:

```ts
// container.ts
import { Container } from 'inversify'

export interface DomainDeps {
  prisma: PrismaClient
  scheduler: DeliveryScheduler
  // future consumer-provided ports go here
}

export interface Domain {
  billing: BillingService
  favorites: FavoriteService
  kanban: KanbanService
  notifications: NotificationService
  pages: PageService
  reminders: ReminderService
  workspace: WorkspaceService
}

export function createDomainContainer(deps: DomainDeps): Container {
  const c = new Container({ defaultScope: 'Singleton' })
  c.bind(SHARED.Prisma).toConstantValue(deps.prisma)
  c.bind(SHARED.UnitOfWork).toDynamicValue((ctx) => new PrismaUnitOfWork(ctx.get(SHARED.Prisma)))
  c.bind(REMINDERS.Scheduler).toConstantValue(deps.scheduler)
  c.load(
    billingModule, favoritesModule, kanbanModule, notificationsModule,
    pagesModule, remindersModule, workspaceModule,
  )
  return c
}

export function createDomain(deps: DomainDeps): Domain {
  const c = createDomainContainer(deps)
  return {
    billing: c.get(BILLING.Service),
    favorites: c.get(FAVORITES.Service),
    kanban: c.get(KANBAN.Service),
    notifications: c.get(NOTIFICATIONS.Service),
    pages: c.get(PAGES.Service),
    reminders: c.get(REMINDERS.Service),
    workspace: c.get(WORKSPACE.Service),
  }
}
```

`actorUserId` is **always a method parameter**, never injected — it is request data,
not a collaborator.

## 9. Transactions (UnitOfWork + ALS)

```ts
// shared/unit-of-work.ts
import { AsyncLocalStorage } from 'node:async_hooks'

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
    if (active) return fn() // already in a tx — join it
    return this.prisma.$transaction((tx) => this.als.run(tx, fn))
  }
}
```

- Repositories call `this.uow.client()` for every query — transparently `prisma` or `tx`.
- Ports that perform I/O (e.g. `DeliveryScheduler.rebuild(client, dto)`) receive the
  active client explicitly from the service (`this.uow.client()`), because the port is
  implemented **outside** the domain and is not ALS-aware.
- ALS isolates the active `tx` per async request context, so singleton repositories are
  safe under concurrency.
- **Runtime check:** ALS is a Node built-in. All domain call paths run on Node — NestJS
  (engines), tRPC HTTP route (`runtime = "nodejs"`), the RSC server caller, and vitest.
  No edge-runtime path invokes the domain. (Confirm no domain call sits behind an
  `export const runtime = 'edge'` route during implementation.)

## 10. Pure functions & client-safe leaves

- **Constants / pure data** (e.g. kanban label colors) live in `dto/` (or a clearly
  pure leaf). They import neither `@repo/db` nor `inversify`, so client components in
  `apps/web` can deep-import them exactly as today (`@repo/domain/kanban/...`).
- **Pure business functions** (position math, `getPlanDisplayName`, date shifts) live in
  the service layer as exported module functions or static helpers — business logic, but
  not container-bound (nothing to inject).
- **Server-only boundary:** services, repositories, `*.module.ts`, and `container.ts`
  are server-only (they pull in `inversify` and, transitively, `@repo/db`). The package
  **root barrel** (`src/index.ts`) is server-only and must never be imported by a client
  component. Client components continue to deep-import pure leaves only — consistent with
  the existing architecture rule in `CLAUDE.md`.

## 11. Consumer integration

### `packages/trpc` (no DI — module singleton)
```ts
// one module-level singleton; prisma + scheduler are themselves singletons
const domain = createDomain({ prisma, scheduler })

// in a procedure:
.mutation(({ ctx, input }) => mapDomain(() => domain.reminders.create(ctx.user.id, input)))
```
`mapDomain` / `isDomainError` are unchanged. Routers stop importing `* as domain` free
functions and call `domain.<module>.<method>(actorUserId, input)` instead.

### `apps/engines` (NestJS — one bridge provider)
A single Nest provider builds the facade; each domain service is re-exposed as a
provider so existing `@Inject`/constructor injection keeps working:
```ts
export const DOMAIN = Symbol('DOMAIN')

const domainProvider: FactoryProvider<Domain> = {
  provide: DOMAIN,
  inject: [PRISMA],
  useFactory: (prisma: PrismaClient) => createDomain({ prisma, scheduler: realScheduler }),
}
// then, per service used by the app:
{ provide: ReminderService, inject: [DOMAIN], useFactory: (d: Domain) => d.reminders }
```
The NestJS service classes that wrap the domain (e.g. `reminder.service.ts`) keep their
current signatures; only the body changes from `domain.createReminder(prisma, …)` to
`this.domain.reminders.create(…)`. `mapDomainError` is unchanged.

### `apps/web` (deep imports of pure leaves only)
Client components keep importing pure constants/types from `dto/` leaves. The one server
route that uses `assertWorkspaceMembership` / `isDomainError`
(`api/.../export/[format]/route.ts`) imports them from the (server-only) workspace
service / shared errors. Import paths update; behavior does not.

## 12. Migration order (all 7 modules)

1. **Scaffold (no behavior change):** create `shared/` (errors move + UnitOfWork/ALS +
   tokens), `container.ts`, the per-module folder skeleton, conventions section in
   `CLAUDE.md`/`docs/architecture.md`, and the new depcruise rules (initially scoped so
   they don't fail on un-migrated modules). Wire `createDomain` into `@repo/trpc` and
   `apps/engines` with an empty/partial facade.
2. **Per-module migration**, in increasing order of complexity so the pattern is proven
   on easy modules first:
   `workspace` → `favorites` → `notifications` → `billing` → `pages` → `reminders` →
   `kanban`.
   Each module: build `dto/` + `repositories/` + `services/` + `*.module.ts` + tokens;
   move pure helpers per §10; register in `createDomain`; update that module's call sites
   in `trpc`/`engines`/`web`; delete the old flat files.
3. After **each** module, run `pnpm gates` (check-types + lint + build + test across all
   consumers) and the new architecture check. A module is "done" only when the whole
   merge gate is green.
4. **Finalize:** tighten depcruise to cover all modules; remove any temporary compat
   re-exports; update docs.

`reminders` (transaction + injected `DeliveryScheduler` port + mapping) and `kanban`
(largest surface, activity logging, position math) are deliberately last as the richest
stress tests of the pattern.

## 13. Enforcement (dependency-cruiser)

Extend the existing `pnpm check-architecture` config (already part of `pnpm gates`) with
intra-`@repo/domain` rules:

- `dto/**` must not import `repositories/**` or `services/**` (data depends on nothing
  internal).
- `repositories/**` must not import `services/**` (no upward edge).
- `services/**` must not import `@repo/db` as a **value** (type-only allowed) — forces
  "I/O only in repositories" and approximates "communicate via DTO".
- `services/**` and `repositories/**` must not import another module's internals — only
  its `index.ts` barrel or `shared/` (keeps modules decoupled).
- Pure-leaf guard: `dto/**` must not import `@repo/db` or `inversify` (keeps client-safe).

These rules make R4 and R5 regression-proof rather than convention-only.

## 14. Testing strategy

- **Unit (services):** construct the service directly with fake repositories and a fake
  `UnitOfWork` (`transaction(fn) => fn()`, `client()` returns a stub). No container, no
  Prisma — services are pure logic over DTOs.
- **Repository / integration:** keep the existing vitest suites (they already exercise
  the real Prisma against the test DB). Re-point them at the repository classes; assert
  on returned **DTOs**, not Prisma rows.
- **Container smoke test:** one test that `createDomain({ prisma, scheduler })` resolves
  every service without throwing (catches missing/cyclic bindings).
- **Consumer tests** (`@repo/trpc`, `apps/engines`) stay green — they validate the
  call-site updates.
- The existing `test/` tree mirrors `src/`; move each test next to its new layer
  (`test/<module>/services/…`, `test/<module>/repositories/…`).

## 15. Risks & mitigations

- **inversify under three toolchains.** Mitigated by D5 (decorator-free): no decorator
  metadata is required, so SWC/esbuild/tsc behave identically. Add `inversify` to
  `@repo/domain` `dependencies`; it is already implicitly transpiled by Next via
  `transpilePackages`. Verify NodeNext resolution of `inversify`'s package exports in the
  engines build during step 1.
- **`container.get` async surprise.** Mitigated by keeping all factories synchronous; if
  inversify forces async for a binding form, fall back to an async composition root
  (`getAsync` once at startup). Decided concretely in the plan.
- **ALS correctness under concurrency.** Mitigated by the join-existing-tx logic and a
  targeted test that runs two overlapping `transaction()` calls and asserts isolation.
- **Big-bang call-site churn.** Mitigated by the fixed per-module order and the
  green-gate-per-module rule; temporary compat re-exports (old `src/errors.ts` path) may
  bridge a module mid-migration and are removed in step 4.
- **`reflect-metadata` need.** Verify once in step 1; if required for the non-decorator
  path, import it a single time in `container.ts`.

## 16. Open items to confirm during implementation

- Exact inversify 7 binding form (`toDynamicValue` vs `toResolvedValue`) and whether any
  `reflect-metadata` import is needed for decorator-free use.
- Whether `inversify` resolves cleanly under `moduleResolution: NodeNext` in the engines
  type-check (it ships proper `exports`; confirm).
- Final list of pure helpers that move to `dto/` vs service-layer functions (enumerate
  per module during its migration).
- Whether any `@repo/domain` consumer sits behind an edge runtime (expected: none).
