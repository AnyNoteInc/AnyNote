# Repository Guidelines

## Project Structure & Module Organization

AnyNote is a pnpm/Turbo monorepo. Application code lives in `apps/`: `web` is the Next.js product UI, `yjs` handles collaborative editing, `agents` is the FastAPI/LangGraph LLM service, `engines` is the NestJS MCP/vectorization service, and `e2e` contains Playwright specs. Shared TypeScript packages live in `packages/`, including `db`, `auth`, `trpc`, `ui`, `editor`, `excalidraw`, `genogram`, `storage`, `mail`, and `yookassa`. Architecture notes and implementation plans belong in `docs/`; Docker support lives in `docker/`.

## Build, Test, and Development Commands

- `pnpm install` installs workspace dependencies.
- `docker compose up -d` starts local Postgres, MinIO, Qdrant, and Mailhog services. No LLM provider runs in compose — `apps/agents` uses per-workspace LLM/embedding connections configured in **Settings → AI агент**.
- `pnpm dev` runs all app dev servers through Turbo.
- `pnpm --filter web dev` runs only the Next.js app.
- `pnpm build`, `pnpm lint`, `pnpm check-types`, and `pnpm test` run the corresponding Turbo tasks.
- `pnpm gates` runs type checks, lint, build, and tests together.
- `pnpm exec playwright test` runs root Playwright e2e tests.
- `pnpm --filter @repo/db exec prisma migrate dev` applies Prisma migrations locally.

## Coding Style & Naming Conventions

Use TypeScript for `apps/web`, `apps/yjs`, `apps/engines`, and `packages/*`; use Python 3.13 tooling in `apps/agents`. Prefer workspace imports such as `@repo/ui`, `@repo/db`, and `@repo/trpc`. Run `pnpm format` for Prettier on `ts`, `tsx`, and Markdown. TypeScript workspaces use ESLint with zero warnings. Python uses Ruff formatting with single quotes and 120-column lines, plus strict mypy settings.

## Testing Guidelines

Vitest covers most TypeScript packages and `apps/web`; Jest is used in `apps/yjs` and `apps/engines`; Pytest covers `apps/agents`; Playwright covers browser flows in `apps/e2e`. Keep tests near package-level `test/` folders or beside source files using existing `*.test.ts`, `*.spec.ts`, and `test_*.py` patterns. For focused runs, use `pnpm --filter @repo/trpc test`, `pnpm --filter engines test`, or `pnpm --filter agents test`. Mark live-service integration tests clearly.

## Commit & Pull Request Guidelines

Follow Conventional Commits with scopes, for example `feat(trpc): enforce soft downgrade workspace guards`, `fix(auth): show reset token failures consistently`, or `test(mail): isolate outbox dispatch tests`. PRs should describe the user-visible change, list verification commands run, link relevant issues or specs, and include screenshots for UI changes.

## Security & Configuration Tips

Copy `.env.example` to `.env` for local setup and keep secrets out of commits. Update service environment variables before debugging database, Better Auth, S3, Qdrant, engines, agents, or YooKassa behavior. LLM/embedding provider connections (OpenAI, GigaChat, Ollama) are configured per-workspace in the UI, not via env.


<claude-mem-context>
# Memory Context

# [anynote] recent context, 2026-04-29 8:53pm GMT+1

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (19,151t read) | 1,282,260t work | 99% savings

### Apr 29, 2026
S32 Per-workspace embeddings model selection — Qdrant + agents contract design (Section 2/6), moving to engines/indexer flow next (Apr 29 at 4:47 PM)
S33 Per-workspace embeddings model selection — indexer cron + outbox→agents flow design (Section 3/6) (Apr 29 at 4:47 PM)
S31 Per-workspace embeddings model selection — Qdrant strategy and agents contract design presented (Section 2/6) (Apr 29 at 4:47 PM)
S34 Per-workspace embeddings model selection — tRPC aiSettings.update model-change flow design (Section 4/6) (Apr 29 at 4:49 PM)
S35 Multi-partner genogram fixes: parallel bracket horizontals (bracketYOffset stacking), equal-length pregnancy loss cross diagonals, letter positioning — full implementation and gates pass (Apr 29 at 4:52 PM)
S36 Per-workspace embeddings model selection — UI Векторизация section design (Section 5/6) (Apr 29 at 5:02 PM)
S38 Per-workspace embeddings model selection — all 6 design sections complete, awaiting confirmation to write spec file and begin implementation (Apr 29 at 5:24 PM)
S39 Per-workspace embeddings model selection — design spec committed, awaiting user review before writing implementation plan (Apr 29 at 5:27 PM)
S37 Per-workspace embeddings model selection — RAG retrieval skip design (Section 6/6), full design complete, awaiting spec commit confirmation (Apr 29 at 5:27 PM)
233 5:47p ✅ Plan finalized: Prisma import line added to capability filter code block
234 " ✅ Implementation plan complete and ready to commit
236 " ✅ Plan confirmed clean and structurally sound at 1602 lines
237 5:48p ✅ UI smoke test assertions changed from toBeInTheDocument() to toBeTruthy()
238 " ✅ Plan validated: 136 balanced code fences, ready to commit
239 " 🟣 Implementation plan committed: docs/superpowers/plans/2026-04-29-workspace-embedding-models.md
240 " 🔵 Two separate implementation plans exist — older plan at dd9d0d9 may conflict
241 5:53p 🔵 Subagent-Driven Development Skill Templates Located
242 " 🔵 Per-Workspace Embeddings Plan Commit History Confirmed
243 " 🔵 Two Competing Plan Files Existed — Older 1602-Line Plan Deleted in HEAD
S40 Per-workspace embeddings model selection — begin subagent-driven implementation execution (Apr 29 at 5:54 PM)
244 5:55p ✅ Feature Branch Created for Per-Workspace Embeddings
245 " 🔵 WorkspaceAiSettings Schema Before Embeddings FK Addition
246 " 🔵 All Docker Services Healthy for Development
247 5:56p 🟣 AiModel Schema Extended with Embeddings Fields and Named Relations
248 5:57p 🟣 WorkspaceAiSettings Schema Complete — embeddingsModelId FK Added with Named Relations
249 " 🟣 Migration 20260429165703_add_workspace_embeddings_model Applied Successfully
250 " 🟣 Task 1 Schema Changes Pass Full Type-Check Across All 16 Packages
251 " 🟣 Task 1 Complete — Subagent Confirmed Schema Migration DONE
252 " 🔴 Schema Grep Confirms All Embeddings Fields at Correct Line Numbers
253 5:59p 🟣 Task 1 Spec Review Passed — ✅ Spec Compliant After Independent Verification
269 6:09p 🟣 Per-Workspace Embeddings Implementation Initiated in Anynote
254 8:36p 🔵 Task 11 Spec Compliance Review Initiated for RagRetrievalService Refactor
256 8:39p 🔵 Circular Import Breaks ModelConnectionSchema Export from agents.apps.chat.schemas
257 " 🔴 Fixed ModelConnectionSchema ImportError in chat test files
258 " 🟣 GraphService.prepare_prompt now skips RAG retrieval when embedding is null
259 " 🟣 Task 12 Complete: Conditional RAG retrieval committed on feat/per-workspace-embeddings
255 8:43p 🔵 Task 11 Spec Compliance Review: RagRetrievalService Implementation Partially Compliant — mypy Failure in graph.py
262 8:44p 🔵 Task 12 Spec Compliance Review: RAG Skip When Embedding Null — Fully Compliant
260 " 🔵 Two Separate graph.py Codebases: Project Root vs. Direct apps/agents Path
261 " 🟣 Task 12 Complete: Conditional RAG in Real graph.py + Comprehensive Test Coverage
263 8:46p 🟣 Conditional RAG Retrieval Based on Embedding Presence in GraphService
264 " 🔵 Code Review: Conditional RAG Change Is Correct and Type-Safe
265 " 🔵 Two Parallel Test Files Cover GraphService.prepare_prompt
272 8:47p 🔵 RagRetrievalService.retrieve Internal Implementation Uses Per-Call Embedder and VectorStoreRepository
274 " 🔵 Per-Workspace Embeddings Plan Progress: Tasks 1-12 Complete, Task 13 In Progress
275 " 🔵 engines AgentsClient Pre-Task-13: No Embedding Payload, No Delete Methods, Wrong page.deleted Handling
276 " 🔵 VectorizationCronService Tests Use Only vectorize Stub — deletePageVectors Not Yet Mocked
266 8:48p 🔵 Jinja Templates Confirm Empty RAG List Renders Cleanly
267 " 🔴 Base Commit e82e1e6 Had Broken graph.py — HEAD Fixes Missing Embedding Arg
268 " 🔵 All 16 Unit Tests Pass for Graph and RAG Retrieval After Conditional Guard Change
273 " 🔵 Task 11 + Task 12 Integration Review: RagRetrievalService Embedding Signature Verification
277 " 🔵 Task 11 + Task 12 integrated review: spec compliant, all checks pass
270 8:49p 🟣 RAG Retrieval Skipped When Embedding Payload Is Null in GraphService
271 " ⚖️ RagRetrievalService.retrieve Adopts Per-Call Embedding Signature (Task 11)
278 8:50p 🔵 Git Log Confirms 12 Commits Shipped on feat/per-workspace-embeddings
279 " 🔵 VectorizationCronService Spec Tests Will Break After Task 14: Missing workspaceAiSettings Mock and Wrong delete Path
280 " 🟣 Phase 4 tRPC: getAvailableEmbeddingModels Helper and aiSettings.listAvailableEmbeddingModels Procedure Planned
281 8:53p 🟣 Worker Agent Descartes (019ddacc) Spawned to Implement Tasks 13 and 14
282 " 🔵 Phase 4 tRPC and Phase 5 Web Pre-Task State: aiSettings Router, ai-section.tsx, agents-payload.ts
283 " ⚖️ aiSettings.update Wipe-and-Reindex: Transaction-First, Then Best-Effort Vector Delete

Access 1282k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>