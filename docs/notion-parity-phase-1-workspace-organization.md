# Notion-parity Phase 1: Workspace organization (Collections, Private/Shared, Archive)

## Overview

Phase 1 turns AnyNote's flat page tree into a Notion-aligned organized workspace while keeping
`Page` as the core document entity. It adds Collections (Teamspace-like containers), per-user
Private pages, a Shared surface from explicit grants, and Archive as a first-class restorable
state distinct from Trash.

## Models added

### Collection (`collections` table)

| Field         | Type / notes                                    |
| ------------- | ----------------------------------------------- |
| `id`          | UUID v7 (Prisma-generated)                      |
| `kind`        | Enum `TEAM \| PERSONAL \| SITE`                 |
| `ownerId`     | NULL for TEAM collections; user ID for PERSONAL |
| `workspaceId` | Required on all collections                     |
| `name`        | Display label                                   |

**Uniqueness constraints:**

- `collections_one_team_per_workspace` — partial unique index on `workspaceId` where
  `kind = TEAM`. Enforces one team collection per workspace.
- `collections_one_personal_per_user` — partial unique index on `(workspaceId, ownerId)` where
  `kind = PERSONAL`. Enforces one personal collection per (workspace, user).

`SITE` is reserved (no behavior) for a future public-sites phase.

### Page additions

| Field          | Type / notes                                      |
| -------------- | ------------------------------------------------- |
| `collectionId` | Nullable FK → `Collection` (SetNull on delete)    |
| `archivedAt`   | Nullable DateTime — set when the page is archived |
| `archivedById` | Nullable FK → `User` — who archived it            |

`Page.deletedAt` (Trash) is unchanged. Archive and Trash are independent states.

### UserPreference additions

| Field             | Type / notes                                           |
| ----------------- | ------------------------------------------------------ |
| `collectionOrder` | Json — per-user ordering of collections in the sidebar |

## Mapping to Notion concepts

| AnyNote concept              | Notion equivalent      | Notes                                                    |
| ---------------------------- | ---------------------- | -------------------------------------------------------- |
| Collection (kind `TEAM`)     | Teamspace              | One per workspace; visible to all members                |
| Collection (kind `PERSONAL`) | Private pages          | Visible to the owner only                                |
| "Поделились" sidebar section | Shared with me         | Pages shared via `PageShareUser` — not a collection type |
| Archive (`archivedAt`)       | Archive (Notion 2023+) | Hidden by default; restorable; not Trash                 |
| Trash (`deletedAt`)          | Trash                  | Path to permanent deletion; unchanged                    |

## Access model

`buildPageVisibilityWhere(userId)` in `@repo/domain` is the single source of truth for page
visibility. It is reused by the page tree, search, recents/history, and the engines MCP page
tools. A page is visible to a user when **any** of the following holds:

1. The page belongs to the workspace TEAM collection.
2. The page has a NULL `collectionId` (transitional / legacy / template-backing pages).
3. The page belongs to the caller's own PERSONAL collection.
4. The page is explicitly shared to the caller via a `PageShareUser` grant.

**Key rules:**

- PageShare grants override PERSONAL privacy — an explicitly shared private page is visible to
  the grantee.
- Archive and Trash are orthogonal filters applied on top of visibility. They are not part of
  the access predicate; callers opt in or out of including archived/deleted pages in their
  queries.

## Migration / backwards compatibility

The migration:

1. Creates one TEAM collection per existing workspace.
2. Creates one PERSONAL collection per (workspace, member) pair.
3. Assigns all legacy non-template pages to their workspace's TEAM collection.

This means existing pages remain visible to all workspace members exactly as before — zero
visibility regression. Privacy is opt-in: a user must explicitly move a page to their Personal
collection. Pages with a NULL `collectionId` are treated as TEAM-visible, so any
not-yet-backfilled page stays accessible.

## UI surfaces

- **Sidebar sections:** Команда (TEAM collection), Личное (PERSONAL collection), Поделились
  (pages shared via grant), plus an Архив link.
- **`/archive` route** — lists archived pages with a Restore action.
- **`/collections/[collectionId]` route** — collection home with three tabs: Home, Все страницы,
  Мои страницы. Each tab is a query-backed page list (not a database view).
- **Page context menu:** В архив, Сделать личной, В команду.
- **Move dialog** — destination chooser (Команда / Личное) with a "станет видна команде" warning
  when moving a private page to the team collection.
- **Quick-create** defaults to Private; nested pages inherit the parent's collection.

## Known limitations (Phase 1)

- **No multiple team collections.** One team space per workspace; `CollectionMember` is not
  modeled. TEAM access equals workspace membership.
- **No public SITE publishing.** The `SITE` kind is reserved but has no behavior.
- **No database-backed collection-home views.** Home / All / My tabs are dynamic query results,
  not persisted view configs.
- **No enterprise admin override.** Admins cannot inspect or audit private or archived content
  of other users. Deferred to an enterprise phase.

## Follow-ups (minor, non-blocking)

- **Comment realtime subscribe.** `comment.events.subscribe` (and the `comment-access` helper)
  gate on workspace membership + PageShare, but do not yet apply `buildPageVisibilityWhere`.
  A workspace member who knows a private page's id could subscribe to its comment-event stream
  (no page content is exposed, only comment events). Add the visibility predicate to the comment
  access path in a follow-up.
- **Explicit `collectionId` on create is not workspace-validated.** `page.create` accepts an
  explicit `collectionId`; the domain trusts it. This cannot reduce a page's visibility below the
  caller's rights (worst case is making the page more visible, e.g. assigning to TEAM), but a
  hardening pass should validate that the supplied collection belongs to the page's workspace.
