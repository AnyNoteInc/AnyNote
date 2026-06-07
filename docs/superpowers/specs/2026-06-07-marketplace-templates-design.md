# Marketplace & Templates Overhaul — Design

**Date:** 2026-06-07
**Status:** Approved (brainstorming) — ready for implementation plan

## Summary

Turn the existing workspace-scoped "Шаблоны" feature into a **Marketplace**: a
browseable, tagged catalogue of page templates with author, rating, install
count, and a preview image per card. Along the way, fix two long-standing
template defects and open up global-template publishing to everyone.

Six user-facing requirements drive this work:

1. The template editor must be the **same editor as a real page**. Today,
   "make template from a page" loses the page's text.
2. A template must behave like a **normal page that happens to be a template**.
3. **Any user** — regardless of site role — can create **global** templates.
4. A **Marketplace** section with a type tag; for now the only type is
   **Шаблоны** (built to extend).
5. Rename the sidebar "Шаблоны" → **"Маркетплейс"** at
   `/workspaces/{workspaceId}/marketplace`, with a header (search left,
   breadcrumb "Маркетплейс" right), a regimented tag row, and three template
   sections (Шаблоны пространства / Популярные шаблоны / Все шаблоны), each with
   a "Посмотреть все" link, 4 cards per row, each card showing a preview image
   and author / rating / install count.
6. **Regimented tags**: a fixed, seeded set (upsert), each with an icon. No
   user-created tags. The 8 tags render as the first row of the catalogue.

## Background — current state

(Verified against the codebase on 2026-06-07.)

- **`PageTemplate`** (`packages/db/prisma/schema.prisma`): `scope`
  (GLOBAL/WORKSPACE), `key` (stable seed identity), `title`, `description`,
  `icon`, free-text `category`, `type` (PageType, TEXT only in practice),
  `content` (JSON), `contentYjs` (Bytes), `usageCount`, `createdById`,
  timestamps, soft-delete. No tags table, rating, preview, or author display.
- **Template editor** (`apps/web/src/components/templates/template-editor.tsx`)
  mounts `AnyNotePlainEditor`, a **single-user** editor that reads the
  `content` JSON snapshot. Real pages mount the collaborative `AnyNoteEditor`
  (`page-renderer.tsx`) reading `contentYjs`.
- **The text-loss bug:** `createFromPage`
  (`packages/domain/src/templates/repositories/templates.repository.ts`) copies
  both `source.content` and `source.contentYjs`, but the plain editor renders
  only `content`. For a collaboratively-edited page the JSON snapshot is stale
  or empty, so the template shows nothing.
- **Global creation is blocked:** `canCreateGlobalTemplate` in
  `packages/domain/src/templates/templates.helpers.ts` always returns `false`
  (globals are seed-only).
- **Realtime pipeline** (`apps/yjs`): `onAuthenticate` derives the document
  from `documentName === pageId` and calls `canAccessPage(userId, pageId)`,
  which queries the `page` table. `onLoadDocument` / `onStoreDocument` likewise
  key on a real `Page` row. The yjs token endpoint
  (`apps/web/src/app/api/yjs/token/route.ts`) is session-based (no per-page
  input). **The collaborative editor only works for real `Page` rows.**
- **Sidebar** (`apps/web/src/components/workspace/workspace-sidebar.tsx`):
  "Шаблоны" → `/workspaces/{id}/templates`, `DashboardCustomizeIcon`.
- **Header pattern**: `apps/web/src/components/workspace/workspace-toolbar.tsx`
  renders breadcrumbs left + `rightSlot` right; reusable.
- **Search input**:
  `apps/web/src/components/templates/template-search-input.tsx`
  (`TemplateSearchInput`) is reusable.
- **Seed** (`packages/db/prisma/seed.ts`): plans upsert by `slug`; global
  templates upsert by `key` via `seedGlobalTemplates()` using
  `buildTemplateContentYjs()` from `global-templates.ts`.
- **Tests**: `packages/trpc/test/template-router.test.ts`,
  `packages/domain/test/templates/service.test.ts`,
  `packages/domain/test/templates/helpers.test.ts`. No template E2E.

## Architecture decisions

### Decision 1 — Template content lives in a real backing `Page`

To make the template editor identical to a page editor **and** fix the
text-loss bug at the root, each template points at a hidden, system-owned
`Page` that holds its content.

- Add `backingPageId Uuid?` to `PageTemplate` (FK → `Page`).
- Add `isTemplateBacking Boolean @default(false)` to `Page` (a backing page is
  excluded from the page tree, sidebar, search, trash, outbox-driven indexing,
  and any user-facing page listing).
- Creating a template (blank or from a page) creates the backing page in the
  same transaction via the existing `PageService.create`, which already accepts
  initial `content` + `contentYjs`. For "from page" we **copy the source page's
  `contentYjs` bytes directly** — the same lossless path
  `duplicatePageTx` already uses — so no JSON round-trip and no text loss.
- The template editor route renders the **unchanged `PageRenderer` /
  `AnyNoteEditor`** against `backingPageId`. Collaboration, the yjs token,
  `canAccessPage`, persistence, image upload, mentions, comments — all reused.
  **No changes to `apps/yjs`.**
- `createPageFromTemplate` copies the backing page's `contentYjs` directly into
  the newly created page (already the mechanism today).

**Rejected alternative:** extend `apps/yjs` to authenticate and persist
`template:{id}` documents (parallel `canAccessTemplate` + template
persistence). More moving parts in the realtime layer for no extra benefit; the
backing-page approach reuses the entire tested pipeline and makes "шаблон как
обычная страница" literally true.

**Access control for the backing page:** `canAccessPage` requires workspace
membership. A backing page is created in the template author's workspace even
for GLOBAL templates, so the author and that workspace's members can edit it
through the collaborative editor. Reading a GLOBAL template's content for
**instantiation** (`createPageFromTemplate`) goes through the domain/tRPC layer
(server-side, copies `contentYjs`), not the browser yjs connection, so
cross-workspace users never need a yjs grant on the backing page. This keeps
the realtime auth model unchanged.

### Decision 2 — Regimented tags via a seeded table + join

- **`TemplateTag`**: `id`, `slug @unique`, `name`, `icon` (MUI icon name),
  `position`. Seeded by `upsert` on `slug`. No create/update API.
- **`PageTemplateTag`** join (`@@id([templateId, tagId])`) for many-to-many.
- **Replace** the free-text `category` column: migrate any meaningful existing
  values to tags, then drop `category`.

The 8 seeded tags (slug → name → icon, in display order):

| position | slug             | name             | icon            |
| -------- | ---------------- | ---------------- | --------------- |
| 0        | job-search       | Job Search       | WorkOutlineIcon |
| 1        | website-building | Website Building | LaptopIcon      |
| 2        | freelance        | Freelance        | DashboardIcon   |
| 3        | student-planner  | Student Planner  | MenuBookIcon    |
| 4        | marketing        | Marketing        | CampaignIcon    |
| 5        | career-building  | Career Building  | WorkOutlineIcon |
| 6        | personal-website | Personal Website | LaptopIcon      |
| 7        | study-planner    | Study Planner    | BookmarkIcon    |

### Decision 3 — Rating & preview are display-only this pass

- Add `averageRating Float @default(0)` and `ratingCount Int @default(0)` to
  `PageTemplate`. Seeded with plausible values for global templates; **no
  user-rating write flow** (a future `TemplateRating` table can add it without
  breaking this).
- **Preview** = deterministic gradient derived from the template id + the
  template's emoji/icon centered. Add `previewColor String?` (optional manual
  override); when null, derive the gradient client-side from the id. No
  `previewImageUrl` and no screenshot pipeline this pass.
- **Author** = existing `createdById` relation. Seeded globals show a system
  author label **"AnyNote"** (createdById null → label fallback).

### Decision 4 — Anyone can publish a global template; authors own theirs

- `canCreateGlobalTemplate` allows **any authenticated workspace member**
  (no role gate). The "Save as template" dialog gains a scope toggle
  (Пространство / Глобальный) for everyone.
- Source-page read still requires membership of the page's workspace. Global
  templates store `workspaceId = null`, `createdById = author`, and a
  backing page in the author's workspace.
- **Authors may edit and delete (soft-delete) their own global templates.**
  Non-authors cannot edit or delete a global template they did not create.
  Seeded globals (createdById null) remain immutable to normal users.

## Data model changes

```prisma
model TemplateTag {
  id        String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  slug      String @unique @db.Text
  name      String @db.Text
  icon      String @db.Text   // MUI icon component name
  position  Int    @default(0)
  templates PageTemplateTag[]
  @@map("template_tags")
}

model PageTemplateTag {
  templateId String       @map("template_id") @db.Uuid
  tagId      String       @map("tag_id")      @db.Uuid
  template   PageTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  tag        TemplateTag  @relation(fields: [tagId], references: [id], onDelete: Cascade)
  @@id([templateId, tagId])
  @@index([tagId])
  @@map("page_template_tags")
}

// PageTemplate: + backingPageId, + averageRating, + ratingCount, + previewColor,
//               + tags PageTemplateTag[]; - category (dropped after migration)

// Page: + isTemplateBacking Boolean @default(false) @map("is_template_backing")
//       (filtered from all user-facing page queries; backingPage relation back to PageTemplate)
```

Migration steps: add tables/columns → backfill backing pages for existing
templates (create a hidden page per template, move `contentYjs`/`content` into
it, set `backingPageId`) → map existing `category` strings to tags where they
correspond → drop `category`.

## tRPC / domain layer

`packages/domain/src/templates/*` and `packages/trpc/src/routers/template.ts`:

- **`create` / `createFromPage`**: accept `tagIds: string[]` (validated against
  seeded tags) and `scope`; create the backing page inside the same
  `UnitOfWork` transaction (reusing `PageService.create`); allow `GLOBAL` for
  any member. "from page" copies `contentYjs` directly into the backing page.
- **`listMarketplace`** (new): returns `{ tags, workspaceTemplates,
popularTemplates, allTemplates }` in one call. Each template summary is
  enriched with `tags`, `author { name }`, `averageRating`, `ratingCount`,
  `usageCount`, and `preview` (color + icon). Accepts optional `tagId` filter
  and `query` search. "Популярные" orders by `usageCount`.
- **`listTags`** (new): seeded tags for the tag row and the picker.
- **`update`**: edit a WORKSPACE template's tags; edit/delete own GLOBAL
  template (author check).
- **`getById`**: drives the editor via `backingPageId`.

All domain methods keep the `fn(prisma, actorUserId, input)` + `DomainError`
pattern; tRPC maps via `mapDomain`. Backing-page creation and `usageCount`
increments stay inside the existing transactions.

## UI

- **Sidebar**: "Шаблоны" → **"Маркетплейс"**, href
  `/workspaces/{id}/marketplace`. Icon kept (`DashboardCustomizeIcon`) or a
  storefront icon (cosmetic).
- **Marketplace page** (`app/(protected)/workspaces/[workspaceId]/marketplace/page.tsx`):
  - Header: `TemplateSearchInput` left; breadcrumb "Маркетплейс" right (reuse
    `WorkspaceToolbar` breadcrumb/rightSlot pattern, mirrored).
  - Type selector: single "Шаблоны" chip (extensible; only option now).
  - Tag row (first row): "Все" + the 8 seeded tags with MUI icons as filter
    pills.
  - Three sections (Шаблоны пространства / Популярные шаблоны / Все шаблоны),
    each heading with a "Посмотреть все →" link on the right.
  - 4 cards per row (responsive 4 → 2 → 1). Card: gradient+icon preview, title,
    description, then `author · ★ rating · N установок`. Click → use/detail;
    "use" creates a page from the template and navigates to it.
  - "Посмотреть все" → filtered full-list view (section/tag param on the same
    route).
- **Save-as-template dialog** (`save-as-template-dialog.tsx` /
  `template-metadata-dialog.tsx`): scope toggle (Пространство/Глобальный) for
  everyone + multi-select **seeded tag** picker (icons). Removes the free-text
  category field.
- **Icons**: add to `@repo/ui` exports — `WorkOutlineIcon`, `LaptopIcon`,
  `DashboardIcon`, `MenuBookIcon`, `BookmarkIcon` (CampaignIcon already
  exported).

## Seed & migration

- `seedTemplateTags()` (upsert by `slug`) added to `seed.ts`; attach tags to
  existing global templates; seed plausible `averageRating` / `ratingCount`.
  Update the console summary line.
- Migration as described under Data model changes (backfill backing pages, map
  category → tags, drop `category`).

## Testing

- Update the 3 existing template tests for new signatures (`tagIds`, scope,
  backing page).
- Add domain tests: global-create allowed for any member; author edit/delete
  of own global; tag validation rejects unknown tag ids; backing-page created
  on template create; "from page" copies `contentYjs` (text not lost).
- Add a tRPC test for `listMarketplace` (sections, tag filter, search,
  enrichment).
- Add one Playwright spec: sidebar → Маркетплейс → tag filter → use a template
  → lands on a new page with the template's text present.
- Full `pnpm gates`.

## Out of scope (future)

- User-submitted ratings (`TemplateRating` table + write flow).
- Real screenshot previews / uploaded preview images.
- Non-template marketplace types (integrations, etc.) — the type selector is
  built to extend but only "Шаблоны" ships now.
