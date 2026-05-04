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

# [anynote] recent context, 2026-05-04 8:45pm GMT+1

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (17,715t read) | 304,708t work | 94% savings

### May 4, 2026
781 4:11p 🔵 Better Auth API Route Location in anynote Project
782 " 🔵 Better Auth Base URL Configuration in anynote
783 4:24p 🔵 RegisterForm terms checkbox silently blocks sign-up test submissions
784 " 🔴 CI pipeline and SonarCloud both passing on PR #3
785 " 🔵 SonarCloud Auto-Analysis ignores sonar-project.properties — settings must be via API
786 " 🔴 SonarCloud CPD false positive from prettier reformatting .ts extension migration
787 " 🔴 21 SonarQube code-quality issues fixed across codebase on PR #3
S182 Fix failing GitHub Actions Deploy on tag v1.1.0 — root cause fully identified, fix defined, awaiting user decision on release strategy (May 4 at 4:24 PM)
788 4:31p 🔵 AnyNote repo merge strategy: all methods allowed, merge commits used historically
789 4:50p 🟣 PR #3 feat/terms-pages merged to main — legal docs pages, TS migration, CI and SonarQube fixes
790 5:05p 🔵 Deploy Workflow Failed on Tag v1.1.0
791 " 🔵 Anynote Project Has Three GitHub Actions Workflows
792 " 🔵 Deploy v1.1.0 Failure: Docker Build for Web App Fails on `pnpm turbo build`
793 5:06p 🔵 Root Cause: Missing `@docs/terms/*.md` Files in Web Docker Build
794 " 🔵 Root Cause Confirmed: `turbo prune` Excludes `docs/` Directory from Docker Build Context
795 5:07p 🔵 Complete Fix Path: Add `COPY docs/ ./docs/` to Dockerfile Builder Stage
S183 Fix failing GitHub Actions Deploy on tag v1.1.0 — fix committed and pushed, Release workflow running to produce v1.1.1 (May 4 at 5:07 PM)
S180 Fix failing GitHub Actions Deploy workflow on tag v1.1.0 — root cause identified as missing docs/ directory in Docker build context (May 4 at 5:07 PM)
S181 Fix failing GitHub Actions Deploy on tag v1.1.0 — root cause fully identified, fix defined, awaiting user decision on release strategy (May 4 at 5:07 PM)
796 " 🔵 Deploy Workflow Structure and Scope of Fix Confirmed
797 5:13p 🔴 Fixed: Added `COPY --from=prepare /app/docs/terms ./docs/terms` to Web Dockerfile Builder Stage
798 " 🔴 Committed Dockerfile Fix: `fix(web): include docs/terms in docker build context`
799 " 🔴 Fix Pushed to origin/main — Semantic-Release Will Create v1.1.1 Tag
800 " 🔵 Release Workflow Triggered for Fix Commit — In Progress
801 5:14p 🔴 Release Workflow Succeeded — v1.1.1 Tag Created by Semantic-Release
S184 Fix failing Deploy on v1.1.0 — Deploy run 25330086840 on v1.1.1 now queued and being watched (May 4 at 5:14 PM)
802 5:21p 🔵 Deploy Workflow Did Not Auto-Trigger on v1.1.1 Tag — Manually Dispatched
S186 Fix failing Deploy on v1.1.0 — COMPLETE: v1.1.1 deployed to production, full pipeline documented (May 4 at 5:21 PM)
803 5:31p 🔴 Deploy v1.1.1 Succeeded — All Jobs Green, Production Updated
804 " 🔵 Semantic-Release Config: Tag Push via GITHUB_TOKEN Explains Missing Deploy Auto-Trigger
S185 Fix failing Deploy on v1.1.0 — COMPLETE: v1.1.1 deployed to production successfully (May 4 at 5:31 PM)
S189 Fix failing Deploy workflow on tag v1.1.0 + auto-trigger Deploy when v* tag appears (May 4 at 5:31 PM)
805 5:34p 🔵 Google OAuth Credentials Found in anynote .env
806 " 🔵 Better Auth Google OAuth Config — Required additionalFields May Break Social Login
807 5:35p 🔵 Auth Client Architecture and Google Sign-In Call Site Mapped
809 " 🟣 Release Workflow Now Auto-Triggers Deploy After Semantic-Release Creates a Tag
808 " 🔵 Auth Package Exports Source Directly; better-auth v1.4.9; Turbo Env Vars Correct
811 " 🔵 Full .env Reveals Dev-Only Config; reCAPTCHA Keys Empty; Previous Session Context Loaded
812 " 🔵 Dev Infrastructure: Docker Services Running; Next.js Runs Natively Outside Docker
810 " ✅ Release Workflow Auto-Deploy Fix Committed and Pushed to main
813 " ✅ Next.js Dev Server Started in Background for Live Auth Testing
S187 Fix failing Deploy on v1.1.0 — fix shipped + Release workflow now auto-triggers Deploy, verifying ci() commit doesn't create spurious release (May 4 at 5:35 PM)
814 5:37p 🔵 Better Auth Google OAuth Initiation Works Correctly; Bug is Post-Redirect
815 " 🔵 Google Console Accepts redirect_uri; Bug Confirmed to Be in OAuth Callback Handler
816 " 🔵 Root Cause Found: Plan Table Missing — Database Not Migrated
817 5:38p 🔵 Database IS Migrated; P1014 Was False Alarm — Table is "plans" Not "Plan"
818 " 🔵 Better Auth Google Provider Maps given_name/family_name But Doesn't Pass firstName/lastName to User
819 5:39p 🔵 Confirmed Root Cause: users.firstName and users.lastName Are NOT NULL; Google Profile Doesn't Supply Them
820 " 🔵 mapProfileToUser API Confirmed in better-auth ProviderOptions at oauth-provider.ts:171
821 " 🔵 Auth Test Coverage Gap: Google OAuth Test Manually Injects firstName/lastName, Misses Profile Mapping Bug
822 " 🔴 Fixed Google OAuth: Added mapProfileToUser to Map given_name/family_name → firstName/lastName
823 5:40p 🔴 Google OAuth Fix Validated: TypeScript, ESLint, and Next.js Dev Server All Pass
824 " 🔴 Google OAuth Fix Fully Verified: All 5 Auth Tests Pass, Social Endpoint Still Works
825 " ✅ Project Memory Written: Better Auth additionalFields Require mapProfileToUser Per OAuth Provider
826 5:41p ✅ MEMORY.md Updated With Better Auth additionalFields Lesson
S188 Fix broken Google OAuth login in anynote project (Better Auth + Next.js monorepo) (May 4 at 5:41 PM)
827 5:45p 🔵 Google OAuth mapProfileToUser Does Not Return Email — Investigation
828 " 🔵 Prisma User Schema — Email and Additional Fields Layout
830 " 🔵 mapProfileToUser Type Allows Overriding Email — Potential Root Cause Found
829 5:47p 🔵 Auth Test Suite — Google OAuth Welcome Email Path Tested Manually

Access 305k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>
