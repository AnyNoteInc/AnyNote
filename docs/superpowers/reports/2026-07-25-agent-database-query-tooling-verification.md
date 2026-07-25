# Agent database query tooling — verification

Date: 2026-07-25

Branch: `codex/agent-database-query-tooling`

Worktree: `/Users/victor/Projects/anynote/.worktrees/agent-database-query-tooling`

## Result

The real-Postgres acceptance suite is green. It proves the approved
«Доходы и расходы» fixture through `DatabaseReadService → @repo/domain →
Prisma/Postgres`: the all-time expense query ignores a persisted income-only
view, exhausts a two-page cursor, returns exactly «Аренда», «Продукты» and
«Транспорт», and totals `4_000_000` kopecks / `40_000` rubles.

The automated acceptance result is **passed**. The optional two-turn live-agent
result is **blocked** and is not claimed as verified; the concrete provider
details are recorded below.

## Slice commits

| Commit     | Slice                                                 |
| ---------- | ----------------------------------------------------- |
| `05f4642a` | `feat(domain): add source-wide database row queries`  |
| `41cf1ee3` | `fix(domain): prune computed row filters`             |
| `ec25d642` | `feat(engines): compile typed database filters`       |
| `3ce293eb` | `fix(engines): validate database filter capabilities` |
| `f932e70e` | `feat(engines): map database schemas and records`     |
| `b6487ba0` | `fix(engines): sanitize computed database values`     |
| `97a4ea7e` | `feat(engines): expose database read tools`           |
| `e40c405c` | `feat(agents): query database pages safely`           |

## TDD evidence and integration fixture

RED was captured against the real database before the complete fixture existed.
The schema assertion received only the implicit `Название`/`TITLE` field and
failed because `Тип`/`SELECT`, `Сумма`/`MONEY`, and `Дата`/`DATE` were absent.

The completed isolated fixture creates:

- a workspace, VIEWER user/member, and DATABASE page «Доходы и расходы»;
- `Тип` (`SELECT`, options «Расход» and «Доход»), `Сумма` (`MONEY`), and
  `Дата` (`DATE`);
- a persisted view «Только доходы»;
- «Аренда» (`3_000_000` kopecks), «Продукты» (`845_050`), «Зарплата»
  (`12_000_000`), and «Транспорт» (`154_950`).

The four green cases prove:

1. exact TITLE/SELECT/MONEY/DATE schema, option IDs/names, and MONEY wire schema;
2. source-wide `Тип is_any_of [expenseOptionId]`, no date condition, `limit: 2`,
   cursor exhaustion, and the exact `4_000_000`-kopeck sum;
3. timezone-bearing half-open DATE intervals, including exclusion of
   `2026-07-10` from `[2026-07-01, 2026-07-10)`;
4. authoritative row-access exclusion from both returned records and the sum.

Every test deletes its workspace and user and verifies both are absent.

## Commands and exit codes

| Command                                                                                                                                                                                        | Exit | Evidence                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docker compose up -d` (worktree)                                                                                                                                                              |    1 | Existing healthy root stack already owned hard-coded `anynote-gotenberg`; no container was removed.                                                                                                                                        |
| `docker compose up -d` (main checkout)                                                                                                                                                         |    0 | Existing Postgres, MinIO, Qdrant, Gotenberg and PlantUML services healthy.                                                                                                                                                                 |
| `NODE_OPTIONS=--experimental-vm-modules pnpm --filter engines exec jest --config jest.integration.config.ts --runTestsByPath test/integration/database-query.e2e.spec.ts --runInBand --silent` |    0 | 1 suite, 4 tests passed.                                                                                                                                                                                                                   |
| `pnpm --filter engines test-int -- database-query`                                                                                                                                             |    1 | Script forwards the selector as arguments but Jest still runs all integration suites. The new database-query suite passed; unrelated existing indexing/reminders/MCP suites failed (5 failed suites, 2 passed; 13 failed tests, 5 passed). |
| `pnpm --filter @repo/domain test`                                                                                                                                                              |    0 | 59 files, 1,291 tests passed.                                                                                                                                                                                                              |
| `pnpm --filter engines test`                                                                                                                                                                   |    0 | 64 suites, 365 tests passed.                                                                                                                                                                                                               |
| `cd apps/agents && uv run pytest -m "not integration" -q` (first run)                                                                                                                          |    1 | 4 NLP tests failed because `ru_core_news_sm` was not installed; 203 passed, 6 deselected.                                                                                                                                                  |
| `pnpm check-types`                                                                                                                                                                             |    0 | 25/25 tasks passed.                                                                                                                                                                                                                        |
| `pnpm lint`                                                                                                                                                                                    |    0 | 41/41 tasks passed.                                                                                                                                                                                                                        |
| `pnpm build`                                                                                                                                                                                   |    0 | 25/25 tasks passed; the agents build installed the declared spaCy models.                                                                                                                                                                  |
| `cd apps/agents && uv run pytest -m "not integration" -q` (fresh rerun)                                                                                                                        |    0 | 207 passed, 6 deselected, 5 warnings.                                                                                                                                                                                                      |
| `git diff --check`                                                                                                                                                                             |    0 | No whitespace errors.                                                                                                                                                                                                                      |

## Live two-turn agent check

Status: **blocked; no live dialogue result is claimed**.

The harness used one existing shared encrypted provider without printing,
copying, creating, or changing credentials. Engines discovered all 65 AnyNote
tools and both the provider and MCP endpoints were reachable.

Two concrete blockers prevented a completed first turn:

1. the configured shared model slug is `deepseek-chat`; the provider returned
   HTTP 400 and stated that this endpoint accepts `deepseek-v4-pro` or
   `deepseek-v4-flash`;
2. a temporary retry with the provider-declared `deepseek-v4-flash` (payload
   only; no database configuration change) produced provider HTTP 200 and MCP
   HTTP 200 calls repeatedly, but the agent remained in its graph/tool loop and
   did not complete the first SSE answer within the bounded 60-second check.

The live harness was stopped, both services were stopped, and the exact
temporary workspace/user were deleted. A follow-up count confirmed zero
remaining `database-query-live-check` workspaces and users. Because no first
answer completed, there is no valid second-turn trace or `40 000 ₽` live result.

## Approved design §§10–11 coverage

### §10 — tests

| Criterion                                                                                         | Evidence                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain source-wide query ignores persisted views                                                  | Integration all-time case plus `DatabaseService.queryRows › uses the transient source-wide filter and never loads persisted views`.                                                                 |
| Nested `and`/`or`/`not`, including RELATION/MULTI_SELECT semantics                                | `database-filter-compiler.spec.ts` three-level NOT normalization; `query-planner.test.ts` and `row-post-filters.test.ts` preserve nested boolean trees and residual RELATION/MULTI_SELECT branches. |
| Supported operators; invalid operator/value                                                       | Catalog-driven compiler tests cover every property type, incompatible operators, option IDs, MONEY, DATE, limits, and value errors.                                                                 |
| Pagination after post-filter and row access                                                       | Domain sparse continuation tests plus integration `limit: 2` cursor exhaustion and row-access exclusion.                                                                                            |
| Computed fields and MONEY precision                                                               | Computed fields are explicitly unfilterable; recursive sanitizer tests map safe computed values; MONEY uses integer kopecks in compiler, result mapper, and integration sum.                        |
| Engines schema/operators/value schemas                                                            | `database-filter-compiler.spec.ts` and `database-read.service.spec.ts` cover TITLE, options, MONEY/DATE schema, and the self-contained schema response.                                             |
| Name resolution, typed compilation and wire mapping                                               | Compiler exact ID/name/unknown/ambiguous tests and `DatabaseReadService.query` typed mapping tests.                                                                                                 |
| Binding/errors/tool registration                                                                  | `database.tools.spec.ts`, `database-read.service.spec.ts`, `page-binding.spec.ts`, and McpModule compile test.                                                                                      |
| Agents read-only registration and page binding                                                    | `test_tool_registry.py` and `test_node_tool_runner.py` prove `pages:read`, no confirmation, bound-page allow, and cross-page denial before MCP.                                                     |
| Agents schema-first, one period question, all-time without DATE, cursor continuation, MONEY units | `_database_query_rules.j2` is rendered and asserted in planner/executor/critic by `test_database_query_rules_render_in_every_agent_stage`.                                                          |
| Four-row E2E data and `40 000 ₽` result                                                           | Real-Postgres integration proves the data path and exact sum. The LLM dialogue/tool-call portion remains honestly blocked as described above.                                                       |

### §11 — acceptance

|   # | Criterion                                                         | Status and proof                                                                                                                        |
| --: | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | DATABASE is not read as empty markdown                            | Passed: the engines service reads source schema/rows; schema and four real records are asserted.                                        |
|   2 | Field types/operators are known before filtering                  | Passed: exact schema test, compiler catalog tests, and agents schema-first prompt test.                                                 |
|   3 | Nested filters are validated/executed without exposing Prisma DSL | Passed: recursive public schema and compiler/domain boolean tests; public MCP schema test proves internal `not_*` operators are absent. |
|   4 | Missing date asks once; all-time unblocks without DATE            | Automated policy passed; live behavior not completed because of the provider/agent-loop blocker.                                        |
|   5 | No date condition returns all accessible source rows              | Passed by the all-time integration case and persisted-view regression.                                                                  |
|   6 | Page and row-level access remain enforced                         | Passed by engines/domain binding tests and the real row-access integration case.                                                        |
|   7 | MONEY scale is exact                                              | Passed at compiler (`kopecks`), mapper (`kopecks`/`rubles`), and exact `4_000_000`-kopeck integration sum.                              |
|   8 | Verification scenario returns `40 000 ₽`                          | Passed for the deterministic real-DB acceptance path; live conversational rendering remains blocked and is not presented as passed.     |

## Scope and worktree state

No Prisma schema/migration was added or changed. No product UI file was added or
changed. The acceptance commit is limited to:

- `apps/engines/test/integration/database-query.e2e.spec.ts`;
- `docs/superpowers/reports/2026-07-25-agent-database-query-tooling-verification.md`.

Before staging, this worktree contains only those two untracked files. The main
checkout's unrelated user changes were preserved and not staged:

```text
 M AGENTS.md
 M CLAUDE.md
 M MEMORY.md
?? .playwright-cli/
?? docs/superpowers/plans/2026-07-25-agent-database-query-tooling.md
?? output/
```
