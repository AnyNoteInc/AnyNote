# apps/engines NestJS Unification — Follow-ups

Non-blocking issues raised during the final code review of `feat/engines-nest-rewrite` that were deliberately deferred. All critical and important blockers were addressed before merge (see commit history `1bdc928..252e4a1`).

**Spec:** `docs/superpowers/specs/2026-04-20-engines-nestjs-unification-design.md`
**Plan:** `docs/superpowers/plans/2026-04-20-engines-nestjs-unification.md`

## Indexer

- **IndexingProcessor retry/fail path is untested.** `markFailedOrRetry` and the `POWER(2, attempts + 1) * 10` backoff formula have no unit coverage. Add two tests: retry (status returns to `PENDING` with `next_attempt_at > now`) and terminal failure (after `INDEXER_MAX_ATTEMPTS` → `FAILED`).
- **BullMQ `jobId: outbox-${id}` may dedupe retries.** With `removeOnFail: 100` keeping failed jobs, re-enqueueing the same `jobId` after a retry may or may not re-run depending on BullMQ version semantics. Either include `attempts` in the jobId (`outbox-${id}-${attempts}`) or drop `jobId` entirely — the outbox row already gates re-enqueue.
- **`OutboxCronService` does 500 individual INSERTs per tick.** Batch into a single `INSERT ... SELECT ... FROM unnest($1::uuid[], $2::uuid[])` for ~100× round-trip reduction. Raw SQL required because `createMany({ skipDuplicates })` doesn't target the partial unique index.
- **Integration test `indexing.e2e.spec.ts` uses `setTimeout(15000)`.** Flaky if Ollama cold-starts. Switch to polling `outboxEvent.status === 'DONE'` with a 30s budget.
- **Partial unique index on `outbox_events` lives outside `schema.prisma`.** Applied via raw SQL in `packages/db/prisma/sql/2026-04-20-outbox-active-unique.sql`. Consider adding `prisma:apply-sql prisma/sql/2026-04-20-outbox-active-unique.sql` to the seed script, or upgrading Prisma to a version that supports `@@index(..., where: ...)` so the index becomes schema-tracked.

## MCP

- **`createPageFromFile` throws `PageNotFoundError(fileId)` when file is missing** — should be `FileNotFoundError(args.fileId)`. File: `apps/engines/src/apps/mcp/tools/workspace.tools.ts`.
- **S3 upload happens inside the Prisma transaction** in `FileUploader.uploadInline`. Move the `storage.put` call outside the tx to avoid orphan S3 objects if the tx rolls back or times out. Pattern: first tx creates `File` row with `path: "pending"` + returns id; `storage.put` outside tx; second tx updates `path` + creates `PageFile` + outbox.
- **MCP error `code` is lost in tool-call responses.** `@rekog/mcp-nest` surfaces only `HttpException.message` as tool-call error content — the `code` property doesn't travel. Workaround: prefix messages with the code (`"[WORKSPACE_ACCESS_DENIED] …"`) so clients can match. Longer-term: upstream patch to the library.
- **`McpTokenGuard` uses plain `!==` comparison.** Swap for `crypto.timingSafeEqual` for timing-safety (localhost-only shared secret → low risk, but cheap fix).
- **`PageWriter` / `FileUploader` call `tx.outboxEvent.create` directly** instead of `enqueueOutboxEvent()` from `@repo/db`. Align with `packages/trpc/src/routers/page.ts` pattern so any future logic in the helper propagates.
- **`MarkdownRenderer` produces `_ y_` / `` ` z` ``** — whitespace inside marks is not valid Markdown (most renderers won't italicize/code-highlight). Should trim leading/trailing whitespace out of the mark and place it outside: `" " + "_y_"` instead of `"_ y_"`.
- **`PageChunker` emits chunks with double-spaces** because of repeated `.join(" ")` at each nesting level. Not incorrect for indexing (normalizer collapses whitespace downstream), but the current test codifies buggy output. Post-join `.replace(/\s+/g, " ").trim()` would normalize.
- **Ownership consistency not enforced on `createPage`.** A `SKILL` page can be a child of a `TEXT` page today. Verify whether the product wants ownership-homogeneous subtrees.

## Infrastructure

- **`/health` is a liveness stub.** Returns `{"status":"ok"}` with no checks on Postgres/Redis/Qdrant/Ollama. Add `@nestjs/terminus` with DB + Redis + Qdrant health indicators at `/health` (or differentiate `/livez` vs `/readyz` for k8s).
- **`OllamaService.embed` has no retry.** Spec §EmbeddingClient calls for retry ×2. Wrap the axios call in the same 3-attempt exponential backoff used by `ProcessingClient`.
- **`apps/engines/eslint.config.js` missing.** `pnpm --filter engines lint` fails because no flat-config file exists. Add one extending `@repo/eslint-config/next` or similar.
- **Compose `engines` service can't reach `apps/agents`.** Removed the broken `PROCESSING_SERVICE_URL` env in `052db36`, but docker-compose still lacks an `agents` service. Either add one (build `apps/agents/Dockerfile`) or document that engines compose profile requires host-running agents + `host.docker.internal:8080`.

## Commit hygiene

- **Commit `e5253e5` mixed the markdown renderer with unrelated files** (`MEMORY.md`, `agent.md`, `apps/agents/*` lint fixes, `packages/db/src/index.{js,d.ts,js.map}` accidentally-tracked artifacts). The tsc artifacts were removed in `6d7a486` but the commit split can't be retroactively undone without a rebase.
- **`packages/db/tsconfig.json` outDir may be wrong** — investigation needed to determine why `packages/db/src/index.{js,d.ts,js.map}` got generated in `src/` in the first place. Likely `outDir` not set or is set to `src/`.

## Spec gaps

- **`movePage` semantics were under-specified in the original design.** The design spec called movePage "reorder" without acknowledging the `@unique prev_page_id` sibling-relink mechanics. Fixed in `1bdc928` by mirroring tRPC semantics, but the spec should be amended to document the contract an MCP client should expect for move operations (including whether cycle detection is provided — currently it isn't).
- **`updatePage` vs Yjs overwrite risk** is acknowledged in the design spec but without concrete mitigations. Current implementation unconditionally overwrites `Page.content`, so Yjs sessions editing the same page at the same time will have their updates clobbered on next Yjs broadcast. Follow-up: use Yjs-aware update API, or forbid `updatePage` with non-empty content on pages with active Yjs connections.
