# Templates as Pages (Notion-style) — Design Spec

**Date:** 2026-06-07
**Status:** Draft for review

## Goal

Make templates **regular pages** marked with a new `Page.isTemplate` enum
(`NULL | 'WORKSPACE' | 'GLOBAL'`), Notion-style. Delete the `PageTemplate`
table entirely. A template is just a page that happens to be flagged as a
template; it gets title, icon, Yjs collaborative editing, and file handling
**for free** because it IS a page. "Use template" = deep-copy the template
page's content into a brand-new independent page (editing the template never
affects pages created from it, and vice-versa — exactly like Notion).

This replaces the current model where a `PageTemplate` row holds a content
snapshot plus an optional `backingPage`. That indirection is removed.

## Why

The current split (`PageTemplate` snapshot + optional `backingPage`) caused:
- Templates without a backing page were read-only (creator couldn't edit).
- No live Yjs editing for templates (snapshot only).
- Files embedded in templates 403'd for other users.
- Duplicate plumbing (a parallel content/contentYjs store + its own service/repo).

Making a template a page collapses all of that into the existing, battle-tested
page pipeline (Yjs server, PageRenderer, PageHeader, file access).

## Non-goals

- No change to the page editor, Yjs server protocol, or PageRenderer internals.
- Keep the marketplace UI/UX shipped earlier (cards, breadcrumb, toolbar search,
  Russian tags, content previews).
- Keep `TemplateTag` + the tag junction (curated marketplace tags) — only
  repoint the junction from `PageTemplate` to `Page`.

## Model

### Prisma changes (`packages/db/prisma/schema.prisma`)

**Add** to `Page`:
```prisma
isTemplate       PageTemplateScope?  @map("is_template")           // NULL = normal page
templateMeta     Json?               @map("template_meta")          // { description, previewColor } — optional marketplace metadata
templateKey      String?  @unique    @map("template_key") @db.Text  // stable key for seeded GLOBAL templates (upsert idempotency)
usageCount       Int      @default(0) @map("usage_count")           // how many pages were created from this template
averageRating    Float    @default(0) @map("average_rating")
ratingCount      Int      @default(0) @map("rating_count")
templateTags     PageTemplateTag[]
```
Keep `PageTemplateScope` enum (`GLOBAL | WORKSPACE`) — now reused for `isTemplate`.

`@@index([isTemplate])` and `@@index([workspaceId, isTemplate])` for marketplace
queries.

**Repoint** the tag junction `PageTemplateTag`:
```prisma
model PageTemplateTag {
  pageId String @map("page_id") @db.Uuid   // was templateId → page_templates
  tagId  String @map("tag_id") @db.Uuid
  page   Page        @relation(fields: [pageId], references: [id], onDelete: Cascade)
  tag    TemplateTag @relation(fields: [tagId], references: [id], onDelete: Cascade)
  @@id([pageId, tagId])
  @@index([tagId])
  @@map("page_template_tags")
}
```
`TemplateTag` unchanged except its back-relation now points to the new junction.

**Remove:** the `PageTemplate` model, `Page.isTemplateBacking`,
`Page.backingForTemplate`, the `TemplateBackingPage` relation, the
`PageTemplate`-related relations on `User`/`Workspace`.

**Migration** (fresh-only, per decision — no production data preservation needed):
- `ALTER TABLE pages ADD COLUMN is_template ..., template_meta jsonb, template_key text unique, usage_count int default 0, average_rating, rating_count`.
- New junction with `page_id`. Drop `page_templates`, `pages.is_template_backing`,
  old junction's `template_id`.
- Since the project reseeds (`prisma db seed`), the migration may drop+recreate
  the junction and `page_templates` without data copy. (The shared dev DB is
  reseeded; no prod data.)

### What a template page is

- A `Page` with `isTemplate IN ('WORKSPACE','GLOBAL')`.
- `WORKSPACE`: visible in that workspace's marketplace section; lives in its
  workspace. `GLOBAL`: visible to everyone in the marketplace (curated/seeded or
  user-published).
- Its `title`, `icon`, `content`, `contentYjs` are the page's own — edited live
  via the normal page route + Yjs (doc keyed by `page.id`).
- It is **excluded** from the normal sidebar tree / trash / favorites (those
  filter `isTemplate: null`, replacing today's `isTemplateBacking: false`).

## Behaviour

### Save page as template (`createFromPage` → now "publish as template")
Deep-copy the source page into a NEW page with `isTemplate` set:
1. Create a new `Page` (`isTemplate = input.scope`, `workspaceId`, copied
   `title`/`icon`/`content`/`contentYjs`, `templateMeta = { description, previewColor }`).
2. Link tags via the new `PageTemplateTag` (pageId).
3. Mark embedded files public if `scope = 'GLOBAL'` (see Files below).
The source page is untouched; the template is fully independent thereafter.

### Use template (`createPageFromTemplate`)
Deep-copy the template page into a NEW normal page (`isTemplate = null`,
`parentId` from input, fresh `contentYjs`). Increment the template page's
`usageCount`. Independent of the template thereafter (Notion semantics).

### Edit template
Just open `/marketplace/templates/{pageId}` → it renders the page via
`PageRenderer` with live Yjs, `editable = canEditTemplate(...)`. Title/icon via
the inline `PageHeader` (same component as pages). No backing page, no snapshot —
the page IS the doc.

### Access & canEdit
GLOBAL templates live in the system workspace, of which the viewing user is NOT
a member — so template reads (view, Use, marketplace listing) must NOT require
membership of the template page's workspace. The domain template methods gate by
`isTemplate` scope, not by membership of the template's host workspace:
- Marketplace listing / view / Use of a GLOBAL template: allowed for any
  authenticated user (no membership of the system workspace).
- WORKSPACE template: requires membership of that workspace (as today).
- canEdit — `GLOBAL`: creator only (`createdById === actor`); seeded templates
  have no creator → read-only/admin-managed. `WORKSPACE`: creator OR workspace
  OWNER/ADMIN. Reuse existing `canEditGlobalTemplate`/`canEditWorkspaceTemplate`.

This mirrors today's behaviour where `getBackingPage` deliberately bypassed the
page-workspace membership filter for GLOBAL templates.

### Yjs
No change to `apps/yjs`. A template page is a normal page; `canAccessPage`
already gates by workspace membership. For a `GLOBAL` template whose page is in
another workspace, editing is creator-only and the creator is a member of that
workspace, so access holds. Viewing a global template's content for "Use" is a
read (deep-copy server-side), not a Yjs connection, so no cross-workspace Yjs
access is needed.

### Files (the "files visible to everyone" requirement)
When a template page is `GLOBAL`, its embedded files must be readable by anyone:
- On publish/update of a `GLOBAL` template, scan the page content for
  `/api/files/{id}` references (image `src`, file-attachment `url`) and set those
  `File` rows `isPublic = true`.
- `apps/web/src/app/api/files/[id]/route.ts` already serves `isPublic` files with
  no auth — so this is the whole fix. (Decision: mark files public at
  publish-time; new templates only.)

## tRPC / domain surface

The `@repo/domain/templates` module is **rewritten** to operate on `Page` +
`PageTemplateTag` (no `page_templates`). Public method shapes stay close to
today so the tRPC router + UI change minimally:

- `listMarketplace({workspaceId, tagId?, query?, sectionLimit?})` → query `Page`
  WHERE `isTemplate IS NOT NULL` (+ scope/workspace/tag/query filters). Returns
  the same `MarketplaceResultDto` (tags + sections), with `previewContent` =
  page `content`.
- `listTags()` — unchanged.
- `getTemplate({templateId=pageId, workspaceId})` → page detail + `canEdit`
  (replaces `getById` + `getBackingPage`; the editor now reads the page directly:
  `page.getById` already returns `contentYjs`).
- `createFromPage({pageId, workspaceId, title, description?, icon?, scope, tagIds?})`
  → deep-copy into a template page (above).
- `createPageFromTemplate({templateId, workspaceId, parentId?, title?})`
  → deep-copy template page into a normal page; bump `usageCount`.
- `update({templateId, workspaceId, title?, icon?, description?, tagIds?})`
  → update page title/icon + `templateMeta.description` + tags. (Content edits go
  through the normal page/Yjs path, not here.)
- `delete({templateId, workspaceId})` → soft-delete the template page.

`getBackingPage`, `updateContent`, `create` (empty template), and
`template-content.ts` (`deriveTemplateContentYjs`) are **removed** — content is
the page's, edited via Yjs.

The tRPC `template` router shrinks accordingly; `appRouter` registration stays.

## UI

- **Template view route** `/marketplace/templates/[templateId]` (templateId =
  pageId): fetch the page via `page.getById`, render `PageRenderer` + inline
  `PageHeader` (title/icon editable when `canEdit`), with the existing
  single-row toolbar (breadcrumb `Маркетплейс / Шаблоны / {title}` + Использовать
  + three-dots menu). `editable = canEdit`. The current `TemplateEditor`
  collapses into "render this page like a page."
- **`/templates/[templateId]`** stays a redirect to the marketplace path.
- **Marketplace cards**: unchanged (preview from page `content`, tags, etc.).
- **Save-as-template dialog**: unchanged inputs; calls the rewritten
  `createFromPage`.
- **Sidebar/trash/favorites**: change `isTemplateBacking: false` → `isTemplate: null`.
- **"Использовать"**: unchanged (calls `createPageFromTemplate`, invalidates page
  list — already fixed).

## Seed

`packages/db/prisma/seed.ts`: `seedGlobalTemplates` now upserts **template pages**
(`Page` with `isTemplate='GLOBAL'`, `templateKey=key`, `workspaceId=null`,
content/contentYjs, `templateMeta`), then links tags via the new junction. Files:
seeded templates reference no uploaded files, so no public-file step needed there.
`seedTemplateTags` unchanged.

**GLOBAL templates need a host workspace.** `Page.workspaceId` is non-nullable
(confirmed), so GLOBAL templates can't be workspace-less. Seed them under a
dedicated **system workspace** (e.g. a stable seeded workspace
`AnyNote Templates`, slug `system-templates`). Visibility is driven entirely by
`isTemplate='GLOBAL'`, not by workspace — the system workspace is just storage,
and users never see it in their workspace switcher (it has no members, or a
single system owner). `listMarketplace` returns GLOBAL templates regardless of
the caller's workspace.

## Testing

- Domain: rewrite `templates/service.test.ts` + `helpers.test.ts` for the page-
  based model (createFromPage copies a page; createPageFromTemplate copies a
  template page + bumps usageCount; getTemplate canEdit; delete soft-deletes).
- tRPC: rewrite `template-router.test.ts` (real DB) for the new procedures.
- Page list filters: assert templates are excluded from listByWorkspace/trashed/
  favorites (`isTemplate: null`).
- Files: a GLOBAL template's referenced files become `isPublic`.
- E2E `marketplace.spec.ts`: card → template view (editable for creator) →
  Использовать → new independent page.
- Playwright manual: creator edits their template (title/icon/body persist via
  Yjs); a second user sees the template's images (public files).

## Acceptance criteria

- Templates are pages with `isTemplate` set; `PageTemplate` table is gone.
- A template's creator edits it live (title, icon, body via Yjs) like any page.
- "Use template" creates an independent page (deep copy); later edits to either
  side don't affect the other.
- GLOBAL template files are viewable by everyone.
- Templates never appear in the normal sidebar tree / trash / favorites.
- Marketplace UI (cards, previews, breadcrumb, toolbar search, RU tags) still works.
- Full gates green (check-types, lint, web/trpc/domain tests, build).

## Risks / open items (resolve in planning)

1. ~~`Page.workspaceId` nullability~~ — RESOLVED: it's non-nullable, so GLOBAL
   templates live in a seeded system workspace; visibility by `isTemplate`.
   Confirm the system workspace is hidden from users' workspace lists
   (`workspace.listMine` / switcher) during planning.
2. Deep-copy of `contentYjs`: copying the bytes is enough (a fresh page with the
   same initial Yjs state); confirm the Yjs server treats a copied doc under a new
   page id as a fresh independent doc (it keys by page id, so yes).
3. This is a delete-a-table refactor — every `PageTemplate`/`isTemplateBacking`/
   `backingPage`/`getBackingPage` reference (mapped in the blast-radius doc) must
   be migrated or removed; full `pnpm gates` must pass.
