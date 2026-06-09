# Notion-parity Phase 4C — Database page-level access rules + structure permissions

Status: approved design (2026-06-09). Roadmap source: `cl4.md` prompt 4.6. Last of
three cl4 sub-phases (4A views/layouts `5dc34c52`, 4B properties/formulas/relations
`2b2a7219` both merged). This is the security layer that gates the data built in 4A/4B.

## Goal

Add Notion-like database **page-level (row-level) access rules** (based on person /
created-by property values) and **structure permissions** (content editing vs structure
editing + a structure lock), enforced **server-side** across every surface a database row
is read or mutated. Property visibility stays a cosmetic per-view display setting, never a
security boundary. No property-level ACL (explicitly out of scope per Notion guardrails).

## Key decisions

- **Single authority**: a `DatabaseRowAccessResolver` in `@repo/domain` computes the
  effective access level per (viewer, row). ALL read/write paths funnel through it
  (mirrors the cl2 `PublicShareAccessResolver`).
- **Rules are opt-in and restrictive when present**: a source with NO enabled rules
  behaves exactly as today (workspace members see all rows per their role). Once a source
  has ≥1 enabled rule, a non-broad-access viewer sees a row ONLY if they match a rule (or
  have direct broad access). **Broadest-access-wins**.
- **Rule grants a level** to whoever's userId appears in the chosen person/created-by
  cell: `CAN_VIEW` (read), `CAN_COMMENT` (read+comment), `CAN_EDIT_CONTENT` (read +
  edit cells/title), `CAN_EDIT`/`FULL_ACCESS` (also structure — rare for a rule). The
  resolver returns the max level across all matching rules + direct access.
- **Structure permissions** map to workspace roles + a lock flag: content edits (rows,
  cells, row title) need `CAN_EDIT_CONTENT`; structure edits (properties, views, filters,
  sorts, layout, relation/rollup config) need `CAN_EDIT`+ (OWNER/ADMIN-equivalent or the
  source page creator). `DatabaseSource.structureLocked` blocks structure edits for
  everyone below OWNER/ADMIN while still allowing permitted content edits.

## Data model

One migration.

```prisma
enum DatabaseAccessLevel {
  CAN_VIEW
  CAN_COMMENT
  CAN_EDIT_CONTENT
  CAN_EDIT
  FULL_ACCESS
}

model DatabasePageAccessRule {
  id          String              @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  sourceId    String              @map("source_id") @db.Uuid
  propertyId  String              @map("property_id") @db.Uuid   // a PERSON or CREATED_BY property on this source
  accessLevel DatabaseAccessLevel @map("access_level")
  enabled     Boolean             @default(true)
  createdAt   DateTime            @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime            @updatedAt @map("updated_at") @db.Timestamptz(6)

  source   DatabaseSource   @relation(fields: [sourceId], references: [id], onDelete: Cascade)
  property DatabaseProperty @relation(fields: [propertyId], references: [id], onDelete: Cascade)

  @@index([sourceId])
  @@map("database_page_access_rules")
}

// DatabaseSource gains:
//   structureLocked Boolean @default(false) @map("structure_locked")
//   accessRules DatabasePageAccessRule[]
// DatabaseProperty gains: accessRules DatabasePageAccessRule[]
```

Only PERSON and CREATED_BY (and the system created-by) properties are valid rule targets;
the domain validates this on rule create.

## Domain — DatabaseRowAccessResolver (`@repo/domain/database`)

A new service/helper (pure given its inputs; the service fetches inputs). Core API:

```ts
type RowAccessContext = {
  viewerId: string | null          // null = anonymous/public
  workspaceRole: 'OWNER'|'ADMIN'|'EDITOR'|'COMMENTER'|'VIEWER'|'GUEST'|null
  isSourcePageCreator: boolean
  pageShareLevel: DatabaseAccessLevel | null  // explicit PageShare grant on the item page, mapped
}
type RowAccessInput = {
  rowCreatedById: string | null
  cellsByProperty: Map<propertyId, unknown>   // for PERSON-property rule matching
}

// max level across direct access + every matching enabled rule; null = no access.
resolveRowAccess(ctx, rules, row): DatabaseAccessLevel | null
```

Decision order (broadest-access-wins → returns the MAX level):
1. Direct broad access: workspace OWNER/ADMIN → `FULL_ACCESS`; source page creator →
   `FULL_ACCESS`; an explicit PageShare grant on the item page → its mapped level
   (`PageShareRole` → `DatabaseAccessLevel`: READER→`CAN_VIEW`, COMMENTER→`CAN_COMMENT`,
   EDITOR→`CAN_EDIT_CONTENT`).
2. If `rules` is empty (no enabled rules on the source): a workspace member gets a level
   derived from their role (EDITOR→`CAN_EDIT_CONTENT`, COMMENTER→`CAN_COMMENT`, VIEWER/
   GUEST→`CAN_VIEW`); a non-member/anonymous → `null`. (Preserves today's behavior.)
3. If rules exist: start from the direct-access level (may be null), then for each enabled
   rule whose target cell contains `viewerId` (PERSON cell value === viewerId, or a
   CREATED_BY rule where `rowCreatedById === viewerId`), raise the level to the rule's
   `accessLevel`. Return the max (or null if nothing matched and no direct access).

Helpers:
- `resolveRowAccessForRows(ctx, rules, rows): Map<rowId, level|null>` — batch (no N+1).
- `buildRowAccessWhere(ctx, rules): Prisma.DatabaseRowWhereInput | null` — a DB-level
  predicate when expressible (broad access → null meaning "all"; else OR of
  `{ page: { createdById: viewerId } }` for CREATED_BY rules + `{ cells: { some:
  { propertyId, value: { equals: viewerId } } } }` for PERSON rules). Used to push
  filtering into `listRows` instead of fetch-all-then-filter. When a fully-precise DB
  predicate isn't expressible, the service post-filters with `resolveRowAccessForRows`.

`canEditRow(level)` = level ≥ CAN_EDIT_CONTENT. `canViewRow(level)` = level ≥ CAN_VIEW.

## Structure permissions

`assertCanEditStructure(actor, source)` (domain): allowed if the actor is workspace
OWNER/ADMIN OR the source page creator AND `!structureLocked`; if `structureLocked`, only
OWNER/ADMIN. Guards: createProperty/updateProperty/deleteProperty/reorderProperties,
createView/updateView/deleteView/duplicateView (filters/sorts/settings/layout are view
structure), and relation/rollup settings. Content ops (createRow/updateRow/deleteRow/
updateCellValue/setRelationLinks values/reorderRows) keep requiring `CAN_EDIT_CONTENT`
(now via the row resolver for per-row gating).

## Enforcement (every surface, server-side)

- **listRows / listGroupedRows / getByPage rows / item getById**: apply
  `buildRowAccessWhere` (DB filter) + `resolveRowAccessForRows` post-filter so a viewer
  only sees rows they have ≥CAN_VIEW on.
- **updateCellValue / updateRow / deleteRow**: resolve the row's level; require
  ≥CAN_EDIT_CONTENT (else FORBIDDEN). **createRow**: requires source-level
  CAN_EDIT_CONTENT for the actor (a workspace EDITOR+, or — when rules exist — a user who
  a CREATED_BY/PERSON rule would grant CAN_EDIT_CONTENT+; the simplest correct gate: allow
  create if the actor has any non-null source-level edit capability per their role, since
  the new row's CREATED_BY = the actor, so they will immediately match a CREATED_BY rule).
  A row just created by the actor is always editable by them (they are its creator).
- **Relation/rollup traversal**: when resolving RELATION chips + ROLLUP aggregations,
  resolve each target row through the TARGET source's rules + the viewer; exclude
  inaccessible targets from chips and from aggregation inputs (no leak via rollups).
- **Search/export**: database-row export funnels rows through the resolver; database-local
  search (listRows query) already does. Item pages remain hidden from global page search
  (Phase 3).
- **Embedded/linked views**: embedded database blocks resolve with the authed viewer's
  context (same rules). **Public share / anonymous**: `viewerId = null` matches no
  person/created-by rule and is not a workspace member → a database WITH enabled rules
  shows no rule-restricted rows publicly (effectively forbidden/empty in public share);
  documented. A database with no rules keeps its current public behavior.
- All structure-mutating procedures call `assertCanEditStructure`.

## tRPC

`database` router gains: `listAccessRules({pageId})`, `createAccessRule({pageId,
propertyId, accessLevel})`, `updateAccessRule`/`setAccessRuleEnabled`, `deleteAccessRule`,
`setStructureLocked({pageId, locked})`, and a `getMyAccess({pageId})` returning the
viewer's source-level capabilities (canEditContent/canEditStructure/structureLocked) for
UI affordances. All structure + rule procedures `assertCanEditStructure`. The view-model
(getByPage) includes `myAccess` so the UI can disable controls. Reads stay
`assertPageAccess` + the row resolver; the per-row level is computed server-side.

## UI

- **Page-level access section** (in the property/database settings or a Share-style
  panel): list rules; "add rule" → pick a PERSON/CREATED_BY property + an access level →
  createAccessRule; toggle enabled; delete. Clear copy: "Эти правила ограничивают доступ к
  строкам на сервере" — distinct from the display-only property-visibility panel.
- **Structure-lock toggle** (`DatabaseLockToggle`, OWNER/ADMIN only): calls
  `setStructureLocked`. A locked banner/icon.
- **Permission-aware affordances**: when `myAccess.canEditStructure` is false (or locked),
  the add/edit/delete-property, view-config, and rule controls are disabled with a tooltip
  ("Структура заблокирована" / "Недостаточно прав"). The cell editors disable for rows the
  viewer only has CAN_VIEW on. The property-visibility panel keeps its "display only"
  copy.

## Testing

domain (resolver-heavy, unit + real-DB):
- no rules → every member sees all rows (behavior preserved).
- with a CAN_VIEW rule on a PERSON property → only the assigned user (+ owner/admin) sees
  matching rows; unassigned rows hidden for a restricted member.
- a CREATED_BY rule → the row creator gets access.
- broadest-access-wins: owner/admin see all rows regardless of rules; a member with both a
  direct page-share and a rule gets the higher level.
- CAN_EDIT_CONTENT rule lets a VIEWER edit matched rows' cells but NOT structure.
- structureLocked blocks property/view/filter changes for a non-owner but allows content
  edits; assertCanEditStructure on every structure procedure.
- relation/rollup traversal excludes inaccessible target rows (no leak); rollup sum over
  related rows only counts accessible ones.
- anonymous/public viewer sees no rule-restricted rows.

trpc/web:
- listRows hides unassigned rows for a restricted user; export/embedded obey the rules;
  updateCellValue on an inaccessible row → FORBIDDEN; createAccessRule rejects a non-
  person/created-by property; setStructureLocked gates structure mutations.

Playwright (focused): create a database with a Person property + 2 rows assigned to
different users; add a CAN_VIEW rule; sign in as a restricted member → see only the
assigned row; lock structure → the add-property button is disabled.

## Checks (cl4C gate)

- `pnpm --filter @repo/domain test`
- `pnpm --filter @repo/trpc test`
- `pnpm --filter web lint`
- `pnpm check-types`
- `pnpm check-architecture`
- focused Playwright database-access spec
- migration validated on a fresh scratch DB (zero drift), never the shared dev DB.

## Done criteria

Sensitive database rows are controlled by server-side page-level access rules
(person/created-by based, restrictive-when-present, broadest-access-wins), enforced across
reads, mutations, search, export, relations/rollups, embedded and public surfaces;
structure permissions separate content editing from structure editing with a lock;
property visibility stays cosmetic. No property-level ACL. Kanban untouched.
