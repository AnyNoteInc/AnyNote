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

# [anynote] recent context, 2026-05-07 7:59pm GMT+1

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (15,889t read) | 722,911t work | 98% savings

### May 7, 2026
1109 6:18a 🔵 Existing TiptapNode JSON Walker in page-search.ts
1110 " 🔵 No Server-Side PDF Library Exists — Must Be Added
1111 6:19a 🔵 apps/web Dependencies Confirm TurndownService Server-Side Reuse
1112 " 🔵 Custom Tiptap Extensions Have Server-Compatible renderHTML Methods
1113 " 🔵 Critical Gap: tRPC page.getById Excludes content JSON Snapshot
1114 6:30a 🔵 Page.content JSON Snapshot Written by apps/yjs Persistence Layer
1115 " 🔵 @hocuspocus/transformer Used to Convert YJS Doc to Tiptap JSON in apps/yjs
1116 " ⚖️ All 6 Export Scoping Decisions Finalized
S261 Export feature architecture design — Sections 4 and 5 presented (print-stylesheet design + Gotenberg deployment configuration) (May 7 at 6:43 AM)
S263 Export feature architecture design — Sections 4–6 presented (print-stylesheet, Gotenberg deployment, testing strategy) (May 7 at 6:44 AM)
1117 6:44a ✅ Server-side page export design spec written to docs/superpowers/specs/
S266 Repeated investigation reads — no new findings; primary session still pre-plan (May 7 at 6:45 AM)
S267 Design and document a complete server-side page export system for Anynote Next.js app — spec + 27-task implementation plan (May 7 at 6:52 AM)
S268 Observer session monitoring 27-task TDD implementation of server-side page export for Anynote — all tasks complete, PR opened (May 7 at 7:06 AM)
1119 7:47a 🔴 GOTENBERG_URL added to canonical .env
1120 " 🔴 Created apps/web/.env symlink in git worktree
1121 " 🔴 Fixed E2E spec: removed redundant page.goto('/sign-up') before signUpAndAuthAs
1122 " 🔵 Task 26 subagent hit Anthropic rate limit mid-execution
1123 11:12a 🔵 apps/web/.env symlink is transient — lost between sessions
1124 " 🔵 E2E signUpAndAuthAs failure persists: user row never appears after sign-up
1125 " 🔵 Anynote worktree current state: Task 26 spec written but uncommitted, 28 commits ahead
1126 11:14a 🔵 signUpAndAuthAs failure affects ALL E2E specs in worktree — not page-export-specific
S269 Merge and deploy: push feat/server-page-export branch and create PR for server-side page export feature (May 7 at 11:15 AM)
S270 Merge and deploy: push feat/server-page-export, create PR #6, verify CI, and squash-merge to main (May 7 at 11:23 AM)
S271 мердж и делай деплой — merge feat/server-page-export PR and deploy AnyNote v1.5.0 to production (May 7 at 11:36 AM)
1127 11:36a 🟣 feat/server-page-export merged to main; Release workflow triggered automatically
1128 11:44a 🟣 Release workflow created v1.5.0 tag and triggered Deploy to production
1129 " ✅ main branch updated to v1.5.0 with automated release commit after squash merge
1130 11:54a 🟣 Squash merge commit 58be901 ships server-side page export: 41 files, 1940 insertions
1131 11:55a 🔵 AnyNote has 13+ active feature branches across multiple domains
1132 11:57a 🟣 Tag v1.5.0 created on main HEAD, confirming release tagging pipeline works
1133 " 🟣 Deploy workflow v1.5.0 completed successfully — server-side page export is live in production
1134 " 🟣 Production smoke test passed — anynote.ru live and healthy post v1.5.0 deploy
1135 " ✅ feat/server-page-export worktree and local branch cleaned up post-merge
1136 11:58a 🔵 origin/feat/server-page-export remote branch persists after squash merge — requires manual deletion
S272 Add Gotenberg PDF export service to production deployment — compose.yml, env template, deploy workflow, and GitHub secrets (May 7 at 11:58 AM)
1137 12:02p 🟣 Gotenberg PDF Export Service Integration
1138 " 🔵 Anynote deploy/compose.yml Service Architecture
1139 " 🔵 Anynote GitHub Actions Deploy Pipeline Architecture
1140 " 🔵 Gotenberg Already Integrated in Application Code
1141 " 🔵 Gotenberg Already Configured in Local Dev compose.yml
1142 12:03p 🔵 GitHub Secrets Stored at Repository Level, Not Environment Level
1143 " 🟣 Gotenberg Service Added to Production deploy/compose.yml
1144 12:04p ✅ Web Service Now Depends on Gotenberg Starting
1145 " ✅ GOTENBERG_URL and GOTENBERG_TIMEOUT_MS Added to deploy/.env.template
1146 " ✅ GOTENBERG_URL and GOTENBERG_TIMEOUT_MS Added to GitHub Actions Deploy Workflow
1147 " 🟣 GOTENBERG GitHub Secrets Created with Production Values
1148 " 🔵 Gotenberg Env Substitution and Compose Syntax Verified
1149 " 🔵 Full Compose Config Validation Confirms Gotenberg Integration Correct
1150 " 🟣 Gotenberg PDF Export Integration Complete — 3 Files Changed, 28 Insertions
1151 12:06p 🟣 Gotenberg Deploy Integration Committed to main (ab0a27c)
1152 " 🟣 Gotenberg Deploy Commit Pushed to main on AnyNoteInc/AnyNote
1153 " 🔵 Release Workflow Triggered Automatically by Gotenberg Commit Push
1154 12:11p 🟣 Release Workflow 25492049984 Completed Successfully
1156 " 🔵 Deploy Workflow for v1.6.0 Backgrounded While Awaiting Completion
1157 12:19p 🟣 v1.6.0 Deploy Workflow Completed Successfully — Gotenberg Now Live in Production
1155 12:20p 🟣 Release Workflow Created v1.6.0 Tag; Deploy Workflow In Progress
1158 12:30p 🟣 Production Smoke Test Passed After v1.6.0 Deploy
S273 Commit Gotenberg deploy integration to main and deploy to production — completed as v1.6.0 (May 7 at 12:31 PM)
1159 7:59p 🔵 PDF Export Current Margin Implementation in anynote

Access 723k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>
