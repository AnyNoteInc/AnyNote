# Repository Guidelines

## Project Structure & Module Organization

AnyNote is a pnpm/Turbo monorepo. Application code lives in `apps/`: `web` is the Next.js product UI, `yjs` handles collaborative editing, `agents` is the FastAPI/LangGraph LLM service, `engines` is the NestJS MCP/vectorization service, and `e2e` contains Playwright specs. Shared TypeScript packages live in `packages/`, including `db`, `auth`, `trpc`, `ui`, `editor`, `excalidraw`, `genogram`, `storage`, `mail`, and `yookassa`. Architecture notes and implementation plans belong in `docs/`; Docker support lives in `docker/`.

## Build, Test, and Development Commands

- `pnpm install` installs workspace dependencies.
- `docker compose up -d` starts local Postgres, MinIO, Qdrant services. No LLM provider runs in compose — `apps/agents` uses per-workspace LLM/embedding connections configured in **Settings → AI агент**.
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

# [anynote] recent context, 2026-05-17 8:22am GMT+1

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (18,558t read) | 680,793t work | 97% savings

### May 16, 2026
2296 10:01p ✅ All 3 SonarCloud Security Hotspots Marked REVIEWED/SAFE via API
2297 " 🔵 Quality Gate Still ERROR: Hotspots Fixed, Reliability Still Failing (Needs New Analysis)
2298 " 🔴 Fixed S6594: Replaced String.match() with RegExp.exec() in 3 E2E Test Files
2299 " 🔴 Fixed S2933: KanbanBus.listeners Marked readonly, Non-null Assertions Removed
2300 10:02p 🔴 Fixed S7735/S7764: Eliminated Negated Conditions and window → globalThis in Two Files
2301 " 🔵 TypeScript Type Check Passes After SonarCloud Fixes
2302 " 🔵 @repo/trpc Tests All Pass After kanban-bus.ts Refactor
2303 " 🔵 Web App Tests All Pass After SonarCloud Fixes
2304 " ✅ SonarCloud Fixes Committed to feat/kanban-p1 (commit 3aabdf7)
2305 " ✅ SonarCloud Fix Commit Pushed to origin/feat/kanban-p1
2306 " 🔵 New CI Run Triggered for PR #15 After SonarCloud Fix Push
2321 " 🔵 PR #15 CI Pipeline Passed All Checks
2322 " 🔵 AnyNote Release Workflow: Semantic-Release with Auto-Deploy Trigger
2323 " 🔵 AnyNote Deploy Workflow: Matrix Docker Build + SSH rsync Deployment
2324 10:10p 🟣 PR #15 (feat/kanban-p1) Merged into Main
2329 " ✅ CI/CD Workflow Initiated: Commit → PR → SonarQube → Release → Deploy
2325 " 🔵 Release Workflow Auto-Triggered After kanban-p1 Merge
2330 10:20p 🟣 feat/kanban-p1 Merged and Release v1.18.0 Triggered
2343 10:29p 🟣 GitHub Actions Pipeline Completed Successfully for anynote
2344 10:30p 🔵 AnyNote CI/CD Pipeline Architecture: Parallel Docker Builds + SSH Deploy
2345 " 🔵 AnyNote Pipeline Warnings: Dockerfile Security Issues and Node.js 20 Deprecations
### May 17, 2026
2346 5:02a 🔵 Anynote Project Structure and Agent Use Case Exploration Initiated
2347 " 🔵 Anynote Project Architecture and Prior Work Discovered via MEMORY.md
2348 " 🔵 Anynote Full Feature Map and Agents App Structure Discovered
2349 " 🔵 Anynote tRPC Router Surface Shows AI-Integrated Feature Domains
2350 5:03a 🔵 Anynote LangGraph Pipeline Architecture Fully Documented
2351 " 🔵 MCP Tool Surface Exposed to LLM Agent: Page and Workspace Operations
2352 " 🔵 Prisma Schema Reveals Full Kanban and Notification Data Models
2353 5:09a 🔵 Anynote Project Docker Compose Configuration
2354 " 🔵 Deploy Compose Intentionally Omits PostgreSQL Port Mapping
2355 5:12a ✅ Production PostgreSQL Port Bound to Loopback for SSH Access
2356 5:23a ⚖️ AnyNote Personal Agent OS — Architectural Vision Defined
2357 " ⚖️ 12 Core Agent Capability Scenarios Defined for AnyNote Agent
2358 " ⚖️ Six-Point Implementation Plan for apps/agents Agent OS
2359 " 🔵 Async Subagent Launched to Reverse-Engineer openclaw Agent
2360 " 🔵 openclaw Identified as TypeScript Multi-Channel AI Gateway (Not a Single Agent)
2361 " 🔵 claudecode Agent is TypeScript with Rich Context Compaction and Remote Session Architecture
2362 " ⚖️ Parallel Async Subagents Dispatched for Both Reference Agent Deep-Dives
2363 5:26a ⚖️ AnyNote Agent Operating System — Vision and Architecture Plan Added to MEMORY.md
2364 " ✅ PostgreSQL Loopback Port Change Committed and Pushed to main
2365 5:40a ⚖️ AnyNote Personal Agent OS — Architecture Synthesis Plan
S586 AnyNote Agent OS — Section 5/9 approved (user said "yes"), now presenting Section 5/9 content again as confirmation checkpoint — MCP integration design approved and session advancing (May 17 at 5:44 AM)
S587 AnyNote Agent OS — Section 6/9: Three-layer memory architecture — session history, RAG, and long-term WorkspaceAgentMemory with explicit v1 scope boundaries (May 17 at 5:49 AM)
S585 AnyNote Agent OS — Section 5/9: MCP client integration — multi-server tool registry, transport support, namespacing, allowlist, discovery UI, and engines MCP auth hardening (May 17 at 5:49 AM)
S588 AnyNote Agent OS — Section 7/9: Confirmation/interrupt flow for destructive tools — LangGraph interrupt(), SSE events, resume endpoint, timeout cleanup, and v1 scope limits (May 17 at 5:54 AM)
S590 AnyNote Agent OS — Section 8/9 (repeated): Complete SSE streaming protocol — 13 event types, web handling, discriminated union schema, event ordering invariant — awaiting approval (May 17 at 5:54 AM)
S591 AnyNote Agent OS — Section 9/9 (final): E2E golden-path scenario "Q&A with citations" + full test pyramid strategy covering unit, integration, and Playwright E2E layers (May 17 at 5:56 AM)
S589 AnyNote Agent OS — Section 8/9: Complete SSE streaming protocol — full event type taxonomy, web-side handling per event, discriminated union schema, and guaranteed event ordering invariant (May 17 at 5:56 AM)
S593 AnyNote Agent OS v1 design spec — committed; now generating implementation plan (May 17 at 5:58 AM)
2366 5:58a 🔵 AnyNote Specs Folder Contains Prior Agent Design Documents
2367 " 🟣 AnyNote Agent OS v1 Design Spec Written to Disk
2368 6:01a ✅ Agent OS Spec Post-Write QA: Single TBD Found and Model Strategy Clarified
S592 AnyNote Agent OS v1 design spec — authored, reviewed, and committed (May 17 at 6:01 AM)
2369 6:15a 🟣 Agent OS v1 Implementation Plan — Phase 1 written
2370 " 🟣 Agent OS v1 Plan — Phase 2 written (Tasks 6-10): JWT auth + HMAC guard
2371 " 🟣 Agent OS v1 Plan — Phase 3 written (Tasks 11-16): schemas, events, services
S594 AnyNote Agent OS v1 implementation plan — created, committed, and Task 1 executed on feat/agent-os-v1 branch (May 17 at 6:15 AM)
2372 6:26a 🔵 Task 1 verified SPEC_COMPLIANT and APPROVED via dual subagent review
2373 " 🔵 @repo/auth package structure before Task 2 implementation
2374 " 🔵 @repo/auth vitest config requires tests in test/ not src/ — plan spec conflict

Access 681k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>
