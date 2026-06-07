# Marketplace & Templates UX overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** 8 UX changes to the marketplace (`/marketplace`) and template editor: content-preview cards, a dedicated `/marketplace/templates/{id}` template view that edits like a page with a three-dots menu + "Использовать" button, Russian tag names, a marketplace breadcrumb (icon+name) with the search moved into the top toolbar, and a tags-first layout without the "Маркетплейс" caption.

**Architecture:** Next.js 16 App Router (RSC + `(active)` route group), tRPC v11, Prisma, MUI v6. Marketplace renders inside the existing `WorkspaceLayoutClient` shell (breadcrumbs + `rightSlot` toolbar come from there). Template content already reuses the page editors (`PageView`→`PageRenderer`); we add a page-like header + actions menu around it. Search moves from the page body into the shell toolbar via a `?q=` URL param so the two components communicate across the RSC/client split.

**Reference:** mapping in memory obs 5509; key files below.

---

## File structure

**Create:**
- `apps/web/src/app/(protected)/(active)/marketplace/templates/[templateId]/page.tsx` — marketplace-scoped template route (RSC)
- `apps/web/src/app/(protected)/(active)/marketplace/templates/[templateId]/loading.tsx` — (optional) skeleton
- `apps/web/src/components/templates/template-actions-menu.tsx` — three-dots menu (edit/delete/copy-link/export)
- `apps/web/src/components/templates/template-meta-dialog.tsx` — edit title/icon/description dialog
- `apps/web/src/components/marketplace/template-preview.tsx` — scaled HTML miniature of template content

**Modify:**
- `packages/db/prisma/template-tags.ts` — Russian `name`s
- `packages/domain/src/templates/dto/templates.dto.ts` — add `previewContent` (JSON) to `TemplateSummaryDto`
- `packages/domain/src/templates/repositories/templates.repository.ts` — select + map `content` into summary as `previewContent`
- `packages/trpc/src/routers/template.ts` — (no change unless enriching; see Task 1 note)
- `apps/web/src/components/marketplace/template-card.tsx` — render `<TemplatePreview>` instead of color box; click navigates instead of `onUse`
- `apps/web/src/components/marketplace/marketplace-page.tsx` — tags-first, drop header caption, read `?q=`, navigate on card click
- `apps/web/src/components/marketplace/marketplace-header.tsx` — DELETE (caption removed; search moves to toolbar)
- `apps/web/src/components/marketplace/tag-row.tsx` — (Russian via DB; no code change needed)
- `apps/web/src/components/templates/template-editor.tsx` — page-like header (inline title/icon), "Использовать" button, three-dots menu
- `apps/web/src/components/workspace/workspace-layout-client.tsx` — marketplace breadcrumb (icon+name) + marketplace `rightSlot` (search)
- `apps/web/src/app/(protected)/(active)/templates/[templateId]/page.tsx` — redirect to `/marketplace/templates/{id}` (consolidate) OR keep; see Task 2
- E2E/unit: `apps/e2e/marketplace.spec.ts`, any template-route test, `apps/web/test/...`

---

## Task 1: Russian tag names (reseed)

**Files:** `packages/db/prisma/template-tags.ts`

- [ ] **Step 1: Translate `name` fields** (keep `slug`, `icon`, `position`):
```ts
export const TEMPLATE_TAGS: TemplateTagSeed[] = [
  { slug: 'job-search', name: 'Поиск работы', icon: 'WorkOutlineIcon', position: 0 },
  { slug: 'website-building', name: 'Создание сайта', icon: 'LaptopIcon', position: 1 },
  { slug: 'freelance', name: 'Фриланс', icon: 'DashboardIcon', position: 2 },
  { slug: 'student-planner', name: 'Студенческий планер', icon: 'MenuBookIcon', position: 3 },
  { slug: 'marketing', name: 'Маркетинг', icon: 'CampaignIcon', position: 4 },
  { slug: 'career-building', name: 'Карьера', icon: 'WorkOutlineIcon', position: 5 },
  { slug: 'personal-website', name: 'Личный сайт', icon: 'LaptopIcon', position: 6 },
  { slug: 'study-planner', name: 'План обучения', icon: 'BookmarkIcon', position: 7 },
]
```

- [ ] **Step 2: Reseed (upsert by slug updates existing rows).** The seed must upsert tag names. Check `packages/db/prisma/seed.ts` calls a tag seeder using `TEMPLATE_TAGS`; run:
```bash
pnpm --filter @repo/db exec prisma db seed
```
If the seeder only `create`s (not upserts) tags, update it to `upsert({ where: { slug }, update: { name, icon, position }, create: {...} })` first. Verify in DB:
```bash
docker compose exec -T -e PGPASSWORD=<pw> postgres psql -U <user> -d anynote -c "SELECT slug,name FROM template_tags ORDER BY position;"
```
Expected: Russian names.

- [ ] **Step 3: Commit**
```bash
git add packages/db/prisma/template-tags.ts packages/db/prisma/seed.ts
git commit -m "feat(db): Russian marketplace tag names"
```

---

## Task 2: `/marketplace/templates/[templateId]` route + redirect consolidation

The template view should open at `/marketplace/templates/{id}`. Reuse the existing template RSC logic.

**Files:**
- Create `apps/web/src/app/(protected)/(active)/marketplace/templates/[templateId]/page.tsx`
- Modify `apps/web/src/app/(protected)/(active)/templates/[templateId]/page.tsx` → redirect to the marketplace path

- [ ] **Step 1: Create the marketplace template route.** Copy the current `(active)/templates/[templateId]/page.tsx` content verbatim into the new path (it resolves active workspace, `template.getById` + `getBackingPage`, renders `<TemplateEditor>`), with the try/catch→notFound pattern already present. Keep the exact same body.

- [ ] **Step 2: Make the old `/templates/[templateId]` a redirect** to consolidate (so any old link lands on the new canonical URL):
```tsx
import { redirect } from 'next/navigation'

export default async function TemplateRedirect({
  params,
}: {
  params: Promise<{ templateId: string }>
}) {
  const { templateId } = await params
  redirect(`/marketplace/templates/${templateId}`)
}
```

- [ ] **Step 3: Update the legacy workspace redirect** `apps/web/src/app/(protected)/workspaces/[workspaceId]/templates/[templateId]/page.tsx` to point at `/marketplace/templates/${templateId}` (currently `/templates/${templateId}`).

- [ ] **Step 4: check-types** `pnpm --filter web check-types` → PASS.

- [ ] **Step 5: Commit**
```bash
git add "apps/web/src/app/(protected)/(active)/marketplace/templates" "apps/web/src/app/(protected)/(active)/templates/[templateId]/page.tsx" "apps/web/src/app/(protected)/workspaces/[workspaceId]/templates/[templateId]/page.tsx"
git commit -m "feat(web): template view at /marketplace/templates/[id]"
```

---

## Task 3: Card click navigates to the template view (not instant create)

**Files:** `apps/web/src/components/marketplace/template-card.tsx`, `marketplace-page.tsx`

- [ ] **Step 1: TemplateCard** — change `onUse` callback to `onOpen` and wrap in a `next/link` `<Link href={/marketplace/templates/${template.id}}>` around `CardActionArea` (or call `router.push`). Remove the immediate-create behavior from the card.

- [ ] **Step 2: MarketplacePage** — replace `onUse={onUse}` wiring with navigation: each card links to `/marketplace/templates/${id}`. Remove the `createPageFromTemplate` mutation from `MarketplacePage` (it moves to the template view, Task 4). Keep `Section` but rename its `onUse` prop to `onOpen` passing the id to a `router.push('/marketplace/templates/'+id)` (or pass nothing and let the card link).

- [ ] **Step 3: check-types + lint.**

- [ ] **Step 4: Commit**
```bash
git add apps/web/src/components/marketplace/template-card.tsx apps/web/src/components/marketplace/marketplace-page.tsx
git commit -m "feat(web): marketplace cards open the template view"
```

---

## Task 4: Template view — page-like header, "Использовать" button, three-dots menu

**Files:** `template-editor.tsx`, new `template-actions-menu.tsx`, new `template-meta-dialog.tsx`

- [ ] **Step 1: `template-actions-menu.tsx`** — a `MoreHorizIcon` `IconButton` opening a `Menu` with items (gate edit/delete behind `canEdit`):
  - **Редактировать** (canEdit) → opens `<TemplateMetaDialog>` (title/icon/description) calling `trpc.template.update`.
  - **Удалить шаблон** (canEdit) → confirm dialog → `trpc.template.delete({ templateId, workspaceId })` → `router.push('/marketplace')`.
  - **Копировать ссылку** → `navigator.clipboard.writeText(${origin}/marketplace/templates/${templateId})`.
  - **Экспорт** → link to `/api/pages/${backingPageId}/export/md` (backing page export) — reuse the page export API; only if `backingPageId`.
  Props: `{ templateId, workspaceId, backingPageId, canEdit, title, icon, description }`.

- [ ] **Step 2: `template-meta-dialog.tsx`** — MUI Dialog with title text field, emoji/icon text field, description textarea; on save `trpc.template.update.mutate({ templateId, workspaceId, title, icon, description })` then close + `router.refresh()`.

- [ ] **Step 3: Update `template-editor.tsx` header** to mirror a page header:
  - Keep the editor body (`<PageView .../>`) untouched.
  - Header row: back button "К маркетплейсу" → `/marketplace`; icon + title (inline, page-like); spacer; **"Использовать"** contained Button (replaces the old share placement) calling `trpc.template.createPageFromTemplate.mutate({ templateId, workspaceId, parentId: null })` → `router.push('/pages/'+res.id)`; then `<TemplateActionsMenu .../>`.
  - Add `templateId`, `description`, `canEdit`, `backingPageId` to `TemplateEditor` props; the route (Task 2) already has these from `getById` — pass them through.

- [ ] **Step 4: Pass new props from the route** — in the marketplace template route, pass `templateId={templateId}`, `canEdit={template.canEdit}`, `description={template.description}`, `backingPageId={template.backingPageId}` to `<TemplateEditor>`.

- [ ] **Step 5: check-types + lint.**

- [ ] **Step 6: Commit**
```bash
git add apps/web/src/components/templates "apps/web/src/app/(protected)/(active)/marketplace/templates"
git commit -m "feat(web): template view actions menu + Использовать button"
```

---

## Task 5: Content-preview cards (HTML miniature)

Render a scaled HTML miniature of the template's content instead of the color box.

**Files:** domain DTO + repo, `template-preview.tsx`, `template-card.tsx`. The preview HTML is derived server-side; the domain layer can't use `@tiptap/html`, so we ship the **content JSON** in the summary and convert it in the web layer.

- [ ] **Step 1: Domain** — add `previewContent: Prisma.JsonValue | null` to `TemplateSummaryDto` (`templates.dto.ts`), and in `templates.repository.ts` `toSummary`: add `content: true` to the summary `select` and map `previewContent: row.content`. (Content JSON for a template is small; acceptable for the list.)

- [ ] **Step 2: `template-preview.tsx`** (client) — accepts `content` (JSON) + `icon`; renders `tiptapJsonToHtml(content)` inside a fixed-height box, scaled down (`transform: scale(.5); transform-origin: top left; overflow: hidden; pointer-events: none`). If content is empty, fall back to the icon + gradient box (current behavior). **Note:** `tiptapJsonToHtml` lives in `apps/web/src/server/page-export/tiptap-to-html.ts` and imports `@tiptap/html` — verify it's safe to import in a client component; if it pulls server-only deps, instead expose a small client-safe `generateHTML` wrapper or render via `dangerouslySetInnerHTML` from a server-computed string. PREFERRED: compute `previewHtml` in the RSC parent isn't possible (MarketplacePage is client via useQuery) — so compute in a tiny server util imported into the client bundle only if `@tiptap/html` is client-safe (it is browser-compatible). Use `dangerouslySetInnerHTML`.

- [ ] **Step 3: `template-card.tsx`** — replace the color `Box` with `<TemplatePreview content={template.previewContent} icon={template.icon} id={template.id} />`. Keep title/description/footer.

- [ ] **Step 4: Sanitize** — `tiptapJsonToHtml` output is from trusted template content (created via the editor), but since it's `dangerouslySetInnerHTML`, confirm the export pipeline already treats this content as safe (it does for export). Keep `pointer-events:none` and no script execution (generateHTML emits no scripts).

- [ ] **Step 5: check-types + lint + verify in browser.**

- [ ] **Step 6: Commit**
```bash
git add packages/domain apps/web/src/components/marketplace
git commit -m "feat(marketplace): content-preview template cards"
```

---

## Task 6: Marketplace breadcrumb (icon + name) in the top toolbar

**Files:** `workspace-layout-client.tsx`

- [ ] **Step 1: Add a marketplace branch to the `breadcrumbs` useMemo** (before the fallback): when `pathname.startsWith('/marketplace')`, return a marketplace crumb. The crumb needs an icon — extend the breadcrumb item type used by `WorkspaceToolbar` to optionally carry an `icon?: ReactNode`, OR render the icon inline. Simplest: add `{ label: 'Маркетплейс', href: '/marketplace', icon: <StorefrontIcon/> }` and update `WorkspaceToolbar` to render `crumb.icon` before the label. For a template sub-view (`/marketplace/templates/...`) add a second crumb with the template title (resolve via a light `trpc.template.getById` or pass through — or just show "Шаблон").

- [ ] **Step 2: Update `WorkspaceToolbar`** breadcrumb rendering to show an optional leading icon per crumb (the marketplace crumb gets `StorefrontIcon` from `@repo/ui/components`; verify it's exported, else add to `packages/ui/src/components/index.ts`).

- [ ] **Step 3: check-types + lint + verify.**

- [ ] **Step 4: Commit**
```bash
git add apps/web/src/components/workspace/workspace-layout-client.tsx apps/web/src/components/workspace/workspace-toolbar.tsx packages/ui/src/components/index.ts
git commit -m "feat(web): marketplace breadcrumb with icon"
```

---

## Task 7: Move marketplace search into the top toolbar (rightSlot)

Search currently lives in `MarketplaceHeader` inside the page body. Move it to the toolbar `rightSlot`, sharing state via a `?q=` URL param.

**Files:** `workspace-layout-client.tsx`, `marketplace-page.tsx`, new toolbar search component (or reuse `TemplateSearchInput`)

- [ ] **Step 1: Toolbar rightSlot** — in `workspace-layout-client.tsx`, add a marketplace branch to `rightSlot`: when `pathname.startsWith('/marketplace')` and NOT a template sub-view, render a `<MarketplaceToolbarSearch />` that reads/writes `?q=` via `useRouter`/`useSearchParams` (`router.replace('/marketplace?q='+v)`). Use `TemplateSearchInput` for the field.

- [ ] **Step 2: MarketplacePage reads `?q=`** — replace local `query` state with `useSearchParams().get('q') ?? ''` (debounce if needed). Drop `MarketplaceHeader` usage entirely.

- [ ] **Step 3: Delete `marketplace-header.tsx`** (caption + body search removed). Remove its import from `marketplace-page.tsx`.

- [ ] **Step 4: check-types + lint + verify search filters cards from the toolbar.**

- [ ] **Step 5: Commit**
```bash
git add apps/web/src/components/workspace apps/web/src/components/marketplace
git rm apps/web/src/components/marketplace/marketplace-header.tsx
git commit -m "feat(web): marketplace search in top toolbar"
```

---

## Task 8: /marketplace starts with tags, no "Маркетплейс" caption

**Files:** `marketplace-page.tsx` (largely done by Tasks 6/7)

- [ ] **Step 1:** Ensure `MarketplacePage` body now starts with `<TagRow>` (the caption/header is gone after Task 7). Adjust top padding so tags are the first element. Remove any leftover "Маркетплейс" Typography.

- [ ] **Step 2: verify** the page renders tags first, then sections; the only "Маркетплейс" text is the breadcrumb (Task 6).

- [ ] **Step 3: Commit (if separate)**
```bash
git add apps/web/src/components/marketplace/marketplace-page.tsx
git commit -m "feat(marketplace): tags-first layout, drop caption"
```

---

## Task 9: Tests + full gate

- [ ] **Step 1:** Update `apps/e2e/marketplace.spec.ts` for the new flow (card click → `/marketplace/templates/{id}` → "Использовать" → `/pages/{id}`). Update any unit test asserting old marketplace header/caption or instant-create.
- [ ] **Step 2:** Run `pnpm --filter web check-types`, `pnpm --filter web lint`, `pnpm --filter web test`, `pnpm --filter @repo/trpc test`, `pnpm --filter @repo/db check-types`. All green (agents mypy pre-existing errors excepted).
- [ ] **Step 3:** Manual verify in browser (Playwright): tags Russian + first; card shows content preview; click opens `/marketplace/templates/{id}`; "Использовать" creates a page; three-dots menu (edit/delete/copy/export); breadcrumb icon+name; search in toolbar filters.

---

## Notes / risks
- **Layering:** domain stays framework-agnostic — it only adds the `content` JSON to the summary; HTML conversion happens in `apps/web`.
- **Preview perf:** template content JSON is small; if any template has huge content, cap the snippet server-side (first ~20 nodes) in `toSummary`.
- **Search via URL param** keeps toolbar↔page decoupled and SSR-safe.
- **`StorefrontIcon`** must be exported from `@repo/ui/components` (add if missing).
- Don't weaken `canEdit` gating: edit/delete menu items only when `template.canEdit`.
