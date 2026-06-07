# Marketplace & Templates Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the workspace-scoped "Шаблоны" feature into a tagged "Маркетплейс": templates edit through the real collaborative page editor (fixing the text-loss bug), carry seeded tags/rating/author/preview, and are browseable in a sectioned catalogue; anyone can create global templates, with scope-tiered edit/delete.

**Architecture:** Each template gains a hidden **backing `Page`** that holds its content, so the template editor mounts the unchanged collaborative `AnyNoteEditor` and nothing in `apps/yjs` changes. Tags are a seeded `TemplateTag` table + `PageTemplateTag` join (replacing free-text `category`). A new `listMarketplace` tRPC procedure returns the three catalogue sections enriched with tags/author/rating/installs. Permission logic stays in `@repo/domain` as pure helpers + `assertTemplateWriteAccess`.

**Tech Stack:** Prisma 7, tRPC v11 + Zod, inversify DI domain layer, Next.js 16 App Router + MUI v6, Vitest (trpc/domain), Playwright (e2e). Reference spec: `docs/superpowers/specs/2026-06-07-marketplace-templates-design.md`.

**Conventions (apply to every task):**

- Prettier: `semi: false`, single quotes, trailing commas, 100-col. Run `pnpm format` before commits if unsure.
- `@repo/domain` files use explicit `.ts` import extensions and depend only on `@repo/db` + `zod`.
- Commit after each task (Conventional Commits, scope = package). Husky runs gates on commit — do **not** `--no-verify`.
- After Prisma schema edits: `pnpm --filter @repo/db prisma:generate` before type-checking consumers.

---

## File map

**Schema / DB**

- Modify `packages/db/prisma/schema.prisma` — `TemplateTag`, `PageTemplateTag`, `PageTemplate` (+backingPageId/averageRating/ratingCount/previewColor, −category), `Page.isTemplateBacking`.
- Create migration via `prisma migrate dev`.
- Modify `packages/db/prisma/seed.ts` — `seedTemplateTags()`, attach tags + ratings to globals.
- Create `packages/db/prisma/template-tags.ts` — the 8 seeded tags.
- Modify `packages/db/prisma/global-templates.ts` — add `tagSlugs` per template.

**Domain (`packages/domain/src/templates/`)**

- Modify `templates.helpers.ts` — `canCreateGlobalTemplate` → true; add `canEditGlobalTemplate`, `canEditWorkspaceTemplate`.
- Modify `dto/templates.dto.ts` — `tagIds` on create inputs; tag/rating/author/preview on summary DTOs; marketplace result DTO.
- Modify `repositories/templates.repository.ts` — backing-page creation, tag writes, enriched projections, marketplace queries, tag listing.
- Modify `services/templates.service.ts` — backing page on create, `assertTemplateWriteAccess`, `listMarketplace`, `listTags`.
- Modify `index.ts` — export new inputs/DTOs.
- Test: `packages/domain/test/templates/helpers.test.ts`, `service.test.ts`.

**tRPC (`packages/trpc/src/`)**

- Modify `routers/template.ts` — `tagIds`, `listMarketplace`, `listTags`, write-access via domain.
- Test: `packages/trpc/test/template-router.test.ts`.

**Web (`apps/web/src/`)**

- Modify `components/workspace/workspace-sidebar.tsx` — rename + route.
- Create `app/(protected)/workspaces/[workspaceId]/marketplace/page.tsx`.
- Create `components/marketplace/` — `marketplace-page.tsx`, `template-card.tsx`, `tag-row.tsx`, `marketplace-header.tsx`, `tag-icon.tsx`.
- Modify `components/templates/save-as-template-dialog.tsx` + `template-metadata-dialog.tsx` — scope toggle + tag picker.
- Modify `packages/ui/src/components/index.ts` — export new icons.

**E2E**

- Create `apps/e2e/marketplace.spec.ts`.

---

## Task 1: Add new MUI icons to `@repo/ui`

**Files:**

- Modify: `packages/ui/src/components/index.ts`

- [ ] **Step 1: Add icon re-exports**

Find the block of `export { default as CampaignIcon } from '@mui/icons-material/Campaign'`-style lines in `packages/ui/src/components/index.ts`. Add these five lines alongside them (alphabetical grouping is fine; `CampaignIcon` already exists — do not duplicate it):

```ts
export { default as WorkOutlineIcon } from '@mui/icons-material/WorkOutline'
export { default as LaptopIcon } from '@mui/icons-material/Laptop'
export { default as DashboardIcon } from '@mui/icons-material/Dashboard'
export { default as MenuBookIcon } from '@mui/icons-material/MenuBook'
export { default as BookmarkIcon } from '@mui/icons-material/Bookmark'
```

- [ ] **Step 2: Verify exports compile**

Run: `pnpm --filter @repo/ui check-types`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/index.ts
git commit -m "feat(ui): export marketplace tag icons"
```

---

## Task 2: Prisma schema — tags, backing page, rating/preview

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add `isTemplateBacking` to `Page`**

In the `Page` model (around line 376), add this field near the other scalar flags and a back-relation to the template:

```prisma
  isTemplateBacking Boolean @default(false) @map("is_template_backing")
  backingForTemplate PageTemplate? @relation("TemplateBackingPage")
```

Also add an index for the filter at the bottom of the model (before `@@map`):

```prisma
  @@index([isTemplateBacking])
```

- [ ] **Step 2: Add `TemplateTag` and `PageTemplateTag` models**

Add after the `PageTemplate` model:

```prisma
model TemplateTag {
  id        String            @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  slug      String            @unique @db.Text
  name      String            @db.Text
  icon      String            @db.Text
  position  Int               @default(0)
  templates PageTemplateTag[]

  @@map("template_tags")
}

model PageTemplateTag {
  templateId String       @map("template_id") @db.Uuid
  tagId      String       @map("tag_id") @db.Uuid
  template   PageTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  tag        TemplateTag  @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@id([templateId, tagId])
  @@index([tagId])
  @@map("page_template_tags")
}
```

- [ ] **Step 3: Extend `PageTemplate`**

In the `PageTemplate` model: **remove** the `category String? @db.Text` line, and add these fields:

```prisma
  backingPageId String?           @unique @map("backing_page_id") @db.Uuid
  averageRating Float             @default(0) @map("average_rating")
  ratingCount   Int               @default(0) @map("rating_count")
  previewColor  String?           @map("preview_color") @db.Text
```

Add the relations (the workspace relation already exists; add these three). The
`createdBy` relation is **new** — the model currently has only the scalar
`createdById` — and the marketplace author display depends on it:

```prisma
  backingPage Page?             @relation("TemplateBackingPage", fields: [backingPageId], references: [id], onDelete: SetNull)
  createdBy   User?             @relation("PageTemplateCreatedBy", fields: [createdById], references: [id])
  tags        PageTemplateTag[]
```

On the `User` model, add the matching back-relation (find the `User` model and
add this line among its other relations):

```prisma
  createdPageTemplates PageTemplate[] @relation("PageTemplateCreatedBy")
```

> A named relation (`"PageTemplateCreatedBy"`) avoids ambiguity with the
> existing `updatedById` scalar (which stays a plain scalar, no relation).

- [ ] **Step 4: Generate migration**

First ensure local infra is up: `docker compose up -d`. Then:

Run: `pnpm --filter @repo/db exec prisma migrate dev --name marketplace_templates`
Expected: migration file created under `packages/db/prisma/migrations/`, client regenerated, exit 0.

> If `prisma migrate dev` warns about dropping `category` (data loss), that is expected — `category` is intentionally removed. Confirm to proceed. No production data exists locally.

- [ ] **Step 5: Verify client types**

Run: `pnpm --filter @repo/db check-types`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): template tags, backing page, rating/preview columns"
```

---

## Task 3: Seed template tags

**Files:**

- Create: `packages/db/prisma/template-tags.ts`
- Modify: `packages/db/prisma/seed.ts`

- [ ] **Step 1: Create the tag seed data**

Create `packages/db/prisma/template-tags.ts`:

```ts
/** Regimented marketplace tags. Seeded by upsert on `slug`; never user-created. */
export interface TemplateTagSeed {
  slug: string
  name: string
  icon: string // MUI icon component name exported from @repo/ui
  position: number
}

export const TEMPLATE_TAGS: TemplateTagSeed[] = [
  { slug: 'job-search', name: 'Job Search', icon: 'WorkOutlineIcon', position: 0 },
  { slug: 'website-building', name: 'Website Building', icon: 'LaptopIcon', position: 1 },
  { slug: 'freelance', name: 'Freelance', icon: 'DashboardIcon', position: 2 },
  { slug: 'student-planner', name: 'Student Planner', icon: 'MenuBookIcon', position: 3 },
  { slug: 'marketing', name: 'Marketing', icon: 'CampaignIcon', position: 4 },
  { slug: 'career-building', name: 'Career Building', icon: 'WorkOutlineIcon', position: 5 },
  { slug: 'personal-website', name: 'Personal Website', icon: 'LaptopIcon', position: 6 },
  { slug: 'study-planner', name: 'Study Planner', icon: 'BookmarkIcon', position: 7 },
]
```

- [ ] **Step 2: Add `seedTemplateTags()` and call it**

In `packages/db/prisma/seed.ts`: add an import near the top:

```ts
import { TEMPLATE_TAGS } from './template-tags'
```

Add this function (place it next to `seedGlobalTemplates`):

```ts
async function seedTemplateTags() {
  for (const t of TEMPLATE_TAGS) {
    await prisma.templateTag.upsert({
      where: { slug: t.slug },
      create: { slug: t.slug, name: t.name, icon: t.icon, position: t.position },
      update: { name: t.name, icon: t.icon, position: t.position },
    })
  }
}
```

In `main()`, call it **before** `seedGlobalTemplates()` (templates attach tags by slug, so tags must exist first):

```ts
await seedTemplateTags()
await seedGlobalTemplates()
```

- [ ] **Step 3: Run seed and verify tags exist**

Run: `pnpm --filter @repo/db exec prisma db seed`
Expected: exit 0, no error.

Run:

```bash
pnpm --filter @repo/db exec prisma db execute --stdin <<'SQL'
SELECT count(*) FROM template_tags;
SQL
```

Expected: count = 8.

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/template-tags.ts packages/db/prisma/seed.ts
git commit -m "feat(db): seed regimented marketplace tags"
```

---

## Task 4: Attach tags + ratings to global templates in seed

**Files:**

- Modify: `packages/db/prisma/global-templates.ts`
- Modify: `packages/db/prisma/seed.ts`

- [ ] **Step 1: Add `tagSlugs` + `rating` to each global template seed**

In `packages/db/prisma/global-templates.ts`, extend the `GlobalTemplateSeed` interface (currently around line 60):

```ts
export interface GlobalTemplateSeed {
  key: string
  title: string
  description: string
  icon: string
  category: string
  tagSlugs: string[]
  averageRating: number
  ratingCount: number
  doc: Doc
}
```

For **every** entry in `GLOBAL_TEMPLATES`, add `tagSlugs`, `averageRating`, `ratingCount`. Pick tags from the 8 slugs (`job-search`, `website-building`, `freelance`, `student-planner`, `marketing`, `career-building`, `personal-website`, `study-planner`). Example for the `meeting-notes` entry:

```ts
  {
    key: 'meeting-notes',
    title: 'Заметки встречи',
    description: 'Повестка, участники, решения и задачи по итогам встречи.',
    icon: '📝',
    category: 'Работа',
    tagSlugs: ['career-building'],
    averageRating: 4.8,
    ratingCount: 124,
    doc: { /* unchanged */ },
  },
```

Keep `category` in this seed file for now (it's just source data; the column is gone, so the seed writer below will not write it). Give each remaining template at least one plausible tag and a rating between 4.2–4.9 with a ratingCount 20–300.

- [ ] **Step 2: Write tags + rating when seeding globals**

In `packages/db/prisma/seed.ts`, update `seedGlobalTemplates()`. The current body upserts by `key` with a `data` object that includes `category`. Replace `category` usage and add tag linking + rating. New version:

```ts
async function seedGlobalTemplates() {
  // Map tag slug → id once (tags are already seeded).
  const tags = await prisma.templateTag.findMany({ select: { id: true, slug: true } })
  const tagIdBySlug = new Map(tags.map((t) => [t.slug, t.id]))

  for (const t of GLOBAL_TEMPLATES) {
    const contentYjs = Buffer.from(buildTemplateContentYjs(t.doc))
    const data = {
      title: t.title,
      description: t.description,
      icon: t.icon,
      type: 'TEXT' as const,
      content: t.doc as unknown as Prisma.InputJsonValue,
      contentYjs,
      averageRating: t.averageRating,
      ratingCount: t.ratingCount,
      deletedAt: null,
    }
    const tpl = await prisma.pageTemplate.upsert({
      where: { key: t.key },
      create: { key: t.key, scope: 'GLOBAL', workspaceId: null, ...data },
      update: data,
      select: { id: true },
    })
    // Re-sync tag links idempotently: delete existing, recreate from seed.
    await prisma.pageTemplateTag.deleteMany({ where: { templateId: tpl.id } })
    const tagIds = t.tagSlugs
      .map((slug) => tagIdBySlug.get(slug))
      .filter((id): id is string => Boolean(id))
    if (tagIds.length > 0) {
      await prisma.pageTemplateTag.createMany({
        data: tagIds.map((tagId) => ({ templateId: tpl.id, tagId })),
        skipDuplicates: true,
      })
    }
  }
}
```

> Note: seeded GLOBAL templates do **not** get a backing page here (they already carry `contentYjs`, which is what instantiation copies). Backing pages are only needed for the in-app collaborative editor, which never edits seeded globals (createdById null → immutable).

- [ ] **Step 3: Re-run seed and verify links**

Run: `pnpm --filter @repo/db exec prisma db seed`
Expected: exit 0.

Run:

```bash
pnpm --filter @repo/db exec prisma db execute --stdin <<'SQL'
SELECT count(*) FROM page_template_tags;
SQL
```

Expected: count ≥ number of global templates (≥ 1 per template).

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/global-templates.ts packages/db/prisma/seed.ts
git commit -m "feat(db): tag and rate seeded global templates"
```

---

## Task 5: Domain permission helpers (TDD)

**Files:**

- Modify: `packages/domain/src/templates/templates.helpers.ts`
- Test: `packages/domain/test/templates/helpers.test.ts`

- [ ] **Step 1: Write failing tests for the permission matrix**

In `packages/domain/test/templates/helpers.test.ts`, add (keep existing imports; add the new helper names to the import from `templates.helpers.ts`):

```ts
import {
  canCreateGlobalTemplate,
  canEditGlobalTemplate,
  canEditWorkspaceTemplate,
} from '../../src/templates/templates.helpers.ts'

describe('template permissions', () => {
  it('lets any authenticated member create global templates', () => {
    expect(canCreateGlobalTemplate({ role: 'VIEWER' })).toBe(true)
    expect(canCreateGlobalTemplate({ role: null })).toBe(true)
  })

  it('global edit: creator only', () => {
    expect(canEditGlobalTemplate({ actorUserId: 'u1', createdById: 'u1' })).toBe(true)
    expect(canEditGlobalTemplate({ actorUserId: 'u2', createdById: 'u1' })).toBe(false)
    // seeded globals have no creator → nobody can edit
    expect(canEditGlobalTemplate({ actorUserId: 'u1', createdById: null })).toBe(false)
  })

  it('workspace edit: owner, admin, or creator', () => {
    const base = { actorUserId: 'u2', createdById: 'u1' }
    expect(canEditWorkspaceTemplate({ ...base, role: 'OWNER' })).toBe(true)
    expect(canEditWorkspaceTemplate({ ...base, role: 'ADMIN' })).toBe(true)
    expect(canEditWorkspaceTemplate({ ...base, role: 'EDITOR' })).toBe(false)
    expect(canEditWorkspaceTemplate({ actorUserId: 'u1', createdById: 'u1', role: 'EDITOR' })).toBe(
      true,
    )
    expect(canEditWorkspaceTemplate({ ...base, role: null })).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm --filter @repo/domain test -- helpers`
Expected: FAIL — `canEditGlobalTemplate`/`canEditWorkspaceTemplate` are not exported.

- [ ] **Step 3: Implement the helpers**

In `packages/domain/src/templates/templates.helpers.ts`: change `canCreateGlobalTemplate` to return `true`, and add the two edit helpers:

```ts
/**
 * Any authenticated workspace member may publish a GLOBAL template. (AnyNote has
 * no global-admin role; visibility is the only privilege a global confers.)
 */
export function canCreateGlobalTemplate(_args: { role?: string | null }): boolean {
  return true
}

/** GLOBAL template edit/delete is restricted to its creator. */
export function canEditGlobalTemplate(args: {
  actorUserId: string
  createdById: string | null
}): boolean {
  return args.createdById != null && args.createdById === args.actorUserId
}

/** WORKSPACE template edit/delete: workspace owner, admin, or the creator. */
const MANAGER_ROLES = new Set(['OWNER', 'ADMIN'])
export function canEditWorkspaceTemplate(args: {
  actorUserId: string
  createdById: string | null
  role: string | null | undefined
}): boolean {
  if (args.createdById != null && args.createdById === args.actorUserId) return true
  return args.role != null && MANAGER_ROLES.has(args.role)
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm --filter @repo/domain test -- helpers`
Expected: PASS (including pre-existing helper tests).

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/templates/templates.helpers.ts packages/domain/test/templates/helpers.test.ts
git commit -m "feat(domain): scope-tiered template edit permissions"
```

---

## Task 6: Domain DTOs — tagIds, enriched summary, marketplace result

**Files:**

- Modify: `packages/domain/src/templates/dto/templates.dto.ts`
- Modify: `packages/domain/src/templates/index.ts`

- [ ] **Step 1: Add `tagIds` to the create inputs and drop `category`**

In `dto/templates.dto.ts`:

- In `createTemplateFromPageInput`: remove the `category` line; add `tagIds: z.array(z.string().uuid()).max(10).optional(),`.
- In `createTemplateInput`: remove `category`; add `tagIds: z.array(z.string().uuid()).max(10).optional(),`.
- In `updateTemplateInput`: remove `category`; add `tagIds: z.array(z.string().uuid()).max(10).optional(),`.

- [ ] **Step 2: Add tag/author/rating/preview to `TemplateSummaryDto` and define new DTOs**

Add a tag DTO and extend the summary (remove the `category: string | null` field from `TemplateSummaryDto` and `TemplateDetailDto`):

```ts
export interface TemplateTagDto {
  id: string
  slug: string
  name: string
  icon: string
  position: number
}

export interface TemplateAuthorDto {
  name: string // display name; "AnyNote" for seeded globals (createdById null)
}
```

Add to `TemplateSummaryDto` (after `usageCount`):

```ts
  averageRating: number
  ratingCount: number
  previewColor: string | null
  tags: TemplateTagDto[]
  author: TemplateAuthorDto
  createdById: string | null
```

Add the marketplace result + inputs:

```ts
export const listMarketplaceInput = z.object({
  workspaceId: z.string().uuid(),
  tagId: z.string().uuid().nullable().optional(),
  query: z.string().max(200).optional(),
  sectionLimit: z.number().int().min(1).max(50).optional(),
})
export type ListMarketplaceInput = z.infer<typeof listMarketplaceInput>

export interface MarketplaceResultDto {
  tags: TemplateTagDto[]
  workspaceTemplates: TemplateSummaryDto[]
  popularTemplates: TemplateSummaryDto[]
  allTemplates: TemplateSummaryDto[]
}

export const listTagsInput = z.object({}).optional()
```

Also add `backingPageId: string | null` to `TemplateDetailDto`.

- [ ] **Step 3: Export from index**

In `packages/domain/src/templates/index.ts`, ensure the new inputs/types are re-exported (follow the existing export pattern — it likely does `export * from './dto/templates.dto.ts'`; if so, nothing to add. Otherwise add `listMarketplaceInput`, `listTagsInput`, and the new types).

- [ ] **Step 4: Type-check (expect downstream breakage, that's fine for now)**

Run: `pnpm --filter @repo/domain check-types`
Expected: errors in `repositories/templates.repository.ts` and `services/templates.service.ts` (they still reference `category` / lack new methods). These are fixed in Tasks 7–8. **Do not commit yet** — proceed to Task 7 and commit DTO+repo+service together once the package compiles.

> Rationale: DTO, repository, and service are tightly coupled here; splitting their commits would leave the package un-compilable mid-way. Tasks 6–8 form one compile unit, committed at the end of Task 8.

---

## Task 7: Repository — backing page, tags, enriched + marketplace queries

**Files:**

- Modify: `packages/domain/src/templates/repositories/templates.repository.ts`

- [ ] **Step 1: Update `SUMMARY_SELECT` and add tag/author includes**

Replace `category: true` in `SUMMARY_SELECT` with the new fields and a tags/creator include. Since Prisma `select` and relation includes mix, restructure the summary read to use `select` with nested relations:

```ts
const SUMMARY_SELECT = {
  id: true,
  workspaceId: true,
  scope: true,
  title: true,
  description: true,
  icon: true,
  type: true,
  usageCount: true,
  averageRating: true,
  ratingCount: true,
  previewColor: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { firstName: true, lastName: true } },
  tags: {
    select: { tag: { select: { id: true, slug: true, name: true, icon: true, position: true } } },
  },
} as const
```

> The `createdBy` relation was added in Task 2 (named relation
> `"PageTemplateCreatedBy"`), so `createdBy: { select: { firstName: true, lastName: true } }`
> resolves. If `prisma generate` reports `createdBy` unknown, re-run
> `pnpm --filter @repo/db prisma:generate` and confirm Task 2 Step 3 landed.

- [ ] **Step 2: Add a row→DTO mapper for enriched summaries**

Add a private mapper (rows from `SUMMARY_SELECT` → `TemplateSummaryDto`), handling the author label:

```ts
function toSummary(row: {
  id: string
  workspaceId: string | null
  scope: PageTemplateScope
  title: string
  description: string | null
  icon: string | null
  type: PageType
  usageCount: number
  averageRating: number
  ratingCount: number
  previewColor: string | null
  createdById: string | null
  createdAt: Date
  updatedAt: Date
  createdBy: { firstName: string | null; lastName: string | null } | null
  tags: { tag: { id: string; slug: string; name: string; icon: string; position: number } }[]
}): TemplateSummaryDto {
  const fullName = [row.createdBy?.firstName, row.createdBy?.lastName]
    .filter(Boolean)
    .join(' ')
    .trim()
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    scope: row.scope,
    title: row.title,
    description: row.description,
    icon: row.icon,
    type: row.type,
    usageCount: row.usageCount,
    averageRating: row.averageRating,
    ratingCount: row.ratingCount,
    previewColor: row.previewColor,
    createdById: row.createdById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    tags: row.tags.map((t) => t.tag).sort((a, b) => a.position - b.position),
    author: { name: fullName || 'AnyNote' },
  }
}
```

Import `PageType` (already imported) and the new DTO types at the top.

- [ ] **Step 3: Route existing list/search reads through the mapper**

In `searchCandidates`, `listByWorkspace`, `listGlobal`: keep the `where`/`orderBy`, change `select: SUMMARY_SELECT` reads to map results with `toSummary`. e.g.:

```ts
async listByWorkspace(workspaceId: string): Promise<TemplateSummaryDto[]> {
  const rows = await this.uow.client().pageTemplate.findMany({
    where: { scope: PageTemplateScope.WORKSPACE, workspaceId, deletedAt: null },
    orderBy: [{ usageCount: 'desc' }, { createdAt: 'desc' }],
    select: SUMMARY_SELECT,
  })
  return rows.map(toSummary)
}
```

Apply the same `.map(toSummary)` to `searchCandidates` and `listGlobal`.

- [ ] **Step 4: Add marketplace + tag queries**

```ts
async listTags(): Promise<TemplateTagDto[]> {
  return this.uow.client().templateTag.findMany({
    orderBy: { position: 'asc' },
    select: { id: true, slug: true, name: true, icon: true, position: true },
  })
}

/** Candidate rows for the marketplace: this workspace's templates + all globals,
 *  optionally filtered by tag and/or text. Sectioning is done in the service. */
async marketplaceCandidates(args: {
  workspaceId: string
  tagId?: string | null
  query?: string
}): Promise<TemplateSummaryDto[]> {
  const trimmed = (args.query ?? '').trim()
  const where: Prisma.PageTemplateWhereInput = {
    deletedAt: null,
    AND: [
      {
        OR: [
          { scope: PageTemplateScope.WORKSPACE, workspaceId: args.workspaceId },
          { scope: PageTemplateScope.GLOBAL },
        ],
      },
      ...(args.tagId ? [{ tags: { some: { tagId: args.tagId } } }] : []),
      ...(trimmed
        ? [
            {
              OR: [
                { title: { contains: trimmed, mode: 'insensitive' as const } },
                { description: { contains: trimmed, mode: 'insensitive' as const } },
              ],
            },
          ]
        : []),
    ],
  }
  const rows = await this.uow.client().pageTemplate.findMany({
    where,
    orderBy: [{ usageCount: 'desc' }, { createdAt: 'desc' }],
    select: SUMMARY_SELECT,
  })
  return rows.map(toSummary)
}
```

- [ ] **Step 5: Backing-page-aware create methods**

The service (Task 8) creates the backing page via `PageService` and passes its id in. Update `create` and `createFromPage` to accept a `backingPageId` and write tag links. Replace their bodies:

```ts
async createFromPage(
  actorUserId: string,
  input: CreateTemplateFromPageInput,
  source: SourcePageDto,
  backingPageId: string,
): Promise<{ id: string }> {
  const created = await this.uow.client().pageTemplate.create({
    data: {
      scope: input.scope,
      workspaceId: input.scope === PageTemplateScope.WORKSPACE ? input.workspaceId : null,
      title: input.title,
      description: input.description ?? null,
      icon: input.icon !== undefined ? input.icon : source.icon,
      type: source.type,
      content: source.content ?? undefined,
      contentYjs: source.contentYjs ?? undefined,
      backingPageId,
      createdById: actorUserId,
      updatedById: actorUserId,
    },
    select: { id: true },
  })
  await this.linkTags(created.id, input.tagIds ?? [])
  return created
}

async create(
  actorUserId: string,
  input: CreateTemplateInput,
  backingPageId: string,
): Promise<{ id: string }> {
  const created = await this.uow.client().pageTemplate.create({
    data: {
      scope: PageTemplateScope.WORKSPACE,
      workspaceId: input.workspaceId,
      title: input.title,
      description: input.description ?? null,
      icon: input.icon ?? null,
      type: PageType.TEXT,
      backingPageId,
      createdById: actorUserId,
      updatedById: actorUserId,
    },
    select: { id: true },
  })
  await this.linkTags(created.id, input.tagIds ?? [])
  return created
}

private async linkTags(templateId: string, tagIds: string[]): Promise<void> {
  await this.uow.client().pageTemplateTag.deleteMany({ where: { templateId } })
  if (tagIds.length === 0) return
  await this.uow.client().pageTemplateTag.createMany({
    data: tagIds.map((tagId) => ({ templateId, tagId })),
    skipDuplicates: true,
  })
}

/** Validate that every id refers to a seeded tag; returns the valid subset count. */
async countExistingTags(tagIds: string[]): Promise<number> {
  if (tagIds.length === 0) return 0
  return this.uow.client().templateTag.count({ where: { id: { in: tagIds } } })
}
```

- [ ] **Step 6: Update `update`, `findForWrite`, `findDetail` for new fields**

- `update`: remove `category` handling; add tag re-link when `input.tagIds` is provided (call `this.linkTags`). Keep title/description/icon.
- `findForWrite`: add `createdById: true` to the select (the service needs it for `assertTemplateWriteAccess`):

```ts
async findForWrite(templateId: string): Promise<{
  id: string
  scope: PageTemplateScope
  workspaceId: string | null
  createdById: string | null
} | null> {
  return this.uow.client().pageTemplate.findFirst({
    where: { id: templateId, deletedAt: null },
    select: { id: true, scope: true, workspaceId: true, createdById: true },
  })
}
```

- `findDetail`: remove `category`, add `backingPageId: true`. Update the `update` method's `data` to drop `category`.

- [ ] **Step 7: Type-check (will still fail until service is updated)**

Run: `pnpm --filter @repo/domain check-types`
Expected: remaining errors only in `services/templates.service.ts`. Proceed to Task 8.

---

## Task 8: Service — backing page on create, write access, marketplace

**Files:**

- Modify: `packages/domain/src/templates/services/templates.service.ts`

- [ ] **Step 1: Import new helpers + DTOs**

Update imports to include `canEditGlobalTemplate`, `canEditWorkspaceTemplate`, `canCreateGlobalTemplate`, `canCreateWorkspaceTemplate`, and the new DTO types (`ListMarketplaceInput`, `MarketplaceResultDto`, `TemplateTagDto`).

- [ ] **Step 2: Add a helper to create the backing page**

Add a private method that creates a hidden backing page via `PageService` and returns its id. The backing page lives in the template's workspace (the actor's workspace for both scopes):

```ts
private async createBackingPage(
  actorUserId: string,
  workspaceId: string,
  source?: { content?: unknown; contentYjs?: Uint8Array<ArrayBuffer> | null; icon?: string | null },
): Promise<string> {
  const created = await this.pages.create(actorUserId, {
    workspaceId,
    parentId: null,
    title: 'Шаблон',
    type: 'TEXT',
    isTemplateBacking: true,
    content: (source?.content as never) ?? undefined,
    contentYjs: source?.contentYjs ?? undefined,
  })
  return created.id
}
```

> This requires `PageService.create` (and its `CreatePageExtra`) to accept `isTemplateBacking`. Add `isTemplateBacking?: boolean` to `CreatePageExtra` in `packages/domain/src/pages/dto/pages.dto.ts` and write it in `createPageTx` (`packages/domain/src/pages/repositories/pages.repository.ts`) — set `isTemplateBacking: input.isTemplateBacking ?? false` in the `page.create` data. Backing pages must also be excluded from outbox indexing: in `createPageTx`, skip the `outbox_events` insert when `input.isTemplateBacking` is true (wrap the existing enqueue in `if (!input.isTemplateBacking)`).

- [ ] **Step 3: Wire backing page + tag validation into `create` / `createFromPage`**

```ts
async create(actorUserId: string, input: CreateTemplateInput): Promise<CreateTemplateResultDto> {
  await this.assertMembership(actorUserId, input.workspaceId)
  await this.assertTagsExist(input.tagIds ?? [])
  return this.uow.transaction(async () => {
    const backingPageId = await this.createBackingPage(actorUserId, input.workspaceId)
    return this.repo.create(actorUserId, input, backingPageId)
  })
}

async createFromPage(
  actorUserId: string,
  input: CreateTemplateFromPageInput,
): Promise<CreateTemplateResultDto> {
  const page = await this.repo.findAccessiblePage(actorUserId, input.pageId)
  if (!page) throw notFound('Страница не найдена')
  if (page.workspaceId !== input.workspaceId) {
    throw badRequest('Страница не принадлежит этому воркспейсу')
  }
  await this.assertTagsExist(input.tagIds ?? [])

  const member = await this.repo.findMembership(actorUserId, input.workspaceId)
  const isPageCreator = page.createdById === actorUserId
  if (input.scope === 'GLOBAL') {
    if (!canCreateGlobalTemplate({ role: member?.role })) {
      throw forbidden('Недостаточно прав для создания шаблона')
    }
  } else if (!canCreateWorkspaceTemplate({ isPageCreator, role: member?.role })) {
    throw forbidden('Недостаточно прав для создания шаблона')
  }

  return this.uow.transaction(async () => {
    const backingPageId = await this.createBackingPage(actorUserId, input.workspaceId, {
      content: page.content,
      contentYjs: page.contentYjs,
      icon: page.icon,
    })
    return this.repo.createFromPage(actorUserId, input, page, backingPageId)
  })
}

private async assertTagsExist(tagIds: string[]): Promise<void> {
  if (tagIds.length === 0) return
  const found = await this.repo.countExistingTags(tagIds)
  if (found !== tagIds.length) throw badRequest('Указан несуществующий тег')
}
```

- [ ] **Step 4: Replace `assertWriteAccess` with `assertTemplateWriteAccess`**

```ts
private async assertTemplateWriteAccess(
  actorUserId: string,
  template: { scope: PageTemplateScope; workspaceId: string | null; createdById: string | null },
  workspaceId: string,
): Promise<void> {
  if (template.scope === 'GLOBAL') {
    if (!canEditGlobalTemplate({ actorUserId, createdById: template.createdById })) {
      throw forbidden('Изменять глобальный шаблон может только его создатель')
    }
    return
  }
  if (template.workspaceId !== workspaceId) throw notFound('Шаблон не найден')
  const member = await this.repo.findMembership(actorUserId, workspaceId)
  if (
    !canEditWorkspaceTemplate({
      actorUserId,
      createdById: template.createdById,
      role: member?.role,
    })
  ) {
    throw forbidden('Недостаточно прав для управления шаблоном')
  }
}
```

Update `update`, `updateContent`, and `delete` to call `assertTemplateWriteAccess` instead of `assertWriteAccess`. (The `findForWrite` row now includes `createdById`, so pass the whole row.)

- [ ] **Step 5: Add `listMarketplace` and `listTags`**

```ts
async listTags(): Promise<TemplateTagDto[]> {
  return this.repo.listTags()
}

async listMarketplace(
  actorUserId: string,
  input: ListMarketplaceInput,
): Promise<MarketplaceResultDto> {
  await this.assertMembership(actorUserId, input.workspaceId)
  const limit = input.sectionLimit ?? 8
  const [tags, candidates] = await Promise.all([
    this.repo.listTags(),
    this.repo.marketplaceCandidates({
      workspaceId: input.workspaceId,
      tagId: input.tagId,
      query: input.query,
    }),
  ])
  const workspaceTemplates = candidates
    .filter((t) => t.scope === 'WORKSPACE')
    .slice(0, limit)
  const popularTemplates = [...candidates]
    .sort((a, b) => b.usageCount - a.usageCount)
    .slice(0, limit)
  const allTemplates = candidates.slice(0, limit)
  return { tags, workspaceTemplates, popularTemplates, allTemplates }
}
```

- [ ] **Step 6: Type-check + run domain tests**

Run: `pnpm --filter @repo/domain check-types`
Expected: PASS.

Run: `pnpm --filter @repo/domain test`
Expected: existing service tests may fail where they assert old signatures (`category`, `assertWriteAccess` behavior). Update those tests to the new shape: pass `tagIds` where relevant, mock `repo.create`/`createFromPage` with the extra `backingPageId` arg, mock `pages.create` to return `{ id: 'backing-1' }`, and add cases for `assertTemplateWriteAccess` (global creator-only; workspace owner/admin/creator). Re-run until PASS.

- [ ] **Step 7: Commit Tasks 6–8 together**

```bash
git add packages/domain/src/templates packages/domain/src/pages packages/domain/test/templates
git commit -m "feat(domain): backing-page templates, tags, marketplace listing, tiered write access"
```

---

## Task 9: tRPC router — tagIds, listMarketplace, listTags, write access

**Files:**

- Modify: `packages/trpc/src/routers/template.ts`
- Test: `packages/trpc/test/template-router.test.ts`

- [ ] **Step 1: Write failing integration tests**

In `packages/trpc/test/template-router.test.ts`, add tests (use the existing test harness/fixtures in that file for creating a workspace, user, membership, and a page). Add:

```ts
it('listMarketplace returns sections and seeded tags', async () => {
  const caller = await callerFor(user.id) // use existing helper pattern in this file
  const res = await caller.template.listMarketplace({ workspaceId })
  expect(res.tags.length).toBe(8)
  expect(Array.isArray(res.workspaceTemplates)).toBe(true)
  expect(Array.isArray(res.popularTemplates)).toBe(true)
  expect(Array.isArray(res.allTemplates)).toBe(true)
})

it('createFromPage with a tag attaches it and shows in marketplace', async () => {
  const caller = await callerFor(user.id)
  const tags = await caller.template.listTags()
  const tagId = tags[0]!.id
  await caller.template.createFromPage({
    pageId,
    workspaceId,
    title: 'Шаблон из теста',
    scope: 'WORKSPACE',
    tagIds: [tagId],
  })
  const res = await caller.template.listMarketplace({ workspaceId, tagId })
  const found = res.allTemplates.find((t) => t.title === 'Шаблон из теста')
  expect(found).toBeTruthy()
  expect(found!.tags.map((t) => t.id)).toContain(tagId)
})

it('non-creator non-admin cannot edit a workspace template', async () => {
  // user (EDITOR, non-creator) created by `otherUser`; expect FORBIDDEN
  const owner = await callerFor(otherUser.id)
  const { id } = await owner.template.create({ workspaceId, title: 'Чужой' })
  const editor = await callerFor(editorUser.id) // a non-creator EDITOR member
  await expect(
    editor.template.update({ templateId: id, workspaceId, title: 'X' }),
  ).rejects.toThrow()
})
```

> Match the file's existing helper names. If it builds a caller differently (e.g. `appRouter.createCaller(ctx)`), mirror that. Seed tags must be present in the test DB — if the test DB is migrated-but-unseeded, seed tags in a `beforeAll` by inserting via `prisma.templateTag.createMany` from `TEMPLATE_TAGS`, or call the seed. Make the fixture self-contained (see memory: fresh-CI DBs differ from local).

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm --filter @repo/trpc test -- template-router`
Expected: FAIL — `listMarketplace`/`listTags` procedures don't exist.

- [ ] **Step 3: Add procedures + thread `tagIds`**

In `packages/trpc/src/routers/template.ts`, add:

```ts
  listMarketplace: protectedProcedure
    .input(domain.listMarketplaceInput)
    .query(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      return mapDomain(() => domainSvc.templates.listMarketplace(ctx.user.id, input))
    }),

  listTags: protectedProcedure.query(async () => {
    return mapDomain(() => domainSvc.templates.listTags())
  }),
```

The `create`, `createFromPage`, `update` procedures already pass `input` straight through, so `tagIds` flows automatically once the domain inputs accept it (Task 6). No body changes needed there beyond confirming `domain.createTemplateInput` etc. now include `tagIds`.

Export `listMarketplaceInput` from `@repo/domain` is already done in Task 6; confirm `domain.listMarketplaceInput` resolves.

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm --filter @repo/trpc test -- template-router`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/routers/template.ts packages/trpc/test/template-router.test.ts
git commit -m "feat(trpc): marketplace listing, tag listing, tagIds on template create"
```

---

## Task 10: Backing-page filtering across page reads

**Files:**

- Modify: page read queries that must exclude backing pages (grep to find them).

- [ ] **Step 1: Find every user-facing page query**

Run:

```bash
grep -rn "deletedAt: null" packages/domain/src/pages packages/trpc/src | grep -i "page"
```

And inspect page tree / sidebar / search / trash queries in `packages/domain/src/pages/repositories/pages.repository.ts` and any page list in `packages/trpc/src`.

- [ ] **Step 2: Add `isTemplateBacking: false` to those `where` clauses**

For each query that lists pages for the tree, sidebar, workspace page list, search, and trash, add `isTemplateBacking: false` to the `where`. Backing pages must never appear in: page tree, favorites, search, trash, recent. (The collaborative editor opens a backing page directly by id via `canAccessPage`, which does **not** filter on this flag — that's intentional, so the template editor still works.)

Example (page tree list):

```ts
where: { workspaceId, deletedAt: null, isTemplateBacking: false, /* …rest… */ }
```

- [ ] **Step 3: Verify no backing page leaks into the tree**

Run: `pnpm --filter @repo/domain test` and `pnpm --filter @repo/trpc test`
Expected: PASS. Add a focused test if a page-list test fixture exists: create a backing page, assert it's absent from the tree/search result.

- [ ] **Step 4: Commit**

```bash
git add packages/domain/src/pages packages/trpc/src
git commit -m "fix(domain): hide template backing pages from page listings"
```

---

## Task 11: Sidebar rename → Маркетплейс

**Files:**

- Modify: `apps/web/src/components/workspace/workspace-sidebar.tsx`

- [ ] **Step 1: Rename the nav item and repoint the route**

Find the `NavItem` with `label="Шаблоны"` (around line 230). Change it to:

```tsx
<NavItem
  icon={<DashboardCustomizeIcon sx={{ fontSize: 16 }} />}
  label="Маркетплейс"
  href={`/workspaces/${workspace.id}/marketplace`}
  matchPrefix={`/workspaces/${workspace.id}/marketplace`}
  pathname={pathname}
/>
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter web check-types`
Expected: PASS (route is added in Task 12; Next route types are generated at build, not blocking here).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/workspace/workspace-sidebar.tsx
git commit -m "feat(web): rename sidebar Шаблоны → Маркетплейс"
```

---

## Task 12: Marketplace UI components

**Files:**

- Create: `apps/web/src/components/marketplace/tag-icon.tsx`
- Create: `apps/web/src/components/marketplace/tag-row.tsx`
- Create: `apps/web/src/components/marketplace/template-card.tsx`
- Create: `apps/web/src/components/marketplace/marketplace-header.tsx`
- Create: `apps/web/src/components/marketplace/marketplace-page.tsx`
- Create: `apps/web/src/app/(protected)/workspaces/[workspaceId]/marketplace/page.tsx`

- [ ] **Step 1: Tag icon mapper**

Create `apps/web/src/components/marketplace/tag-icon.tsx`:

```tsx
'use client'

import {
  BookmarkIcon,
  CampaignIcon,
  DashboardIcon,
  LaptopIcon,
  MenuBookIcon,
  WorkOutlineIcon,
} from '@repo/ui/components'

const ICONS: Record<
  string,
  React.ComponentType<{ sx?: object; fontSize?: 'small' | 'inherit' }>
> = {
  WorkOutlineIcon,
  LaptopIcon,
  DashboardIcon,
  MenuBookIcon,
  CampaignIcon,
  BookmarkIcon,
}

export function TagIcon({
  name,
  ...rest
}: {
  name: string
  sx?: object
  fontSize?: 'small' | 'inherit'
}) {
  const Cmp = ICONS[name]
  return Cmp ? <Cmp {...rest} /> : null
}
```

- [ ] **Step 2: Tag row**

Create `apps/web/src/components/marketplace/tag-row.tsx`:

```tsx
'use client'

import { Chip, Stack } from '@repo/ui/components'

import { TagIcon } from './tag-icon'

type Tag = { id: string; name: string; icon: string }

export function TagRow({
  tags,
  activeTagId,
  onSelect,
}: {
  tags: Tag[]
  activeTagId: string | null
  onSelect: (tagId: string | null) => void
}) {
  return (
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 3 }}>
      <Chip
        label="Все"
        clickable
        color={activeTagId === null ? 'primary' : 'default'}
        variant={activeTagId === null ? 'filled' : 'outlined'}
        onClick={() => onSelect(null)}
      />
      {tags.map((t) => (
        <Chip
          key={t.id}
          icon={<TagIcon name={t.icon} fontSize="small" />}
          label={t.name}
          clickable
          color={activeTagId === t.id ? 'primary' : 'default'}
          variant={activeTagId === t.id ? 'filled' : 'outlined'}
          onClick={() => onSelect(t.id)}
        />
      ))}
    </Stack>
  )
}
```

> Confirm `Chip` and `Stack` are exported from `@repo/ui/components`; if `Chip` is missing, add `export { default as Chip } from '@mui/material/Chip'` to `packages/ui/src/components/index.ts`.

- [ ] **Step 3: Template card with gradient preview**

Create `apps/web/src/components/marketplace/template-card.tsx`:

```tsx
'use client'

import { Box, Card, CardActionArea, Stack, StarIcon, Typography } from '@repo/ui/components'

type CardTemplate = {
  id: string
  title: string
  description: string | null
  icon: string | null
  previewColor: string | null
  averageRating: number
  usageCount: number
  author: { name: string }
}

/** Deterministic gradient from the template id (used when previewColor is null). */
function gradientFor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) % 360
  const h2 = (hash + 40) % 360
  return `linear-gradient(135deg, hsl(${hash} 70% 92%), hsl(${h2} 70% 85%))`
}

export function TemplateCard({ template, onUse }: { template: CardTemplate; onUse: () => void }) {
  const bg = template.previewColor ?? gradientFor(template.id)
  return (
    <Card variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
      <CardActionArea onClick={onUse}>
        <Box
          sx={{
            height: 104,
            background: bg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 30,
          }}
        >
          {template.icon ?? '📄'}
        </Box>
        <Box sx={{ p: 1.5 }}>
          <Typography variant="subtitle2" noWrap>
            {template.title}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', height: 32, overflow: 'hidden' }}
          >
            {template.description ?? ''}
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: 90 }}>
              {template.author.name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              ·
            </Typography>
            <Stack direction="row" spacing={0.25} alignItems="center">
              <StarIcon sx={{ fontSize: 13, color: 'warning.main' }} />
              <Typography variant="caption" color="text.secondary">
                {template.averageRating.toFixed(1)}
              </Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              ·
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {template.usageCount} установок
            </Typography>
          </Stack>
        </Box>
      </CardActionArea>
    </Card>
  )
}
```

> Confirm `Card`, `CardActionArea`, `StarIcon` are exported from `@repo/ui/components`; add re-exports if missing (`@mui/material/Card`, `@mui/material/CardActionArea`, `@mui/icons-material/Star`).

- [ ] **Step 4: Header (search left, breadcrumb right)**

Create `apps/web/src/components/marketplace/marketplace-header.tsx`:

```tsx
'use client'

import { Box, Stack, Typography } from '@repo/ui/components'

import { TemplateSearchInput } from '@/components/templates/template-search-input'

export function MarketplaceHeader({
  query,
  onQuery,
}: {
  query: string
  onQuery: (v: string) => void
}) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      justifyContent="space-between"
      spacing={2}
      sx={{ mb: 3 }}
    >
      <Box sx={{ flex: 1, maxWidth: 420 }}>
        <TemplateSearchInput value={query} onChange={onQuery} />
      </Box>
      <Typography variant="body2" color="text.secondary">
        Маркетплейс
      </Typography>
    </Stack>
  )
}
```

- [ ] **Step 5: Marketplace page client component**

Create `apps/web/src/components/marketplace/marketplace-page.tsx`:

```tsx
'use client'

import { useState } from 'react'

import { useRouter } from 'next/navigation'

import { Box, Button, Stack, Typography } from '@repo/ui/components'

import { trpc } from '@/trpc/client'

import { MarketplaceHeader } from './marketplace-header'
import { TagRow } from './tag-row'
import { TemplateCard } from './template-card'

function Section({
  title,
  templates,
  onUse,
}: {
  title: string
  templates: Parameters<typeof TemplateCard>[0]['template'][]
  onUse: (id: string) => void
}) {
  if (templates.length === 0) return null
  return (
    <Box sx={{ mb: 4 }}>
      <Stack direction="row" alignItems="baseline" justifyContent="space-between" sx={{ mb: 1.5 }}>
        <Typography variant="h6">{title}</Typography>
        <Button size="small" variant="text">
          Посмотреть все
        </Button>
      </Stack>
      <Box
        sx={{
          display: 'grid',
          gap: 1.5,
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(4, 1fr)' },
        }}
      >
        {templates.map((t) => (
          <TemplateCard key={t.id} template={t} onUse={() => onUse(t.id)} />
        ))}
      </Box>
    </Box>
  )
}

export function MarketplacePage({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [tagId, setTagId] = useState<string | null>(null)

  const market = trpc.template.listMarketplace.useQuery({
    workspaceId,
    tagId,
    query: query.trim() || undefined,
  })
  const useTemplate = trpc.template.createPageFromTemplate.useMutation({
    onSuccess: (res) => router.push(`/workspaces/${workspaceId}/pages/${res.id}`),
  })

  const onUse = (templateId: string) =>
    useTemplate.mutate({ templateId, workspaceId, parentId: null })

  const data = market.data

  return (
    <Box sx={{ maxWidth: 1100, mx: 'auto', p: { xs: 2, md: 4 } }}>
      <MarketplaceHeader query={query} onQuery={setQuery} />
      <TagRow tags={data?.tags ?? []} activeTagId={tagId} onSelect={setTagId} />
      {market.isLoading ? (
        <Typography color="text.secondary">Загрузка…</Typography>
      ) : (
        <>
          <Section
            title="Шаблоны пространства"
            templates={data?.workspaceTemplates ?? []}
            onUse={onUse}
          />
          <Section
            title="Популярные шаблоны"
            templates={data?.popularTemplates ?? []}
            onUse={onUse}
          />
          <Section title="Все шаблоны" templates={data?.allTemplates ?? []} onUse={onUse} />
        </>
      )}
    </Box>
  )
}
```

- [ ] **Step 6: Route (Server Component)**

Create `apps/web/src/app/(protected)/workspaces/[workspaceId]/marketplace/page.tsx`:

```tsx
import { MarketplacePage } from '@/components/marketplace/marketplace-page'

export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  return <MarketplacePage workspaceId={workspaceId} />
}
```

> Next.js 16: `params` is a Promise — await it (matches the pattern in sibling routes like `pages/[pageId]/page.tsx`; verify and mirror that file's exact signature).

- [ ] **Step 7: Type-check + run the route**

Run: `pnpm --filter web check-types`
Expected: PASS.

Then (with `.env` sourced into the shell — see memory on worktree env): `pnpm --filter web dev`, and curl the route to ensure no RSC prop error:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/workspaces/<a-real-workspace-id>/marketplace
```

Expected: `200` (or `307` to sign-in if unauthenticated — not a `500`).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/marketplace apps/web/src/app/\(protected\)/workspaces/\[workspaceId\]/marketplace packages/ui/src/components/index.ts
git commit -m "feat(web): marketplace page with tag row, sections, and template cards"
```

---

## Task 13: Save-as-template dialog — scope toggle + tag picker

**Files:**

- Modify: `apps/web/src/components/templates/save-as-template-dialog.tsx`
- Modify: `apps/web/src/components/templates/template-metadata-dialog.tsx`

- [ ] **Step 1: Replace category field with a seeded-tag multi-select and enable the GLOBAL scope option**

In `save-as-template-dialog.tsx`:

- Remove the `category` state and the "Категория" `TextField`.
- Add `const tagsQuery = trpc.template.listTags.useQuery()` and a `selectedTagIds` state (`string[]`).
- Render the tags as toggleable `Chip`s (reuse `TagIcon`), toggling membership in `selectedTagIds`.
- Make the scope `RadioGroup` controlled (`scope` state, default `'WORKSPACE'`); **remove** the `disabled` + tooltip on the GLOBAL option so anyone can pick it.
- In `handleSubmit`, pass `tagIds: selectedTagIds` and `scope` (drop `category`).

```tsx
const [scope, setScope] = useState<'WORKSPACE' | 'GLOBAL'>('WORKSPACE')
const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
const tagsQuery = trpc.template.listTags.useQuery()

const toggleTag = (id: string) =>
  setSelectedTagIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

// in handleSubmit:
createTemplate.mutate({
  pageId,
  workspaceId,
  title: trimmedTitle,
  description: description.trim() || undefined,
  icon,
  scope,
  tagIds: selectedTagIds,
})
```

Tag picker block (replaces the Категория TextField):

```tsx
<Box>
  <FormLabel sx={{ fontSize: 13 }}>Теги</FormLabel>
  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
    {(tagsQuery.data ?? []).map((t) => (
      <Chip
        key={t.id}
        icon={<TagIcon name={t.icon} fontSize="small" />}
        label={t.name}
        size="small"
        clickable
        color={selectedTagIds.includes(t.id) ? 'primary' : 'default'}
        variant={selectedTagIds.includes(t.id) ? 'filled' : 'outlined'}
        onClick={() => toggleTag(t.id)}
      />
    ))}
  </Stack>
</Box>
```

Controlled scope group:

```tsx
<RadioGroup value={scope} onChange={(e) => setScope(e.target.value as 'WORKSPACE' | 'GLOBAL')}>
  <FormControlLabel
    value="WORKSPACE"
    control={<Radio size="small" />}
    label="Только это пространство"
  />
  <FormControlLabel
    value="GLOBAL"
    control={<Radio size="small" />}
    label="Глобальный (виден всем)"
  />
</RadioGroup>
```

Add imports: `Chip` from `@repo/ui/components`, `TagIcon` from `@/components/marketplace/tag-icon`. Reset `scope`/`selectedTagIds` in the `useEffect` that re-seeds on open.

- [ ] **Step 2: Apply the same tag picker to `template-metadata-dialog.tsx`**

That dialog drives `template.create` and `template.update`. Replace its `category` field with the same tag-chip picker, pass `tagIds`. For edit mode, initialize `selectedTagIds` from the template's existing tags (the metadata dialog receives an `EditableTemplate`; extend it to include `tags: { id }[]` sourced from the list query — `listByWorkspace`/`listMarketplace` summaries now include `tags`).

- [ ] **Step 3: Type-check**

Run: `pnpm --filter web check-types`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/templates/save-as-template-dialog.tsx apps/web/src/components/templates/template-metadata-dialog.tsx
git commit -m "feat(web): tag picker and global scope in save-as-template"
```

---

## Task 14: Template editor uses the real collaborative editor

**Files:**

- Modify: `apps/web/src/app/(protected)/workspaces/[workspaceId]/templates/[templateId]/page.tsx`
- Modify: `apps/web/src/components/templates/template-editor.tsx`

- [ ] **Step 1: Decide the editor surface**

The template's content lives in its backing page. The cleanest path: the template editor route loads the template (`getById` now returns `backingPageId`) and renders the **same page surface** used for a normal page, pointed at `backingPageId`.

Find how a normal page route renders its editor (`app/(protected)/workspaces/[workspaceId]/pages/[pageId]/page.tsx` → likely a `PageView`/`PageRenderer` wrapper that fetches the page by id and mounts `AnyNoteEditor` with the yjs token). Reuse that wrapper.

- [ ] **Step 2: Rewrite `template-editor.tsx` to mount the page surface for `backingPageId`**

Replace the `AnyNotePlainEditor` usage. New approach:

```tsx
'use client'

import { useRouter } from 'next/navigation'

import {
  ArrowBackIcon,
  Box,
  Button,
  CircularProgress,
  Stack,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'
import { PageView } from '@/components/page/page-view' // the same wrapper a normal page route uses

type Props = { workspaceId: string; templateId: string }

export function TemplateEditor({ workspaceId, templateId }: Props) {
  const router = useRouter()
  const detail = trpc.template.getById.useQuery({ templateId, workspaceId })

  if (detail.isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
        <CircularProgress />
      </Box>
    )
  }
  const data = detail.data
  if (detail.isError || !data || !data.backingPageId) {
    return (
      <Box sx={{ p: 4 }}>
        <Typography color="error">Шаблон не найден.</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ p: 1, borderBottom: '1px solid', borderColor: 'divider' }}
      >
        <Button
          size="small"
          startIcon={<ArrowBackIcon />}
          onClick={() => router.push(`/workspaces/${workspaceId}/marketplace`)}
        >
          К маркетплейсу
        </Button>
        <Box sx={{ fontSize: 20 }}>{data.icon ?? '📄'}</Box>
        <Typography variant="subtitle1" noWrap>
          {data.title}
        </Typography>
      </Stack>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <PageView workspaceId={workspaceId} pageId={data.backingPageId} />
      </Box>
    </Box>
  )
}
```

> `PageView` is a placeholder for whatever wrapper component the normal page route uses to fetch a page by id and render `PageRenderer`/`AnyNoteEditor` with the yjs token. Inspect `pages/[pageId]/page.tsx`, identify that component (it may be inline in the route — if so, extract a small `PageView({ workspaceId, pageId })` client wrapper and use it from both the page route and here, to stay DRY). The backing page's `type` is `TEXT`, so it dispatches to `AnyNoteEditor`. Auto-save and collaboration are handled by that pipeline — **delete the old manual Save button / `updateContent` flow.**

- [ ] **Step 3: Remove the now-unused plain-editor path**

`template.updateContent` and `AnyNotePlainEditor` are no longer used by the template editor. Leave `updateContent` in the router (harmless) **or** remove it if no caller remains — grep first:

```bash
grep -rn "updateContent" apps/web/src packages/trpc/src
```

If the template-editor was the only caller, remove the procedure, the domain method, and `deriveTemplateContentYjs` + its test, in a follow-up cleanup commit. Otherwise leave them.

- [ ] **Step 4: Verify the editor mounts and text persists**

Run `pnpm --filter web dev` (with `.env` sourced). Manually: create a page, add text, "Сохранить как шаблон", open the template from the marketplace/editor route — confirm the text appears in the collaborative editor (this is the core bug being fixed). Then "use" the template from the marketplace and confirm the new page has the text.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/templates/template-editor.tsx apps/web/src/app/\(protected\)/workspaces/\[workspaceId\]/templates
git commit -m "feat(web): edit templates through the collaborative page editor"
```

---

## Task 15: E2E spec

**Files:**

- Create: `apps/e2e/marketplace.spec.ts`

- [ ] **Step 1: Write the spec**

Create `apps/e2e/marketplace.spec.ts`. Use `signUpAndAuthAs` (`apps/e2e/helpers/auth.ts`). Note from memory: the E2E webServer has **no yjs server**, so assert on tRPC-backed UI (sidebar, marketplace cards) rather than editor content surviving reload. Seed tags must exist in the E2E DB — Playwright runs against the dev DB which is seeded; if not, insert tags in a setup step.

```ts
import { expect, test } from '@playwright/test'

import { signUpAndAuthAs } from './helpers/auth'

test('marketplace: sidebar nav, tag filter, sections render', async ({ page }) => {
  await signUpAndAuthAs(page)
  // Navigate to a workspace, then click the Маркетплейс sidebar item.
  await page.getByRole('link', { name: 'Маркетплейс' }).click()
  await expect(page).toHaveURL(/\/workspaces\/[0-9a-f-]+\/marketplace/)

  // Tag row renders with the seeded tags.
  await expect(page.getByRole('button', { name: 'Все' })).toBeVisible()
  await expect(page.getByText('Marketing')).toBeVisible()

  // Section headings render.
  await expect(page.getByText('Все шаблоны')).toBeVisible()

  // Filter by a tag — the URL/state updates and cards re-query (no crash).
  await page.getByText('Marketing').click()
  await expect(page.getByText('Все шаблоны')).toBeVisible()
})
```

> Adjust the navigation preamble to match how other specs reach a workspace (see `apps/e2e/helpers` and existing specs for the exact entry flow — memory notes the sidebar redesign changed this).

- [ ] **Step 2: Run the spec**

Ensure `docker compose up -d` and the DB is seeded (tags present). Run:
`pnpm exec playwright test apps/e2e/marketplace.spec.ts --retries 1`
Expected: PASS (retry warms cold compile per memory).

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/marketplace.spec.ts
git commit -m "test(e2e): marketplace navigation and tag filter"
```

---

## Task 16: Full gates + cleanup

- [ ] **Step 1: Run the merge gate**

Run (source `.env` first if in a worktree): `pnpm gates`
Expected: `check-types`, `lint` (--max-warnings 0), `build`, `test` all PASS, and `pnpm check-architecture` passes (no new disallowed cross-tier imports — note `tag-icon.tsx` is a client component importing only `@repo/ui` icons, which is allowed).

- [ ] **Step 2: Fix any gate failures**

Address lint/type/arch issues inline. Common ones:

- A client component deep-importing `@repo/domain` root — import types from where the dual client already imports them (`AppRouter` inference), not the domain root.
- Missing `@repo/ui` re-exports for `Chip`/`Card`/`CardActionArea`/`StarIcon` — add them.
- Stale `.next/types` after the deleted/renamed route — `rm -rf apps/web/.next/types` (memory).

- [ ] **Step 3: Final commit (if any fixes)**

```bash
git add -A
git commit -m "chore: marketplace gate fixes"
```

---

## Self-review notes (covered)

- **Item 1 (same editor / text transfers):** Task 14 mounts the collaborative `AnyNoteEditor` via the backing page; Task 8 copies `contentYjs` into the backing page on create.
- **Item 2 (template = normal page):** Backing page is a real `Page`; editor pipeline reused (Tasks 2, 8, 14).
- **Item 3 (anyone creates global):** Task 5 (`canCreateGlobalTemplate → true`), Task 13 (GLOBAL scope enabled in dialog).
- **Item 4 (Marketplace section, only Templates):** Tasks 11–12; type selector is implicit single-option (the page IS templates) — extend later.
- **Item 5 (rename, route, header search-left/breadcrumb-right, 3 sections + "Посмотреть все", 4-up cards, preview + author + rating + installs):** Tasks 11, 12.
- **Item 6 (regimented seeded tags with icons, first row):** Tasks 1, 3, 4 (seed), 12 (`TagRow` first row).
- **Permissions (tiered edit/delete):** Tasks 5, 8, 9.
