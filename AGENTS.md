# Repository Guidelines

## Project Structure & Module Organization

AnyNote is a pnpm/Turbo monorepo. Application code lives in `apps/`: `web` is the Next.js product UI, `yjs` handles collaborative editing, `agents` is the FastAPI/LangGraph LLM service, `engines` is the NestJS MCP/vectorization service, and `e2e` contains Playwright specs. Shared TypeScript packages live in `packages/`, including `db`, `auth`, `trpc`, `ui`, `editor`, `excalidraw`, `genogram`, `storage`, `mail`, and `yookassa`. Architecture notes and implementation plans belong in `docs/`; Docker support lives in `docker/`.

## Build, Test, and Development Commands

- `pnpm install` installs workspace dependencies.
- `docker compose up -d` starts local Postgres, MinIO, Qdrant, and Ollama services.
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

Copy `.env.example` to `.env` for local setup and keep secrets out of commits. Update service environment variables before debugging database, Better Auth, S3, Qdrant, Ollama, OpenAI, engines, agents, or YooKassa behavior.


<claude-mem-context>
# Memory Context

# [anynote] recent context, 2026-04-29 5:37pm GMT+1

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (21,603t read) | 520,816t work | 96% savings

### Apr 29, 2026
173 4:37p ⚖️ Implementation Plan Structured for Multi-Model Embeddings Feature
174 " 🔵 Anynote Embeddings & AI Settings Architecture Mapped
175 4:38p 🔵 Detailed Code Architecture for Embeddings Feature Integration Points
176 4:39p 🔵 RAG Retrieval Is Unconditional and BackfillReindex Pattern Exists for Re-indexing
177 " ⚖️ Codebase Mapping Complete — TDD Phase Starting
178 " 🟣 Failing Tests Added for RAG Enable/Disable Based on embeddingsModelId
179 4:40p 🟣 Failing Tests Written for RAG Skip and Workspace Vector Deletion
180 " 🟣 All Failing Tests Confirmed Red — TDD Phase 1 Complete
182 " 🟣 Core Implementation: RAG Enable Flag Wired Through Web → Agents Pipeline
183 " 🟣 VectorStoreRepository.delete_by_workspace and REST Endpoint Implemented
184 4:41p 🟣 Engines Indexer Skip Logic Added for Missing Embeddings Model
185 " 🔵 Seed File Reveals Active AI Providers: GigaChat + Ollama Only (No OpenAI)
187 " 🔵 ModelFactoryRepository: Chat LLM Factory Supports Ollama + OpenAI + GigaChat
186 " 🟣 Existing Engines Test Mocks Updated to Include getWorkspaceEmbeddingModelId
188 " 🟣 Prisma Schema and Migration Updated for Embeddings Support
189 " 🔵 ProcessingProvider DI: VectorStoreRepository Is APP-Scoped with Baked-in Collection Name
190 " 🟣 Seed Data Updated: nomic-embed-text Added as First Embeddings-Capable Model
191 4:42p 🔵 Seed Data: Ollama Embedding Models Already Seeded as AiModel Records
192 " ⚖️ Race Condition Strategy for Embeddings Model Change: Option A Selected
193 4:46p ⚖️ Multi-Model Embeddings Support Design for AnyNote Workspaces
S30 Per-workspace embeddings model selection — Prisma schema design presented (Section 1/6) (Apr 29 at 4:46 PM)
194 4:47p 🔵 Existing Embeddings and AI Settings Architecture in AnyNote
195 " 🔵 AiModel Schema Has No Embeddings Flag; WorkspaceAiSettings Has No Embeddings Model Field
S32 Per-workspace embeddings model selection — Qdrant + agents contract design (Section 2/6), moving to engines/indexer flow next (Apr 29 at 4:47 PM)
S33 Per-workspace embeddings model selection — indexer cron + outbox→agents flow design (Section 3/6) (Apr 29 at 4:47 PM)
S31 Per-workspace embeddings model selection — Qdrant strategy and agents contract design presented (Section 2/6) (Apr 29 at 4:47 PM)
196 4:48p 🔵 Complete RAG and Vectorization Pipeline Architecture in AnyNote
197 " 🔵 Historical Design Docs Reveal RAG Architecture Migration and Embeddings Model Change Was Explicitly Out of Scope
S34 Per-workspace embeddings model selection — tRPC aiSettings.update model-change flow design (Section 4/6) (Apr 29 at 4:49 PM)
214 4:52p ⚖️ No Embeddings Model = LLM Responds Without RAG, Not Blocked
S35 Multi-partner genogram fixes: parallel bracket horizontals (bracketYOffset stacking), equal-length pregnancy loss cross diagonals, letter positioning — full implementation and gates pass (Apr 29 at 4:52 PM)
199 4:58p 🔵 DivorceMarker body still recomputes bracketY after prop interface update
200 " 🔴 DivorceMarker function body updated to accept bracketY prop and silence unused sourceY/targetY
201 " 🔴 DivorceMarker drag projection simplified to X-axis-only for horizontal bracket segment
202 4:59p 🔴 DivorceMarker internal bracketY recomputation removed; prop used directly
203 " 🔵 placeMultiPartnerSubtree hubY doesn't account for bracketYOffset stacking
204 " 🔴 placeMultiPartnerSubtree hubY now accounts for bracket stacking offset
205 " 🔵 All 179 genogram tests pass after bracketYOffset + DivorceMarker refactor
206 " 🔵 Gates failed: @repo/genogram#lint exits with code 1
207 5:00p 🔵 Lint fails: _sourceY and _targetY underscore aliases not recognized as intentionally unused
208 " 🔴 DivorceMarker lint fix: removed _sourceY/_targetY from destructure entirely
209 " 🔄 DivorceMarkerProps interface cleaned up: sourceY and targetY removed
210 " 🔄 UnionLineEdge call site cleaned up: sourceY and targetY removed from DivorceMarker JSX
211 5:01p 🔵 Gates: genogram lint now passes; web#check-types fails with exit code 130 (likely transient SIGINT)
212 " 🔵 web#check-types passes cleanly when run directly — gate exit 130 confirmed transient
213 5:02p 🔵 All 52 gates pass after bracketYOffset multi-partner stacking feature complete
S36 Per-workspace embeddings model selection — UI Векторизация section design (Section 5/6) (Apr 29 at 5:02 PM)
S38 Per-workspace embeddings model selection — all 6 design sections complete, awaiting confirmation to write spec file and begin implementation (Apr 29 at 5:24 PM)
216 5:25p ⚖️ Indexing Skip Gate Uses embeddingsModelId Null, Not pageIndexingEnabled=false
221 " ✅ Design Spec Written: Workspace Embedding Model Selection
S37 Per-workspace embeddings model selection — RAG retrieval skip design (Section 6/6), full design complete, awaiting spec commit confirmation (Apr 29 at 5:27 PM)
215 5:30p 🔵 Existing RAG Retrieval Architecture: apps/engines Owns Qdrant Search, Not apps/agents
217 5:32p 🟣 Per-Workspace Embeddings Design Spec Written and Committed
218 " ✅ Spec Section 2.5 Expanded: Added DELETE /vectorization/pages/{page_id} Endpoint
219 5:33p ✅ Spec Section 3.1 Refined: page.deleted Cron Flow Made Explicit with Code Snippet
220 " ✅ Per-Workspace Embeddings Design Spec Committed to Main
S39 Per-workspace embeddings model selection — design spec committed, awaiting user review before writing implementation plan (Apr 29 at 5:33 PM)
222 5:35p ✅ Spec Self-Review Fixed Prisma Dual-Relation and Indexing Flag Note
223 " ✅ Spec Self-Review Passed: All Placeholders Replaced in Embedding Models Design Doc
224 5:36p ✅ Workspace Embedding Model Selection Spec Committed to main

Access 521k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>