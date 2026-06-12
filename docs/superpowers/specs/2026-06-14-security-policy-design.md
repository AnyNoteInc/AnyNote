# Enterprise Security Policy + Admin Content Search (Phase 8C)

**Date:** 2026-06-14
**Status:** approved design (brainstorm decisions locked with the user)
**Roadmap source:** `cl8.md` Prompt 8.4 — sub-phase 3 of 4 (8A people ✓ → 8B identity ✓ → **8C security+search** → 8D billing)

Workspace-level security controls enforced server-side at the existing
chokepoints, a guest-invite request workflow, and an OWNER-only audited admin
content search that keeps Phase-1 personal-privacy semantics intact for
everyone else. Security and honesty are the priorities.

## 1. Locked decisions

| Decision | Choice |
| --- | --- |
| Existing public links under the policy | **Resolver-level kill**: while `disablePublicLinksSitesForms` is on, `ShareAccessService.resolve` returns a policy-disabled state — public pages, public trees, copy-to-workspace, and yjs share-token minting all die at the single authority. Share rows untouched (non-destructive); disabling the policy restores them. |
| Admin search engine/depth | **PG full-text with excerpts**: the existing FTS path minus the visibility filter; Qdrant/engines untouched. Results carry title+excerpt+location+audience state+creator/lastEditor+who-can-access. Every query AND override audited; one-time privacy-warning acknowledgment (also audited). lastEditor = `updatedById` (structural edits only — yjs typing bumps `updatedAt` anonymously; documented approximation). |
| Guest-request discovery | **In-app notification + settings queue**: new `GUEST_INVITE_REQUESTED` notification event (enum migration, established pattern) to every OWNER + a pending queue in members settings; requester sees state in the share dialog. |

## 2. Data model (one migration `*_security_policy`)

```prisma
model WorkspaceSecurityPolicy {
  workspaceId                        String   @id @db.Uuid          // one row per workspace; cascade
  disableGuestInvites                Boolean  @default(false)
  allowGuestInviteRequests           Boolean  @default(true)        // meaningful only when invites are disabled
  disablePublicLinksSitesForms       Boolean  @default(false)
  disableExport                      Boolean  @default(false)
  disableMoveDuplicateOutsideWorkspace Boolean @default(false)
  adminContentSearchAcknowledgedAt   DateTime?                      // the one-time privacy-warning ack
  adminContentSearchAcknowledgedById String?  @db.Uuid
  configuredById                     String   @db.Uuid
  createdAt / updatedAt
}

enum GuestInviteRequestStatus { PENDING APPROVED REJECTED }

model PageGuestInviteRequest {
  id          String        @id @default(uuid(7)) @db.Uuid
  pageId      String        @db.Uuid               // cascade
  workspaceId String        @db.Uuid               // denormalized (the PageGuestInvite precedent); cascade
  email       String        @db.VarChar(255)       // lowercase
  role        PageShareRole
  requesterId String        @db.Uuid
  status      GuestInviteRequestStatus @default(PENDING)
  decidedById String?       @db.Uuid
  decidedAt   DateTime?
  createdAt / updatedAt
  @@index([workspaceId, status])
  @@index([pageId])
  // partial unique: one PENDING request per (page_id, email) — raw SQL, the job-infra pattern
}
```

No row = all-defaults policy (helpers treat absence as the zero-value policy;
the row is created lazily on first change).

`NotificationEventType` gains `GUEST_INVITE_REQUESTED`
(`ALTER TYPE ... ADD VALUE` migration — the REMINDER_DUE precedent), catalog
descriptor `{category: 'COLLABORATION', defaultChannels: ['IN_APP'], lockedChannels: ['IN_APP']}`,
helper `notify.guestInviteRequested({ownerId, workspaceId, requesterName, pageTitle?…})`
— pageTitle IS allowed in-app for owners (internal surface), but keep the
payload minimal: requester name + page title + workspace.

Audit catalog (`SECURITY_AUDIT_ACTIONS` in the new domain module):
`security.policy_changed` (metadata: {changed: {flag: [old, new]}}),
`security.search_acknowledged`, `content_search.performed` (metadata: {query,
filters, resultCount} — the QUERY is audited, that's the point),
`content_search.page_inspected` (optional drill-down), `guest_request.created`,
`guest_request.approved`, `guest_request.rejected`. Override actions performed
FROM admin search reuse the existing procedures and their existing audits where
present; admin-search-originated overrides additionally write
`content_search.override` with {action, pageId}.

## 3. Domain module `packages/domain/src/security/` (dto/repo/service, the established pattern)

- **Policy**: `getPolicy(workspaceId)` (zero-value default when absent),
  `updatePolicy({workspaceId, actorId, patch})` (lazy-create row, audit with the
  changed-flags diff, in-tx). Exported pure helpers for enforcement:
  `isGuestInviteDisabled(policy)`, etc.
- **Enforcement helpers** consumed by other layers:
  `assertGuestInvitesAllowed(workspaceId)`, `assertPublicSharingAllowed(workspaceId)`,
  `assertExportAllowed(workspaceId)`, `assertCrossWorkspaceCopyAllowed(workspaceId)`
  — each throws `SecurityPolicyError` (`POLICY_GUEST_INVITES_DISABLED`,
  `POLICY_PUBLIC_SHARING_DISABLED`, `POLICY_EXPORT_DISABLED`,
  `POLICY_CROSS_WORKSPACE_DISABLED`; httpStatus 403, honest Russian messages
  naming the policy, not vague denials).
- **Guest requests**: `createGuestInviteRequest({pageId, requesterId, email, role})`
  — requires: policy has invites disabled AND requests allowed
  (`POLICY_REQUESTS_DISABLED` otherwise), requester has page edit access
  (checked at the router), normalize email, refresh-PENDING semantics like
  invites, audit `guest_request.created`, returns owner ids for notification;
  `approveGuestInviteRequest({id, actorId})` — OWNER path: marks APPROVED +
  calls `people.createGuestInvite` (actor = approving OWNER; its mail+audit fire
  as usual; **the policy check is BYPASSED for the approval path** — that is the
  point of the workflow; implement via an internal `createGuestInviteUnchecked`
  or an explicit `bypassPolicy` flag on the people service, audited either way);
  `rejectGuestInviteRequest({id, actorId, })`; `listGuestInviteRequests(workspaceId)`
  (PENDING first); requester-facing `listMyRequestsForPage(pageId, requesterId)`.
- **Admin content search**: `adminContentSearch({workspaceId, actorId, query?,
  creatorId?, createdFrom?, createdTo?, audience?, cursor?})`:
  1. Requires the policy row's `adminContentSearchAcknowledgedAt` (else
     `SEARCH_ACK_REQUIRED` — the UI shows the warning gate; `acknowledgeContentSearch`
     sets it + audits).
  2. PG FTS (the `searchPg` SQL minus the visibility post-filter; query optional —
     empty query = browse-by-filters mode over the workspace's pages, same
     exclusions: deleted/archived/templates/db-rows).
  3. Joins per page: collection (kind/title), createdBy/updatedBy names,
     PageShare (access/mode/published state), grant count + guest grant count
     (grant-holders without membership), active PageGuestInvite count.
  4. Computes `audienceState`: `public` (share PUBLIC or SITE-published) →
     `external` (guest grants/invites > 0) → `internal` (TEAM/null collection or
     member grants) → `private` (own PERSONAL, no shares) — first match wins.
  5. Returns rows {pageId, title, excerpt (FTS headline or first matching
     block), location (collection title/kind), audienceState, createdBy,
     createdAt, lastEditor (updatedBy name, nullable), updatedAt, accessSummary
     {memberGrantCount, guestCount, publicMode}} + keyset cursor.
  6. Audits `content_search.performed` in the same call (query+filters+count).
- All in the domain so the privacy guardrail is one module with one test suite.

## 4. Enforcement wiring (every point test-pinned)

| Flag | Enforcement points |
| --- | --- |
| disableGuestInvites | `people.createGuestInvite` (domain — covers pageShare.inviteGuest + future callers) denies with POLICY_GUEST_INVITES_DISABLED; `pageShare.addUser` for NON-members (a grant to an outside user = a guest by definition — same policy; members were never addable) |
| disablePublicLinksSitesForms | tRPC: `setAccess` (to PUBLIC), `updatePublicLinkSettings` (access PUBLIC / making more open), `publishSite`, `setExposesAt` deny; **ShareAccessService.resolve** (domain): policy on ⇒ `{status:'unavailable', reason:'policy_disabled'}` BEFORE mode checks (kills LINK + SITE + tree + copy + share-token mint); the public page UI maps the reason to «Доступ по ссылке отключён администратором пространства»; member/grant fast-paths in web share-access remain (workspace members retain access through their own auth) |
| disableExport | `job.export.create` (tRPC), `/api/pages/[pageId]/export/[format]`, `/api/pages/[pageId]/export/csv` deny; existing artifacts (`/api/jobs/export/[jobId]/artifact`) stay owner-downloadable (created before the policy; document) |
| disableMoveDuplicateOutsideWorkspace | `pageShare.copyToWorkspace` denies based on the SOURCE workspace's policy (resolver already loads the share's workspace) |

Notes: the export job-create comment about deliberate non-gating is updated to
defer to the policy. Engines/agents untouched (no public-share or export paths
there). The `(public)` share routes surface the honest policy state, not 404.

## 5. tRPC `security.*` router

OWNER-only (`assertRole(['OWNER'])`) — security is not membership-admin work:
- `getPolicy`, `updatePolicy {workspaceId, patch}` (zod booleans, partial).
- `acknowledgeContentSearch {workspaceId}`.
- `contentSearch {workspaceId, query?, creatorId?, createdFrom?, createdTo?, audience?, cursor?}`.
- `listGuestRequests {workspaceId}`, `approveGuestRequest {id, workspaceId}`,
  `rejectGuestRequest {id, workspaceId}`.
Member-level: `requestGuestInvite {pageId, email, role}` (page edit access via
the existing page-access helpers; works only when the policy allows requests),
`myGuestRequests {pageId}` (requester's own, for the share dialog).
The approve path notifies nothing extra (the invite mail itself fires);
`requestGuestInvite` emits `notify.guestInviteRequested` to every OWNER.

## 6. Web UI

- **Settings section «Безопасность»** (slug `security`, after `identity`;
  show: `isOwner` — NOT plan-gated [security must not be paywalled]; visible
  for free workspaces too): policy switches with honest helper texts (public
  links switch warns «существующие ссылки перестанут открываться»), the
  guest-requests toggle nested under the invites switch; «Запросы на гостевой
  доступ» queue (requester, page, email, role, approve/reject buttons, empty
  state); «Поиск по содержимому» entry → the warning gate (legal text:
  владелец увидит содержимое всех страниц включая личные разделы; действие
  фиксируется в журнале) → acknowledge → the search panel (query + filters,
  result table with audience chips, per-row actions: открыть [navigates],
  снять публикацию, закрыть доступ [set RESTRICTED], отозвать гостевой доступ)
  — actions confirm + refresh. testids: `security-policy-links`,
  `security-policy-export`, `security-policy-guests`, `security-search-ack`,
  `security-search-input`, `security-search-row`, `guest-request-row`,
  `guest-request-approve`.
- **Share dialog**: when invites are disabled — the email-invite block is
  replaced by the request form (if requests allowed) showing the requester's
  pending request state, or an honest «Гостевые приглашения отключены
  администратором» note.
- **Public page**: the `policy_disabled` reason renders the honest state.
- **Members settings**: a badge/count on the guest-requests queue when PENDING
  requests exist.

## 7. Privacy guardrails (test-pinned)

1. Admin content search is OWNER-only — ADMIN/member/guest ⇒ FORBIDDEN (pinned);
   it is the ONLY path where another user's PERSONAL-collection pages become
   visible; `buildPageVisibilityWhere` and every normal search/read path are
   UNCHANGED (regression suite proves member/guest search results identical
   before/after the feature for a fixture with private pages).
2. Search requires the audited acknowledgment; every search writes the audit
   row with the query; every admin-search-originated override audits.
3. Policy enforcement is server-side at the listed chokepoints; UI hiding is
   cosmetic only. Honest error messages name the policy.
4. The approval path is the only bypass of disableGuestInvites and it requires
   OWNER + audits.
5. Notifications to owners carry page title + requester (internal surface) but
   guest-request EMAILS to invitees fire only after approval (the existing
   guest-invitation mail, no page title — unchanged).

## 8. Testing

- Domain vitest (real DB, fixture-scoped): policy CRUD + diff audits; every
  enforcement helper; guest-request lifecycle (create requires the right policy
  combo, refresh-PENDING, approve→real invite created [people audit + mail path]
  + APPROVED, reject, partial-unique); admin search (ack gate; finds another
  user's PERSONAL page for owner; audience-state matrix [4 states × fixtures];
  filters; excerpt presence; keyset; the audit row with the query; empty-query
  browse mode).
- tRPC: OWNER matrix (ADMIN forbidden on ALL security.* — pinned), the
  enforcement at each procedure (setAccess/publishSite/export/copyToWorkspace/
  inviteGuest/addUser-nonmember), requestGuestInvite (edit-access required,
  policy combo), notification emission, normal-search regression (member's
  results unchanged with the feature present).
- ShareAccessService: policy_disabled resolution for LINK and SITE + tree +
  copy + token-mint paths (extend the existing resolver tests).
- Route tests: the two export GET routes deny under policy.
- E2E: owner enables the links policy → a previously-working public link shows
  the honest disabled state → disables policy → link works again; export button
  blocked state; guest-request flow (member requests from the share dialog →
  owner sees the queue + notification → approve → guest invite row appears);
  admin search behind the warning gate finds a private page (second user's
  personal page seeded), audit log shows the query.
- Full gates; changelog «Безопасность пространства и поиск для владельца».

## 9. Non-goals

- Forms (AnyNote has none — the flag name keeps Notion parity wording, docs say
  «ссылки и сайты»).
- Qdrant/engines admin search; snippet redaction policies; scheduled re-checks.
- Per-collection/teamspace policy granularity; multiple policy profiles.
- Approval delegation (OWNER only); request expiry crons (requests live until
  decided; revisit in 8D+).
- Threading actors into yjs saves (lastEditor stays approximate).
