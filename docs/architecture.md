# Architecture layers

Imports point **downward** only. Enforced by `.dependency-cruiser.cjs`
(`pnpm check-architecture`, part of `pnpm gates`). Full rationale and decisions:
[`docs/superpowers/specs/2026-05-29-architecture-layering-design.md`](superpowers/specs/2026-05-29-architecture-layering-design.md).

| Tier                       | Packages                                                                        | May import                                                      |
| -------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 5 · Presentation/transport | `apps/web`, `apps/engines`, `apps/yjs`, `@repo/trpc`                            | everything below                                                |
| 4a · UI foundation         | `@repo/ui`, `@repo/diagram-board`                                               | nothing `@repo/*`                                               |
| 4b · UI feature            | `drawio`, `excalidraw`, `genogram`, `likec4`, `mermaid`, `plantuml`, `editor`\* | UI foundation (\*`editor` may also import `mermaid`/`plantuml`) |
| 3 · Domain                 | `@repo/domain`                                                                  | adapters only                                                   |
| 2 · Infra services         | `@repo/auth` → `@repo/notifications` → `@repo/mail`                             | adapters + infra below                                          |
| 1 · Pure adapters          | `@repo/db`, `@repo/mail`, `@repo/storage`, `@repo/yookassa`                     | nothing `@repo/*` (db types ok)                                 |
| 0 · Tooling                | `@repo/eslint-config`, `@repo/typescript-config`                                | devDependency anywhere                                          |

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

## Notes

- **Where business logic lives.** Write/orchestration logic belongs in `@repo/domain`
  (it throws `DomainError`). Presentation maps it: tRPC procedures wrap calls in
  `mapDomain(() => …)`; raw Next route handlers catch `DomainError` and translate
  `err.httpStatus`; `apps/engines` maps via its `mapDomainError`. `@repo/trpc`'s
  `helpers/plan.ts` and `helpers/workspace.ts` are thin **adapters** over the domain.
- **Client bundles.** `@repo/domain`'s root barrel re-exports server-side modules
  (it imports `@repo/db` → `pg`). A **client** component (`'use client'`) must import a
  pure leaf directly (e.g. `@repo/domain/kanban/colors.ts`), never the `@repo/domain`
  root, or `pg`/Node built-ins get pulled into the browser bundle.
- **Reads.** Pragmatic scope: presentation may read directly from pure adapters
  (`@repo/db`, `@repo/storage`) and infra (`@repo/auth`, `@repo/notifications`).
  Only business writes/orchestration must go through `@repo/domain`.

## Enforcement scope

`pnpm check-architecture` crawls `packages`, `apps/engines`, and `apps/yjs`.
`apps/web` is intentionally not crawled (no tier rule constrains a top-tier app's
outbound imports, and a _package_ importing an app is still caught from the package
side; crawling web's full graph under `tsPreCompilationDeps` exhausts the heap).
`apps/agents` is Python and outside the TypeScript dependency graph.

## Known tech-debt (not violations)

- `apps/web → @repo/trpc/services/billing` (payment-webhook handlers) awaits a dedicated
  billing-domain migration. It is a within-tier edge (presentation → transport), so it is
  not a tier violation.
