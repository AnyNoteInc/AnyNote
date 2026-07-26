# Final review fix wave — DATABASE agent query tooling

## Result

All four final-review findings are fixed on
`codex/agent-database-query-tooling`:

1. RELATION residual predicates and returned RELATION/ROLLUP values now use the
   same actor-specific, soft-delete-aware target projection.
2. The public query contract rejects every known non-TITLE sort with the
   structured `DATABASE_SORT_UNSUPPORTED` capability error.
3. Cursors are UUIDs at the MCP and domain DTO boundaries, and a well-formed
   cursor must identify a live row in the requested source.
4. Every rendered agent stage is pinned to the exact period question and the
   required no-tool, fallback, filter-preservation, and critic-approval clauses.

No provider credential or configuration, product UI, Prisma schema, or
migration was changed.

## Design decisions

### Actor-visible RELATION projection

`pruneRelationLinksForActor` is the single projection authority used by:

- residual RELATION predicates in `applyResidualFilter`;
- computed RELATION and ROLLUP augmentation in `DatabaseService`;
- dashboard widget residual filtering through the shared evaluator.

The helper:

- batches raw links for all relevant properties and source rows;
- excludes missing and soft-deleted target rows through
  `findRowsAccessMetaByIds`;
- resolves each surviving target against its own source page, item-page share,
  workspace role, enabled access rules, and row cells;
- mutates the link maps to contain only actor-visible live targets;
- returns the same surviving target-id set used to fetch safe relation chips and
  rollup inputs.

The access lookups are bounded by the query page, target sources, and distinct
workspaces. There is no per-target-row query. Unit tests assert one batched call
for links, target metadata, source metadata, rules, creator pages, item-page
shares, and the single distinct workspace role in the fixture.

This also removes the previous target-source context cache, which could reuse
the first target row's item-page share for another target in the same source.

### Honest sort capability

The domain's general database sort DTO remains unchanged except for cursor
validation. At the agent-facing compiler boundary, a resolved sort is accepted
only when its field id is `__title__`. Known cell-property sorts fail before
the domain query with:

```json
{
  "code": "DATABASE_SORT_UNSUPPORTED",
  "message": "DATABASE_SORT_UNSUPPORTED: only the TITLE field can be sorted",
  "supportedPropertyIds": ["__title__"]
}
```

The MCP tool description states the same capability, so the advertised schema,
compiler, service behavior, and model-facing documentation agree.

### Cursor validation

- MCP input: `z.string().uuid()`.
- Domain input: `z.string().uuid()`.
- Direct `DatabaseReadService` calls also reject malformed cursors safely before
  calling the domain.
- `DatabaseService.queryRows` calls `isRowCursorInSource` before any row fetch.
  The repository query requires the cursor row id, requested source id, and
  `deletedAt: null`.
- Stale and cross-source cursors return the same `DATABASE_CURSOR_INVALID` code,
  HTTP 422, and no row/source identifiers in the response.

### Prompt contract

The shared Jinja fragment now pins:

- the exact Russian question:
  `За какой период посчитать? Можно ответить «за всё время».`;
- no `queryDatabaseRecords` call while asking it;
- all-time, refusal, and repeated no-date fallback behavior;
- preservation of every non-date filter;
- critic approval of the exact period question as a valid intermediate answer.

The renderer test asserts every distinctive clause in planner, executor, and
critic output.

## TDD evidence

### RED

Domain:

```bash
set -a
source /Users/victor/Projects/anynote/.env
set +a
pnpm --filter @repo/domain test -- \
  test/database/services/row-post-filters.test.ts \
  test/database/services/database.service.test.ts \
  test/dashboard/widget-aggregation.test.ts
```

Result: exit 1 — 16 failed, 176 passed. The new tests exposed raw RELATION
membership before actor pruning, accepted malformed/stale/cross-source cursors,
and the dashboard consumer leak.

Engines:

```bash
set -a
source /Users/victor/Projects/anynote/.env
set +a
pnpm --filter engines test -- \
  database-filter-compiler.spec.ts \
  database-read.service.spec.ts \
  database.tools.spec.ts
```

Result: exit 1 — 6 failed, 59 passed. The agent boundary accepted a malformed
cursor and silently accepted non-TITLE sorts; the tool contract did not disclose
the limitation.

Agents:

```bash
cd apps/agents
QDRANT__HOST=http://localhost:6333 \
  uv run pytest tests/apps/agent/test_jinja_renderer.py -q
```

Result: exit 1 — 1 failed, 10 passed. The shared prompt lacked the distinctive
no-tool/fallback/filter-preservation/critic clauses. An earlier command used
`QDRANT__HOST=localhost` and failed during settings construction; that
configuration error is not counted as product RED evidence.

### Focused GREEN

The same three focused commands passed after implementation:

```text
@repo/domain: 3 files, 192 tests passed
engines:      3 suites, 65 tests passed
agents:       11 tests passed
```

Focused coverage includes:

- RELATION `is_empty`, `is_not_empty`, guessed hidden-target `is_any_of`, and
  normalized nested `NOT(OR(...))`;
- soft-deleted and row-rule-hidden targets;
- DatabaseService result/filter equivalence and the dashboard consumer;
- no-N+1 assertions;
- TITLE success and cell-sort rejection at compiler, service, and tool layers;
- malformed MCP/service cursors plus missing/cross-source domain cursors;
- all required rendered-prompt clauses in all three stages.

## Real Postgres acceptance

Final command on the formatted tree:

```bash
set -a
source /Users/victor/Projects/anynote/.env
set +a
NODE_OPTIONS=--experimental-vm-modules \
  pnpm --filter engines exec jest \
    --config jest.integration.config.ts \
    test/integration/database-query.e2e.spec.ts \
    --runInBand
```

Result:

```text
Test Suites: 1 passed, 1 total
Tests:       6 passed, 6 total
Snapshots:   0 total
Time:        3.27 s
```

The two added cases prove against real Postgres that:

- missing and cross-source UUID cursors return the same safe 422 response;
- raw links to visible, hidden, and soft-deleted target rows are projected
  consistently in returned values and all four RELATION predicate shapes.

## Final verification

```text
pnpm --filter @repo/domain test
exit 0 — 59 files, 1,299 tests passed

pnpm --filter engines test
exit 0 — 64 suites, 370 tests passed

cd apps/agents
QDRANT__HOST=http://localhost:6333 uv run pytest -m "not integration" -q
exit 0 — 207 passed, 6 deselected

pnpm --filter @repo/domain check-types
exit 0

pnpm --filter engines check-types
exit 0

pnpm --filter engines lint
exit 0

cd apps/agents
QDRANT__HOST=http://localhost:6333 uv run mypy agents
exit 0 — no issues in 80 source files

uv run ruff check agents tests
exit 0

uv run ruff format --check tests/apps/agent/test_jinja_renderer.py
exit 0

pnpm exec prettier --check <all modified TypeScript files>
exit 0 after formatting four files

git diff --check
exit 0
```

## Environment notes

- `pnpm --filter engines test-int -- database-query` is not a focused command:
  the package script forwards the selector in a way that runs every integration
  suite. The database-query suite passed in that run, while unrelated existing
  indexing, reminders, and MCP route suites failed. The exact-file Jest command
  above is the independently checkable acceptance proof.
- `docker compose up -d` from this worktree could not claim the already-running
  hard-coded `anynote-gotenberg` container. The existing main-checkout Postgres,
  MinIO, and Qdrant services were used; nothing was stopped, removed, or
  reconfigured.
- The package has no `@repo/domain` lint script. TypeScript type-checks, the
  domain test suite, Prettier, and `git diff --check` cover the changed domain
  files.
- A repository-wide `ruff format --check agents tests` reports 46 pre-existing
  files that would be reformatted. The only changed Python file passes its
  focused Ruff format check, and repository-wide Ruff lint passes.

## Changed files

### Agents prompt

- `apps/agents/agents/apps/agent/templates/_database_query_rules.j2`
- `apps/agents/tests/apps/agent/test_jinja_renderer.py`

### Engines MCP boundary

- `apps/engines/src/apps/mcp/database/database-filter-compiler.ts`
- `apps/engines/src/apps/mcp/database/database-filter-compiler.spec.ts`
- `apps/engines/src/apps/mcp/database/database-query.schema.ts`
- `apps/engines/src/apps/mcp/errors/mcp.errors.ts`
- `apps/engines/src/apps/mcp/services/database-read.service.ts`
- `apps/engines/src/apps/mcp/services/database-read.service.spec.ts`
- `apps/engines/src/apps/mcp/tools/database.tools.ts`
- `apps/engines/src/apps/mcp/tools/database.tools.spec.ts`
- `apps/engines/test/integration/database-query.e2e.spec.ts`

### Domain and dashboard

- `packages/domain/src/database/dto/database.dto.ts`
- `packages/domain/src/database/repositories/database.repository.ts`
- `packages/domain/src/database/services/database.service.ts`
- `packages/domain/src/database/services/row-post-filters.ts`
- `packages/domain/src/dashboard/services/widget-aggregation.ts`
- `packages/domain/test/database/services/database.service.test.ts`
- `packages/domain/test/database/services/row-post-filters.test.ts`
- `packages/domain/test/dashboard/widget-aggregation.test.ts`

## Self-review

- Confirmed the projection treats a missing metadata row as missing/deleted and
  therefore inaccessible.
- Confirmed every target is resolved using its own source page and item-page
  share rather than a source-level cached row context.
- Confirmed all helper inputs are batched; only workspace roles scale with the
  number of distinct workspaces, never the number of target rows.
- Confirmed residual predicate membership and returned RELATION/ROLLUP values
  call the same helper.
- Confirmed cursor and sort errors contain capability/validation metadata only,
  not source rows, filters, cursor values, or guessed target ids.
- Confirmed no unrelated file, UI, provider configuration, schema, or migration
  is present in the diff.

Remaining task-specific concerns: none. The environment notes above are
pre-existing command/baseline limitations and do not weaken the focused or
real-Postgres acceptance evidence.
