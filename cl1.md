# Workspace organization: collections as Teamspaces, Private/Shared pages, archive

## Описание фазы

Эта фаза превращает текущее дерево страниц AnyNote в структурированное
пространство документов по модели Notion, но с AnyNote-спецификой. `Page`
остается основной сущностью. `Collection` остается внутренней сущностью
AnyNote, но ее семантика должна соответствовать Notion Teamspace: командный
контейнер с отдельным составом, настройками доступа и деревом страниц.

Личная работа моделируется не через искусственный lifecycle `DRAFT ->
TEAM_PUBLISHED`, а через location/access: страницы в `Private` видны только
владельцу, страницы в `Shared` явно расшарены конкретным людям или группам, а
страницы в team collection видны участникам этой team collection. Архив - это
первоклассное состояние страницы, скрытое из обычного sidebar/tree/search/views
по умолчанию.

## Полный ожидаемый результат

- Добавлена `Collection` model and `Page.collectionId`.
- `Collection` работает как AnyNote-внутренний аналог Notion Teamspace:
  default team collection для всех участников workspace и дополнительные team
  collections с отдельным membership/access policy.
- Personal collection реализует Notion `Private` section: personal-only sidebar
  area для страниц, которые видны только владельцу в обычном UI/API.
- `Shared` не является collection. Shared pages - это derived sidebar surface из
  explicit `PageShare`/grant records для страниц, расшаренных отдельным людям
  или группам.
- `Site` коллекция которая достпна на тарифе от про и выше,
   специальная коллекция, если туда переместить старницы они формирует сайт (проверь как это сделано в Notion)
- Normal UI/API не раскрывает чужие private pages обычным участникам и admin
  users. Enterprise/workspace-owner content access, audit override и legal hold
  не входят в фазу 1 и должны проектироваться отдельно в enterprise phase.
- Sidebar shows team collections, shared pages and private pages. Archive
  доступен как отдельная utility surface/filter, но archived pages скрыты из
  обычного sidebar tree, collection views, recents и search по умолчанию.
- Collection home behaves like a page-based wiki surface: Home, All pages and
  Pages I own. Database-backed views остаются для поздних фаз.
- Page creation, child creation and move dialog understand active location:
  active team collection, explicit shared page or private area.
- Draft-like work is private by default. Becoming team-visible means moving the
  page into a team collection or explicitly sharing it, not toggling a fake
  Notion-style publish lifecycle.
- Page has archive/restore state and access-safe visibility rules.
- Search, tree, recents, share and export do not leak private/shared/archived
  pages outside the caller's effective access.
- Страницы из архивной коллекции (которая сейчас Корзина) не удаляются как сейчас

## Scope и ограничения

Page remains the core document entity. Collection is an AnyNote container inside
workspace, aligned with Notion Teamspace semantics. Private pages can be backed
by a personal collection for implementation convenience, but product semantics
must be "Private pages only visible to me", not "a teamspace named personal".

Shared pages are access grants on pages, not a collection type. Archive is page
state, not deletion and not a draft/publish lifecycle. Legacy pages without
collectionId must remain visible through migration or transitional behavior.

Databases are out of scope for phase 1. If a collection home needs All pages or
Pages I own, implement those as query-backed page lists for now and document
that full database-like views are a later phase.

## Рабочее задание фазы

Цель: добавить Notion-like организационный фундамент: collections as
Teamspace-like containers, private pages, shared pages, page-based collection
homes and archive.

Ключевые архитектурные решения:

- Не заменять `Page` новой сущностью документа. `Page` остается основой.
- Добавить `Collection` как командный контейнер внутри workspace. В UI можно
  называть его "Командное пространство" или "Коллекция", но в prompt/comments
  фиксировать соответствие Notion Teamspace.
- Default team collection включает всех workspace members по умолчанию.
- Additional team collections имеют собственный membership/access policy.
- Personal collection - internal backing для Notion-like `Private` section.
  Это не shared/team collection и не видимый другим team container.
- `Shared` section строится из explicit page shares/grants; не добавлять
  `Collection.kind = SHARED`.
- Не добавлять обычным страницам lifecycle `DRAFT | TEAM_PUBLISHED`. Черновая
  работа - это private location/access. Командная видимость - это move/share.
- Если AnyNote нужен metadata вроде `firstTeamVisibleAt`, `madeTeamVisibleById`
  или `lastMovedFromPrivateAt`, это implementation aid/analytics, а не источник
  прав доступа и не Notion parity.
- Archive - first-class page state: hidden by default, restorable, сохраняет
  history/links and access checks.
- Enterprise admin/audit access to private or archived content is deferred.
- каждый пользователь может сортировать коллекции на свое усмотрение

## Prompt 1.1 - Collection domain model and migration path

```text
Цель: добавить backend foundation для коллекций/teamspaces без UI.

Ориентиры по коду и текущей реализации:
- packages/db/prisma/schema.prisma
- packages/trpc/src/routers/page.ts
- packages/trpc/src/routers/workspace.ts
- packages/domain/src/**

Сделай:
1. Добавь Prisma model `Collection`:
   - id, workspaceId, title, description, icon, color;
   - kind: DEFAULT_TEAM | TEAM | PERSONAL;
   - ownerId required для PERSONAL, nullable для team/default;
   - homePageId nullable или явный domain contract для page-based collection
     home;
   - position, archivedAt nullable, createdAt, updatedAt.
2. Добавь membership/access model для team collections:
   - `CollectionMember` или существующий project pattern для membership grants;
   - role: OWNER | MEMBER;
   - default team collection доступна всем workspace members без ручного grant;
   - PERSONAL collection не использует team membership.
3. Добавь связь `Page.collectionId`.
4. Добавь индексы по workspaceId, kind, ownerId, archivedAt и membership lookup.
5. Добавь domain service для collections:
   - createDefaultTeamCollectionForWorkspace;
   - ensurePersonalCollectionForMember;
   - listCollectionsForUser;
   - create/update/archive/reorder team collections;
   - add/remove/update collection members.
6. Добавь tRPC router `collection` или расширь workspace/page router, если так
   принято в проекте. Предпочтительно отдельный router.
7. Реализуй transitional behavior:
   - existing pages без collectionId видны как legacy/default team collection;
   - новые team-visible pages создаются в default team collection, если active
     location team и collectionId не указан;
   - global quick-create без выбранной location должен уметь создать private
     page по Notion-like default.
8. Не добавляй `Collection.kind = SHARED`. Shared pages должны остаться
   explicit page grants/PageShare.
9. Добавь tests на domain/trpc:
   - workspace member видит default team collection;
   - member видит only team collections where access/membership allows it;
   - personal collection видит только owner through normal UI/API;
   - admin не видит чужую personal collection без explicit share/grant;
   - shared page is accessible via PageShare without creating a shared
     collection;
   - page create получает collectionId according to active location/defaults.

Не делай:
- Не меняй sidebar UI.
- Не делай Notion Sites/public web publishing.
- Не делай draft/team-published lifecycle.
- Не делай database-backed wiki views.

Проверки:
- pnpm --filter @repo/trpc test
- pnpm check-types

Критерий готовности:
- Коллекции существуют в DB/API как Teamspace-like containers, страницы могут
  быть привязаны к collectionId, текущие страницы не исчезают, Shared не
  смоделирован как отдельная collection.
```

## Prompt 1.2 - UI organization: team collections, Shared, Private, collection home, move dialog

```text
Цель: вывести Notion-like organization surfaces в интерфейс workspace.

Ориентиры по коду и текущей реализации:
- результаты задачи 1.1 в этой фазе
- apps/web/src/components/workspace/workspace-sidebar.tsx
- apps/web/src/components/workspace/page-tree-section.tsx
- apps/web/src/components/workspace/move-page-dialog.tsx
- apps/web/src/components/templates/use-create-page-flow.ts
- packages/trpc/src/routers/collection.ts если создан

Сделай:
1. Добавь sidebar organization sections:
   - "Командные пространства" / team collections для DEFAULT_TEAM и TEAM;
   - "Поделились" / Shared pages как список страниц с explicit PageShare/grant;
   - "Личное" / Private pages из personal collection;
   - collapsed state по аналогии с существующими sidebar секциями.
2. Не добавляй "Черновики" как отдельную Notion-parity секцию. Draft-like work
   lives in Private by default.
3. Добавь route collection home:
   - `/workspaces/[workspaceId]/collections/[collectionId]`;
   - page-based surface, not landing page;
   - tabs/sections: Home, All pages, Pages I own;
   - Home может быть backed by `homePageId`/root page;
   - All pages and Pages I own are query-backed page lists until database phase.
4. Измени `PageTreeSection`, чтобы показывать дерево страниц выбранной location:
   - selected team collection;
   - Private section for owner;
   - Shared pages list for explicit shares;
   - never mix private-only pages into team collection trees.
5. Расширь create page flow:
   - plus near team collection creates page inside that collection;
   - plus near Private creates private page;
   - global quick-create without chosen location defaults to Private or preview
     mode with explicit location chooser;
   - nested page inherits parent location/access by default.
6. Расширь move page dialog:
   - можно перемещать page между team collection and Private;
   - moving from Private to a team collection makes it visible to that
     collection according to collection permissions;
   - moving shared/team page to Private removes broad parent/team access for
     the moved parent according to existing PageShare rules;
   - сохраняется parent tree where possible;
   - нельзя переместить чужую private page без explicit rights.
7. Добавь Archive entry as utility surface/filter, not normal tree section:
   - archived pages are hidden from ordinary sidebar/tree by default;
   - permitted users can open archive view/filter to find restorable archived
     pages.
8. Добавь UI tests или Playwright smoke:
   - create team collection;
   - create page in team collection;
   - create private page and verify other member cannot see it;
   - share private page with one member and verify it appears in Shared;
   - move private page into team collection and verify team visibility;
   - navigate collection home Home/All pages/Pages I own.

Дизайн:
- Sidebar должен остаться плотным и сканируемым.
- Не добавлять hero/cards-landing внутри app shell.
- Collection home - рабочая wiki-like surface: title, metadata, Home,
  All pages, Pages I own.
- Shared and Private are sidebar organization surfaces, not marketing pages.

Проверки:
- pnpm --filter web lint
- pnpm check-types
- pnpm exec playwright test apps/e2e/workspace-flow.spec.ts или новый focused spec

Критерий готовности:
- Пользователь понимает, где team collections, где Shared, где Private, и как
  location/access делает страницу видимой нужной аудитории.
```

## Prompt 1.3 - Private and Shared page policy

```text
Цель: сделать `Private` and `Shared` настоящими access boundaries/surfaces, а
не только UI группами.

Ориентиры по коду и текущей реализации:
- packages/domain/src/**
- packages/trpc/src/routers/collection.ts
- packages/trpc/src/routers/page.ts
- packages/trpc/src/routers/search.ts
- packages/trpc/src/routers/page-share.ts
- apps/web/src/components/workspace/**

Сделай:
1. При добавлении workspace member автоматически ensure personal collection.
2. Обнови access resolver:
   - owner видит pages in own personal collection;
   - другие участники, включая admin users, не видят private pages through
     normal UI/API без explicit share/grant;
   - enterprise owner/admin content access не реализовывать в phase 1, только
     оставить явный comment/docs note that it belongs to enterprise audit phase;
   - explicit PageShare/grant can make a private page visible to selected
     people/groups without moving it to a team collection.
3. Обнови Shared pages behavior:
   - Shared sidebar lists pages explicitly shared with or by current user;
   - workspace members who are not included in the share cannot list/search/open
     those pages;
   - stopping share removes the page from Shared for affected users.
4. Обнови list/search/recents/export:
   - чужие private pages не попадают в дерево, поиск, recents, exports;
   - shared pages appear only for users with grant;
   - team collection pages appear according to collection/team membership;
   - archived pages are hidden by default even if user has access.
5. Обнови inheritance rules:
   - nested pages inherit parent location/access by default;
   - moving a parent to Private should remove broad team/workspace access from
     that parent according to current page-share model;
   - explicit child overrides must be preserved only if current model already
     supports them safely.
6. Добавь UI guard:
   - badge/label "Личное" for Private pages;
   - badge/label "Поделились" for explicitly shared pages where helpful;
   - warning when moving from Private to team collection because this makes the
     page team-visible.
7. Добавь tests:
   - admin user не видит чужую private page в list/search through normal API;
   - owner видит private page;
   - selected member sees explicitly shared private page in Shared;
   - unshared member cannot list/search/open the shared page;
   - moving private page to team collection makes it visible according to team
     collection membership;
   - public link/PageShare behavior remains scoped to existing AnyNote rules.

Проверки:
- pnpm --filter @repo/trpc test
- pnpm check-types

Критерий готовности:
- Private pages have a true privacy boundary; Shared pages are explicit grants;
  team collection visibility is location/access, not publish status.
```

## Prompt 1.4 - Archive state and visibility transitions

```text
Цель: заменить fake draft/publish lifecycle на Notion-like location/access
transitions и добавить archive as first-class page state.

Ориентиры по коду и текущей реализации:
- packages/db/prisma/schema.prisma model Page
- packages/trpc/src/routers/page.ts
- packages/trpc/src/routers/page-share.ts
- apps/web/src/components/workspace/page-context-menu.tsx
- apps/web/src/components/templates/create-page-dialog.tsx
- apps/web/src/app/(protected)/workspaces/[workspaceId]/pages/[pageId]/page.tsx

Сделай:
1. Не добавляй `publicationState: DRAFT | TEAM_PUBLISHED | ARCHIVED` для
   ordinary pages. This is not how Notion models ordinary page visibility.
2. Добавь archive fields к Page:
   - archivedAt nullable;
   - archivedById nullable;
   - restoredAt/restoredById only if existing audit conventions need them.
3. Если нужен AnyNote-specific team visibility metadata, добавляй его как
   secondary implementation aid, for example:
   - firstTeamVisibleAt;
   - madeTeamVisibleById;
   - lastMovedFromPrivateAt.
   Эти поля не должны управлять доступом. Access comes from location and grants.
4. Добавь/проверь tRPC/domain actions:
   - page.moveToPrivate;
   - page.moveToCollection;
   - page.share / page.stopSharing or existing PageShare actions;
   - page.archive;
   - page.unarchive.
5. Добавь page status/location UI:
   - Private badge/label;
   - Shared indicator when page has explicit grants;
   - Team collection breadcrumb/location;
   - Archived banner/icon and restore action;
   - no draft/published badge for ordinary workspace pages.
6. Обнови search/tree/collection home:
   - private pages не видны другим без explicit access;
   - shared pages видны только grantees;
   - archived pages hidden from ordinary tree, collection Home/All pages,
     Pages I own, recents and default search;
   - archive view/search filter can include archived content for permitted
     users;
   - archiving a parent archives descendants or makes descendants hidden by the
     same effective archive rule.
7. Сохрани link/history behavior:
   - existing links to archived pages should open for users who still have
     permission, with archived banner;
   - export/share must respect archive and access filters by default.
8. Добавь tests:
   - new private page is visible to author and hidden from another member;
   - explicit share makes private page appear in Shared for selected member;
   - moving private page to team collection makes it visible to that team;
   - archive hides page from sidebar/tree/search/collection home by default;
   - archive search/filter or archive view can find it for permitted user;
   - restore returns page to its previous accessible location;
   - parent archive hides/archives descendants consistently.

Проверки:
- pnpm --filter @repo/trpc test
- pnpm --filter web lint
- pnpm check-types
- focused Playwright for private -> shared -> team collection -> archive -> restore

Критерий готовности:
- Draft-like work is modeled as Private access. Team visibility is move/share.
  Archive is a real page state hidden by default and restorable.
```

## Prompt 1.5 - phase 1 hardening and migration cleanup

```text
Цель: закрыть фазу 1: migrations, backwards compatibility, empty states,
documentation and regressions.

Ориентиры по коду и текущей реализации:
- Все изменения prompts 1.1-1.4
- README или docs, где описан workspace/page behavior

Сделай:
1. Пройди все page list/query endpoints и проверь, что collection/private/shared
   archive rules учитываются единообразно.
2. Проверь all major surfaces:
   - sidebar/tree;
   - collection home Home/All pages/Pages I own;
   - search;
   - recents;
   - share dialog;
   - export;
   - comments;
   - templates/create page flow;
   - page move dialog.
3. Добавь empty states:
   - no team collections;
   - empty team collection;
   - no shared pages;
   - no private pages;
   - empty archive/filter result.
4. Проверь migration/backwards compatibility:
   - legacy root pages without collectionId remain visible in default team
     collection/transitional mode;
   - new pages get deterministic location;
   - no old code path treats SHARED as collection kind.
5. Добавь короткую docs note:
   - docs/notion-parity-phase-1-workspace-organization.md;
   - какие модели добавлены;
   - mapping: AnyNote Collection = Notion Teamspace-like container;
   - mapping: Private = personal pages, Shared = explicit page grants;
   - archive default-hidden behavior;
   - known limitations: no database views, no Notion Sites publish-to-web, no
     enterprise admin/audit override in phase 1.
6. Запусти полный relevant gate.

Проверки:
- pnpm --filter @repo/trpc test
- pnpm --filter web lint
- pnpm check-types
- pnpm exec prettier --check docs/notion-parity-phase-1-workspace-organization.md

Критерий готовности:
- Можно делать один commit фазы 1. Phase 1 aligns with Notion organization
  semantics while preserving AnyNote's Page core and Collection implementation
  constraints.
```
