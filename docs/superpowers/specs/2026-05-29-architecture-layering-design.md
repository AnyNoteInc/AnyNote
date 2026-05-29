# Architecture Layering — Design Spec

- **Date:** 2026-05-29
- **Status:** Approved (design), pending implementation plan
- **Scope decision:** Pragmatic (see D1)

## 1. Context & problem

The monorepo has organically grown into four informal groups — presentation apps,
a domain package, I/O packages, and UI packages — but the boundaries are neither
documented nor enforced. An audit of declared (`package.json`) **and** actual
(`@repo/*` imports in `src`) dependencies found:

- The single "I/O" bucket actually contains three different kinds of package
  (pure adapters, composing infra services, and the tRPC transport).
- `@repo/trpc` is classified as I/O but imports `@repo/domain` and `@repo/ui` and
  **is** the API transport — logically it is a presentation/transport package.
- Business logic is parked inside `@repo/trpc` (`helpers/plan.ts`,
  `helpers/workspace.ts`, `services/billing.ts`). Because there was no shared home,
  other presentation packages reach into trpc internals to reuse it:
  - `apps/engines` → `@repo/trpc/helpers/plan` (`syncWorkspaceLimits`)
  - `apps/web` → `@repo/trpc/helpers/workspace` (`assertWorkspaceMembership`)
  - `apps/web` → `@repo/trpc/services/billing.ts` (payment webhook handlers)
- A kanban color vocabulary lives in the UI kit (`@repo/ui/lib/kanban-colors`) but
  is consumed by the transport layer for validation (`trpc → ui`).
- Phantom dependencies: `@repo/mail` declared by `web`/`engines`/`auth` but never
  imported (mail is used only by `@repo/notifications`); `@repo/db` declared by
  `@repo/mail` but never imported.

**Key finding:** after the two taxonomy refinements below (D2, D3), there are **no
illegal "upward" cross-tier edges** in the graph. Adapters are pure, domain imports
only `db`, UI imports only UI, and the infra chain `auth → notifications → mail → db`
is an acyclic DAG. The real debt is (a) the model is undocumented and unenforced,
and (b) domain logic is misplaced in the transport package.

## 2. Goals / non-goals

**Goals**
- Define and **document** a layered tier model.
- **Enforce** it automatically so violations cannot regress (`pnpm gates`).
- Relocate misplaced domain logic out of `@repo/trpc` into `@repo/domain` so
  presentation packages stop importing each other / trpc internals.
- Hygiene: remove phantom deps; fix tooling-config dependency classification.

**Non-goals (out of scope — see §6)**
- Routing every read through the domain (reads stay direct — pragmatic, D1).
- Migrating the payment-webhook billing logic (`services/billing.ts`) into the
  domain — deferred to a dedicated billing-domain cycle (D6).
- Inverting the editor's diagram embeds (editor stays a composite UI package, D3).
- `apps/agents` (Python/FastAPI) — outside the TypeScript dependency graph.

## 3. Target tier model

Imports may only point **downward**. Six tiers:

```
TIER 5 · Presentation / transport
    apps/web   apps/engines   apps/yjs   @repo/trpc
    (apps/agents — Python, out of TS graph)
    may import: domain, infra, adapters, UI (foundation + feature), transport

TIER 4 · UI
    4a foundation:  @repo/ui   @repo/diagram-board
    4b feature:     drawio, excalidraw, genogram, mermaid, plantuml, likec4, editor*
    feature → foundation only.   * editor (composite): may also import mermaid, plantuml

TIER 3 · Domain
    @repo/domain
    may import: adapters only (currently db)

TIER 2 · Infra services (acyclic DAG)
    @repo/auth → @repo/notifications → @repo/mail
    may import: adapters, and infra strictly below. No domain / UI / presentation.

TIER 1 · Pure adapters
    @repo/db   @repo/mail   @repo/storage   @repo/yookassa
    import nothing from @repo/* (db types are allowed)

TIER 0 · Tooling (devDependency, any package)
    @repo/eslint-config   @repo/typescript-config
```

### Direction rules (what enforcement checks)

| From tier | May import |
|---|---|
| Adapters (db, mail, storage, yookassa) | nothing `@repo/*` except `@repo/db` (types) |
| Infra (notifications, auth) | adapters + infra strictly below; **no** domain/UI/presentation |
| Domain | adapters only |
| UI foundation (ui, diagram-board) | nothing `@repo/*` |
| UI feature | UI foundation only; **editor** additionally may import mermaid, plantuml |
| Presentation/transport (web, engines, yjs, trpc) | everything below |

Additional targeted rules:
- No package may import a presentation **app** (`apps/*`).
- `apps/engines` must **not** import `@repo/trpc` (business logic goes via `@repo/domain`).
- No circular dependencies anywhere.

## 4. Decisions

- **D1 — Pragmatic scope.** Fix structure, relocate misplaced logic, and add
  enforcement. Do **not** force reads through the domain; presentation may use pure
  adapters (`db`, `storage`, `yookassa`) and infra (`auth`, `notifications`)
  directly. Business **writes/orchestration** already go through `@repo/domain`.
- **D2 — Two infra sub-tiers.** Split "I/O" into pure adapters
  (`db`, `mail`, `storage`, `yookassa`) and infra services (`notifications`, `auth`).
  Infra composes adapters acyclically and stays where it is. Rationale: keeps the
  domain NodeNext-clean (no mail/web-push/cron machinery pulled into it).
- **D3 — UI foundation + editor exception.** Foundation tier = `{ui, diagram-board}`;
  feature-UI may depend on the foundation. `editor` is a composite feature package
  allowed to import `mermaid`/`plantuml` (documented exception). No code rewrite.
- **D4 — `@repo/trpc` is presentation/transport**, not I/O. No move; it keeps living
  in `packages/` but is classified in TIER 5.
- **D5 — Enforce with dependency-cruiser.** One declarative config at the repo root
  encodes the direction rules, runs as `pnpm check-architecture`, and is added to
  `pnpm gates` (so it also runs on the Husky pre-commit gate). Chosen over
  `eslint-plugin-boundaries` for a single source of truth and a graph artifact.
- **D6 — Defer `services/billing.ts`.** The payment-webhook handlers are sensitive
  and coupled to `@repo/yookassa` types; migrating them belongs in a dedicated
  billing-domain cycle. `web → @repo/trpc/services/billing` is a within-tier edge
  (presentation→transport), so it is **not** a tier violation — it is recorded as
  tech-debt, not blocked by enforcement.

## 5. Changes

### A. Codification + enforcement

1. **This spec** is the architecture record. Add a short "Architecture layers"
   section to `CLAUDE.md` (and/or `AGENTS.md`) pointing to it, plus a
   `docs/architecture.md` summary with the tier diagram.
2. Add root devDependency **`dependency-cruiser`**.
3. Add **`.dependency-cruiser.cjs`** at the repo root encoding §3 as `forbidden`
   rules. Sketch:
   - `adapters-are-pure`: from `packages/(mail|storage|yookassa)/` to any
     `@repo/*` except `@repo/db` → error.
   - `infra-only-adapters`: from `packages/(notifications|auth)/` to any package
     that is not an adapter or infra → error.
   - `domain-only-adapters`: from `packages/domain/` to any `@repo/*` that is not
     an adapter → error.
   - `ui-foundation-pure`: from `packages/(ui|diagram-board)/` to any `@repo/*` → error.
   - `feature-ui-foundation-only`: from feature-UI packages to any `@repo/*` that is
     not `ui`/`diagram-board`, with an explicit allowance for `editor → (mermaid|plantuml)`.
   - `no-import-apps`: to `apps/*` from anywhere → error.
   - `engines-no-trpc`: from `apps/engines/` to `@repo/trpc` → error.
   - `no-circular`: built-in circular rule → error.
   - Allow `import type` where adapters/infra reference `@repo/db` Prisma types.
4. Add scripts to root `package.json`:
   - `"check-architecture": "depcruise apps packages --config .dependency-cruiser.cjs"`
   - `"gates": "pnpm check-types && pnpm lint && pnpm check-architecture && pnpm build && pnpm test"`
5. Recommended sequencing: land the config in **report-only** mode first, complete §B,
   then flip the rules to **error** and wire into `gates`.

### B. Relocate domain logic out of `@repo/trpc` → `@repo/domain`

All moved functions throw `DomainError` (via `notFound/forbidden/badRequest/conflict`
from `@repo/domain`) instead of `TRPCError`. Callers map it:
- tRPC procedures wrap calls in `mapDomain(() => …)` (`packages/trpc/src/helpers/map-domain`).
- `apps/engines` maps via its `mapDomainError` (currently in
  `apps/engines/src/apps/mcp/services/kanban-gateway.service.ts`; extract to a shared
  util if needed by the billing cron).
- Raw `apps/web` API routes catch `DomainError` and translate `err.httpStatus`.

**B0 — Wire `@repo/domain` into `apps/web`** (prerequisite for B2/B3)
- `apps/web` does not currently depend on `@repo/domain`; it reaches the domain only
  transitively through `@repo/trpc`. B2 and B3 introduce direct `web → domain` imports.
- Add `"@repo/domain": "workspace:*"` to `apps/web/package.json`.
- Add `'@repo/domain'` to `transpilePackages` in `apps/web/next.config.js`:
  `@repo/domain`'s `exports` map points at TS source (`./src/*`), so Next must
  transpile it (per the repo's transpilePackages rule — otherwise Next tries to load
  a non-existent compiled entry and the build/dev fails).
- `apps/engines` already consumes `@repo/domain` source under NodeNext; no wiring change.

**B1 — `helpers/plan.ts` → `packages/domain/src/billing/`** (largest)
- Move: `getActivePlanForUser`, `getPlanDisplayName`, `getAvailableAiModels`,
  `getAvailableEmbeddingModels`, `getWorkspaceFeatures`, `requireWritableWorkspace`,
  `resolveActivePlanOrPersonal`, `syncWorkspaceLimits`. (Depends only on `@repo/db` — safe.)
- Replace `TRPCError` throws with `DomainError` helpers.
- Export from `packages/domain/src/index.ts` (`export * from './billing/index.ts'`).
- Update **9** trpc importers: `index.ts`, `routers/ai-provider.ts`, `routers/page.ts`,
  `routers/workspace.ts`, `routers/mcp-server.ts`, `routers/ai-settings.ts`,
  `routers/subscription.ts`, `services/page-search.ts`, `services/billing.ts` — change
  import path to `@repo/domain`; ensure every call site that can throw is inside a
  `mapDomain(() => …)` wrapper (audit each — some currently call helpers directly).
- Update `apps/engines` billing renewal
  (`apps/engines/src/apps/billing/services/subscription-renewal.service.ts`): import
  `syncWorkspaceLimits` from `@repo/domain`; handle `DomainError`. This **removes the
  `engines → trpc` edge.**
- Delete `packages/trpc/src/helpers/plan.ts`.

**B2 — `helpers/workspace.ts` → `packages/domain/src/workspace/`**
- Move `assertWorkspaceMembership`, `assertWorkspaceMember` (depend only on `@repo/db`);
  `TRPCError` → `DomainError` (`forbidden`/`notFound`).
- Export from `packages/domain/src/index.ts`.
- Update `packages/trpc/src/routers/search.ts` (wrap in `mapDomain`).
- Update `apps/web/src/app/api/workspaces/[workspaceId]/pages/[pageId]/export/[format]/route.ts`
  to import from `@repo/domain` and translate `DomainError` → HTTP response. This
  **removes the `web → @repo/trpc/helpers/workspace` edge.**
- Delete `packages/trpc/src/helpers/workspace.ts`.

**B3 — `@repo/ui/lib/kanban-colors` → `packages/domain/src/kanban/colors.ts`**
- Move `KANBAN_LABEL_COLORS` (array of `{name, hex}`) and `KANBAN_LABEL_COLOR_HEXES`
  (`ReadonlySet<string>`) into the domain kanban module; export via domain index.
- Update `packages/trpc/src/routers/kanban/label.ts` → import `KANBAN_LABEL_COLOR_HEXES`
  from `@repo/domain`. This **removes the `trpc → ui` edge.**
- Update the 3 web consumers (`components/kanban/task/manage-list-popover.tsx`,
  `components/kanban/settings/kanban-settings-dialog.tsx`,
  `components/kanban/task/task-form.tsx`) → import `KANBAN_LABEL_COLORS` from `@repo/domain`.
- Remove `packages/ui/src/lib/kanban-colors.ts` and its barrel export.

### C. Hygiene

1. Remove phantom deps from `package.json`:
   - `apps/web`, `apps/engines`, `packages/auth`: drop `@repo/mail`.
   - `packages/mail`: drop `@repo/db`.
2. Move tooling configs from `dependencies` → `devDependencies`:
   `storage` (`eslint-config`, `typescript-config`), `trpc` (`eslint-config`,
   `typescript-config`), `db` (`typescript-config`), `yookassa` (`typescript-config`),
   `domain` (`typescript-config`). (Lowest priority; skip any that perturbs the
   NodeNext engines build.)

### Post-change edge check (every edge legal under §3)

- `web → trpc` (API client), `web → domain` (new: kanban palette, workspace asserts),
  `web → db/storage/yookassa/auth/notifications`, `web → UI*` ✓
- `engines → domain/db/storage/yookassa/notifications` (no trpc) ✓
- `yjs → db` ✓
- `trpc → domain/db/auth/notifications/yookassa` (no ui) ✓
- `domain → db` ✓
- `auth → db/notifications`, `notifications → db/mail` (infra DAG) ✓
- adapters → ∅ ✓; UI foundation → ∅; feature-UI → foundation; `editor → mermaid/plantuml` ✓

## 6. Out of scope (explicit)

- Direct reads in presentation (`web/engines/yjs → db`, `storage`) — kept (D1).
- `services/billing.ts` payment-webhook logic — deferred to a future billing-domain
  cycle (D6); `web → trpc/services/billing` recorded as tech-debt.
- editor embed inversion; merging `diagram-board` into `ui`.
- `apps/agents` (Python).

## 7. Verification

- `pnpm check-architecture` green; `pnpm gates` green
  (`check-types` + `lint` + `check-architecture` + `build` + `test`).
- Behavior-preserving: moved functions issue the same DB queries; only the **error
  type** (DomainError) and **module location** change. No schema or query changes.
- Per repo guidance (RSC ↔ route boundary), spot-run affected request paths after
  wiring: the page-export API route (B2), `subscription`/`workspace` tRPC procedures
  (B1), and the engines billing-renewal cron (B1).

## 8. Risks & mitigations

- **Unmapped `DomainError` at a trpc call site** → client gets 500 instead of the
  right code. Mitigation: audit all 9 plan importers + search router; wrap every
  throwing call in `mapDomain`. Covered by existing trpc tests + manual spot-run.
- **web export route / engines cron** must explicitly handle `DomainError`
  (httpStatus translation / cron error handling) — they are not tRPC procedures.
- **dependency-cruiser false positives** on `import type` of Prisma types from
  adapters/infra. Mitigation: allow `@repo/db` as a universally-importable base and
  permit type-only edges in the config.
- **Tooling-dep reclassification (C2)** could perturb the NodeNext engines build of
  `@repo/domain`. Mitigation: lowest priority; verify `check-types` after, revert if needed.
- **Missing `transpilePackages` entry for `@repo/domain` in `apps/web`** (B0) → Next
  fails to load the domain's TS-source `exports` at build/dev time. Mitigation: B0 is a
  prerequisite; after wiring, `pnpm --filter web dev` + curl an affected route.

## 9. Suggested migration order (for the plan)

1. **C** (hygiene) — independent, trivial, de-risks the graph.
2. **A**, config in report-only mode — measure the baseline.
3. **B0** (wire `@repo/domain` into `apps/web`) — prerequisite for the web moves.
4. **B3** (kanban-colors) — smallest relocation; establishes the move pattern.
5. **B2** (workspace asserts).
6. **B1** (plan.ts) — largest; most `TRPCError → DomainError` call sites.
7. **A**, flip rules to error + wire into `gates`; add docs.
