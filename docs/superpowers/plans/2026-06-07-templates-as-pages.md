# Templates as Pages (Notion-style) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Replace the `PageTemplate` table with templates-as-pages: a template is a `Page` with `isTemplate ∈ {WORKSPACE, GLOBAL}`, edited live via the normal page/Yjs pipeline; "use" deep-copies into an independent page.

**Architecture:** Add `Page.isTemplate` (+ marketplace metadata columns) and repoint the `PageTemplateTag` junction from `PageTemplate` to `Page`. Rewrite `@repo/domain/templates` to operate on `Page` + the junction (no `page_templates`, no backing pages, no content snapshots). The tRPC `template` router shrinks to thin wrappers; the template view renders a page via `PageRenderer`+`PageHeader` with live Yjs. GLOBAL templates live in a seeded system workspace; their files are marked public on publish.

**Tech Stack:** Prisma 7, tRPC v11, Next.js 16 App Router, MUI v6, inversify DI domain, vitest.

**Reference:** `docs/superpowers/specs/2026-06-07-templates-as-pages-design.md`. Branch `feat/marketplace-templates-ux`.

---

## Conventions for every task
- Stage only the files the task names (explicit paths). NEVER `git add -A`/`git stash`. Never stage root `cl*.md`. No `--no-verify`.
- Shared dev Postgres: do NOT `migrate reset`/`db push`. If `migrate dev` hits drift, STOP and report. Prettier: semi:false, single quotes, 100 cols. End commit bodies with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Domain stays framework-agnostic (deps: `@repo/db` + `zod`, explicit `.ts` import extensions).

## File structure

**Schema/DB:** `packages/db/prisma/schema.prisma`, new migration, `packages/db/prisma/seed.ts`, `packages/db/prisma/global-templates.ts` (reuse), `packages/db/src/index.ts` (exports).

**Domain (`packages/domain/src/templates/`):** rewrite `services/templates.service.ts`, `repositories/templates.repository.ts`, `dto/templates.dto.ts`; keep `templates.helpers.ts` (canEdit), `templates.module.ts`, `templates.tokens.ts`, `index.ts`. New helper `dto`/util for content file-id extraction (pure). `packages/domain/src/pages/` — list filters change `isTemplateBacking`→`isTemplate`.

**tRPC (`packages/trpc/src/`):** `routers/template.ts` (shrink), `routers/page.ts` (list filters), remove `helpers/template-content.ts`.

**Web (`apps/web/src/`):** `components/templates/template-editor.tsx`, `template-actions-*.tsx`, `template-meta-dialog.tsx`, `marketplace/*`, route `(active)/marketplace/templates/[templateId]/page.tsx`, sidebar/trash/favorites filters, `api/files/[id]/route.ts` (unchanged — public files already served). `components/templates/types.ts`.

**Tests:** domain `test/templates/*`, trpc `test/template-router.test.ts`, web `test/save-as-template-dialog.test.tsx`, e2e `marketplace.spec.ts`.

---

## Task 1: Schema — `Page.isTemplate` + repoint tag junction + drop PageTemplate

**Files:** `packages/db/prisma/schema.prisma`, migration, `packages/db/src/index.ts`

- [ ] **Step 1: Edit `Page` model.** Add these fields (after `isTemplateBacking`, which you REMOVE):
```prisma
  isTemplate    PageTemplateScope?  @map("is_template")
  templateKey   String?             @unique @map("template_key") @db.Text
  templateMeta  Json?               @map("template_meta")
  usageCount    Int                 @default(0) @map("usage_count")
  averageRating Float               @default(0) @map("average_rating")
  ratingCount   Int                 @default(0) @map("rating_count")
  templateTags  PageTemplateTag[]
```
Remove `isTemplateBacking`, the `backingForTemplate PageTemplate? @relation("TemplateBackingPage")` line, and `@@index([isTemplateBacking])`. Add `@@index([isTemplate])` and `@@index([workspaceId, isTemplate])`.

- [ ] **Step 2: Repoint `PageTemplateTag`:**
```prisma
model PageTemplateTag {
  pageId String @map("page_id") @db.Uuid
  tagId  String @map("tag_id") @db.Uuid
  page   Page        @relation(fields: [pageId], references: [id], onDelete: Cascade)
  tag    TemplateTag @relation(fields: [tagId], references: [id], onDelete: Cascade)
  @@id([pageId, tagId])
  @@index([tagId])
  @@map("page_template_tags")
}
```
`TemplateTag.templates` relation stays (now points to this junction).

- [ ] **Step 3: Delete the `PageTemplate` model entirely.** Remove `Page`'s/`User`'s/`Workspace`'s `PageTemplate` relations: `User.createdPageTemplates`, `Workspace.pageTemplates`, and the `TemplateBackingPage` relation. Keep the `PageTemplateScope` enum (now used by `Page.isTemplate`).

- [ ] **Step 4: Create migration.**
```bash
pnpm --filter @repo/db exec prisma migrate dev --name templates_as_pages
```
Expected: drops `page_templates`, drops `pages.is_template_backing`, adds the new `pages` columns, recreates `page_template_tags` with `page_id`. "Generated Prisma Client". If drift → STOP, report.

- [ ] **Step 5: Update `packages/db/src/index.ts`** — remove any `PageTemplate` type re-export if present (keep `PageTemplateScope`). Run `pnpm --filter @repo/db check-types` → PASS.

- [ ] **Step 6: Commit**
```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations packages/db/src/index.ts
git commit -m "feat(db): Page.isTemplate; repoint template tags to pages; drop PageTemplate"
```

---

## Task 2: Domain DTOs — page-based template shapes + file-id extractor

**Files:** `packages/domain/src/templates/dto/templates.dto.ts`, new `packages/domain/src/templates/templates.files.ts`, test `packages/domain/test/templates/files.test.ts`

- [ ] **Step 1: Update DTOs.** In `templates.dto.ts`:
  - Keep input schemas `createTemplateFromPageInput`, `createPageFromTemplateInput`, `updateTemplateInput`, `deleteTemplateInput`, `getTemplateInput`, `listMarketplaceInput`, `searchTemplatesInput`, `listWorkspaceTemplatesInput` AS-IS (field names unchanged; `templateId` now = a page id).
  - REMOVE `createTemplateInput`, `updateTemplateContentInput` (no empty templates, no snapshot content edits).
  - Replace output DTOs:
    - `TemplateSummaryDto`: `{ id, workspaceId, scope, title, description, icon, type, usageCount, averageRating, ratingCount, previewColor, previewContent: Prisma.JsonValue | null, tags: TemplateTagDto[], author: TemplateAuthorDto, createdById, createdAt, updatedAt }` (id = page id; scope = `Page.isTemplate`; description/previewColor read from `templateMeta`).
    - `TemplateDetailDto`: `{ id, workspaceId, scope, title, description, icon, type, contentYjs: string | null, createdById, canEdit }` (contentYjs base64 — the page's own, for the editor).
    - Keep `MarketplaceResultDto`, `TemplateTagDto`, `TemplateAuthorDto`, `CreateTemplateResultDto`, `CreatePageFromTemplateResultDto`, `DeleteTemplateResultDto`, `SearchTemplatesResult`.
    - REMOVE `TemplateContentDto`, `TemplateBackingPageDto`.

- [ ] **Step 2: Write failing test for the file-id extractor** `packages/domain/test/templates/files.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { extractFileIdsFromContent } from '../../src/templates/templates.files'

describe('extractFileIdsFromContent', () => {
  it('collects image src and file-attachment url file ids', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'image', attrs: { src: '/api/files/11111111-1111-4111-8111-111111111111' } },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'hi' }],
        },
        {
          type: 'fileAttachment',
          attrs: { url: '/api/files/22222222-2222-4222-8222-222222222222' },
        },
        { type: 'image', attrs: { src: 'https://external.example/x.png' } },
      ],
    }
    expect(extractFileIdsFromContent(doc).sort()).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ])
  })

  it('returns [] for empty / non-doc content', () => {
    expect(extractFileIdsFromContent(null)).toEqual([])
    expect(extractFileIdsFromContent({ foo: 1 })).toEqual([])
  })
})
```
Run `pnpm --filter @repo/domain exec vitest run files` → FAIL (module missing).

- [ ] **Step 3: Implement `packages/domain/src/templates/templates.files.ts`:**
```typescript
const FILE_URL_RE = /\/api\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i

/**
 * Walk a ProseMirror/Tiptap JSON doc and collect the File ids referenced by
 * image `src` and file-attachment `url` attributes (`/api/files/{uuid}`).
 * Used to mark a published GLOBAL template's files public.
 */
export function extractFileIdsFromContent(content: unknown): string[] {
  const ids = new Set<string>()
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const n = node as { attrs?: Record<string, unknown>; content?: unknown[] }
    if (n.attrs) {
      for (const key of ['src', 'url'] as const) {
        const v = n.attrs[key]
        if (typeof v === 'string') {
          const m = FILE_URL_RE.exec(v)
          if (m?.[1]) ids.add(m[1].toLowerCase())
        }
      }
    }
    if (Array.isArray(n.content)) n.content.forEach(visit)
  }
  visit(content)
  return [...ids]
}
```
Run `pnpm --filter @repo/domain exec vitest run files` → PASS.

- [ ] **Step 4: check-types** `pnpm --filter @repo/domain check-types` → PASS (DTO consumers in repo/service will be fixed in Task 3; if this fails only inside templates module, that's expected — proceed; the module compiles after Task 3. If it fails, leave the DTO file consistent and continue — Task 3 rewrites the rest in the same pass).

- [ ] **Step 5: Commit**
```bash
git add packages/domain/src/templates/dto/templates.dto.ts packages/domain/src/templates/templates.files.ts packages/domain/test/templates/files.test.ts
git commit -m "feat(domain): page-based template DTOs + content file-id extractor"
```

---

## Task 3: Domain repository + service — page-based templates

**Files:** `packages/domain/src/templates/repositories/templates.repository.ts`, `services/templates.service.ts`, `templates.helpers.ts` (minor), tests `packages/domain/test/templates/service.test.ts`, `helpers.test.ts`

This is the core rewrite. The repo now reads/writes `Page` (filtered by `isTemplate`) + `PageTemplateTag` (pageId). The service composes them.

- [ ] **Step 1: Rewrite `templates.repository.ts`.** New method set (all on `pages`/`page_template_tags`/`template_tags`/`workspace_members`):
  - `findMembership(userId, workspaceId)` — unchanged.
  - `marketplaceCandidates({ scopeWorkspaceId, tagId?, query? })` → `Page.findMany` WHERE `isTemplate != null`, `deletedAt: null`, and `(isTemplate='GLOBAL' OR (isTemplate='WORKSPACE' AND workspaceId=scopeWorkspaceId))`, optional tag (join `templateTags`), optional title/`templateMeta` text search. Select page fields + `content` (for previewContent) + `templateTags.tag` + `createdBy` (author). Map to `TemplateSummaryDto` (`scope = page.isTemplate`, `description`/`previewColor` from `templateMeta`).
  - `listTags()` — unchanged.
  - `findTemplateDetail(templateId)` → `Page.findUnique` WHERE id, `isTemplate != null`, `deletedAt: null`; select id, workspaceId, isTemplate, title, description(from meta), icon, type, contentYjs, createdById. Returns null if not a template.
  - `findAccessiblePage(userId, pageId)` → unchanged (source page for createFromPage).
  - `createTemplatePage(actorUserId, { workspaceId, scope, title, icon, description, previewColor, content, contentYjs, templateKey? })` → `page.create` with `isTemplate: scope`, `templateMeta: { description, previewColor }`, copied content/contentYjs. Returns `{ id }`.
  - `createPageFromTemplatePage(actorUserId, { templatePageId, workspaceId, parentId, title })` → read the template page's `content`/`contentYjs`/`icon`/`type`; create a normal page (`isTemplate: null`) with a deep copy; return `{ id }`. (Use the existing pages service for linked-list insertion — see Step 2.)
  - `incrementUsage(pageId)` → `page.update` `usageCount: { increment: 1 }`.
  - `linkTags(pageId, tagIds)` → delete `pageTemplateTag` for page, recreate.
  - `countExistingTags(tagIds)` — unchanged.
  - `updateTemplatePage(actorUserId, { pageId, title?, icon?, description?, tagIds? })` → update page title/icon + merge `templateMeta.description`; relink tags if provided.
  - `softDeleteTemplatePage(pageId)` → set `deletedAt`.
  - `setFilesPublic(fileIds)` → `file.updateMany({ where: { id: { in } }, data: { isPublic: true } })`.
  - `findContentForFiles(pageId)` → read page `content` (to extract file ids).
  REMOVE all `pageTemplate`/`backingPage` methods.

- [ ] **Step 2: Rewrite `templates.service.ts`.** Public methods (keep names where the router/UI use them):
  - `listMarketplace(actor, input)` → assertMembership(actor, input.workspaceId); `repo.marketplaceCandidates({ scopeWorkspaceId: input.workspaceId, ... })`; build sections (workspace = scope WORKSPACE; popular = by usageCount; all). Returns `MarketplaceResultDto`.
  - `listTags()` — unchanged.
  - `getTemplate(actor, input)` (the tRPC `getById` procedure calls this) → load `repo.findTemplateDetail(templateId)`; notFound if null; if `scope==='WORKSPACE'` require membership of its workspaceId (GLOBAL: no workspace-membership requirement, per spec); compute `canEdit` via helpers; return `TemplateDetailDto` (with base64 contentYjs).
  - `createFromPage(actor, input)` → load source page (`findAccessiblePage`), assert it belongs to input.workspaceId, assert tags exist, permission check (canCreateWorkspaceTemplate / canCreateGlobalTemplate). In a transaction: for GLOBAL, host workspace = the system workspace id (Task 5 seeds it; resolve via `repo` lookup by slug `system-templates`); for WORKSPACE, host = input.workspaceId. `createTemplatePage(...)` copying source content/contentYjs/icon, `linkTags`, and if scope GLOBAL → extract file ids from source content and `setFilesPublic`. Return `{ id }`.
  - `createPageFromTemplate(actor, input)` → load template detail (access per getTemplate rules), `createPageFromTemplatePage(...)` (deep copy into a normal page in input.workspaceId), `incrementUsage(templatePageId)`. Return `{ id }`.
  - `update(actor, input)` → load template detail, assert canEdit, `updateTemplatePage`. If the template is GLOBAL, re-run setFilesPublic on its current content (cheap, keeps files public after content changes). Return `{ id }`.
  - `delete(actor, input)` → load template, assert canEdit, `softDeleteTemplatePage`. Return `{ count: 1 }`.
  - `search`, `listByWorkspace`, `listGlobal` — keep if the router exposes them; reimplement on `marketplaceCandidates`/`findMany` (or drop `listByWorkspace`/`listGlobal` if unused by UI — verify; the marketplace uses `listMarketplace`). REMOVE `create`, `updateContent`, `getBackingPage`, `createBackingPage`.
  Resolve the system workspace id once (helper `getSystemWorkspaceId()` querying workspace by slug `system-templates`).

- [ ] **Step 3: `templates.helpers.ts`** — keep `canEditGlobalTemplate`, `canEditWorkspaceTemplate`, `canCreateWorkspaceTemplate`, `canCreateGlobalTemplate`, sort/group/filter helpers. Remove `buildCreatePageFromTemplatePayload` if unused after the rewrite (the repo now does the copy). Keep whatever the tests cover.

- [ ] **Step 4: Rewrite `service.test.ts` + `helpers.test.ts`** to the new model (mocked repo + pages service). Cover: createFromPage copies a page into a template page (+ setFilesPublic for GLOBAL); createPageFromTemplate deep-copies + increments usage; getTemplate canEdit (creator true; GLOBAL non-creator false; WORKSPACE non-member denied); update relinks tags; delete soft-deletes. Run `pnpm --filter @repo/domain exec vitest run templates` → PASS.

- [ ] **Step 5: check-types + full domain tests.** `pnpm --filter @repo/domain check-types && pnpm --filter @repo/domain test` → PASS.

- [ ] **Step 6: Commit**
```bash
git add packages/domain/src/templates packages/domain/test/templates
git commit -m "feat(domain): rewrite templates onto pages (no PageTemplate/backing)"
```

---

## Task 4: tRPC — shrink template router + page list filters

**Files:** `packages/trpc/src/routers/template.ts`, `packages/trpc/src/routers/page.ts`, remove `packages/trpc/src/helpers/template-content.ts`, tests `packages/trpc/test/template-router.test.ts`

- [ ] **Step 1: Rewrite `routers/template.ts`** to thin wrappers over the new service: `listMarketplace`, `listTags`, `getById` (→ `domainSvc.templates.getTemplate`), `createFromPage`, `createPageFromTemplate`, `update`, `delete`. Keep the existing plan/membership guards (`requireWritableWorkspace`, `assertWorkspaceMember`) where they were. REMOVE `getBackingPage`, `updateContent`, `create`, and the `deriveTemplateContentYjs` import. Delete `packages/trpc/src/helpers/template-content.ts` (`git rm`).

- [ ] **Step 2: Page list filters** in `routers/page.ts`: replace `isTemplateBacking: false` with `isTemplate: null` in `listByWorkspace`, `listTrashed`, and the `listFavorites` page filter.

- [ ] **Step 3: Update `packages/trpc/test/template-router.test.ts`** (real DB) for the new procedures: createFromPage produces a template page (assert a `Page` with `isTemplate` set, not a `page_templates` row); createPageFromTemplate creates an independent page + bumps usageCount; listMarketplace returns it; update/delete. Seed a system workspace in the test fixture for GLOBAL cases (or test WORKSPACE scope to avoid the system-workspace dependency; cover GLOBAL in the seed/e2e).

- [ ] **Step 4: check-types + tests** `pnpm --filter @repo/trpc check-types && pnpm --filter @repo/trpc exec vitest run template-router page` → PASS.

- [ ] **Step 5: Commit**
```bash
git add packages/trpc/src/routers/template.ts packages/trpc/src/routers/page.ts packages/trpc/test/template-router.test.ts
git rm packages/trpc/src/helpers/template-content.ts
git commit -m "feat(trpc): template router over pages; page lists exclude isTemplate"
```

---

## Task 5: Seed — system workspace + global template pages

**Files:** `packages/db/prisma/seed.ts`, `packages/db/prisma/global-templates.ts` (reuse data)

- [ ] **Step 1: Seed the system workspace.** Add `seedSystemWorkspace()` upserting a workspace with a stable slug `system-templates` (name "Шаблоны AnyNote"), `createdById: null`, NO members. Return its id.

- [ ] **Step 2: Rewrite `seedGlobalTemplates()`** to upsert **template pages**: for each `GLOBAL_TEMPLATES` entry, `page.upsert({ where: { templateKey: t.key }, create/update: { workspaceId: systemWorkspaceId, isTemplate: 'GLOBAL', templateKey: t.key, title, icon, type: 'TEXT', content: t.doc, contentYjs, templateMeta: { description: t.description, previewColor: t.previewColor ?? null }, averageRating, ratingCount } })`. Then relink tags via `pageTemplateTag` (pageId). (No file-public step — seeded templates reference no uploaded files.)

- [ ] **Step 3: `seedTemplateTags()`** — unchanged (Russian names already shipped).

- [ ] **Step 4: Run seed + verify.**
```bash
pnpm --filter @repo/db exec prisma db seed
```
Verify via psql: `SELECT count(*) FROM pages WHERE is_template='GLOBAL';` ≥ 10, and the system workspace exists with 0 members.

- [ ] **Step 5: Commit**
```bash
git add packages/db/prisma/seed.ts packages/db/prisma/global-templates.ts
git commit -m "feat(db): seed system workspace + global template pages"
```

---

## Task 6: Web UI — template view renders a page; sidebar/marketplace wiring

**Files:** `apps/web/src/app/(protected)/(active)/marketplace/templates/[templateId]/page.tsx`, `components/templates/template-editor.tsx`, `template-actions-toolbar.tsx`, `template-actions-menu.tsx`, `template-meta-dialog.tsx`, `components/workspace/workspace-layout-client.tsx`, `components/templates/types.ts`, marketplace components if they referenced `backingPageId`/`previewContent`

- [ ] **Step 1: Template view route.** Rewrite to fetch the page directly:
```tsx
// resolve active workspace (redirect /workspaces/new if none)
// const detail = await trpc.template.getById({ templateId, workspaceId })  // returns {id,type,contentYjs,title,icon,canEdit,...}
// render <TemplateEditor page={{ id: detail.id, type: detail.type, contentYjs: detail.contentYjs }} user={...} editable={detail.canEdit} />
```
Use try/catch → notFound() on TRPCError NOT_FOUND (template detail throws when not a template / no access).

- [ ] **Step 2: `template-editor.tsx`** — already just renders `PageView`. Change its prop from `backingPage` to `page` (same `{id,type,contentYjs}` shape) — or keep the prop name; just ensure it passes the page through `PageView` with `editable`. No second header (toolbar handles it).

- [ ] **Step 3: `workspace-layout-client.tsx`** — the template-view breadcrumb + `TemplateActionsToolbar` already exist (from prior work). Update the `activeTemplate` query (`template.getById`) to read `canEdit`, `title`, `icon`, and pass `backingPageId` → REMOVE (no backing page); `TemplateActionsToolbar`/`TemplateActionsMenu` "Export" now uses the template page id itself (`/api/pages/${templateId}/export/md`). Update those components: replace `backingPageId` prop with `templateId` for export.

- [ ] **Step 4: `template-actions-menu.tsx` / `template-actions-toolbar.tsx`** — drop `backingPageId`; export uses `templateId` (the page id). Keep edit/delete/copy-link. The meta dialog (`template-meta-dialog.tsx`) keeps calling `template.update`.

- [ ] **Step 5: Marketplace components** — `template-card.tsx`/`template-preview.tsx` already use `previewContent`; the DTO still provides it. Verify no component references `backingPageId` or removed fields (`grep -rn "backingPageId\|getBackingPage" apps/web/src` → empty after edits).

- [ ] **Step 6: `components/templates/types.ts`** — drop any `backingPageId`/`PageTemplate` type usage; `scope` still from `PageTemplateScope`.

- [ ] **Step 7: check-types + lint + targeted tests** `pnpm --filter web check-types && pnpm --filter web lint && pnpm --filter web test` → PASS. Update `save-as-template-dialog.test.tsx` if its mock shape changed (inputs are unchanged, so likely fine).

- [ ] **Step 8: Commit**
```bash
git add apps/web/src/app apps/web/src/components/templates apps/web/src/components/workspace apps/web/src/components/marketplace
git commit -m "feat(web): template view renders the page; drop backingPage wiring"
```

---

## Task 7: E2E + full gates + manual verify

**Files:** `apps/e2e/marketplace.spec.ts`, verification only

- [ ] **Step 1: Update `marketplace.spec.ts`** — flow: card → `/marketplace/templates/{pageId}` → (creator) edit title/body → Использовать → independent `/pages/{id}`. Keep the Russian-tag assertions.

- [ ] **Step 2: Grep guard** `grep -rn "PageTemplate\b\|isTemplateBacking\|backingPage\|getBackingPage\|createBackingPage\|page_templates" packages apps --include='*.ts' --include='*.tsx' | grep -v node_modules | grep -v migrations` → only the `PageTemplateScope` enum + `PageTemplateTag` model/junction remain; no `PageTemplate` model, no `isTemplateBacking`, no backing-page refs. Fix any stragglers.

- [ ] **Step 3: Full gates.** `pnpm --filter @repo/db check-types`, `pnpm check-types`, `pnpm lint`, `pnpm --filter @repo/domain test`, `pnpm --filter @repo/trpc test`, `pnpm --filter web test`, `pnpm --filter web build` (source env: `set -a; . ./.env; set +a`). All green (agents mypy pre-existing errors excepted).

- [ ] **Step 4: Manual (Playwright).** As a user: create a page, "Save as template" (WORKSPACE) → open it from marketplace → edit title + body (persists via Yjs, independent of source) → Использовать → new independent page appears in sidebar; editing it doesn't change the template. Templates absent from sidebar tree/trash/favorites. Marketplace cards/preview/breadcrumb/search/RU-tags intact.

- [ ] **Step 5: Commit (any fixes)**
```bash
git add -- apps/e2e/marketplace.spec.ts  # + any straggler fixes, explicit paths
git commit -m "test(e2e): templates-as-pages flow; final cleanup"
```

---

## Self-review notes (for the implementer)
- **Deep copy = independence.** createFromPage and createPageFromTemplate must copy `content` + `contentYjs` bytes into a NEW page id. Yjs keys by page id, so the copy is an independent doc — never share a page id between template and instance.
- **GLOBAL access bypasses host-workspace membership** (system workspace has no members). Only WORKSPACE templates require membership. Don't reintroduce a blanket `assertMembership(actor, template.workspaceId)` for GLOBAL.
- **Files public only for GLOBAL** on publish/update (extractFileIdsFromContent → setFilesPublic). New templates only; no backfill.
- **List filters:** `isTemplate: null` everywhere `isTemplateBacking: false` was.
- **Don't** touch `apps/yjs` (templates are pages; existing auth works).
- This deletes `PageTemplate` — run the Task 7 grep guard and full `pnpm gates`.
