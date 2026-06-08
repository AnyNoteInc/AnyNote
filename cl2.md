# Notion-aligned public sharing, public site, and copy-to-workspace

## Описание фазы

Эта фаза приводит public sharing AnyNote ближе к текущей модели Notion, но без
потери ограничений AnyNote:

- `Share` menu / General access: уровни доступа, private/restricted states,
  `Anyone on the web with link` и link expiration.
- `Publish` tab / public site: publish/unpublish, public URL, site settings,
  search indexing, duplicate-as-template/copy controls, analytics settings and
  управление опубликованными страницами.
- Public site subpages: как в Notion Sites, subpages публикуются по умолчанию,
  если не ограничены правами/состоянием страницы.
- Copy-to-workspace: Notion-like duplicate as template, но с AnyNote-specific
  выбором workspace/collection и четкой границей ownership.

Official Notion baseline, checked 2026-06-07:

- `Sharing and permissions`: Share menu, General access, permission levels,
  `Anyone on the web with link`, link expiration and inherited/overridden access.
- `Publish a Notion Site`: Publish tab, public site, subpages published by
  default unless restricted, search indexing, duplicate as template, unpublish
  and All published sites.
- `Manage your Notion Sites`: Settings -> Public pages for managing public pages.
- `Duplicate public pages`: visitors duplicate a public page into their workspace;
  duplicated content includes subpages, while inaccessible blocks may become
  no-access placeholders.
- `Notion 2.42 release`: Notion Sites are the expanded Publish surface with
  domains/customization/SEO/analytics. AnyNote Phase 2 should not implement full
  custom domains/themes/navigation unless already scoped elsewhere.

Important parity correction:

- Password protection is not a core Notion Sites feature. If Phase 2 keeps a
  password gate, it must be documented and implemented as an AnyNote extension,
  not as Notion parity.
- Scheduled publication (`exposesAt`) is also an AnyNote extension unless a later
  product decision explicitly adopts it.
- Yandex Metrica is an AnyNote/regional analytics extension. Google Analytics and
  search indexing are the closer Notion Sites analogs.

## Полный ожидаемый результат

- PageShare can represent both public-link sharing and public-site publishing,
  or has equivalent fields that let the resolver/UI distinguish these modes.
- Public link mode supports `Anyone with link`, optional `expiresAt`, and the
  existing AnyNote permission surface. If public links remain view-only in
  AnyNote, the UI must not imply public comment/edit support yet.
- Public site mode supports publish/unpublish, public URL, site settings,
  `allowIndexing`, `allowCopy`/`duplicateAsTemplate`, analytics IDs and subpage
  publication by default.
- Optional AnyNote extensions are clearly separated: `passwordHash`, `exposesAt`,
  password validation UX and scheduled/unavailable states.
- `PublicShareAccessResolver` enforces disabled/unpublished state, link expiry,
  optional password/schedule gates, public-site subtree access and direct child
  URL access server-side.
- Resolver and copy logic reuse Phase 1 access rules: private/personal pages,
  shared pages, teamspace/collection visibility, drafts, archive/deleted states
  and explicit child restrictions must not leak through public sharing.
- Share dialog has a Notion-like split between Share/General access and
  Publish/Site settings instead of one flat advanced-settings list.
- Public routes include unavailable states for disabled, unpublished, expired,
  not-yet-exposed AnyNote extension, restricted child and password-required
  AnyNote extension.
- Public site navigation works for published subpages unless a page is restricted
  or excluded by AnyNote access/state rules.
- Copy-to-workspace duplicates public content into the selected workspace and
  collection without private grants, private comments, membership grants or
  workspace-only access assumptions.
- A workspace settings surface can list/manage public pages, mirroring Notion's
  Settings -> Public pages at the AnyNote level of scope.

## Scope и ограничения

This phase extends existing PageShare behavior. It should not implement generic
database sync between workspaces yet; embedded database content may be copied as a
clear readonly/unsupported/local placeholder until database sync exists.

Do not implement full Notion Sites custom domains, themes, navigation bars,
custom slugs or paid-plan SEO fields unless another phase already owns that
scope. Phase 2 should model the product semantics needed for public access,
indexing, duplicate-as-template, public-page management and safe copy.

## Рабочее задание фазы

Цель: усилить публичные ссылки и публикацию до Notion-like модели:

- Share menu: General access, permission levels, `Anyone with link`, link expiry.
- Publish tab: publish/unpublish as public site, site settings, indexing,
  duplicate-as-template, analytics and public-page management.
- Subpages: public site publishes subpages by default unless restricted.
- Copy: duplicate public page/tree into an AnyNote workspace/collection.
- AnyNote extensions: password gate and scheduled publish may remain, but must be
  named and tested as extensions rather than Notion parity.

Зависимости: Фаза 1. Subpage publishing and copy targets must respect
collections/teamspaces/personal/private/archive behavior from Phase 1.

## Prompt 2.1 - PageShare schema and public access resolver

```text
Цель: добавить backend foundation для Notion-aligned public links and public
site publishing.

Ориентиры по коду и текущей реализации:
- packages/db/prisma/schema.prisma model PageShare
- packages/trpc/src/routers/page-share.ts
- apps/web/src/lib/share-access.ts
- apps/web/src/app/(share)/s/[shareId]/**
- Phase 1 domain/access helpers for private/personal/shared/teamspace/collection/archive behavior

Сделай:
1. Расширь PageShare так, чтобы можно было различить два публичных режима:
   - public link / `Anyone with link`;
   - published public site / Publish tab.
   Если отдельный enum/field слишком дорогой, опиши существующими fields, но
   resolver and UI must not mix link-sharing semantics with site-publishing semantics.
2. Для public link mode поддержи:
   - enabled/disabled public access;
   - expiresAt nullable for link expiration;
   - permission level that AnyNote реально поддерживает for public users
     (view-only if comment/edit are not implemented).
3. Для public site mode поддержи:
   - published/unpublished state;
   - publishedAt/unpublishedAt if useful for audit/management UI;
   - allowIndexing boolean default false;
   - allowCopy or duplicateAsTemplate boolean default false;
   - publishSubpages/includeChildDocuments default true for site mode;
   - analyticsGoogleId nullable;
   - analyticsYandexMetricaId nullable as AnyNote extension.
4. Optional AnyNote extensions, clearly documented:
   - passwordHash nullable;
   - exposesAt nullable for scheduled publish.
5. Добавь domain helper `PublicShareAccessResolver`:
   - public link vs public site mode;
   - restricted/disabled/unpublished;
   - expired link denied;
   - not yet exposed denied only for AnyNote scheduled-publish extension;
   - password required/validated only for AnyNote password extension;
   - subtree access when public site publishes subpages;
   - direct child page access cannot bypass resolver.
6. Resolver must reuse Phase 1 page-access decisions:
   - private/personal pages are not leaked by public subtree traversal;
   - shared/teamspace/collection rules are respected;
   - archived/deleted pages are never public;
   - draft/unpublished page states are never public unless product rules say otherwise;
   - explicit child restrictions override default subpage publication.
7. Добавь tRPC procedures:
   - updatePublicLinkSettings;
   - updatePublicSiteSettings;
   - publishSite;
   - unpublishSite;
   - validateSharePassword only if password extension remains;
   - clearSharePassword only if password extension remains.
8. Не храни plain password.
9. Add tests:
   - public link expiresAt denies after expiration;
   - public link without expiration remains available while enabled;
   - public site unpublished state denies access;
   - public site subpage is visible by default;
   - restricted/private/personal/archived/deleted child is hidden;
   - direct child URL cannot bypass resolver;
   - password required/validated only for AnyNote password extension;
   - exposesAt future denied only for AnyNote scheduled-publish extension;
   - allowIndexing false affects metadata/robots/sitemap behavior if sitemap exists.

Проверки:
- pnpm --filter @repo/trpc test
- pnpm check-types

Критерий готовности:
- Public access semantics match the Notion split between Anyone-with-link and
  Publish/Site, while AnyNote-only gates are clearly isolated and cannot leak
  restricted child pages.
```

## Prompt 2.2 - Share dialog, Publish tab, site settings and public states

```text
Цель: вывести sharing UI as a Notion-like Share menu with a separate Publish tab,
not a flat advanced-settings drawer.

Ориентиры по коду и текущей реализации:
- apps/web/src/components/page/share-dialog.tsx
- apps/web/src/components/page/share-button.tsx
- apps/web/src/app/(share)/s/[shareId]/page.tsx
- apps/web/src/app/(share)/s/[shareId]/share-page-client.tsx
- packages/trpc/src/routers/page-share.ts
- workspace/settings UI if public-page management already exists

Сделай:
1. В Share/General access area:
   - show current page visibility/permission level;
   - support `Only invited/private`, workspace/teamspace/collection access if already present;
   - support `Anyone with link`;
   - link expiration picker under `Anyone with link`;
   - do not expose public comment/edit levels unless AnyNote actually supports them.
2. В Publish tab:
   - Publish / Unpublish primary action;
   - public URL copy;
   - status for published/unpublished;
   - site settings entry/section.
3. В site settings:
   - search indexing toggle (`allowIndexing`);
   - duplicate-as-template/copy toggle (`allowCopy` or `duplicateAsTemplate`);
   - publish subpages toggle, default on for published site mode;
   - analyticsGoogleId;
   - analyticsYandexMetricaId labeled as AnyNote extension;
   - password field set/clear inside an "AnyNote extensions" subsection only;
   - scheduled publish/exposeAt inside the same AnyNote extension subsection only.
4. Add clear visual statuses:
   - public link enabled;
   - link expires;
   - site published;
   - indexing on/off;
   - duplicate/copy allowed;
   - subpages published;
   - password protected (AnyNote extension);
   - scheduled/not yet exposed (AnyNote extension).
5. На public route:
   - add unavailable states for unpublished/disabled/expired/restricted child;
   - add password gate only when AnyNote password extension is configured;
   - add not-yet-published state only when AnyNote scheduled extension is configured.
6. Add Manage public pages entry:
   - link from Publish tab or settings to workspace-level public pages list;
   - list public links/sites the user can manage;
   - allow opening publish settings, copying public URL and unpublishing/removing public access.
7. Add Playwright:
   - enable Anyone with link -> public page opens;
   - set link expiration in past/test fixture -> unavailable state;
   - publish site -> public URL opens;
   - unpublish site -> public URL unavailable;
   - enable duplicate-as-template -> copy button visible;
   - password gate flow only under AnyNote extension.

Дизайн:
- Диалог должен оставаться компактным.
- Keep Share/General access and Publish/Site settings visually distinct.
- Advanced AnyNote-only settings must not look like required Notion parity.

Проверки:
- pnpm --filter web lint
- pnpm check-types
- pnpm exec playwright test apps/e2e/page-sharing.spec.ts

Критерий готовности:
- Пользователь может настроить public link and public site behavior without
  knowing DB/API details, and UI copy does not claim Notion supports password
  protection.
```

## Prompt 2.3 - public site subpages and navigation

```text
Цель: добавить Notion-like publication of nested documents for public site mode.

Ориентиры по коду и текущей реализации:
- packages/trpc/src/routers/page-share.ts
- packages/trpc/src/routers/page.ts
- apps/web/src/app/(share)/s/[shareId]/**
- apps/web/src/components/workspace/page-tree-section.tsx
- packages/domain/src/** access/page helpers
- Phase 1 collections/teamspaces/personal/private/archive rules

Сделай:
1. Реализуй public subtree query for public site mode:
   - root published page;
   - child pages included by default for public sites;
   - allow publisher to disable subpage publishing only if product keeps this AnyNote control;
   - respect explicit child restrictions;
   - respect draft/archive/deleted/private/personal rules from Phase 1;
   - do not infer visibility from parentId traversal alone.
2. Public link mode should not automatically become a mini-site unless product
   explicitly maps it to public site mode.
3. Добавь `PublicShareTreeNavigation` на public site view.
4. Поддержи прямой URL child page внутри public share:
   - route may accept child page id/slug if existing routing allows;
   - resolver must validate that child belongs to the published public subtree;
   - если routing менять рискованно, добавь in-page navigation first.
5. Добавь tests:
   - child visible by default for public site;
   - child hidden when publisher disables subpage publishing, if that control exists;
   - explicitly restricted child hidden;
   - archived/deleted child never visible;
   - private/personal child rules do not leak siblings;
   - shared/teamspace/collection access helper is used consistently;
   - public link mode does not expose subtree by accident.

Проверки:
- pnpm --filter @repo/trpc test
- pnpm --filter web lint
- pnpm check-types
- focused Playwright public subtree smoke

Критерий готовности:
- Public site can work as a small documentation site, with Notion-like default
  subpage publication and AnyNote access restrictions enforced.
```

## Prompt 2.4 - duplicate as template / copy public page-tree to workspace

```text
Цель: добавить "Копировать себе" for public pages as Notion-like Duplicate as
template, adapted to AnyNote workspace/collection ownership.

Ориентиры по коду и текущей реализации:
- packages/trpc/src/routers/page.ts
- packages/trpc/src/routers/page-share.ts
- apps/web/src/app/(share)/s/[shareId]/**
- apps/web/src/components/templates/use-create-page-flow.ts
- packages/domain/src/** page creation/copy helpers

Сделай:
1. Добавь domain service `PublicShareCopyService`:
   - copy single page;
   - copy public site tree by default when duplicate-as-template is enabled,
     matching Notion duplicate behavior;
   - for AnyNote target selection, let user choose target workspace and collection;
   - if target selection is skipped in some flow, default to user's personal/private area;
   - copy files according to storage/access rules;
   - strip private grants, comments, member grants and workspace-only metadata;
   - preserve only safe public/template metadata.
2. Добавь tRPC mutation `share.copyToWorkspace`.
3. Добавь `CopyToWorkspaceButton` and dialog:
   - visible only when `allowCopy`/`duplicateAsTemplate` is enabled and resolver permits access;
   - choose target workspace;
   - choose target collection;
   - choose single page vs whole public site tree only if product wants this extra choice;
   - otherwise duplicate the visible public site tree by default.
4. Добавь source metadata if useful:
   - copiedFromShareId;
   - copiedFromPageId;
   - copiedAt.
5. Не делай database synced clone yet; если public page contains embedded db,
   show unsupported/readonly/no-access placeholder until Phase 3/4.
6. Tests:
   - copy disabled when duplicate-as-template/allowCopy false;
   - copy denied when link expired/unpublished/restricted/password extension not satisfied;
   - copy creates page in target workspace/collection;
   - public site copy includes visible subpages by default;
   - restricted/private/personal/archived/deleted children are not copied;
   - private share users, grants and comments are not copied;
   - embedded database unsupported placeholder is clear.

Проверки:
- pnpm --filter @repo/trpc test
- pnpm --filter web lint
- pnpm check-types

Критерий готовности:
- Public page/site can become an owned AnyNote workspace page/tree with clear
  ownership boundaries and Notion-like duplicate-as-template semantics.
```
