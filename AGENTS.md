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

# [anynote] recent context, 2026-05-12 8:36pm GMT+1

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (18,939t read) | 1,077,862t work | 98% savings

### May 12, 2026
1587 6:35p 🔵 columnLayout node programmatically injected via pmRoot.editor.view.dispatch in Playwright
1588 " 🔵 Critical: Tiptap NodeViewContent renders an extra data-node-view-content wrapper that breaks the CSS Grid
1589 " 🔴 CSS Grid moved to data-node-view-content-react wrapper: columns now render horizontally
1590 6:36p 🔴 Columns render horizontally: CSS grid fix to [data-node-view-content-react] confirmed working via Playwright
1591 6:50p 🔵 Image placeholder column layout regression reported by user
1592 7:02p 🔴 Drop indicator switched from Decoration.widget to Decoration.node to fix full-page bar height
S399 Fix full-page drop indicator height when dragging image placeholder; remove controls from columnLayout column component (May 12 at 7:03 PM)
1593 7:16p ✅ Removed ColumnLayoutNodeView React component from columnLayout TipTap extension
1594 " ✅ Deleted ColumnLayoutNodeView component file and confirmed no stale references
1595 " 🔵 CSS drop indicator class names are stale after Decoration.widget→Decoration.node migration
1596 7:17p ✅ content.css updated for Decoration.node drop targets and NodeView-free column grid
1597 " 🔵 One test failing after CSS/decoration migration — lint and types pass
1598 " 🔵 content.test.ts still asserts old .column-drop-indicator CSS class names after migration to .column-drop-target
1599 " 🔴 Updated content.test.ts CSS assertions to match renamed .column-drop-target class
1600 " 🔵 Playwright verification confirms drop indicator height matches image placeholder exactly
1601 7:18p 🔵 Playwright confirms column layout renders as CSS grid without React NodeView
1602 " 🔴 Committed be22c0b: drop indicator scoped to target box, ColumnLayoutNodeView removed
1603 " 🟣 Column creation zone algorithm redesigned: outside-bounds X triggers LEFT/RIGHT, 100% width gives TOP/BOTTOM
1604 " 🔄 Added findBestCellInLayout() and findHoverTarget() to drop-placement.ts, replacing inline dragover logic
S405 User asked if it's possible to revert to TipTap's native drag & drop given the current custom drop-placement override — answered with full revert instructions and compatibility analysis (May 12 at 7:18 PM)
1605 7:28p ⚖️ User questioned feasibility of reverting to TipTap native drag &amp; drop
S403 Code review of current branch (page reminders feature) — bugs, inconsistencies, and simplification opportunities in anynote monorepo (May 12 at 7:28 PM)
S400 Redesign column drop zone mechanism: outside-bounds X triggers LEFT/RIGHT column creation; full 100% width inside block triggers TOP/BOTTOM reorder (May 12 at 7:28 PM)
S404 User asked: "you overrode tiptap drag & drop, is it possible to switch to tiptap with this configuration?" — answered with explanation of new zone algorithm; commit 6617dbf shipped (May 12 at 7:28 PM)
S406 User asked if the custom TipTap drag & drop override can be reverted — answered yes with full revert steps and TipTap upgrade compatibility analysis (May 12 at 7:33 PM)
S401 Code review of current branch changes - checking for bugs, inconsistencies, and simplification opportunities in page reminders feature (May 12 at 7:33 PM)
S402 Code review of current branch (page reminders feature) — checking for bugs, inconsistencies, and simplification opportunities (May 12 at 7:33 PM)
1606 7:42p 🔵 feat/tiptap-column-layout Branch State Discovered
1607 " 🔵 Full Branch Diff Scope: 60 Files, 3178 Insertions Across Multiple Features
1609 " 🟣 drop-placement.ts: ProseMirror Plugin for Column Drag-and-Drop
1610 " 🟣 column-layout Schema, Dissolve Logic, and Client Extension
1611 " 🟣 DragHandle and DragHandleMenu Extended for Row/Cell Context
1612 " 🟣 Column Layout and Drop Indicator CSS Added to content.css
S407 Refactor drop-placement.ts plugin (feat/tiptap-column-layout branch) for quality, efficiency, and code reuse — /simplify task (May 12 at 7:42 PM)
1608 7:44p 🔵 feat/tiptap-column-layout branch scope: 28 commits, 60 files vs main
1613 " 🔵 Full session diff read for /simplify review — 606 lines, 9 files
1614 " 🟣 drop-placement.zones.ts: Pure Zone Computation with Unit Tests
1615 " 🟣 Column Layout Unit Tests Cover Schema Validation and Dissolve Logic
1616 " 🟣 Extension Registration and ResizableImage Fix for Column Drop Passthrough
1617 " 🟣 E2E Tests for Column Layout: Two Golden-Path Playwright Specs
1618 7:45p 🔵 Non-Editor Branch Changes Are Exclusively Prettier Reformatting
1635 7:50p 🔵 Two drag-and-drop bugs reported for drop-placement plugin
1636 " 🔴 Added bubbleCellToLayoutForReorder to fix H1 drag above/between columnLayouts
1619 7:52p 🔵 Active branch: feat/tiptap-column-layout with column drag-and-drop work
1620 " 🔵 feat/tiptap-column-layout branch scope: 60 files, 3205 insertions across multiple features
1621 " 🔵 drop-placement.ts: 324-line ProseMirror plugin implementing column drag-and-drop
1622 " 🔵 Trailing blank line at EOF in content.css detected by git diff --check
1623 7:54p 🔵 column-layout.schema.ts: dual export pattern for SSR vs client use
1624 " 🔵 column-layout.dissolve.ts: appendTransaction cleanup for empty/single-column layouts
1625 " 🔵 EditorDragHandle updated to track column context for cell-aware menu actions
1626 " 🔵 DragHandleMenu extended with cell-specific actions: unwrap cell, delete cell, delete row
1627 " 🔵 content.css: column layout CSS uses position:relative on ProseMirror children for drop indicator anchoring
1628 7:55p 🔵 column-layout.ts: thin wrapper that extends ColumnLayoutSchema with dissolve appendTransaction
1629 " 🔴 resizable-image.tsx handleDrop: only intercepts OS file drops, lets in-editor drags bubble to DropPlacement
1630 " 🟣 BlockIndexAttributes extended to emit nested data-block-index for columnLayout cells
1631 " 🔵 All notification/trpc/web non-editor diffs are pure formatting — no logic changes found
1632 7:56p 🟣 page-columns.spec.ts: 2 Playwright e2e tests covering column creation and vertical reorder
1633 " 🔵 No dependency or config file changes in branch — column layout uses existing Tiptap packages
1634 " ⚖️ Column layout spec deviates from plan: NodeViews/row handles not implemented, using drag-handle extension instead
S408 Fix two drag-and-drop bugs: H1 cannot be dragged above a columnLayout, and H1 cannot be dragged between two columnLayouts (May 12 at 8:02 PM)
**Investigated**: User reported two specific failing drag scenarios in the column layout feature on feat/tiptap-column-layout branch. Both involve dragging a top-level block to a position adjacent to (above or between) columnLayout nodes.

**Learned**: - Bug case 1: Dragging H1 above a columnLayout (TOP zone) does not execute the drop
- Bug case 2: Dragging H1 between two adjacent columnLayout nodes does not work — inter-layout gap position is not resolved
- Both failures involve top-level block placement at boundaries relative to columnLayout nodes
- findHoverTarget Y-scan fallback and refineLayoutToCell may be implicated — when cursor is above the first layout or in the gap between two layouts, the target resolution may fail or return wrong result

**Completed**: Previous session: Drop-placement refactor committed as 11f383a "refactor(editor): tighten drop-placement plugin":
- 60Hz no-op guard (samePlacement + setPlacement) — Playwright-verified: 4/5 identical dragovers short-circuit
- Removed unused cellIndex from HoverTarget
- Extracted MAX_COLUMNS=3 constant
- Factored refineLayoutToCell, insertContent, replaceContent, computeReorderPos helpers
- 30/30 tests, lint clean, types clean

Current session: New bug report received, fix work not yet started.

**Next Steps**: Debug and fix the two drag-and-drop failures: (1) H1 drag above columnLayout not working, (2) H1 drag between two columnLayouts not working. Root cause likely in findHoverTarget Y-scan logic or computeReorderPos for TOP zone on a columnLayout target.


Access 1078k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>
