# Notion-parity Phase 4B — Rich properties, formula engine, relations/rollups

Status: approved design (2026-06-09). Roadmap source: `cl4.md` prompts 4.3 + 4.4 + 4.5.
Second of three cl4 sub-phases (4A views/layouts merged `5dc34c52`; 4C access/structure
last). Extends the Phase 3/4A database property + cell system.

## Goal

Bring the database property model to depth: the full property type set (finish
MULTI_SELECT/PERSON/FILE editors; add URL/EMAIL/PHONE, readonly created/edited
metadata, an internal page-link AnyNote extension), a safe hand-rolled formula
engine, and relations / back-relations / rollups across database sources — with a
real property-settings panel so all of this is configurable in the UI.

## Scope

IN: new property types + editors, a property-settings panel (options+colors, number
format, formula expression, relation config, rollup config), the formula engine
(compute-on-read), `DatabaseRelationLink` (+ back-relation mirror), rollup
aggregations (compute-on-read). OUT (4C): page-level access rules + structure
permissions. OUT (documented limits): filtering/sorting on FORMULA/ROLLUP columns
(computed-on-read, not stored — the filter builder hides them as filter/sort targets);
formula incremental recompute (we compute on read, always fresh).

## Data model

One migration.

### Enum additions (`DatabasePropertyType`)

`+= URL EMAIL PHONE FORMULA RELATION ROLLUP PAGE_LINK CREATED_TIME CREATED_BY
LAST_EDITED_TIME LAST_EDITED_BY`. (Existing: TEXT NUMBER STATUS SELECT MULTI_SELECT
CHECKBOX DATE PERSON FILE.)

### `DatabaseRelationLink` (new table)

```prisma
model DatabaseRelationLink {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  propertyId  String   @map("property_id") @db.Uuid   // the RELATION property on the source row
  rowId       String   @map("row_id") @db.Uuid        // the source DatabaseRow
  targetRowId String   @map("target_row_id") @db.Uuid // the linked DatabaseRow (any source, same workspace)
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  property   DatabaseProperty @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  row        DatabaseRow      @relation("RelationLinkSource", fields: [rowId], references: [id], onDelete: Cascade)
  targetRow  DatabaseRow      @relation("RelationLinkTarget", fields: [targetRowId], references: [id], onDelete: Cascade)

  @@unique([propertyId, rowId, targetRowId])
  @@index([propertyId, rowId])
  @@index([targetRowId])
  @@map("database_relation_links")
}
```

Back-relations are mirrored rows keyed on the **mirror property** id (the back-relation
property on the target source). `DatabaseRow` gets reverse relations
`relationLinks RelationLinkSource[]` and `relationLinksTo RelationLinkTarget[]`;
`DatabaseProperty` gets `relationLinks DatabaseRelationLink[]`.

### `propertySettingsSchema` extension (dto)

```ts
type NumberFormat = 'plain' | 'integer' | 'decimal' | 'percent' | 'currency_rub'
type RollupAggregation =
  | 'show_original' | 'count_all' | 'count_values' | 'count_unique' | 'count_empty'
  | 'count_not_empty' | 'sum' | 'average' | 'min' | 'max' | 'earliest' | 'latest' | 'range'

type PropertySettings = {
  options?: SelectOption[]          // SELECT/STATUS/MULTI_SELECT
  numberFormat?: NumberFormat       // NUMBER
  formula?: string                  // FORMULA — the expression source
  relation?: {                      // RELATION
    targetSourceId: string
    backRelationPropertyId?: string // the mirror property on the target source (optional)
  }
  rollup?: {                        // ROLLUP
    relationPropertyId: string      // a RELATION property on THIS source
    targetPropertyId: string        // a property on the related source (or '__title__')
    aggregation: RollupAggregation
  }
}
```

Readonly metadata (CREATED_TIME/CREATED_BY/LAST_EDITED_TIME/LAST_EDITED_BY) need no
settings; their values derive from the item `Page` (`createdAt`/`createdById`/
`updatedAt`/`updatedById`) and are never stored as cells.

## Domain — formula engine (`@repo/domain/database/formula/`, pure)

Add `date-fns` to `@repo/domain` deps (pure, framework-agnostic — passes
check-architecture's adapter-tier rule).

- `tokenizer.ts` — source → tokens (numbers, strings, idents, operators, parens,
  commas). `parser.ts` — recursive-descent → a typed AST (validated by a zod schema in
  the dto). `evaluator.ts` — tree-walk over the AST against a `Scope` (the row's
  resolved cell values keyed by property NAME + readonly metadata).
- Surface: literals (number/string/bool); `prop("Property Name")` reference;
  functions `if(cond,a,b)`, `empty(x)`, `not(x)`, `and(...)`, `or(...)`,
  `concat(...)`, `length(s)`, `contains(s,sub)`, `round(n[,d])`, `abs`, `min`, `max`,
  `sum`, `now()`, `dateAdd(date,n,unit)`, `dateSubtract`, `dateBetween(a,b,unit)`,
  `formatDate(date,fmt)`, `year/month/day(date)`. Operators `+ - * / == != > >= < <=
  && || !` with precedence. Unknown function/identifier → a typed FormulaError.
- **Sandboxed by construction**: no `eval`/`Function`/global access; the evaluator only
  reads from `Scope` and the function whitelist. Date functions use `date-fns`.
- **Cycle detection**: evaluating a FORMULA that (transitively) references itself →
  FormulaError 'circular reference' (track the visiting set in the row evaluator).
- Errors are returned as a cell **error state** (`{ __error: string }`), never thrown
  to the API — the UI renders an error chip.
- Heavily unit-tested (tokenize, parse, eval per function, operator precedence, error
  cases, cycle detection, "can't reach globals/process/Function").

## Domain — compute-on-read view-model + relations/rollups

The row view-model builder (`mapRow` / a new `resolveComputedCells` step in
`listRows`/`getByPage`-row-fetch) resolves, per row, in dependency order:
1. stored cells (as today),
2. readonly metadata from the item Page,
3. RELATION cells → the target row chips (title/icon) from `DatabaseRelationLink`,
   filtered to rows the viewer can access (same workspace; archived/deleted excluded),
4. ROLLUP cells → walk the relation property's links → collect the target rows'
   `targetPropertyId` values → apply the aggregation,
5. FORMULA cells → evaluate the expression over the row's resolved values (with cycle
   detection across formula/rollup deps).

Relation writes: a `setRelationLinks(actor, {pageId, rowId, propertyId, targetRowIds})`
service method replaces the link set transactionally; if the relation property has a
`backRelationPropertyId`, the mirror links on the target rows are synced. Cross-source
targets must be in the same workspace (validated). RELATION filters reuse the
MULTI_SELECT post-filter path (`is_any_of`/`is_none_of` over linked target ids).

`validateCellValue` gains real cases:
- **PERSON** — the value must be a workspace-member userId. The domain validates it via
  a repository membership lookup (`isWorkspaceMember(userId, workspaceId)`; the service
  resolves the source → workspaceId). Stores the userId string.
- **URL/EMAIL/PHONE** — format validation in the domain (a regex/zod check); stores the
  normalized string.
- **FILE** — the domain validates it's a UUID; the **tRPC layer** (which has the
  session/workspace context) validates the `File` exists and belongs to the workspace
  before calling the domain. Stores the fileId.
- **PAGE_LINK** — the domain validates a UUID; the **tRPC layer** validates the page
  exists in the workspace and is visible. Stores the pageId.
- **FORMULA/ROLLUP/CREATED_*/LAST_EDITED_*** — read-only; `updateCellValue` rejects any
  write to a cell whose property is one of these types.

## tRPC

`database` router gains: `setRelationLinks`, `listLinkableRows({pageId, propertyId,
query?})` (rows of the relation's target source for the picker), and the row view-model
(listRows/listGroupedRows/item) now includes resolved computed cells (relation chips,
rollup values, formula values, metadata). `createProperty`/`updateProperty` accept the
extended settings (relation/rollup/formula/numberFormat) with validation (e.g. a ROLLUP
must reference an existing RELATION property + a valid target property; a RELATION's
targetSourceId must be a database source in the same workspace). Reads `assertPageAccess`,
writes `assertPageEditAccess`. PERSON/FILE/PAGE_LINK existence checks happen in the tRPC
layer (it has the workspace/session context) before the domain call.

## UI

New cell editors (`apps/web/src/components/database/cell-editors/`, wired in
`cell-dispatch.tsx`):
- `multi-select-cell` (option chips, add/remove), `person-cell`
  (`workspace.listMembers` picker, stores userId, avatar+name chip), `file-cell`
  (upload via `/api/files/upload?kind=attachment` → store fileId; render link /
  image thumbnail; via `file.getById` for metadata), `url-cell`/`email-cell`/
  `phone-cell` (validated text + a clickable open affordance), `page-link-cell`
  (page picker over `page.listByWorkspace`, renders an icon+title page chip linking to
  `/pages/[id]`), `relation-cell` (picker via `listLinkableRows` → `setRelationLinks`,
  renders target-row title chips opening the target item modal), and **readonly
  renderers** for `formula`/`rollup`/`created-time`/`created-by`/`last-edited-time`/
  `last-edited-by` (+ a formula/rollup error chip).

Property settings panel (`apps/web/src/components/database/property-config/`): a
popover/dialog opened from `property-header-cell` to: change property type; edit
SELECT/STATUS/MULTI_SELECT **options** (label, color picker, add/remove/reorder); set
NUMBER **format**; write the FORMULA **expression** (a textarea with a function
reference + live validation/error via a `validateFormula` trpc/util); configure
RELATION (target database source picker + optional create-back-relation); configure
ROLLUP (pick a RELATION property + a target property + an aggregation). Writes via
`updateProperty`.

`database-toolbar.tsx` `CREATABLE_PROPERTY_TYPES` += the new creatable types
(MULTI_SELECT/PERSON/FILE now have editors; URL/EMAIL/PHONE/FORMULA/RELATION/ROLLUP/
PAGE_LINK; readonly metadata created via a "more" submenu). Number format + colors are
edited via the settings panel, not at create time.

## Testing

domain (unit-heavy):
- formula tokenizer/parser/evaluator: each function, operator precedence, string/number/
  bool/date coercion, error cases, cycle detection, sandbox (no globals/Function/process
  reachable).
- compute-on-read: a FORMULA over other cells; a ROLLUP sum/count/min/max over related
  rows; readonly metadata derives from the Page; a circular formula → error chip not a
  crash.
- relations: setRelationLinks replaces links; back-relation mirror synced; cross-
  workspace target rejected; deleting a row cascades its links; a rollup only counts
  accessible related rows.
- validateCellValue new cases: PERSON non-member rejected; URL/EMAIL/PHONE format;
  writing to a FORMULA/ROLLUP/readonly cell rejected.

trpc/web:
- createProperty FORMULA/RELATION/ROLLUP with valid + invalid settings; listLinkableRows;
  setRelationLinks; the row view-model includes computed cells.
- web build green (client-bundle: dto runtime not imported into client — type-only).

Playwright (focused): add a RELATION property + link a row; add a ROLLUP showing a count;
add a FORMULA showing a computed value; add a PERSON cell picking a member; the property
settings panel edits select options + colors.

## Checks (cl4B gate)

- `pnpm --filter @repo/domain test` (formula + service)
- `pnpm --filter @repo/trpc test`
- `pnpm --filter web lint`
- `pnpm check-types`
- `pnpm check-architecture` (date-fns dep added to domain stays adapter-tier clean)
- focused Playwright database-rich spec
- migration validated on a fresh scratch DB (zero drift), never the shared dev DB.

## Done criteria

A database supports the full property set with real editors and a settings panel;
formulas compute live over other cells (sandboxed, cycle-safe); relations link rows
across sources with optional back-relations; rollups aggregate related-row values; all
computed-on-read so values are never stale; computed columns are display-only (not yet
filterable, documented). Kanban untouched.
