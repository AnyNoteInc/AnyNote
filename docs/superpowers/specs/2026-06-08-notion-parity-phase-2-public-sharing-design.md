# Notion-parity Phase 2 — Public sharing, public sites, copy-to-workspace

Status: approved design (2026-06-08). Roadmap source: `cl2.md`. Builds on Phase 1
(collections / private / shared / archive, merged to main `dddb42cb`).

## Goal

Bring AnyNote public sharing closer to Notion's model, split cleanly into:

- **Share / General access** — a public **link** (`Anyone with link`), view-only,
  with optional link expiration. Notion-parity.
- **Publish / Site** — a published public **site**: publish/unpublish, public URL,
  search indexing, duplicate-as-template (copy), publish-subpages-by-default,
  analytics. Notion-parity (minus custom domains/themes, out of scope).
- **Copy-to-workspace** — visitors duplicate a public page/site into a workspace +
  collection they own, with clear ownership boundaries (Notion duplicate-as-template).

AnyNote-only extensions, clearly isolated and labeled (NOT claimed as Notion parity):
password gate, scheduled publish (`exposesAt`), Yandex Metrica analytics.

`Page` remains the core entity. The public-site `SITE` collection kind from Phase 1
stays **independent** of Phase 2 publishing for now — in Phase 2 any page can be
published (Notion model), and the `SITE` collection kind remains reserved/empty.

## Non-goals (explicitly deferred)

- Notion Sites custom domains, themes, navigation bars, custom slugs, paid SEO fields.
- Generic cross-workspace database sync; embedded databases (cl3) copy as a clear
  readonly/unsupported placeholder until later phases.
- Public comment/edit on public links (links remain view-only in AnyNote). UI must
  not imply public comment/edit support.

## Data model

One Prisma migration extends `PageShare` and adds copy-provenance to `Page`.

### `PageShareMode` enum (new)

`LINK | SITE` — default `LINK`. The Share-vs-Publish split. A page has at most one
`PageShare` row (existing `@unique` on `pageId`); the row's `mode` says which surface
is active. Setting `mode = SITE` does not remove link settings; the resolver picks
the relevant semantics per mode.

### `PageShare` new fields

Applies to both modes:

- `mode PageShareMode @default(LINK)`
- `expiresAt DateTime?` — link/site expiration. Resolver denies after this instant.

The existing `access` (`RESTRICTED | PUBLIC`) and `linkRole` fields are retained and
keep their current meaning for the **link** surface in BOTH modes: a `SITE`-mode page
can still also have an `Anyone with link` view-only link. `mode` selects which
publish surface the Publish tab manages; it does not disable the General-access link.

Site-only (nullable; meaningful when `mode = SITE`):

- `publishedAt DateTime?` — set on publish, the authoritative "is published" signal.
- `unpublishedAt DateTime?` — set on unpublish (audit + management UI).
- `allowIndexing Boolean @default(false)` — drives robots/sitemap/metadata.
- `allowCopy Boolean @default(false)` — gates duplicate-as-template / copy button.
- `publishSubpages Boolean @default(true)` — subpages published by default for sites.
- `analyticsGoogleId String?` — GA measurement id, injected on public site pages.
- `analyticsYandexMetricaId String?` — AnyNote/regional extension, clearly labeled.

AnyNote extensions (nullable; grouped + commented as extensions in schema):

- `passwordHash String?` — bcrypt/scrypt hash via existing `@repo/auth` utils. Never
  store plaintext; never return to client.
- `exposesAt DateTime?` — scheduled publish. Before this instant the public route
  shows "not yet published" even if `publishedAt` is set.

### `Page` copy-provenance (new, nullable)

- `copiedFromShareId String?`
- `copiedFromPageId String?`
- `copiedAt DateTime?`

Used for "copied from" attribution on duplicated pages. No FK to the source (the
source may be deleted/cross-workspace); these are informational ids only.

### Plan gating

Public **site** publishing is Pro+; plain public **links** stay ungated (current
behavior). Use the existing `Plan.features` JSON extension point (no new column):
a `publicSitesEnabled` flag mapped in `BillingRepository.planToFeatures` and added to
the `PlanFeatures` DTO. `publishSite` checks `getWorkspaceFeatures(...).publicSitesEnabled`.

## PublicShareAccessResolver (domain, single authority)

A framework-agnostic helper in `@repo/domain` (the one place that decides public
access; the share route and the Yjs share-token endpoint both call it). It does NOT
reuse `buildPageVisibilityWhere` for the public path (that predicate is for
authenticated workspace queries), but it MUST apply the same Phase-1 access decisions
so private/personal/archived/deleted pages never leak through public traversal.

Input: `{ shareId, requestedPageId?, password?, now, session? }`.

Decision flow (first failure wins, returns an `unavailable` reason):

1. Share row not found → `unavailable: 'not_found'`.
2. Root page `deletedAt`/`archivedAt` set → `unavailable: 'disabled'` (fixes the
   current leak where the share route ignored these).
3. `expiresAt` in the past → `unavailable: 'expired'`.
4. Mode-specific:
   - **LINK**: `access` must be `PUBLIC` (enabled), else `unavailable: 'disabled'`.
     Role = `linkRole` (view-only surfaced in UI; EDITOR only if explicitly set).
   - **SITE**: must have `publishedAt` and not be unpublished
     (`unpublishedAt` null or before the latest `publishedAt`), else
     `unavailable: 'unpublished'`. If `exposesAt` set and in the future →
     `unavailable: 'not_yet_exposed'`. If `passwordHash` set and supplied password
     missing/invalid → `unavailable: 'password_required'`.
5. **Child page access (SITE only)**: when `requestedPageId` differs from the share
   root, the child must belong to the **published subtree**:
   - walk `parentId` from the child up to the share root; the chain must reach the
     root (else `unavailable: 'restricted_child'`),
   - `publishSubpages` must be true,
   - every page on the path must be non-deleted, non-archived, and not in another
     user's PERSONAL collection (reuses Phase-1 rules). Any failure →
     `unavailable: 'restricted_child'`.
   LINK mode never exposes a subtree — a child request in LINK mode is
   `unavailable: 'restricted_child'`.

   Note: Phase 2 adds **no** new per-child restriction field. "Restricted child"
   means a child that is deleted, archived, in a different user's PERSONAL
   collection, or not actually descended from the share root. A future phase may add
   explicit per-child publish overrides; the resolver shape leaves room for it.

Output: discriminated union
`{ status: 'ok', role, page, share } | { status: 'unavailable', reason }`.

`reason ∈ { not_found, disabled, unpublished, expired, not_yet_exposed,
password_required, restricted_child }`.

## PublicShareCopyService (domain)

Copies a public page/tree into a target workspace + collection. Reuses the
`createPageFromTemplate` deep-copy pattern (live DB content fetch — avoid the
stale-snapshot bug from templates-as-pages).

- Single page or whole visible published subtree (default: subtree, preserving tree).
- Copies `content` JSON + `contentYjs` bytes + `icon` + `type`. Does NOT copy
  `PageFile` rows (file ids embedded in content; same limitation as templates).
- Strips private grants, comments, member grants, workspace-only metadata. Sets copy
  provenance (`copiedFromShareId/PageId/At`).
- Target: chosen workspace + collection; default the caller's PERSONAL collection.
- Re-validates access through `PublicShareAccessResolver` before copying (denied if
  expired/unpublished/restricted/password-not-satisfied/allowCopy false).
- Embedded database blocks (future cl3): inserted as a clear readonly/unsupported
  placeholder.

## tRPC procedures (extend `page.share` router)

Management (`protectedProcedure`, gated by existing `assertCanManageShare`):

- `updatePublicLinkSettings` — `{ pageId, access, linkRole, expiresAt? }`.
- `updatePublicSiteSettings` — `{ pageId, allowIndexing, allowCopy, publishSubpages,
  analyticsGoogleId?, analyticsYandexMetricaId? }`.
- `publishSite` — `{ pageId }`; checks `publicSitesEnabled`; sets `mode=SITE`,
  `publishedAt=now`, clears `unpublishedAt`.
- `unpublishSite` — `{ pageId }`; sets `unpublishedAt=now`.
- `setSharePassword` — `{ pageId, password }`; stores hash. `clearSharePassword` —
  `{ pageId }`.
- `setExposesAt` — `{ pageId, exposesAt? }` (scheduled publish extension).
- `listManagedPublicPages` — workspace-scoped list for the Manage-public-pages UI.

Public:

- `validateSharePassword` — `{ shareId, password }` → boolean (for the gate; rate via
  existing patterns; no plaintext logging).
- `copyToWorkspace` — `{ shareId, rootPageId?, targetWorkspaceId, targetCollectionId?,
  includeSubtree? }`. Re-validates via resolver; runs `PublicShareCopyService`.

Password is never stored or returned in plaintext.

## UI + routing

### Share dialog → two tabs (`share-dialog.tsx` refactor)

- **Share / General access** (existing, enhanced): people with access + named grants
  (unchanged), General access select (`Доступ ограничен` → `Всем, у кого есть ссылка`),
  and under "Anyone with link" a **link-expiration** picker. No public comment/edit
  options surfaced.
- **Publish** (new tab): Publish/Unpublish primary action, public URL copy,
  published/unpublished status; **Site settings** section: indexing toggle, allow-copy
  toggle, publish-subpages toggle (default on), Google + Yandex analytics id fields;
  a clearly-labeled **"Расширения AnyNote"** subsection with password set/clear and
  scheduled-publish (`exposesAt`). Status chips: link enabled, link expires, site
  published, indexing on/off, copy allowed, subpages published, password-protected
  (extension), scheduled (extension).
- Dialog stays compact; Share and Publish are visually distinct; extension settings
  do not look like required Notion parity.

### Manage public pages

A workspace-settings surface (link from Publish tab + settings) listing the public
links/sites the user can manage, with open-settings / copy-URL / unpublish actions
(`listManagedPublicPages`).

### Public route (`(share)/s/[shareId]/` + nested child)

- Move robots/metadata into the page via `generateMetadata` (fixes the layout-level
  hardcoded `NOINDEX_METADATA`): `noindex` unless SITE published AND `allowIndexing`.
- Unavailable states rendered per resolver reason: disabled, unpublished, expired,
  not-yet-exposed (extension), restricted-child, password-required (renders a password
  gate that calls `validateSharePassword`).
- **`PublicShareTreeNavigation`** for SITE mode: a tree/sidebar of published subpages.
- **Nested child route** `/s/[shareId]/[childPageId]` for deep links to subpages;
  resolver validates the child is in the published subtree. Analytics scripts injected
  on site pages when configured.
- **`CopyToWorkspaceButton` + dialog**: visible only when `allowCopy` and resolver
  permits; choose target workspace + collection (default Private/personal); copies the
  whole visible subtree by default; anonymous visitors are sent to sign-in then resumed.

### Yjs / read-only

Public viewing continues through the existing anonymous share-token path
(`/api/yjs/share-token` → HS256 token, read-only for READER/COMMENTER). The token
endpoint switches to call `PublicShareAccessResolver` so expiry/unpublish/password/
archived checks are enforced for the collab connection too.

## Testing

trpc/domain tests:

- public link `expiresAt` denies after expiration; link without expiry stays available
  while enabled.
- public site unpublished denies; published subpage visible by default.
- restricted/private/personal/archived/deleted child hidden; direct child URL cannot
  bypass the resolver.
- password required/validated only when the password extension is configured.
- `exposesAt` in the future denies (extension only).
- `allowIndexing=false` yields noindex metadata (and excludes from sitemap if present).
- copy: disabled when `allowCopy=false`; denied when expired/unpublished/restricted/
  password-not-satisfied; creates page in target workspace/collection; subtree copy
  includes visible subpages; restricted/private/personal/archived/deleted children not
  copied; private grants/comments/member grants not copied; embedded-db placeholder is
  clear.
- plan gate: `publishSite` blocked when `publicSitesEnabled` false; plain links still work.

Playwright (extend `apps/e2e/page-sharing.spec.ts` + a focused public-site spec):

- enable Anyone-with-link → public page opens.
- link expiration in the past → unavailable state.
- publish site → public URL opens; unpublish → unavailable.
- enable duplicate-as-template → copy button visible; copy creates an owned page.
- password gate flow (extension).
- published subpage opens via nested URL; restricted child hidden.

## Checks (the gate for cl2)

- `pnpm --filter @repo/trpc test`
- `pnpm --filter @repo/domain test`
- `pnpm --filter web lint`
- `pnpm check-types`
- `pnpm exec playwright test apps/e2e/page-sharing.spec.ts` (+ focused public-site spec)
- Migration validated on a fresh scratch DB (zero drift), never the shared dev DB.

## Done criteria

A user can configure a public link (with expiry) and a public site (publish, indexing,
copy, subpages, analytics, plus clearly-labeled AnyNote password/schedule extensions)
without touching DB/API; the resolver is the single authority and never leaks
restricted/private/personal/archived/deleted children; visitors can copy a public
page/tree into a workspace/collection they own; UI copy never claims Notion supports
password protection or scheduled publish.
