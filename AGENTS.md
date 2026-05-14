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

# [anynote] recent context, 2026-05-13 9:37pm GMT+1

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (16,157t read) | 558,492t work | 97% savings

### May 13, 2026
1719 3:14p 🔵 feat/tiptap-column-layout Branch Full Scope — 50 Commits, 66 Files, 6263 Insertions
1720 " ✅ PR #12 Created: feat(editor): column layout with unlimited columns, resizable dividers, and task-list support
1723 3:15p 🔵 SonarQube Reports Zero Open Issues on feat/tiptap-column-layout
1724 " 🔵 sonar CLI Does Not Support --pr Flag for PR-Scoped Issue Queries
1725 " 🔵 SonarQube PR #12 Has 16 Open Issues — Correct Flag is --pull-request Not --pr
1726 " 🔵 Full SonarQube Issue List for PR #12 — 16 Issues Across 5 Files
1727 3:16p 🔵 SonarQube BLOCKER S3516 Identified — dragend Handler in drop-placement.ts Always Returns false
1728 3:17p 🔵 S2004 CRITICAL — block-index-attributes.ts Exceeds 4-Level Function Nesting Due to Triple-Nested forEach
1729 " 🔵 column-resize.ts S6582 Context — Optional Chain Candidates in dispatchWidths and beginDrag
1730 " 🔵 column-layout.schema.ts S7761 Sources — Three getAttribute Calls to Replace with .dataset
1731 3:18p 🔵 reminder.schema.ts S7761 — getAttribute('data-audience') at Line 37 to Replace with .dataset.audience
1732 " 🔴 SonarQube Fixes Applied to drop-placement.ts — dragleave Refactored and Non-null Assertion Removed
1733 " 🔴 renderIndicatorDecoration Signature Updated to Accept PluginState | undefined
1734 3:24p 🔵 CI Checks Passed for AnyNote PR #12
1735 " 🔵 Open SonarQube CRITICAL Issue on PR #12 — Cognitive Complexity Violation
1736 " 🔴 Reduced Cognitive Complexity in applyPlacementDrop to Fix SonarQube S3776
1737 3:32p 🔴 Editor Package Local Gates Pass After Cognitive Complexity Fix
1738 " ✅ Cognitive Complexity Fix Committed and Pushed to PR Branch
1739 3:39p 🔴 SonarQube CRITICAL Issue Resolved — PR #12 Now Clean and Mergeable
1740 " 🔵 AnyNote Uses Semantic Release on Main Branch — Currently at v1.13.2
1741 " 🔵 PR #12 Squash-Merge Failed Due to Diverged Local Main Branch
1742 3:40p 🔵 PR #12 Successfully Merged to Main Despite Local Fast-Forward Error
1743 " 🟣 Release Pipeline Triggered for Column Layout Feature After PR #12 Merge
1744 " 🔵 Monitor Shell Script Failed Due to `status` Being a Read-Only Variable in zsh
1745 " 🟣 AnyNote v1.14.0 Released — Column Layout Feature Shipped to Production
1746 8:28p 🔵 Anynote main branch diverged from origin/main with merge conflicts
1747 " 🔵 Anynote merge conflict root cause: local doc-only commits vs origin v1.14.0 release
1748 " 🔵 Column layout drop-zone algorithm changed from 25%-edge to outside-bounding-rect
S437 Update AnyNote subscription plan pricing across website and legal offer — Pro: 390₽/mo 3900₽/yr; Max: 5900₽/mo 59000₽/yr, max 20 participants, page indexing, custom LLM models (May 13 at 8:29 PM)
1749 8:33p ✅ Pricing Updated for Pro and Max Plans on Website and Offer Documents
1750 8:34p 🔵 Anynote Monorepo Structure: Pricing and Billing File Locations Mapped
1751 " 🔵 Pricing Is Database-Driven via Prisma Seed — Stored in Kopecks
1752 " 🔵 CheckoutModal Has Hardcoded Prices — Critical Second Source of Truth
1753 8:35p 🔵 Complete Pricing Audit: Exactly 3 Files Require Manual Updates
1754 " ✅ Pro Plan Prices Updated in Prisma Seed
S438 Update AnyNote subscription plan pricing across website and legal offer — Pro: 390₽/mo 3900₽/yr; Max: 5900₽/mo 59000₽/yr, max 20 participants, page indexing, custom LLM models (May 13 at 8:37 PM)
S435 Update AnyNote subscription plan pricing across website and legal offer document — Pro: 390₽/mo, 3900₽/yr; Max: 5900₽/mo, 59000₽/yr with max 20 participants, page indexing, custom LLM models (May 13 at 8:37 PM)
S436 Update AnyNote subscription plan pricing across website and legal offer — Pro: 390₽/mo 3900₽/yr; Max: 5900₽/mo 59000₽/yr, max 20 participants, page indexing, custom LLM models (May 13 at 8:37 PM)
S439 Update AnyNote subscription plan pricing across website and legal offer — Pro: 390₽/mo 3900₽/yr; Max: 5900₽/mo 59000₽/yr, max 20 participants, page indexing, custom LLM models (May 13 at 8:43 PM)
1755 8:43p 🟣 AnyNote v1.15.0 released — pricing update deployed to production
S440 Deploy AnyNote v1.15.0 — pricing update fully through Release pipeline, Deploy workflow in progress (May 13 at 8:43 PM)
S441 Fix stale/old brand icon appearing in browser tabs — replace old icon assets with orange diamond (rhombus) (May 13 at 8:52 PM)
1756 8:58p 🔵 Anynote App Icon Files Located in Public Directory
1757 " 🔵 Anynote Uses Dual Icon System: Dynamic TSX + Static PNG/SVG Files
1758 8:59p 🔵 Two Competing Brand Icon Designs Exist in Anynote
1759 " 🔴 Brand icon updated from old triangle design to orange diamond (rhombus)
1760 9:03p 🔵 Pillow (PIL 12.2.0) used to programmatically generate favicon PNG files in anynote agents venv
1761 " 🔴 favicon.ico regenerated from updated favicon.png using Pillow
1762 " ⚖️ Pillow installed and removed transiently to avoid polluting pyproject.toml
1763 " ✅ Icon update changeset: 2 files modified, favicon.ico shrunk 75%, brand-icon.tsx simplified
1764 " 🔵 renderBrandIconArt consumed by both Next.js dynamic icon routes via ImageResponse
1765 " 🔵 Separate BrandIcon MUI component in packages/ui already uses the correct orange diamond design
1766 9:04p 🔵 BrandIcon used only in auth-header widget in source code
S442 Deploy AnyNote pricing update — v1.15.0 fully deployed to production, pricing live (May 13 at 9:05 PM)
1767 9:06p 🟣 AnyNote v1.15.0 Deploy workflow completed successfully — pricing live in production
S444 Commit and release brand icon fix — "закоммить и сделай релиз" (May 13 at 9:06 PM)
1768 9:10p ✅ Brand icon fix committed to main as 9463fc9
1769 " ✅ Brand icon fix pushed to origin/main on GitHub (AnyNoteInc/AnyNote)
1770 9:11p ✅ GitHub Actions "Release" workflow queued for commit 9463fc9
S443 Commit and release the brand icon fix — stale favicon replaced with orange diamond (May 13 at 9:11 PM)
**Investigated**: - Confirmed pre-commit state: 2 modified files (favicon.ico, brand-icon.tsx) unstaged on main
    - Verified git diff matched expected orange diamond changes
    - Checked GitHub Actions run list after push to confirm Release workflow triggered

**Learned**: - The project uses a GitHub Actions workflow named "Release" triggered on push to `main` as the deployment mechanism
    - semantic-release is expected to create a patch version tag (v1.15.1) from the `fix:` conventional commit prefix
    - A separate Deploy workflow triggers on the new tag after Release completes
    - The last two Release workflow runs (for `94fa00a` and `4cb24de`) both completed with `success`
    - Remote repository is `github.com:AnyNoteInc/AnyNote.git`

**Completed**: - Staged and committed `apps/web/src/app/favicon.ico` and `apps/web/src/lib/brand-icon.tsx` as commit `9463fc9`: "fix(web): replace stale favicon and brand icon art with orange rhombus"
    - Pushed commit `9463fc9` to `origin/main`, advancing from `341efc9`
    - GitHub Actions Release workflow run `25823707763` confirmed queued at 2026-05-13T20:11:13Z
    - Background task `bparfq69l` watching the Release workflow run for completion

**Next Steps**: - Waiting for Release workflow run `25823707763` to complete (background watch task `bparfq69l`)
    - Expected outcome: semantic-release creates tag v1.15.1, triggering Deploy workflow


Access 558k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>
