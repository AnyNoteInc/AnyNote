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

# [anynote] recent context, 2026-05-10 12:26pm GMT+1

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (18,002t read) | 655,385t work | 97% savings

### May 9, 2026
1289 7:00a 🔵 Actual sendsay.ts Codebase State: Singleton Client + Dev Fallback + Dead-Code Error Check
1290 " 🔵 sendsay.test.ts Actual State: 4 Tests, Error Envelope Still Uses False-Passing mockResolvedValueOnce
1291 " 🔵 auth.ts sendMailNow Called in 4 Places — afterEmailVerification and databaseHooks.user.create.after Unguarded
1292 " 🔴 sendsay.ts Fixed: try/catch Wraps client.request() Preserving All Existing Features
1297 7:03a ⚖️ Design Decision: Email Sending Made Best-Effort — Failures Swallowed, Not Propagated
1298 " 🔴 Registration Bug Fully Fixed and Verified: User Persisted Despite Sendsay access_denied
1299 " 🔴 @repo/mail Package: 20 Tests Pass, Lint Clean, TypeScript Types Valid
1300 7:14a 🟣 Post-Registration Redirect to /profile After 3-Second Delay
1301 7:15a 🔵 AnyNote Web App Auth & Profile Route Structure
1302 " 🔵 RegisterForm Component Is a Controlled UI Widget With onSubmit Callback
1303 " 🔵 SignUpForm Currently Shows Success Alert With No Redirect
1304 7:16a 🔵 Email Verification Required Before Auto-Sign-In — Redirect to /profile After Registration Will Fail
1305 " 🟣 3-Second Auto-Redirect to /profile Added After Successful Registration
1306 " ✅ TypeScript Type-Check Passes After Redirect Implementation
1307 " 🔵 Pre-Existing Unstaged Changes in packages/mail Alongside Sign-Up Fix
1308 7:22a 🔴 SendSay Email Delivery Made Best-Effort — Errors No Longer Propagate to Callers
1309 7:23a ✅ Two Commits Pushed to main — Triggering Semantic Release Pipeline
1310 7:42a 🔵 Release CI Failed on feat(web) Commit — All Prior Releases Were Successful
1311 " 🔵 CI Failure: SignUpForm Test Breaks Due to useRouter() Requiring App Router Context
1312 " 🔵 SignUpForm Test Mocks auth-client and recaptcha But Not next/navigation
1313 " 🔴 SignUpForm Test Fixed — Mocked next/navigation useRouter to Resolve App Router Invariant
1314 " 🔴 SignUpForm Test Passes Locally After Adding next/navigation Mock
1315 " ✅ act Imported in SignUpForm Test — Preparing for Timer-Based Redirect Assertion
1316 7:43a 🟣 New Test Added: Verifies 3-Second Redirect to /profile After Sign-Up
1317 " 🔵 New Redirect Test Times Out — userEvent With Fake Timers Deadlocks in jsdom
1318 " 🔴 Redirect Test Approach Switched From Fake Timers to waitFor With Real Timers
1319 " ✅ Redirect Test Rewrote Using setTimeout Spy Instead of Fake Timers
1320 7:44a 🔴 Both SignUpForm Tests Pass — setTimeout Spy Approach Resolves Timer Test Deadlock
1321 " 🔴 Full Web Test Suite Passes After SignUpForm Test Fix — 34 Files, 112 Tests Green
1322 " 🔴 CI Fix Committed and Pushed — test(web) Commit Unblocks Release Pipeline
1323 7:51a 🟣 v1.9.0 Released Successfully — CI Pipeline Fully Recovered
### May 10, 2026
1324 7:50a 🟣 Legal Consent Tracking System — Feature Requirements Defined
1325 " 🔵 Existing Sign-Up Flow and Legal Document Structure Mapped
1326 7:51a 🔵 Legal Document Registry and Settings Nav — Detailed Structure Confirmed
1328 " ⚖️ Legal Consent Tracking System — Architecture Specified
1329 " ⚖️ MarketingConsent.md — Produce as Final, No Draft Marker
1327 7:52a ⚖️ Consent Tracking Feature — Architecture Decisions Finalized via Subagent Exploration
1330 8:05a ⚖️ Sign-Up Consent Persistence Strategy — tRPC Wrapper Chosen
S305 Legal consent tracking — design sections 1-3 presented; key architectural question raised about sign-up consent persistence strategy (May 10 at 8:09 AM)
S306 Legal consent tracking — user chose tRPC wrapper as sign-up strategy; sections 1-3 design finalized (May 10 at 8:09 AM)
S308 Legal consent tracking — section 4/5 presented: full UI and page flow design including RegisterForm changes, onboarding page, settings consents table (May 10 at 8:14 AM)
S309 Legal consent tracking — all 5 design sections complete; awaiting approval to write spec and begin implementation (May 10 at 8:15 AM)
S310 User consents design spec written and committed; awaiting user review before implementation plan is written (May 10 at 8:16 AM)
1331 8:21a 🔵 Existing Terms Pages Design Spec Found — Prior Legal Infrastructure Context
1333 " ✅ User Consents Design Spec Written to docs/superpowers/specs/
S311 User consents design spec finalized and self-reviewed; pre-commit git state checked before committing (May 10 at 8:21 AM)
S312 Observer session monitoring feat/user-consents branch — legal consent tracking system for Anynote app (24-task plan) (May 10 at 8:21 AM)
1332 8:22a 🔵 Current Sign-Up Form Implementation — Exact State Before Consent Changes
1334 8:24a ✅ User Consents Design Spec Committed to main
1335 8:26a 🔵 Confirmed Baseline State of Settings, tRPC Routers, and UI Widgets Before Implementation
1336 8:36a 🔵 tRPC context structure in Anynote
1337 8:37a 🔵 Auth and protected layout structure in Anynote web app
1338 " 🔵 tRPC test pattern and client setup in Anynote
1339 " 🔵 E2E auth helper signUpAndAuthAs needs consent rows after user creation
1340 8:38a 🔵 legal-documents.ts uses slug-based structure not matching ConsentDocumentType enum
1341 8:44a 🟣 User consents implementation plan written and committed
1342 8:45a ✅ User consents implementation plan committed to main
S313 Observer session monitoring feat/user-consents — 24-task legal consent tracking system, now complete and verified (May 10 at 8:45 AM)
S314 Observer session monitoring feat/user-consents — feature complete, branch pushed to GitHub (May 10 at 9:41 AM)
S315 Observer session monitoring feat/user-consents — feature complete, PR #8 opened on GitHub (May 10 at 9:46 AM)
**Investigated**: PR creation via `gh pr create` with full title, body covering summary, design choices, test plan, and files of interest. Warning about 1 uncommitted change (MEMORY.md only — not feature code).

**Learned**: - `gh pr create` warns about uncommitted changes but still creates the PR successfully.
    - The uncommitted MEMORY.md is the auto-memory file managed by the superpowers observer framework — not part of the feature and correctly excluded from the PR.

**Completed**: **PR #8 opened: https://github.com/AnyNoteInc/AnyNote/pull/8**

    Title: `feat: legal-grade user consent tracking`

    PR body covers:
    - Summary: immutable user_consents table, 5 legal documents (152-ФЗ + ФЗ-38), sign-up → trpc.auth.signUp, consent gate in (protected)/layout.tsx, /onboarding/consents, /settings/consents marketing toggle
    - Notable design choices: immutable log, manual version field (vs sha256), no backfill migration for existing users, onDelete Cascade
    - Full test plan: pnpm gates ✅ (23 tasks, 120 tests), 13+3+2+5+3+3+4 unit tests, 2 E2E tests, signUpAndAuthAs backfill for existing E2E specs
    - Files of interest: schema, migration, consents.ts helpers, consent/auth routers, ConsentsCheckboxes widget, onboarding/settings routes, protected layout, MarketingConsent.md, CLAUDE.md

    Branch: feat/user-consents — 22 commits, 43 files changed, +1922/-246 lines

**Next Steps**: Feature development is complete. PR is open for review. No active implementation work remains. The session is effectively done — awaiting code review or merge decision from the team.


Access 655k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>
